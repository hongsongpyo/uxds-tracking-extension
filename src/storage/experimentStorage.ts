import {
  DATABASE,
  STORAGE_BATCH
} from "../shared/constants";

import {
  createLogger
} from "../shared/logger";

import {
  createMessageId,
  nowEpochMs
} from "../shared/utils";

import type {
  AoiRegistryEntry,
  CalibrationQualityLevel,
  CalibrationValidationMetrics,
  AoiHitCandidate,
  FixationEvent,
  PageCoordinateSnapshot,
  RuntimeQualityDiagnostic,
  ScrollEventRecord,
  SessionId,
  SessionRecord
} from "../shared/types";

import type {
  TrackingContextChangeReason
} from "../shared/messages";

import type {
  AoiHitPayload
} from "../shared/messages";

import {
  buildSessionExportFiles
} from "./sessionExport";

import type {
  ExportedTextFile,
  SessionExportData,
  StoredAoiRecord,
  StoredFixationRecord,
  StoredGazeObservation,
  StoredNavigationRecord,
  StoredDiagnosticRecord,
  StoredScrollRecord,
  StoredSessionRecord,
  StoredValidationSnapshot
} from "./storageTypes";

const logger = createLogger("STORAGE");

const SESSION_INDEX = "sessionId" as const;
const PAGE_INDEX = "pageId" as const;
const TIMESTAMP_INDEX = "timestampMs" as const;

function requestResult<T>(
  request: IDBRequest<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("IndexedDB request failed.")
    );
  });
}

function transactionDone(
  transaction: IDBTransaction
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("IndexedDB transaction failed.")
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("IndexedDB transaction was aborted.")
    );
  });
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

function ensureRecordStore(
  database: IDBDatabase,
  transaction: IDBTransaction,
  name: string
): IDBObjectStore {
  const store = database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath: "recordId" });

  ensureIndex(store, SESSION_INDEX, "sessionId");
  ensureIndex(store, PAGE_INDEX, "pageId");

  return store;
}

function configureSchema(
  database: IDBDatabase,
  transaction: IDBTransaction
): void {
  if (!database.objectStoreNames.contains(DATABASE.STORES.SESSIONS)) {
    database.createObjectStore(
      DATABASE.STORES.SESSIONS,
      { keyPath: "sessionId" }
    );
  }

  const gaze = ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.GAZE_SAMPLES
  );
  ensureIndex(gaze, TIMESTAMP_INDEX, "timestampMs");

  ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.INTERACTION_EVENTS
  );

  ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.AOI_REGISTRY
  );

  ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.FIXATION_EVENTS
  );

  ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.PAGE_EVENTS
  );

  // Diagnostics are exported by session, so they must carry the same
  // session/page indexes as the other session-scoped record stores.
  // Earlier schema revisions created this store without indexes, which made
  // exportSession() fail with NotFoundError when it called store.index().
  ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.DIAGNOSTICS
  );

  // Reserved stores that are not queried through the session index.
  for (const name of [
    DATABASE.STORES.CALIBRATION_SAMPLES,
    DATABASE.STORES.CALIBRATION_SUMMARY,
    DATABASE.STORES.UPLOAD_QUEUE
  ]) {
    if (!database.objectStoreNames.contains(name)) {
      database.createObjectStore(name, { keyPath: "recordId" });
    }
  }
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      DATABASE.NAME,
      DATABASE.VERSION
    );

    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;

      if (transaction === null) {
        reject(new Error("IndexedDB upgrade transaction is unavailable."));
        return;
      }

      configureSchema(database, transaction);
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onversionchange = () => {
        database.close();
      };

      resolve(database);
    };
    request.onerror = () => reject(
      request.error ?? new Error("IndexedDB could not be opened.")
    );
    request.onblocked = () => reject(
      new Error("IndexedDB upgrade is blocked by another extension context.")
    );
  });
}

async function getAllBySession<T>(
  database: IDBDatabase,
  storeName: string,
  sessionId: SessionId
): Promise<T[]> {
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);

  let values: unknown[];

  if (store.indexNames.contains(SESSION_INDEX)) {
    const index = store.index(SESSION_INDEX);
    values = await requestResult(
      index.getAll(IDBKeyRange.only(sessionId))
    );
  } else {
    // Defensive compatibility path for databases created by older builds
    // before the diagnostics session index existed. The DB version bump
    // normally repairs the schema, but export should remain usable even if
    // an old context delayed the migration.
    const allValues = await requestResult(store.getAll()) as Array<{
      readonly sessionId?: unknown;
    }>;

    values = allValues.filter(
      (value) => value.sessionId === sessionId
    );
  }

  await transactionDone(transaction);
  return values as T[];
}

export interface ValidationStorageInput {
  readonly calibrationId: string;
  readonly strategy: string | null;
  readonly quality: CalibrationQualityLevel | null;
  readonly metrics: CalibrationValidationMetrics | null;
  readonly baselineShadowQuality: CalibrationQualityLevel;
  readonly baselineShadowMetrics: CalibrationValidationMetrics;
  readonly authoritativeValidationReady: boolean;
  readonly degradedCollectionAllowed: boolean;
  readonly recalibrationRecommended: boolean;
}

export class ExperimentStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private gazeBuffer: StoredGazeObservation[] = [];
  private eventBuffer: StoredScrollRecord[] = [];
  private fixationBuffer: StoredFixationRecord[] = [];

  private flushTimerId: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;

  public async initialize(): Promise<void> {
    await this.getDatabase();
  }

  public async putSession(session: SessionRecord): Promise<void> {
    const database = await this.getDatabase();

    const readTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readonly"
    );
    const existing = await requestResult(
      readTransaction
        .objectStore(DATABASE.STORES.SESSIONS)
        .get(session.sessionId)
    ) as StoredSessionRecord | undefined;
    await transactionDone(readTransaction);

    const record: StoredSessionRecord = {
      sessionId: session.sessionId,
      session: {
        ...session,
        browser: { ...session.browser },
        screen: { ...session.screen },
        camera: session.camera === null ? null : { ...session.camera }
      },
      validation: existing?.validation ?? null,
      updatedAtEpochMs: nowEpochMs()
    };

    const writeTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readwrite"
    );
    writeTransaction
      .objectStore(DATABASE.STORES.SESSIONS)
      .put(record);
    await transactionDone(writeTransaction);
  }

  public async setValidation(
    sessionId: SessionId,
    input: ValidationStorageInput
  ): Promise<void> {
    const database = await this.getDatabase();

    const readTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readonly"
    );
    const existing = await requestResult(
      readTransaction
        .objectStore(DATABASE.STORES.SESSIONS)
        .get(sessionId)
    ) as StoredSessionRecord | undefined;
    await transactionDone(readTransaction);

    if (existing === undefined) {
      throw new Error(`Session ${sessionId} is not stored.`);
    }

    const validation: StoredValidationSnapshot = {
      ...input,
      metrics: input.metrics === null ? null : { ...input.metrics },
      baselineShadowMetrics: { ...input.baselineShadowMetrics },
      capturedAtEpochMs: nowEpochMs()
    };

    const writeTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readwrite"
    );
    writeTransaction
      .objectStore(DATABASE.STORES.SESSIONS)
      .put({
        ...existing,
        validation,
        updatedAtEpochMs: nowEpochMs()
      } satisfies StoredSessionRecord);
    await transactionDone(writeTransaction);
  }

  public queueGaze(
    sessionId: SessionId,
    tabId: number,
    payload: AoiHitPayload
  ): void {
    const storedCoordinates =
      payload.gazeCoordinates
      ?? payload.coordinates;

    const gazeNormalizedPoint =
      payload.stabilizedNormalizedPoint
      ?? payload.probeNormalizedPoint;

    this.gazeBuffer.push({
      recordId: createMessageId(),
      sessionId,
      pageId: payload.pageId,
      tabId,
      browserFrameId: payload.browserFrameId,
      timestampMs: payload.hit.timestampMs,
      capturedAtEpochMs: storedCoordinates.capturedAtEpochMs,
      pointSource: payload.pointSource,
      coordinateSource:
        payload.gazeCoordinates === null
          ? "FIXATION_CENTROID_SNAPSHOT"
          : "STABILIZED_GAZE",
      gazeQuality: payload.gazeQuality,
      degradedCollection: payload.degradedCollection,
      fixationId: payload.fixationId,
      gazeNormalizedPoint: {
        ...gazeNormalizedPoint
      },
      probeNormalizedPoint: {
        ...payload.probeNormalizedPoint
      },
      rawPredictionNormalizedPoint:
        payload.rawPredictionNormalizedPoint === null
          ? null
          : { ...payload.rawPredictionNormalizedPoint },
      authoritativeNormalizedPoint:
        payload.authoritativeNormalizedPoint === null
          ? null
          : { ...payload.authoritativeNormalizedPoint },
      stabilizedNormalizedPoint:
        payload.stabilizedNormalizedPoint === null
          ? null
          : { ...payload.stabilizedNormalizedPoint },
      coordinates: {
        ...storedCoordinates,
        viewportPoint: { ...storedCoordinates.viewportPoint },
        documentPoint: { ...storedCoordinates.documentPoint }
      },
      aoiProbeCoordinates: {
        ...payload.coordinates,
        viewportPoint: { ...payload.coordinates.viewportPoint },
        documentPoint: { ...payload.coordinates.documentPoint }
      },
      primaryAoiId: payload.hit.primaryAoiId,
      candidates: payload.hit.candidates.map((candidate) => ({ ...candidate }))
    });

    if (this.gazeBuffer.length >= STORAGE_BATCH.GAZE_MAX_ITEMS) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  public queueScroll(event: ScrollEventRecord): void {
    this.eventBuffer.push({
      recordId: createMessageId(),
      sessionId: event.sessionId,
      pageId: event.pageId,
      kind: "SCROLL",
      event: { ...event },
      capturedAtEpochMs: nowEpochMs()
    });

    if (this.eventBuffer.length >= STORAGE_BATCH.EVENT_MAX_ITEMS) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  public queueFixation(
    event: FixationEvent,
    peakSpeedPxPerSecond: number,
    enrichment: {
      readonly coordinates: PageCoordinateSnapshot;
      readonly primaryAoiId: string | null;
      readonly candidates: readonly AoiHitCandidate[];
    } | null = null
  ): void {
    const record: StoredFixationRecord = {
      recordId: event.fixationId,
      sessionId: event.sessionId,
      pageId: event.pageId,
      event: {
        ...event,
        centroidViewportPoint: { ...event.centroidViewportPoint }
      },
      peakSpeedPxPerSecond,
      capturedAtEpochMs: nowEpochMs(),
      coordinates:
        enrichment === null
          ? null
          : {
              ...enrichment.coordinates,
              viewportPoint: { ...enrichment.coordinates.viewportPoint },
              documentPoint: { ...enrichment.coordinates.documentPoint }
            },
      primaryAoiId:
        enrichment?.primaryAoiId ?? event.aoiId,
      candidates:
        enrichment?.candidates.map((candidate) => ({ ...candidate }))
        ?? []
    };

    const existingIndex = this.fixationBuffer.findIndex(
      (candidate) => candidate.recordId === record.recordId
    );

    if (existingIndex >= 0) {
      const existing = this.fixationBuffer[existingIndex];
      if (existing !== undefined) {
        const preferNew =
          record.coordinates !== null
          || existing.coordinates === null;

        this.fixationBuffer[existingIndex] =
          preferNew ? record : existing;
      }
    } else {
      this.fixationBuffer.push(record);
    }

    this.scheduleFlush();
  }

  public async upsertAoi(
    sessionId: SessionId,
    entries: readonly AoiRegistryEntry[],
    _removedAoiIds: readonly string[]
  ): Promise<void> {
    // Historical AOI metadata is intentionally retained even after a DOM node
    // disappears so earlier gaze rows can still be interpreted at export time.
    if (entries.length === 0) return;

    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.AOI_REGISTRY,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.AOI_REGISTRY);

    for (const entry of entries) {
      const record: StoredAoiRecord = {
        recordId: `${sessionId}::${entry.aoiId}`,
        sessionId,
        pageId: entry.pageId,
        entry: {
          ...entry,
          viewportRect: { ...entry.viewportRect },
          documentRect: { ...entry.documentRect }
        }
      };
      store.put(record);
    }

    await transactionDone(transaction);
  }

  public async recordNavigation(
    sessionId: SessionId,
    pageId: string,
    tabId: number,
    reason: TrackingContextChangeReason,
    url: string | null
  ): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.PAGE_EVENTS,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.PAGE_EVENTS);

    const record: StoredNavigationRecord = {
      recordId: createMessageId(),
      sessionId,
      pageId,
      tabId,
      kind: "NAVIGATION",
      reason,
      url,
      capturedAtEpochMs: nowEpochMs()
    };

    store.put(record);
    await transactionDone(transaction);
  }

  public async recordRuntimeDiagnostic(
    sessionId: SessionId,
    pageId: string | null,
    diagnostic: RuntimeQualityDiagnostic
  ): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.DIAGNOSTICS,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.DIAGNOSTICS);
    const record: StoredDiagnosticRecord = {
      recordId: createMessageId(),
      sessionId,
      pageId,
      kind: "RUNTIME_QUALITY",
      code: `LONGITUDINAL_${diagnostic.milestone}`,
      capturedAtEpochMs: nowEpochMs(),
      diagnostic: {
        ...diagnostic,
        driftStatus: diagnostic.driftStatus === null ? null : { ...diagnostic.driftStatus }
      },
      details: null
    };
    store.put(record);
    await transactionDone(transaction);
  }

  public async recordMaintenanceEvent(
    sessionId: SessionId,
    pageId: string | null,
    code: string,
    details: Readonly<Record<string, unknown>> | null
  ): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.DIAGNOSTICS,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.DIAGNOSTICS);
    const record: StoredDiagnosticRecord = {
      recordId: createMessageId(),
      sessionId,
      pageId,
      kind: "MAINTENANCE_EVENT",
      code,
      capturedAtEpochMs: nowEpochMs(),
      diagnostic: null,
      details
    };
    store.put(record);
    await transactionDone(transaction);
  }

  public async flush(): Promise<void> {
    if (this.flushPromise !== null) {
      await this.flushPromise;
      return;
    }

    this.clearFlushTimer();

    const gaze = this.gazeBuffer.splice(0);
    const events = this.eventBuffer.splice(0);
    const fixations = this.fixationBuffer.splice(0);

    if (gaze.length === 0 && events.length === 0 && fixations.length === 0) {
      return;
    }

    const operation = this.flushRecords(gaze, events, fixations);
    this.flushPromise = operation;

    try {
      await operation;
    } catch (error: unknown) {
      this.gazeBuffer.unshift(...gaze);
      this.eventBuffer.unshift(...events);
      this.fixationBuffer.unshift(...fixations);

      logger.error("IndexedDB batch flush failed.", {
        error: error instanceof Error ? error.message : "Unknown storage error",
        gazeCount: gaze.length,
        eventCount: events.length,
        fixationCount: fixations.length
      });

      throw error;
    } finally {
      this.flushPromise = null;
      if (
        this.gazeBuffer.length > 0
        || this.eventBuffer.length > 0
        || this.fixationBuffer.length > 0
      ) {
        this.scheduleFlush();
      }
    }
  }

  public async exportSession(
    sessionId: SessionId,
    format: "JSON" | "CSV"
  ): Promise<readonly ExportedTextFile[]> {
    await this.flush();

    const database = await this.getDatabase();
    const sessionTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readonly"
    );
    const sessionStore = sessionTransaction.objectStore(DATABASE.STORES.SESSIONS);
    const session = await requestResult(
      sessionStore.get(sessionId)
    ) as StoredSessionRecord | undefined;
    await transactionDone(sessionTransaction);

    if (session === undefined) {
      throw new Error(`No stored session exists for ${sessionId}.`);
    }

    const [gaze, fixations, scroll, navigation, aoiRegistry, diagnostics] = await Promise.all([
      getAllBySession<StoredGazeObservation>(
        database,
        DATABASE.STORES.GAZE_SAMPLES,
        sessionId
      ),
      getAllBySession<StoredFixationRecord>(
        database,
        DATABASE.STORES.FIXATION_EVENTS,
        sessionId
      ),
      getAllBySession<StoredScrollRecord>(
        database,
        DATABASE.STORES.INTERACTION_EVENTS,
        sessionId
      ),
      getAllBySession<StoredNavigationRecord>(
        database,
        DATABASE.STORES.PAGE_EVENTS,
        sessionId
      ),
      getAllBySession<StoredAoiRecord>(
        database,
        DATABASE.STORES.AOI_REGISTRY,
        sessionId
      ),
      getAllBySession<StoredDiagnosticRecord>(
        database,
        DATABASE.STORES.DIAGNOSTICS,
        sessionId
      )
    ]);

    gaze.sort((a, b) => a.timestampMs - b.timestampMs);
    fixations.sort((a, b) => a.event.startTimeMs - b.event.startTimeMs);
    scroll.sort((a, b) => a.event.timestampMs - b.event.timestampMs);
    navigation.sort((a, b) => a.capturedAtEpochMs - b.capturedAtEpochMs);
    diagnostics.sort((a, b) => a.capturedAtEpochMs - b.capturedAtEpochMs);

    const data: SessionExportData = {
      exportedAtEpochMs: nowEpochMs(),
      session,
      gaze,
      fixations,
      scroll,
      navigation,
      aoiRegistry,
      diagnostics
    };

    return buildSessionExportFiles(data, format);
  }

  private async getDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise === null) {
      this.databasePromise = openDatabase().catch((error: unknown) => {
        this.databasePromise = null;
        throw error;
      });
    }

    return this.databasePromise;
  }

  private scheduleFlush(): void {
    if (this.flushTimerId !== null) return;

    this.flushTimerId = setTimeout(() => {
      this.flushTimerId = null;
      void this.flush();
    }, STORAGE_BATCH.MAX_FLUSH_INTERVAL_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimerId === null) return;
    clearTimeout(this.flushTimerId);
    this.flushTimerId = null;
  }

  private async flushRecords(
    gaze: readonly StoredGazeObservation[],
    events: readonly StoredScrollRecord[],
    fixations: readonly StoredFixationRecord[]
  ): Promise<void> {
    const database = await this.getDatabase();
    const storeNames: string[] = [];

    if (gaze.length > 0) storeNames.push(DATABASE.STORES.GAZE_SAMPLES);
    if (events.length > 0) storeNames.push(DATABASE.STORES.INTERACTION_EVENTS);
    if (fixations.length > 0) storeNames.push(DATABASE.STORES.FIXATION_EVENTS);

    if (storeNames.length === 0) return;

    const transaction = database.transaction(storeNames, "readwrite");

    if (gaze.length > 0) {
      const store = transaction.objectStore(DATABASE.STORES.GAZE_SAMPLES);
      for (const record of gaze) store.put(record);
    }

    if (events.length > 0) {
      const store = transaction.objectStore(DATABASE.STORES.INTERACTION_EVENTS);
      for (const record of events) store.put(record);
    }

    if (fixations.length > 0) {
      const store = transaction.objectStore(DATABASE.STORES.FIXATION_EVENTS);
      for (const record of fixations) store.put(record);
    }

    await transactionDone(transaction);
  }
}

export const experimentStorage = new ExperimentStorage();
