/**
 * Shared domain types for the Webcam Eye Tracker extension.
 *
 * IMPORTANT
 * ---------
 * 1. This file must not depend on feature modules.
 * 2. Feature modules may import types from this file.
 * 3. Coordinate spaces must always be explicit.
 * 4. Webcam frames / face images / eye crops are intentionally not
 *    represented as persistent research data types.
 */

/* ==========================================================================
 * Primitive identifiers
 * ======================================================================== */

export type SessionId = string;
export type ParticipantId = string;
export type PageId = string;
export type SampleId = string;
export type FixationId = string;
export type CalibrationId = string;
export type CalibrationProfileId = string;
export type AoiId = string;
export type DiagnosticId = string;
export type UploadQueueId = string;

/**
 * Shared interaction timeline timestamp in milliseconds.
 *
 * Gaze, pointer, click, scroll and related real-time events must use
 * the same timeline basis so cross-context timing can be compared.
 *
 * The actual clock implementation will be centralized in shared/utils.ts.
 */
export type TimestampMs = number;

/**
 * Unix epoch timestamp in milliseconds.
 *
 * Intended for session metadata, export metadata, diagnostics, etc.
 */
export type EpochMs = number;

/* ==========================================================================
 * General utility types
 * ======================================================================== */

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface Rect2D {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Range2D {
  min: Point2D;
  max: Point2D;
}

export type CoordinateSpace =
  | "MODEL"
  | "NORMALIZED"
  | "VIEWPORT"
  | "DOCUMENT"
  | "SCREEN";

export interface CoordinatePoint extends Point2D {
  space: CoordinateSpace;
}

export type DataQualityLevel =
  | "GOOD"
  | "FAIR"
  | "POOR"
  | "INVALID";

export type CalibrationQualityLevel =
  | "GOOD"
  | "ACCEPTABLE"
  | "POOR"
  | "FAIL";

export type TextStoragePolicy =
  | "RAW"
  | "HASHED"
  | "NONE";

/* ==========================================================================
 * Browser / page context
 * ======================================================================== */

export interface BrowserFrameContext {
  tabId: number;
  windowId: number;
  browserFrameId: number;
  parentBrowserFrameId: number | null;
}

export interface ViewportContext {
  viewportWidth: number;
  viewportHeight: number;

  documentWidth: number;
  documentHeight: number;

  scrollX: number;
  scrollY: number;

  devicePixelRatio: number;
}

export interface PageContext {
  pageId: PageId;
  sessionId: SessionId;

  url: string;
  origin: string;

  frame: BrowserFrameContext;
  viewport: ViewportContext;

  documentVisible: boolean;
  activeTab: boolean;
  windowFocused: boolean;
}

/**
 * Page-relative coordinate snapshot captured when a gaze/AOI probe is
 * resolved in the research page.
 *
 * `viewportPoint` stays stable relative to the visible browser viewport.
 * `documentPoint` adds the current scroll offset so the same observation can
 * later be plotted on a full-page scatter/heatmap.
 */
export interface PageCoordinateSnapshot {
  capturedAtEpochMs: EpochMs;

  url: string;
  origin: string;

  viewportPoint: Point2D;
  documentPoint: Point2D;

  insideViewport: boolean;

  viewportWidth: number;
  viewportHeight: number;

  documentWidth: number;
  documentHeight: number;

  scrollX: number;
  scrollY: number;

  devicePixelRatio: number;
}

/* ==========================================================================
 * Camera
 * ======================================================================== */

export interface CameraSettings {
  width: number;
  height: number;
  frameRate: number;

  deviceId: string | null;
  facingMode: string | null;
}

export interface CameraFrameMetadata {
  frameSequence: number;
  timestampMs: TimestampMs;

  width: number;
  height: number;
}

/**
 * Camera quality values are runtime metrics only.
 * They do not contain webcam image data.
 */
export interface CameraQuality {
  brightness: number;
  sharpness: number;

  frameRateActual: number;

  quality: DataQualityLevel;
}

/* ==========================================================================
 * Face / eye
 * ======================================================================== */

export interface HeadPose {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface FaceBaseline {
  centerX: number;
  centerY: number;

  width: number;
  height: number;

  headPose: HeadPose;

  distanceRatio: number;
}

export interface FaceTrackingQuality {
  faceValid: boolean;
  eyesValid: boolean;

  leftEyeVisible: boolean;
  rightEyeVisible: boolean;

  blink: boolean;

  faceConfidence: number;
  eyeConfidence: number;

  faceDistanceRatio: number;

  headPose: HeadPose;

  qualityScore: number;
  qualityLevel: DataQualityLevel;
}

export interface FacePositionStatus {
  faceDetected: boolean;
  bothEyesVisible: boolean;

  horizontallyCentered: boolean;
  verticallyCentered: boolean;

  distanceAcceptable: boolean;
  headPoseAcceptable: boolean;
  brightnessAcceptable: boolean;

  stable: boolean;
}

/**
 * Primary user-facing instruction during pre-calibration positioning.
 *
 * Horizontal movement is expressed in the mirrored/selfie-view coordinate
 * system used by the positioning overlay, so the instruction matches the
 * direction the participant sees on screen.
 */
export type FacePositionInstruction =
  | "FIND_FACE"
  | "SHOW_BOTH_EYES"
  | "MOVE_CLOSER"
  | "MOVE_FARTHER"
  | "MOVE_LEFT"
  | "MOVE_RIGHT"
  | "MOVE_UP"
  | "MOVE_DOWN"
  | "FACE_FORWARD"
  | "IMPROVE_LIGHTING"
  | "REDUCE_LIGHTING"
  | "HOLD_STEADY"
  | "READY";

/**
 * Numeric diagnostics used only to render pre-calibration guidance.
 *
 * These values are transient. They are not webcam frames and do not contain
 * raw face landmarks.
 */
export interface FacePositionMetrics {
  centerX: number | null;
  centerY: number | null;

  widthRatio: number | null;
  heightRatio: number | null;
  proximityProxy: number | null;

  yawDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;

  brightness: number | null;

  stableDurationMs: number;
  stableProgress: number;
}

/**
 * Complete transient status required by the visible pre-calibration overlay.
 *
 * `cameraFaceBoxNormalized` is in the unmirrored camera coordinate system.
 * The UI mirrors it horizontally for intuitive selfie-style positioning.
 */
export interface PreCalibrationFeedback {
  status: FacePositionStatus;

  instruction: FacePositionInstruction;

  readyForCalibration: boolean;

  cameraFaceBoxNormalized: Rect2D | null;

  metrics: FacePositionMetrics;
}

/* ==========================================================================
 * Gaze engine
 * ======================================================================== */

export type GazeEngineSource =
  | "WEB_EYE_TRACK"
  | "RIDGE"
  | "ONNX"
  | "CUSTOM";

export interface GazePrediction {
  timestampMs: TimestampMs;

  /**
   * Raw coordinates emitted by the gaze engine.
   * rawSpace MUST specify what these values mean.
   */
  rawPoint: Point2D;
  rawSpace: CoordinateSpace;

  confidence: number;

  faceValid: boolean;
  eyesValid: boolean;

  headPose: HeadPose;

  source: GazeEngineSource;
}

/* ==========================================================================
 * Gaze correction / uncertainty
 * ======================================================================== */

/**
 * Gaze uncertainty expressed in viewport pixels.
 */
export interface GazeUncertainty {
  sigmaXPx: number;
  sigmaYPx: number;

  calibrationDistancePx: number;
}

/**
 * Personal/calibration correction applied in viewport pixel space.
 */
export interface GazeCorrection {
  viewportOffsetXPx: number;
  viewportOffsetYPx: number;
}

/* ==========================================================================
 * Final gaze sample
 * ======================================================================== */

/**
 * Central research gaze record.
 *
 * Raw, corrected and filtered gaze are intentionally stored separately.
 */
export interface GazeSample {
  sampleId: SampleId;
  sessionId: SessionId;

  timestampMs: TimestampMs;
  captureFrameSequence: number;

  /**
   * Raw gaze generated by the gaze engine.
   */
  rawPoint: Point2D;
  rawSpace: CoordinateSpace;

  /**
   * Calibration/personal correction result in viewport coordinates.
   */
  correctedViewportPoint: Point2D;

  /**
   * Smoothed point intended mainly for visualization/runtime use.
   */
  filteredViewportPoint: Point2D;

  /**
   * 0..1 normalized viewport position.
   */
  normalizedPoint: Point2D;

  /**
   * Explicit viewport coordinate.
   */
  viewportPoint: Point2D;

  /**
   * Viewport coordinate + current scroll offset.
   */
  documentPoint: Point2D;

  gazeValid: boolean;
  gazeQuality: number;
  gazeQualityLevel: DataQualityLevel;

  insideViewport: boolean;

  uncertainty: GazeUncertainty;

  face: {
    faceValid: boolean;
    eyesValid: boolean;
    blink: boolean;

    headPose: HeadPose;

    faceDistanceRatio: number;
  };

  pageId: PageId;

  tabId: number;
  windowId: number;

  browserFrameId: number;

  aoiId: AoiId | null;

  engineSource: GazeEngineSource;
}

/* ==========================================================================
 * Calibration
 * ======================================================================== */

export type CalibrationMode =
  | "STANDARD_17"
  | "PRECISION_25";

/**
 * Calibration correction path used for one complete calibration/validation
 * run. Keeping this explicit makes A/B pilot runs reproducible and prevents
 * an engine-native personalization step from silently replacing the project
 * residual model.
 */
export type CalibrationCorrectionStrategy =
  | "PROJECT_RESIDUAL_ONLY"
  | "WEBEYETRACK_NATIVE_ONLY";

export interface CalibrationTarget {
  pointIndex: number;

  normalizedPoint: Point2D;
  viewportPoint: Point2D;
}

export interface CalibrationRawSample {
  calibrationId: CalibrationId;

  pointIndex: number;

  timestampMs: TimestampMs;

  targetViewportPoint: Point2D;

  rawGazePoint: Point2D;
  rawGazeSpace: CoordinateSpace;

  headPose: HeadPose;

  faceDistanceRatio: number;

  /** Normalized camera-space face center used for transient stability checks. */
  faceCenterNormalized?: Point2D | null;

  faceValid: boolean;
  eyesValid: boolean;
  blink: boolean;

  quality: number;

  accepted: boolean;
}

export interface CalibrationPointResult {
  calibrationId: CalibrationId;

  pointIndex: number;

  /**
   * Ground-truth calibration target in viewport coordinates.
   */
  targetViewportPoint: Point2D;

  /**
   * Mean raw gaze prediction for this calibration point.
   *
   * rawMeanSpace explicitly defines the coordinate space.
   */
  rawMeanPoint: Point2D;
  rawMeanSpace: CoordinateSpace;

  /**
   * The same raw prediction converted to viewport CSS pixels.
   * This is diagnostic-only and does not replace rawMeanPoint.
   */
  rawViewportPoint: Point2D;

  /**
   * Signed raw viewport-space error before calibration correction.
   */
  rawErrorXPx: number;
  rawErrorYPx: number;

  /**
   * Euclidean raw viewport-space error before correction.
   */
  rawErrorPx: number;

  /**
   * Calibration-corrected prediction in viewport coordinates.
   */
  correctedViewportPoint: Point2D;

  /**
   * Signed corrected viewport-space error in pixels.
   */
  errorXPx: number;
  errorYPx: number;

  /**
   * Euclidean corrected viewport-space error.
   */
  errorPx: number;

  /**
   * Positive means correction reduced target error; negative means it made
   * this point worse.
   */
  correctionImprovementPx: number;

  sampleCount: number;
  rejectedCount: number;

  /** Per-point temporal spread after calibration correction. */
  meanPrecisionPx?: number;
  p95PrecisionPx?: number;

  meanHeadPose: HeadPose;
  meanFaceDistanceRatio: number;

  meanQuality: number;
}

export interface CalibrationTrainingDiagnostics {
  pointCount: number;

  rawMeanErrorPx: number;
  rawP95ErrorPx: number;
  rawRmsePx: number;

  correctedMeanErrorPx: number;
  correctedP95ErrorPx: number;
  correctedRmsePx: number;

  /** Positive means the fitted residual reduced training-point error. */
  meanCorrectionImprovementPx: number;

  improvedPointCount: number;
  degradedPointCount: number;
  unchangedPointCount: number;
}

export interface CalibrationValidationMetrics {
  /** Viewport used for this independent validation run. */
  viewportWidthPx: number;
  viewportHeightPx: number;

  /** Raw (pre-correction) accuracy on independent validation targets. */
  rawMeanErrorPx: number;
  rawP95ErrorPx: number;
  rawRmsePx: number;

  /** Corrected accuracy on independent validation targets. */
  meanErrorPx: number;
  medianErrorPx: number;
  rmsePx: number;

  p90ErrorPx: number;
  p95ErrorPx: number;
  maxErrorPx: number;

  horizontalErrorPx: number;
  verticalErrorPx: number;

  centerErrorPx: number;
  edgeErrorPx: number;
  cornerErrorPx: number;

  /**
   * Resolution/zoom-robust accuracy ratios.
   *
   * Error is divided by CSS viewport width rather than by raw device pixels.
   * These ratios are not visual angles, but they remain comparable across
   * browser zoom and common display resolutions and are safe to use without
   * inventing a physical screen size or viewing distance.
   */
  meanErrorViewportWidthRatio: number;
  p95ErrorViewportWidthRatio: number;

  /**
   * Precision measures within-target gaze spread after correction. Accuracy
   * can be good while precision is poor, so both are required for the READY
   * quality gate.
   */
  meanPrecisionPx: number;
  p95PrecisionPx: number;
  meanPrecisionViewportWidthRatio: number;
  p95PrecisionViewportWidthRatio: number;

  /**
   * Aggregate correction effect on validation targets. Positive improvement
   * means corrected gaze is closer to the target than raw gaze.
   */
  meanCorrectionImprovementPx: number;
  improvedPointCount: number;
  degradedPointCount: number;

  /** Accepted gaze samples / all stored validation samples after cleaning. */
  validSampleRatio: number;
}

export interface CalibrationSummary {
  calibrationId: CalibrationId;

  profileId: CalibrationProfileId;

  sessionId: SessionId;

  mode: CalibrationMode;

  startedAtEpochMs: EpochMs;
  completedAtEpochMs: EpochMs;

  baseline: FaceBaseline;

  validation: CalibrationValidationMetrics;

  quality: CalibrationQualityLevel;

  pointCount: number;

  acceptedSampleCount: number;
  rejectedSampleCount: number;

  gazeEngine: GazeEngineSource;
}

/* ==========================================================================
 * Drift
 * ======================================================================== */

export type DriftSeverity =
  | "NONE"
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export interface DriftStatus {
  timestampMs: TimestampMs;

  severity: DriftSeverity;

  faceCenterDeltaPx: number;
  faceDistanceDeltaRatio: number;

  yawDeltaDeg: number;
  pitchDeltaDeg: number;
  rollDeltaDeg: number;

  gazeVariance: number;

  /** Participant-specific early-session fixation precision reference. */
  precisionReferencePx?: number | null;

  /** Current fixation-like dispersion divided by the learned reference. */
  precisionRatio?: number | null;

  /** Time since the current maintenance epoch began. */
  monitoringElapsedMs?: number;

  /** True when the ten-minute multi-point maintenance interval elapsed. */
  periodicMaintenanceDue?: boolean;

  /** Why maintenance was requested; diagnostic-only and target-free. */
  maintenanceReason?: "POSE" | "PRECISION" | "PERIODIC" | null;

  qualityScore: number;

  quickRecalibrationRecommended: boolean;
}

export type RuntimeQualityDiagnosticMilestone =
  | "T0"
  | "T2"
  | "T5"
  | "T10";

export interface RuntimeQualityDiagnostic {
  timestampMs: TimestampMs;
  milestone: RuntimeQualityDiagnosticMilestone;
  elapsedMs: number;
  gazeQualityScore: number;
  effectiveGazeQualityScore: number;
  baselinePrecisionPx: number | null;
  deepPrecisionPx: number | null;
  driftStatus: DriftStatus | null;
  authoritativeStrategy:
    | "BASELINE_ONLY"
    | "DEEP_ONLY"
    | "SAFE_ADAPTIVE_HYBRID"
    | "BASELINE_FALLBACK";
  collectionAllowed: boolean;
  degradedCollection: boolean;
}

/* ==========================================================================
 * AOI
 * ======================================================================== */

export type AoiType =
  | "BUTTON"
  | "LINK"
  | "INPUT"
  | "TEXTAREA"
  | "SELECT"
  | "IMAGE"
  | "CHECKBOX"
  | "RADIO"
  | "TAB"
  | "MENU_ITEM"
  | "VIDEO"
  | "CANVAS"
  | "IFRAME"
  | "TEXT"
  | "CONTAINER"
  | "CUSTOM"
  | "UNKNOWN";

export interface AoiRegistryEntry {
  aoiId: AoiId;

  pageId: PageId;

  browserFrameId: number;

  tagName: string;

  elementId: string | null;

  role: string | null;
  ariaLabel: string | null;
  elementName: string | null;

  textLabel: string | null;
  textHash: string | null;

  cssSelector: string;
  domPath: string;

  aoiType: AoiType;

  interactive: boolean;

  /**
   * AOI rectangle relative to the current viewport.
   *
   * Equivalent to the coordinate space used by getBoundingClientRect().
   */
  viewportRect: Rect2D;

  /**
   * AOI rectangle relative to the full document.
   *
   * documentRect.left = viewportRect.left + scrollX
   * documentRect.top  = viewportRect.top  + scrollY
   */
  documentRect: Rect2D;

  visible: boolean;
  enabled: boolean;

  textStoragePolicy: TextStoragePolicy;

  createdAtEpochMs: EpochMs;
  updatedAtEpochMs: EpochMs;
}

export interface AoiHitCandidate {
  aoiId: AoiId;

  probability: number;

  distancePx: number;

  inside: boolean;
}

export interface AoiHit {
  timestampMs: TimestampMs;

  primaryAoiId: AoiId | null;

  candidates: readonly AoiHitCandidate[];
}

/* ==========================================================================
 * Pointer / mouse
 * ======================================================================== */

export interface PointerSample {
  timestampMs: TimestampMs;

  sessionId: SessionId;
  pageId: PageId;

  viewportPoint: Point2D;
  documentPoint: Point2D;

  movementX: number;
  movementY: number;

  movementDistancePx: number;
  velocityPxPerMs: number;

  idle: boolean;

  aoiId: AoiId | null;

  tabId: number;
  browserFrameId: number;
}

/* ==========================================================================
 * Click
 * ======================================================================== */

export type MouseButton =
  | 0
  | 1
  | 2
  | 3
  | 4;

export interface ClickEventRecord {
  timestampMs: TimestampMs;

  sessionId: SessionId;
  pageId: PageId;

  viewportPoint: Point2D;
  documentPoint: Point2D;

  button: MouseButton;

  aoiId: AoiId | null;

  elementTag: string | null;
  elementRole: string | null;
  elementId: string | null;

  gazeViewportPointAtClick: Point2D | null;

  gazeClickDistancePx: number | null;

  lastFixationId: FixationId | null;

  gazeToClickLatencyMs: number | null;

  tabId: number;
  browserFrameId: number;
}

/* ==========================================================================
 * Scroll
 * ======================================================================== */

export type ScrollDirection =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "NONE";

export type ScrollPhase =
  | "START"
  | "MOVE"
  | "END";

export interface ScrollEventRecord {
  timestampMs: TimestampMs;

  sessionId: SessionId;
  pageId: PageId;

  scrollX: number;
  scrollY: number;

  deltaX: number;
  deltaY: number;

  velocityPxPerMs: number;

  direction: ScrollDirection;
  phase: ScrollPhase;

  tabId: number;
  browserFrameId: number;
}

/* ==========================================================================
 * Navigation
 * ======================================================================== */

export type NavigationType =
  | "LINK"
  | "TYPED"
  | "AUTO_BOOKMARK"
  | "AUTO_SUBFRAME"
  | "MANUAL_SUBFRAME"
  | "GENERATED"
  | "START_PAGE"
  | "FORM_SUBMIT"
  | "RELOAD"
  | "KEYWORD"
  | "KEYWORD_GENERATED"
  | "HISTORY"
  | "SPA"
  | "OTHER";

export type PageLifecycleEventType =
  | "NAVIGATION_START"
  | "NAVIGATION_COMMITTED"
  | "DOM_READY"
  | "PAGE_READY"
  | "PAGE_HIDDEN"
  | "PAGE_VISIBLE"
  | "PAGE_UNLOAD";

export interface PageEventRecord {
  timestampMs: TimestampMs;

  sessionId: SessionId;
  pageId: PageId;

  eventType: PageLifecycleEventType;

  url: string;
  origin: string;

  navigationType: NavigationType;

  tabId: number;
  windowId: number;

  browserFrameId: number;
  parentBrowserFrameId: number | null;

  documentVisible: boolean;
  activeTab: boolean;
  windowFocused: boolean;
}

/* ==========================================================================
 * Fixation / derived gaze events
 * ======================================================================== */

export interface FixationEvent {
  fixationId: FixationId;

  sessionId: SessionId;
  pageId: PageId;

  startTimeMs: TimestampMs;
  endTimeMs: TimestampMs;

  durationMs: number;

  centroidViewportPoint: Point2D;

  dispersionX: number;
  dispersionY: number;
  dispersionPx: number;

  sampleCount: number;

  qualityMean: number;

  aoiId: AoiId | null;
  aoiDwellRatio: number;
}

/* ==========================================================================
 * Session
 * ======================================================================== */

export interface ScreenMetadata {
  width: number;
  height: number;

  availableWidth: number;
  availableHeight: number;

  devicePixelRatio: number;

  orientationType: string | null;
  orientationAngleDeg: number | null;
}

export interface BrowserMetadata {
  browserName: string;
  browserVersion: string;

  operatingSystem: string;

  userAgent: string;
}

export interface SessionRecord {
  sessionId: SessionId;
  projectId?: string | null;

  participantId: ParticipantId;

  startedAtEpochMs: EpochMs;
  endedAtEpochMs: EpochMs | null;

  durationMs: number | null;

  extensionVersion: string;
  schemaVersion: number;
  trackerVersion: string;

  gazeEngine: GazeEngineSource;

  browser: BrowserMetadata;

  screen: ScreenMetadata;

  camera: CameraSettings | null;

  calibrationProfileId: CalibrationProfileId | null;
}

/* ==========================================================================
 * Runtime diagnostics
 * ======================================================================== */

export type DiagnosticLevel =
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR";

export type DiagnosticComponent =
  | "BACKGROUND"
  | "OFFSCREEN"
  | "CAMERA"
  | "FACE"
  | "GAZE"
  | "CALIBRATION"
  | "AOI"
  | "CONTENT"
  | "STORAGE"
  | "NETWORK"
  | "POPUP"
  | "UNKNOWN";

export interface DiagnosticRecord {
  diagnosticId: DiagnosticId;

  timestampEpochMs: EpochMs;

  level: DiagnosticLevel;
  component: DiagnosticComponent;

  code: string;
  message: string;

  sessionId: SessionId | null;
  pageId: PageId | null;

  details:
    Readonly<Record<string, unknown>>
    | null;
}

/* ==========================================================================
 * Upload queue
 * ======================================================================== */

export type UploadQueueStatus =
  | "PENDING"
  | "UPLOADING"
  | "COMPLETED"
  | "FAILED";

export interface UploadQueueItem {
  uploadId: UploadQueueId;

  sessionId: SessionId;

  createdAtEpochMs: EpochMs;
  updatedAtEpochMs: EpochMs;

  status: UploadQueueStatus;

  attemptCount: number;

  nextRetryAtEpochMs:
    EpochMs | null;

  lastErrorCode:
    string | null;

  lastErrorMessage:
    string | null;
}

/* ==========================================================================
 * Export
 * ======================================================================== */

export type ExportFormat =
  | "JSON"
  | "CSV";

export interface ExportMetadata {
  schemaVersion: number;

  exportedAtEpochMs: EpochMs;

  format: ExportFormat;

  sessionId: SessionId;
}