import type {
  AoiHitCandidate,
  AoiRegistryEntry,
  CalibrationQualityLevel,
  CalibrationValidationMetrics,
  FixationEvent,
  PageCoordinateSnapshot,
  PageId,
  Point2D,
  ScrollEventRecord,
  SessionId,
  SessionRecord,
  RuntimeQualityDiagnostic
} from "../shared/types";

export interface StoredSessionRecord {
  readonly sessionId: SessionId;
  readonly session: SessionRecord;
  readonly validation: StoredValidationSnapshot | null;
  readonly updatedAtEpochMs: number;
}

export interface StoredValidationSnapshot {
  readonly calibrationId: string;
  readonly strategy: string | null;
  readonly quality: CalibrationQualityLevel | null;
  readonly metrics: CalibrationValidationMetrics | null;
  readonly baselineShadowQuality: CalibrationQualityLevel;
  readonly baselineShadowMetrics: CalibrationValidationMetrics;
  readonly authoritativeValidationReady: boolean;
  readonly degradedCollectionAllowed: boolean;
  readonly recalibrationRecommended: boolean;
  readonly capturedAtEpochMs: number;
}

export interface StoredGazeObservation {
  readonly recordId: string;
  readonly sessionId: SessionId;
  readonly pageId: PageId;
  readonly tabId: number;
  readonly browserFrameId: number;

  readonly timestampMs: number;
  readonly capturedAtEpochMs: number;

  /** AOI resolver point source. */
  readonly pointSource: "STABILIZED_GAZE" | "FIXATION_CENTROID";

  /** Source of `coordinates` used for gaze scatter/export. */
  readonly coordinateSource:
    | "STABILIZED_GAZE"
    | "FIXATION_CENTROID_SNAPSHOT";

  readonly gazeQuality: number;
  readonly degradedCollection: boolean;
  readonly fixationId: string | null;

  /** Actual stored gaze coordinate in normalized space. */
  readonly gazeNormalizedPoint: Point2D;

  /** AOI query point in normalized space (may be fixation centroid). */
  readonly probeNormalizedPoint: Point2D;

  readonly rawPredictionNormalizedPoint: Point2D | null;
  readonly authoritativeNormalizedPoint: Point2D | null;
  readonly stabilizedNormalizedPoint: Point2D | null;

  /** Actual per-frame stabilized gaze coordinates (or completion snapshot). */
  readonly coordinates: PageCoordinateSnapshot;

  /** Coordinates used by the DOM/AOI resolver. */
  readonly aoiProbeCoordinates: PageCoordinateSnapshot;

  readonly primaryAoiId: string | null;
  readonly candidates: readonly AoiHitCandidate[];
}

export interface StoredAoiRecord {
  readonly recordId: string;
  readonly sessionId: SessionId;
  readonly pageId: PageId;
  readonly entry: AoiRegistryEntry;
}

export interface StoredFixationRecord {
  readonly recordId: string;
  readonly sessionId: SessionId;
  readonly pageId: PageId;
  readonly event: FixationEvent;
  readonly peakSpeedPxPerSecond: number;
  readonly capturedAtEpochMs: number;

  /** Populated when the forced fixation-completion AOI probe succeeds. */
  readonly coordinates: PageCoordinateSnapshot | null;
  readonly primaryAoiId: string | null;
  readonly candidates: readonly AoiHitCandidate[];
}

export interface StoredScrollRecord {
  readonly recordId: string;
  readonly sessionId: SessionId;
  readonly pageId: PageId;
  readonly kind: "SCROLL";
  readonly event: ScrollEventRecord;
  readonly capturedAtEpochMs: number;
}

export interface StoredDiagnosticRecord {
  readonly recordId: string;
  readonly sessionId: SessionId;
  readonly pageId: PageId | null;
  readonly kind: "RUNTIME_QUALITY" | "MAINTENANCE_EVENT";
  readonly code: string;
  readonly capturedAtEpochMs: number;
  readonly diagnostic: RuntimeQualityDiagnostic | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

export interface StoredNavigationRecord {
  readonly recordId: string;
  readonly sessionId: SessionId;
  readonly pageId: PageId;
  readonly tabId: number;
  readonly kind: "NAVIGATION";
  readonly reason:
    | "FULL_NAVIGATION"
    | "SPA_NAVIGATION"
    | "TAB_ACTIVATED"
    | "TAB_ASSOCIATED";
  readonly url: string | null;
  readonly capturedAtEpochMs: number;
}

export interface SessionExportData {
  readonly exportedAtEpochMs: number;
  readonly session: StoredSessionRecord;
  readonly gaze: readonly StoredGazeObservation[];
  readonly fixations: readonly StoredFixationRecord[];
  readonly scroll: readonly StoredScrollRecord[];
  readonly navigation: readonly StoredNavigationRecord[];
  readonly aoiRegistry: readonly StoredAoiRecord[];
  readonly diagnostics: readonly StoredDiagnosticRecord[];
}

export interface ExportedTextFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
}
