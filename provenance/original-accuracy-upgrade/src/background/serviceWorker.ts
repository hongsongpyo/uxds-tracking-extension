import {
  isCameraRequest,
  isCameraSettings
} from "../camera/cameraConfig";

import {
  createCalibrationId,
  createMessageId,
  isFiniteNumber,
  isHttpOrHttpsUrl,
  isNullableFiniteNumber,
  isNullableString,
  isRecord,
  nowEpochMs,
  sleep
} from "../shared/utils";

import {
  AOI,
  CALIBRATION,
  DRIFT_THRESHOLDS,
  GAZE_ENGINE_DEFAULTS,
  NAVIGATION,
  OFFSCREEN_RUNTIME,
  PAGE_TRACKING
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  isTrackerErrorCode,
  normalizeTrackerError
} from "../shared/errors";

import {
  MESSAGE_TYPES,
  createRuntimeMessage,
  isCompatibleMessageProtocol
} from "../shared/messages";

import {
  createLogger
} from "../shared/logger";

import {
  TRACKER_STATES,
  TrackerStateMachine
} from "../shared/state";

import {
  isEmptyPayload,
  isPingPayload,
  isPongPayload,
  messageRouter
} from "./messageRouter";

import {
  sessionManager
} from "./sessionManager";

import {
  tabManager
} from "./tabManager";

import {
  experimentStorage
} from "../storage/experimentStorage";

import type {
  AoiHitPayload,
  AoiProbePayload,
  AoiRegistryUpdatePayload,
  CalibrationPointPayload,
  CalibrationPointResultPayload,
  CameraReadyPayload,
  FacePositionStatusPayload,
  ExportSessionPayload,
  FixationEventPayload,
  InitTrackerPayload,
  MessageMeta,
  RuntimeContext,
  StartCalibrationPayload,
  StartCameraPayload,
  AbortQuickRecalibrationPayload,
  StartQuickRecalibrationPayload,
  QuickRecalibrationStartedPayload,
  QuickRecalibrationPointPayload,
  StartQuickValidationPayload,
  QuickValidationPointPayload,
  DriftStatusPayload,
  RuntimeQualityDiagnosticPayload,
  StartValidationPayload,
  ScrollEventPayload,
  TrackerErrorPayload,
  TrackingContextChangedPayload,
  ValidationPointPayload,
  ViewportContextChangedPayload,
  ValidationPointResultPayload
} from "../shared/messages";

import type {
  AoiRegistryEntry,
  BrowserMetadata,
  CalibrationPointResult,
  DiagnosticComponent,
  FacePositionStatus,
  FixationEvent,
  GazeEngineSource,
  PageCoordinateSnapshot,
  PreCalibrationFeedback,
  ScreenMetadata,
  ScrollEventRecord,
  SessionId
} from "../shared/types";

import type {
  TabDescriptor,
  TrackedTabState
} from "./tabManager";

/* ==========================================================================
 * Logger
 * ======================================================================== */

const logger =
  createLogger("BACKGROUND");

function logValidationPointDiagnostics(
  points: readonly CalibrationPointResult[] | null
): void {
  if (points === null) {
    return;
  }

  for (const point of points) {
    logger.info(
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
        correctionImprovementPx:
          point.correctionImprovementPx,
        sampleCount: point.sampleCount,
        rejectedCount: point.rejectedCount,
        quality: point.meanQuality
      }
    );
  }
}

/* ==========================================================================
 * Authoritative tracker state
 * ======================================================================== */

/**
 * The background service worker owns the authoritative runtime state.
 *
 * Persistent restoration across MV3 worker suspension will later be
 * connected through the storage layer.
 */
const trackerStateMachine =
  new TrackerStateMachine();

/**
 * D23 runtime-only AOI registry. D25 will persist these entries in IndexedDB.
 * Keeping the registry here now lets the background validate routing and makes
 * AOI smoke diagnostics independent of Content Script console visibility.
 */
const aoiRegistryByPage =
  new Map<string, Map<string, AoiRegistryEntry>>();

const lastAoiPrimaryByPage =
  new Map<string, string | null>();

const lastAoiSmokeAtByPage =
  new Map<string, number>();

/**
 * D24 runtime-only scroll state. D25 will persist the full event stream.
 */
const latestScrollByPage =
  new Map<string, ScrollEventRecord>();

const lastScrollSmokeAtByPage =
  new Map<string, number>();

/** Fixations that already received a Content-resolved coordinate/AOI snapshot. */
const enrichedFixationIds =
  new Set<string>();

function isPersistentCollectionState(): boolean {
  const state = trackerStateMachine.getSnapshot().state;
  return (
    state === TRACKER_STATES.READY
    || state === TRACKER_STATES.RECORDING
  );
}

/* ==========================================================================
 * New-tab navigation-target cache
 * ======================================================================== */

interface NavigationTargetRecord {
  targetTabId: number;

  sourceTabId: number;

  url: string;

  createdAtEpochMs: number;
}

/**
 * webNavigation.onCreatedNavigationTarget can provide a reliable sourceTabId
 * even when a newly created Tab object does not expose openerTabId.
 */
const navigationTargets =
  new Map<number, NavigationTargetRecord>();

/* ==========================================================================
 * Offscreen lifecycle single-flight lock
 * ======================================================================== */

/**
 * Serializes Offscreen creation + health checks inside one service-worker
 * lifetime. This prevents concurrent INIT requests from racing into multiple
 * chrome.offscreen.createDocument() calls.
 */
let ensureOffscreenPromise:
  Promise<void> | null =
    null;

/* ==========================================================================
 * Calibration flow generation / reload restart coordination
 * ======================================================================== */

/**
 * Incremented whenever a tracked top-level document reload invalidates the
 * current pre-calibration/calibration/validation flow. Async work captures
 * the generation that created it and must stop when a newer generation wins.
 *
 * This prevents a calibration START that was already in flight for the old
 * document from painting targets or changing state after the page reloads.
 */
let calibrationFlowGeneration = 0;

/**
 * Only one FACE_POSITIONING -> CALIBRATING hand-off may run at a time.
 * A reload waits for the old hand-off to acknowledge cancellation before it
 * restarts face positioning, so Offscreen cannot end up with two competing
 * calibration IDs.
 */
let calibrationStartPromise:
  Promise<void> | null =
    null;

/**
 * De-duplicates repeated top-frame reload signals for the same tab.
 */
const reloadRestartPromises =
  new Map<number, Promise<void>>();

/* ==========================================================================
 * Runtime validation helpers
 * ======================================================================== */

const DIAGNOSTIC_COMPONENT_VALUES:
  ReadonlySet<string> =
    new Set<string>([
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
    ] satisfies readonly DiagnosticComponent[]);

function isDiagnosticComponent(
  value: unknown
): value is DiagnosticComponent {
  return (
    typeof value === "string"
    && DIAGNOSTIC_COMPONENT_VALUES.has(value)
  );
}

function isTrackerErrorPayload(
  value: unknown
): value is TrackerErrorPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isTrackerErrorCode(value.code)
    && typeof value.message === "string"
    && value.message.trim().length > 0
    && isDiagnosticComponent(
      value.component
    )
    && typeof value.recoverable
      === "boolean"
    && (
      value.details === null
      || isRecord(value.details)
    )
  );
}

/* ==========================================================================
 * Gaze-engine validation
 * ======================================================================== */

const GAZE_ENGINE_VALUES:
  ReadonlySet<string> =
    new Set<string>([
      "WEB_EYE_TRACK",
      "RIDGE",
      "ONNX",
      "CUSTOM"
    ] satisfies readonly GazeEngineSource[]);

function isGazeEngineSource(
  value: unknown
): value is GazeEngineSource {
  return (
    typeof value === "string"
    && GAZE_ENGINE_VALUES.has(value)
  );
}

/* ==========================================================================
 * Browser metadata validation
 * ======================================================================== */

function isBrowserMetadata(
  value: unknown
): value is BrowserMetadata {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.browserName === "string"
    && typeof value.browserVersion === "string"
    && typeof value.operatingSystem === "string"
    && typeof value.userAgent === "string"
  );
}

/* ==========================================================================
 * Screen metadata validation
 * ======================================================================== */

function isScreenMetadata(
  value: unknown
): value is ScreenMetadata {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.width)
    && isFiniteNumber(value.height)
    && isFiniteNumber(value.availableWidth)
    && isFiniteNumber(value.availableHeight)
    && isFiniteNumber(value.devicePixelRatio)
    && isNullableString(
      value.orientationType
    )
    && isNullableFiniteNumber(
      value.orientationAngleDeg
    )
  );
}

/* ==========================================================================
 * Camera payload validation
 * ======================================================================== */

function isStartCameraPayload(
  payload: unknown
): payload is StartCameraPayload {
  return isCameraRequest(
    payload
  );
}

function isCameraReadyPayload(
  payload: unknown
): payload is CameraReadyPayload {
  return (
    isRecord(payload)
    && isCameraSettings(
      payload.settings
    )
  );
}

/* ==========================================================================
 * Face-position payload validation
 * ======================================================================== */

function isFacePositionStatus(
  value: unknown
): value is FacePositionStatus {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.faceDetected
      === "boolean"
    && typeof value.bothEyesVisible
      === "boolean"
    && typeof value.horizontallyCentered
      === "boolean"
    && typeof value.verticallyCentered
      === "boolean"
    && typeof value.distanceAcceptable
      === "boolean"
    && typeof value.headPoseAcceptable
      === "boolean"
    && typeof value.brightnessAcceptable
      === "boolean"
    && typeof value.stable
      === "boolean"
  );
}

const FACE_POSITION_INSTRUCTION_VALUES:
  ReadonlySet<string> =
    new Set<string>([
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

function isNullableMetric(
  value: unknown
): value is number | null {
  return (
    value === null
    || isFiniteNumber(value)
  );
}

function isPreCalibrationFeedback(
  value: unknown
): value is PreCalibrationFeedback {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isFacePositionStatus(
      value.status
    )
    || typeof value.instruction
      !== "string"
    || !FACE_POSITION_INSTRUCTION_VALUES
      .has(value.instruction)
    || typeof value.readyForCalibration
      !== "boolean"
  ) {
    return false;
  }

  if (
    value.cameraFaceBoxNormalized
      !== null
  ) {
    if (
      !isRecord(
        value.cameraFaceBoxNormalized
      )
      || !isFiniteNumber(
        value.cameraFaceBoxNormalized.left
      )
      || !isFiniteNumber(
        value.cameraFaceBoxNormalized.top
      )
      || !isFiniteNumber(
        value.cameraFaceBoxNormalized.width
      )
      || !isFiniteNumber(
        value.cameraFaceBoxNormalized.height
      )
    ) {
      return false;
    }
  }

  if (!isRecord(value.metrics)) {
    return false;
  }

  const metrics =
    value.metrics;

  return (
    isNullableMetric(metrics.centerX)
    && isNullableMetric(metrics.centerY)
    && isNullableMetric(metrics.widthRatio)
    && isNullableMetric(metrics.heightRatio)
    && isNullableMetric(metrics.proximityProxy)
    && isNullableMetric(metrics.yawDeg)
    && isNullableMetric(metrics.pitchDeg)
    && isNullableMetric(metrics.rollDeg)
    && isNullableMetric(metrics.brightness)
    && isFiniteNumber(
      metrics.stableDurationMs
    )
    && metrics.stableDurationMs >= 0
    && isFiniteNumber(
      metrics.stableProgress
    )
    && metrics.stableProgress >= 0
    && metrics.stableProgress <= 1
  );
}

function isFacePositionStatusPayload(
  payload: unknown
): payload is FacePositionStatusPayload {
  return (
    isRecord(payload)
    && isFacePositionStatus(
      payload.status
    )
    && isPreCalibrationFeedback(
      payload.feedback
    )
  );
}

/* ==========================================================================
 * Calibration payload validation
 * ======================================================================== */

function isCalibrationMode(
  value: unknown
): value is "STANDARD_17" | "PRECISION_25" {
  return (
    value === "STANDARD_17"
    || value === "PRECISION_25"
  );
}

function isStartCalibrationPayload(
  payload: unknown
): payload is StartCalibrationPayload {
  return (
    isRecord(payload)
    && typeof payload.calibrationId
      === "string"
    && payload.calibrationId.length > 0
    && isCalibrationMode(
      payload.mode
    )
  );
}

function isCalibrationTarget(
  value: unknown
): boolean {
  if (
    !isRecord(value)
    || !isFiniteNumber(
      value.pointIndex
    )
    || !Number.isInteger(
      value.pointIndex
    )
    || !isRecord(
      value.normalizedPoint
    )
    || !isRecord(
      value.viewportPoint
    )
  ) {
    return false;
  }

  return (
    isFiniteNumber(
      value.normalizedPoint.x
    )
    && isFiniteNumber(
      value.normalizedPoint.y
    )
    && isFiniteNumber(
      value.viewportPoint.x
    )
    && isFiniteNumber(
      value.viewportPoint.y
    )
  );
}

function isCalibrationPointPayload(
  payload: unknown
): payload is CalibrationPointPayload {
  return (
    isRecord(payload)
    && typeof payload.calibrationId
      === "string"
    && payload.calibrationId.length > 0
    && isCalibrationTarget(
      payload.target
    )
    && isFiniteNumber(
      payload.targetShownAtMs
    )
    && isFiniteNumber(
      payload.attempt
    )
    && Number.isInteger(
      payload.attempt
    )
    && payload.attempt >= 1
  );
}

function isCalibrationTrainingDiagnostics(
  value: unknown
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.pointCount)
    && Number.isInteger(value.pointCount)
    && value.pointCount > 0
    && isFiniteNumber(value.rawMeanErrorPx)
    && value.rawMeanErrorPx >= 0
    && isFiniteNumber(value.rawP95ErrorPx)
    && value.rawP95ErrorPx >= 0
    && isFiniteNumber(value.rawRmsePx)
    && value.rawRmsePx >= 0
    && isFiniteNumber(value.correctedMeanErrorPx)
    && value.correctedMeanErrorPx >= 0
    && isFiniteNumber(value.correctedP95ErrorPx)
    && value.correctedP95ErrorPx >= 0
    && isFiniteNumber(value.correctedRmsePx)
    && value.correctedRmsePx >= 0
    && isFiniteNumber(value.meanCorrectionImprovementPx)
    && isFiniteNumber(value.improvedPointCount)
    && Number.isInteger(value.improvedPointCount)
    && value.improvedPointCount >= 0
    && isFiniteNumber(value.degradedPointCount)
    && Number.isInteger(value.degradedPointCount)
    && value.degradedPointCount >= 0
    && isFiniteNumber(value.unchangedPointCount)
    && Number.isInteger(value.unchangedPointCount)
    && value.unchangedPointCount >= 0
  );
}

function isCalibrationPointResultPayload(
  payload: unknown
): payload is CalibrationPointResultPayload {
  if (!isRecord(payload)) {
    return false;
  }

  const failureReason =
    payload.failureReason;

  return (
    typeof payload.calibrationId
      === "string"
    && payload.calibrationId.length > 0
    && isFiniteNumber(
      payload.pointIndex
    )
    && Number.isInteger(
      payload.pointIndex
    )
    && typeof payload.sufficient
      === "boolean"
    && isFiniteNumber(
      payload.acceptedSampleCount
    )
    && isFiniteNumber(
      payload.rejectedSampleCount
    )
    && isFiniteNumber(
      payload.rejectionRatio
    )
    && isFiniteNumber(
      payload.completedPointCount
    )
    && isFiniteNumber(
      payload.expectedPointCount
    )
    && (
      failureReason === null
      || failureReason
        === "INSUFFICIENT_SAMPLES"
      || failureReason
        === "UNSTABLE_GAZE"
      || failureReason
        === "OUTLIER_REJECTION"
    )
    && typeof payload.modelReady
      === "boolean"
    && (
      payload.trainingRmseNormalized
        === null
      || isFiniteNumber(
        payload.trainingRmseNormalized
      )
    )
    && (
      payload.trainingDiagnostics === null
      || isCalibrationTrainingDiagnostics(
        payload.trainingDiagnostics
      )
    )
    && Array.isArray(payload.adaptiveExpansionTargets)
    && payload.adaptiveExpansionTargets.every(
      (target) => isCalibrationTarget(target)
    )
  );
}

function isStartValidationPayload(
  payload: unknown
): payload is StartValidationPayload {
  return (
    isRecord(payload)
    && typeof payload.calibrationId
      === "string"
    && payload.calibrationId.length > 0
    && isFiniteNumber(
      payload.viewportWidth
    )
    && payload.viewportWidth > 0
    && isFiniteNumber(
      payload.viewportHeight
    )
    && payload.viewportHeight > 0
    && isFiniteNumber(
      payload.expectedPointCount
    )
    && Number.isInteger(
      payload.expectedPointCount
    )
    && payload.expectedPointCount
      >= CALIBRATION.MIN_VALIDATION_POINT_COUNT
  );
}

function isStartQuickRecalibrationPayload(
  payload: unknown
): payload is StartQuickRecalibrationPayload {
  return (
    isRecord(payload)
    && typeof payload.calibrationId === "string"
    && payload.calibrationId.length > 0
    && isFiniteNumber(payload.viewportWidth)
    && payload.viewportWidth > 0
    && isFiniteNumber(payload.viewportHeight)
    && payload.viewportHeight > 0
    && isFiniteNumber(payload.pointCount)
    && Number.isInteger(payload.pointCount)
    && payload.pointCount === DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
  );
}

function isStartQuickValidationPayload(
  payload: unknown
): payload is StartQuickValidationPayload {
  return (
    isRecord(payload)
    && typeof payload.calibrationId === "string"
    && payload.calibrationId.length > 0
    && isFiniteNumber(payload.viewportWidth)
    && payload.viewportWidth > 0
    && isFiniteNumber(payload.viewportHeight)
    && payload.viewportHeight > 0
    && isFiniteNumber(payload.expectedPointCount)
    && Number.isInteger(payload.expectedPointCount)
    && payload.expectedPointCount === DRIFT_THRESHOLDS.QUICK_REVALIDATION_POINT_COUNT
    && typeof payload.runId === "string" && payload.runId.length > 0
  );
}

function isDriftStatusPayload(
  payload: unknown
): payload is DriftStatusPayload {
  if (!isRecord(payload) || !isRecord(payload.status)) {
    return false;
  }
  const status = payload.status;
  return (
    isFiniteNumber(status.timestampMs)
    && (status.severity === "NONE" || status.severity === "LOW"
      || status.severity === "MEDIUM" || status.severity === "HIGH")
    && isFiniteNumber(status.faceCenterDeltaPx)
    && isFiniteNumber(status.faceDistanceDeltaRatio)
    && isFiniteNumber(status.yawDeltaDeg)
    && isFiniteNumber(status.pitchDeltaDeg)
    && isFiniteNumber(status.rollDeltaDeg)
    && isFiniteNumber(status.gazeVariance)
    && isFiniteNumber(status.qualityScore)
    && typeof status.quickRecalibrationRecommended === "boolean"
  );
}

function isRuntimeQualityDiagnosticPayload(
  payload: unknown
): payload is RuntimeQualityDiagnosticPayload {
  if (!isRecord(payload) || !isRecord(payload.diagnostic)) return false;
  const diagnostic = payload.diagnostic;
  return (
    isFiniteNumber(diagnostic.timestampMs)
    && (diagnostic.milestone === "T0" || diagnostic.milestone === "T2"
      || diagnostic.milestone === "T5" || diagnostic.milestone === "T10")
    && isFiniteNumber(diagnostic.elapsedMs)
    && isFiniteNumber(diagnostic.gazeQualityScore)
    && isFiniteNumber(diagnostic.effectiveGazeQualityScore)
    && isNullableFiniteNumber(diagnostic.baselinePrecisionPx)
    && isNullableFiniteNumber(diagnostic.deepPrecisionPx)
    && typeof diagnostic.collectionAllowed === "boolean"
    && typeof diagnostic.degradedCollection === "boolean"
    && (diagnostic.authoritativeStrategy === "BASELINE_ONLY"
      || diagnostic.authoritativeStrategy === "DEEP_ONLY"
      || diagnostic.authoritativeStrategy === "SAFE_ADAPTIVE_HYBRID"
      || diagnostic.authoritativeStrategy === "BASELINE_FALLBACK")
    && (diagnostic.driftStatus === null || isDriftStatusPayload({ status: diagnostic.driftStatus }))
  );
}

function isValidationPointPayload(
  payload: unknown
): payload is ValidationPointPayload {
  return (
    isRecord(payload)
    && typeof payload.calibrationId
      === "string"
    && payload.calibrationId.length > 0
    && isCalibrationTarget(
      payload.target
    )
    && isFiniteNumber(
      payload.targetShownAtMs
    )
    && isFiniteNumber(
      payload.attempt
    )
    && Number.isInteger(
      payload.attempt
    )
    && payload.attempt >= 1
  );
}

function isCalibrationValidationMetrics(
  value: unknown
): boolean {
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

  return (
    nonNegativeMetrics.every(
      (metric) =>
        isFiniteNumber(metric)
        && metric >= 0
    )
    && isFiniteNumber(
      value.meanCorrectionImprovementPx
    )
    && isFiniteNumber(
      value.improvedPointCount
    )
    && Number.isInteger(
      value.improvedPointCount
    )
    && value.improvedPointCount >= 0
    && isFiniteNumber(
      value.degradedPointCount
    )
    && Number.isInteger(
      value.degradedPointCount
    )
    && value.degradedPointCount >= 0
    && isFiniteNumber(
      value.viewportWidthPx
    )
    && value.viewportWidthPx > 0
    && isFiniteNumber(
      value.viewportHeightPx
    )
    && value.viewportHeightPx > 0
    && isFiniteNumber(
      value.validSampleRatio
    )
    && value.validSampleRatio <= 1
  );
}

function isCalibrationQualityLevel(
  value: unknown
): boolean {
  return (
    value === "GOOD"
    || value === "ACCEPTABLE"
    || value === "POOR"
    || value === "FAIL"
  );
}

function isFinitePoint2D(
  value: unknown
): boolean {
  return (
    isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
  );
}

function isCalibrationPointDiagnostic(
  value: unknown
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.calibrationId
      === "string"
    && value.calibrationId.length > 0
    && isFiniteNumber(value.pointIndex)
    && Number.isInteger(value.pointIndex)
    && isFinitePoint2D(
      value.targetViewportPoint
    )
    && isFinitePoint2D(
      value.rawMeanPoint
    )
    && value.rawMeanSpace
      === "NORMALIZED"
    && isFinitePoint2D(
      value.rawViewportPoint
    )
    && isFiniteNumber(value.rawErrorXPx)
    && isFiniteNumber(value.rawErrorYPx)
    && isFiniteNumber(value.rawErrorPx)
    && value.rawErrorPx >= 0
    && isFinitePoint2D(
      value.correctedViewportPoint
    )
    && isFiniteNumber(value.errorXPx)
    && isFiniteNumber(value.errorYPx)
    && isFiniteNumber(value.errorPx)
    && value.errorPx >= 0
    && isFiniteNumber(
      value.correctionImprovementPx
    )
    && isFiniteNumber(value.sampleCount)
    && isFiniteNumber(value.sampleCount)
    && Number.isInteger(value.sampleCount)
    && value.sampleCount >= 0
    && isFiniteNumber(value.rejectedCount)
    && Number.isInteger(value.rejectedCount)
    && value.rejectedCount >= 0
    && isRecord(value.meanHeadPose)
    && isFiniteNumber(
      value.meanHeadPose.yawDeg
    )
    && isFiniteNumber(
      value.meanHeadPose.pitchDeg
    )
    && isFiniteNumber(
      value.meanHeadPose.rollDeg
    )
    && isFiniteNumber(
      value.meanFaceDistanceRatio
    )
    && isFiniteNumber(value.meanQuality)
    && value.meanQuality >= 0
    && value.meanQuality <= 1
  );
}

function isCalibrationCorrectionStrategy(
  value: unknown
): boolean {
  return (
    value === "PROJECT_RESIDUAL_ONLY"
    || value === "WEBEYETRACK_NATIVE_ONLY"
  );
}

function isValidationPointResultPayload(
  payload: unknown
): payload is ValidationPointResultPayload {
  if (!isRecord(payload)) {
    return false;
  }

  const failureReason =
    payload.failureReason;

  const metricsValid =
    payload.metrics === null
    || isCalibrationValidationMetrics(
      payload.metrics
    );

  const qualityValid =
    payload.quality === null
    || isCalibrationQualityLevel(
      payload.quality
    );

  const selectedStrategyValidation =
    payload.selectedStrategyValidation;

  const selectedStrategyValidationValid =
    selectedStrategyValidation === null
    || (
      isRecord(selectedStrategyValidation)
      && (
        selectedStrategyValidation.strategy === "BASELINE_ONLY"
        || selectedStrategyValidation.strategy === "DEEP_ONLY"
        || selectedStrategyValidation.strategy === "SAFE_ADAPTIVE_HYBRID"
      )
      && isCalibrationValidationMetrics(
        selectedStrategyValidation.metrics
      )
      && isCalibrationQualityLevel(
        selectedStrategyValidation.quality
      )
    );

  const pointResultsValid =
    payload.pointResults === null
    || (
      Array.isArray(payload.pointResults)
      && payload.pointResults.every(
        isCalibrationPointDiagnostic
      )
    );

  return (
    typeof payload.calibrationId
      === "string"
    && payload.calibrationId.length > 0
    && isCalibrationCorrectionStrategy(
      payload.correctionStrategy
    )
    && isFiniteNumber(
      payload.pointIndex
    )
    && Number.isInteger(
      payload.pointIndex
    )
    && typeof payload.sufficient
      === "boolean"
    && isFiniteNumber(
      payload.acceptedSampleCount
    )
    && isFiniteNumber(
      payload.rejectedSampleCount
    )
    && isFiniteNumber(
      payload.rejectionRatio
    )
    && isFiniteNumber(
      payload.completedPointCount
    )
    && isFiniteNumber(
      payload.expectedPointCount
    )
    && (
      failureReason === null
      || failureReason
        === "INSUFFICIENT_SAMPLES"
      || failureReason
        === "UNSTABLE_GAZE"
      || failureReason
        === "OUTLIER_REJECTION"
    )
    && typeof payload.validationComplete
      === "boolean"
    && metricsValid
    && qualityValid
    && selectedStrategyValidationValid
    && pointResultsValid
    && (
      payload.validationComplete
        ? payload.metrics !== null
          && payload.quality !== null
          && payload.pointResults !== null
        : payload.metrics === null
          && payload.quality === null
          && payload.selectedStrategyValidation === null
          && payload.pointResults === null
    )
  );
}

/* ==========================================================================
 * INIT_TRACKER payload validation
 * ======================================================================== */

function isInitTrackerPayload(
  payload: unknown
): payload is InitTrackerPayload {
  if (!isRecord(payload)) {
    return false;
  }

  if (
    typeof payload.participantId
      !== "string"
    || payload.participantId.trim().length
      === 0
  ) {
    return false;
  }

  if (
    payload.preferredGazeEngine
      !== null
    && !isGazeEngineSource(
      payload.preferredGazeEngine
    )
  ) {
    return false;
  }

  return (
    isBrowserMetadata(
      payload.browser
    )
    && isScreenMetadata(
      payload.screen
    )
  );
}

/* ==========================================================================
 * AOI payload validation
 * ======================================================================== */

function isPoint2D(value: unknown): boolean {
  return (
    isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
  );
}

function isRect2D(value: unknown): boolean {
  return (
    isRecord(value)
    && isFiniteNumber(value.left)
    && isFiniteNumber(value.top)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height)
    && value.width >= 0
    && value.height >= 0
  );
}

function isPageCoordinateSnapshot(
  value: unknown
): value is PageCoordinateSnapshot {
  return (
    isRecord(value)
    && isFiniteNumber(value.capturedAtEpochMs)
    && typeof value.url === "string"
    && typeof value.origin === "string"
    && isPoint2D(value.viewportPoint)
    && isPoint2D(value.documentPoint)
    && typeof value.insideViewport === "boolean"
    && isFiniteNumber(value.viewportWidth)
    && value.viewportWidth >= 0
    && isFiniteNumber(value.viewportHeight)
    && value.viewportHeight >= 0
    && isFiniteNumber(value.documentWidth)
    && value.documentWidth >= 0
    && isFiniteNumber(value.documentHeight)
    && value.documentHeight >= 0
    && isFiniteNumber(value.scrollX)
    && isFiniteNumber(value.scrollY)
    && isFiniteNumber(value.devicePixelRatio)
    && value.devicePixelRatio >= 0
  );
}

function isScrollEventRecord(
  value: unknown
): value is ScrollEventRecord {
  return (
    isRecord(value)
    && isFiniteNumber(value.timestampMs)
    && typeof value.sessionId === "string"
    && value.sessionId.length > 0
    && typeof value.pageId === "string"
    && value.pageId.length > 0
    && isFiniteNumber(value.scrollX)
    && isFiniteNumber(value.scrollY)
    && isFiniteNumber(value.deltaX)
    && isFiniteNumber(value.deltaY)
    && isFiniteNumber(value.velocityPxPerMs)
    && value.velocityPxPerMs >= 0
    && (
      value.direction === "UP"
      || value.direction === "DOWN"
      || value.direction === "LEFT"
      || value.direction === "RIGHT"
      || value.direction === "NONE"
    )
    && (
      value.phase === "START"
      || value.phase === "MOVE"
      || value.phase === "END"
    )
    && Number.isInteger(value.tabId)
    && Number.isInteger(value.browserFrameId)
  );
}

function isScrollEventPayload(
  payload: unknown
): payload is ScrollEventPayload {
  return (
    isRecord(payload)
    && isScrollEventRecord(payload.event)
  );
}

function isFixationEvent(
  value: unknown
): value is FixationEvent {
  return (
    isRecord(value)
    && typeof value.fixationId === "string"
    && value.fixationId.length > 0
    && typeof value.sessionId === "string"
    && value.sessionId.length > 0
    && typeof value.pageId === "string"
    && value.pageId.length > 0
    && isFiniteNumber(value.startTimeMs)
    && isFiniteNumber(value.endTimeMs)
    && isFiniteNumber(value.durationMs)
    && value.durationMs >= 0
    && isPoint2D(value.centroidViewportPoint)
    && isFiniteNumber(value.dispersionX)
    && isFiniteNumber(value.dispersionY)
    && isFiniteNumber(value.dispersionPx)
    && value.dispersionPx >= 0
    && isFiniteNumber(value.sampleCount)
    && Number.isInteger(value.sampleCount)
    && value.sampleCount >= 0
    && isFiniteNumber(value.qualityMean)
    && value.qualityMean >= 0
    && value.qualityMean <= 1
    && isNullableString(value.aoiId)
    && isFiniteNumber(value.aoiDwellRatio)
    && value.aoiDwellRatio >= 0
    && value.aoiDwellRatio <= 1
  );
}

function isFixationEventPayload(
  payload: unknown
): payload is FixationEventPayload {
  return (
    isRecord(payload)
    && isFixationEvent(payload.event)
    && isFiniteNumber(payload.peakSpeedPxPerSecond)
    && payload.peakSpeedPxPerSecond >= 0
  );
}

function isExportSessionPayload(
  payload: unknown
): payload is ExportSessionPayload {
  return (
    isRecord(payload)
    && isNullableString(payload.sessionId)
    && (payload.format === "JSON" || payload.format === "CSV")
  );
}

function isNullablePoint2DValue(
  value: unknown
): boolean {
  return (
    value === null
    || isPoint2D(value)
  );
}

function isCompletedFixationSnapshotPayload(
  value: unknown
): boolean {
  return (
    value === null
    || (
      isRecord(value)
      && isFixationEvent(value.event)
      && isFiniteNumber(value.peakSpeedPxPerSecond)
      && value.peakSpeedPxPerSecond >= 0
    )
  );
}

function isViewportContextChangedPayload(
  payload: unknown
): payload is ViewportContextChangedPayload {
  return (
    isRecord(payload)
    && isFiniteNumber(payload.viewportWidth)
    && payload.viewportWidth > 0
    && isFiniteNumber(payload.viewportHeight)
    && payload.viewportHeight > 0
    && isFiniteNumber(payload.devicePixelRatio)
    && payload.devicePixelRatio > 0
  );
}

function isAoiProbePayload(
  payload: unknown
): payload is AoiProbePayload {
  return (
    isRecord(payload)
    && isFiniteNumber(payload.timestampMs)
    && isPoint2D(payload.normalizedPoint)
    && isPoint2D(payload.viewportPoint)
    && (
      payload.pointSource === "STABILIZED_GAZE"
      || payload.pointSource === "FIXATION_CENTROID"
    )
    && isFiniteNumber(payload.gazeQuality)
    && payload.gazeQuality >= 0
    && payload.gazeQuality <= 1
    && isNullableString(payload.fixationId)
    && typeof payload.degradedCollection === "boolean"
    && isNullablePoint2DValue(payload.rawPredictionNormalizedPoint)
    && isNullablePoint2DValue(payload.authoritativeNormalizedPoint)
    && isNullablePoint2DValue(payload.stabilizedNormalizedPoint)
    && isCompletedFixationSnapshotPayload(payload.completedFixation)
  );
}

function isAoiHitPayload(
  payload: unknown
): payload is AoiHitPayload {
  if (
    !isRecord(payload)
    || typeof payload.pageId !== "string"
    || payload.pageId.length === 0
    || !Number.isInteger(payload.browserFrameId)
    || !isNullableString(payload.fixationId)
    || (
      payload.pointSource !== "STABILIZED_GAZE"
      && payload.pointSource !== "FIXATION_CENTROID"
    )
    || !isFiniteNumber(payload.gazeQuality)
    || payload.gazeQuality < 0
    || payload.gazeQuality > 1
    || typeof payload.degradedCollection !== "boolean"
    || !isPoint2D(payload.probeNormalizedPoint)
    || !isNullablePoint2DValue(payload.rawPredictionNormalizedPoint)
    || !isNullablePoint2DValue(payload.authoritativeNormalizedPoint)
    || !isNullablePoint2DValue(payload.stabilizedNormalizedPoint)
    || !isCompletedFixationSnapshotPayload(payload.completedFixation)
    || !isPageCoordinateSnapshot(payload.coordinates)
    || !(
      payload.gazeCoordinates === null
      || isPageCoordinateSnapshot(payload.gazeCoordinates)
    )
    || !isRecord(payload.hit)
    || !isFiniteNumber(payload.hit.timestampMs)
    || !isNullableString(payload.hit.primaryAoiId)
    || !Array.isArray(payload.hit.candidates)
    || payload.hit.candidates.length > AOI.MAX_HIT_CANDIDATES
  ) {
    return false;
  }

  return payload.hit.candidates.every(
    (candidate) => (
      isRecord(candidate)
      && typeof candidate.aoiId === "string"
      && candidate.aoiId.length > 0
      && isFiniteNumber(candidate.probability)
      && candidate.probability >= 0
      && candidate.probability <= 1
      && isFiniteNumber(candidate.distancePx)
      && candidate.distancePx >= 0
      && typeof candidate.inside === "boolean"
    )
  );
}

function isAoiRegistryEntry(
  value: unknown
): value is AoiRegistryEntry {
  return (
    isRecord(value)
    && typeof value.aoiId === "string"
    && value.aoiId.length > 0
    && typeof value.pageId === "string"
    && value.pageId.length > 0
    && Number.isInteger(value.browserFrameId)
    && typeof value.tagName === "string"
    && isNullableString(value.elementId)
    && isNullableString(value.role)
    && isNullableString(value.ariaLabel)
    && isNullableString(value.elementName)
    && isNullableString(value.textLabel)
    && isNullableString(value.textHash)
    && typeof value.cssSelector === "string"
    && typeof value.domPath === "string"
    && typeof value.aoiType === "string"
    && typeof value.interactive === "boolean"
    && isRect2D(value.viewportRect)
    && isRect2D(value.documentRect)
    && typeof value.visible === "boolean"
    && typeof value.enabled === "boolean"
    && (
      value.textStoragePolicy === "RAW"
      || value.textStoragePolicy === "HASHED"
      || value.textStoragePolicy === "NONE"
    )
    && isFiniteNumber(value.createdAtEpochMs)
    && isFiniteNumber(value.updatedAtEpochMs)
  );
}

function isAoiRegistryUpdatePayload(
  payload: unknown
): payload is AoiRegistryUpdatePayload {
  return (
    isRecord(payload)
    && typeof payload.pageId === "string"
    && payload.pageId.length > 0
    && Number.isInteger(payload.browserFrameId)
    && Array.isArray(payload.upserted)
    && payload.upserted.every(isAoiRegistryEntry)
    && Array.isArray(payload.removedAoiIds)
    && payload.removedAoiIds.every(
      (aoiId) => typeof aoiId === "string" && aoiId.length > 0
    )
    && typeof payload.fullSnapshot === "boolean"
  );
}

/* ==========================================================================
 * Message-target filtering
 * ======================================================================== */

/**
 * chrome.runtime.sendMessage can be observed by several extension contexts.
 *
 * Background should not accidentally consume a message intended only for
 * OFFSCREEN, CONTENT, POPUP, etc.
 */
function isMessageForBackground(
  rawMessage: unknown
): boolean {
  if (!isRecord(rawMessage)) {
    return true;
  }

  const meta =
    rawMessage.meta;

  if (!isRecord(meta)) {
    return true;
  }

  const target =
    meta.target;

  if (typeof target !== "string") {
    return true;
  }

  return (
    target === "BACKGROUND"
    || target === "BROADCAST"
  );
}

/* ==========================================================================
 * Message metadata helpers
 * ======================================================================== */


function createResponseMeta(
  requestMeta: MessageMeta,
  sessionId:
    SessionId | null =
      requestMeta.sessionId,
  pageId:
    string | null =
      requestMeta.pageId
): MessageMeta {
  const target:
    RuntimeContext =
      requestMeta.source;

  return {
    messageId:
      createMessageId(),

    sentAtEpochMs:
      nowEpochMs(),

    source:
      "BACKGROUND",

    target,

    sessionId,

    pageId,

    tabId:
      requestMeta.tabId,

    browserFrameId:
      requestMeta.browserFrameId
  };
}

/* ==========================================================================
 * Pre-calibration Content UI bridge
 * ======================================================================== */

function resolveFacePositionTargetTab(
  sessionId: SessionId | null,
  preferredTabId: number | null = null
): TrackedTabState | null {
  if (sessionId === null) {
    return null;
  }

  if (preferredTabId !== null) {
    const preferred =
      tabManager.getTab(
        preferredTabId
      );

    if (
      preferred !== null
      && preferred.sessionId === sessionId
      && preferred.active
    ) {
      return preferred;
    }
  }

  const tracked =
    tabManager
      .getTrackedTabsForSession(
        sessionId
      );

  return (
    tracked.find(
      (tab) => tab.active
    )
    ?? tracked[0]
    ?? null
  );
}

async function forwardFacePositionStatusToContent(
  payload: FacePositionStatusPayload,
  preferredTabId: number | null = null
): Promise<void> {
  const sessionId =
    sessionManager
      .getActiveSessionId();

  const targetTab =
    resolveFacePositionTargetTab(
      sessionId,
      preferredTabId
    );

  if (targetTab === null) {
    logger.debug(
      "Pre-calibration status has no tracked Content target."
    );

    return;
  }

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.FACE_POSITION_STATUS,

      {
        messageId:
          createMessageId(),

        sentAtEpochMs:
          nowEpochMs(),

        source:
          "BACKGROUND",

        target:
          "CONTENT",

        sessionId,

        pageId:
          targetTab.currentPageId,

        tabId:
          targetTab.tabId,

        browserFrameId:
          0
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
          cameraFaceBoxNormalized:
            payload.feedback
              .cameraFaceBoxNormalized
              === null
              ? null
              : {
                  ...payload.feedback
                    .cameraFaceBoxNormalized
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
  } catch (error: unknown) {
    logger.debug(
      "Pre-calibration status could not be delivered to the research tab.",
      {
        tabId:
          targetTab.tabId,

        transportError:
          error instanceof Error
            ? error.message
            : "Unknown Content transport error"
      }
    );
  }
}

/* ==========================================================================
 * Offscreen Document lifecycle
 * ======================================================================== */

function getOffscreenDocumentUrl():
string {
  return chrome.runtime.getURL(
    OFFSCREEN_RUNTIME.DOCUMENT_PATH
  );
}

async function hasOffscreenDocument():
Promise<boolean> {
  try {
    const contexts =
      await chrome.runtime.getContexts({
        contextTypes: [
          chrome.runtime.ContextType
            .OFFSCREEN_DOCUMENT
        ],

        documentUrls: [
          getOffscreenDocumentUrl()
        ]
      });

    return contexts.length > 0;
  } catch (error: unknown) {
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

async function createOffscreenDocument():
Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  try {
    await chrome.offscreen
      .createDocument({
        url:
          OFFSCREEN_RUNTIME
            .DOCUMENT_PATH,

        reasons: [
          chrome.offscreen.Reason
            .USER_MEDIA
        ],

        justification:
          OFFSCREEN_RUNTIME
            .CREATE_JUSTIFICATION
      });

    logger.info(
      "Offscreen Document created."
    );
  } catch (error: unknown) {
    /**
     * A context may have appeared between the final existence check and the
     * Chrome createDocument() call. Treat that specific race as success by
     * verifying the actual context before reporting a creation failure.
     */
    if (await hasOffscreenDocument()) {
      logger.debug(
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
          documentPath:
            OFFSCREEN_RUNTIME
              .DOCUMENT_PATH
        }
      }
    );
  }
}

function sendOffscreenPingWithTimeout(
  nonce: string
): Promise<unknown> {
  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.PING,

      {
        messageId:
          createMessageId(),

        sentAtEpochMs:
          nowEpochMs(),

        source:
          "BACKGROUND",

        target:
          "OFFSCREEN",

        sessionId:
          sessionManager
            .getActiveSessionId(),

        pageId:
          null,

        tabId:
          null,

        browserFrameId:
          null
      },

      {
        nonce
      }
    );

  return new Promise<unknown>(
    (resolve, reject) => {
      const timeoutId =
        globalThis.setTimeout(
          () => {
            reject(
              new TrackerError(
                ERROR_CODES
                  .OFFSCREEN_NOT_AVAILABLE,
                "BACKGROUND",
                "Offscreen health check timed out.",
                {
                  recoverable: false,

                  details: {
                    timeoutMs:
                      OFFSCREEN_RUNTIME
                        .HEALTH_CHECK_TIMEOUT_MS
                  }
                }
              )
            );
          },
          OFFSCREEN_RUNTIME
            .HEALTH_CHECK_TIMEOUT_MS
        );

      void chrome.runtime
        .sendMessage(message)
        .then(
          (response: unknown) => {
            globalThis.clearTimeout(
              timeoutId
            );

            resolve(response);
          },
          (error: unknown) => {
            globalThis.clearTimeout(
              timeoutId
            );

            reject(
              normalizeTrackerError(
                error,
                ERROR_CODES
                  .OFFSCREEN_NOT_AVAILABLE,
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

async function pingOffscreenDocument():
Promise<void> {
  const nonce =
    createMessageId();

  let rawResponse: unknown;

  try {
    rawResponse =
      await sendOffscreenPingWithTimeout(
        nonce
      );
  } catch (error: unknown) {
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

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.PONG
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || rawResponse.meta.target
      !== "BACKGROUND"
    || !isPongPayload(
      rawResponse.payload
    )
    || rawResponse.payload.nonce
      !== nonce
  ) {
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

async function waitForHealthyOffscreenDocument():
Promise<void> {
  let lastError: unknown =
    null;

  for (
    let attempt = 1;
    attempt
      <= OFFSCREEN_RUNTIME
        .HEALTH_CHECK_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      await pingOffscreenDocument();

      logger.debug(
        "Offscreen health check passed.",
        {
          attempt
        }
      );

      return;
    } catch (error: unknown) {
      lastError = error;

      logger.debug(
        "Offscreen health check attempt failed while the document may still be bootstrapping.",
        {
          attempt,
          maxAttempts:
            OFFSCREEN_RUNTIME
              .HEALTH_CHECK_MAX_ATTEMPTS,
          transportError:
            error instanceof Error
              ? error.message
              : "Unknown Offscreen transport error"
        }
      );

      if (
        attempt
        >= OFFSCREEN_RUNTIME
          .HEALTH_CHECK_MAX_ATTEMPTS
      ) {
        break;
      }

      /*
       * createDocument() may resolve before the Offscreen module has loaded and
       * registered chrome.runtime.onMessage. A sendMessage() failure therefore
       * often returns immediately instead of consuming HEALTH_CHECK_TIMEOUT_MS.
       * Keep retrying for a real bootstrap window rather than exhausting all
       * attempts within a few hundred milliseconds.
       */
      await sleep(
        OFFSCREEN_RUNTIME
          .HEALTH_CHECK_RETRY_DELAY_MS
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
        attempts:
          OFFSCREEN_RUNTIME
            .HEALTH_CHECK_MAX_ATTEMPTS
      }
    }
  );
}

async function recreateOffscreenDocumentAfterHealthFailure(
  originalError: unknown
): Promise<void> {
  logger.warn(
    "Existing Offscreen context did not answer health checks; recreating it once.",
    {
      originalError:
        originalError instanceof Error
          ? originalError.message
          : "Unknown Offscreen health error"
    }
  );

  await closeOffscreenDocumentIfPresent();
  await createOffscreenDocument();

  await sleep(
    OFFSCREEN_RUNTIME
      .BOOTSTRAP_GRACE_MS
  );

  await waitForHealthyOffscreenDocument();
}

async function ensureOffscreenDocumentInternal():
Promise<void> {
  const alreadyExists =
    await hasOffscreenDocument();

  if (!alreadyExists) {
    await createOffscreenDocument();

    /*
     * Chrome only guarantees that the document was created, not that the
     * module script has already registered its runtime message listener.
     */
    await sleep(
      OFFSCREEN_RUNTIME
        .BOOTSTRAP_GRACE_MS
    );
  } else {
    logger.debug(
      "Reusing existing Offscreen Document."
    );
  }

  try {
    await waitForHealthyOffscreenDocument();
    return;
  } catch (error: unknown) {
    /*
     * A stale context can remain visible to getContexts() after a previous
     * reset/crash while its script no longer responds. Recover once by
     * rebuilding the Offscreen document instead of surfacing a Start Camera
     * failure immediately.
     */
    if (
      OFFSCREEN_RUNTIME
        .STALE_CONTEXT_RECOVERY_ATTEMPTS
      >= 1
    ) {
      await recreateOffscreenDocumentAfterHealthFailure(
        error
      );
      return;
    }

    throw error;
  }
}

async function ensureOffscreenDocument():
Promise<void> {
  if (ensureOffscreenPromise === null) {
    ensureOffscreenPromise =
      ensureOffscreenDocumentInternal();
  }

  const pending =
    ensureOffscreenPromise;

  try {
    await pending;
  } finally {
    if (
      ensureOffscreenPromise
      === pending
    ) {
      ensureOffscreenPromise =
        null;
    }
  }
}

async function closeOffscreenDocumentIfPresent():
Promise<void> {
  ensureOffscreenPromise = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (!(await hasOffscreenDocument())) {
      return;
    }

    try {
      await chrome.offscreen.closeDocument();
    } catch (error: unknown) {
      if (attempt >= 2) {
        throw error;
      }

      await sleep(50);
      continue;
    }

    if (!(await hasOffscreenDocument())) {
      logger.info(
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

/* ==========================================================================
 * D24 authoritative research-page context synchronization
 * ======================================================================== */

async function syncTrackingContextToOffscreen(
  trackedTab: TrackedTabState,
  reason: TrackingContextChangedPayload["reason"]
): Promise<void> {
  await ensureOffscreenDocument();

  try {
    await experimentStorage.recordNavigation(
      trackedTab.sessionId,
      trackedTab.currentPageId,
      trackedTab.tabId,
      reason,
      trackedTab.url
    );
  } catch (error: unknown) {
    logger.warn(
      "Research-page navigation context could not be persisted.",
      {
        sessionId: trackedTab.sessionId,
        pageId: trackedTab.currentPageId,
        tabId: trackedTab.tabId,
        reason,
        storageError:
          error instanceof Error
            ? error.message
            : "Unknown storage error"
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
  } catch (error: unknown) {
    logger.debug(
      "Research-page context could not be synchronized to Offscreen.",
      {
        sessionId: trackedTab.sessionId,
        tabId: trackedTab.tabId,
        pageId: trackedTab.currentPageId,
        reason,
        transportError:
          error instanceof Error
            ? error.message
            : "Unknown Offscreen transport error"
      }
    );
  }
}

/* ==========================================================================
 * Offscreen camera command
 * ======================================================================== */

function parseOffscreenErrorResponse(
  rawResponse: unknown
): TrackerError | null {
  if (
    !isRecord(rawResponse)
    || rawResponse.ok !== false
    || !isRecord(rawResponse.error)
  ) {
    return null;
  }

  const error =
    rawResponse.error;

  if (
    !isTrackerErrorCode(
      error.code
    )
    || typeof error.message
      !== "string"
    || !isDiagnosticComponent(
      error.component
    )
    || typeof error.recoverable
      !== "boolean"
    || !(
      error.details === null
      || isRecord(error.details)
    )
  ) {
    return null;
  }

  return new TrackerError(
    error.code,
    error.component,
    error.message,
    {
      recoverable:
        error.recoverable,

      details:
        error.details
    }
  );
}

async function startCameraInOffscreen(
  payload: StartCameraPayload
): Promise<CameraReadyPayload> {
  await ensureOffscreenDocument();

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.START_CAMERA,

      {
        messageId:
          createMessageId(),

        sentAtEpochMs:
          nowEpochMs(),

        source:
          "BACKGROUND",

        target:
          "OFFSCREEN",

        sessionId:
          sessionManager
            .getActiveSessionId(),

        pageId:
          null,

        tabId:
          null,

        browserFrameId:
          null
      },

      payload
    );

  let rawResponse: unknown;

  try {
    rawResponse =
      await chrome.runtime
        .sendMessage(message);
  } catch (error: unknown) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CAMERA_START_FAILED,
      "BACKGROUND",
      "Failed to send START_CAMERA to the Offscreen runtime."
    );
  }

  const offscreenError =
    parseOffscreenErrorResponse(
      rawResponse
    );

  if (offscreenError !== null) {
    throw offscreenError;
  }

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.CAMERA_READY
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || rawResponse.meta.target
      !== "BACKGROUND"
    || !isCameraReadyPayload(
      rawResponse.payload
    )
  ) {
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

async function startFacePositioningInOffscreen():
Promise<FacePositionStatusPayload> {
  await ensureOffscreenDocument();

  const activeSessionId =
    sessionManager
      .getActiveSessionId();

  const targetTab =
    resolveFacePositionTargetTab(
      activeSessionId
    );

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.START_FACE_POSITIONING,

      {
        messageId:
          createMessageId(),

        sentAtEpochMs:
          nowEpochMs(),

        source:
          "BACKGROUND",

        target:
          "OFFSCREEN",

        sessionId:
          activeSessionId,

        pageId:
          targetTab?.currentPageId
          ?? null,

        tabId:
          targetTab?.tabId
          ?? null,

        browserFrameId:
          targetTab === null
            ? null
            : 0
      },

      {}
    );

  let rawResponse: unknown;

  try {
    rawResponse =
      await chrome.runtime
        .sendMessage(message);
  } catch (error: unknown) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.MEDIAPIPE_INIT_FAILED,
      "BACKGROUND",
      "Failed to send START_FACE_POSITIONING to the Offscreen runtime."
    );
  }

  const offscreenError =
    parseOffscreenErrorResponse(
      rawResponse
    );

  if (offscreenError !== null) {
    throw offscreenError;
  }

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.FACE_POSITION_STATUS
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || rawResponse.meta.target
      !== "BACKGROUND"
    || !isFacePositionStatusPayload(
      rawResponse.payload
    )
  ) {
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
        ...rawResponse.payload
          .feedback.status
      },
      cameraFaceBoxNormalized:
        rawResponse.payload.feedback
          .cameraFaceBoxNormalized
          === null
          ? null
          : {
              ...rawResponse.payload
                .feedback
                .cameraFaceBoxNormalized
            },
      metrics: {
        ...rawResponse.payload
          .feedback.metrics
      }
    }
  };
}

/* ==========================================================================
 * Calibration runtime bridge
 * ======================================================================== */

async function startCalibrationInOffscreen(
  payload: StartCalibrationPayload,
  targetTab: TrackedTabState
): Promise<void> {
  await ensureOffscreenDocument();

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.START_CALIBRATION,
      {
        messageId:
          createMessageId(),
        sentAtEpochMs:
          nowEpochMs(),
        source:
          "BACKGROUND",
        target:
          "OFFSCREEN",
        sessionId:
          targetTab.sessionId,
        pageId:
          targetTab.currentPageId,
        tabId:
          targetTab.tabId,
        browserFrameId: 0
      },
      payload
    );

  let rawResponse: unknown;

  try {
    rawResponse =
      await chrome.runtime
        .sendMessage(message);
  } catch (error: unknown) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "BACKGROUND",
      "Failed to start calibration in the Offscreen runtime."
    );
  }

  const offscreenError =
    parseOffscreenErrorResponse(
      rawResponse
    );

  if (offscreenError !== null) {
    throw offscreenError;
  }

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.START_CALIBRATION
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || !isStartCalibrationPayload(
      rawResponse.payload
    )
    || rawResponse.payload.calibrationId
      !== payload.calibrationId
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid START_CALIBRATION response."
    );
  }
}

async function collectCalibrationPointInOffscreen(
  payload: CalibrationPointPayload,
  targetTab: TrackedTabState
): Promise<CalibrationPointResultPayload> {
  await ensureOffscreenDocument();

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.CALIBRATION_POINT,
      {
        messageId:
          createMessageId(),
        sentAtEpochMs:
          nowEpochMs(),
        source:
          "BACKGROUND",
        target:
          "OFFSCREEN",
        sessionId:
          targetTab.sessionId,
        pageId:
          targetTab.currentPageId,
        tabId:
          targetTab.tabId,
        browserFrameId: 0
      },
      payload
    );

  let rawResponse: unknown;

  try {
    rawResponse =
      await chrome.runtime
        .sendMessage(message);
  } catch (error: unknown) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "BACKGROUND",
      "Failed to collect a calibration point in the Offscreen runtime."
    );
  }

  const offscreenError =
    parseOffscreenErrorResponse(
      rawResponse
    );

  if (offscreenError !== null) {
    throw offscreenError;
  }

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.CALIBRATION_POINT_RESULT
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || !isCalibrationPointResultPayload(
      rawResponse.payload
    )
    || rawResponse.payload.calibrationId
      !== payload.calibrationId
    || rawResponse.payload.pointIndex
      !== payload.target.pointIndex
  ) {
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

async function startValidationInOffscreen(
  payload: StartValidationPayload,
  targetTab: TrackedTabState
): Promise<void> {
  await ensureOffscreenDocument();

  const message =
    createRuntimeMessage(
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

  let rawResponse: unknown;

  try {
    rawResponse =
      await chrome.runtime
        .sendMessage(message);
  } catch (error: unknown) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "BACKGROUND",
      "Failed to start independent validation in the Offscreen runtime."
    );
  }

  const offscreenError =
    parseOffscreenErrorResponse(
      rawResponse
    );

  if (offscreenError !== null) {
    throw offscreenError;
  }

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.START_VALIDATION
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || !isStartValidationPayload(
      rawResponse.payload
    )
    || rawResponse.payload.calibrationId
      !== payload.calibrationId
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid START_VALIDATION response."
    );
  }
}

async function collectValidationPointInOffscreen(
  payload: ValidationPointPayload,
  targetTab: TrackedTabState
): Promise<ValidationPointResultPayload> {
  await ensureOffscreenDocument();

  const message =
    createRuntimeMessage(
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

  let rawResponse: unknown;

  try {
    rawResponse =
      await chrome.runtime
        .sendMessage(message);
  } catch (error: unknown) {
    throw normalizeTrackerError(
      error,
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "BACKGROUND",
      "Failed to collect an independent validation point in the Offscreen runtime."
    );
  }

  const offscreenError =
    parseOffscreenErrorResponse(
      rawResponse
    );

  if (offscreenError !== null) {
    throw offscreenError;
  }

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(
      rawResponse.protocolVersion
    )
    || rawResponse.type
      !== MESSAGE_TYPES.VALIDATION_POINT_RESULT
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source
      !== "OFFSCREEN"
    || !isValidationPointResultPayload(
      rawResponse.payload
    )
    || rawResponse.payload.calibrationId
      !== payload.calibrationId
    || rawResponse.payload.pointIndex
      !== payload.target.pointIndex
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "BACKGROUND",
      "Offscreen runtime returned an invalid VALIDATION_POINT_RESULT response."
    );
  }

  return {
    ...rawResponse.payload,
    metrics:
      rawResponse.payload.metrics
        === null
        ? null
        : {
            ...rawResponse.payload.metrics
          }
  };
}

async function startQuickRecalibrationInOffscreen(
  payload: StartQuickRecalibrationPayload,
  targetTab: TrackedTabState
): Promise<QuickRecalibrationStartedPayload> {
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

  const rawResponse: unknown = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;

  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(rawResponse.protocolVersion)
    || rawResponse.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source !== "OFFSCREEN"
    || !isRecord(rawResponse.payload)
    || rawResponse.payload.calibrationId !== payload.calibrationId
    || !isFiniteNumber(rawResponse.payload.startingPointIndex)
    || !Number.isInteger(rawResponse.payload.startingPointIndex)
    || !isFiniteNumber(rawResponse.payload.expectedPointCount)
    || !Number.isInteger(rawResponse.payload.expectedPointCount)
    || rawResponse.payload.pointCount !== payload.pointCount
    || typeof rawResponse.payload.runId !== "string"
    || rawResponse.payload.runId.length === 0
  ) {
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

async function collectQuickRecalibrationPointInOffscreen(
  payload: QuickRecalibrationPointPayload,
  targetTab: TrackedTabState
): Promise<CalibrationPointResultPayload> {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.QUICK_RECALIBRATION_POINT,
    {
      messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND", target: "OFFSCREEN",
      sessionId: targetTab.sessionId, pageId: targetTab.currentPageId,
      tabId: targetTab.tabId, browserFrameId: 0
    },
    payload
  );
  const rawResponse: unknown = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(rawResponse.protocolVersion)
    || rawResponse.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source !== "OFFSCREEN"
    || !isCalibrationPointResultPayload(rawResponse.payload)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
      "Offscreen returned an invalid QUICK_RECALIBRATION_POINT_RESULT response."
    );
  }
  return { ...rawResponse.payload };
}

async function startQuickValidationInOffscreen(
  payload: StartQuickValidationPayload,
  targetTab: TrackedTabState
): Promise<void> {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.START_QUICK_VALIDATION,
    {
      messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND", target: "OFFSCREEN",
      sessionId: targetTab.sessionId, pageId: targetTab.currentPageId,
      tabId: targetTab.tabId, browserFrameId: 0
    },
    payload
  );
  const rawResponse: unknown = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(rawResponse.protocolVersion)
    || rawResponse.type !== MESSAGE_TYPES.START_QUICK_VALIDATION
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source !== "OFFSCREEN"
    || !isStartQuickValidationPayload(rawResponse.payload)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
      "Offscreen returned an invalid START_QUICK_VALIDATION response."
    );
  }
}

async function collectQuickValidationPointInOffscreen(
  payload: QuickValidationPointPayload,
  targetTab: TrackedTabState
): Promise<ValidationPointResultPayload> {
  await ensureOffscreenDocument();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.QUICK_VALIDATION_POINT,
    {
      messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
      source: "BACKGROUND", target: "OFFSCREEN",
      sessionId: targetTab.sessionId, pageId: targetTab.currentPageId,
      tabId: targetTab.tabId, browserFrameId: 0
    },
    payload
  );
  const rawResponse: unknown = await chrome.runtime.sendMessage(message);
  const offscreenError = parseOffscreenErrorResponse(rawResponse);
  if (offscreenError !== null) throw offscreenError;
  if (
    !isRecord(rawResponse)
    || !isCompatibleMessageProtocol(rawResponse.protocolVersion)
    || rawResponse.type !== MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT
    || !isRecord(rawResponse.meta)
    || rawResponse.meta.source !== "OFFSCREEN"
    || !isValidationPointResultPayload(rawResponse.payload)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
      "Offscreen returned an invalid QUICK_VALIDATION_POINT_RESULT response."
    );
  }
  return {
    ...rawResponse.payload,
    metrics: rawResponse.payload.metrics === null ? null : { ...rawResponse.payload.metrics }
  };
}

async function forwardStartCalibrationToContent(
  payload: StartCalibrationPayload,
  targetTab: TrackedTabState,
  flowGeneration: number
): Promise<boolean> {
  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.START_CALIBRATION,
      {
        messageId:
          createMessageId(),
        sentAtEpochMs:
          nowEpochMs(),
        source:
          "BACKGROUND",
        target:
          "CONTENT",
        sessionId:
          targetTab.sessionId,
        pageId:
          targetTab.currentPageId,
        tabId:
          targetTab.tabId,
        browserFrameId: 0
      },
      payload
    );

  /**
   * A full-document navigation briefly destroys the old Content Script before
   * Chrome injects the new document_start instance. Pre-calibration can finish
   * inside that small gap, so a single tabs.sendMessage() is not reliable
   * enough for the calibration UI hand-off.
   *
   * Retry only this transport hand-off. The Offscreen calibration runtime has
   * already been initialized and no target collection starts until Content
   * receives START_CALIBRATION and paints the first point.
   */
  const maxAttempts = 12;
  const retryDelayMs = 75;

  let lastError: unknown = null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    if (
      flowGeneration
      !== calibrationFlowGeneration
    ) {
      return false;
    }

    try {
      await chrome.tabs.sendMessage(
        targetTab.tabId,
        message,
        {
          frameId: 0
        }
      );

      if (attempt > 1) {
        logger.debug(
          "Calibration UI delivery recovered after a document-navigation race.",
          {
            tabId: targetTab.tabId,
            attempt
          }
        );
      }

      return true;
    } catch (error: unknown) {
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

async function beginCalibrationAfterFaceReady(
  preferredTabId: number | null
): Promise<void> {
  if (calibrationStartPromise !== null) {
    return calibrationStartPromise;
  }

  const flowGeneration =
    calibrationFlowGeneration;

  const startup =
    beginCalibrationAfterFaceReadyInternal(
      preferredTabId,
      flowGeneration
    )
      .finally(
        () => {
          if (
            calibrationStartPromise
            === startup
          ) {
            calibrationStartPromise =
              null;
          }
        }
      );

  calibrationStartPromise =
    startup;

  return startup;
}

async function beginCalibrationAfterFaceReadyInternal(
  preferredTabId: number | null,
  flowGeneration: number
): Promise<void> {
  const currentState =
    trackerStateMachine
      .getSnapshot().state;

  if (
    currentState
    !== TRACKER_STATES.FACE_POSITIONING
    || flowGeneration
      !== calibrationFlowGeneration
  ) {
    return;
  }

  const sessionId =
    sessionManager
      .getActiveSessionId();

  const targetTab =
    resolveFacePositionTargetTab(
      sessionId,
      preferredTabId
    );

  if (
    sessionId === null
    || targetTab === null
  ) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "Calibration could not resolve the active research tab."
    );
  }

  const targetPageId =
    targetTab.currentPageId;

  const payload: StartCalibrationPayload = {
    calibrationId:
      createCalibrationId(),
    mode:
      CALIBRATION.DEFAULT_MODE
  };

  transitionOrThrow(
    TRACKER_STATES.CALIBRATING
  );

  try {
    await startCalibrationInOffscreen(
      payload,
      targetTab
    );

    /**
     * A top-level reload may have invalidated this calibration while the
     * Offscreen START_CALIBRATION request was in flight. Never deliver the old
     * calibration UI into the replacement document.
     */
    const currentTargetTab =
      tabManager.getTab(
        targetTab.tabId
      );

    if (
      flowGeneration
        !== calibrationFlowGeneration
      || trackerStateMachine
        .getSnapshot().state
        !== TRACKER_STATES.CALIBRATING
      || currentTargetTab === null
      || currentTargetTab.sessionId
        !== sessionId
      || currentTargetTab.currentPageId
        !== targetPageId
    ) {
      return;
    }

    const delivered =
      await forwardStartCalibrationToContent(
        payload,
        targetTab,
        flowGeneration
      );

    if (
      !delivered
      || flowGeneration
        !== calibrationFlowGeneration
    ) {
      return;
    }

    logger.info(
      "Calibration UI started after pre-calibration completion.",
      {
        calibrationId:
          payload.calibrationId,
        mode:
          payload.mode,
        tabId:
          targetTab.tabId
      }
    );
  } catch (error: unknown) {
    /**
     * A newer reload generation owns the runtime now. The reload restart will
     * explicitly reset Offscreen face/calibration state, so the stale startup
     * must not roll state back or surface an error.
     */
    if (
      flowGeneration
      !== calibrationFlowGeneration
    ) {
      return;
    }

    if (
      trackerStateMachine
        .getSnapshot().state
      === TRACKER_STATES.CALIBRATING
      && trackerStateMachine
        .canTransition(
          TRACKER_STATES.FACE_POSITIONING
        )
    ) {
      trackerStateMachine.transition(
        TRACKER_STATES.FACE_POSITIONING
      );
    }

    /**
     * CONTENT_SCRIPT_UNAVAILABLE is recoverable during an ordinary navigation
     * race. The explicit reload path below uses a newer flow generation and
     * therefore exits earlier instead of repeatedly starting calibration IDs.
     */
    if (
      error instanceof TrackerError
      && error.code
        === ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE
    ) {
      logger.debug(
        "Calibration start deferred until the research-tab Content Script becomes available.",
        {
          tabId: targetTab.tabId,
          calibrationId:
            payload.calibrationId
        }
      );

      return;
    }

    throw error;
  }
}

/* ==========================================================================
 * State transition helper
 * ======================================================================== */

function transitionOrThrow(
  nextState:
    Parameters<
      TrackerStateMachine["transition"]
    >[0]
): void {
  const result =
    trackerStateMachine.transition(
      nextState
    );

  if (result.ok) {
    logger.info(
      "Tracker state changed.",
      {
        state:
          result.snapshot.state,

        previousState:
          result.snapshot.previousState,

        sequence:
          result.snapshot.sequence
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
        from:
          result.from,

        to:
          result.to,

        reason:
          result.reason
      }
    }
  );
}

/**
 * Fatal runtime errors should move the authoritative tracker state to ERROR
 * whenever the current state machine permits it. Error reporting itself must
 * never throw a secondary state-transition error.
 */
function transitionToErrorIfPossible(
  error: TrackerErrorPayload
): void {
  const snapshot =
    trackerStateMachine.getSnapshot();

  if (
    snapshot.state
    === TRACKER_STATES.ERROR
  ) {
    return;
  }

  if (
    !trackerStateMachine.canTransition(
      TRACKER_STATES.ERROR
    )
  ) {
    logger.warn(
      "Fatal tracker error could not change the current tracker state to ERROR.",
      {
        state:
          snapshot.state,

        code:
          error.code,

        component:
          error.component
      }
    );

    return;
  }

  const result =
    trackerStateMachine.transition(
      TRACKER_STATES.ERROR
    );

  if (!result.ok) {
    logger.error(
      "Tracker ERROR transition failed while handling a fatal runtime error.",
      {
        code:
          error.code,

        reason:
          result.reason
      }
    );

    return;
  }

  logger.error(
    "Tracker entered ERROR state after a fatal runtime error.",
    {
      code:
        error.code,

      component:
        error.component,

      sequence:
        result.snapshot.sequence
    }
  );
}

/* ==========================================================================
 * Trackable URL
 * ======================================================================== */



/* ==========================================================================
 * Chrome Tab conversion
 * ======================================================================== */

function toTabDescriptor(
  tab: chrome.tabs.Tab,
  forcedOpenerTabId:
    number | null = null,
  forcedUrl:
    string | null = null
): TabDescriptor | null {
  if (
    tab.id === undefined
    || tab.id < 0
  ) {
    return null;
  }

  return {
    tabId:
      tab.id,

    windowId:
      tab.windowId,

    openerTabId:
      forcedOpenerTabId
      ?? tab.openerTabId
      ?? null,

    url:
      forcedUrl
      ?? tab.url
      ?? null,

    active:
      tab.active
  };
}

/* ==========================================================================
 * Initial research tab
 * ======================================================================== */

async function getInitialResearchTab():
Promise<chrome.tabs.Tab> {
  const tabs =
    await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

  const tab =
    tabs[0];

  if (
    tab === undefined
    || tab.id === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "No active research tab could be identified."
    );
  }

  const url =
    tab.url
    ?? null;

  if (
    url === null
    || !isHttpOrHttpsUrl(url)
    ) {
    throw new TrackerError(
      ERROR_CODES.PAGE_CONTEXT_INVALID,
      "BACKGROUND",
      "Eye tracking must be started from a normal HTTP or HTTPS webpage.",
      {
        details: {
          tabId:
            tab.id
        }
      }
    );
  }

  return tab;
}

async function associateInitialResearchTab(
  sessionId: SessionId
): Promise<TrackedTabState> {
  const tab =
    await getInitialResearchTab();

  const descriptor =
    toTabDescriptor(tab);

  if (descriptor === null) {
    throw new TrackerError(
      ERROR_CODES.TAB_ASSOCIATION_FAILED,
      "BACKGROUND",
      "The active research tab has no valid tab ID."
    );
  }

  const result =
    tabManager.associateInitialTab(
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
          tabId:
            descriptor.tabId,

          reason:
            result.reason
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

/* ==========================================================================
 * Core message handlers
 * ======================================================================== */

function registerCoreMessageRoutes(): void {
  /* ------------------------------------------------------------------------
   * PING
   * --------------------------------------------------------------------- */

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
          nonce:
            message.payload.nonce
        }
      );
    }
  );

  /* ------------------------------------------------------------------------
   * TRACKER_ERROR
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.TRACKER_ERROR,
    isTrackerErrorPayload,
    (message) => {
      const error =
        message.payload;

      const logDetails = {
        code:
          error.code,

        component:
          error.component,

        recoverable:
          error.recoverable,

        source:
          message.meta.source,

        sessionId:
          message.meta.sessionId
      };

      if (error.recoverable) {
        logger.warn(
          "Recoverable tracker error reported to Background.",
          logDetails
        );
      } else {
        logger.error(
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

  /* ------------------------------------------------------------------------
   * START_CAMERA
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.START_CAMERA,
    isStartCameraPayload,
    async (message) => {
      const currentState =
        trackerStateMachine
          .getSnapshot()
          .state;

      if (
        currentState
        !== TRACKER_STATES.INITIALIZING
      ) {
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
        const cameraReady =
          await startCameraInOffscreen(
            message.payload
          );

        const updateResult =
          sessionManager.setCameraSettings(
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
                reason:
                  updateResult.reason
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
      } catch (error: unknown) {
        const normalized =
          normalizeTrackerError(
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

  /* ------------------------------------------------------------------------
   * START_FACE_POSITIONING
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.START_FACE_POSITIONING,
    isEmptyPayload,
    async (message) => {
      const currentState =
        trackerStateMachine
          .getSnapshot()
          .state;

      const maintenanceRestart =
        currentState === TRACKER_STATES.READY
        || currentState === TRACKER_STATES.RECORDING
        || currentState === TRACKER_STATES.PAUSED;

      if (
        currentState !== TRACKER_STATES.CAMERA_READY
        && !maintenanceRestart
      ) {
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
            sessionManager.getActiveSessionId()!,
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
            sessionManager
              .getActiveSessionId()
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
              cameraFaceBoxNormalized:
                status.feedback
                  .cameraFaceBoxNormalized
                  === null
                  ? null
                  : {
                      ...status.feedback
                        .cameraFaceBoxNormalized
                    },
              metrics: {
                ...status.feedback.metrics
              }
            }
          }
        );
      } catch (error: unknown) {
        const normalized =
          normalizeTrackerError(
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

  /* ------------------------------------------------------------------------
   * FACE_POSITION_STATUS
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.FACE_POSITION_STATUS,
    isFacePositionStatusPayload,
    async (message) => {
      if (
        message.meta.source
        !== "OFFSCREEN"
      ) {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE,
          "BACKGROUND",
          "FACE_POSITION_STATUS may only originate from the Offscreen runtime."
        );
      }

      const currentState =
        trackerStateMachine
          .getSnapshot().state;

      /**
       * Face-position feedback is a FACE_POSITIONING-only UI concern.
       *
       * The Offscreen face loop intentionally keeps running after calibration
       * so gaze quality can still be evaluated. New documents therefore keep
       * producing FACE_POSITION_STATUS messages even while the tracker is
       * CALIBRATING, VALIDATING, READY, or recording. Forwarding those
       * messages to a freshly injected Content Script would make the
       * pre-calibration overlay flash again on every navigation/reload.
       */
      if (
        currentState
        !== TRACKER_STATES.FACE_POSITIONING
      ) {
        return null;
      }

      if (
        message.payload.feedback
          .readyForCalibration
      ) {
        /**
         * Do not forward the terminal READY face-position status. The
         * START_CALIBRATION message owns the UI hand-off and explicitly hides
         * the pre-calibration overlay before showing calibration targets.
         * This also closes the tiny navigation race where a new Content Script
         * could otherwise render READY for a single frame.
         */
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

  /* ------------------------------------------------------------------------
   * CALIBRATION_POINT
   * --------------------------------------------------------------------- */

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

      const currentState =
        trackerStateMachine
          .getSnapshot().state;

      if (
        currentState
        !== TRACKER_STATES.CALIBRATING
      ) {
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

      const sessionId =
        sessionManager
          .getActiveSessionId();

      const targetTab =
        resolveFacePositionTargetTab(
          sessionId,
          context.senderTabId
        );

      if (
        sessionId === null
        || targetTab === null
        || context.senderTabId
          !== targetTab.tabId
        || message.meta.sessionId
          !== sessionId
      ) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Calibration point did not originate from the active research tab."
        );
      }

      const result =
        await collectCalibrationPointInOffscreen(
          message.payload,
          targetTab
        );

      if (result.modelReady) {
        transitionOrThrow(
          TRACKER_STATES.VALIDATING
        );

        logger.info(
          "Calibration model is ready; independent validation is now required.",
          {
            calibrationId:
              result.calibrationId,
            completedPointCount:
              result.completedPointCount,
            trainingRmseNormalized:
              result.trainingRmseNormalized,
            trainingDiagnostics:
              result.trainingDiagnostics
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

  /* ------------------------------------------------------------------------
   * QUICK RECALIBRATION / QUICK VALIDATION
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.START_QUICK_RECALIBRATION,
    isStartQuickRecalibrationPayload,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
          "START_QUICK_RECALIBRATION may only originate from Content."
        );
      }

      const currentState = trackerStateMachine.getSnapshot().state;
      if (
        currentState !== TRACKER_STATES.READY
        && currentState !== TRACKER_STATES.RECORDING
        && currentState !== TRACKER_STATES.PAUSED
      ) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION, "BACKGROUND",
          "Quick recalibration is only available after independent validation."
        );
      }

      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (
        sessionId === null || targetTab === null
        || context.senderTabId !== targetTab.tabId
        || message.meta.sessionId !== sessionId
        || message.meta.pageId !== targetTab.currentPageId
      ) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED, "BACKGROUND",
          "Quick recalibration did not originate from the active research tab."
        );
      }

      const started = await startQuickRecalibrationInOffscreen(
        message.payload, targetTab
      );

      logger.info("Quick recalibration runtime started.", {
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
    (payload): payload is AbortQuickRecalibrationPayload =>
      isRecord(payload) && typeof payload.calibrationId === "string"
      && payload.calibrationId.length > 0
      && typeof payload.runId === "string" && payload.runId.length > 0,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
          "Only Content may abort quick recalibration.");
      }
      const sessionId = sessionManager.getActiveSessionId();
      const tab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || tab === null || context.senderTabId !== tab.tabId
        || message.meta.sessionId !== sessionId
        || message.meta.pageId !== tab.currentPageId) {
        throw new TrackerError(ERROR_CODES.TAB_ASSOCIATION_FAILED, "BACKGROUND",
          "Quick abort was not sent by the active research page.");
      }
      await ensureOffscreenDocument();
      const request = createRuntimeMessage(MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
        { messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
          source: "BACKGROUND", target: "OFFSCREEN", sessionId,
          pageId: tab.currentPageId, tabId: tab.tabId, browserFrameId: 0 },
        message.payload);
      const response: unknown = await chrome.runtime.sendMessage(request);
      const failure = parseOffscreenErrorResponse(response);
      if (failure !== null) throw failure;
      if (!isRecord(response) || response.type !== MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION
        || !isRecord(response.payload) || typeof response.payload.rolledBack !== "boolean") {
        throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "BACKGROUND", "Invalid quick abort response.");
      }
      return createRuntimeMessage(MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
        createResponseMeta(message.meta, sessionId, tab.currentPageId),
        { ...message.payload, rolledBack: response.payload.rolledBack });
    }
  );

  messageRouter.register(
    MESSAGE_TYPES.QUICK_RECALIBRATION_POINT,
    (payload): payload is QuickRecalibrationPointPayload =>
      isCalibrationPointPayload(payload) && isRecord(payload)
      && typeof payload.runId === "string" && payload.runId.length > 0,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
          "QUICK_RECALIBRATION_POINT may only originate from Content."
        );
      }
      const currentState = trackerStateMachine.getSnapshot().state;
      if (
        currentState !== TRACKER_STATES.READY
        && currentState !== TRACKER_STATES.RECORDING
        && currentState !== TRACKER_STATES.PAUSED
      ) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION, "BACKGROUND",
          "Quick recalibration point collection is not available in the current state."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId
        || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED, "BACKGROUND",
          "Quick recalibration point did not originate from the active research tab."
        );
      }
      const result = await collectQuickRecalibrationPointInOffscreen(
        message.payload, targetTab
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
          ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
          "START_QUICK_VALIDATION may only originate from Content."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId
        || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED, "BACKGROUND",
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
    (payload): payload is QuickValidationPointPayload =>
      isValidationPointPayload(payload) && isRecord(payload)
      && typeof payload.runId === "string" && payload.runId.length > 0,
    async (message, context) => {
      if (message.meta.source !== "CONTENT") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
          "QUICK_VALIDATION_POINT may only originate from Content."
        );
      }
      const sessionId = sessionManager.getActiveSessionId();
      const targetTab = resolveFacePositionTargetTab(sessionId, context.senderTabId);
      if (sessionId === null || targetTab === null || context.senderTabId !== targetTab.tabId
        || message.meta.sessionId !== sessionId || message.meta.pageId !== targetTab.currentPageId) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED, "BACKGROUND",
          "Quick validation point did not originate from the active research tab."
        );
      }
      const result = await collectQuickValidationPointInOffscreen(
        message.payload, targetTab
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

  /* ------------------------------------------------------------------------
   * START_VALIDATION
   * --------------------------------------------------------------------- */

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

      const currentState =
        trackerStateMachine
          .getSnapshot().state;

      if (
        currentState
        !== TRACKER_STATES.VALIDATING
      ) {
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

      const sessionId =
        sessionManager
          .getActiveSessionId();

      const targetTab =
        resolveFacePositionTargetTab(
          sessionId,
          context.senderTabId
        );

      if (
        sessionId === null
        || targetTab === null
        || context.senderTabId
          !== targetTab.tabId
        || message.meta.sessionId
          !== sessionId
      ) {
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

      logger.info(
        "Independent calibration validation UI/runtime started.",
        {
          calibrationId:
            message.payload.calibrationId,
          expectedPointCount:
            message.payload.expectedPointCount,
          tabId:
            targetTab.tabId
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

  /* ------------------------------------------------------------------------
   * VALIDATION_POINT
   * --------------------------------------------------------------------- */

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

      const currentState =
        trackerStateMachine
          .getSnapshot().state;

      if (
        currentState
        !== TRACKER_STATES.VALIDATING
      ) {
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

      const sessionId =
        sessionManager
          .getActiveSessionId();

      const targetTab =
        resolveFacePositionTargetTab(
          sessionId,
          context.senderTabId
        );

      if (
        sessionId === null
        || targetTab === null
        || context.senderTabId
          !== targetTab.tabId
        || message.meta.sessionId
          !== sessionId
      ) {
        throw new TrackerError(
          ERROR_CODES.TAB_ASSOCIATION_FAILED,
          "BACKGROUND",
          "Validation point did not originate from the active research tab."
        );
      }

      const result =
        await collectValidationPointInOffscreen(
          message.payload,
          targetTab
        );

      if (
        result.validationComplete
        && result.quality !== null
        && result.metrics !== null
      ) {
        const selectedValidation =
          result.selectedStrategyValidation;

        const passed =
          selectedValidation !== null
          && (
            selectedValidation.quality === "GOOD"
            || selectedValidation.quality === "ACCEPTABLE"
          );

        const degradedCollectionAllowed =
          selectedValidation !== null
          && selectedValidation.quality === "POOR";

        const activeSessionId =
          sessionManager.getActiveSessionId();

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
          } catch (error: unknown) {
            logger.warn(
              "Validation summary could not be persisted.",
              {
                sessionId: activeSessionId,
                storageError:
                  error instanceof Error
                    ? error.message
                    : "Unknown storage error"
              }
            );
          }
        }

        if (
          (passed || degradedCollectionAllowed)
          && selectedValidation !== null
        ) {
          transitionOrThrow(
            TRACKER_STATES.READY
          );

          if (passed) {
            logger.info(
              "Calibration-selected session strategy passed independent validation; tracker is READY.",
              {
                calibrationId:
                  result.calibrationId,
                selectedSessionStrategy:
                  selectedValidation.strategy,
                quality:
                  selectedValidation.quality,
                meanErrorPx:
                  selectedValidation.metrics.meanErrorPx,
                p95ErrorPx:
                  selectedValidation.metrics.p95ErrorPx,
                meanErrorViewportWidthRatio:
                  selectedValidation.metrics
                    .meanErrorViewportWidthRatio,
                p95ErrorViewportWidthRatio:
                  selectedValidation.metrics
                    .p95ErrorViewportWidthRatio,
                meanPrecisionPx:
                  selectedValidation.metrics.meanPrecisionPx,
                p95PrecisionPx:
                  selectedValidation.metrics.p95PrecisionPx,
                validSampleRatio:
                  selectedValidation.metrics.validSampleRatio,
                recalibrationRecommended: false,
                degradedCollectionAllowed: false,
                baselineShadowQuality:
                  result.quality,
                baselineShadowMeanErrorPx:
                  result.metrics.meanErrorPx,
                baselineShadowP95ErrorPx:
                  result.metrics.p95ErrorPx
              }
            );
          } else {
            logger.warn(
              "Independent validation is POOR; recalibration is recommended, but degraded collection mode is enabled.",
              {
                calibrationId:
                  result.calibrationId,
                selectedSessionStrategy:
                  selectedValidation.strategy,
                quality:
                  selectedValidation.quality,
                meanErrorPx:
                  selectedValidation.metrics.meanErrorPx,
                p95ErrorPx:
                  selectedValidation.metrics.p95ErrorPx,
                meanErrorViewportWidthRatio:
                  selectedValidation.metrics
                    .meanErrorViewportWidthRatio,
                p95ErrorViewportWidthRatio:
                  selectedValidation.metrics
                    .p95ErrorViewportWidthRatio,
                meanPrecisionPx:
                  selectedValidation.metrics.meanPrecisionPx,
                p95PrecisionPx:
                  selectedValidation.metrics.p95PrecisionPx,
                validSampleRatio:
                  selectedValidation.metrics.validSampleRatio,
                recalibrationRecommended: true,
                degradedCollectionAllowed: true,
                baselineShadowQuality:
                  result.quality,
                baselineShadowMeanErrorPx:
                  result.metrics.meanErrorPx,
                baselineShadowP95ErrorPx:
                  result.metrics.p95ErrorPx
              }
            );
          }
        } else {
          logger.warn(
            "Calibration-selected session strategy did not meet the minimum collection safety gate.",
            {
              calibrationId:
                result.calibrationId,
              selectedSessionStrategy:
                selectedValidation?.strategy ?? null,
              quality:
                selectedValidation?.quality ?? null,
              meanErrorPx:
                selectedValidation?.metrics.meanErrorPx ?? null,
              p95ErrorPx:
                selectedValidation?.metrics.p95ErrorPx ?? null,
              meanErrorViewportWidthRatio:
                selectedValidation?.metrics
                  .meanErrorViewportWidthRatio ?? null,
              p95ErrorViewportWidthRatio:
                selectedValidation?.metrics
                  .p95ErrorViewportWidthRatio ?? null,
              meanPrecisionPx:
                selectedValidation?.metrics.meanPrecisionPx ?? null,
              p95PrecisionPx:
                selectedValidation?.metrics.p95PrecisionPx ?? null,
              validSampleRatio:
                selectedValidation?.metrics.validSampleRatio ?? null,
              recalibrationRecommended: true,
              degradedCollectionAllowed: false,
              baselineShadowQuality:
                result.quality,
              baselineShadowMeanErrorPx:
                result.metrics.meanErrorPx,
              baselineShadowP95ErrorPx:
                result.metrics.p95ErrorPx
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
          metrics:
            result.metrics === null
              ? null
              : {
                  ...result.metrics
                }
        }
      );
    }
  );

  /* ------------------------------------------------------------------------
   * VIEWPORT_CONTEXT_CHANGED
   * --------------------------------------------------------------------- */

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

      if (
        trackedTab === null
        || trackedTab.sessionId !== sessionId
        || message.meta.sessionId !== sessionId
        || message.meta.pageId !== trackedTab.currentPageId
      ) {
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
      } catch (error: unknown) {
        logger.debug(
          "Live viewport context could not be synchronized to Offscreen.",
          {
            pageId: trackedTab.currentPageId,
            tabId: trackedTab.tabId,
            transportError:
              error instanceof Error
                ? error.message
                : "Unknown Offscreen transport error"
          }
        );
      }

      return null;
    }
  );

  /* ------------------------------------------------------------------------
   * SCROLL_EVENT
   * --------------------------------------------------------------------- */

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

      if (
        trackedTab === null
        || trackedTab.sessionId !== sessionId
        || event.sessionId !== sessionId
        || event.pageId !== trackedTab.currentPageId
        || event.tabId !== trackedTab.tabId
        || event.browserFrameId !== 0
      ) {
        return null;
      }

      latestScrollByPage.set(event.pageId, { ...event });

      if (isPersistentCollectionState()) {
        experimentStorage.queueScroll(event);
      }

      const previousLogAt =
        lastScrollSmokeAtByPage.get(event.pageId) ?? null;

      const shouldLog =
        event.phase === "START"
        || event.phase === "END"
        || previousLogAt === null
        || event.timestampMs - previousLogAt
          >= PAGE_TRACKING.SCROLL_SMOKE_LOG_INTERVAL_MS;

      if (shouldLog) {
        lastScrollSmokeAtByPage.set(
          event.pageId,
          event.timestampMs
        );

        logger.info(
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

  /* ------------------------------------------------------------------------
   * RUNTIME_QUALITY_DIAGNOSTIC
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.RUNTIME_QUALITY_DIAGNOSTIC,
    isRuntimeQualityDiagnosticPayload,
    async (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
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

  /* ------------------------------------------------------------------------
   * DRIFT_STATUS
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.DRIFT_STATUS,
    isDriftStatusPayload,
    async (message) => {
      if (message.meta.source !== "OFFSCREEN") {
        throw new TrackerError(
          ERROR_CODES.INVALID_MESSAGE, "BACKGROUND",
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
      if (
        trackedTab === null
        || trackedTab.sessionId !== sessionId
        || message.meta.sessionId !== sessionId
      ) {
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

      await chrome.tabs.sendMessage(trackedTab.tabId, forwarded, { frameId: 0 })
        .catch(() => undefined);
      return null;
    }
  );

  /* ------------------------------------------------------------------------
   * AOI_PROBE
   * --------------------------------------------------------------------- */

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

      if (
        trackedTab === null
        || trackedTab.sessionId !== sessionId
        || message.meta.sessionId !== sessionId
      ) {
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
          rawPredictionNormalizedPoint:
            message.payload.rawPredictionNormalizedPoint === null
              ? null
              : { ...message.payload.rawPredictionNormalizedPoint },
          authoritativeNormalizedPoint:
            message.payload.authoritativeNormalizedPoint === null
              ? null
              : { ...message.payload.authoritativeNormalizedPoint },
          stabilizedNormalizedPoint:
            message.payload.stabilizedNormalizedPoint === null
              ? null
              : { ...message.payload.stabilizedNormalizedPoint },
          completedFixation:
            message.payload.completedFixation === null
              ? null
              : {
                  event: {
                    ...message.payload.completedFixation.event,
                    centroidViewportPoint: {
                      ...message.payload.completedFixation.event
                        .centroidViewportPoint
                    }
                  },
                  peakSpeedPxPerSecond:
                    message.payload.completedFixation
                      .peakSpeedPxPerSecond
                }
        }
      );

      try {
        await chrome.tabs.sendMessage(
          trackedTab.tabId,
          forwarded,
          { frameId: 0 }
        );
      } catch (error: unknown) {
        logger.debug(
          "AOI probe could not be delivered to the tracked page.",
          {
            tabId: trackedTab.tabId,
            transportError:
              error instanceof Error
                ? error.message
                : "Unknown Content transport error"
          }
        );
      }

      return null;
    }
  );

  /* ------------------------------------------------------------------------
   * AOI_REGISTRY_UPDATE
   * --------------------------------------------------------------------- */

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

      if (
        trackedTab === null
        || trackedTab.sessionId !== sessionId
        || message.meta.sessionId !== sessionId
        || message.payload.pageId !== trackedTab.currentPageId
      ) {
        return null;
      }

      let pageRegistry = aoiRegistryByPage.get(message.payload.pageId);

      if (pageRegistry === undefined || message.payload.fullSnapshot) {
        pageRegistry = new Map<string, AoiRegistryEntry>();
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

      void experimentStorage
        .upsertAoi(
          sessionId,
          message.payload.upserted,
          message.payload.removedAoiIds
        )
        .catch((error: unknown) => {
          logger.warn(
            "AOI registry update could not be persisted.",
            {
              pageId: message.payload.pageId,
              storageError:
                error instanceof Error
                  ? error.message
                  : "Unknown storage error"
            }
          );
        });

      return null;
    }
  );

  /* ------------------------------------------------------------------------
   * AOI_HIT
   * --------------------------------------------------------------------- */

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

      if (
        trackedTab === null
        || trackedTab.sessionId !== sessionId
        || message.meta.sessionId !== sessionId
        || message.payload.pageId !== trackedTab.currentPageId
      ) {
        return null;
      }

      if (isPersistentCollectionState()) {
        const completedFixation =
          message.payload.completedFixation;

        /**
         * A forced fixation-completion probe exists to enrich the fixation
         * record with current document/AOI context. It must not become an
         * extra gaze sample, otherwise fixation-heavy periods would be
         * over-weighted in gaze scatter/heatmap analysis.
         */
        if (completedFixation === null) {
          experimentStorage.queueGaze(
            sessionId,
            tabId,
            message.payload
          );
        }

        if (completedFixation !== null) {
          const event: FixationEvent = {
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

      const shouldLog =
        primaryAoiId !== previousPrimary
        || previousLogAt === null
        || now - previousLogAt >= AOI.PROBE_INTERVAL_MS * 10;

      lastAoiPrimaryByPage.set(pageId, primaryAoiId);

      if (shouldLog) {
        lastAoiSmokeAtByPage.set(pageId, now);

        const primaryEntry =
          primaryAoiId === null
            ? null
            : aoiRegistryByPage.get(pageId)?.get(primaryAoiId) ?? null;

        logger.info(
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
            primaryDistancePx:
              message.payload.hit.candidates[0]?.distancePx ?? null,
            primaryInside:
              message.payload.hit.candidates[0]?.inside ?? null,
            viewportX:
              message.payload.coordinates.viewportPoint.x,
            viewportY:
              message.payload.coordinates.viewportPoint.y,
            documentX:
              message.payload.coordinates.documentPoint.x,
            documentY:
              message.payload.coordinates.documentPoint.y,
            scrollX:
              message.payload.coordinates.scrollX,
            scrollY:
              message.payload.coordinates.scrollY,
            viewportWidth:
              message.payload.coordinates.viewportWidth,
            viewportHeight:
              message.payload.coordinates.viewportHeight,
            documentWidth:
              message.payload.coordinates.documentWidth,
            documentHeight:
              message.payload.coordinates.documentHeight,
            url:
              message.payload.coordinates.url
          }
        );
      }

      return null;
    }
  );

  /* ------------------------------------------------------------------------
   * FIXATION_EVENT
   * --------------------------------------------------------------------- */

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

      if (
        sessionId === null
        || message.meta.sessionId !== sessionId
        || event.sessionId !== sessionId
        || message.meta.pageId !== event.pageId
        || !isPersistentCollectionState()
      ) {
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

  /* ------------------------------------------------------------------------
   * EXPORT_SESSION
   * --------------------------------------------------------------------- */

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

      const sessionId =
        message.payload.sessionId
        ?? sessionManager.getActiveSessionId()
        ?? sessionManager.getLastCompletedSession()?.sessionId
        ?? null;

      if (sessionId === null) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "STORAGE",
          "No experiment session is available to export."
        );
      }

      let files: Awaited<
        ReturnType<typeof experimentStorage.exportSession>
      >;

      try {
        files = await experimentStorage.exportSession(
          sessionId,
          message.payload.format
        );
      } catch (error: unknown) {
        throw new TrackerError(
          ERROR_CODES.EXPORT_FAILED,
          "STORAGE",
          "Experiment session export failed.",
          {
            cause: error,
            details: {
              sessionId,
              format: message.payload.format,
              originalMessage:
                error instanceof Error
                  ? error.message
                  : "Unknown export error"
            }
          }
        );
      }

      logger.info(
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

  /* ------------------------------------------------------------------------
   * GET_TRACKER_STATE
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.GET_TRACKER_STATE,
    isEmptyPayload,
    (message) => {
      return createRuntimeMessage(
        MESSAGE_TYPES.TRACKER_STATE_CHANGED,

        createResponseMeta(
          message.meta,
          sessionManager
            .getActiveSessionId()
        ),

        {
          snapshot:
            trackerStateMachine
              .getSnapshot()
        }
      );
    }
  );

  /* ------------------------------------------------------------------------
   * RESET_TRACKER
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.RESET_TRACKER,
    isEmptyPayload,
    async (message) => {
      calibrationFlowGeneration += 1;

      const staleCalibrationStart =
        calibrationStartPromise;
      const staleReloadRestarts =
        [...reloadRestartPromises.values()];

      if (staleCalibrationStart !== null) {
        try {
          await staleCalibrationStart;
        } catch {
          // The reset generation supersedes the stale calibration hand-off.
        }
      }

      if (staleReloadRestarts.length > 0) {
        await Promise.allSettled(
          staleReloadRestarts
        );
      }

      calibrationStartPromise = null;
      reloadRestartPromises.clear();

      const activeSession =
        sessionManager.getActiveSession();

      const trackedTabs =
        activeSession === null
          ? []
          : [
              ...tabManager.getTrackedTabsForSession(
                activeSession.sessionId
              )
            ];

      /**
       * Hide/reset Content UI before associations are cleared. Failures here
       * are non-fatal because the Offscreen runtime and authoritative state are
       * still torn down below.
       */
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
      } catch (error: unknown) {
        logger.warn(
          "Buffered experiment records could not be fully flushed before reset.",
          {
            storageError:
              error instanceof Error
                ? error.message
                : "Unknown storage error"
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
          } catch (error: unknown) {
            logger.warn(
              "Completed session metadata could not be persisted during reset.",
              {
                sessionId: ended.session.sessionId,
                storageError:
                  error instanceof Error
                    ? error.message
                    : "Unknown storage error"
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
      } catch (error: unknown) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
          "BACKGROUND",
          "Tracker reset could not close the Offscreen runtime.",
          { recoverable: true }
        );

        logger.error(
          "Tracker hard reset failed while closing Offscreen runtime.",
          {
            trackerError: normalized.toSerializable()
          }
        );

        throw normalized;
      }

      const snapshot = trackerStateMachine.reset();

      logger.info(
        "Tracker hard-reset to IDLE.",
        {
          previousState: snapshot.previousState,
          sequence: snapshot.sequence,
          completedSessionId:
            activeSession?.sessionId ?? null
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

  /* ------------------------------------------------------------------------
   * INIT_TRACKER
   * --------------------------------------------------------------------- */

  messageRouter.register(
    MESSAGE_TYPES.INIT_TRACKER,
    isInitTrackerPayload,
    async (message) => {
      transitionOrThrow(
        TRACKER_STATES.INITIALIZING
      );

      try {
        await ensureOffscreenDocument();
      } catch (error: unknown) {
        const normalized =
          normalizeTrackerError(
            error,
            ERROR_CODES
              .OFFSCREEN_NOT_AVAILABLE,
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

      const gazeEngine =
        message.payload
          .preferredGazeEngine
        ?? GAZE_ENGINE_DEFAULTS.PRIMARY;

      const startResult =
        sessionManager.startSession({
          participantId:
            message.payload.participantId,

          gazeEngine,

          browser:
            message.payload.browser,

          screen:
            message.payload.screen
        });

      if (!startResult.ok) {
        const rollback =
          trackerStateMachine.transition(
            TRACKER_STATES.IDLE
          );

        if (!rollback.ok) {
          logger.error(
            "Failed to roll tracker state back after session-start failure.",
            {
              reason:
                rollback.reason
            }
          );
        }

        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "BACKGROUND",
          "Experiment session could not be started.",
          {
            details: {
              reason:
                startResult.reason
            }
          }
        );
      }

      const session =
        startResult.session;

      try {
        await experimentStorage.putSession(session);

        const initialTab =
          await associateInitialResearchTab(
            session.sessionId
          );

        logger.info(
          "Tracker initialized on research tab.",
          {
            sessionId:
              session.sessionId,

            tabId:
              initialTab.tabId,

            pageId:
              initialTab.currentPageId
          }
        );

        return createRuntimeMessage(
          MESSAGE_TYPES
            .TRACKER_INITIALIZED,

          createResponseMeta(
            message.meta,
            session.sessionId,
            initialTab.currentPageId
          ),

          {
            session
          }
        );
      } catch (error: unknown) {
        tabManager.clearSession(
          session.sessionId
        );

        sessionManager.endSession();

        const rollback =
          trackerStateMachine.transition(
            TRACKER_STATES.IDLE
          );

        if (!rollback.ok) {
          logger.error(
            "Failed to roll tracker state back after tab-association failure.",
            {
              reason:
                rollback.reason
            }
          );
        }

        throw error;
      }
    }
  );
}

/* ==========================================================================
 * New-tab navigation target handling
 * ======================================================================== */

function cleanupNavigationTargets(
  nowEpochMs: number
): void {
  for (
    const [tabId, record]
    of navigationTargets
  ) {
    if (
      nowEpochMs
      - record.createdAtEpochMs
      <= NAVIGATION
        .TAB_ASSOCIATION_TTL_MS
    ) {
      continue;
    }

    navigationTargets.delete(
      tabId
    );
  }
}

function rememberNavigationTarget(
  targetTabId: number,
  sourceTabId: number,
  url: string
): void {
  const now =
    nowEpochMs();

  cleanupNavigationTargets(now);

  navigationTargets.set(
    targetTabId,
    {
      targetTabId,
      sourceTabId,
      url,
      createdAtEpochMs:
        now
    }
  );
}

async function tryAssociateNavigationTarget(
  targetTabId: number,
  sourceTabId: number,
  url: string
): Promise<void> {
  const activeSessionId =
    sessionManager.getActiveSessionId();

  if (activeSessionId === null) {
    return;
  }

  const sourceTab =
    tabManager.getTab(
      sourceTabId
    );

  if (
    sourceTab === null
    || sourceTab.sessionId
      !== activeSessionId
  ) {
    return;
  }

  if (
    tabManager.isTrackedTab(
      targetTabId
    )
  ) {
    navigationTargets.delete(
      targetTabId
    );

    return;
  }

  try {
    const tab =
      await chrome.tabs.get(
        targetTabId
      );

    const descriptor =
      toTabDescriptor(
        tab,
        sourceTabId,
        url
      );

    if (descriptor === null) {
      return;
    }

    const result =
      tabManager.handleTabCreated(
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

    logger.debug(
      "Navigation target could not yet be associated.",
      {
        targetTabId,

        sourceTabId,

        reason:
          result.reason
      }
    );
  } catch (error: unknown) {
    /**
     * The Tab object may not be available at exactly the same instant as
     * onCreatedNavigationTarget.
     *
     * Keep the cached source relationship so tabs.onCreated can retry it.
     */
    logger.debug(
      "Navigation target tab is not yet available.",
      {
        targetTabId,

        sourceTabId,

        error:
          error instanceof Error
            ? error.message
            : "Unknown error"
      }
    );
  }
}

/* ==========================================================================
 * Chrome tab events
 * ======================================================================== */

function handleChromeTabCreated(
  tab: chrome.tabs.Tab
): void {
  const activeSessionId =
    sessionManager.getActiveSessionId();

  if (activeSessionId === null) {
    return;
  }

  if (tab.id === undefined) {
    return;
  }

  cleanupNavigationTargets(
    nowEpochMs()
  );

  const navigationTarget =
    navigationTargets.get(
      tab.id
    );

  const descriptor =
    toTabDescriptor(
      tab,

      navigationTarget
        ?.sourceTabId
      ?? null,

      navigationTarget
        ?.url
      ?? null
    );

  if (descriptor === null) {
    return;
  }

  const result =
    tabManager.handleTabCreated(
      descriptor,
      activeSessionId
    );

  if (result.ok) {
    navigationTargets.delete(
      tab.id
    );

    logger.info(
      "New browser tab joined active tracking session.",
      {
        sessionId:
          activeSessionId,

        tabId:
          descriptor.tabId,

        openerTabId:
          descriptor.openerTabId
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

  if (
    result.reason
    !== "OPENER_NOT_TRACKED"
    && result.reason
    !== "TAB_ALREADY_TRACKED"
  ) {
    logger.debug(
      "New browser tab was not associated with tracking session.",
      {
        tabId:
          descriptor.tabId,

        reason:
          result.reason
      }
    );
  }
}

/* ==========================================================================
 * Chrome runtime sender
 * ======================================================================== */

function createRouteContext(
  sender:
    chrome.runtime.MessageSender
) {
  return {
    senderTabId:
      sender.tab?.id
      ?? null,

    senderWindowId:
      sender.tab?.windowId
      ?? null,

    senderFrameId:
      sender.frameId
      ?? null,

    senderDocumentId:
      sender.documentId
      ?? null,

    senderUrl:
      sender.url
      ?? null
  };
}

/* ==========================================================================
 * Runtime message listener
 * ======================================================================== */

function registerRuntimeMessageListener():
void {
  chrome.runtime.onMessage.addListener(
    (
      rawMessage: unknown,
      sender,
      sendResponse
    ) => {
      if (
        !isMessageForBackground(
          rawMessage
        )
      ) {
        return false;
      }

      if (
        isRecord(rawMessage)
        && isRecord(rawMessage.meta)
        && (
          rawMessage.meta.source === "POPUP"
          || rawMessage.meta.source === "CAMERA_PERMISSION_UI"
        )
      ) {
        logger.info(
          "Development UI command received.",
          {
            type:
              typeof rawMessage.type === "string"
                ? rawMessage.type
                : "UNKNOWN",

            target:
              typeof rawMessage.meta.target === "string"
                ? rawMessage.meta.target
                : "UNKNOWN"
          }
        );
      }

      const context =
        createRouteContext(
          sender
        );

      void messageRouter
        .route(
          rawMessage,
          context
        )
        .then(
          (result) => {
            sendResponse(result);
          }
        )
        .catch(
          (error: unknown) => {
            const normalized =
              normalizeTrackerError(
                error,
                ERROR_CODES.UNKNOWN,
                "BACKGROUND",
                "Unexpected background message routing failure."
              );

            logger.error(
              "Unexpected runtime-message failure.",
              {
                code:
                  normalized.code
              }
            );

            sendResponse({
              ok: false,
              handled: false,
              error:
                normalized
                  .toSerializable()
            });
          }
        );

      /**
       * Keep the Chrome message channel open for the asynchronous response.
       */
      return true;
    }
  );
}

/* ========================================================================== 
 * Tracked-tab reload recovery
 * ======================================================================== */

function isCalibrationFlowRestartState(
  state:
    ReturnType<
      TrackerStateMachine["getSnapshot"]
    >["state"]
): boolean {
  return (
    state === TRACKER_STATES.FACE_POSITIONING
    || state === TRACKER_STATES.CALIBRATING
    || state === TRACKER_STATES.VALIDATING
    || state === TRACKER_STATES.READY
  );
}

async function restartCalibrationFlowAfterReload(
  tabId: number,
  expectedSessionId: SessionId
): Promise<void> {
  /**
   * Invalidate every async calibration hand-off created for the old document
   * before waiting for it. forwardStartCalibrationToContent() observes this
   * generation and stops retrying immediately.
   */
  calibrationFlowGeneration += 1;

  const restartGeneration =
    calibrationFlowGeneration;

  const staleStartup =
    calibrationStartPromise;

  if (staleStartup !== null) {
    try {
      await staleStartup;
    } catch {
      /**
       * The old document no longer owns the flow. Its failure is intentionally
       * ignored because this reload restart supersedes it.
       */
    }
  }

  if (
    restartGeneration
    !== calibrationFlowGeneration
  ) {
    return;
  }

  const activeSessionId =
    sessionManager
      .getActiveSessionId();

  const targetTab =
    tabManager.getTab(tabId);

  if (
    activeSessionId === null
    || activeSessionId
      !== expectedSessionId
    || targetTab === null
    || targetTab.sessionId
      !== expectedSessionId
  ) {
    return;
  }

  const currentState =
    trackerStateMachine
      .getSnapshot().state;

  if (!isCalibrationFlowRestartState(currentState)) {
    return;
  }

  if (
    currentState
    !== TRACKER_STATES.FACE_POSITIONING
  ) {
    if (
      !trackerStateMachine.canTransition(
        TRACKER_STATES.FACE_POSITIONING
      )
    ) {
      logger.warn(
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

  /**
   * startFacePositioning() begins a new face-analysis generation. Internally it
   * cancels any active calibration/validation point, clears the residual
   * corrector, resets CalibrationManager/ValidationManager, and clears the old
   * face baseline while keeping the already-authorized camera stream alive.
   *
   * This is deliberately a calibration-flow restart rather than a whole
   * extension/session restart: after pressing browser Refresh the participant
   * returns to the face-position screen immediately and can calibrate again.
   */
  const status =
    await startFacePositioningInOffscreen();

  if (
    restartGeneration
    !== calibrationFlowGeneration
    || trackerStateMachine
      .getSnapshot().state
      !== TRACKER_STATES.FACE_POSITIONING
  ) {
    return;
  }

  await forwardFacePositionStatusToContent(
    status,
    tabId
  );

  logger.info(
    "Tracked-tab reload restarted the calibration flow from face positioning.",
    {
      tabId,
      sessionId: expectedSessionId,
      pageId:
        tabManager.getTab(tabId)
          ?.currentPageId
        ?? null
    }
  );
}

function scheduleCalibrationFlowRestartAfterReload(
  tabId: number,
  sessionId: SessionId
): void {
  if (reloadRestartPromises.has(tabId)) {
    return;
  }

  const restart =
    restartCalibrationFlowAfterReload(
      tabId,
      sessionId
    )
      .catch(
        (error: unknown) => {
          const normalized =
            normalizeTrackerError(
              error,
              ERROR_CODES.UNKNOWN,
              "BACKGROUND",
              "Tracked-tab reload failed to restart the calibration flow."
            );

          logger.error(
            "Tracked-tab reload calibration restart failed.",
            {
              tabId,
              code: normalized.code,
              recoverable:
                normalized.recoverable
            }
          );
        }
      )
      .finally(
        () => {
          if (
            reloadRestartPromises
              .get(tabId)
            === restart
          ) {
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

/* ==========================================================================
 * Chrome navigation listeners
 * ======================================================================== */

function registerNavigationListeners():
void {
  /* ------------------------------------------------------------------------
   * New navigation target / new tab / new window
   * --------------------------------------------------------------------- */

  chrome.webNavigation
    .onCreatedNavigationTarget
    .addListener(
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

  /* ------------------------------------------------------------------------
   * Full document navigation
   * --------------------------------------------------------------------- */

  chrome.webNavigation
    .onCommitted
    .addListener(
      (details) => {
        if (
          !tabManager.isTrackedTab(
            details.tabId
          )
        ) {
          return;
        }

        const trackedBeforeCommit =
          tabManager.getTab(
            details.tabId
          );

        const transition =
          tabManager
            .handleNavigationCommitted({
              tabId:
                details.tabId,

              frameId:
                details.frameId,

              documentId:
                details.documentId,

              url:
                details.url,

              /**
               * Use this extension context's clock for internal runtime state.
               * Browser webNavigation timestamps are useful for event ordering,
               * but Chrome documents possible cross-process clock skew.
               */
              timestampEpochMs:
                nowEpochMs()
            });

        if (
          transition.ok
          && transition.changed
          && transition.association.active
        ) {
          void syncTrackingContextToOffscreen(
            transition.association,
            "FULL_NAVIGATION"
          );
        }

        /**
         * Browser Refresh/Cmd+R is intentionally different from following a
         * link or opening a child tab during an experiment. While calibration
         * is being prepared/tested, a top-level reload must invalidate the old
         * document's baseline/calibration/validation state and return to face
         * positioning. Normal navigations continue to keep the session.
         */
        if (
          details.frameId === 0
          && details.transitionType
            === "reload"
          && transition.ok
          && transition.changed
          && trackedBeforeCommit !== null
        ) {
          scheduleCalibrationFlowRestartAfterReload(
            details.tabId,
            trackedBeforeCommit.sessionId
          );
        }
      }
    );

  /* ------------------------------------------------------------------------
   * SPA / History API navigation
   * --------------------------------------------------------------------- */

  chrome.webNavigation
    .onHistoryStateUpdated
    .addListener(
      (details) => {
        if (
          !tabManager.isTrackedTab(
            details.tabId
          )
        ) {
          return;
        }

        const transition =
          tabManager
            .handleHistoryStateUpdated({
              tabId:
                details.tabId,

              frameId:
                details.frameId,

              documentId:
                details.documentId,

              url:
                details.url,

              timestampEpochMs:
                nowEpochMs()
            });

        if (
          transition.ok
          && transition.changed
          && transition.association.active
        ) {
          void syncTrackingContextToOffscreen(
            transition.association,
            "SPA_NAVIGATION"
          );
        }
      }
    );
}

/* ==========================================================================
 * Chrome tab listeners
 * ======================================================================== */

function registerTabListeners():
void {
  chrome.tabs.onCreated.addListener(
    (tab) => {
      handleChromeTabCreated(tab);
    }
  );

  chrome.tabs.onUpdated.addListener(
    (
      tabId,
      changeInfo,
      tab
    ) => {
      tabManager.handleTabUpdated({
        tabId,

        windowId:
          tab.windowId,

        url:
          changeInfo.url
          ?? tab.url
          ?? null,

        active:
          tab.active
      });
    }
  );

  chrome.tabs.onActivated.addListener(
    (activeInfo) => {
      const activated =
        tabManager.handleTabActivated({
          tabId:
            activeInfo.tabId,

          windowId:
            activeInfo.windowId
        });

      const activeSessionId =
        sessionManager.getActiveSessionId();

      if (
        activated !== null
        && activeSessionId !== null
        && activated.sessionId === activeSessionId
      ) {
        void syncTrackingContextToOffscreen(
          activated,
          "TAB_ACTIVATED"
        );
      }
    }
  );

  chrome.tabs.onRemoved.addListener(
    (
      tabId,
      _removeInfo
    ) => {
      navigationTargets.delete(
        tabId
      );

      tabManager.handleTabRemoved(
        tabId
      );
    }
  );
}

/* ==========================================================================
 * Extension lifecycle
 * ======================================================================== */

function registerExtensionLifecycle():
void {
  chrome.runtime.onInstalled.addListener(
    (details) => {
      logger.info(
        "Extension installed or updated.",
        {
          reason:
            details.reason
        }
      );
    }
  );

  chrome.runtime.onStartup.addListener(
    () => {
      logger.info(
        "Chrome extension service worker started."
      );
    }
  );
}

/* ==========================================================================
 * Service worker bootstrap
 * ======================================================================== */

function bootstrapServiceWorker():
void {
  void experimentStorage
    .initialize()
    .then(() => {
      logger.info(
        "IndexedDB experiment storage initialized."
      );
    })
    .catch((error: unknown) => {
      logger.error(
        "IndexedDB experiment storage initialization failed.",
        {
          storageError:
            error instanceof Error
              ? error.message
              : "Unknown storage error"
        }
      );
    });

  registerCoreMessageRoutes();

  registerRuntimeMessageListener();

  registerTabListeners();

  registerNavigationListeners();

  registerExtensionLifecycle();

  logger.info(
    "Background service worker initialized."
  );
}

bootstrapServiceWorker();