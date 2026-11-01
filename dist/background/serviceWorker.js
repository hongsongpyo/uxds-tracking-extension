import {
  createLogger
} from "../chunks/chunk-ROMKNLNQ.js";
import {
  TRACKER_STATES,
  TrackerStateMachine
} from "../chunks/chunk-ZYYK23HD.js";
import {
  AOI,
  CALIBRATION,
  DATABASE,
  DRIFT_THRESHOLDS,
  ERROR_CODES,
  GAZE_ENGINE_DEFAULTS,
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  NAVIGATION,
  OFFSCREEN_RUNTIME,
  PAGE_TRACKING,
  SCHEMA_VERSION,
  STORAGE_BATCH,
  TRACKER_VERSION,
  TrackerError,
  createCalibrationId,
  createMessageId,
  createPageId,
  createRuntimeMessage,
  createSessionId,
  isCameraRequest,
  isCameraSettings,
  isCompatibleMessageProtocol,
  isFiniteNumber,
  isHttpOrHttpsUrl,
  isMessageType,
  isNullableFiniteNumber,
  isNullableString,
  isRecord,
  isTrackerErrorCode,
  normalizeTrackerError,
  nowEpochMs,
  sleep
} from "../chunks/chunk-6TH637DM.js";
import "../chunks/chunk-NRCRLAHV.js";

// src/shared/calibrationUiHandshake.ts
function isCalibrationUiReadyAcknowledgement(value, expectedCalibrationId, expectedSessionId, expectedPageId) {
  return isRecord(value) && isCompatibleMessageProtocol(value.protocolVersion) && value.type === MESSAGE_TYPES.CALIBRATION_UI_READY && isRecord(value.meta) && value.meta.source === "CONTENT" && value.meta.target === "BACKGROUND" && value.meta.sessionId === expectedSessionId && value.meta.pageId === expectedPageId && isRecord(value.payload) && value.payload.accepted === true && value.payload.calibrationId === expectedCalibrationId;
}

// src/background/messageRouter.ts
var logger = createLogger("BACKGROUND");
var RUNTIME_CONTEXT_VALUES = /* @__PURE__ */ new Set([
  "BACKGROUND",
  "OFFSCREEN",
  "CONTENT",
  "POPUP",
  "CAMERA_PERMISSION_UI",
  "CALIBRATION_UI",
  "BROADCAST"
]);
function isRuntimeContext(value) {
  return typeof value === "string" && RUNTIME_CONTEXT_VALUES.has(value);
}
function isMessageMeta(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.messageId !== "string" || value.messageId.length === 0) {
    return false;
  }
  if (!isFiniteNumber(
    value.sentAtEpochMs
  )) {
    return false;
  }
  if (!isRuntimeContext(
    value.source
  )) {
    return false;
  }
  if (!isRuntimeContext(
    value.target
  )) {
    return false;
  }
  if (!isNullableString(
    value.sessionId
  )) {
    return false;
  }
  if (!isNullableString(
    value.pageId
  )) {
    return false;
  }
  if (!isNullableFiniteNumber(
    value.tabId
  )) {
    return false;
  }
  if (!isNullableFiniteNumber(
    value.browserFrameId
  )) {
    return false;
  }
  return true;
}
function createRouterError(code, message, details = null) {
  return new TrackerError(
    code,
    "BACKGROUND",
    message,
    {
      details
    }
  ).toSerializable();
}
function parseRuntimeMessageEnvelope(value) {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: createRouterError(
        ERROR_CODES.INVALID_MESSAGE,
        "Runtime message must be a plain object."
      )
    };
  }
  if (!isCompatibleMessageProtocol(
    value.protocolVersion
  )) {
    return {
      ok: false,
      error: createRouterError(
        ERROR_CODES.INCOMPATIBLE_MESSAGE_PROTOCOL,
        "Runtime message protocol version is incompatible.",
        {
          receivedProtocolVersion: value.protocolVersion,
          expectedProtocolVersion: MESSAGE_PROTOCOL_VERSION
        }
      )
    };
  }
  if (!isMessageType(value.type)) {
    return {
      ok: false,
      error: createRouterError(
        ERROR_CODES.INVALID_MESSAGE,
        "Runtime message type is invalid.",
        {
          receivedType: value.type
        }
      )
    };
  }
  if (!isMessageMeta(value.meta)) {
    return {
      ok: false,
      error: createRouterError(
        ERROR_CODES.INVALID_MESSAGE,
        "Runtime message metadata is invalid.",
        {
          messageType: value.type
        }
      )
    };
  }
  return {
    ok: true,
    envelope: {
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      type: value.type,
      meta: value.meta,
      payload: value.payload
    }
  };
}
function validateSenderConsistency(envelope, context) {
  if (envelope.meta.source !== "CONTENT") {
    return null;
  }
  if (context.senderTabId !== null && envelope.meta.tabId !== null && context.senderTabId !== envelope.meta.tabId) {
    return createRouterError(
      ERROR_CODES.INVALID_MESSAGE,
      "Content message tab ID does not match its Chrome sender.",
      {
        messageTabId: envelope.meta.tabId,
        senderTabId: context.senderTabId,
        messageType: envelope.type
      }
    );
  }
  if (context.senderFrameId !== null && envelope.meta.browserFrameId !== null && context.senderFrameId !== envelope.meta.browserFrameId) {
    return createRouterError(
      ERROR_CODES.INVALID_MESSAGE,
      "Content message frame ID does not match its Chrome sender.",
      {
        messageFrameId: envelope.meta.browserFrameId,
        senderFrameId: context.senderFrameId,
        messageType: envelope.type
      }
    );
  }
  return null;
}
function isEmptyPayload(payload) {
  return isRecord(payload) && Object.keys(payload).length === 0;
}
function isPingPayload(payload) {
  return isRecord(payload) && typeof payload.nonce === "string" && payload.nonce.length > 0;
}
function isPongPayload(payload) {
  return isRecord(payload) && typeof payload.nonce === "string" && payload.nonce.length > 0;
}
var MessageRouter = class {
  routes = /* @__PURE__ */ new Map();
  /**
   * Registers one type-safe message route.
   *
   * Every route requires:
   *
   * 1. message type,
   * 2. runtime payload validator,
   * 3. typed handler.
   *
   * Duplicate registrations are rejected.
   */
  register(type, validatePayload, handler) {
    if (this.routes.has(type)) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "BACKGROUND",
        `A handler for ${type} is already registered.`,
        {
          recoverable: false,
          details: {
            type
          }
        }
      );
    }
    const route = {
      execute: async (envelope, context) => {
        if (envelope.type !== type) {
          throw new TrackerError(
            ERROR_CODES.INVALID_MESSAGE,
            "BACKGROUND",
            "Message route type mismatch.",
            {
              recoverable: false,
              details: {
                expectedType: type,
                receivedType: envelope.type
              }
            }
          );
        }
        if (!validatePayload(
          envelope.payload
        )) {
          throw new TrackerError(
            ERROR_CODES.INVALID_MESSAGE,
            "BACKGROUND",
            `Invalid payload for message ${type}.`,
            {
              details: {
                type
              }
            }
          );
        }
        const message = {
          protocolVersion: envelope.protocolVersion,
          type,
          meta: envelope.meta,
          payload: envelope.payload
        };
        return handler(
          message,
          context
        );
      }
    };
    this.routes.set(
      type,
      route
    );
    logger.debug(
      "Message route registered.",
      {
        type
      }
    );
  }
  /**
   * Removes a previously registered route.
   *
   * Mainly useful for tests or controlled runtime reconfiguration.
   */
  unregister(type) {
    return this.routes.delete(type);
  }
  hasHandler(type) {
    return this.routes.has(type);
  }
  /**
   * Validates and dispatches one incoming Chrome runtime message.
   *
   * Unknown/unregistered message types are not treated as fatal errors.
   * The service worker may decide to forward them to another runtime context.
   */
  async route(rawMessage, context) {
    const parsed = parseRuntimeMessageEnvelope(
      rawMessage
    );
    if (!parsed.ok) {
      logger.warn(
        "Rejected invalid runtime message.",
        {
          code: parsed.error.code,
          message: parsed.error.message
        }
      );
      return {
        ok: false,
        handled: false,
        error: parsed.error
      };
    }
    const senderError = validateSenderConsistency(
      parsed.envelope,
      context
    );
    if (senderError !== null) {
      logger.warn(
        "Rejected runtime message with inconsistent sender metadata.",
        {
          code: senderError.code,
          messageType: parsed.envelope.type
        }
      );
      return {
        ok: false,
        handled: false,
        error: senderError
      };
    }
    const route = this.routes.get(
      parsed.envelope.type
    );
    if (route === void 0) {
      logger.debug(
        "No local handler registered for runtime message.",
        {
          type: parsed.envelope.type,
          target: parsed.envelope.meta.target
        }
      );
      return {
        ok: true,
        handled: false,
        response: null
      };
    }
    try {
      const response = await route.execute(
        parsed.envelope,
        context
      );
      return {
        ok: true,
        handled: true,
        response
      };
    } catch (error) {
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.UNKNOWN,
        "BACKGROUND",
        "Runtime message handler failed.",
        {
          details: {
            messageType: parsed.envelope.type,
            messageId: parsed.envelope.meta.messageId
          }
        }
      );
      logger.error(
        "Runtime message handler failed.",
        {
          code: normalized.code,
          messageType: parsed.envelope.type,
          recoverable: normalized.recoverable
        }
      );
      return {
        ok: false,
        handled: false,
        error: normalized.toSerializable()
      };
    }
  }
};
var messageRouter = new MessageRouter();

// src/background/backgroundMessageTarget.ts
function isMessageForBackground(rawMessage) {
  if (!isRecord(rawMessage)) {
    return true;
  }
  if (typeof rawMessage.type === "string" && rawMessage.type.startsWith("UXDS_")) {
    return false;
  }
  const meta = rawMessage.meta;
  if (!isRecord(meta)) {
    return true;
  }
  const target = meta.target;
  if (typeof target !== "string") {
    return true;
  }
  return target === "BACKGROUND" || target === "BROADCAST";
}

// src/background/uxdsServerIds.js
var UXDS_SESSION_ID_RE = /^session_\d{13}_[a-z0-9]{8}$/;
var UXDS_PAGE_VIEW_ID_RE = /^pv_\d{13}_[a-z0-9]{8}$/;
function isUxdsServerSessionId(value) {
  return typeof value === "string" && UXDS_SESSION_ID_RE.test(value);
}
function isUxdsServerPageViewId(value) {
  return typeof value === "string" && UXDS_PAGE_VIEW_ID_RE.test(value);
}
function randomSuffix() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}
function makeUxdsServerSessionId(time = Date.now()) {
  return `session_${Math.trunc(time)}_${randomSuffix()}`;
}
function makeUxdsServerPageViewId(time = Date.now()) {
  return `pv_${Math.trunc(time)}_${randomSuffix()}`;
}
function isLegacyEyeSessionId(value) {
  return typeof value === "string" && /^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function isLegacyEyePageId(value) {
  return typeof value === "string" && /^page_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function toUxdsUploadEvent(event, sessionId, pageViewId = null) {
  const updated = { ...event, session_id: sessionId };
  if (pageViewId !== null) {
    if (typeof event.page_view_id === "string") updated.page_view_id = pageViewId;
    if (typeof event.page_id === "string") updated.page_id = pageViewId;
  }
  return updated;
}

// src/background/uxdsMouseBridge.js
var UXDS_CONFIG = Object.freeze({
  SUPABASE_URL: "https://exburxzvshqhhqbmhesr.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e1e1N_PzU3N7w0C9p0EdQg_Rb8DRRv2",
  VALIDATE_PROJECT_URL: "https://exburxzvshqhhqbmhesr.supabase.co/functions/v1/validate-project",
  INGEST_MOUSE_EVENTS_URL: "https://exburxzvshqhhqbmhesr.supabase.co/functions/v1/ingest-mouse-events",
  INGEST_EYE_EVENTS_URL: "https://exburxzvshqhhqbmhesr.supabase.co/functions/v1/ingest-eye-events"
});
var UPLOAD_RETRY_ALARM = "uxds-upload-retry";
var UPLOAD_RETRY_MINUTES = 1;
var MAX_PENDING_EVENTS = 2e4;
var DEFAULT_STATE = Object.freeze({
  isTracking: false,
  sessionId: null,
  projectId: null,
  projectName: null,
  projectConnectedAt: null,
  trackedTabIds: [],
  pendingUploadBatches: [],
  lastUploadAt: null,
  lastUploadError: null,
  uxdsArmed: false,
  eyeUploadQueue: []
});
var eyePageIdsByTab = /* @__PURE__ */ new Map();
var uploadFlushPromise = null;
var storageWriteLock = Promise.resolve();
var UPLOAD_ID_ALIASES_KEY = "uxdsUploadIdAliasesV1";
async function getUploadAlias(originalId, kind, eventTime) {
  if (kind === "session" && isUxdsServerSessionId(originalId)) return originalId;
  if (kind === "page" && isUxdsServerPageViewId(originalId)) return originalId;
  const legacyKnown = kind === "session" ? isLegacyEyeSessionId(originalId) : isLegacyEyePageId(originalId);
  if (!legacyKnown) {
    throw new Error(`Unknown ${kind} ID format in the saved UXDS upload queue: ${String(originalId).slice(0, 120)}`);
  }
  return withStorageWriteLock(async () => {
    const stored = await chrome.storage.local.get(UPLOAD_ID_ALIASES_KEY);
    const aliases = stored[UPLOAD_ID_ALIASES_KEY] || {};
    const key = `${kind}:${originalId}`;
    if (typeof aliases[key] === "string") return aliases[key];
    const time = Number.isFinite(eventTime) && eventTime >= 15e11 ? Math.trunc(eventTime) : Date.now();
    const alias = kind === "session" ? makeUxdsServerSessionId(time) : makeUxdsServerPageViewId(time);
    await chrome.storage.local.set({
      [UPLOAD_ID_ALIASES_KEY]: { ...aliases, [key]: alias }
    });
    return alias;
  });
}
async function makeServerUploadBatch(batch) {
  const sessionId = await getUploadAlias(
    batch.session_id,
    "session",
    batch.events?.[0]?.timestamp ?? batch.queuedAt
  );
  const pageIds = /* @__PURE__ */ new Map();
  for (const event of batch.events) {
    const pageId = typeof event.page_view_id === "string" ? event.page_view_id : typeof event.page_id === "string" ? event.page_id : null;
    if (pageId && !pageIds.has(pageId)) {
      const normalized = await getUploadAlias(pageId, "page", event.timestamp);
      pageIds.set(pageId, normalized);
    }
  }
  return {
    project_id: batch.project_id,
    session_id: sessionId,
    events: batch.events.map((event) => {
      const pageId = typeof event.page_view_id === "string" ? event.page_view_id : typeof event.page_id === "string" ? event.page_id : null;
      return toUxdsUploadEvent(event, sessionId, pageId ? pageIds.get(pageId) : null);
    })
  };
}
function generateEventId(prefix = "evt") {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}
function generateBatchId() {
  return generateEventId("batch");
}
function normalizeProjectId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function isValidProjectIdFormat(projectId) {
  return /^prj_[0-9a-f]{12}$/.test(projectId);
}
function getPendingUploadEventCount(state) {
  return (state.pendingUploadBatches || []).reduce(
    (total, batch) => total + (Array.isArray(batch?.events) ? batch.events.length : 0),
    0
  );
}
function withStorageWriteLock(task) {
  const run = storageWriteLock.then(task, task);
  storageWriteLock = run.catch(() => void 0);
  return run;
}
async function getState() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return {
    isTracking: stored.isTracking ?? DEFAULT_STATE.isTracking,
    sessionId: stored.sessionId ?? DEFAULT_STATE.sessionId,
    projectId: stored.projectId ?? DEFAULT_STATE.projectId,
    projectName: stored.projectName ?? DEFAULT_STATE.projectName,
    projectConnectedAt: stored.projectConnectedAt ?? DEFAULT_STATE.projectConnectedAt,
    trackedTabIds: Array.isArray(stored.trackedTabIds) ? stored.trackedTabIds.filter((value) => Number.isInteger(value)) : [],
    pendingUploadBatches: Array.isArray(stored.pendingUploadBatches) ? stored.pendingUploadBatches : [],
    lastUploadAt: stored.lastUploadAt ?? DEFAULT_STATE.lastUploadAt,
    lastUploadError: stored.lastUploadError ?? DEFAULT_STATE.lastUploadError,
    uxdsArmed: stored.uxdsArmed ?? DEFAULT_STATE.uxdsArmed,
    eyeUploadQueue: Array.isArray(stored.eyeUploadQueue) ? stored.eyeUploadQueue : []
  };
}
function toPublicState(state) {
  return {
    isTracking: state.isTracking,
    uxdsArmed: state.uxdsArmed,
    sessionId: state.sessionId,
    projectId: state.projectId,
    projectName: state.projectName,
    projectConnectedAt: state.projectConnectedAt,
    trackedTabIds: [...state.trackedTabIds],
    lastUploadAt: state.lastUploadAt,
    lastUploadError: state.lastUploadError,
    pendingUploadEventCount: getPendingUploadEventCount(state),
    eyePendingEventCount: state.eyeUploadQueue.reduce((n, b) => n + b.events.length, 0)
  };
}
async function patchState(partialState) {
  await chrome.storage.local.set(partialState);
  return getState();
}
async function initializeStorage() {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const missing = {};
  for (const [key, defaultValue] of Object.entries(DEFAULT_STATE)) {
    if (typeof existing[key] === "undefined") {
      missing[key] = defaultValue;
    }
  }
  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }
  await chrome.alarms.create(UPLOAD_RETRY_ALARM, {
    periodInMinutes: UPLOAD_RETRY_MINUTES
  });
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs?.[0] ?? null;
}
function isTrackableUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  return url.startsWith("http://") || url.startsWith("https://");
}
function buildSessionBoundaryEvent(eventType, { sessionId, projectId, tab = null }) {
  return {
    event_id: generateEventId(eventType),
    project_id: projectId,
    session_id: sessionId,
    page_view_id: null,
    event_type: eventType,
    timestamp: Date.now(),
    page_url: tab?.url || null,
    page_title: tab?.title || null,
    source: "background"
  };
}
async function sendMessageToTab(tabId, message) {
  if (!Number.isInteger(tabId)) {
    return {
      success: false,
      error: "\uC720\uD6A8\uD55C \uD0ED\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."
    };
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return {
      success: true,
      data: response
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "content script\uC640 \uD1B5\uC2E0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."
    };
  }
}
async function validateProject(projectId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!isValidProjectIdFormat(normalizedProjectId)) {
    return {
      success: false,
      error: "Project ID \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
    };
  }
  try {
    const response = await fetch(UXDS_CONFIG.VALIDATE_PROJECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify({ projectId: normalizedProjectId }),
      cache: "no-store"
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || !data?.valid || !data?.project?.id) {
      return {
        success: false,
        error: data?.error || `\uD504\uB85C\uC81D\uD2B8 \uD655\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. (${response.status})`
      };
    }
    return {
      success: true,
      projectId: data.project.id,
      projectName: data.project.name || "\uC774\uB984 \uC5C6\uB294 \uD504\uB85C\uC81D\uD2B8"
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "UXDS \uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC778\uD130\uB137 \uC5F0\uACB0\uACFC API \uBC30\uD3EC \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694."
    };
  }
}
async function connectProject(projectId) {
  const current = await getState();
  if (current.isTracking || current.uxdsArmed) {
    return {
      success: false,
      error: "\uC218\uC9D1 \uC911\uC5D0\uB294 \uD504\uB85C\uC81D\uD2B8\uB97C \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 \uC218\uC9D1\uC744 \uC911\uC9C0\uD558\uC138\uC694."
    };
  }
  const validation = await validateProject(projectId);
  if (!validation.success) {
    return validation;
  }
  const state = await patchState({
    projectId: validation.projectId,
    projectName: validation.projectName,
    projectConnectedAt: Date.now()
  });
  return {
    success: true,
    ...toPublicState(state)
  };
}
async function disconnectProject() {
  const current = await getState();
  if (current.isTracking || current.uxdsArmed) {
    return {
      success: false,
      error: "\uC218\uC9D1 \uC911\uC5D0\uB294 \uD504\uB85C\uC81D\uD2B8 \uC5F0\uACB0\uC744 \uD574\uC81C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 \uC218\uC9D1\uC744 \uC911\uC9C0\uD558\uC138\uC694."
    };
  }
  if (getPendingUploadEventCount(current) > 0 || current.eyeUploadQueue.length > 0) {
    return {
      success: false,
      error: "\uC544\uC9C1 \uC11C\uBC84 \uC804\uC1A1 \uB300\uAE30 \uC911\uC778 \uB370\uC774\uD130\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uC804\uC1A1\uC774 \uB05D\uB09C \uB4A4 \uC5F0\uACB0\uC744 \uD574\uC81C\uD558\uC138\uC694."
    };
  }
  const state = await patchState({
    projectId: null,
    projectName: null,
    projectConnectedAt: null,
    trackedTabIds: [],
    uxdsArmed: false
  });
  return {
    success: true,
    ...toPublicState(state)
  };
}
async function enqueueUploadBatch(payload) {
  if (!payload || !Array.isArray(payload.events) || payload.events.length === 0) {
    return {
      success: false,
      error: "\uC804\uC1A1\uD560 \uC774\uBCA4\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."
    };
  }
  return withStorageWriteLock(async () => {
    const current = await getState();
    if (!current.projectId) {
      return {
        success: false,
        error: "\uC5F0\uACB0\uB41C Project ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."
      };
    }
    if (!current.isTracking || payload.session_id !== current.sessionId) {
      return { success: false, error: "\uD65C\uC131 \uC138\uC158\uACFC \uC77C\uCE58\uD558\uC9C0 \uC54A\uB294 \uC774\uBCA4\uD2B8\uC785\uB2C8\uB2E4." };
    }
    if (payload.project_id !== current.projectId) {
      return {
        success: false,
        error: "\uD604\uC7AC \uC5F0\uACB0\uB41C \uD504\uB85C\uC81D\uD2B8\uC640 \uC774\uBCA4\uD2B8\uC758 Project ID\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
      };
    }
    const currentPendingCount = getPendingUploadEventCount(current);
    const nextPendingCount = currentPendingCount + payload.events.length;
    if (nextPendingCount > MAX_PENDING_EVENTS) {
      return {
        success: false,
        error: `\uC11C\uBC84 \uC804\uC1A1 \uB300\uAE30 \uB370\uC774\uD130\uAC00 ${MAX_PENDING_EVENTS}\uAC1C\uB97C \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4. \uC778\uD130\uB137 \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC138\uC694.`
      };
    }
    const batch = {
      batchId: generateBatchId(),
      project_id: payload.project_id,
      session_id: payload.session_id,
      events: payload.events,
      queuedAt: Date.now(),
      attempts: 0
    };
    await chrome.storage.local.set({
      pendingUploadBatches: [...current.pendingUploadBatches, batch]
    });
    return {
      success: true,
      queued: payload.events.length,
      pendingUploadEventCount: nextPendingCount
    };
  }).then((result) => {
    if (result.success) {
      void flushPendingUploads();
    }
    return result;
  });
}
async function postBatchToUxds(batch) {
  const upload = await makeServerUploadBatch(batch);
  const response = await fetch(UXDS_CONFIG.INGEST_MOUSE_EVENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify(upload),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || `UXDS \uC218\uC9D1 API \uC751\uB2F5 \uC624\uB958: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
async function flushPendingUploadsInternal() {
  while (true) {
    const current = await getState();
    const firstBatch = current.pendingUploadBatches[0];
    if (!firstBatch) {
      return {
        success: true,
        pendingUploadEventCount: 0
      };
    }
    try {
      await postBatchToUxds(firstBatch);
      await withStorageWriteLock(async () => {
        const latest = await getState();
        const remaining = latest.pendingUploadBatches.filter(
          (batch) => batch.batchId !== firstBatch.batchId
        );
        await chrome.storage.local.set({
          pendingUploadBatches: remaining,
          lastUploadAt: Date.now(),
          lastUploadError: null
        });
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 429 || status >= 500;
      const errorMessage = error?.message || "UXDS \uC11C\uBC84 \uC804\uC1A1\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.";
      await withStorageWriteLock(async () => {
        const latest = await getState();
        const updatedBatches = latest.pendingUploadBatches.map(
          (batch) => batch.batchId === firstBatch.batchId ? {
            ...batch,
            attempts: Number(batch.attempts || 0) + 1,
            lastAttemptAt: Date.now(),
            lastError: errorMessage,
            lastHttpStatus: status || null,
            retryable
          } : batch
        );
        await chrome.storage.local.set({
          pendingUploadBatches: updatedBatches,
          lastUploadError: errorMessage
        });
      });
      if (!retryable) {
        console.error(
          `[background] \uC5C5\uB85C\uB4DC\uAC00 \uAC70\uBD80\uB418\uC5C8\uC2B5\uB2C8\uB2E4(${status}). \uB370\uC774\uD130\uB294 \uC0AD\uC81C\uD558\uC9C0 \uC54A\uACE0 outbox\uC5D0 \uBCF4\uC874\uD569\uB2C8\uB2E4:`,
          errorMessage
        );
      } else {
        console.warn("[background] UXDS \uC5C5\uB85C\uB4DC \uC7AC\uC2DC\uB3C4 \uB300\uAE30:", errorMessage);
      }
      const failedState = await getState();
      return {
        success: false,
        error: errorMessage,
        pendingUploadEventCount: getPendingUploadEventCount(failedState)
      };
    }
  }
}
function flushPendingUploads() {
  if (uploadFlushPromise) {
    return uploadFlushPromise;
  }
  uploadFlushPromise = flushPendingUploadsInternal().finally(() => {
    uploadFlushPromise = null;
  });
  return uploadFlushPromise;
}
async function startTracking(sharedSessionId, researchTabId, eyePageId = null) {
  const current = await getState();
  if (current.isTracking) {
    return current.sessionId === sharedSessionId ? { success: true, ...toPublicState(current) } : { success: false, error: "\uB2E4\uB978 \uC138\uC158\uC774 \uC774\uBBF8 \uC218\uC9D1 \uC911\uC785\uB2C8\uB2E4." };
  }
  if (!current.uxdsArmed) return { success: false, error: "\uC218\uC9D1\uC774 \uD65C\uC131\uD654\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." };
  if (!current.projectId) {
    return {
      success: false,
      error: "\uBA3C\uC800 UXDS Project ID\uB97C \uC5F0\uACB0\uD558\uC138\uC694."
    };
  }
  const validatedProjectId = current.projectId;
  const activeTab = Number.isInteger(researchTabId) ? await chrome.tabs.get(researchTabId).catch(() => null) : await getActiveTab();
  if (!activeTab?.id || !isTrackableUrl(activeTab.url)) {
    return {
      success: false,
      error: "http/https \uC6F9\uD398\uC774\uC9C0\uC5D0\uC11C\uB9CC \uC218\uC9D1\uC744 \uC2DC\uC791\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
    };
  }
  const sessionId = sharedSessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    return { success: false, error: "\uC2DC\uC120 \uCD94\uC801 \uC138\uC158 ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." };
  }
  await patchState({
    isTracking: true,
    sessionId,
    projectId: validatedProjectId,
    projectName: current.projectName,
    trackedTabIds: [activeTab.id],
    lastUploadError: null
  });
  const sessionStartResult = await enqueueUploadBatch({
    project_id: validatedProjectId,
    session_id: sessionId,
    events: [
      buildSessionBoundaryEvent("session_start", {
        sessionId,
        projectId: validatedProjectId,
        tab: activeTab
      })
    ]
  });
  if (!sessionStartResult.success) {
    console.warn("[background] session_start queue \uC2E4\uD328:", sessionStartResult.error);
  }
  const contentResult = await sendMessageToTab(activeTab.id, {
    type: "UXDS_MOUSE_START",
    sessionId,
    projectId: validatedProjectId,
    pageViewId: eyePageId
  });
  if (!contentResult.success || contentResult.data?.success !== true) {
    const reason = contentResult.error || contentResult.data?.error || "Content Script did not acknowledge mouse activation.";
    await patchState({ isTracking: false, sessionId: null, trackedTabIds: [], lastUploadError: reason });
    return { success: false, error: reason };
  }
  collectingSessionId = sessionId;
  const state = await getState();
  return {
    success: true,
    ...toPublicState(state)
  };
}
async function stopTracking() {
  const current = await getState();
  if (!current.isTracking) {
    collectingSessionId = null;
    eyePageIdsByTab.clear();
    const state2 = await patchState({ uxdsArmed: false });
    return { success: true, ...toPublicState(state2) };
  }
  await drainEyeBuffer();
  collectingSessionId = null;
  eyePageIdsByTab.clear();
  const tabIds = [...new Set(current.trackedTabIds)];
  await Promise.all(
    tabIds.map(
      (tabId) => sendMessageToTab(tabId, {
        type: "UXDS_MOUSE_STOP",
        sessionId: current.sessionId
      })
    )
  );
  const previousSessionId = current.sessionId;
  const previousProjectId = current.projectId;
  if (previousSessionId && previousProjectId) {
    const sessionEndResult = await enqueueUploadBatch({
      project_id: previousProjectId,
      session_id: previousSessionId,
      events: [
        buildSessionBoundaryEvent("session_end", {
          sessionId: previousSessionId,
          projectId: previousProjectId
        })
      ]
    });
    if (!sessionEndResult.success) {
      console.warn("[background] session_end queue \uC2E4\uD328:", sessionEndResult.error);
    }
  }
  const state = await patchState({
    isTracking: false,
    sessionId: null,
    trackedTabIds: [],
    uxdsArmed: false
  });
  void flushPendingUploads();
  return {
    success: true,
    previousSessionId,
    ...toPublicState(state)
  };
}
async function registerContentTab(sender) {
  const state = await getState();
  const tab = sender?.tab;
  if (!state.isTracking || !state.sessionId || !state.projectId || !tab?.id) {
    return {
      success: true,
      shouldTrack: false,
      ...toPublicState(state)
    };
  }
  const tabId = tab.id;
  const openerTabId = tab.openerTabId;
  const alreadyTracked = state.trackedTabIds.includes(tabId);
  const openedFromTrackedTab = Number.isInteger(openerTabId) && state.trackedTabIds.includes(openerTabId);
  if (!alreadyTracked && !openedFromTrackedTab) {
    return {
      success: true,
      shouldTrack: false,
      ...toPublicState(state)
    };
  }
  if (!alreadyTracked) {
    await patchState({
      trackedTabIds: [.../* @__PURE__ */ new Set([...state.trackedTabIds, tabId])]
    });
  }
  const latest = await getState();
  return {
    success: true,
    shouldTrack: true,
    isTracking: true,
    sessionId: latest.sessionId,
    projectId: latest.projectId,
    projectName: latest.projectName,
    pendingUploadEventCount: getPendingUploadEventCount(latest),
    pageViewId: eyePageIdsByTab.get(tabId) ?? null
  };
}
chrome.runtime.onInstalled.addListener(() => {
  initializeStorage().then(() => Promise.all([flushPendingUploads(), flushPendingEyeUploads()])).catch((error) => {
    console.error("[background] \uCD08\uAE30 \uC800\uC7A5\uC18C \uC124\uC815 \uC2E4\uD328:", error);
  });
});
chrome.runtime.onStartup.addListener(() => {
  initializeStorage().then(() => Promise.all([flushPendingUploads(), flushPendingEyeUploads()])).catch((error) => {
    console.error("[background] \uC2DC\uC791 \uC0C1\uD0DC \uBCF5\uC6D0 \uC2E4\uD328:", error);
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_RETRY_ALARM) {
    void flushPendingUploads();
    void flushPendingEyeUploads();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  eyePageIdsByTab.delete(tabId);
  (async () => {
    const state = await getState();
    if (!state.trackedTabIds.includes(tabId)) {
      return;
    }
    await patchState({
      trackedTabIds: state.trackedTabIds.filter((id) => id !== tabId)
    });
  })().catch((error) => {
    console.error("[background] \uD0ED \uC0C1\uD0DC \uC815\uB9AC \uC2E4\uD328:", error);
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || !message.type.startsWith("UXDS_") || message.type === "UXDS_ARM_COLLECTION" || message.type === "UXDS_DISARM_COLLECTION") return false;
  (async () => {
    try {
      switch (message.type) {
        case "UXDS_CONNECT_PROJECT":
          sendResponse(await connectProject(message.projectId));
          break;
        case "UXDS_DISCONNECT_PROJECT":
          sendResponse(await disconnectProject());
          break;
        case "UXDS_GET_TRACKING_STATE": {
          const state = await getState();
          sendResponse({
            success: true,
            ...toPublicState(state)
          });
          break;
        }
        case "UXDS_CONTENT_READY":
          sendResponse(await registerContentTab(sender));
          break;
        case "UXDS_QUEUE_EVENTS": {
          const current = await getState();
          if (!sender.tab?.id || !current.trackedTabIds.includes(sender.tab.id)) {
            sendResponse({ success: false, error: "\uB4F1\uB85D\uB418\uC9C0 \uC54A\uC740 \uD0ED\uC785\uB2C8\uB2E4." });
          } else {
            sendResponse(await enqueueUploadBatch(message.payload));
          }
          break;
        }
        case "UXDS_RETRY_UPLOAD": {
          const result = await Promise.all([flushPendingUploads(), flushPendingEyeUploads()]);
          const state = await getState();
          sendResponse({
            success: result.every((r) => r.success),
            ...toPublicState(state)
          });
          break;
        }
        default:
          return;
      }
    } catch (error) {
      console.error("[background] \uBA54\uC2DC\uC9C0 \uCC98\uB9AC \uC2E4\uD328:", error);
      sendResponse({
        success: false,
        error: error.message || "background \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4."
      });
    }
  })();
  return true;
});
initializeStorage().then(() => Promise.all([flushPendingUploads(), flushPendingEyeUploads()])).catch((error) => {
  console.error("[background] \uC800\uC7A5\uC18C \uCD08\uAE30\uD654 \uC2E4\uD328:", error);
});
async function uxdsGetState() {
  return { success: true, ...toPublicState(await getState()) };
}
async function uxdsArmCollection() {
  const current = await getState();
  if (current.isTracking || !current.projectId) {
    return { success: false, error: "\uD504\uB85C\uC81D\uD2B8 \uC5F0\uACB0 \uD6C4 \uC218\uC9D1\uC744 \uC2DC\uC791\uD558\uC138\uC694.", ...toPublicState(current) };
  }
  const validation = await validateProject(current.projectId);
  if (!validation.success) return validation;
  const state = await patchState({ uxdsArmed: true, projectName: validation.projectName });
  return { success: true, ...toPublicState(state) };
}
async function uxdsActivateForEyeSession(sessionId, tabId, pageId) {
  if (pageId) eyePageIdsByTab.set(tabId, pageId);
  return startTracking(sessionId, tabId, pageId);
}
function uxdsSyncPageContext(tabId, pageId, sessionId) {
  if (!Number.isInteger(tabId) || !pageId) return;
  eyePageIdsByTab.set(tabId, pageId);
  if (!uxdsIsCollecting(sessionId)) return;
  void sendMessageToTab(tabId, {
    type: "UXDS_MOUSE_PAGE_CHANGED",
    sessionId,
    pageViewId: pageId
  });
}
async function uxdsStopForEye() {
  await drainEyeBuffer();
  return stopTracking();
}
var collectingSessionId = null;
var eyeBuffer = [];
var eyeBufferTimer = null;
var eyeFlushPromise = null;
var MAX_EYE_PENDING_EVENTS = 2e4;
function uxdsIsCollecting(sessionId) {
  return collectingSessionId === sessionId;
}
function uxdsQueueGazeEvent(event) {
  if (collectingSessionId === null || event?.session_id !== collectingSessionId) return;
  if (!event?.event_id || !Number.isFinite(event?.timestamp)) return;
  eyeBuffer.push(event);
  if (eyeBuffer.length >= 25) {
    void drainEyeBuffer();
  } else if (eyeBufferTimer === null) {
    eyeBufferTimer = setTimeout(() => {
      eyeBufferTimer = null;
      void drainEyeBuffer();
    }, 1500);
  }
}
async function drainEyeBuffer() {
  if (eyeFlushPromise) {
    await eyeFlushPromise;
    return;
  }
  if (eyeBufferTimer !== null) {
    clearTimeout(eyeBufferTimer);
    eyeBufferTimer = null;
  }
  if (!eyeBuffer.length) return;
  const events = eyeBuffer.splice(0);
  eyeFlushPromise = withStorageWriteLock(async () => {
    const state = await getState();
    if (!state.projectId || !state.sessionId || state.sessionId !== events[0].session_id) return;
    const count = state.eyeUploadQueue.reduce((n, b) => n + b.events.length, 0);
    if (count + events.length > MAX_EYE_PENDING_EVENTS) {
      eyeBuffer.unshift(...events);
      await chrome.storage.local.set({ lastUploadError: "\uC2DC\uC120 \uC804\uC1A1 \uB300\uAE30 \uD55C\uB3C4 \uCD08\uACFC: \uB370\uC774\uD130\uB294 \uB85C\uCEEC \uC2E4\uD5D8 DB\uC5D0\uC11C\uB3C4 \uBCF4\uC874\uB429\uB2C8\uB2E4. UXDS \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC138\uC694." });
      return;
    }
    await chrome.storage.local.set({ eyeUploadQueue: [...state.eyeUploadQueue, {
      batchId: generateBatchId(),
      project_id: state.projectId,
      session_id: state.sessionId,
      events,
      queuedAt: Date.now(),
      attempts: 0
    }] });
  }).finally(() => {
    eyeFlushPromise = null;
  });
  await eyeFlushPromise;
  void flushPendingEyeUploads();
}
async function flushPendingEyeUploads() {
  if (eyeFlushPromise !== null) await eyeFlushPromise;
  if (eyeUploadPromise !== null) return eyeUploadPromise;
  eyeUploadPromise = flushEyeInternal().finally(() => {
    eyeUploadPromise = null;
  });
  return eyeUploadPromise;
}
var eyeUploadPromise = null;
async function flushEyeInternal() {
  while (true) {
    const state = await getState();
    const batch = state.eyeUploadQueue[0];
    if (!batch) return { success: true };
    try {
      const upload = await makeServerUploadBatch(batch);
      const response = await fetch(UXDS_CONFIG.INGEST_EYE_EVENTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify(upload),
        cache: "no-store"
      });
      if (!response.ok) {
        let message = `\uC2DC\uC120 API HTTP ${response.status}`;
        const data = await response.json().catch(() => null);
        if (data !== null && typeof data?.error === "string") {
          message = data.error;
        }
        throw new Error(message);
      }
      await withStorageWriteLock(async () => {
        const latest = await getState();
        await chrome.storage.local.set({
          eyeUploadQueue: latest.eyeUploadQueue.filter((b) => b.batchId !== batch.batchId),
          lastUploadAt: Date.now(),
          lastUploadError: null
        });
      });
    } catch (error) {
      await chrome.storage.local.set({ lastUploadError: `\uC2DC\uC120 \uC5C5\uB85C\uB4DC \uC2E4\uD328: ${error?.message || error}` });
      return { success: false, error: String(error?.message || error) };
    }
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "UXDS_ARM_COLLECTION" && message?.type !== "UXDS_DISARM_COLLECTION") return false;
  const task = message.type === "UXDS_ARM_COLLECTION" ? uxdsArmCollection() : patchState({ uxdsArmed: false }).then((state) => ({ success: true, ...toPublicState(state) }));
  void task.then(sendResponse).catch((e) => sendResponse({ success: false, error: String(e) }));
  return true;
});

// src/background/sessionManager.ts
var logger2 = createLogger("BACKGROUND");
function getExtensionVersion() {
  return chrome.runtime.getManifest().version;
}
function cloneSessionRecord(session) {
  return {
    ...session,
    browser: {
      ...session.browser
    },
    screen: {
      ...session.screen
    },
    camera: session.camera === null ? null : {
      ...session.camera
    }
  };
}
var SessionManager = class {
  activeSession = null;
  lastCompletedSession = null;
  /**
   * Starts one experiment session.
   *
   * Only one authoritative experiment session may be active at a time.
   */
  startSession(input, startedAtEpochMs = Date.now()) {
    if (this.activeSession !== null) {
      logger2.warn(
        "Attempted to start a session while another session is active.",
        {
          activeSessionId: this.activeSession.sessionId
        }
      );
      return {
        ok: false,
        reason: "SESSION_ALREADY_ACTIVE",
        activeSession: cloneSessionRecord(
          this.activeSession
        )
      };
    }
    const participantId = input.participantId.trim();
    if (participantId.length === 0) {
      logger2.warn(
        "Session start rejected because participant ID is empty."
      );
      return {
        ok: false,
        reason: "INVALID_PARTICIPANT_ID",
        activeSession: null
      };
    }
    const session = {
      sessionId: createSessionId(),
      participantId,
      projectId: input.projectId ?? null,
      startedAtEpochMs,
      endedAtEpochMs: null,
      durationMs: null,
      extensionVersion: getExtensionVersion(),
      schemaVersion: SCHEMA_VERSION,
      trackerVersion: TRACKER_VERSION,
      gazeEngine: input.gazeEngine,
      browser: {
        ...input.browser
      },
      screen: {
        ...input.screen
      },
      camera: null,
      calibrationProfileId: null
    };
    this.activeSession = session;
    logger2.info(
      "Experiment session started.",
      {
        sessionId: session.sessionId,
        gazeEngine: session.gazeEngine
      }
    );
    return {
      ok: true,
      session: cloneSessionRecord(session)
    };
  }
  /**
   * Ends the currently active experiment session.
   */
  endSession(endedAtEpochMs = Date.now()) {
    if (this.activeSession === null) {
      logger2.warn(
        "Attempted to end a session when no session is active."
      );
      return {
        ok: false,
        reason: "SESSION_NOT_ACTIVE"
      };
    }
    const safeEndedAt = Math.max(
      endedAtEpochMs,
      this.activeSession.startedAtEpochMs
    );
    const completedSession = {
      ...this.activeSession,
      endedAtEpochMs: safeEndedAt,
      durationMs: safeEndedAt - this.activeSession.startedAtEpochMs
    };
    this.lastCompletedSession = completedSession;
    this.activeSession = null;
    logger2.info(
      "Experiment session ended.",
      {
        sessionId: completedSession.sessionId,
        durationMs: completedSession.durationMs
      }
    );
    return {
      ok: true,
      session: cloneSessionRecord(completedSession)
    };
  }
  /**
   * Returns whether a research session is currently active.
   */
  hasActiveSession() {
    return this.activeSession !== null;
  }
  /**
   * Returns a safe copy of the current session.
   */
  getActiveSession() {
    if (this.activeSession === null) {
      return null;
    }
    return cloneSessionRecord(
      this.activeSession
    );
  }
  /**
   * Returns only the active session ID.
   *
   * This is useful for associating newly opened tabs/pages with the
   * existing experiment session.
   */
  getActiveSessionId() {
    return this.activeSession?.sessionId ?? null;
  }
  /**
   * Returns the most recently completed session.
   *
   * This is useful immediately after STOPPING/COMPLETED for storage/export.
   */
  getLastCompletedSession() {
    if (this.lastCompletedSession === null) {
      return null;
    }
    return cloneSessionRecord(
      this.lastCompletedSession
    );
  }
  /**
   * Stores the actual camera settings after getUserMedia succeeds.
   *
   * Requested constraints and actual camera settings may differ,
   * therefore this must use MediaStreamTrack.getSettings()-derived data.
   */
  setCameraSettings(settings) {
    if (this.activeSession === null) {
      return {
        ok: false,
        reason: "SESSION_NOT_ACTIVE"
      };
    }
    this.activeSession = {
      ...this.activeSession,
      camera: {
        ...settings
      }
    };
    logger2.info(
      "Session camera settings updated.",
      {
        sessionId: this.activeSession.sessionId,
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate
      }
    );
    return {
      ok: true,
      session: cloneSessionRecord(
        this.activeSession
      )
    };
  }
  /**
   * Associates a successful calibration profile with the active session.
   */
  setCalibrationProfile(profileId) {
    if (this.activeSession === null) {
      return {
        ok: false,
        reason: "SESSION_NOT_ACTIVE"
      };
    }
    this.activeSession = {
      ...this.activeSession,
      calibrationProfileId: profileId
    };
    logger2.info(
      "Calibration profile associated with session.",
      {
        sessionId: this.activeSession.sessionId,
        calibrationProfileId: profileId
      }
    );
    return {
      ok: true,
      session: cloneSessionRecord(
        this.activeSession
      )
    };
  }
};
var sessionManager = new SessionManager();

// src/background/tabManager.ts
var logger3 = createLogger("BACKGROUND");
function cloneTrackedTabState(state) {
  return {
    ...state
  };
}
function isValidTabId(tabId) {
  return Number.isInteger(tabId) && tabId >= 0;
}
var TabManager = class {
  trackedTabs = /* @__PURE__ */ new Map();
  /**
   * Handles a short race where a child tab may be observed before its opener
   * has been restored/associated in the service worker.
   */
  pendingTabs = /* @__PURE__ */ new Map();
  /* ========================================================================
   * Explicit association
   * ====================================================================== */
  /**
   * Associates the initial research tab with an existing experiment session.
   *
   * This should normally be called once recording/tracking starts.
   */
  associateInitialTab(tab, sessionId, timestampEpochMs = Date.now()) {
    return this.associateTab(
      tab,
      sessionId,
      "INITIAL",
      timestampEpochMs
    );
  }
  /**
   * Explicit association for restoration or controlled recovery.
   */
  associateExplicitTab(tab, sessionId, timestampEpochMs = Date.now()) {
    return this.associateTab(
      tab,
      sessionId,
      "EXPLICIT",
      timestampEpochMs
    );
  }
  /* ========================================================================
   * New tab
   * ====================================================================== */
  /**
   * Handles a newly created browser tab.
   *
   * A new tab is automatically associated ONLY when:
   *
   * 1. an experiment session is active,
   * 2. the new tab has openerTabId,
   * 3. the opener tab already belongs to that same session.
   *
   * This prevents unrelated tabs opened by the participant from being
   * silently attached to the experiment.
   */
  handleTabCreated(tab, activeSessionId, timestampEpochMs = Date.now()) {
    this.cleanupExpiredPendingTabs(
      timestampEpochMs
    );
    if (!isValidTabId(tab.tabId)) {
      return {
        ok: false,
        reason: "INVALID_TAB_ID"
      };
    }
    if (this.trackedTabs.has(tab.tabId)) {
      return {
        ok: false,
        reason: "TAB_ALREADY_TRACKED"
      };
    }
    if (activeSessionId === null) {
      return {
        ok: false,
        reason: "NO_ACTIVE_SESSION"
      };
    }
    if (tab.openerTabId === null) {
      return {
        ok: false,
        reason: "OPENER_NOT_TRACKED"
      };
    }
    const opener = this.trackedTabs.get(
      tab.openerTabId
    );
    if (opener !== void 0 && opener.sessionId === activeSessionId) {
      return this.associateTab(
        tab,
        activeSessionId,
        "OPENER",
        timestampEpochMs
      );
    }
    this.pendingTabs.set(
      tab.tabId,
      {
        tab: {
          ...tab
        },
        expectedSessionId: activeSessionId,
        createdAtEpochMs: timestampEpochMs
      }
    );
    logger3.debug(
      "New tab is waiting for opener association.",
      {
        tabId: tab.tabId,
        openerTabId: tab.openerTabId,
        sessionId: activeSessionId
      }
    );
    return {
      ok: false,
      reason: "OPENER_NOT_TRACKED"
    };
  }
  /* ========================================================================
   * Tab updates
   * ====================================================================== */
  /**
   * Updates URL/window/active metadata for an already tracked tab.
   *
   * This method does not create a new page ID.
   * Page identity changes are driven by webNavigation events.
   */
  handleTabUpdated(input) {
    const existing = this.trackedTabs.get(
      input.tabId
    );
    if (existing === void 0) {
      return null;
    }
    const next = {
      ...existing,
      windowId: input.windowId ?? existing.windowId,
      url: input.url ?? existing.url,
      active: input.active ?? existing.active
    };
    this.trackedTabs.set(
      input.tabId,
      next
    );
    return cloneTrackedTabState(next);
  }
  /* ========================================================================
   * Active tab
   * ====================================================================== */
  /**
   * Updates active-tab state inside one browser window.
   */
  handleTabActivated(input) {
    let activated = null;
    for (const [tabId, state] of this.trackedTabs) {
      if (state.windowId !== input.windowId) {
        continue;
      }
      const shouldBeActive = tabId === input.tabId;
      if (state.active === shouldBeActive) {
        if (shouldBeActive) {
          activated = cloneTrackedTabState(state);
        }
        continue;
      }
      const updated = {
        ...state,
        active: shouldBeActive
      };
      this.trackedTabs.set(
        tabId,
        updated
      );
      if (shouldBeActive) {
        activated = cloneTrackedTabState(updated);
      }
    }
    return activated;
  }
  /* ========================================================================
   * Full-page navigation
   * ====================================================================== */
  /**
   * Handles a committed main-frame navigation.
   *
   * A new document means a new pageId, but the sessionId stays unchanged.
   */
  handleNavigationCommitted(input) {
    if (input.frameId !== 0) {
      return {
        ok: false,
        reason: "NOT_MAIN_FRAME"
      };
    }
    const existing = this.trackedTabs.get(
      input.tabId
    );
    if (existing === void 0) {
      return {
        ok: false,
        reason: "TAB_NOT_TRACKED"
      };
    }
    if (existing.currentDocumentId === input.documentId && existing.url === input.url) {
      return {
        ok: true,
        changed: false,
        previousPageId: existing.currentPageId,
        association: cloneTrackedTabState(existing)
      };
    }
    const previousPageId = existing.currentPageId;
    const next = {
      ...existing,
      currentPageId: createPageId(),
      currentDocumentId: input.documentId,
      url: input.url,
      pageStartedAtEpochMs: input.timestampEpochMs
    };
    this.trackedTabs.set(
      input.tabId,
      next
    );
    logger3.info(
      "Tracked tab committed a new document.",
      {
        sessionId: next.sessionId,
        tabId: next.tabId,
        previousPageId,
        pageId: next.currentPageId,
        url: next.url
      }
    );
    return {
      ok: true,
      changed: true,
      previousPageId,
      association: cloneTrackedTabState(next)
    };
  }
  /* ========================================================================
   * SPA navigation
   * ====================================================================== */
  /**
   * Handles History API route changes.
   *
   * A SPA may keep the same documentId while presenting a logically new page.
   * Therefore an actual URL change receives a new pageId.
   */
  handleHistoryStateUpdated(input) {
    if (input.frameId !== 0) {
      return {
        ok: false,
        reason: "NOT_MAIN_FRAME"
      };
    }
    const existing = this.trackedTabs.get(
      input.tabId
    );
    if (existing === void 0) {
      return {
        ok: false,
        reason: "TAB_NOT_TRACKED"
      };
    }
    if (existing.url === input.url) {
      return {
        ok: true,
        changed: false,
        previousPageId: existing.currentPageId,
        association: cloneTrackedTabState(existing)
      };
    }
    const previousPageId = existing.currentPageId;
    const next = {
      ...existing,
      currentPageId: createPageId(),
      currentDocumentId: input.documentId,
      url: input.url,
      pageStartedAtEpochMs: input.timestampEpochMs
    };
    this.trackedTabs.set(
      input.tabId,
      next
    );
    logger3.info(
      "Tracked tab changed SPA route.",
      {
        sessionId: next.sessionId,
        tabId: next.tabId,
        previousPageId,
        pageId: next.currentPageId,
        url: next.url
      }
    );
    return {
      ok: true,
      changed: true,
      previousPageId,
      association: cloneTrackedTabState(next)
    };
  }
  /* ========================================================================
   * Tab removal
   * ====================================================================== */
  /**
   * Removes a closed tab from runtime tracking.
   *
   * Closing one tab does NOT end the experiment session.
   */
  handleTabRemoved(tabId) {
    this.pendingTabs.delete(tabId);
    const existing = this.trackedTabs.get(tabId);
    if (existing === void 0) {
      return null;
    }
    this.trackedTabs.delete(tabId);
    logger3.info(
      "Tracked tab removed.",
      {
        sessionId: existing.sessionId,
        tabId: existing.tabId
      }
    );
    return cloneTrackedTabState(existing);
  }
  /* ========================================================================
   * Queries
   * ====================================================================== */
  isTrackedTab(tabId) {
    return this.trackedTabs.has(tabId);
  }
  getTab(tabId) {
    const state = this.trackedTabs.get(tabId);
    if (state === void 0) {
      return null;
    }
    return cloneTrackedTabState(state);
  }
  getTrackedTabsForSession(sessionId) {
    const result = [];
    for (const state of this.trackedTabs.values()) {
      if (state.sessionId !== sessionId) {
        continue;
      }
      result.push(
        cloneTrackedTabState(state)
      );
    }
    return result;
  }
  /**
   * Returns the active tracked tab in a window, if one exists.
   */
  getActiveTrackedTab(windowId) {
    for (const state of this.trackedTabs.values()) {
      if (state.windowId === windowId && state.active) {
        return cloneTrackedTabState(
          state
        );
      }
    }
    return null;
  }
  /* ========================================================================
   * Session cleanup
   * ====================================================================== */
  /**
   * Called only when an experiment session is actually finished.
   *
   * Navigation or tab switches must NOT call this.
   */
  clearSession(sessionId) {
    for (const [tabId, state] of this.trackedTabs) {
      if (state.sessionId === sessionId) {
        this.trackedTabs.delete(
          tabId
        );
      }
    }
    for (const [tabId, pending] of this.pendingTabs) {
      if (pending.expectedSessionId === sessionId) {
        this.pendingTabs.delete(
          tabId
        );
      }
    }
    logger3.info(
      "Tab associations cleared for completed session.",
      {
        sessionId
      }
    );
  }
  /* ========================================================================
   * Internal association
   * ====================================================================== */
  associateTab(tab, sessionId, reason, timestampEpochMs) {
    if (!isValidTabId(tab.tabId)) {
      return {
        ok: false,
        reason: "INVALID_TAB_ID"
      };
    }
    if (this.trackedTabs.has(tab.tabId)) {
      return {
        ok: false,
        reason: "TAB_ALREADY_TRACKED"
      };
    }
    const state = {
      sessionId,
      tabId: tab.tabId,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      currentPageId: createPageId(),
      currentDocumentId: null,
      url: tab.url,
      active: tab.active,
      associationReason: reason,
      associatedAtEpochMs: timestampEpochMs,
      pageStartedAtEpochMs: timestampEpochMs
    };
    this.trackedTabs.set(
      tab.tabId,
      state
    );
    this.pendingTabs.delete(
      tab.tabId
    );
    logger3.info(
      "Tab associated with experiment session.",
      {
        sessionId,
        tabId: tab.tabId,
        openerTabId: tab.openerTabId,
        reason
      }
    );
    this.resolvePendingChildren(
      tab.tabId,
      sessionId,
      timestampEpochMs
    );
    return {
      ok: true,
      association: cloneTrackedTabState(state)
    };
  }
  /* ========================================================================
   * Pending opener association
   * ====================================================================== */
  resolvePendingChildren(openerTabId, sessionId, timestampEpochMs) {
    this.cleanupExpiredPendingTabs(
      timestampEpochMs
    );
    const pendingMatches = [];
    for (const pending of this.pendingTabs.values()) {
      if (pending.tab.openerTabId !== openerTabId) {
        continue;
      }
      if (pending.expectedSessionId !== sessionId) {
        continue;
      }
      pendingMatches.push(pending);
    }
    for (const pending of pendingMatches) {
      this.associateTab(
        pending.tab,
        sessionId,
        "PENDING_OPENER",
        timestampEpochMs
      );
    }
  }
  cleanupExpiredPendingTabs(nowEpochMs2) {
    for (const [tabId, pending] of this.pendingTabs) {
      const ageMs = nowEpochMs2 - pending.createdAtEpochMs;
      if (ageMs <= NAVIGATION.TAB_ASSOCIATION_TTL_MS) {
        continue;
      }
      this.pendingTabs.delete(tabId);
      logger3.debug(
        "Expired pending tab association removed.",
        {
          tabId,
          openerTabId: pending.tab.openerTabId
        }
      );
    }
  }
};
var tabManager = new TabManager();

// src/storage/sessionExport.ts
function csvValueToText(value) {
  if (value === null || value === void 0) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.description ?? "";
  }
  if (typeof value === "function") {
    return value.name;
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
function csvCell(value) {
  const text = csvValueToText(value);
  if (!/[",\n\r]/u.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
function csvRow(values) {
  return values.map(csvCell).join(",");
}
function buildAoiMap(records) {
  const map = /* @__PURE__ */ new Map();
  for (const record of records) {
    map.set(record.entry.aoiId, record);
  }
  return map;
}
function buildGazeCsv(data) {
  const aoiMap = buildAoiMap(data.aoiRegistry);
  const lines = [
    csvRow([
      "timestamp_ms",
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "tab_id",
      "browser_frame_id",
      "url",
      "coordinate_source",
      "aoi_point_source",
      "fixation_id",
      "gaze_quality",
      "degraded_collection",
      "viewport_x",
      "viewport_y",
      "normalized_x",
      "normalized_y",
      "raw_prediction_normalized_x",
      "raw_prediction_normalized_y",
      "authoritative_normalized_x",
      "authoritative_normalized_y",
      "stabilized_normalized_x",
      "stabilized_normalized_y",
      "document_x",
      "document_y",
      "aoi_probe_viewport_x",
      "aoi_probe_viewport_y",
      "aoi_probe_normalized_x",
      "aoi_probe_normalized_y",
      "aoi_probe_document_x",
      "aoi_probe_document_y",
      "scroll_x",
      "scroll_y",
      "viewport_width",
      "viewport_height",
      "document_width",
      "document_height",
      "inside_viewport",
      "primary_aoi_id",
      "primary_aoi_type",
      "primary_tag_name",
      "primary_role",
      "primary_element_id",
      "primary_aria_label",
      "candidate_count"
    ])
  ];
  for (const record of data.gaze) {
    const c = record.coordinates;
    const aoi = record.primaryAoiId === null ? null : aoiMap.get(record.primaryAoiId)?.entry ?? null;
    const probeNormalizedPoint = record.probeNormalizedPoint ?? {
      x: c.viewportWidth > 0 ? c.viewportPoint.x / c.viewportWidth : 0,
      y: c.viewportHeight > 0 ? c.viewportPoint.y / c.viewportHeight : 0
    };
    const gazeNormalizedPoint = record.gazeNormalizedPoint ?? record.stabilizedNormalizedPoint ?? probeNormalizedPoint;
    const aoiCoordinates = record.aoiProbeCoordinates ?? c;
    const coordinateSource = record.coordinateSource ?? record.pointSource;
    lines.push(
      csvRow([
        record.timestampMs,
        record.capturedAtEpochMs,
        record.sessionId,
        record.pageId,
        record.tabId,
        record.browserFrameId,
        c.url,
        coordinateSource,
        record.pointSource,
        record.fixationId,
        record.gazeQuality,
        record.degradedCollection,
        c.viewportPoint.x,
        c.viewportPoint.y,
        gazeNormalizedPoint.x,
        gazeNormalizedPoint.y,
        record.rawPredictionNormalizedPoint?.x ?? null,
        record.rawPredictionNormalizedPoint?.y ?? null,
        record.authoritativeNormalizedPoint?.x ?? null,
        record.authoritativeNormalizedPoint?.y ?? null,
        record.stabilizedNormalizedPoint?.x ?? null,
        record.stabilizedNormalizedPoint?.y ?? null,
        c.documentPoint.x,
        c.documentPoint.y,
        aoiCoordinates.viewportPoint.x,
        aoiCoordinates.viewportPoint.y,
        probeNormalizedPoint.x,
        probeNormalizedPoint.y,
        aoiCoordinates.documentPoint.x,
        aoiCoordinates.documentPoint.y,
        c.scrollX,
        c.scrollY,
        c.viewportWidth,
        c.viewportHeight,
        c.documentWidth,
        c.documentHeight,
        c.insideViewport,
        record.primaryAoiId,
        aoi?.aoiType ?? null,
        aoi?.tagName ?? null,
        aoi?.role ?? null,
        aoi?.elementId ?? null,
        aoi?.ariaLabel ?? null,
        record.candidates.length
      ])
    );
  }
  return `${lines.join("\n")}
`;
}
function mean(values) {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}
function modalAoiId(records) {
  const counts = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (record.primaryAoiId === null) continue;
    counts.set(
      record.primaryAoiId,
      (counts.get(record.primaryAoiId) ?? 0) + 1
    );
  }
  let winner = null;
  let winnerCount = 0;
  for (const [aoiId, count] of counts) {
    if (count > winnerCount) {
      winner = aoiId;
      winnerCount = count;
    }
  }
  return winner;
}
function buildFixationCsv(data) {
  const aoiMap = buildAoiMap(data.aoiRegistry);
  const gazeByFixation = /* @__PURE__ */ new Map();
  for (const gaze of data.gaze) {
    if (gaze.fixationId === null) continue;
    const list = gazeByFixation.get(gaze.fixationId) ?? [];
    list.push(gaze);
    gazeByFixation.set(gaze.fixationId, list);
  }
  const lines = [
    csvRow([
      "fixation_id",
      "session_id",
      "page_id",
      "start_time_ms",
      "end_time_ms",
      "duration_ms",
      "centroid_viewport_x",
      "centroid_viewport_y",
      "centroid_document_x",
      "centroid_document_y",
      "dispersion_x",
      "dispersion_y",
      "dispersion_px",
      "sample_count",
      "quality_mean",
      "peak_speed_px_per_second",
      "primary_aoi_id",
      "primary_aoi_type",
      "primary_aoi_tag",
      "linked_gaze_probe_count"
    ])
  ];
  for (const record of data.fixations) {
    const event = record.event;
    const linked = gazeByFixation.get(event.fixationId) ?? [];
    const documentX = record.coordinates?.documentPoint.x ?? mean(
      linked.map((item) => item.coordinates.documentPoint.x)
    );
    const documentY = record.coordinates?.documentPoint.y ?? mean(
      linked.map((item) => item.coordinates.documentPoint.y)
    );
    const primaryAoiId = record.primaryAoiId ?? modalAoiId(linked);
    const aoi = primaryAoiId === null ? null : aoiMap.get(primaryAoiId)?.entry ?? null;
    lines.push(
      csvRow([
        event.fixationId,
        record.sessionId,
        record.pageId,
        event.startTimeMs,
        event.endTimeMs,
        event.durationMs,
        event.centroidViewportPoint.x,
        event.centroidViewportPoint.y,
        documentX,
        documentY,
        event.dispersionX,
        event.dispersionY,
        event.dispersionPx,
        event.sampleCount,
        event.qualityMean,
        record.peakSpeedPxPerSecond,
        primaryAoiId,
        aoi?.aoiType ?? null,
        aoi?.tagName ?? null,
        linked.length
      ])
    );
  }
  return `${lines.join("\n")}
`;
}
function buildScrollCsv(data) {
  const lines = [
    csvRow([
      "timestamp_ms",
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "tab_id",
      "browser_frame_id",
      "phase",
      "direction",
      "scroll_x",
      "scroll_y",
      "delta_x",
      "delta_y",
      "velocity_px_per_ms"
    ])
  ];
  for (const record of data.scroll) {
    const event = record.event;
    lines.push(
      csvRow([
        event.timestampMs,
        record.capturedAtEpochMs,
        record.sessionId,
        record.pageId,
        event.tabId,
        event.browserFrameId,
        event.phase,
        event.direction,
        event.scrollX,
        event.scrollY,
        event.deltaX,
        event.deltaY,
        event.velocityPxPerMs
      ])
    );
  }
  return `${lines.join("\n")}
`;
}
function buildAoiCsv(data) {
  const lines = [
    csvRow([
      "session_id",
      "page_id",
      "aoi_id",
      "aoi_type",
      "tag_name",
      "interactive",
      "element_id",
      "role",
      "aria_label",
      "element_name",
      "text_hash",
      "css_selector",
      "dom_path",
      "viewport_left",
      "viewport_top",
      "viewport_width",
      "viewport_height",
      "document_left",
      "document_top",
      "document_width",
      "document_height",
      "visible",
      "enabled"
    ])
  ];
  for (const record of data.aoiRegistry) {
    const entry = record.entry;
    lines.push(
      csvRow([
        record.sessionId,
        record.pageId,
        entry.aoiId,
        entry.aoiType,
        entry.tagName,
        entry.interactive,
        entry.elementId,
        entry.role,
        entry.ariaLabel,
        entry.elementName,
        entry.textHash,
        entry.cssSelector,
        entry.domPath,
        entry.viewportRect.left,
        entry.viewportRect.top,
        entry.viewportRect.width,
        entry.viewportRect.height,
        entry.documentRect.left,
        entry.documentRect.top,
        entry.documentRect.width,
        entry.documentRect.height,
        entry.visible,
        entry.enabled
      ])
    );
  }
  return `${lines.join("\n")}
`;
}
function buildNavigationCsv(data) {
  const lines = [
    csvRow([
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "tab_id",
      "reason",
      "url"
    ])
  ];
  for (const record of data.navigation) {
    lines.push(
      csvRow([
        record.capturedAtEpochMs,
        record.sessionId,
        record.pageId,
        record.tabId,
        record.reason,
        record.url
      ])
    );
  }
  return `${lines.join("\n")}
`;
}
function buildDiagnosticsCsv(data) {
  const lines = [
    csvRow([
      "captured_epoch_ms",
      "session_id",
      "page_id",
      "kind",
      "code",
      "milestone",
      "elapsed_ms",
      "gaze_quality",
      "effective_gaze_quality",
      "baseline_precision_px",
      "deep_precision_px",
      "drift_severity",
      "precision_reference_px",
      "precision_ratio",
      "maintenance_reason",
      "periodic_maintenance_due",
      "monitoring_elapsed_ms",
      "face_center_delta_px",
      "face_distance_delta_ratio",
      "yaw_delta_deg",
      "pitch_delta_deg",
      "roll_delta_deg",
      "authoritative_strategy",
      "collection_allowed",
      "degraded_collection",
      "details_json"
    ])
  ];
  for (const record of data.diagnostics) {
    const d = record.diagnostic;
    lines.push(csvRow([
      record.capturedAtEpochMs,
      record.sessionId,
      record.pageId,
      record.kind,
      record.code,
      d?.milestone ?? null,
      d?.elapsedMs ?? null,
      d?.gazeQualityScore ?? null,
      d?.effectiveGazeQualityScore ?? null,
      d?.baselinePrecisionPx ?? null,
      d?.deepPrecisionPx ?? null,
      d?.driftStatus?.severity ?? null,
      d?.driftStatus?.precisionReferencePx ?? null,
      d?.driftStatus?.precisionRatio ?? null,
      d?.driftStatus?.maintenanceReason ?? null,
      d?.driftStatus?.periodicMaintenanceDue ?? null,
      d?.driftStatus?.monitoringElapsedMs ?? null,
      d?.driftStatus?.faceCenterDeltaPx ?? null,
      d?.driftStatus?.faceDistanceDeltaRatio ?? null,
      d?.driftStatus?.yawDeltaDeg ?? null,
      d?.driftStatus?.pitchDeltaDeg ?? null,
      d?.driftStatus?.rollDeltaDeg ?? null,
      d?.authoritativeStrategy ?? null,
      d?.collectionAllowed ?? null,
      d?.degradedCollection ?? null,
      record.details
    ]));
  }
  return `${lines.join("\n")}
`;
}
function safeFilenamePart(value) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/gu, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "session";
}
function buildSessionExportFiles(data, format) {
  const sessionId = safeFilenamePart(data.session.sessionId);
  if (format === "JSON") {
    return [
      {
        filename: `eye-tracker_${sessionId}.json`,
        mimeType: "application/json;charset=utf-8",
        content: `${JSON.stringify(data, null, 2)}
`
      }
    ];
  }
  return [
    {
      filename: `eye-tracker_${sessionId}_gaze.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildGazeCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_fixations.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildFixationCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_scroll.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildScrollCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_aoi.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildAoiCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_navigation.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildNavigationCsv(data)
    },
    {
      filename: `eye-tracker_${sessionId}_diagnostics.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: buildDiagnosticsCsv(data)
    }
  ];
}

// src/storage/experimentStorage.ts
var logger4 = createLogger("STORAGE");
var SESSION_INDEX = "sessionId";
var PAGE_INDEX = "pageId";
var TIMESTAMP_INDEX = "timestampMs";
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("IndexedDB request failed.")
    );
  });
}
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("IndexedDB transaction failed.")
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("IndexedDB transaction was aborted.")
    );
  });
}
function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}
function ensureRecordStore(database, transaction, name) {
  const store = database.objectStoreNames.contains(name) ? transaction.objectStore(name) : database.createObjectStore(name, { keyPath: "recordId" });
  ensureIndex(store, SESSION_INDEX, "sessionId");
  ensureIndex(store, PAGE_INDEX, "pageId");
  return store;
}
function configureSchema(database, transaction) {
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
  ensureRecordStore(
    database,
    transaction,
    DATABASE.STORES.DIAGNOSTICS
  );
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
async function openDatabase() {
  return new Promise((resolve, reject) => {
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
async function getAllBySession(database, storeName, sessionId) {
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  let values;
  if (store.indexNames.contains(SESSION_INDEX)) {
    const index = store.index(SESSION_INDEX);
    values = await requestResult(
      index.getAll(IDBKeyRange.only(sessionId))
    );
  } else {
    const allValues = await requestResult(store.getAll());
    values = allValues.filter(
      (value) => value.sessionId === sessionId
    );
  }
  await transactionDone(transaction);
  return values;
}
var ExperimentStorage = class {
  databasePromise = null;
  gazeBuffer = [];
  eventBuffer = [];
  fixationBuffer = [];
  flushTimerId = null;
  flushPromise = null;
  async initialize() {
    await this.getDatabase();
  }
  async putSession(session) {
    const database = await this.getDatabase();
    const readTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readonly"
    );
    const existing = await requestResult(
      readTransaction.objectStore(DATABASE.STORES.SESSIONS).get(session.sessionId)
    );
    await transactionDone(readTransaction);
    const record = {
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
    writeTransaction.objectStore(DATABASE.STORES.SESSIONS).put(record);
    await transactionDone(writeTransaction);
  }
  async setValidation(sessionId, input) {
    const database = await this.getDatabase();
    const readTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readonly"
    );
    const existing = await requestResult(
      readTransaction.objectStore(DATABASE.STORES.SESSIONS).get(sessionId)
    );
    await transactionDone(readTransaction);
    if (existing === void 0) {
      throw new Error(`Session ${sessionId} is not stored.`);
    }
    const validation = {
      ...input,
      metrics: input.metrics === null ? null : { ...input.metrics },
      baselineShadowMetrics: { ...input.baselineShadowMetrics },
      capturedAtEpochMs: nowEpochMs()
    };
    const writeTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readwrite"
    );
    writeTransaction.objectStore(DATABASE.STORES.SESSIONS).put({
      ...existing,
      validation,
      updatedAtEpochMs: nowEpochMs()
    });
    await transactionDone(writeTransaction);
  }
  queueGaze(sessionId, tabId, payload) {
    const storedCoordinates = payload.gazeCoordinates ?? payload.coordinates;
    const gazeNormalizedPoint = payload.stabilizedNormalizedPoint ?? payload.probeNormalizedPoint;
    this.gazeBuffer.push({
      recordId: createMessageId(),
      sessionId,
      pageId: payload.pageId,
      tabId,
      browserFrameId: payload.browserFrameId,
      timestampMs: payload.hit.timestampMs,
      capturedAtEpochMs: storedCoordinates.capturedAtEpochMs,
      pointSource: payload.pointSource,
      coordinateSource: payload.gazeCoordinates === null ? "FIXATION_CENTROID_SNAPSHOT" : "STABILIZED_GAZE",
      gazeQuality: payload.gazeQuality,
      degradedCollection: payload.degradedCollection,
      fixationId: payload.fixationId,
      gazeNormalizedPoint: {
        ...gazeNormalizedPoint
      },
      probeNormalizedPoint: {
        ...payload.probeNormalizedPoint
      },
      rawPredictionNormalizedPoint: payload.rawPredictionNormalizedPoint === null ? null : { ...payload.rawPredictionNormalizedPoint },
      authoritativeNormalizedPoint: payload.authoritativeNormalizedPoint === null ? null : { ...payload.authoritativeNormalizedPoint },
      stabilizedNormalizedPoint: payload.stabilizedNormalizedPoint === null ? null : { ...payload.stabilizedNormalizedPoint },
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
  queueScroll(event) {
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
  queueFixation(event, peakSpeedPxPerSecond, enrichment = null) {
    const record = {
      recordId: event.fixationId,
      sessionId: event.sessionId,
      pageId: event.pageId,
      event: {
        ...event,
        centroidViewportPoint: { ...event.centroidViewportPoint }
      },
      peakSpeedPxPerSecond,
      capturedAtEpochMs: nowEpochMs(),
      coordinates: enrichment === null ? null : {
        ...enrichment.coordinates,
        viewportPoint: { ...enrichment.coordinates.viewportPoint },
        documentPoint: { ...enrichment.coordinates.documentPoint }
      },
      primaryAoiId: enrichment?.primaryAoiId ?? event.aoiId,
      candidates: enrichment?.candidates.map((candidate) => ({ ...candidate })) ?? []
    };
    const existingIndex = this.fixationBuffer.findIndex(
      (candidate) => candidate.recordId === record.recordId
    );
    if (existingIndex >= 0) {
      const existing = this.fixationBuffer[existingIndex];
      if (existing !== void 0) {
        const preferNew = record.coordinates !== null || existing.coordinates === null;
        this.fixationBuffer[existingIndex] = preferNew ? record : existing;
      }
    } else {
      this.fixationBuffer.push(record);
    }
    this.scheduleFlush();
  }
  async upsertAoi(sessionId, entries, _removedAoiIds) {
    if (entries.length === 0) return;
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.AOI_REGISTRY,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.AOI_REGISTRY);
    for (const entry of entries) {
      const record = {
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
  async recordNavigation(sessionId, pageId, tabId, reason, url) {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.PAGE_EVENTS,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.PAGE_EVENTS);
    const record = {
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
  async recordRuntimeDiagnostic(sessionId, pageId, diagnostic) {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.DIAGNOSTICS,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.DIAGNOSTICS);
    const record = {
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
  async recordMaintenanceEvent(sessionId, pageId, code, details) {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      DATABASE.STORES.DIAGNOSTICS,
      "readwrite"
    );
    const store = transaction.objectStore(DATABASE.STORES.DIAGNOSTICS);
    const record = {
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
  async flush() {
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
    } catch (error) {
      this.gazeBuffer.unshift(...gaze);
      this.eventBuffer.unshift(...events);
      this.fixationBuffer.unshift(...fixations);
      logger4.error("IndexedDB batch flush failed.", {
        error: error instanceof Error ? error.message : "Unknown storage error",
        gazeCount: gaze.length,
        eventCount: events.length,
        fixationCount: fixations.length
      });
      throw error;
    } finally {
      this.flushPromise = null;
      if (this.gazeBuffer.length > 0 || this.eventBuffer.length > 0 || this.fixationBuffer.length > 0) {
        this.scheduleFlush();
      }
    }
  }
  async exportSession(sessionId, format) {
    await this.flush();
    const database = await this.getDatabase();
    const sessionTransaction = database.transaction(
      DATABASE.STORES.SESSIONS,
      "readonly"
    );
    const sessionStore = sessionTransaction.objectStore(DATABASE.STORES.SESSIONS);
    const session = await requestResult(
      sessionStore.get(sessionId)
    );
    await transactionDone(sessionTransaction);
    if (session === void 0) {
      throw new Error(`No stored session exists for ${sessionId}.`);
    }
    const [gaze, fixations, scroll, navigation, aoiRegistry, diagnostics] = await Promise.all([
      getAllBySession(
        database,
        DATABASE.STORES.GAZE_SAMPLES,
        sessionId
      ),
      getAllBySession(
        database,
        DATABASE.STORES.FIXATION_EVENTS,
        sessionId
      ),
      getAllBySession(
        database,
        DATABASE.STORES.INTERACTION_EVENTS,
        sessionId
      ),
      getAllBySession(
        database,
        DATABASE.STORES.PAGE_EVENTS,
        sessionId
      ),
      getAllBySession(
        database,
        DATABASE.STORES.AOI_REGISTRY,
        sessionId
      ),
      getAllBySession(
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
    const data = {
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
  async getDatabase() {
    if (this.databasePromise === null) {
      this.databasePromise = openDatabase().catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }
  scheduleFlush() {
    if (this.flushTimerId !== null) return;
    this.flushTimerId = setTimeout(() => {
      this.flushTimerId = null;
      void this.flush();
    }, STORAGE_BATCH.MAX_FLUSH_INTERVAL_MS);
  }
  clearFlushTimer() {
    if (this.flushTimerId === null) return;
    clearTimeout(this.flushTimerId);
    this.flushTimerId = null;
  }
  async flushRecords(gaze, events, fixations) {
    const database = await this.getDatabase();
    const storeNames = [];
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
};
var experimentStorage = new ExperimentStorage();

// src/background/serviceWorker.ts
var logger5 = createLogger("BACKGROUND");
function logValidationPointDiagnostics(points) {
  if (points === null) {
    return;
  }
  for (const point of points) {
    logger5.info(
      "Independent validation point raw/corrected diagnostic.",
      {
        pointIndex: point.pointIndex,
        targetX: point.targetViewportPoint.x,
        targetY: point.targetViewportPoint.y,
        rawViewportX: point.rawViewportPoint.x,
        rawViewportY: point.rawViewportPoint.y,
        rawErrorX: point.rawErrorXPx,
        rawErrorY: point.rawErrorYPx,
        rawErrorPx: point.rawErrorPx,
        correctedX: point.correctedViewportPoint.x,
        correctedY: point.correctedViewportPoint.y,
        correctedErrorX: point.errorXPx,
        correctedErrorY: point.errorYPx,
        correctedErrorPx: point.errorPx,
        correctionImprovementPx: point.correctionImprovementPx,
        sampleCount: point.sampleCount,
        rejectedCount: point.rejectedCount,
        quality: point.meanQuality
      }
    );
  }
}
var trackerStateMachine = new TrackerStateMachine();
var aoiRegistryByPage = /* @__PURE__ */ new Map();
var lastAoiPrimaryByPage = /* @__PURE__ */ new Map();
var lastAoiSmokeAtByPage = /* @__PURE__ */ new Map();
var latestScrollByPage = /* @__PURE__ */ new Map();
var lastScrollSmokeAtByPage = /* @__PURE__ */ new Map();
var enrichedFixationIds = /* @__PURE__ */ new Set();
function isPersistentCollectionState() {
  const state = trackerStateMachine.getSnapshot().state;
  return state === TRACKER_STATES.READY || state === TRACKER_STATES.RECORDING;
}
var navigationTargets = /* @__PURE__ */ new Map();
var ensureOffscreenPromise = null;
var calibrationFlowGeneration = 0;
var calibrationStartPromise = null;
var calibrationUiRetryAfterEpochMs = 0;
var pendingCalibrationUiReadySignals = /* @__PURE__ */ new Map();
var reloadRestartPromises = /* @__PURE__ */ new Map();
var DIAGNOSTIC_COMPONENT_VALUES = /* @__PURE__ */ new Set([
  "BACKGROUND",
  "OFFSCREEN",
  "CAMERA",
  "FACE",
  "GAZE",
  "CALIBRATION",
  "AOI",
  "CONTENT",
  "STORAGE",
  "NETWORK",
  "POPUP",
  "UNKNOWN"
]);
function isDiagnosticComponent(value) {
  return typeof value === "string" && DIAGNOSTIC_COMPONENT_VALUES.has(value);
}
function isTrackerErrorPayload(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isTrackerErrorCode(value.code) && typeof value.message === "string" && value.message.trim().length > 0 && isDiagnosticComponent(
    value.component
  ) && typeof value.recoverable === "boolean" && (value.details === null || isRecord(value.details));
}
var GAZE_ENGINE_VALUES = /* @__PURE__ */ new Set([
  "WEB_EYE_TRACK",
  "RIDGE",
  "ONNX",
  "CUSTOM"
]);
function isGazeEngineSource(value) {
  return typeof value === "string" && GAZE_ENGINE_VALUES.has(value);
}
function isBrowserMetadata(value) {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.browserName === "string" && typeof value.browserVersion === "string" && typeof value.operatingSystem === "string" && typeof value.userAgent === "string";
}
function isScreenMetadata(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isFiniteNumber(value.width) && isFiniteNumber(value.height) && isFiniteNumber(value.availableWidth) && isFiniteNumber(value.availableHeight) && isFiniteNumber(value.devicePixelRatio) && isNullableString(
    value.orientationType
  ) && isNullableFiniteNumber(
    value.orientationAngleDeg
  );
}
function isStartCameraPayload(payload) {
  return isCameraRequest(
    payload
  );
}
function isCameraReadyPayload(payload) {
  return isRecord(payload) && isCameraSettings(
    payload.settings
  );
}
function isFacePositionStatus(value) {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.faceDetected === "boolean" && typeof value.bothEyesVisible === "boolean" && typeof value.horizontallyCentered === "boolean" && typeof value.verticallyCentered === "boolean" && typeof value.distanceAcceptable === "boolean" && typeof value.headPoseAcceptable === "boolean" && typeof value.brightnessAcceptable === "boolean" && typeof value.stable === "boolean";
}
var FACE_POSITION_INSTRUCTION_VALUES = /* @__PURE__ */ new Set([
  "FIND_FACE",
  "SHOW_BOTH_EYES",
  "MOVE_CLOSER",
  "MOVE_FARTHER",
  "MOVE_LEFT",
  "MOVE_RIGHT",
  "MOVE_UP",
  "MOVE_DOWN",
  "FACE_FORWARD",
  "IMPROVE_LIGHTING",
  "REDUCE_LIGHTING",
  "HOLD_STEADY",
  "READY"
]);
function isNullableMetric(value) {
  return value === null || isFiniteNumber(value);
}
function isPreCalibrationFeedback(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (!isFacePositionStatus(
    value.status
  ) || typeof value.instruction !== "string" || !FACE_POSITION_INSTRUCTION_VALUES.has(value.instruction) || typeof value.readyForCalibration !== "boolean") {
    return false;
  }
  if (value.cameraFaceBoxNormalized !== null) {
    if (!isRecord(
      value.cameraFaceBoxNormalized
    ) || !isFiniteNumber(
      value.cameraFaceBoxNormalized.left
    ) || !isFiniteNumber(
      value.cameraFaceBoxNormalized.top
    ) || !isFiniteNumber(
      value.cameraFaceBoxNormalized.width
    ) || !isFiniteNumber(
      value.cameraFaceBoxNormalized.height
    )) {
      return false;
    }
  }
  if (!isRecord(value.metrics)) {
    return false;
  }
  const metrics = value.metrics;
  return isNullableMetric(metrics.centerX) && isNullableMetric(metrics.centerY) && isNullableMetric(metrics.widthRatio) && isNullableMetric(metrics.heightRatio) && isNullableMetric(metrics.proximityProxy) && isNullableMetric(metrics.yawDeg) && isNullableMetric(metrics.pitchDeg) && isNullableMetric(metrics.rollDeg) && isNullableMetric(metrics.brightness) && isFiniteNumber(
    metrics.stableDurationMs
  ) && metrics.stableDurationMs >= 0 && isFiniteNumber(
    metrics.stableProgress
  ) && metrics.stableProgress >= 0 && metrics.stableProgress <= 1;
}
function isFacePositionStatusPayload(payload) {
  return isRecord(payload) && isFacePositionStatus(
    payload.status
  ) && isPreCalibrationFeedback(
    payload.feedback
  );
}
function isCalibrationMode(value) {
  return value === "STANDARD_17" || value === "PRECISION_25";
}
function isStartCalibrationPayload(payload) {
  return isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isCalibrationMode(
    payload.mode
  );
}
function isCalibrationTarget(value) {
  if (!isRecord(value) || !isFiniteNumber(
    value.pointIndex
  ) || !Number.isInteger(
    value.pointIndex
  ) || !isRecord(
    value.normalizedPoint
  ) || !isRecord(
    value.viewportPoint
  )) {
    return false;
  }
  return isFiniteNumber(
    value.normalizedPoint.x
  ) && isFiniteNumber(
    value.normalizedPoint.y
  ) && isFiniteNumber(
    value.viewportPoint.x
  ) && isFiniteNumber(
    value.viewportPoint.y
  );
}
function isCalibrationPointPayload(payload) {
  return isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isCalibrationTarget(
    payload.target
  ) && isFiniteNumber(
    payload.targetShownAtMs
  ) && isFiniteNumber(
    payload.attempt
  ) && Number.isInteger(
    payload.attempt
  ) && payload.attempt >= 1;
}
function isCalibrationTrainingDiagnostics(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isFiniteNumber(value.pointCount) && Number.isInteger(value.pointCount) && value.pointCount > 0 && isFiniteNumber(value.rawMeanErrorPx) && value.rawMeanErrorPx >= 0 && isFiniteNumber(value.rawP95ErrorPx) && value.rawP95ErrorPx >= 0 && isFiniteNumber(value.rawRmsePx) && value.rawRmsePx >= 0 && isFiniteNumber(value.correctedMeanErrorPx) && value.correctedMeanErrorPx >= 0 && isFiniteNumber(value.correctedP95ErrorPx) && value.correctedP95ErrorPx >= 0 && isFiniteNumber(value.correctedRmsePx) && value.correctedRmsePx >= 0 && isFiniteNumber(value.meanCorrectionImprovementPx) && isFiniteNumber(value.improvedPointCount) && Number.isInteger(value.improvedPointCount) && value.improvedPointCount >= 0 && isFiniteNumber(value.degradedPointCount) && Number.isInteger(value.degradedPointCount) && value.degradedPointCount >= 0 && isFiniteNumber(value.unchangedPointCount) && Number.isInteger(value.unchangedPointCount) && value.unchangedPointCount >= 0;
}
function isCalibrationPointResultPayload(payload) {
  if (!isRecord(payload)) {
    return false;
  }
  const failureReason = payload.failureReason;
  return typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isFiniteNumber(
    payload.pointIndex
  ) && Number.isInteger(
    payload.pointIndex
  ) && typeof payload.sufficient === "boolean" && isFiniteNumber(
    payload.acceptedSampleCount
  ) && isFiniteNumber(
    payload.rejectedSampleCount
  ) && isFiniteNumber(
    payload.rejectionRatio
  ) && isFiniteNumber(
    payload.completedPointCount
  ) && isFiniteNumber(
    payload.expectedPointCount
  ) && (failureReason === null || failureReason === "INSUFFICIENT_SAMPLES" || failureReason === "UNSTABLE_GAZE" || failureReason === "OUTLIER_REJECTION") && typeof payload.modelReady === "boolean" && (payload.trainingRmseNormalized === null || isFiniteNumber(
    payload.trainingRmseNormalized
  )) && (payload.trainingDiagnostics === null || isCalibrationTrainingDiagnostics(
    payload.trainingDiagnostics
  )) && Array.isArray(payload.adaptiveExpansionTargets) && payload.adaptiveExpansionTargets.every(
    (target) => isCalibrationTarget(target)
  );
}
function isStartValidationPayload(payload) {
  return isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isFiniteNumber(
    payload.viewportWidth
  ) && payload.viewportWidth > 0 && isFiniteNumber(
    payload.viewportHeight
  ) && payload.viewportHeight > 0 && isFiniteNumber(
    payload.expectedPointCount
  ) && Number.isInteger(
    payload.expectedPointCount
  ) && payload.expectedPointCount >= CALIBRATION.MIN_VALIDATION_POINT_COUNT;
}
function isStartQuickRecalibrationPayload(payload) {
  return isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isFiniteNumber(payload.viewportWidth) && payload.viewportWidth > 0 && isFiniteNumber(payload.viewportHeight) && payload.viewportHeight > 0 && isFiniteNumber(payload.pointCount) && Number.isInteger(payload.pointCount) && payload.pointCount === DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT;
}
function isStartQuickValidationPayload(payload) {
  return isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isFiniteNumber(payload.viewportWidth) && payload.viewportWidth > 0 && isFiniteNumber(payload.viewportHeight) && payload.viewportHeight > 0 && isFiniteNumber(payload.expectedPointCount) && Number.isInteger(payload.expectedPointCount) && payload.expectedPointCount === DRIFT_THRESHOLDS.QUICK_REVALIDATION_POINT_COUNT && typeof payload.runId === "string" && payload.runId.length > 0;
}
function isDriftStatusPayload(payload) {
  if (!isRecord(payload) || !isRecord(payload.status)) {
    return false;
  }
  const status = payload.status;
  return isFiniteNumber(status.timestampMs) && (status.severity === "NONE" || status.severity === "LOW" || status.severity === "MEDIUM" || status.severity === "HIGH") && isFiniteNumber(status.faceCenterDeltaPx) && isFiniteNumber(status.faceDistanceDeltaRatio) && isFiniteNumber(status.yawDeltaDeg) && isFiniteNumber(status.pitchDeltaDeg) && isFiniteNumber(status.rollDeltaDeg) && isFiniteNumber(status.gazeVariance) && isFiniteNumber(status.qualityScore) && typeof status.quickRecalibrationRecommended === "boolean";
}
function isRuntimeQualityDiagnosticPayload(payload) {
  if (!isRecord(payload) || !isRecord(payload.diagnostic)) return false;
  const diagnostic = payload.diagnostic;
  return isFiniteNumber(diagnostic.timestampMs) && (diagnostic.milestone === "T0" || diagnostic.milestone === "T2" || diagnostic.milestone === "T5" || diagnostic.milestone === "T10") && isFiniteNumber(diagnostic.elapsedMs) && isFiniteNumber(diagnostic.gazeQualityScore) && isFiniteNumber(diagnostic.effectiveGazeQualityScore) && isNullableFiniteNumber(diagnostic.baselinePrecisionPx) && isNullableFiniteNumber(diagnostic.deepPrecisionPx) && typeof diagnostic.collectionAllowed === "boolean" && typeof diagnostic.degradedCollection === "boolean" && (diagnostic.authoritativeStrategy === "BASELINE_ONLY" || diagnostic.authoritativeStrategy === "DEEP_ONLY" || diagnostic.authoritativeStrategy === "SAFE_ADAPTIVE_HYBRID" || diagnostic.authoritativeStrategy === "BASELINE_FALLBACK") && (diagnostic.driftStatus === null || isDriftStatusPayload({ status: diagnostic.driftStatus }));
}
function isValidationPointPayload(payload) {
  return isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isCalibrationTarget(
    payload.target
  ) && isFiniteNumber(
    payload.targetShownAtMs
  ) && isFiniteNumber(
    payload.attempt
  ) && Number.isInteger(
    payload.attempt
  ) && payload.attempt >= 1;
}
function isCalibrationValidationMetrics(value) {
  if (!isRecord(value)) {
    return false;
  }
  const nonNegativeMetrics = [
    value.viewportWidthPx,
    value.viewportHeightPx,
    value.rawMeanErrorPx,
    value.rawP95ErrorPx,
    value.rawRmsePx,
    value.meanErrorViewportWidthRatio,
    value.p95ErrorViewportWidthRatio,
    value.meanPrecisionPx,
    value.p95PrecisionPx,
    value.meanPrecisionViewportWidthRatio,
    value.p95PrecisionViewportWidthRatio,
    value.validSampleRatio,
    value.meanErrorPx,
    value.medianErrorPx,
    value.rmsePx,
    value.p90ErrorPx,
    value.p95ErrorPx,
    value.maxErrorPx,
    value.horizontalErrorPx,
    value.verticalErrorPx,
    value.centerErrorPx,
    value.edgeErrorPx,
    value.cornerErrorPx
  ];
  return nonNegativeMetrics.every(
    (metric) => isFiniteNumber(metric) && metric >= 0
  ) && isFiniteNumber(
    value.meanCorrectionImprovementPx
  ) && isFiniteNumber(
    value.improvedPointCount
  ) && Number.isInteger(
    value.improvedPointCount
  ) && value.improvedPointCount >= 0 && isFiniteNumber(
    value.degradedPointCount
  ) && Number.isInteger(
    value.degradedPointCount
  ) && value.degradedPointCount >= 0 && isFiniteNumber(
    value.viewportWidthPx
  ) && value.viewportWidthPx > 0 && isFiniteNumber(
    value.viewportHeightPx
  ) && value.viewportHeightPx > 0 && isFiniteNumber(
    value.validSampleRatio
  ) && value.validSampleRatio <= 1;
}
function isCalibrationQualityLevel(value) {
  return value === "GOOD" || value === "ACCEPTABLE" || value === "POOR" || value === "FAIL";
}
function isFinitePoint2D(value) {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}
function isCalibrationPointDiagnostic(value) {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.calibrationId === "string" && value.calibrationId.length > 0 && isFiniteNumber(value.pointIndex) && Number.isInteger(value.pointIndex) && isFinitePoint2D(
    value.targetViewportPoint
  ) && isFinitePoint2D(
    value.rawMeanPoint
  ) && value.rawMeanSpace === "NORMALIZED" && isFinitePoint2D(
    value.rawViewportPoint
  ) && isFiniteNumber(value.rawErrorXPx) && isFiniteNumber(value.rawErrorYPx) && isFiniteNumber(value.rawErrorPx) && value.rawErrorPx >= 0 && isFinitePoint2D(
    value.correctedViewportPoint
  ) && isFiniteNumber(value.errorXPx) && isFiniteNumber(value.errorYPx) && isFiniteNumber(value.errorPx) && value.errorPx >= 0 && isFiniteNumber(
    value.correctionImprovementPx
  ) && isFiniteNumber(value.sampleCount) && isFiniteNumber(value.sampleCount) && Number.isInteger(value.sampleCount) && value.sampleCount >= 0 && isFiniteNumber(value.rejectedCount) && Number.isInteger(value.rejectedCount) && value.rejectedCount >= 0 && isRecord(value.meanHeadPose) && isFiniteNumber(
    value.meanHeadPose.yawDeg
  ) && isFiniteNumber(
    value.meanHeadPose.pitchDeg
  ) && isFiniteNumber(
    value.meanHeadPose.rollDeg
  ) && isFiniteNumber(
    value.meanFaceDistanceRatio
  ) && isFiniteNumber(value.meanQuality) && value.meanQuality >= 0 && value.meanQuality <= 1;
}
function isCalibrationCorrectionStrategy(value) {
  return value === "PROJECT_RESIDUAL_ONLY" || value === "WEBEYETRACK_NATIVE_ONLY";
}
function isValidationPointResultPayload(payload) {
  if (!isRecord(payload)) {
    return false;
  }
  const failureReason = payload.failureReason;
  const metricsValid = payload.metrics === null || isCalibrationValidationMetrics(
    payload.metrics
  );
  const qualityValid = payload.quality === null || isCalibrationQualityLevel(
    payload.quality
  );
  const selectedStrategyValidation = payload.selectedStrategyValidation;
  const selectedStrategyValidationValid = selectedStrategyValidation === null || isRecord(selectedStrategyValidation) && (selectedStrategyValidation.strategy === "BASELINE_ONLY" || selectedStrategyValidation.strategy === "DEEP_ONLY" || selectedStrategyValidation.strategy === "SAFE_ADAPTIVE_HYBRID") && isCalibrationValidationMetrics(
    selectedStrategyValidation.metrics
  ) && isCalibrationQualityLevel(
    selectedStrategyValidation.quality
  );
  const pointResultsValid = payload.pointResults === null || Array.isArray(payload.pointResults) && payload.pointResults.every(
    isCalibrationPointDiagnostic
  );
  return typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && isCalibrationCorrectionStrategy(
    payload.correctionStrategy
  ) && isFiniteNumber(
    payload.pointIndex
  ) && Number.isInteger(
    payload.pointIndex
  ) && typeof payload.sufficient === "boolean" && isFiniteNumber(
    payload.acceptedSampleCount
  ) && isFiniteNumber(
    payload.rejectedSampleCount
  ) && isFiniteNumber(
    payload.rejectionRatio
  ) && isFiniteNumber(
    payload.completedPointCount
  ) && isFiniteNumber(
    payload.expectedPointCount
  ) && (failureReason === null || failureReason === "INSUFFICIENT_SAMPLES" || failureReason === "UNSTABLE_GAZE" || failureReason === "OUTLIER_REJECTION") && typeof payload.validationComplete === "boolean" && metricsValid && qualityValid && selectedStrategyValidationValid && pointResultsValid && (payload.validationComplete ? payload.metrics !== null && payload.quality !== null && payload.pointResults !== null : payload.metrics === null && payload.quality === null && payload.selectedStrategyValidation === null && payload.pointResults === null);
}
function isInitTrackerPayload(payload) {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.participantId !== "string" || payload.participantId.trim().length === 0) {
    return false;
  }
  if (payload.preferredGazeEngine !== null && !isGazeEngineSource(
    payload.preferredGazeEngine
  )) {
    return false;
  }
  return isBrowserMetadata(
    payload.browser
  ) && isScreenMetadata(
    payload.screen
  );
}
function isPoint2D(value) {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}
function isRect2D(value) {
  return isRecord(value) && isFiniteNumber(value.left) && isFiniteNumber(value.top) && isFiniteNumber(value.width) && isFiniteNumber(value.height) && value.width >= 0 && value.height >= 0;
}
function isPageCoordinateSnapshot(value) {
  return isRecord(value) && isFiniteNumber(value.capturedAtEpochMs) && typeof value.url === "string" && typeof value.origin === "string" && isPoint2D(value.viewportPoint) && isPoint2D(value.documentPoint) && typeof value.insideViewport === "boolean" && isFiniteNumber(value.viewportWidth) && value.viewportWidth >= 0 && isFiniteNumber(value.viewportHeight) && value.viewportHeight >= 0 && isFiniteNumber(value.documentWidth) && value.documentWidth >= 0 && isFiniteNumber(value.documentHeight) && value.documentHeight >= 0 && isFiniteNumber(value.scrollX) && isFiniteNumber(value.scrollY) && isFiniteNumber(value.devicePixelRatio) && value.devicePixelRatio >= 0;
}
function isScrollEventRecord(value) {
  return isRecord(value) && isFiniteNumber(value.timestampMs) && typeof value.sessionId === "string" && value.sessionId.length > 0 && typeof value.pageId === "string" && value.pageId.length > 0 && isFiniteNumber(value.scrollX) && isFiniteNumber(value.scrollY) && isFiniteNumber(value.deltaX) && isFiniteNumber(value.deltaY) && isFiniteNumber(value.velocityPxPerMs) && value.velocityPxPerMs >= 0 && (value.direction === "UP" || value.direction === "DOWN" || value.direction === "LEFT" || value.direction === "RIGHT" || value.direction === "NONE") && (value.phase === "START" || value.phase === "MOVE" || value.phase === "END") && Number.isInteger(value.tabId) && Number.isInteger(value.browserFrameId);
}
function isScrollEventPayload(payload) {
  return isRecord(payload) && isScrollEventRecord(payload.event);
}
function isFixationEvent(value) {
  return isRecord(value) && typeof value.fixationId === "string" && value.fixationId.length > 0 && typeof value.sessionId === "string" && value.sessionId.length > 0 && typeof value.pageId === "string" && value.pageId.length > 0 && isFiniteNumber(value.startTimeMs) && isFiniteNumber(value.endTimeMs) && isFiniteNumber(value.durationMs) && value.durationMs >= 0 && isPoint2D(value.centroidViewportPoint) && isFiniteNumber(value.dispersionX) && isFiniteNumber(value.dispersionY) && isFiniteNumber(value.dispersionPx) && value.dispersionPx >= 0 && isFiniteNumber(value.sampleCount) && Number.isInteger(value.sampleCount) && value.sampleCount >= 0 && isFiniteNumber(value.qualityMean) && value.qualityMean >= 0 && value.qualityMean <= 1 && isNullableString(value.aoiId) && isFiniteNumber(value.aoiDwellRatio) && value.aoiDwellRatio >= 0 && value.aoiDwellRatio <= 1;
}
function isFixationEventPayload(payload) {
  return isRecord(payload) && isFixationEvent(payload.event) && isFiniteNumber(payload.peakSpeedPxPerSecond) && payload.peakSpeedPxPerSecond >= 0;
}
function isExportSessionPayload(payload) {
  return isRecord(payload) && isNullableString(payload.sessionId) && (payload.format === "JSON" || payload.format === "CSV");
}
function isNullablePoint2DValue(value) {
  return value === null || isPoint2D(value);
}
function isCompletedFixationSnapshotPayload(value) {
  return value === null || isRecord(value) && isFixationEvent(value.event) && isFiniteNumber(value.peakSpeedPxPerSecond) && value.peakSpeedPxPerSecond >= 0;
}
function isViewportContextChangedPayload(payload) {
  return isRecord(payload) && isFiniteNumber(payload.viewportWidth) && payload.viewportWidth > 0 && isFiniteNumber(payload.viewportHeight) && payload.viewportHeight > 0 && isFiniteNumber(payload.devicePixelRatio) && payload.devicePixelRatio > 0;
}
function isAoiProbePayload(payload) {
  return isRecord(payload) && isFiniteNumber(payload.timestampMs) && isPoint2D(payload.normalizedPoint) && isPoint2D(payload.viewportPoint) && (payload.pointSource === "STABILIZED_GAZE" || payload.pointSource === "FIXATION_CENTROID") && isFiniteNumber(payload.gazeQuality) && payload.gazeQuality >= 0 && payload.gazeQuality <= 1 && isNullableString(payload.fixationId) && typeof payload.degradedCollection === "boolean" && isNullablePoint2DValue(payload.rawPredictionNormalizedPoint) && isNullablePoint2DValue(payload.authoritativeNormalizedPoint) && isNullablePoint2DValue(payload.stabilizedNormalizedPoint) && isCompletedFixationSnapshotPayload(payload.completedFixation);
}
function isAoiHitPayload(payload) {
  if (!isRecord(payload) || typeof payload.pageId !== "string" || payload.pageId.length === 0 || !Number.isInteger(payload.browserFrameId) || !isNullableString(payload.fixationId) || payload.pointSource !== "STABILIZED_GAZE" && payload.pointSource !== "FIXATION_CENTROID" || !isFiniteNumber(payload.gazeQuality) || payload.gazeQuality < 0 || payload.gazeQuality > 1 || typeof payload.degradedCollection !== "boolean" || !isPoint2D(payload.probeNormalizedPoint) || !isNullablePoint2DValue(payload.rawPredictionNormalizedPoint) || !isNullablePoint2DValue(payload.authoritativeNormalizedPoint) || !isNullablePoint2DValue(payload.stabilizedNormalizedPoint) || !isCompletedFixationSnapshotPayload(payload.completedFixation) || !isPageCoordinateSnapshot(payload.coordinates) || !(payload.gazeCoordinates === null || isPageCoordinateSnapshot(payload.gazeCoordinates)) || !isRecord(payload.hit) || !isFiniteNumber(payload.hit.timestampMs) || !isNullableString(payload.hit.primaryAoiId) || !Array.isArray(payload.hit.candidates) || payload.hit.candidates.length > AOI.MAX_HIT_CANDIDATES) {
    return false;
  }
  return payload.hit.candidates.every(
    (candidate) => isRecord(candidate) && typeof candidate.aoiId === "string" && candidate.aoiId.length > 0 && isFiniteNumber(candidate.probability) && candidate.probability >= 0 && candidate.probability <= 1 && isFiniteNumber(candidate.distancePx) && candidate.distancePx >= 0 && typeof candidate.inside === "boolean"
  );
}
function isAoiRegistryEntry(value) {
  return isRecord(value) && typeof value.aoiId === "string" && value.aoiId.length > 0 && typeof value.pageId === "string" && value.pageId.length > 0 && Number.isInteger(value.browserFrameId) && typeof value.tagName === "string" && isNullableString(value.elementId) && isNullableString(value.role) && isNullableString(value.ariaLabel) && isNullableString(value.elementName) && isNullableString(value.textLabel) && isNullableString(value.textHash) && typeof value.cssSelector === "string" && typeof value.domPath === "string" && typeof value.aoiType === "string" && typeof value.interactive === "boolean" && isRect2D(value.viewportRect) && isRect2D(value.documentRect) && typeof value.visible === "boolean" && typeof value.enabled === "boolean" && (value.textStoragePolicy === "RAW" || value.textStoragePolicy === "HASHED" || value.textStoragePolicy === "NONE") && isFiniteNumber(value.createdAtEpochMs) && isFiniteNumber(value.updatedAtEpochMs);
}
function isAoiRegistryUpdatePayload(payload) {
  return isRecord(payload) && typeof payload.pageId === "string" && payload.pageId.length > 0 && Number.isInteger(payload.browserFrameId) && Array.isArray(payload.upserted) && payload.upserted.every(isAoiRegistryEntry) && Array.isArray(payload.removedAoiIds) && payload.removedAoiIds.every(
    (aoiId) => typeof aoiId === "string" && aoiId.length > 0
  ) && typeof payload.fullSnapshot === "boolean";
}
function createResponseMeta(requestMeta, sessionId = requestMeta.sessionId, pageId = requestMeta.pageId) {
  const target = requestMeta.source;
  return {
    messageId: createMessageId(),
    sentAtEpochMs: nowEpochMs(),
    source: "BACKGROUND",
    target,
    sessionId,
    pageId,
    tabId: requestMeta.tabId,
    browserFrameId: requestMeta.browserFrameId
  };
}
function resolveFacePositionTargetTab(sessionId, preferredTabId = null) {
  if (sessionId === null) {
    return null;
  }
  if (preferredTabId !== null) {
    const preferred = tabManager.getTab(
      preferredTabId
    );
    if (preferred !== null && preferred.sessionId === sessionId && preferred.active) {
      return preferred;
    }
  }
  const tracked = tabManager.getTrackedTabsForSession(
    sessionId
  );
  return tracked.find(
    (tab) => tab.active
  ) ?? tracked[0] ?? null;
}
async function forwardFacePositionStatusToContent(payload, preferredTabId = null) {
  const sessionId = sessionManager.getActiveSessionId();
  const targetTab = resolveFacePositionTargetTab(
    sessionId,
    preferredTabId
  );
  if (targetTab === null) {
    logger5.debug(
      "Pre-calibration status has no tracked Content target."
    );
    return;
  }
  const message = createRuntimeMessage(
    MESSAGE_TYPES.FACE_POSITION_STATUS,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "CONTENT",
      sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    {
      status: {
        ...payload.status
      },
      feedback: {
        ...payload.feedback,
        status: {
          ...payload.feedback.status
        },
        cameraFaceBoxNormalized: payload.feedback.cameraFaceBoxNormalized === null ? null : {
          ...payload.feedback.cameraFaceBoxNormalized
        },
        metrics: {
          ...payload.feedback.metrics
        }
      }
    }
  );
  try {
    await chrome.tabs.sendMessage(
      targetTab.tabId,
      message,
      {
        frameId: 0
      }
    );
  } catch (error) {
    logger5.debug(
      "Pre-calibration status could not be delivered to the research tab.",
      {
        tabId: targetTab.tabId,
        transportError: error instanceof Error ? error.message : "Unknown Content transport error"
      }
    );
  }
}
function getOffscreenDocumentUrl() {
  return chrome.runtime.getURL(
    OFFSCREEN_RUNTIME.DOCUMENT_PATH
  );
}
async function hasOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [
        chrome.runtime.ContextType.OFFSCREEN_DOCUMENT
      ],
      documentUrls: [
        getOffscreenDocumentUrl()
      ]
    });
    return contexts.length > 0;
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "BACKGROUND",
      "Failed to inspect the Offscreen Document context.",
      {
        recoverable: false
      }
    );
  }
}
async function createOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_RUNTIME.DOCUMENT_PATH,
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA
      ],
      justification: OFFSCREEN_RUNTIME.CREATE_JUSTIFICATION
    });
    logger5.info(
      "Offscreen Document created."
    );
  } catch (error) {
    if (await hasOffscreenDocument()) {
      logger5.debug(
        "Offscreen Document already exists after create race."
      );
      return;
    }
    throw normalizeTrackerError(
      error,
      ERROR_CODES.OFFSCREEN_CREATE_FAILED,
      "BACKGROUND",
      "Failed to create the Offscreen Document.",
      {
        recoverable: false,
        details: {
          documentPath: OFFSCREEN_RUNTIME.DOCUMENT_PATH
        }
      }
    );
  }
}
function sendOffscreenPingWithTimeout(nonce) {
  const message = createRuntimeMessage(
    MESSAGE_TYPES.PING,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: sessionManager.getActiveSessionId(),
      pageId: null,
      tabId: null,
      browserFrameId: null
    },
    {
      nonce
    }
  );
  return new Promise(
    (resolve, reject) => {
      const timeoutId = globalThis.setTimeout(
        () => {
          reject(
            new TrackerError(
              ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
              "BACKGROUND",
              "Offscreen health check timed out.",
              {
                recoverable: false,
                details: {
                  timeoutMs: OFFSCREEN_RUNTIME.HEALTH_CHECK_TIMEOUT_MS
                }
              }
            )
          );
        },
        OFFSCREEN_RUNTIME.HEALTH_CHECK_TIMEOUT_MS
      );
      void chrome.runtime.sendMessage(message).then(
        (response) => {
          globalThis.clearTimeout(
            timeoutId
          );
          resolve(response);
        },
        (error) => {
          globalThis.clearTimeout(
            timeoutId
          );
          reject(
            normalizeTrackerError(
              error,
              ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
              "BACKGROUND",
              "Offscreen PING transport failed.",
              {
                recoverable: false
              }
            )
          );
        }
      );
    }
  );
}
async function pingOffscreenDocument() {
  const nonce = createMessageId();
  let rawResponse;
  try {
    rawResponse = await sendOffscreenPingWithTimeout(
      nonce
    );
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "BACKGROUND",
      "Offscreen health check could not reach the runtime.",
      {
        recoverable: false
      }
    );
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.PONG || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || rawResponse.meta.target !== "BACKGROUND" || !isPongPayload(
    rawResponse.payload
  ) || rawResponse.payload.nonce !== nonce) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "BACKGROUND",
      "Offscreen health check returned an invalid PONG response.",
      {
        recoverable: false
      }
    );
  }
}
async function waitForHealthyOffscreenDocument() {
  let lastError = null;
  for (let attempt = 1; attempt <= OFFSCREEN_RUNTIME.HEALTH_CHECK_MAX_ATTEMPTS; attempt += 1) {
    try {
      await pingOffscreenDocument();
      logger5.debug(
        "Offscreen health check passed.",
        {
          attempt
        }
      );
      return;
    } catch (error) {
      lastError = error;
      logger5.debug(
        "Offscreen health check attempt failed while the document may still be bootstrapping.",
        {
          attempt,
          maxAttempts: OFFSCREEN_RUNTIME.HEALTH_CHECK_MAX_ATTEMPTS,
          transportError: error instanceof Error ? error.message : "Unknown Offscreen transport error"
        }
      );
      if (attempt >= OFFSCREEN_RUNTIME.HEALTH_CHECK_MAX_ATTEMPTS) {
        break;
      }
      await sleep(
        OFFSCREEN_RUNTIME.HEALTH_CHECK_RETRY_DELAY_MS
      );
    }
  }
  throw normalizeTrackerError(
    lastError,
    ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
    "BACKGROUND",
    "Offscreen runtime did not become healthy.",
    {
      recoverable: true,
      details: {
        attempts: OFFSCREEN_RUNTIME.HEALTH_CHECK_MAX_ATTEMPTS
      }
    }
  );
}
async function recreateOffscreenDocumentAfterHealthFailure(originalError) {
  logger5.warn(
    "Existing Offscreen context did not answer health checks; recreating it once.",
    {
      originalError: originalError instanceof Error ? originalError.message : "Unknown Offscreen health error"
    }
  );
  await closeOffscreenDocumentIfPresent();
  await createOffscreenDocument();
  await sleep(
    OFFSCREEN_RUNTIME.BOOTSTRAP_GRACE_MS
  );
  await waitForHealthyOffscreenDocument();
}
async function ensureOffscreenDocumentInternal() {
  const alreadyExists = await hasOffscreenDocument();
  if (!alreadyExists) {
    await createOffscreenDocument();
    await sleep(
      OFFSCREEN_RUNTIME.BOOTSTRAP_GRACE_MS
    );
  } else {
    logger5.debug(
      "Reusing existing Offscreen Document."
    );
  }
  try {
    await waitForHealthyOffscreenDocument();
    return;
  } catch (error) {
    if (OFFSCREEN_RUNTIME.STALE_CONTEXT_RECOVERY_ATTEMPTS >= 1) {
      await recreateOffscreenDocumentAfterHealthFailure(
        error
      );
      return;
    }
    throw error;
  }
}
async function ensureOffscreenDocument() {
  if (ensureOffscreenPromise === null) {
    ensureOffscreenPromise = ensureOffscreenDocumentInternal();
  }
  const pending = ensureOffscreenPromise;
  try {
    await pending;
  } finally {
    if (ensureOffscreenPromise === pending) {
      ensureOffscreenPromise = null;
    }
  }
}
async function closeOffscreenDocumentIfPresent() {
  ensureOffscreenPromise = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (!await hasOffscreenDocument()) {
      return;
    }
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }
      await sleep(50);
      continue;
    }
    if (!await hasOffscreenDocument()) {
      logger5.info(
        "Offscreen Document closed for tracker reset.",
        { attempt }
      );
      return;
    }
    if (attempt < 2) {
      await sleep(50);
    }
  }
  throw new TrackerError(
    ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
    "BACKGROUND",
    "Offscreen Document remained open after tracker reset."
  );
}
async function syncTrackingContextToOffscreen(trackedTab, reason) {
  await ensureOffscreenDocument();
  try {
    await experimentStorage.recordNavigation(
      trackedTab.sessionId,
      trackedTab.currentPageId,
      trackedTab.tabId,
      reason,
      trackedTab.url
    );
  } catch (error) {
    logger5.warn(
      "Research-page navigation context could not be persisted.",
      {
        sessionId: trackedTab.sessionId,
        pageId: trackedTab.currentPageId,
        tabId: trackedTab.tabId,
        reason,
        storageError: error instanceof Error ? error.message : "Unknown storage error"
      }
    );
  }
  const message = createRuntimeMessage(
    MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: trackedTab.sessionId,
      pageId: trackedTab.currentPageId,
      tabId: trackedTab.tabId,
      browserFrameId: 0
    },
    {
      reason,
      url: trackedTab.url
    }
  );
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    logger5.debug(
      "Research-page context could not be synchronized to Offscreen.",
      {
        sessionId: trackedTab.sessionId,
        tabId: trackedTab.tabId,
        pageId: trackedTab.currentPageId,
        reason,
        transportError: error instanceof Error ? error.message : "Unknown Offscreen transport error"
      }
    );
  }
}
function parseOffscreenErrorResponse(rawResponse) {
  if (!isRecord(rawResponse) || rawResponse.ok !== false || !isRecord(rawResponse.error)) {
    return null;
  }
  const error = rawResponse.error;
  if (!isTrackerErrorCode(
    error.code
  ) || typeof error.message !== "string" || !isDiagnosticComponent(
    error.component
  ) || typeof error.recoverable !== "boolean" || !(error.details === null || isRecord(error.details))) {
    return null;
  }
  return new TrackerError(
    error.code,
    error.component,
    error.message,
    {
      recoverable: error.recoverable,
      details: error.details
    }
  );
}
async function startCameraInOffscreen(payload) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_CAMERA,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: sessionManager.getActiveSessionId(),
      pageId: null,
      tabId: null,
      browserFrameId: null
    },
    payload
  );
  let rawResponse;
  try {
    rawResponse = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CAMERA_START_FAILED,
      "BACKGROUND",
      "Failed to send START_CAMERA to the Offscreen runtime."
    );
  }
  const offscreenError = parseOffscreenErrorResponse(
    rawResponse
  );
  if (offscreenError !== null) {
    throw offscreenError;
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.CAMERA_READY || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || rawResponse.meta.target !== "BACKGROUND" || !isCameraReadyPayload(
    rawResponse.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid CAMERA_READY response."
    );
  }
  return {
    settings: {
      ...rawResponse.payload.settings
    }
  };
}
async function startFacePositioningInOffscreen() {
  await ensureOffscreenDocument();
  const activeSessionId = sessionManager.getActiveSessionId();
  const targetTab = resolveFacePositionTargetTab(
    activeSessionId
  );
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_FACE_POSITIONING,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: activeSessionId,
      pageId: targetTab?.currentPageId ?? null,
      tabId: targetTab?.tabId ?? null,
      browserFrameId: targetTab === null ? null : 0
    },
    {}
  );
  let rawResponse;
  try {
    rawResponse = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.MEDIAPIPE_INIT_FAILED,
      "BACKGROUND",
      "Failed to send START_FACE_POSITIONING to the Offscreen runtime."
    );
  }
  const offscreenError = parseOffscreenErrorResponse(
    rawResponse
  );
  if (offscreenError !== null) {
    throw offscreenError;
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.FACE_POSITION_STATUS || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || rawResponse.meta.target !== "BACKGROUND" || !isFacePositionStatusPayload(
    rawResponse.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid FACE_POSITION_STATUS response."
    );
  }
  return {
    status: {
      ...rawResponse.payload.status
    },
    feedback: {
      ...rawResponse.payload.feedback,
      status: {
        ...rawResponse.payload.feedback.status
      },
      cameraFaceBoxNormalized: rawResponse.payload.feedback.cameraFaceBoxNormalized === null ? null : {
        ...rawResponse.payload.feedback.cameraFaceBoxNormalized
      },
      metrics: {
        ...rawResponse.payload.feedback.metrics
      }
    }
  };
}
async function startCalibrationInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_CALIBRATION,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  let rawResponse;
  try {
    rawResponse = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "BACKGROUND",
      "Failed to start calibration in the Offscreen runtime."
    );
  }
  const offscreenError = parseOffscreenErrorResponse(
    rawResponse
  );
  if (offscreenError !== null) {
    throw offscreenError;
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.START_CALIBRATION || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isStartCalibrationPayload(
    rawResponse.payload
  ) || rawResponse.payload.calibrationId !== payload.calibrationId) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid START_CALIBRATION response."
    );
  }
}
async function collectCalibrationPointInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.CALIBRATION_POINT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  let rawResponse;
  try {
    rawResponse = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "BACKGROUND",
      "Failed to collect a calibration point in the Offscreen runtime."
    );
  }
  const offscreenError = parseOffscreenErrorResponse(
    rawResponse
  );
  if (offscreenError !== null) {
    throw offscreenError;
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.CALIBRATION_POINT_RESULT || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isCalibrationPointResultPayload(
    rawResponse.payload
  ) || rawResponse.payload.calibrationId !== payload.calibrationId || rawResponse.payload.pointIndex !== payload.target.pointIndex) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid CALIBRATION_POINT_RESULT response."
    );
  }
  return {
    ...rawResponse.payload
  };
}
async function startValidationInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_VALIDATION,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  let rawResponse;
  try {
    rawResponse = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "BACKGROUND",
      "Failed to start independent validation in the Offscreen runtime."
    );
  }
  const offscreenError = parseOffscreenErrorResponse(
    rawResponse
  );
  if (offscreenError !== null) {
    throw offscreenError;
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.START_VALIDATION || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isStartValidationPayload(
    rawResponse.payload
  ) || rawResponse.payload.calibrationId !== payload.calibrationId) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid START_VALIDATION response."
    );
  }
}
async function collectValidationPointInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.VALIDATION_POINT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  let rawResponse;
  try {
    rawResponse = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "BACKGROUND",
      "Failed to collect an independent validation point in the Offscreen runtime."
    );
  }
  const offscreenError = parseOffscreenErrorResponse(
    rawResponse
  );
  if (offscreenError !== null) {
    throw offscreenError;
  }
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(
    rawResponse.protocolVersion
  ) || rawResponse.type !== MESSAGE_TYPES.VALIDATION_POINT_RESULT || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isValidationPointResultPayload(
    rawResponse.payload
  ) || rawResponse.payload.calibrationId !== payload.calibrationId || rawResponse.payload.pointIndex !== payload.target.pointIndex) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid VALIDATION_POINT_RESULT response."
    );
  }
  return {
    ...rawResponse.payload,
    metrics: rawResponse.payload.metrics === null ? null : {
      ...rawResponse.payload.metrics
    }
  };
}
async function startQuickRecalibrationInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_QUICK_RECALIBRATION,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  const rawResponse = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(rawResponse.protocolVersion) || rawResponse.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isRecord(rawResponse.payload) || rawResponse.payload.calibrationId !== payload.calibrationId || !isFiniteNumber(rawResponse.payload.startingPointIndex) || !Number.isInteger(rawResponse.payload.startingPointIndex) || !isFiniteNumber(rawResponse.payload.expectedPointCount) || !Number.isInteger(rawResponse.payload.expectedPointCount) || rawResponse.payload.pointCount !== payload.pointCount || typeof rawResponse.payload.runId !== "string" || rawResponse.payload.runId.length === 0) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen returned an invalid QUICK_RECALIBRATION_STARTED response."
    );
  }
  return {
    calibrationId: rawResponse.payload.calibrationId,
    startingPointIndex: rawResponse.payload.startingPointIndex,
    expectedPointCount: rawResponse.payload.expectedPointCount,
    pointCount: rawResponse.payload.pointCount,
    runId: rawResponse.payload.runId
  };
}
async function collectQuickRecalibrationPointInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.QUICK_RECALIBRATION_POINT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  const rawResponse = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(rawResponse.protocolVersion) || rawResponse.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isCalibrationPointResultPayload(rawResponse.payload)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen returned an invalid QUICK_RECALIBRATION_POINT_RESULT response."
    );
  }
  return { ...rawResponse.payload };
}
async function startQuickValidationInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_QUICK_VALIDATION,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  const rawResponse = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(rawResponse.protocolVersion) || rawResponse.type !== MESSAGE_TYPES.START_QUICK_VALIDATION || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isStartQuickValidationPayload(rawResponse.payload)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen returned an invalid START_QUICK_VALIDATION response."
    );
  }
}
async function collectQuickValidationPointInOffscreen(payload, targetTab) {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.QUICK_VALIDATION_POINT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "OFFSCREEN",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  const rawResponse = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (!isRecord(rawResponse) || !isCompatibleMessageProtocol(rawResponse.protocolVersion) || rawResponse.type !== MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT || !isRecord(rawResponse.meta) || rawResponse.meta.source !== "OFFSCREEN" || !isValidationPointResultPayload(rawResponse.payload)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen returned an invalid QUICK_VALIDATION_POINT_RESULT response."
    );
  }
  return {
    ...rawResponse.payload,
    metrics: rawResponse.payload.metrics === null ? null : { ...rawResponse.payload.metrics }
  };
}
function createCalibrationUiReadySignalKey(calibrationId, sessionId, pageId, tabId) {
  return `${tabId}::${sessionId}::${pageId}::${calibrationId}`;
}
function waitForCalibrationUiReadySignal(calibrationId, sessionId, pageId, tabId, timeoutMs = 350) {
  const key = createCalibrationUiReadySignalKey(
    calibrationId,
    sessionId,
    pageId,
    tabId
  );
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = self.setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingCalibrationUiReadySignals.delete(key);
      resolve(false);
    }, timeoutMs);
    pendingCalibrationUiReadySignals.set(key, (value) => {
      if (settled) return;
      settled = true;
      self.clearTimeout(timeoutId);
      pendingCalibrationUiReadySignals.delete(key);
      resolve(value);
    });
  });
}
function resolveCalibrationUiReadySignal(calibrationId, sessionId, pageId, tabId) {
  const key = createCalibrationUiReadySignalKey(
    calibrationId,
    sessionId,
    pageId,
    tabId
  );
  const resolver = pendingCalibrationUiReadySignals.get(key);
  if (resolver === void 0) return false;
  resolver(true);
  return true;
}
async function ensureResearchContentScriptsInjected(tab) {
  const nonce = createMessageId();
  const ping = createRuntimeMessage(
    MESSAGE_TYPES.PING,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "CONTENT",
      sessionId: tab.sessionId,
      pageId: tab.currentPageId,
      tabId: tab.tabId,
      browserFrameId: 0
    },
    { nonce }
  );
  let eyeAlive = false;
  try {
    const response = await chrome.tabs.sendMessage(
      tab.tabId,
      ping,
      { frameId: 0 }
    );
    eyeAlive = isRecord(response) && isCompatibleMessageProtocol(response.protocolVersion) && response.type === MESSAGE_TYPES.PONG && isRecord(response.meta) && response.meta.source === "CONTENT" && isRecord(response.payload) && response.payload.nonce === nonce;
  } catch {
  }
  if (!eyeAlive && chrome.scripting?.executeScript) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      files: ["content/contentScript.js"]
    });
    logger5.info(
      "Repaired missing research-tab eye Content Script.",
      { tabId: tab.tabId, pageId: tab.currentPageId }
    );
  }
  let mouseAlive = false;
  try {
    const response = await chrome.tabs.sendMessage(
      tab.tabId,
      { type: "UXDS_PING" },
      { frameId: 0 }
    );
    mouseAlive = isRecord(response) && response.success === true;
  } catch {
  }
  if (!mouseAlive && chrome.scripting?.executeScript) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      files: ["uxds/mouseContent.js"]
    });
    logger5.info(
      "Repaired missing research-tab mouse Content Script.",
      { tabId: tab.tabId, pageId: tab.currentPageId }
    );
  }
}
async function forwardStartCalibrationToContent(payload, targetTab, flowGeneration) {
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_CALIBRATION,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND",
      target: "CONTENT",
      sessionId: targetTab.sessionId,
      pageId: targetTab.currentPageId,
      tabId: targetTab.tabId,
      browserFrameId: 0
    },
    payload
  );
  const maxAttempts = 12;
  const retryDelayMs = 75;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (flowGeneration !== calibrationFlowGeneration) {
      return false;
    }
    try {
      await ensureResearchContentScriptsInjected(
        targetTab
      );
      const readySignalPromise = waitForCalibrationUiReadySignal(
        payload.calibrationId,
        targetTab.sessionId,
        targetTab.currentPageId,
        targetTab.tabId
      );
      const acknowledgement = await chrome.tabs.sendMessage(
        targetTab.tabId,
        message,
        {
          frameId: 0
        }
      );
      const acknowledgedByResponse = isCalibrationUiReadyAcknowledgement(
        acknowledgement,
        payload.calibrationId,
        targetTab.sessionId,
        targetTab.currentPageId
      );
      const acknowledgedBySignal = acknowledgedByResponse ? true : await readySignalPromise;
      if (!acknowledgedByResponse && !acknowledgedBySignal) {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "Content Script did not acknowledge mounting the calibration UI."
        );
      }
      if (attempt > 1) {
        logger5.debug(
          "Calibration UI delivery recovered after a document-navigation race.",
          {
            tabId: targetTab.tabId,
            attempt
          }
        );
      }
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }
  throw normalizeTrackerError(
    lastError,
    ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE,
    "BACKGROUND",
    "Calibration UI could not be started on the research tab after waiting for the new Content Script."
  );
}
async function beginCalibrationAfterFaceReady(preferredTabId) {
  if (calibrationStartPromise !== null) {
    return calibrationStartPromise;
  }
  if (nowEpochMs() < calibrationUiRetryAfterEpochMs) {
    return;
  }
  const flowGeneration = calibrationFlowGeneration;
  const startup = beginCalibrationAfterFaceReadyInternal(
    preferredTabId,
    flowGeneration
  ).finally(
    () => {
      if (calibrationStartPromise === startup) {
        calibrationStartPromise = null;
      }
    }
  );
  calibrationStartPromise = startup;
  return startup;
}
async function beginCalibrationAfterFaceReadyInternal(preferredTabId, flowGeneration) {
  const currentState = trackerStateMachine.getSnapshot().state;
  if (currentState !== TRACKER_STATES.FACE_POSITIONING || flowGeneration !== calibrationFlowGeneration) {
    return;
  }
  const sessionId = sessionManager.getActiveSessionId();
  const targetTab = resolveFacePositionTargetTab(
    sessionId,
    preferredTabId
  );
  if (sessionId === null || targetTab === null) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "Calibration could not resolve the active research tab."
    );
  }
  const targetPageId = targetTab.currentPageId;
  const payload = {
    calibrationId: createCalibrationId(),
    mode: CALIBRATION.DEFAULT_MODE
  };
  transitionOrThrow(
    TRACKER_STATES.CALIBRATING
  );
  try {
    await startCalibrationInOffscreen(
      payload,
      targetTab
    );
    const currentTargetTab = tabManager.getTab(
      targetTab.tabId
    );
    if (flowGeneration !== calibrationFlowGeneration || trackerStateMachine.getSnapshot().state !== TRACKER_STATES.CALIBRATING || currentTargetTab === null || currentTargetTab.sessionId !== sessionId || currentTargetTab.currentPageId !== targetPageId) {
      return;
    }
    const delivered = await forwardStartCalibrationToContent(
      payload,
      targetTab,
      flowGeneration
    );
    if (!delivered || flowGeneration !== calibrationFlowGeneration) {
      return;
    }
    calibrationUiRetryAfterEpochMs = 0;
    logger5.info(
      "Calibration UI started after pre-calibration completion.",
      {
        calibrationId: payload.calibrationId,
        mode: payload.mode,
        tabId: targetTab.tabId
      }
    );
  } catch (error) {
    if (flowGeneration !== calibrationFlowGeneration) {
      return;
    }
    if (trackerStateMachine.getSnapshot().state === TRACKER_STATES.CALIBRATING && trackerStateMachine.canTransition(
      TRACKER_STATES.FACE_POSITIONING
    )) {
      trackerStateMachine.transition(
        TRACKER_STATES.FACE_POSITIONING
      );
    }
    if (error instanceof TrackerError && error.code === ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE) {
      calibrationUiRetryAfterEpochMs = nowEpochMs() + 2e3;
      logger5.warn(
        "Calibration UI delivery was not acknowledged; retry after confirming the research tab is a supported http/https page and reloading it.",
        {
          tabId: targetTab.tabId,
          calibrationId: payload.calibrationId,
          reason: error.message
        }
      );
      return;
    }
    throw error;
  }
}
function transitionOrThrow(nextState) {
  const result = trackerStateMachine.transition(
    nextState
  );
  if (result.ok) {
    logger5.info(
      "Tracker state changed.",
      {
        state: result.snapshot.state,
        previousState: result.snapshot.previousState,
        sequence: result.snapshot.sequence
      }
    );
    return;
  }
  throw new TrackerError(
    ERROR_CODES.INVALID_STATE_TRANSITION,
    "BACKGROUND",
    "Tracker state transition was rejected.",
    {
      details: {
        from: result.from,
        to: result.to,
        reason: result.reason
      }
    }
  );
}
function transitionToErrorIfPossible(error) {
  const snapshot = trackerStateMachine.getSnapshot();
  if (snapshot.state === TRACKER_STATES.ERROR) {
    return;
  }
  if (!trackerStateMachine.canTransition(
    TRACKER_STATES.ERROR
  )) {
    logger5.warn(
      "Fatal tracker error could not change the current tracker state to ERROR.",
      {
        state: snapshot.state,
        code: error.code,
        component: error.component
      }
    );
    return;
  }
  const result = trackerStateMachine.transition(
    TRACKER_STATES.ERROR
  );
  if (!result.ok) {
    logger5.error(
      "Tracker ERROR transition failed while handling a fatal runtime error.",
      {
        code: error.code,
        reason: result.reason
      }
    );
    return;
  }
  logger5.error(
    "Tracker entered ERROR state after a fatal runtime error.",
    {
      code: error.code,
      component: error.component,
      sequence: result.snapshot.sequence
    }
  );
}
function toTabDescriptor(tab, forcedOpenerTabId = null, forcedUrl = null) {
  if (tab.id === void 0 || tab.id < 0) {
    return null;
  }
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    openerTabId: forcedOpenerTabId ?? tab.openerTabId ?? null,
    url: forcedUrl ?? tab.url ?? null,
    active: tab.active
  };
}
async function getInitialResearchTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const tab = tabs[0];
  if (tab === void 0 || tab.id === void 0) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "No active research tab could be identified."
    );
  }
  const url = tab.url ?? null;
  if (url === null || !isHttpOrHttpsUrl(url)) {
    throw new TrackerError(
      ERROR_CODES.PAGE_CONTEXT_INVALID,
      "BACKGROUND",
      "Eye tracking must be started from a normal HTTP or HTTPS webpage.",
      {
        details: {
          tabId: tab.id
        }
      }
    );
  }
  return tab;
}
async function associateInitialResearchTab(sessionId) {
  const tab = await getInitialResearchTab();
  const descriptor = toTabDescriptor(tab);
  if (descriptor === null) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "The active research tab has no valid tab ID."
    );
  }
  const result = tabManager.associateInitialTab(
    descriptor,
    sessionId
  );
  if (!result.ok) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "The initial research tab could not be associated with the session.",
      {
        details: {
          tabId: descriptor.tabId,
          reason: result.reason
        }
      }
    );
  }
  await syncTrackingContextToOffscreen(
    result.association,
    "TAB_ASSOCIATED"
  );
  return result.association;
}
function registerCoreMessageRoutes() {
  messageRouter.register(
    MESSAGE_TYPES.PING,
    isPingPayload,
    (message) => {
      return createRuntimeMessage(
        MESSAGE_TYPES.PONG,
        createResponseMeta(
          message.meta
        ),
        {
          nonce: message.payload.nonce
        }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.TRACKER_ERROR,
    isTrackerErrorPayload,
    (message) => {
      const error = message.payload;
      const logDetails = {
        code: error.code,
        component: error.component,
        recoverable: error.recoverable,
        source: message.meta.source,
        sessionId: message.meta.sessionId
      };
      if (error.recoverable) {
        logger5.warn(
          "Recoverable tracker error reported to Background.",
          logDetails
        );
      } else {
        logger5.error(
          "Fatal tracker error reported to Background.",
          logDetails
        );
        transitionToErrorIfPossible(
          error
        );
      }
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.START_CAMERA,
    isStartCameraPayload,
    async (message) => {
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.INITIALIZING) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Camera may only start while the tracker is INITIALIZING.",
          {
            details: {
              currentState
            }
          }
        );
      }
      if (!sessionManager.hasActiveSession()) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Camera cannot start without an active experiment session."
        );
      }
      try {
        const cameraReady = await startCameraInOffscreen(
          message.payload
        );
        const updateResult = sessionManager.setCameraSettings(
          cameraReady.settings
        );
        if (!updateResult.ok) {
          throw new TrackerError(
            ERROR_CODES.INVALID_STATE_TRANSITION,
            "BACKGROUND",
            "Actual camera settings could not be attached to the active session.",
            {
              recoverable: false,
              details: {
                reason: updateResult.reason
              }
            }
          );
        }
        await experimentStorage.putSession(
          updateResult.session
        );
        transitionOrThrow(
          TRACKER_STATES.CAMERA_READY
        );
        return createRuntimeMessage(
          MESSAGE_TYPES.CAMERA_READY,
          createResponseMeta(
            message.meta,
            updateResult.session.sessionId
          ),
          {
            settings: {
              ...cameraReady.settings
            }
          }
        );
      } catch (error) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.CAMERA_START_FAILED,
          "BACKGROUND",
          "Camera startup failed."
        );
        if (!normalized.recoverable) {
          transitionToErrorIfPossible(
            normalized.toSerializable()
          );
        }
        throw normalized;
      }
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.START_FACE_POSITIONING,
    isEmptyPayload,
    async (message) => {
      const currentState = trackerStateMachine.getSnapshot().state;
      const maintenanceRestart = currentState === TRACKER_STATES.READY || currentState === TRACKER_STATES.RECORDING || currentState === TRACKER_STATES.PAUSED;
      if (currentState !== TRACKER_STATES.CAMERA_READY && !maintenanceRestart) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Face positioning may only start after camera setup or as a maintenance recalibration.",
          { details: { currentState } }
        );
      }
      if (!sessionManager.hasActiveSession()) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Face positioning cannot start without an active experiment session."
        );
      }
      if (!maintenanceRestart) {
        transitionOrThrow(TRACKER_STATES.MODEL_LOADING);
      }
      try {
        const status = await startFacePositioningInOffscreen();
        transitionOrThrow(TRACKER_STATES.FACE_POSITIONING);
        if (maintenanceRestart) {
          calibrationFlowGeneration += 1;
          await experimentStorage.recordMaintenanceEvent(
            sessionManager.getActiveSessionId(),
            message.meta.pageId,
            "FULL_RECALIBRATION_ESCALATED",
            { previousState: currentState }
          );
        }
        await forwardFacePositionStatusToContent(
          status
        );
        return createRuntimeMessage(
          MESSAGE_TYPES.FACE_POSITION_STATUS,
          createResponseMeta(
            message.meta,
            sessionManager.getActiveSessionId()
          ),
          {
            status: {
              ...status.status
            },
            feedback: {
              ...status.feedback,
              status: {
                ...status.feedback.status
              },
              cameraFaceBoxNormalized: status.feedback.cameraFaceBoxNormalized === null ? null : {
                ...status.feedback.cameraFaceBoxNormalized
              },
              metrics: {
                ...status.feedback.metrics
              }
            }
          }
        );
      } catch (error) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.MEDIAPIPE_INIT_FAILED,
          "BACKGROUND",
          "Face positioning startup failed."
        );
        transitionToErrorIfPossible(
          normalized.toSerializable()
        );
        throw normalized;
      }
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.FACE_POSITION_STATUS,
    isFacePositionStatusPayload,
    async (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "FACE_POSITION_STATUS may only originate from the Offscreen runtime."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.FACE_POSITIONING) {
        return null;
      }
      if (message.payload.feedback.readyForCalibration) {
        await beginCalibrationAfterFaceReady(
          message.meta.tabId
        );
        return null;
      }
      await forwardFacePositionStatusToContent(
        message.payload,
        message.meta.tabId
      );
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.CALIBRATION_UI_READY,
    (payload) => isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && payload.accepted === true,
    (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "CALIBRATION_UI_READY may only originate from the research-tab Content context."
        );
      }
      if (typeof message.meta.sessionId !== "string" || typeof message.meta.pageId !== "string" || typeof context.senderTabId !== "number" || !Number.isFinite(context.senderTabId)) {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "Calibration UI acknowledgement is missing routing metadata."
        );
      }
      resolveCalibrationUiReadySignal(
        message.payload.calibrationId,
        message.meta.sessionId,
        message.meta.pageId,
        context.senderTabId
      );
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.CALIBRATION_POINT,
    isCalibrationPointPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "CALIBRATION_POINT may only originate from the research-tab Content context."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.CALIBRATING) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Calibration points may only be collected while CALIBRATING.",
          {
            details: {
              currentState
            }
          }
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(
        sessionId,
        context.senderTabId
      );
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Calibration point did not originate from the active research tab."
        );
      }
      const result = await collectCalibrationPointInOffscreen(
        message.payload,
        targetTab
      );
      if (result.modelReady) {
        transitionOrThrow(
          TRACKER_STATES.VALIDATING
        );
        logger5.info(
          "Calibration model is ready; independent validation is now required.",
          {
            calibrationId: result.calibrationId,
            completedPointCount: result.completedPointCount,
            trainingRmseNormalized: result.trainingRmseNormalized,
            trainingDiagnostics: result.trainingDiagnostics
          }
        );
      }
      return createRuntimeMessage(
        MESSAGE_TYPES.CALIBRATION_POINT_RESULT,
        createResponseMeta(
          message.meta,
          sessionId,
          targetTab.currentPageId
        ),
        {
          ...result
        }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.START_QUICK_RECALIBRATION,
    isStartQuickRecalibrationPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "START_QUICK_RECALIBRATION may only originate from Content."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.READY && currentState !== TRACKER_STATES.RECORDING && currentState !== TRACKER_STATES.PAUSED) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Quick recalibration is only available after independent validation."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Quick recalibration did not originate from the active research tab."
        );
      }
      const started = await startQuickRecalibrationInOffscreen(
        message.payload,
        targetTab
      );
      logger5.info("Quick recalibration runtime started.", {
        calibrationId: started.calibrationId,
        startingPointIndex: started.startingPointIndex,
        pointCount: started.pointCount,
        expectedPointCount: started.expectedPointCount
      });
      await experimentStorage.recordMaintenanceEvent(
        sessionId,
        targetTab.currentPageId,
        "QUICK_RECALIBRATION_STARTED",
        {
          calibrationId: started.calibrationId,
          startingPointIndex: started.startingPointIndex,
          pointCount: started.pointCount,
          expectedPointCount: started.expectedPointCount
        }
      );
      return createRuntimeMessage(
        MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED,
        createResponseMeta(message.meta, sessionId, targetTab.currentPageId),
        started
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
    (payload) => isRecord(payload) && typeof payload.calibrationId === "string" && payload.calibrationId.length > 0 && typeof payload.runId === "string" && payload.runId.length > 0,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "Only Content may abort quick recalibration."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const tab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || tab === null || context.senderTabId !== tab.tabId || message.meta.sessionId !== sessionId || message.meta.pageId !== tab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Quick abort was not sent by the active research page."
        );
      }
      await ensureOffscreenDocument();
      const request = createRuntimeMessage(
        MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "BACKGROUND",
          target: "OFFSCREEN",
          sessionId,
          pageId: tab.currentPageId,
          tabId: tab.tabId,
          browserFrameId: 0
        },
        message.payload
      );
      const response = await chrome.runtime.sendMessage(request);
      const failure = parseOffscreenErrorResponse(response);
      if (failure !== null) throw failure;
      if (!isRecord(response) || response.type !== MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION || !isRecord(response.payload) || typeof response.payload.rolledBack !== "boolean") {
        throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "BACKGROUND", "Invalid quick abort response.");
      }
      return createRuntimeMessage(
        MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
        createResponseMeta(message.meta, sessionId, tab.currentPageId),
        { ...message.payload, rolledBack: response.payload.rolledBack }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.QUICK_RECALIBRATION_POINT,
    (payload) => isCalibrationPointPayload(payload) && isRecord(payload) && typeof payload.runId === "string" && payload.runId.length > 0,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "QUICK_RECALIBRATION_POINT may only originate from Content."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.READY && currentState !== TRACKER_STATES.RECORDING && currentState !== TRACKER_STATES.PAUSED) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Quick recalibration point collection is not available in the current state."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Quick recalibration point did not originate from the active research tab."
        );
      }
      const result = await collectQuickRecalibrationPointInOffscreen(
        message.payload,
        targetTab
      );
      return createRuntimeMessage(
        MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT,
        createResponseMeta(message.meta, sessionId, targetTab.currentPageId),
        { ...result }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.START_QUICK_VALIDATION,
    isStartQuickValidationPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "START_QUICK_VALIDATION may only originate from Content."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Quick validation did not originate from the active research tab."
        );
      }
      await startQuickValidationInOffscreen(message.payload, targetTab);
      return createRuntimeMessage(
        MESSAGE_TYPES.START_QUICK_VALIDATION,
        createResponseMeta(message.meta, sessionId, targetTab.currentPageId),
        { ...message.payload }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.QUICK_VALIDATION_POINT,
    (payload) => isValidationPointPayload(payload) && isRecord(payload) && typeof payload.runId === "string" && payload.runId.length > 0,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "QUICK_VALIDATION_POINT may only originate from Content."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Quick validation point did not originate from the active research tab."
        );
      }
      const result = await collectQuickValidationPointInOffscreen(
        message.payload,
        targetTab
      );
      if (result.validationComplete) {
        const selected = result.selectedStrategyValidation;
        await experimentStorage.recordMaintenanceEvent(
          sessionId,
          targetTab.currentPageId,
          "QUICK_REVALIDATION_COMPLETED",
          {
            calibrationId: result.calibrationId,
            quality: selected?.quality ?? result.quality,
            meanErrorPx: selected?.metrics.meanErrorPx ?? result.metrics?.meanErrorPx ?? null,
            p95ErrorPx: selected?.metrics.p95ErrorPx ?? result.metrics?.p95ErrorPx ?? null,
            meanPrecisionPx: selected?.metrics.meanPrecisionPx ?? result.metrics?.meanPrecisionPx ?? null,
            validSampleRatio: selected?.metrics.validSampleRatio ?? result.metrics?.validSampleRatio ?? null
          }
        );
      }
      return createRuntimeMessage(
        MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT,
        createResponseMeta(message.meta, sessionId, targetTab.currentPageId),
        { ...result }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.START_VALIDATION,
    isStartValidationPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "START_VALIDATION may only originate from the research-tab Content context."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.VALIDATING) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Independent validation may only start while VALIDATING.",
          {
            details: {
              currentState
            }
          }
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(
        sessionId,
        context.senderTabId
      );
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Validation startup did not originate from the active research tab."
        );
      }
      await startValidationInOffscreen(
        message.payload,
        targetTab
      );
      logger5.info(
        "Independent calibration validation UI/runtime started.",
        {
          calibrationId: message.payload.calibrationId,
          expectedPointCount: message.payload.expectedPointCount,
          tabId: targetTab.tabId
        }
      );
      return createRuntimeMessage(
        MESSAGE_TYPES.START_VALIDATION,
        createResponseMeta(
          message.meta,
          sessionId,
          targetTab.currentPageId
        ),
        {
          ...message.payload
        }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.VALIDATION_POINT,
    isValidationPointPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "VALIDATION_POINT may only originate from the research-tab Content context."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (currentState !== TRACKER_STATES.VALIDATING) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Validation points may only be collected while VALIDATING.",
          {
            details: {
              currentState
            }
          }
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(
        sessionId,
        context.senderTabId
      );
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId || message.meta.sessionId !== sessionId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Validation point did not originate from the active research tab."
        );
      }
      const result = await collectValidationPointInOffscreen(
        message.payload,
        targetTab
      );
      if (result.validationComplete && result.quality !== null && result.metrics !== null) {
        const selectedValidation = result.selectedStrategyValidation;
        const passed = selectedValidation !== null && (selectedValidation.quality === "GOOD" || selectedValidation.quality === "ACCEPTABLE");
        const degradedCollectionAllowed = selectedValidation !== null && selectedValidation.quality === "POOR";
        const activeSessionId = sessionManager.getActiveSessionId();
        if (activeSessionId !== null) {
          try {
            await experimentStorage.setValidation(
              activeSessionId,
              {
                calibrationId: result.calibrationId,
                strategy: selectedValidation?.strategy ?? null,
                quality: selectedValidation?.quality ?? null,
                metrics: selectedValidation?.metrics ?? null,
                baselineShadowQuality: result.quality,
                baselineShadowMetrics: result.metrics,
                authoritativeValidationReady: passed,
                degradedCollectionAllowed,
                recalibrationRecommended: !passed
              }
            );
          } catch (error) {
            logger5.warn(
              "Validation summary could not be persisted.",
              {
                sessionId: activeSessionId,
                storageError: error instanceof Error ? error.message : "Unknown storage error"
              }
            );
          }
        }
        if ((passed || degradedCollectionAllowed) && selectedValidation !== null) {
          transitionOrThrow(
            TRACKER_STATES.READY
          );
          if (sessionId !== null) {
            const activated = await uxdsActivateForEyeSession(sessionId, targetTab.tabId, targetTab.currentPageId);
            if (!activated.success) {
              logger5.warn("UXDS combined collection was not activated.", {
                reason: "error" in activated ? activated.error : "UXDS project is not armed",
                sessionId
              });
            }
          }
          if (passed) {
            logger5.info(
              "Calibration-selected session strategy passed independent validation; tracker is READY.",
              {
                calibrationId: result.calibrationId,
                selectedSessionStrategy: selectedValidation.strategy,
                quality: selectedValidation.quality,
                meanErrorPx: selectedValidation.metrics.meanErrorPx,
                p95ErrorPx: selectedValidation.metrics.p95ErrorPx,
                meanErrorViewportWidthRatio: selectedValidation.metrics.meanErrorViewportWidthRatio,
                p95ErrorViewportWidthRatio: selectedValidation.metrics.p95ErrorViewportWidthRatio,
                meanPrecisionPx: selectedValidation.metrics.meanPrecisionPx,
                p95PrecisionPx: selectedValidation.metrics.p95PrecisionPx,
                validSampleRatio: selectedValidation.metrics.validSampleRatio,
                recalibrationRecommended: false,
                degradedCollectionAllowed: false,
                baselineShadowQuality: result.quality,
                baselineShadowMeanErrorPx: result.metrics.meanErrorPx,
                baselineShadowP95ErrorPx: result.metrics.p95ErrorPx
              }
            );
          } else {
            logger5.warn(
              "Independent validation is POOR; recalibration is recommended, but degraded collection mode is enabled.",
              {
                calibrationId: result.calibrationId,
                selectedSessionStrategy: selectedValidation.strategy,
                quality: selectedValidation.quality,
                meanErrorPx: selectedValidation.metrics.meanErrorPx,
                p95ErrorPx: selectedValidation.metrics.p95ErrorPx,
                meanErrorViewportWidthRatio: selectedValidation.metrics.meanErrorViewportWidthRatio,
                p95ErrorViewportWidthRatio: selectedValidation.metrics.p95ErrorViewportWidthRatio,
                meanPrecisionPx: selectedValidation.metrics.meanPrecisionPx,
                p95PrecisionPx: selectedValidation.metrics.p95PrecisionPx,
                validSampleRatio: selectedValidation.metrics.validSampleRatio,
                recalibrationRecommended: true,
                degradedCollectionAllowed: true,
                baselineShadowQuality: result.quality,
                baselineShadowMeanErrorPx: result.metrics.meanErrorPx,
                baselineShadowP95ErrorPx: result.metrics.p95ErrorPx
              }
            );
          }
        } else {
          logger5.warn(
            "Calibration-selected session strategy did not meet the minimum collection safety gate.",
            {
              calibrationId: result.calibrationId,
              selectedSessionStrategy: selectedValidation?.strategy ?? null,
              quality: selectedValidation?.quality ?? null,
              meanErrorPx: selectedValidation?.metrics.meanErrorPx ?? null,
              p95ErrorPx: selectedValidation?.metrics.p95ErrorPx ?? null,
              meanErrorViewportWidthRatio: selectedValidation?.metrics.meanErrorViewportWidthRatio ?? null,
              p95ErrorViewportWidthRatio: selectedValidation?.metrics.p95ErrorViewportWidthRatio ?? null,
              meanPrecisionPx: selectedValidation?.metrics.meanPrecisionPx ?? null,
              p95PrecisionPx: selectedValidation?.metrics.p95PrecisionPx ?? null,
              validSampleRatio: selectedValidation?.metrics.validSampleRatio ?? null,
              recalibrationRecommended: true,
              degradedCollectionAllowed: false,
              baselineShadowQuality: result.quality,
              baselineShadowMeanErrorPx: result.metrics.meanErrorPx,
              baselineShadowP95ErrorPx: result.metrics.p95ErrorPx
            }
          );
        }
        logValidationPointDiagnostics(
          result.pointResults
        );
      }
      return createRuntimeMessage(
        MESSAGE_TYPES.VALIDATION_POINT_RESULT,
        createResponseMeta(
          message.meta,
          sessionId,
          targetTab.currentPageId
        ),
        {
          ...result,
          metrics: result.metrics === null ? null : {
            ...result.metrics
          }
        }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED,
    isViewportContextChangedPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "VIEWPORT_CONTEXT_CHANGED may only originate from Content."
        );
      }
      const senderTabId = context.senderTabId;
      const sessionId = sessionManager.getActiveSessionId();
      if (senderTabId === null || sessionId === null) {
        return null;
      }
      const trackedTab = tabManager.getTab(senderTabId);
      if (trackedTab === null || trackedTab.sessionId !== sessionId || message.meta.sessionId !== sessionId || message.meta.pageId !== trackedTab.currentPageId) {
        return null;
      }
      await ensureOffscreenDocument();
      const forwarded = createRuntimeMessage(
        MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "BACKGROUND",
          target: "OFFSCREEN",
          sessionId,
          pageId: trackedTab.currentPageId,
          tabId: trackedTab.tabId,
          browserFrameId: 0
        },
        { ...message.payload }
      );
      try {
        await chrome.runtime.sendMessage(forwarded);
      } catch (error) {
        logger5.debug(
          "Live viewport context could not be synchronized to Offscreen.",
          {
            pageId: trackedTab.currentPageId,
            tabId: trackedTab.tabId,
            transportError: error instanceof Error ? error.message : "Unknown Offscreen transport error"
          }
        );
      }
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.SCROLL_EVENT,
    isScrollEventPayload,
    (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "SCROLL_EVENT may only originate from Content."
        );
      }
      const tabId = context.senderTabId;
      const sessionId = sessionManager.getActiveSessionId();
      if (tabId === null || sessionId === null) {
        return null;
      }
      const trackedTab = tabManager.getTab(tabId);
      const event = message.payload.event;
      if (trackedTab === null || trackedTab.sessionId !== sessionId || event.sessionId !== sessionId || event.pageId !== trackedTab.currentPageId || event.tabId !== trackedTab.tabId || event.browserFrameId !== 0) {
        return null;
      }
      latestScrollByPage.set(event.pageId, { ...event });
      if (isPersistentCollectionState()) {
        experimentStorage.queueScroll(event);
      }
      const previousLogAt = lastScrollSmokeAtByPage.get(event.pageId) ?? null;
      const shouldLog = event.phase === "START" || event.phase === "END" || previousLogAt === null || event.timestampMs - previousLogAt >= PAGE_TRACKING.SCROLL_SMOKE_LOG_INTERVAL_MS;
      if (shouldLog) {
        lastScrollSmokeAtByPage.set(
          event.pageId,
          event.timestampMs
        );
        logger5.info(
          "[ScrollSmoke] Research page scroll resolved.",
          {
            pageId: event.pageId,
            tabId: event.tabId,
            phase: event.phase,
            direction: event.direction,
            scrollX: event.scrollX,
            scrollY: event.scrollY,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            velocityPxPerMs: event.velocityPxPerMs
          }
        );
      }
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.RUNTIME_QUALITY_DIAGNOSTIC,
    isRuntimeQualityDiagnosticPayload,
    async (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "RUNTIME_QUALITY_DIAGNOSTIC may only originate from Offscreen."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      if (sessionId === null || message.meta.sessionId !== sessionId) return null;
      await experimentStorage.recordRuntimeDiagnostic(
        sessionId,
        message.meta.pageId,
        message.payload.diagnostic
      );
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.DRIFT_STATUS,
    isDriftStatusPayload,
    async (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "DRIFT_STATUS may only originate from Offscreen."
        );
      }
      if (!message.payload.status.quickRecalibrationRecommended) {
        return null;
      }
      const sessionId = sessionManager.getActiveSessionId();
      const tabId = message.meta.tabId;
      if (sessionId === null || tabId === null) return null;
      const trackedTab = tabManager.getTab(tabId);
      if (trackedTab === null || trackedTab.sessionId !== sessionId || message.meta.sessionId !== sessionId) {
        return null;
      }
      await experimentStorage.recordMaintenanceEvent(
        sessionId,
        trackedTab.currentPageId,
        "DRIFT_RECALIBRATION_RECOMMENDED",
        { ...message.payload.status }
      );
      const forwarded = createRuntimeMessage(
        MESSAGE_TYPES.DRIFT_STATUS,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "BACKGROUND",
          target: "CONTENT",
          sessionId,
          pageId: trackedTab.currentPageId,
          tabId: trackedTab.tabId,
          browserFrameId: 0
        },
        { status: { ...message.payload.status } }
      );
      await chrome.tabs.sendMessage(trackedTab.tabId, forwarded, { frameId: 0 }).catch(() => void 0);
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.AOI_PROBE,
    isAoiProbePayload,
    async (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "AOI_PROBE may only originate from the Offscreen gaze runtime."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const tabId = message.meta.tabId;
      if (sessionId === null || tabId === null) {
        return null;
      }
      const trackedTab = tabManager.getTab(tabId);
      if (trackedTab === null || trackedTab.sessionId !== sessionId || message.meta.sessionId !== sessionId) {
        return null;
      }
      const forwarded = createRuntimeMessage(
        MESSAGE_TYPES.AOI_PROBE,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "BACKGROUND",
          target: "CONTENT",
          sessionId,
          pageId: trackedTab.currentPageId,
          tabId: trackedTab.tabId,
          browserFrameId: 0
        },
        {
          ...message.payload,
          normalizedPoint: {
            ...message.payload.normalizedPoint
          },
          viewportPoint: {
            ...message.payload.viewportPoint
          },
          rawPredictionNormalizedPoint: message.payload.rawPredictionNormalizedPoint === null ? null : { ...message.payload.rawPredictionNormalizedPoint },
          authoritativeNormalizedPoint: message.payload.authoritativeNormalizedPoint === null ? null : { ...message.payload.authoritativeNormalizedPoint },
          stabilizedNormalizedPoint: message.payload.stabilizedNormalizedPoint === null ? null : { ...message.payload.stabilizedNormalizedPoint },
          completedFixation: message.payload.completedFixation === null ? null : {
            event: {
              ...message.payload.completedFixation.event,
              centroidViewportPoint: {
                ...message.payload.completedFixation.event.centroidViewportPoint
              }
            },
            peakSpeedPxPerSecond: message.payload.completedFixation.peakSpeedPxPerSecond
          }
        }
      );
      try {
        await chrome.tabs.sendMessage(
          trackedTab.tabId,
          forwarded,
          { frameId: 0 }
        );
      } catch (error) {
        logger5.debug(
          "AOI probe could not be delivered to the tracked page.",
          {
            tabId: trackedTab.tabId,
            transportError: error instanceof Error ? error.message : "Unknown Content transport error"
          }
        );
      }
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.AOI_REGISTRY_UPDATE,
    isAoiRegistryUpdatePayload,
    (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "AOI_REGISTRY_UPDATE may only originate from Content."
        );
      }
      const tabId = context.senderTabId;
      const sessionId = sessionManager.getActiveSessionId();
      if (tabId === null || sessionId === null) return null;
      const trackedTab = tabManager.getTab(tabId);
      if (trackedTab === null || trackedTab.sessionId !== sessionId || message.meta.sessionId !== sessionId || message.payload.pageId !== trackedTab.currentPageId) {
        return null;
      }
      let pageRegistry = aoiRegistryByPage.get(message.payload.pageId);
      if (pageRegistry === void 0 || message.payload.fullSnapshot) {
        pageRegistry = /* @__PURE__ */ new Map();
        aoiRegistryByPage.set(message.payload.pageId, pageRegistry);
      }
      for (const aoiId of message.payload.removedAoiIds) {
        pageRegistry.delete(aoiId);
      }
      for (const entry of message.payload.upserted) {
        pageRegistry.set(entry.aoiId, {
          ...entry,
          viewportRect: { ...entry.viewportRect },
          documentRect: { ...entry.documentRect }
        });
      }
      void experimentStorage.upsertAoi(
        sessionId,
        message.payload.upserted,
        message.payload.removedAoiIds
      ).catch((error) => {
        logger5.warn(
          "AOI registry update could not be persisted.",
          {
            pageId: message.payload.pageId,
            storageError: error instanceof Error ? error.message : "Unknown storage error"
          }
        );
      });
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.AOI_HIT,
    isAoiHitPayload,
    (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "AOI_HIT may only originate from Content."
        );
      }
      const tabId = context.senderTabId;
      const sessionId = sessionManager.getActiveSessionId();
      if (tabId === null || sessionId === null) return null;
      const trackedTab = tabManager.getTab(tabId);
      if (trackedTab === null || trackedTab.sessionId !== sessionId || message.meta.sessionId !== sessionId || message.payload.pageId !== trackedTab.currentPageId) {
        return null;
      }
      if (isPersistentCollectionState()) {
        const completedFixation = message.payload.completedFixation;
        if (completedFixation === null) {
          if (uxdsIsCollecting(sessionId)) {
            const sample = message.payload;
            const point = sample.gazeCoordinates ?? sample.coordinates;
            uxdsQueueGazeEvent({
              event_id: createMessageId(),
              event_type: "gaze",
              session_id: sessionId,
              page_id: sample.pageId,
              tab_id: tabId,
              timestamp: Date.now(),
              page_url: point.url,
              x: point.documentPoint.x,
              y: point.documentPoint.y,
              client_x: point.viewportPoint.x,
              client_y: point.viewportPoint.y,
              scroll_x: point.scrollX,
              scroll_y: point.scrollY,
              viewport_width: point.viewportWidth,
              viewport_height: point.viewportHeight,
              document_width: point.documentWidth,
              document_height: point.documentHeight,
              gaze_quality: sample.gazeQuality,
              degraded_collection: sample.degradedCollection,
              point_source: sample.pointSource,
              primary_aoi_id: sample.hit.primaryAoiId,
              fixation_id: sample.fixationId,
              raw_prediction_normalized: sample.rawPredictionNormalizedPoint,
              authoritative_normalized: sample.authoritativeNormalizedPoint,
              stabilized_normalized: sample.stabilizedNormalizedPoint,
              candidates: sample.hit.candidates
            });
          }
          experimentStorage.queueGaze(
            sessionId,
            tabId,
            message.payload
          );
        }
        if (completedFixation !== null) {
          const event = {
            ...completedFixation.event,
            sessionId,
            pageId: message.payload.pageId,
            centroidViewportPoint: {
              ...message.payload.coordinates.viewportPoint
            },
            aoiId: message.payload.hit.primaryAoiId,
            aoiDwellRatio: 0
          };
          experimentStorage.queueFixation(
            event,
            completedFixation.peakSpeedPxPerSecond,
            {
              coordinates: message.payload.coordinates,
              primaryAoiId: message.payload.hit.primaryAoiId,
              candidates: message.payload.hit.candidates
            }
          );
          enrichedFixationIds.add(
            event.fixationId
          );
        }
      }
      const pageId = message.payload.pageId;
      const primaryAoiId = message.payload.hit.primaryAoiId;
      const previousPrimary = lastAoiPrimaryByPage.get(pageId) ?? null;
      const previousLogAt = lastAoiSmokeAtByPage.get(pageId) ?? null;
      const now = message.payload.hit.timestampMs;
      const shouldLog = primaryAoiId !== previousPrimary || previousLogAt === null || now - previousLogAt >= AOI.PROBE_INTERVAL_MS * 10;
      lastAoiPrimaryByPage.set(pageId, primaryAoiId);
      if (shouldLog) {
        lastAoiSmokeAtByPage.set(pageId, now);
        const primaryEntry = primaryAoiId === null ? null : aoiRegistryByPage.get(pageId)?.get(primaryAoiId) ?? null;
        logger5.info(
          "[AOISmoke] Gaze-to-DOM AOI resolved.",
          {
            pageId,
            fixationId: message.payload.fixationId,
            pointSource: message.payload.pointSource,
            gazeQuality: message.payload.gazeQuality,
            degradedCollection: message.payload.degradedCollection,
            primaryAoiId,
            candidateCount: message.payload.hit.candidates.length,
            primaryAoiType: primaryEntry?.aoiType ?? null,
            primaryTagName: primaryEntry?.tagName ?? null,
            primaryElementId: primaryEntry?.elementId ?? null,
            primaryRole: primaryEntry?.role ?? null,
            primaryAriaLabel: primaryEntry?.ariaLabel ?? null,
            primaryDistancePx: message.payload.hit.candidates[0]?.distancePx ?? null,
            primaryInside: message.payload.hit.candidates[0]?.inside ?? null,
            viewportX: message.payload.coordinates.viewportPoint.x,
            viewportY: message.payload.coordinates.viewportPoint.y,
            documentX: message.payload.coordinates.documentPoint.x,
            documentY: message.payload.coordinates.documentPoint.y,
            scrollX: message.payload.coordinates.scrollX,
            scrollY: message.payload.coordinates.scrollY,
            viewportWidth: message.payload.coordinates.viewportWidth,
            viewportHeight: message.payload.coordinates.viewportHeight,
            documentWidth: message.payload.coordinates.documentWidth,
            documentHeight: message.payload.coordinates.documentHeight,
            url: message.payload.coordinates.url
          }
        );
      }
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.FIXATION_EVENT,
    isFixationEventPayload,
    (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "FIXATION_EVENT may only originate from Offscreen."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const event = message.payload.event;
      if (sessionId === null || message.meta.sessionId !== sessionId || event.sessionId !== sessionId || message.meta.pageId !== event.pageId || !isPersistentCollectionState()) {
        return null;
      }
      if (!enrichedFixationIds.has(event.fixationId)) {
        experimentStorage.queueFixation(
          event,
          message.payload.peakSpeedPxPerSecond
        );
      }
      return null;
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.EXPORT_SESSION,
    isExportSessionPayload,
    async (message) => {
      if (message.meta.source !== "POPUP") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "Session export may only be requested from the popup."
        );
      }
      const sessionId = message.payload.sessionId ?? sessionManager.getActiveSessionId() ?? sessionManager.getLastCompletedSession()?.sessionId ?? null;
      if (sessionId === null) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "STORAGE",
          "No experiment session is available to export."
        );
      }
      let files;
      try {
        files = await experimentStorage.exportSession(
          sessionId,
          message.payload.format
        );
      } catch (error) {
        throw new TrackerError(
          ERROR_CODES.EXPORT_FAILED,
          "STORAGE",
          "Experiment session export failed.",
          {
            cause: error,
            details: {
              sessionId,
              format: message.payload.format,
              originalMessage: error instanceof Error ? error.message : "Unknown export error"
            }
          }
        );
      }
      logger5.info(
        "Experiment session export prepared.",
        {
          sessionId,
          format: message.payload.format,
          fileCount: files.length
        }
      );
      return createRuntimeMessage(
        MESSAGE_TYPES.SESSION_EXPORT_READY,
        createResponseMeta(
          message.meta,
          sessionId
        ),
        {
          sessionId,
          format: message.payload.format,
          files: files.map((file) => ({ ...file }))
        }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.GET_TRACKER_STATE,
    isEmptyPayload,
    (message) => {
      return createRuntimeMessage(
        MESSAGE_TYPES.TRACKER_STATE_CHANGED,
        createResponseMeta(
          message.meta,
          sessionManager.getActiveSessionId()
        ),
        {
          snapshot: trackerStateMachine.getSnapshot()
        }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.RESET_TRACKER,
    isEmptyPayload,
    async (message) => {
      calibrationFlowGeneration += 1;
      try {
        await uxdsStopForEye();
      } catch (error) {
        logger5.warn("UXDS stop encountered an error; persistent upload queues remain intact.", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      const staleCalibrationStart = calibrationStartPromise;
      const staleReloadRestarts = [...reloadRestartPromises.values()];
      if (staleCalibrationStart !== null) {
        try {
          await staleCalibrationStart;
        } catch {
        }
      }
      if (staleReloadRestarts.length > 0) {
        await Promise.allSettled(
          staleReloadRestarts
        );
      }
      calibrationStartPromise = null;
      reloadRestartPromises.clear();
      for (const resolver of pendingCalibrationUiReadySignals.values()) {
        resolver(false);
      }
      pendingCalibrationUiReadySignals.clear();
      calibrationUiRetryAfterEpochMs = 0;
      const activeSession = sessionManager.getActiveSession();
      const trackedTabs = activeSession === null ? [] : [
        ...tabManager.getTrackedTabsForSession(
          activeSession.sessionId
        )
      ];
      await Promise.allSettled(
        trackedTabs.map(async (trackedTab) => {
          const resetMessage = createRuntimeMessage(
            MESSAGE_TYPES.RESET_TRACKER,
            {
              messageId: createMessageId(),
              sentAtEpochMs: nowEpochMs(),
              source: "BACKGROUND",
              target: "CONTENT",
              sessionId: trackedTab.sessionId,
              pageId: trackedTab.currentPageId,
              tabId: trackedTab.tabId,
              browserFrameId: 0
            },
            {}
          );
          await chrome.tabs.sendMessage(
            trackedTab.tabId,
            resetMessage,
            { frameId: 0 }
          );
        })
      );
      try {
        await experimentStorage.flush();
      } catch (error) {
        logger5.warn(
          "Buffered experiment records could not be fully flushed before reset.",
          {
            storageError: error instanceof Error ? error.message : "Unknown storage error"
          }
        );
      }
      if (activeSession !== null) {
        const ended = sessionManager.endSession();
        if (ended.ok) {
          try {
            await experimentStorage.putSession(
              ended.session
            );
          } catch (error) {
            logger5.warn(
              "Completed session metadata could not be persisted during reset.",
              {
                sessionId: ended.session.sessionId,
                storageError: error instanceof Error ? error.message : "Unknown storage error"
              }
            );
          }
        }
        tabManager.clearSession(
          activeSession.sessionId
        );
      }
      aoiRegistryByPage.clear();
      lastAoiPrimaryByPage.clear();
      lastAoiSmokeAtByPage.clear();
      latestScrollByPage.clear();
      lastScrollSmokeAtByPage.clear();
      enrichedFixationIds.clear();
      navigationTargets.clear();
      try {
        await closeOffscreenDocumentIfPresent();
      } catch (error) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
          "BACKGROUND",
          "Tracker reset could not close the Offscreen runtime.",
          { recoverable: true }
        );
        logger5.error(
          "Tracker hard reset failed while closing Offscreen runtime.",
          {
            trackerError: normalized.toSerializable()
          }
        );
        throw normalized;
      }
      const snapshot = trackerStateMachine.reset();
      logger5.info(
        "Tracker hard-reset to IDLE.",
        {
          previousState: snapshot.previousState,
          sequence: snapshot.sequence,
          completedSessionId: activeSession?.sessionId ?? null
        }
      );
      return createRuntimeMessage(
        MESSAGE_TYPES.TRACKER_STATE_CHANGED,
        createResponseMeta(
          message.meta,
          null,
          null
        ),
        { snapshot }
      );
    }
  );
  messageRouter.register(
    MESSAGE_TYPES.INIT_TRACKER,
    isInitTrackerPayload,
    async (message) => {
      transitionOrThrow(
        TRACKER_STATES.INITIALIZING
      );
      try {
        await ensureOffscreenDocument();
      } catch (error) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
          "BACKGROUND",
          "Offscreen runtime initialization failed.",
          {
            recoverable: false
          }
        );
        transitionToErrorIfPossible(
          normalized.toSerializable()
        );
        throw normalized;
      }
      const gazeEngine = message.payload.preferredGazeEngine ?? GAZE_ENGINE_DEFAULTS.PRIMARY;
      const projectBinding = await uxdsGetState();
      const startResult = sessionManager.startSession({
        projectId: projectBinding.projectId,
        participantId: message.payload.participantId,
        gazeEngine,
        browser: message.payload.browser,
        screen: message.payload.screen
      });
      if (!startResult.ok) {
        const rollback = trackerStateMachine.transition(
          TRACKER_STATES.IDLE
        );
        if (!rollback.ok) {
          logger5.error(
            "Failed to roll tracker state back after session-start failure.",
            {
              reason: rollback.reason
            }
          );
        }
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Experiment session could not be started.",
          {
            details: {
              reason: startResult.reason
            }
          }
        );
      }
      const session = startResult.session;
      try {
        await experimentStorage.putSession(session);
        const initialTab = await associateInitialResearchTab(
          session.sessionId
        );
        logger5.info(
          "Tracker initialized on research tab.",
          {
            sessionId: session.sessionId,
            tabId: initialTab.tabId,
            pageId: initialTab.currentPageId
          }
        );
        return createRuntimeMessage(
          MESSAGE_TYPES.TRACKER_INITIALIZED,
          createResponseMeta(
            message.meta,
            session.sessionId,
            initialTab.currentPageId
          ),
          {
            session
          }
        );
      } catch (error) {
        tabManager.clearSession(
          session.sessionId
        );
        sessionManager.endSession();
        const rollback = trackerStateMachine.transition(
          TRACKER_STATES.IDLE
        );
        if (!rollback.ok) {
          logger5.error(
            "Failed to roll tracker state back after tab-association failure.",
            {
              reason: rollback.reason
            }
          );
        }
        throw error;
      }
    }
  );
}
function cleanupNavigationTargets(nowEpochMs2) {
  for (const [tabId, record] of navigationTargets) {
    if (nowEpochMs2 - record.createdAtEpochMs <= NAVIGATION.TAB_ASSOCIATION_TTL_MS) {
      continue;
    }
    navigationTargets.delete(
      tabId
    );
  }
}
function rememberNavigationTarget(targetTabId, sourceTabId, url) {
  const now = nowEpochMs();
  cleanupNavigationTargets(now);
  navigationTargets.set(
    targetTabId,
    {
      targetTabId,
      sourceTabId,
      url,
      createdAtEpochMs: now
    }
  );
}
async function tryAssociateNavigationTarget(targetTabId, sourceTabId, url) {
  const activeSessionId = sessionManager.getActiveSessionId();
  if (activeSessionId === null) {
    return;
  }
  const sourceTab = tabManager.getTab(
    sourceTabId
  );
  if (sourceTab === null || sourceTab.sessionId !== activeSessionId) {
    return;
  }
  if (tabManager.isTrackedTab(
    targetTabId
  )) {
    navigationTargets.delete(
      targetTabId
    );
    return;
  }
  try {
    const tab = await chrome.tabs.get(
      targetTabId
    );
    const descriptor = toTabDescriptor(
      tab,
      sourceTabId,
      url
    );
    if (descriptor === null) {
      return;
    }
    const result = tabManager.handleTabCreated(
      descriptor,
      activeSessionId
    );
    if (result.ok) {
      navigationTargets.delete(
        targetTabId
      );
      if (result.association.active) {
        await syncTrackingContextToOffscreen(
          result.association,
          "TAB_ASSOCIATED"
        );
      }
      return;
    }
    if (result.reason === "TAB_ALREADY_TRACKED") {
      navigationTargets.delete(
        targetTabId
      );
      return;
    }
    logger5.debug(
      "Navigation target could not yet be associated.",
      {
        targetTabId,
        sourceTabId,
        reason: result.reason
      }
    );
  } catch (error) {
    logger5.debug(
      "Navigation target tab is not yet available.",
      {
        targetTabId,
        sourceTabId,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    );
  }
}
function handleChromeTabCreated(tab) {
  const activeSessionId = sessionManager.getActiveSessionId();
  if (activeSessionId === null) {
    return;
  }
  if (tab.id === void 0) {
    return;
  }
  cleanupNavigationTargets(
    nowEpochMs()
  );
  const navigationTarget = navigationTargets.get(
    tab.id
  );
  const descriptor = toTabDescriptor(
    tab,
    navigationTarget?.sourceTabId ?? null,
    navigationTarget?.url ?? null
  );
  if (descriptor === null) {
    return;
  }
  const result = tabManager.handleTabCreated(
    descriptor,
    activeSessionId
  );
  if (result.ok) {
    navigationTargets.delete(
      tab.id
    );
    logger5.info(
      "New browser tab joined active tracking session.",
      {
        sessionId: activeSessionId,
        tabId: descriptor.tabId,
        openerTabId: descriptor.openerTabId
      }
    );
    if (result.association.active) {
      void syncTrackingContextToOffscreen(
        result.association,
        "TAB_ASSOCIATED"
      );
    }
    return;
  }
  if (result.reason !== "OPENER_NOT_TRACKED" && result.reason !== "TAB_ALREADY_TRACKED") {
    logger5.debug(
      "New browser tab was not associated with tracking session.",
      {
        tabId: descriptor.tabId,
        reason: result.reason
      }
    );
  }
}
function createRouteContext(sender) {
  return {
    senderTabId: sender.tab?.id ?? null,
    senderWindowId: sender.tab?.windowId ?? null,
    senderFrameId: sender.frameId ?? null,
    senderDocumentId: sender.documentId ?? null,
    senderUrl: sender.url ?? null
  };
}
function registerRuntimeMessageListener() {
  chrome.runtime.onMessage.addListener(
    (rawMessage, sender, sendResponse) => {
      if (!isMessageForBackground(
        rawMessage
      )) {
        return false;
      }
      if (isRecord(rawMessage) && isRecord(rawMessage.meta) && (rawMessage.meta.source === "POPUP" || rawMessage.meta.source === "CAMERA_PERMISSION_UI")) {
        logger5.info(
          "Development UI command received.",
          {
            type: typeof rawMessage.type === "string" ? rawMessage.type : "UNKNOWN",
            target: typeof rawMessage.meta.target === "string" ? rawMessage.meta.target : "UNKNOWN"
          }
        );
      }
      const context = createRouteContext(
        sender
      );
      void messageRouter.route(
        rawMessage,
        context
      ).then(
        (result) => {
          sendResponse(result);
        }
      ).catch(
        (error) => {
          const normalized = normalizeTrackerError(
            error,
            ERROR_CODES.UNKNOWN,
            "BACKGROUND",
            "Unexpected background message routing failure."
          );
          logger5.error(
            "Unexpected runtime-message failure.",
            {
              code: normalized.code
            }
          );
          sendResponse({
            ok: false,
            handled: false,
            error: normalized.toSerializable()
          });
        }
      );
      return true;
    }
  );
}
function isCalibrationFlowRestartState(state) {
  return state === TRACKER_STATES.FACE_POSITIONING || state === TRACKER_STATES.CALIBRATING || state === TRACKER_STATES.VALIDATING || state === TRACKER_STATES.READY;
}
async function restartCalibrationFlowAfterReload(tabId, expectedSessionId) {
  calibrationFlowGeneration += 1;
  const restartGeneration = calibrationFlowGeneration;
  const staleStartup = calibrationStartPromise;
  if (staleStartup !== null) {
    try {
      await staleStartup;
    } catch {
    }
  }
  if (restartGeneration !== calibrationFlowGeneration) {
    return;
  }
  const activeSessionId = sessionManager.getActiveSessionId();
  const targetTab = tabManager.getTab(tabId);
  if (activeSessionId === null || activeSessionId !== expectedSessionId || targetTab === null || targetTab.sessionId !== expectedSessionId) {
    return;
  }
  const currentState = trackerStateMachine.getSnapshot().state;
  if (!isCalibrationFlowRestartState(currentState)) {
    return;
  }
  if (currentState !== TRACKER_STATES.FACE_POSITIONING) {
    if (!trackerStateMachine.canTransition(
      TRACKER_STATES.FACE_POSITIONING
    )) {
      logger5.warn(
        "Tracked-tab reload could not restart face positioning from the current state.",
        {
          tabId,
          state: currentState
        }
      );
      return;
    }
    transitionOrThrow(
      TRACKER_STATES.FACE_POSITIONING
    );
  }
  const status = await startFacePositioningInOffscreen();
  if (restartGeneration !== calibrationFlowGeneration || trackerStateMachine.getSnapshot().state !== TRACKER_STATES.FACE_POSITIONING) {
    return;
  }
  await forwardFacePositionStatusToContent(
    status,
    tabId
  );
  logger5.info(
    "Tracked-tab reload restarted the calibration flow from face positioning.",
    {
      tabId,
      sessionId: expectedSessionId,
      pageId: tabManager.getTab(tabId)?.currentPageId ?? null
    }
  );
}
function scheduleCalibrationFlowRestartAfterReload(tabId, sessionId) {
  if (reloadRestartPromises.has(tabId)) {
    return;
  }
  const restart = restartCalibrationFlowAfterReload(
    tabId,
    sessionId
  ).catch(
    (error) => {
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.UNKNOWN,
        "BACKGROUND",
        "Tracked-tab reload failed to restart the calibration flow."
      );
      logger5.error(
        "Tracked-tab reload calibration restart failed.",
        {
          tabId,
          code: normalized.code,
          recoverable: normalized.recoverable
        }
      );
    }
  ).finally(
    () => {
      if (reloadRestartPromises.get(tabId) === restart) {
        reloadRestartPromises.delete(
          tabId
        );
      }
    }
  );
  reloadRestartPromises.set(
    tabId,
    restart
  );
}
function registerNavigationListeners() {
  chrome.webNavigation.onCreatedNavigationTarget.addListener(
    (details) => {
      rememberNavigationTarget(
        details.tabId,
        details.sourceTabId,
        details.url
      );
      void tryAssociateNavigationTarget(
        details.tabId,
        details.sourceTabId,
        details.url
      );
    }
  );
  chrome.webNavigation.onCommitted.addListener(
    (details) => {
      if (!tabManager.isTrackedTab(
        details.tabId
      )) {
        return;
      }
      const trackedBeforeCommit = tabManager.getTab(
        details.tabId
      );
      const transition = tabManager.handleNavigationCommitted({
        tabId: details.tabId,
        frameId: details.frameId,
        documentId: details.documentId,
        url: details.url,
        /**
         * Use this extension context's clock for internal runtime state.
         * Browser webNavigation timestamps are useful for event ordering,
         * but Chrome documents possible cross-process clock skew.
         */
        timestampEpochMs: nowEpochMs()
      });
      if (transition.ok && transition.changed && transition.association.active) {
        void syncTrackingContextToOffscreen(
          transition.association,
          "FULL_NAVIGATION"
        );
        uxdsSyncPageContext(
          transition.association.tabId,
          transition.association.currentPageId,
          transition.association.sessionId
        );
      }
      if (details.frameId === 0 && transition.ok && transition.changed && trackedBeforeCommit !== null && isCalibrationFlowRestartState(
        trackerStateMachine.getSnapshot().state
      )) {
        scheduleCalibrationFlowRestartAfterReload(
          details.tabId,
          trackedBeforeCommit.sessionId
        );
      }
    }
  );
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    (details) => {
      if (!tabManager.isTrackedTab(
        details.tabId
      )) {
        return;
      }
      const transition = tabManager.handleHistoryStateUpdated({
        tabId: details.tabId,
        frameId: details.frameId,
        documentId: details.documentId,
        url: details.url,
        timestampEpochMs: nowEpochMs()
      });
      if (transition.ok && transition.changed && transition.association.active) {
        void syncTrackingContextToOffscreen(
          transition.association,
          "SPA_NAVIGATION"
        );
        uxdsSyncPageContext(
          transition.association.tabId,
          transition.association.currentPageId,
          transition.association.sessionId
        );
      }
    }
  );
}
function registerTabListeners() {
  chrome.tabs.onCreated.addListener(
    (tab) => {
      handleChromeTabCreated(tab);
    }
  );
  chrome.tabs.onUpdated.addListener(
    (tabId, changeInfo, tab) => {
      tabManager.handleTabUpdated({
        tabId,
        windowId: tab.windowId,
        url: changeInfo.url ?? tab.url ?? null,
        active: tab.active
      });
    }
  );
  chrome.tabs.onActivated.addListener(
    (activeInfo) => {
      const activated = tabManager.handleTabActivated({
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId
      });
      const activeSessionId = sessionManager.getActiveSessionId();
      if (activated !== null && activeSessionId !== null && activated.sessionId === activeSessionId) {
        void syncTrackingContextToOffscreen(
          activated,
          "TAB_ACTIVATED"
        );
      }
    }
  );
  chrome.tabs.onRemoved.addListener(
    (tabId, _removeInfo) => {
      navigationTargets.delete(
        tabId
      );
      tabManager.handleTabRemoved(
        tabId
      );
    }
  );
}
function registerExtensionLifecycle() {
  chrome.runtime.onInstalled.addListener(
    (details) => {
      logger5.info(
        "Extension installed or updated.",
        {
          reason: details.reason
        }
      );
    }
  );
  chrome.runtime.onStartup.addListener(
    () => {
      logger5.info(
        "Chrome extension service worker started."
      );
    }
  );
}
function bootstrapServiceWorker() {
  void experimentStorage.initialize().then(() => {
    logger5.info(
      "IndexedDB experiment storage initialized."
    );
  }).catch((error) => {
    logger5.error(
      "IndexedDB experiment storage initialization failed.",
      {
        storageError: error instanceof Error ? error.message : "Unknown storage error"
      }
    );
  });
  registerCoreMessageRoutes();
  registerRuntimeMessageListener();
  registerTabListeners();
  registerNavigationListeners();
  registerExtensionLifecycle();
  logger5.info(
    "Background service worker initialized."
  );
}
bootstrapServiceWorker();
//# sourceMappingURL=serviceWorker.js.map
