import type {
  AoiHit,
  AoiId,
  CalibrationId,
  BrowserMetadata,
  ScreenMetadata,
  AoiRegistryEntry,
  CalibrationCorrectionStrategy,
  CalibrationMode,
  CalibrationPointResult,
  CalibrationQualityLevel,
  CalibrationSummary,
  CalibrationTarget,
  CalibrationTrainingDiagnostics,
  CalibrationValidationMetrics,
  CameraSettings,
  ClickEventRecord,
  DiagnosticComponent,
  DriftStatus,
  RuntimeQualityDiagnostic,
  EpochMs,
  FacePositionStatus,
  FixationId,
  FixationEvent,
  GazeEngineSource,
  PreCalibrationFeedback,
  GazeSample,
  PageContext,
  PageCoordinateSnapshot,
  PageEventRecord,
  PageId,
  ParticipantId,
  Point2D,
  PointerSample,
  ScrollEventRecord,
  SessionId,
  SessionRecord
} from "./types";

import type {
  TrackerStateSnapshot
} from "./state";

/* ==========================================================================
 * Message protocol
 * ======================================================================== */

/**
 * Increment this only when the message protocol changes incompatibly.
 */
export const MESSAGE_PROTOCOL_VERSION = 5 as const;

/**
 * Every Chrome runtime message type must be defined here.
 *
 * Do not use ad-hoc string message names in feature modules.
 */
export const MESSAGE_TYPES = {
  PING: "PING",
  PONG: "PONG",

  INIT_TRACKER: "INIT_TRACKER",
  TRACKER_INITIALIZED: "TRACKER_INITIALIZED",

  START_CAMERA: "START_CAMERA",
  CAMERA_READY: "CAMERA_READY",

  START_FACE_POSITIONING: "START_FACE_POSITIONING",
  FACE_POSITION_STATUS: "FACE_POSITION_STATUS",

  START_CALIBRATION: "START_CALIBRATION",
  CALIBRATION_UI_READY: "CALIBRATION_UI_READY",
  CALIBRATION_POINT: "CALIBRATION_POINT",
  CALIBRATION_POINT_RESULT: "CALIBRATION_POINT_RESULT",
  CALIBRATION_COMPLETE: "CALIBRATION_COMPLETE",
  START_VALIDATION: "START_VALIDATION",
  VALIDATION_POINT: "VALIDATION_POINT",
  VALIDATION_POINT_RESULT: "VALIDATION_POINT_RESULT",
  VALIDATION_RESULT: "VALIDATION_RESULT",

  START_QUICK_RECALIBRATION: "START_QUICK_RECALIBRATION",
  QUICK_RECALIBRATION_STARTED: "QUICK_RECALIBRATION_STARTED",
  ABORT_QUICK_RECALIBRATION: "ABORT_QUICK_RECALIBRATION",
  QUICK_RECALIBRATION_POINT: "QUICK_RECALIBRATION_POINT",
  QUICK_RECALIBRATION_POINT_RESULT: "QUICK_RECALIBRATION_POINT_RESULT",
  START_QUICK_VALIDATION: "START_QUICK_VALIDATION",
  QUICK_VALIDATION_POINT: "QUICK_VALIDATION_POINT",
  QUICK_VALIDATION_POINT_RESULT: "QUICK_VALIDATION_POINT_RESULT",

  START_RECORDING: "START_RECORDING",
  PAUSE_RECORDING: "PAUSE_RECORDING",
  RESUME_RECORDING: "RESUME_RECORDING",
  STOP_RECORDING: "STOP_RECORDING",

  GET_TRACKER_STATE: "GET_TRACKER_STATE",
  RESET_TRACKER: "RESET_TRACKER",
  TRACKER_STATE_CHANGED: "TRACKER_STATE_CHANGED",

  SESSION_STARTED: "SESSION_STARTED",
  SESSION_ENDED: "SESSION_ENDED",

  PAGE_READY: "PAGE_READY",
  PAGE_EVENT: "PAGE_EVENT",
  TAB_CHANGED: "TAB_CHANGED",
  TRACKING_CONTEXT_CHANGED: "TRACKING_CONTEXT_CHANGED",
  VIEWPORT_CONTEXT_CHANGED: "VIEWPORT_CONTEXT_CHANGED",

  AOI_PROBE: "AOI_PROBE",
  AOI_HIT: "AOI_HIT",
  AOI_REGISTRY_UPDATE: "AOI_REGISTRY_UPDATE",

  GAZE_SAMPLE: "GAZE_SAMPLE",
  POINTER_SAMPLE: "POINTER_SAMPLE",
  CLICK_EVENT: "CLICK_EVENT",
  SCROLL_EVENT: "SCROLL_EVENT",
  FIXATION_EVENT: "FIXATION_EVENT",

  EXPORT_SESSION: "EXPORT_SESSION",
  SESSION_EXPORT_READY: "SESSION_EXPORT_READY",

  DRIFT_STATUS: "DRIFT_STATUS",
  RUNTIME_QUALITY_DIAGNOSTIC: "RUNTIME_QUALITY_DIAGNOSTIC",

  TRACKER_ERROR: "TRACKER_ERROR"
} as const;

export type MessageType =
  (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/* ==========================================================================
 * Runtime contexts
 * ======================================================================== */

export type RuntimeContext =
  | "BACKGROUND"
  | "OFFSCREEN"
  | "CONTENT"
  | "POPUP"
  | "CAMERA_PERMISSION_UI"
  | "CALIBRATION_UI"
  | "BROADCAST";

/* ==========================================================================
 * Common message metadata
 * ======================================================================== */

/**
 * Metadata that accompanies every runtime message.
 *
 * All fields are explicit rather than optional so that message routing
 * remains predictable across background/offscreen/content contexts.
 */
export interface MessageMeta {
  messageId: string;

  sentAtEpochMs: EpochMs;

  source: RuntimeContext;
  target: RuntimeContext;

  sessionId: SessionId | null;
  pageId: PageId | null;

  tabId: number | null;
  browserFrameId: number | null;
}

/* ==========================================================================
 * Generic payloads
 * ======================================================================== */

export type EmptyPayload = Readonly<Record<string, never>>;

export interface PingPayload {
  nonce: string;
}

export interface PongPayload {
  nonce: string;
}

/* ==========================================================================
 * Tracker initialization
 * ======================================================================== */

export interface InitTrackerPayload {
  participantId: ParticipantId;

  preferredGazeEngine: GazeEngineSource | null;

  browser: BrowserMetadata;

  screen: ScreenMetadata;
}

export interface TrackerInitializedPayload {
  session: SessionRecord;
}

/* ==========================================================================
 * Camera
 * ======================================================================== */

export interface StartCameraPayload {
  preferredWidth: number;
  preferredHeight: number;
  preferredFrameRate: number;

  preferredDeviceId: string | null;
}

export interface CameraReadyPayload {
  settings: CameraSettings;
}

/* ==========================================================================
 * Face positioning
 * ======================================================================== */

export interface FacePositionStatusPayload {
  status: FacePositionStatus;

  feedback: PreCalibrationFeedback;
}

/* ==========================================================================
 * Calibration
 * ======================================================================== */

export interface StartCalibrationPayload {
  calibrationId: CalibrationId;

  mode: CalibrationMode;
}

/** Acknowledges that the visible Content Script mounted the calibration UI. */
export interface CalibrationUiReadyPayload {
  calibrationId: CalibrationId;
  accepted: true;
}

export interface CalibrationPointPayload {
  calibrationId: CalibrationId;

  target: CalibrationTarget;

  /**
   * Shared high-resolution timeline timestamp recorded immediately after the
   * visible target is rendered in the research-tab viewport.
   */
  targetShownAtMs: number;

  /**
   * 1-based UI retry attempt for the same point.
   */
  attempt: number;
}

export type CalibrationPointFailureReason =
  | "INSUFFICIENT_SAMPLES"
  | "UNSTABLE_GAZE"
  | "OUTLIER_REJECTION";

export interface CalibrationPointResultPayload {
  calibrationId: CalibrationId;

  pointIndex: number;

  sufficient: boolean;

  acceptedSampleCount: number;
  rejectedSampleCount: number;
  rejectionRatio: number;

  completedPointCount: number;
  expectedPointCount: number;

  failureReason:
    CalibrationPointFailureReason | null;

  modelReady: boolean;

  trainingRmseNormalized:
    number | null;

  /** Present only when the full calibration model has just been fitted. */
  trainingDiagnostics:
    CalibrationTrainingDiagnostics | null;

  /**
   * Calibration-only adaptive expansion targets selected after the initial
   * STANDARD_17 grouped-CV pass. Empty for ordinary points and final fit.
   */
  adaptiveExpansionTargets:
    readonly CalibrationTarget[];
}

export interface CalibrationCompletePayload {
  summary: CalibrationSummary;
}

export interface StartValidationPayload {
  calibrationId: CalibrationId;

  viewportWidth: number;
  viewportHeight: number;

  expectedPointCount: number;
}

export interface ValidationPointPayload {
  calibrationId: CalibrationId;

  target: CalibrationTarget;

  targetShownAtMs: number;

  attempt: number;
}

export interface SelectedStrategyValidationPayload {
  strategy:
    | "BASELINE_ONLY"
    | "DEEP_ONLY"
    | "SAFE_ADAPTIVE_HYBRID";
  metrics: CalibrationValidationMetrics;
  quality: CalibrationQualityLevel;
}

export interface ValidationPointResultPayload {
  calibrationId: CalibrationId;

  correctionStrategy:
    CalibrationCorrectionStrategy;

  pointIndex: number;

  sufficient: boolean;

  acceptedSampleCount: number;
  rejectedSampleCount: number;
  rejectionRatio: number;

  completedPointCount: number;
  expectedPointCount: number;

  failureReason:
    CalibrationPointFailureReason | null;

  validationComplete: boolean;

  metrics:
    CalibrationValidationMetrics | null;

  quality:
    CalibrationQualityLevel | null;

  /**
   * Independent readiness result for the strategy that calibration already
   * selected. Validation may pass/fail that strategy, but must never replace
   * it with another candidate.
   */
  selectedStrategyValidation:
    SelectedStrategyValidationPayload | null;

  /**
   * Populated only after the independent validation run is complete.
   * Contains one diagnostic result per validation target so systematic
   * direction/scale/edge errors can be inspected without changing the
   * calibration mathematics.
   */
  pointResults:
    readonly CalibrationPointResult[] | null;
}


export interface StartQuickRecalibrationPayload {
  calibrationId: CalibrationId;
  viewportWidth: number;
  viewportHeight: number;
  pointCount: number;
}

export interface QuickRecalibrationStartedPayload {
  calibrationId: CalibrationId;
  runId: string;
  startingPointIndex: number;
  expectedPointCount: number;
  pointCount: number;
}

export interface AbortQuickRecalibrationPayload {
  calibrationId: CalibrationId;
  runId: string;
}
export interface AbortQuickRecalibrationResultPayload extends AbortQuickRecalibrationPayload {
  rolledBack: boolean;
}
export type QuickRecalibrationPointPayload = CalibrationPointPayload & { runId: string };
export type QuickRecalibrationPointResultPayload = CalibrationPointResultPayload;

export interface StartQuickValidationPayload {
  calibrationId: CalibrationId;
  runId: string;
  viewportWidth: number;
  viewportHeight: number;
  expectedPointCount: number;
}

export type QuickValidationPointPayload = ValidationPointPayload & { runId: string };
export type QuickValidationPointResultPayload = ValidationPointResultPayload;

export interface ValidationResultPayload {
  calibrationId: string;

  metrics: CalibrationValidationMetrics;

  quality: CalibrationQualityLevel;
}

/* ==========================================================================
 * Tracker state
 * ======================================================================== */

export interface TrackerStateChangedPayload {
  snapshot: TrackerStateSnapshot;
}

/* ==========================================================================
 * Session
 * ======================================================================== */

export interface SessionStartedPayload {
  session: SessionRecord;
}

export interface SessionEndedPayload {
  session: SessionRecord;
}

/* ==========================================================================
 * Page / tab lifecycle
 * ======================================================================== */

export interface PageReadyPayload {
  context: PageContext;
}

export interface PageEventPayload {
  event: PageEventRecord;
}

/**
 * Used by the background tab manager to notify the rest of the extension
 * when the active/observed tab changes.
 *
 * openerTabId is especially useful for associating newly opened tabs with
 * the currently active eye-tracking session.
 */
export interface TabChangedPayload {
  tabId: number;
  windowId: number;

  openerTabId: number | null;

  url: string | null;

  active: boolean;
}

export type TrackingContextChangeReason =
  | "FULL_NAVIGATION"
  | "SPA_NAVIGATION"
  | "TAB_ACTIVATED"
  | "TAB_ASSOCIATED";

/**
 * Background -> Offscreen synchronization of the authoritative research tab
 * and page identity. This keeps live gaze/fixation output attached to the
 * page currently being observed without resetting calibration.
 */
export interface TrackingContextChangedPayload {
  reason: TrackingContextChangeReason;
  url: string | null;
}

/**
 * Current research-page CSS viewport. Content owns this value because browser
 * zoom/DPR can differ between hosts even when the physical window is unchanged.
 */
export interface ViewportContextChangedPayload {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

/* ==========================================================================
 * AOI
 * ======================================================================== */

/**
 * Incremental AOI registry update.
 *
 * `upserted`:
 * newly discovered AOIs or existing AOIs whose geometry/metadata changed.
 *
 * `removedAoiIds`:
 * AOIs that disappeared from the current document.
 *
 * `fullSnapshot`:
 * true when this update represents the complete current registry.
 */
export interface CompletedFixationSnapshotPayload {
  event: FixationEvent;
  peakSpeedPxPerSecond: number;
}

export interface AoiProbePayload {
  timestampMs: number;

  /**
   * Normalized point is authoritative across browser zoom/DPR changes. Content
   * remaps this point into its current CSS viewport before DOM/AOI resolution.
   */
  normalizedPoint: Point2D;

  /** Legacy/diagnostic pixel point generated by Offscreen's current viewport. */
  viewportPoint: Point2D;

  pointSource: "STABILIZED_GAZE" | "FIXATION_CENTROID";

  gazeQuality: number;

  fixationId: FixationId | null;

  degradedCollection: boolean;

  rawPredictionNormalizedPoint: Point2D | null;
  authoritativeNormalizedPoint: Point2D | null;
  stabilizedNormalizedPoint: Point2D | null;

  /** Present only for the forced probe emitted when a fixation closes. */
  completedFixation: CompletedFixationSnapshotPayload | null;
}

export interface AoiHitPayload {
  pageId: PageId;

  browserFrameId: number;

  fixationId: FixationId | null;

  pointSource: "STABILIZED_GAZE" | "FIXATION_CENTROID";

  gazeQuality: number;

  degradedCollection: boolean;

  probeNormalizedPoint: Point2D;
  rawPredictionNormalizedPoint: Point2D | null;
  authoritativeNormalizedPoint: Point2D | null;
  stabilizedNormalizedPoint: Point2D | null;
  completedFixation: CompletedFixationSnapshotPayload | null;

  /**
   * Exact viewport + full-document coordinates used for AOI resolution.
   * During an active fixation this may be the fixation centroid.
   */
  coordinates: PageCoordinateSnapshot;

  /**
   * Current per-frame stabilized gaze coordinates, independently of the AOI
   * probe point. Null only for the forced fixation-completion snapshot.
   */
  gazeCoordinates: PageCoordinateSnapshot | null;

  hit: AoiHit;
}

export interface AoiRegistryUpdatePayload {
  pageId: PageId;

  browserFrameId: number;

  upserted: readonly AoiRegistryEntry[];

  removedAoiIds: readonly AoiId[];

  fullSnapshot: boolean;
}

/* ==========================================================================
 * Tracking data
 * ======================================================================== */

export interface GazeSamplePayload {
  sample: GazeSample;
}

export interface PointerSamplePayload {
  sample: PointerSample;
}

export interface ClickEventPayload {
  event: ClickEventRecord;
}

export interface ScrollEventPayload {
  event: ScrollEventRecord;
}

export interface DriftStatusPayload {
  status: DriftStatus;
}

export interface RuntimeQualityDiagnosticPayload {
  diagnostic: RuntimeQualityDiagnostic;
}

export interface FixationEventPayload {
  event: FixationEvent;
  peakSpeedPxPerSecond: number;
}

export type SessionExportFormat =
  | "JSON"
  | "CSV";

export interface ExportSessionPayload {
  sessionId: SessionId | null;
  format: SessionExportFormat;
}

export interface SessionExportFilePayload {
  filename: string;
  mimeType: string;
  content: string;
}

export interface SessionExportReadyPayload {
  sessionId: SessionId;
  format: SessionExportFormat;
  files: readonly SessionExportFilePayload[];
}

/* ==========================================================================
 * Error transport
 * ======================================================================== */

/**
 * Serializable error representation for Chrome runtime messaging.
 *
 * Native Error objects should not be passed directly through
 * chrome.runtime.sendMessage().
 *
 * Error codes will be centralized further in shared/errors.ts.
 */
export interface TrackerErrorPayload {
  code: string;

  message: string;

  component: DiagnosticComponent;

  recoverable: boolean;

  details: Readonly<Record<string, unknown>> | null;
}

/* ==========================================================================
 * Message payload map
 * ======================================================================== */

/**
 * Central mapping between message type and its payload.
 *
 * This mapping is the basis of compile-time message safety.
 */
export interface MessagePayloadMap {
  [MESSAGE_TYPES.PING]: PingPayload;
  [MESSAGE_TYPES.PONG]: PongPayload;

  [MESSAGE_TYPES.INIT_TRACKER]: InitTrackerPayload;
  [MESSAGE_TYPES.TRACKER_INITIALIZED]: TrackerInitializedPayload;

  [MESSAGE_TYPES.START_CAMERA]: StartCameraPayload;
  [MESSAGE_TYPES.CAMERA_READY]: CameraReadyPayload;

  [MESSAGE_TYPES.START_FACE_POSITIONING]: EmptyPayload;
  [MESSAGE_TYPES.FACE_POSITION_STATUS]: FacePositionStatusPayload;

  [MESSAGE_TYPES.START_CALIBRATION]: StartCalibrationPayload;
  [MESSAGE_TYPES.CALIBRATION_UI_READY]: CalibrationUiReadyPayload;
  [MESSAGE_TYPES.CALIBRATION_POINT]: CalibrationPointPayload;
  [MESSAGE_TYPES.CALIBRATION_POINT_RESULT]: CalibrationPointResultPayload;
  [MESSAGE_TYPES.CALIBRATION_COMPLETE]: CalibrationCompletePayload;
  [MESSAGE_TYPES.START_VALIDATION]: StartValidationPayload;
  [MESSAGE_TYPES.VALIDATION_POINT]: ValidationPointPayload;
  [MESSAGE_TYPES.VALIDATION_POINT_RESULT]: ValidationPointResultPayload;
  [MESSAGE_TYPES.VALIDATION_RESULT]: ValidationResultPayload;

  [MESSAGE_TYPES.START_QUICK_RECALIBRATION]: StartQuickRecalibrationPayload;
  [MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED]: QuickRecalibrationStartedPayload;
  [MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION]: AbortQuickRecalibrationPayload | AbortQuickRecalibrationResultPayload;
  [MESSAGE_TYPES.QUICK_RECALIBRATION_POINT]: QuickRecalibrationPointPayload;
  [MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT]: QuickRecalibrationPointResultPayload;
  [MESSAGE_TYPES.START_QUICK_VALIDATION]: StartQuickValidationPayload;
  [MESSAGE_TYPES.QUICK_VALIDATION_POINT]: QuickValidationPointPayload;
  [MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT]: QuickValidationPointResultPayload;

  [MESSAGE_TYPES.START_RECORDING]: EmptyPayload;
  [MESSAGE_TYPES.PAUSE_RECORDING]: EmptyPayload;
  [MESSAGE_TYPES.RESUME_RECORDING]: EmptyPayload;
  [MESSAGE_TYPES.STOP_RECORDING]: EmptyPayload;

  [MESSAGE_TYPES.GET_TRACKER_STATE]: EmptyPayload;
  [MESSAGE_TYPES.RESET_TRACKER]: EmptyPayload;
  [MESSAGE_TYPES.TRACKER_STATE_CHANGED]: TrackerStateChangedPayload;

  [MESSAGE_TYPES.SESSION_STARTED]: SessionStartedPayload;
  [MESSAGE_TYPES.SESSION_ENDED]: SessionEndedPayload;

  [MESSAGE_TYPES.PAGE_READY]: PageReadyPayload;
  [MESSAGE_TYPES.PAGE_EVENT]: PageEventPayload;
  [MESSAGE_TYPES.TAB_CHANGED]: TabChangedPayload;
  [MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED]: TrackingContextChangedPayload;
  [MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED]: ViewportContextChangedPayload;

  [MESSAGE_TYPES.AOI_PROBE]: AoiProbePayload;
  [MESSAGE_TYPES.AOI_HIT]: AoiHitPayload;
  [MESSAGE_TYPES.AOI_REGISTRY_UPDATE]: AoiRegistryUpdatePayload;

  [MESSAGE_TYPES.GAZE_SAMPLE]: GazeSamplePayload;
  [MESSAGE_TYPES.POINTER_SAMPLE]: PointerSamplePayload;
  [MESSAGE_TYPES.CLICK_EVENT]: ClickEventPayload;
  [MESSAGE_TYPES.SCROLL_EVENT]: ScrollEventPayload;
  [MESSAGE_TYPES.FIXATION_EVENT]: FixationEventPayload;

  [MESSAGE_TYPES.EXPORT_SESSION]: ExportSessionPayload;
  [MESSAGE_TYPES.SESSION_EXPORT_READY]: SessionExportReadyPayload;

  [MESSAGE_TYPES.DRIFT_STATUS]: DriftStatusPayload;
  [MESSAGE_TYPES.RUNTIME_QUALITY_DIAGNOSTIC]: RuntimeQualityDiagnosticPayload;

  [MESSAGE_TYPES.TRACKER_ERROR]: TrackerErrorPayload;
}

/* ==========================================================================
 * Runtime message
 * ======================================================================== */

export type RuntimeMessageOf<
  TType extends MessageType
> = Readonly<{
  protocolVersion: typeof MESSAGE_PROTOCOL_VERSION;

  type: TType;

  meta: MessageMeta;

  payload: MessagePayloadMap[TType];
}>;

/**
 * Discriminated union containing every valid extension runtime message.
 */
export type RuntimeMessage = {
  [TType in MessageType]: RuntimeMessageOf<TType>;
}[MessageType];

/* ==========================================================================
 * Message creation
 * ======================================================================== */

/**
 * Creates a fully typed runtime message.
 *
 * Example:
 *
 * createRuntimeMessage(
 *   MESSAGE_TYPES.START_RECORDING,
 *   meta,
 *   {}
 * );
 *
 * Passing the wrong payload for a message type is rejected by TypeScript.
 */
export function createRuntimeMessage<
  TType extends MessageType
>(
  type: TType,
  meta: MessageMeta,
  payload: MessagePayloadMap[TType]
): RuntimeMessageOf<TType> {
  return {
    protocolVersion: MESSAGE_PROTOCOL_VERSION,
    type,
    meta,
    payload
  };
}

/* ==========================================================================
 * Runtime validation helpers
 * ======================================================================== */

const MESSAGE_TYPE_VALUES: ReadonlySet<string> =
  new Set<string>(Object.values(MESSAGE_TYPES));

export function isMessageType(
  value: unknown
): value is MessageType {
  return (
    typeof value === "string"
    && MESSAGE_TYPE_VALUES.has(value)
  );
}

export function isCompatibleMessageProtocol(
  value: unknown
): value is typeof MESSAGE_PROTOCOL_VERSION {
  return value === MESSAGE_PROTOCOL_VERSION;
}