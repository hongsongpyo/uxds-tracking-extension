import {
  isCameraRequest
} from "../camera/cameraConfig";

import {
  AOI,
  CALIBRATION,
  DRIFT_THRESHOLDS,
  FACE_PIPELINE_RUNTIME,
  QUICK_RECALIBRATION,
  RUNTIME_MAINTENANCE
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  createRuntimeMessage,
  isCompatibleMessageProtocol,
  isMessageType
} from "../shared/messages";

import {
  createLogger
} from "../shared/logger";

import {
  createMessageId,
  isFiniteNumber,
  isNonEmptyString,
  isNullableFiniteNumber,
  isNullableString,
  isRecord,
  nowEpochMs,
  sleep
} from "../shared/utils";

import {
  TrackerRuntime
} from "./trackerRuntime";

import type {
  GazeRuntimeFrameResult
} from "./trackerRuntime";

import type {
  FaceQualityFrameResult
} from "../face/faceQuality";

import type {
  PreCalibrationFeedback
} from "../shared/types";

import type {
  CalibrationPointPayload,
  MessageMeta,
  PingPayload,
  RuntimeContext,
  RuntimeMessageOf,
  StartCalibrationPayload,
  StartQuickRecalibrationPayload,
  StartQuickValidationPayload,
  StartValidationPayload,
  TrackingContextChangedPayload,
  ValidationPointPayload,
  ViewportContextChangedPayload
} from "../shared/messages";

import type {
  CalibrationTarget
} from "../shared/types";

/* ==========================================================================
 * Logger
 * ======================================================================== */

const logger =
  createLogger("OFFSCREEN");

/* ==========================================================================
 * Constants
 * ======================================================================== */

const CAMERA_VIDEO_ELEMENT_ID =
  "tracker-camera" as const;

/**
 * Temporary development-only smoke-log cadence for raw gaze verification.
 * Remove this callback/logging once the calibration pipeline has its own
 * diagnostics surface.
 */
const GAZE_SMOKE_LOG_INTERVAL_MS =
  500;

/* ==========================================================================
 * Runtime instance
 * ======================================================================== */

/**
 * One TrackerRuntime instance per Offscreen Document.
 *
 * Do not expose this through window/globalThis.
 */
let trackerRuntime:
  TrackerRuntime | null =
    null;

let runtimeMessageListenerRegistered = false;
let pageLifecycleCleanupRegistered = false;
let quickPreferenceListenerRegistered = false;
let lastRuntimeInitializationError: TrackerError | null = null;

function getErrorDiagnostic(error: unknown): {
  readonly message: string;
  readonly name: string | null;
  readonly stack: string | null;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown bootstrap error",
    name: null,
    stack: null
  };
}

const handleQuickRecalibrationPreferenceChanged = (
  changes: {
    [key: string]: chrome.storage.StorageChange;
  },
  areaName: string
): void => {
  if (
    areaName !== "local"
    || !(QUICK_RECALIBRATION.STORAGE_KEY in changes)
    || trackerRuntime === null
  ) {
    return;
  }

  const value =
    changes[QUICK_RECALIBRATION.STORAGE_KEY]
      ?.newValue;

  trackerRuntime.setAutomaticQuickRecalibrationEnabled(
    typeof value === "boolean"
      ? value
      : QUICK_RECALIBRATION.DEFAULT_ENABLED
  );

  lastQuickRecalibrationDriftNoticeAtMs = null;
};

async function loadQuickRecalibrationPreference(
  runtime: TrackerRuntime
): Promise<void> {
  try {
    const stored =
      await chrome.storage.local.get(
        QUICK_RECALIBRATION.STORAGE_KEY
      );

    const value =
      stored[QUICK_RECALIBRATION.STORAGE_KEY];

    runtime.setAutomaticQuickRecalibrationEnabled(
      typeof value === "boolean"
        ? value
        : QUICK_RECALIBRATION.DEFAULT_ENABLED
    );
  } catch {
    runtime.setAutomaticQuickRecalibrationEnabled(
      QUICK_RECALIBRATION.DEFAULT_ENABLED
    );
  }
}

function registerQuickRecalibrationPreferenceListenerSafely(): void {
  if (quickPreferenceListenerRegistered) {
    return;
  }

  try {
    chrome.storage.onChanged.addListener(
      handleQuickRecalibrationPreferenceChanged
    );
    quickPreferenceListenerRegistered = true;
  } catch (error: unknown) {
    logger.warn(
      "Quick recalibration preference listener is unavailable; using the default setting for this Offscreen lifetime.",
      getErrorDiagnostic(error)
    );
  }
}

interface FaceStatusMessageContext {
  sessionId: MessageMeta["sessionId"];
  pageId: MessageMeta["pageId"];
  tabId: MessageMeta["tabId"];
  browserFrameId: MessageMeta["browserFrameId"];
}

let faceStatusMessageContext:
  FaceStatusMessageContext | null =
    null;

let lastFacePositionBroadcastAtMs:
  number | null =
    null;

let lastBroadcastStable:
  boolean | null =
    null;

let lastGazeSmokeLogAtMs:
  number | null =
    null;

let lastAoiProbeAtMs:
  number | null =
    null;

let longitudinalDiagnosticStartedAtMs: number | null = null;
let longitudinalDiagnosticSessionId: string | null = null;
const emittedLongitudinalMilestones = new Set<number>();

/* ==========================================================================
 * Runtime context validation
 * ======================================================================== */

const RUNTIME_CONTEXT_VALUES:
  ReadonlySet<string> =
    new Set<string>([
      "BACKGROUND",
      "OFFSCREEN",
      "CONTENT",
      "POPUP",
      "CAMERA_PERMISSION_UI",
      "CALIBRATION_UI",
      "BROADCAST"
    ] satisfies readonly RuntimeContext[]);

function isRuntimeContext(
  value: unknown
): value is RuntimeContext {
  return (
    typeof value === "string"
    && RUNTIME_CONTEXT_VALUES.has(value)
  );
}

/* ==========================================================================
 * Message metadata validation
 * ======================================================================== */

function isMessageMeta(
  value: unknown
): value is MessageMeta {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(
      value.messageId
    )
    && isFiniteNumber(
      value.sentAtEpochMs
    )
    && isRuntimeContext(
      value.source
    )
    && isRuntimeContext(
      value.target
    )
    && isNullableString(
      value.sessionId
    )
    && isNullableString(
      value.pageId
    )
    && isNullableFiniteNumber(
      value.tabId
    )
    && isNullableFiniteNumber(
      value.browserFrameId
    )
  );
}

/* ==========================================================================
 * Message target validation
 * ======================================================================== */

/**
 * The Offscreen Document only consumes messages explicitly targeted at it.
 *
 * BROADCAST messages are intentionally not handled yet because responding
 * to a broadcast from multiple extension contexts could create ambiguous
 * responses.
 */
function isMessageForOffscreen(
  rawMessage: unknown
): boolean {
  if (!isRecord(rawMessage)) {
    return false;
  }

  const meta =
    rawMessage.meta;

  if (!isRecord(meta)) {
    return false;
  }

  return (
    meta.target === "OFFSCREEN"
  );
}

/* ==========================================================================
 * Empty payload validation
 * ======================================================================== */

function isEmptyPayload(
  value: unknown
): value is Readonly<Record<string, never>> {
  return (
    isRecord(value)
    && Object.keys(value).length === 0
  );
}

function isTrackingContextChangedPayload(
  value: unknown
): value is TrackingContextChangedPayload {
  return (
    isRecord(value)
    && (
      value.reason === "FULL_NAVIGATION"
      || value.reason === "SPA_NAVIGATION"
      || value.reason === "TAB_ACTIVATED"
      || value.reason === "TAB_ASSOCIATED"
    )
    && isNullableString(value.url)
  );
}

function isViewportContextChangedPayload(
  value: unknown
): value is ViewportContextChangedPayload {
  return (
    isRecord(value)
    && isFiniteNumber(value.viewportWidth)
    && value.viewportWidth > 0
    && isFiniteNumber(value.viewportHeight)
    && value.viewportHeight > 0
    && isFiniteNumber(value.devicePixelRatio)
    && value.devicePixelRatio > 0
  );
}

/* ==========================================================================
 * PING payload validation
 * ======================================================================== */

function isPingPayload(
  value: unknown
): value is PingPayload {
  return (
    isRecord(value)
    && isNonEmptyString(
      value.nonce
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

function isCalibrationTarget(
  value: unknown
): value is CalibrationTarget {
  if (
    !isRecord(value)
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

function isStartCalibrationPayload(
  value: unknown
): value is StartCalibrationPayload {
  return (
    isRecord(value)
    && isNonEmptyString(
      value.calibrationId
    )
    && isCalibrationMode(
      value.mode
    )
  );
}

function isCalibrationPointPayload(
  value: unknown
): value is CalibrationPointPayload {
  return (
    isRecord(value)
    && isNonEmptyString(
      value.calibrationId
    )
    && isCalibrationTarget(
      value.target
    )
    && isFiniteNumber(
      value.targetShownAtMs
    )
    && isFiniteNumber(
      value.attempt
    )
    && Number.isInteger(
      value.attempt
    )
    && value.attempt >= 1
  );
}

function isStartValidationPayload(
  value: unknown
): value is StartValidationPayload {
  return (
    isRecord(value)
    && isNonEmptyString(
      value.calibrationId
    )
    && isFiniteNumber(
      value.viewportWidth
    )
    && value.viewportWidth > 0
    && isFiniteNumber(
      value.viewportHeight
    )
    && value.viewportHeight > 0
    && isFiniteNumber(
      value.expectedPointCount
    )
    && Number.isInteger(
      value.expectedPointCount
    )
    && value.expectedPointCount >= CALIBRATION.MIN_VALIDATION_POINT_COUNT
  );
}

function isStartQuickRecalibrationPayload(
  value: unknown
): value is StartQuickRecalibrationPayload {
  return (
    isRecord(value)
    && isNonEmptyString(value.calibrationId)
    && isFiniteNumber(value.viewportWidth)
    && value.viewportWidth > 0
    && isFiniteNumber(value.viewportHeight)
    && value.viewportHeight > 0
    && isFiniteNumber(value.pointCount)
    && Number.isInteger(value.pointCount)
    && value.pointCount === DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
  );
}

function isStartQuickValidationPayload(
  value: unknown
): value is StartQuickValidationPayload {
  return (
    isRecord(value)
    && isNonEmptyString(value.calibrationId)
    && isFiniteNumber(value.viewportWidth)
    && value.viewportWidth > 0
    && isFiniteNumber(value.viewportHeight)
    && value.viewportHeight > 0
    && isFiniteNumber(value.expectedPointCount)
    && Number.isInteger(value.expectedPointCount)
    && value.expectedPointCount === DRIFT_THRESHOLDS.QUICK_REVALIDATION_POINT_COUNT
  );
}

function isValidationPointPayload(
  value: unknown
): value is ValidationPointPayload {
  return (
    isRecord(value)
    && isNonEmptyString(
      value.calibrationId
    )
    && isCalibrationTarget(
      value.target
    )
    && isFiniteNumber(
      value.targetShownAtMs
    )
    && isFiniteNumber(
      value.attempt
    )
    && Number.isInteger(
      value.attempt
    )
    && value.attempt >= 1
  );
}

/* ==========================================================================
 * Video element
 * ======================================================================== */

function getCameraVideoElement():
HTMLVideoElement {
  const element =
    document.getElementById(
      CAMERA_VIDEO_ELEMENT_ID
    );

  if (
    !(element instanceof HTMLVideoElement)
  ) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "The Offscreen camera video element could not be found.",
      {
        recoverable: false,

        details: {
          expectedElementId:
            CAMERA_VIDEO_ELEMENT_ID
        }
      }
    );
  }

  return element;
}

/* ==========================================================================
 * Response metadata
 * ======================================================================== */

function createResponseMeta(
  requestMeta: MessageMeta
): MessageMeta {
  return {
    messageId:
      createMessageId(),

    sentAtEpochMs:
      nowEpochMs(),

    source:
      "OFFSCREEN",

    target:
      requestMeta.source,

    sessionId:
      requestMeta.sessionId,

    pageId:
      requestMeta.pageId,

    tabId:
      requestMeta.tabId,

    browserFrameId:
      requestMeta.browserFrameId
  };
}

/* ==========================================================================
 * PING handling
 * ======================================================================== */

function handlePing(
  rawMessage:
    Record<string, unknown>
): RuntimeMessageOf<
  typeof MESSAGE_TYPES.PONG
> {
  if (
    !isCompatibleMessageProtocol(
      rawMessage.protocolVersion
    )
  ) {
    throw new TrackerError(
      ERROR_CODES
        .INCOMPATIBLE_MESSAGE_PROTOCOL,
      "OFFSCREEN",
      "Offscreen message protocol version is incompatible.",
      {
        details: {
          receivedProtocolVersion:
            rawMessage.protocolVersion,

          expectedProtocolVersion:
            MESSAGE_PROTOCOL_VERSION
        }
      }
    );
  }

  if (
    rawMessage.type
    !== MESSAGE_TYPES.PING
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen PING handler received an unexpected message type.",
      {
        details: {
          receivedType:
            rawMessage.type
        }
      }
    );
  }

  if (
    !isMessageMeta(
      rawMessage.meta
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen PING message contains invalid metadata."
    );
  }

  if (
    !isPingPayload(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen PING message contains an invalid payload."
    );
  }

  return createRuntimeMessage(
    MESSAGE_TYPES.PONG,

    createResponseMeta(
      rawMessage.meta
    ),

    {
      nonce:
        rawMessage.payload.nonce
    }
  );
}

/* ==========================================================================
 * START_CAMERA handling
 * ======================================================================== */

async function handleStartCamera(
  rawMessage:
    Record<string, unknown>
): Promise<
  RuntimeMessageOf<
    typeof MESSAGE_TYPES.CAMERA_READY
  >
> {
  if (
    !isMessageMeta(
      rawMessage.meta
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_CAMERA message contains invalid metadata."
    );
  }

  if (
    rawMessage.meta.source
    !== "BACKGROUND"
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "START_CAMERA must be routed through the Background context.",
      {
        details: {
          source:
            rawMessage.meta.source
        }
      }
    );
  }

  if (
    !isCameraRequest(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_CAMERA message contains invalid camera constraints."
    );
  }

  const runtime =
    await ensureTrackerRuntimeReady();

  const settings =
    await runtime.startCamera(
      rawMessage.payload
    );

  return createRuntimeMessage(
    MESSAGE_TYPES.CAMERA_READY,

    createResponseMeta(
      rawMessage.meta
    ),

    {
      settings
    }
  );
}

/* ==========================================================================
 * START_FACE_POSITIONING handling
 * ======================================================================== */

async function handleStartFacePositioning(
  rawMessage:
    Record<string, unknown>
): Promise<
  RuntimeMessageOf<
    typeof MESSAGE_TYPES.FACE_POSITION_STATUS
  >
> {
  if (
    !isMessageMeta(
      rawMessage.meta
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_FACE_POSITIONING message contains invalid metadata."
    );
  }

  if (
    rawMessage.meta.source
    !== "BACKGROUND"
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "START_FACE_POSITIONING must be routed through the Background context.",
      {
        details: {
          source:
            rawMessage.meta.source
        }
      }
    );
  }

  if (
    !isEmptyPayload(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_FACE_POSITIONING message contains a non-empty payload."
    );
  }

  if (
    trackerRuntime === null
    || !trackerRuntime.isReady()
  ) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for face positioning."
    );
  }

  faceStatusMessageContext = {
    sessionId:
      rawMessage.meta.sessionId,

    pageId:
      rawMessage.meta.pageId,

    tabId:
      rawMessage.meta.tabId,

    browserFrameId:
      rawMessage.meta.browserFrameId
  };

  lastFacePositionBroadcastAtMs =
    null;

  lastBroadcastStable =
    null;

  try {
    await trackerRuntime
      .startFacePositioning();

    const feedback =
      trackerRuntime
        .getLatestPreCalibrationFeedback();

    if (feedback === null) {
      throw new TrackerError(
        ERROR_CODES.FACE_DETECTION_FAILED,
        "OFFSCREEN",
        "Pre-calibration feedback was unavailable after face positioning startup."
      );
    }

    return createRuntimeMessage(
      MESSAGE_TYPES.FACE_POSITION_STATUS,

      createResponseMeta(
        rawMessage.meta
      ),

      {
        status:
          feedback.status,

        feedback
      }
    );
  } catch (error: unknown) {
    faceStatusMessageContext =
      null;

    throw error;
  }
}

/* ==========================================================================
 * D24 research-page context handling
 * ======================================================================== */

function handleTrackingContextChanged(
  rawMessage: Record<string, unknown>
): RuntimeMessageOf<
  typeof MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED
> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || rawMessage.meta.sessionId === null
    || rawMessage.meta.pageId === null
    || rawMessage.meta.tabId === null
    || rawMessage.meta.browserFrameId === null
    || !isTrackingContextChangedPayload(rawMessage.payload)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen TRACKING_CONTEXT_CHANGED message is invalid."
    );
  }

  const previous = faceStatusMessageContext;

  const pageOrTabChanged =
    previous === null
    || previous.sessionId !== rawMessage.meta.sessionId
    || previous.pageId !== rawMessage.meta.pageId
    || previous.tabId !== rawMessage.meta.tabId
    || previous.browserFrameId !== rawMessage.meta.browserFrameId;

  faceStatusMessageContext = {
    sessionId: rawMessage.meta.sessionId,
    pageId: rawMessage.meta.pageId,
    tabId: rawMessage.meta.tabId,
    browserFrameId: rawMessage.meta.browserFrameId
  };

  if (pageOrTabChanged) {
    trackerRuntime?.handlePageContextTransition();
    lastAoiProbeAtMs = null;
    lastGazeSmokeLogAtMs = null;
  }

  logger.info(
    "Authoritative research-page context synchronized.",
    {
      sessionId: rawMessage.meta.sessionId,
      pageId: rawMessage.meta.pageId,
      tabId: rawMessage.meta.tabId,
      reason: rawMessage.payload.reason,
      url: rawMessage.payload.url,
      derivedRuntimeReset: pageOrTabChanged
    }
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED,
    createResponseMeta(rawMessage.meta),
    {
      ...rawMessage.payload
    }
  );
}

/* ==========================================================================
 * D26 live viewport synchronization
 * ======================================================================== */

function handleViewportContextChanged(
  rawMessage: Record<string, unknown>
): RuntimeMessageOf<
  typeof MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED
> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || rawMessage.meta.sessionId === null
    || rawMessage.meta.pageId === null
    || rawMessage.meta.tabId === null
    || !isViewportContextChangedPayload(rawMessage.payload)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen VIEWPORT_CONTEXT_CHANGED message is invalid."
    );
  }

  const changed =
    trackerRuntime?.updateTrackingViewportContext(
      rawMessage.payload.viewportWidth,
      rawMessage.payload.viewportHeight,
      rawMessage.payload.devicePixelRatio
    ) ?? false;

  if (changed) {
    lastAoiProbeAtMs = null;
  }

  logger.info(
    "Live research viewport synchronized.",
    {
      pageId: rawMessage.meta.pageId,
      tabId: rawMessage.meta.tabId,
      viewportWidth: rawMessage.payload.viewportWidth,
      viewportHeight: rawMessage.payload.viewportHeight,
      devicePixelRatio: rawMessage.payload.devicePixelRatio,
      derivedPixelRuntimeReset: changed
    }
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED,
    createResponseMeta(rawMessage.meta),
    { ...rawMessage.payload }
  );
}

/* ==========================================================================
 * Calibration handling
 * ======================================================================== */

function handleStartCalibration(
  rawMessage:
    Record<string, unknown>
): RuntimeMessageOf<
  typeof MESSAGE_TYPES.START_CALIBRATION
> {
  if (
    !isMessageMeta(
      rawMessage.meta
    )
    || rawMessage.meta.source
      !== "BACKGROUND"
    || !isStartCalibrationPayload(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_CALIBRATION message is invalid."
    );
  }

  if (
    trackerRuntime === null
    || !trackerRuntime.isReady()
  ) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for calibration startup."
    );
  }

  trackerRuntime.startCalibration(
    rawMessage.payload.calibrationId,
    rawMessage.payload.mode
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.START_CALIBRATION,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      calibrationId:
        rawMessage.payload.calibrationId,
      mode:
        rawMessage.payload.mode
    }
  );
}

async function handleCalibrationPoint(
  rawMessage:
    Record<string, unknown>
): Promise<
  RuntimeMessageOf<
    typeof MESSAGE_TYPES.CALIBRATION_POINT_RESULT
  >
> {
  if (
    !isMessageMeta(
      rawMessage.meta
    )
    || rawMessage.meta.source
      !== "BACKGROUND"
    || !isCalibrationPointPayload(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen CALIBRATION_POINT message is invalid."
    );
  }

  if (
    trackerRuntime === null
    || !trackerRuntime.isReady()
  ) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for calibration point collection."
    );
  }

  const result =
    await trackerRuntime
      .collectCalibrationPoint(
        rawMessage.payload.calibrationId,
        rawMessage.payload.target,
        rawMessage.payload.targetShownAtMs
      );

  return createRuntimeMessage(
    MESSAGE_TYPES.CALIBRATION_POINT_RESULT,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      calibrationId:
        result.calibrationId,
      pointIndex:
        result.pointIndex,
      sufficient:
        result.sufficient,
      acceptedSampleCount:
        result.acceptedSampleCount,
      rejectedSampleCount:
        result.rejectedSampleCount,
      rejectionRatio:
        result.rejectionRatio,
      completedPointCount:
        result.completedPointCount,
      expectedPointCount:
        result.expectedPointCount,
      failureReason:
        result.failureReason,
      modelReady:
        result.modelReady,
      trainingRmseNormalized:
        result.trainingRmseNormalized,
      trainingDiagnostics:
        result.trainingDiagnostics,
      adaptiveExpansionTargets:
        result.adaptiveExpansionTargets
    }
  );
}

function handleAbortQuickRecalibration(
  rawMessage: Record<string, unknown>
): RuntimeMessageOf<typeof MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION> {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND"
    || !isRecord(rawMessage.payload)
    || !isNonEmptyString(rawMessage.payload.calibrationId)
    || !isNonEmptyString(rawMessage.payload.runId)) {
    throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "OFFSCREEN", "Invalid quick abort request.");
  }
  const { calibrationId, runId } = rawMessage.payload;
  // Re-check locally: indexing a Record<string, unknown> does not retain
  // property-level narrowing after it is aliased.
  if (typeof calibrationId !== "string" || typeof runId !== "string") {
    throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "OFFSCREEN", "Invalid quick abort identity.");
  }
  const rolledBack = trackerRuntime?.abortQuickRecalibration(
    calibrationId, runId
  ) ?? false;
  return createRuntimeMessage(MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
    createResponseMeta(rawMessage.meta),
    { calibrationId, runId, rolledBack });
}

function handleStartQuickRecalibration(
  rawMessage: Record<string, unknown>
): RuntimeMessageOf<typeof MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || !isStartQuickRecalibrationPayload(rawMessage.payload)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_QUICK_RECALIBRATION message is invalid."
    );
  }

  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick recalibration startup."
    );
  }

  const started = trackerRuntime.startQuickRecalibration(
    rawMessage.payload.calibrationId,
    rawMessage.payload.pointCount
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED,
    createResponseMeta(rawMessage.meta),
    {
      calibrationId: rawMessage.payload.calibrationId,
      startingPointIndex: started.startingPointIndex,
      expectedPointCount: started.expectedPointCount,
      pointCount: rawMessage.payload.pointCount,
      runId: started.runId
    }
  );
}

async function handleQuickRecalibrationPoint(
  rawMessage: Record<string, unknown>
): Promise<RuntimeMessageOf<typeof MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT>> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || !isCalibrationPointPayload(rawMessage.payload)
    || !isRecord(rawMessage.payload)
    || !isNonEmptyString(rawMessage.payload.runId)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen QUICK_RECALIBRATION_POINT message is invalid."
    );
  }

  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick recalibration collection."
    );
  }

  trackerRuntime.assertQuickRecalibrationRun(
    rawMessage.payload.calibrationId,
    typeof rawMessage.payload.runId === "string" ? rawMessage.payload.runId : ""
  );
  const result = await trackerRuntime.collectCalibrationPoint(
    rawMessage.payload.calibrationId,
    rawMessage.payload.target,
    rawMessage.payload.targetShownAtMs
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT,
    createResponseMeta(rawMessage.meta),
    {
      calibrationId: result.calibrationId,
      pointIndex: result.pointIndex,
      sufficient: result.sufficient,
      acceptedSampleCount: result.acceptedSampleCount,
      rejectedSampleCount: result.rejectedSampleCount,
      rejectionRatio: result.rejectionRatio,
      completedPointCount: result.completedPointCount,
      expectedPointCount: result.expectedPointCount,
      failureReason: result.failureReason,
      modelReady: result.modelReady,
      trainingRmseNormalized: result.trainingRmseNormalized,
      trainingDiagnostics: result.trainingDiagnostics,
      adaptiveExpansionTargets: []
    }
  );
}

function handleStartQuickValidation(
  rawMessage: Record<string, unknown>
): RuntimeMessageOf<typeof MESSAGE_TYPES.START_QUICK_VALIDATION> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || !isStartQuickValidationPayload(rawMessage.payload)
    || !isNonEmptyString(rawMessage.payload.runId)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_QUICK_VALIDATION message is invalid."
    );
  }

  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick validation startup."
    );
  }

  trackerRuntime.assertQuickRecalibrationRun(
    rawMessage.payload.calibrationId,
    rawMessage.payload.runId
  );
  trackerRuntime.startQuickValidation(
    rawMessage.payload.calibrationId,
    rawMessage.payload.viewportWidth,
    rawMessage.payload.viewportHeight,
    rawMessage.payload.expectedPointCount
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.START_QUICK_VALIDATION,
    createResponseMeta(rawMessage.meta),
    { ...rawMessage.payload }
  );
}

async function handleQuickValidationPoint(
  rawMessage: Record<string, unknown>
): Promise<RuntimeMessageOf<typeof MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT>> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || !isValidationPointPayload(rawMessage.payload)
    || !isRecord(rawMessage.payload)
    || !isNonEmptyString(rawMessage.payload.runId)
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen QUICK_VALIDATION_POINT message is invalid."
    );
  }

  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick validation collection."
    );
  }

  trackerRuntime.assertQuickRecalibrationRun(
    rawMessage.payload.calibrationId,
    typeof rawMessage.payload.runId === "string" ? rawMessage.payload.runId : ""
  );
  const result = await trackerRuntime.collectValidationPoint(
    rawMessage.payload.calibrationId,
    rawMessage.payload.target,
    rawMessage.payload.targetShownAtMs
  );

  const selectedStrategyValidation = result.validationComplete
    ? trackerRuntime.getCompletedQuickValidationResult()
    : null;

  return createRuntimeMessage(
    MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT,
    createResponseMeta(rawMessage.meta),
    {
      calibrationId: result.calibrationId,
      correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
      pointIndex: result.pointIndex,
      sufficient: result.sufficient,
      acceptedSampleCount: result.acceptedSampleCount,
      rejectedSampleCount: result.rejectedSampleCount,
      rejectionRatio: result.rejectionRatio,
      completedPointCount: result.completedPointCount,
      expectedPointCount: result.expectedPointCount,
      failureReason: result.failureReason,
      validationComplete: result.validationComplete,
      metrics: result.validation?.metrics ?? null,
      quality: result.validation?.quality ?? null,
      selectedStrategyValidation,
      pointResults: result.validation?.pointResults ?? null
    }
  );
}

function handleStartValidation(
  rawMessage:
    Record<string, unknown>
): RuntimeMessageOf<
  typeof MESSAGE_TYPES.START_VALIDATION
> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || !isStartValidationPayload(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_VALIDATION message is invalid."
    );
  }

  if (
    trackerRuntime === null
    || !trackerRuntime.isReady()
  ) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for validation startup."
    );
  }

  trackerRuntime.startValidation(
    rawMessage.payload.calibrationId,
    rawMessage.payload.viewportWidth,
    rawMessage.payload.viewportHeight,
    rawMessage.payload.expectedPointCount
  );

  return createRuntimeMessage(
    MESSAGE_TYPES.START_VALIDATION,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      ...rawMessage.payload
    }
  );
}

async function handleValidationPoint(
  rawMessage:
    Record<string, unknown>
): Promise<
  RuntimeMessageOf<
    typeof MESSAGE_TYPES.VALIDATION_POINT_RESULT
  >
> {
  if (
    !isMessageMeta(rawMessage.meta)
    || rawMessage.meta.source !== "BACKGROUND"
    || !isValidationPointPayload(
      rawMessage.payload
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen VALIDATION_POINT message is invalid."
    );
  }

  if (
    trackerRuntime === null
    || !trackerRuntime.isReady()
  ) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for validation point collection."
    );
  }

  const result =
    await trackerRuntime
      .collectValidationPoint(
        rawMessage.payload.calibrationId,
        rawMessage.payload.target,
        rawMessage.payload.targetShownAtMs
      );

  const selectedStrategyValidation =
    result.validationComplete
      ? trackerRuntime.getSelectedStrategyValidationResult()
      : null;

  return createRuntimeMessage(
    MESSAGE_TYPES.VALIDATION_POINT_RESULT,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      calibrationId:
        result.calibrationId,
      correctionStrategy:
        CALIBRATION.CORRECTION_STRATEGY,
      pointIndex:
        result.pointIndex,
      sufficient:
        result.sufficient,
      acceptedSampleCount:
        result.acceptedSampleCount,
      rejectedSampleCount:
        result.rejectedSampleCount,
      rejectionRatio:
        result.rejectionRatio,
      completedPointCount:
        result.completedPointCount,
      expectedPointCount:
        result.expectedPointCount,
      failureReason:
        result.failureReason,
      validationComplete:
        result.validationComplete,
      metrics:
        result.validation?.metrics ?? null,
      quality:
        result.validation?.quality ?? null,
      selectedStrategyValidation,
      pointResults:
        result.validation?.pointResults ?? null
    }
  );
}

function sendAsyncFailureResponse(
  error: unknown,
  sendResponse: (response: unknown) => void
): void {
  const normalized =
    normalizeTrackerError(
      error,
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen asynchronous message handling failed."
    );

  logger.warn(
    "Offscreen rejected an asynchronous runtime message.",
    {
      code:
        normalized.code,

      message:
        normalized.message
    }
  );

  sendResponse({
    ok: false,
    error:
      normalized.toSerializable()
  });
}

/* ==========================================================================
 * Runtime message handling
 * ======================================================================== */

function registerRuntimeMessageListener():
void {
  if (runtimeMessageListenerRegistered) {
    return;
  }

  chrome.runtime.onMessage.addListener(
    (
      rawMessage: unknown,
      _sender,
      sendResponse
    ) => {
      if (
        !isMessageForOffscreen(
          rawMessage
        )
      ) {
        return false;
      }

      try {
        if (!isRecord(rawMessage)) {
          return false;
        }

        if (
          !isCompatibleMessageProtocol(
            rawMessage.protocolVersion
          )
        ) {
          throw new TrackerError(
            ERROR_CODES
              .INCOMPATIBLE_MESSAGE_PROTOCOL,
            "OFFSCREEN",
            "Received an incompatible Offscreen message protocol version."
          );
        }

        if (
          !isMessageType(
            rawMessage.type
          )
        ) {
          throw new TrackerError(
            ERROR_CODES.INVALID_MESSAGE,
            "OFFSCREEN",
            "Received an unknown Offscreen message type."
          );
        }

        switch (rawMessage.type) {
          case MESSAGE_TYPES.PING: {
            const response =
              handlePing(
                rawMessage
              );

            sendResponse(response);

            return false;
          }

          case MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED: {
            const response =
              handleTrackingContextChanged(
                rawMessage
              );

            sendResponse(response);

            return false;
          }

          case MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED: {
            const response =
              handleViewportContextChanged(
                rawMessage
              );

            sendResponse(response);

            return false;
          }

          case MESSAGE_TYPES.START_CAMERA: {
            void handleStartCamera(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error: unknown) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );

            return true;
          }

          case MESSAGE_TYPES.START_FACE_POSITIONING: {
            void handleStartFacePositioning(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error: unknown) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );

            return true;
          }

          case MESSAGE_TYPES.START_CALIBRATION: {
            const response =
              handleStartCalibration(
                rawMessage
              );

            sendResponse(response);

            return false;
          }

          case MESSAGE_TYPES.CALIBRATION_POINT: {
            void handleCalibrationPoint(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error: unknown) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );

            return true;
          }

          case MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION: {
            sendResponse(handleAbortQuickRecalibration(rawMessage));
            return false;
          }

          case MESSAGE_TYPES.START_QUICK_RECALIBRATION: {
            const response = handleStartQuickRecalibration(rawMessage);
            sendResponse(response);
            return false;
          }

          case MESSAGE_TYPES.QUICK_RECALIBRATION_POINT: {
            void handleQuickRecalibrationPoint(rawMessage)
              .then(sendResponse)
              .catch((error: unknown) => sendAsyncFailureResponse(error, sendResponse));
            return true;
          }

          case MESSAGE_TYPES.START_QUICK_VALIDATION: {
            const response = handleStartQuickValidation(rawMessage);
            sendResponse(response);
            return false;
          }

          case MESSAGE_TYPES.QUICK_VALIDATION_POINT: {
            void handleQuickValidationPoint(rawMessage)
              .then(sendResponse)
              .catch((error: unknown) => sendAsyncFailureResponse(error, sendResponse));
            return true;
          }

          case MESSAGE_TYPES.START_VALIDATION: {
            const response =
              handleStartValidation(
                rawMessage
              );

            sendResponse(response);

            return false;
          }

          case MESSAGE_TYPES.VALIDATION_POINT: {
            void handleValidationPoint(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error: unknown) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );

            return true;
          }

          default:
            logger.debug(
              "Offscreen received a message that does not yet have a local handler.",
              {
                type:
                  rawMessage.type
              }
            );

            return false;
        }
      } catch (error: unknown) {
        const normalized =
          normalizeTrackerError(
            error,
            ERROR_CODES.INVALID_MESSAGE,
            "OFFSCREEN",
            "Offscreen runtime message handling failed."
          );

        logger.warn(
          "Offscreen rejected a runtime message.",
          {
            code:
              normalized.code,

            message:
              normalized.message
          }
        );

        sendResponse({
          ok: false,
          error:
            normalized.toSerializable()
        });

        return false;
      }
    }
  );
}

/* ==========================================================================
 * Face-position status broadcasting
 * ======================================================================== */

function reportFacePositionStatus(
  result: FaceQualityFrameResult,
  feedback: PreCalibrationFeedback
): void {
  const context =
    faceStatusMessageContext;

  if (context === null) {
    return;
  }

  const stableChanged =
    lastBroadcastStable === null
    || lastBroadcastStable
      !== feedback.status.stable;

  const intervalElapsed =
    lastFacePositionBroadcastAtMs
      === null
    || result.timestampMs
      - lastFacePositionBroadcastAtMs
      >= FACE_PIPELINE_RUNTIME
        .POSITION_STATUS_BROADCAST_INTERVAL_MS;

  if (
    !stableChanged
    && !intervalElapsed
  ) {
    return;
  }

  lastFacePositionBroadcastAtMs =
    result.timestampMs;

  lastBroadcastStable =
    feedback.status.stable;

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.FACE_POSITION_STATUS,

      {
        messageId:
          createMessageId(),

        sentAtEpochMs:
          nowEpochMs(),

        source:
          "OFFSCREEN",

        target:
          "BROADCAST",

        sessionId:
          context.sessionId,

        pageId:
          context.pageId,

        tabId:
          context.tabId,

        browserFrameId:
          context.browserFrameId
      },

      {
        status:
          feedback.status,

        feedback
      }
    );

  void chrome.runtime
    .sendMessage(message)
    .catch(
      (sendError: unknown) => {
        logger.debug(
          "Face-position status broadcast was not delivered.",
          {
            transportError:
              sendError instanceof Error
                ? sendError.message
                : "Unknown message transport error"
          }
        );
      }
    );
}

/* ==========================================================================
 * D25 completed-fixation persistence broadcasting
 * ======================================================================== */

function reportCompletedFixationFrame(
  result: GazeRuntimeFrameResult
): void {
  const context = faceStatusMessageContext;
  const fixation = result.fixation.completedFixation;

  if (
    fixation === null
    || context === null
    || context.sessionId === null
    || context.pageId === null
    || context.tabId === null
    || !result.authoritativeGaze.collectionAllowed
  ) {
    return;
  }

  const message = createRuntimeMessage(
    MESSAGE_TYPES.FIXATION_EVENT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BACKGROUND",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId ?? 0
    },
    {
      event: {
        fixationId: fixation.fixationId,
        sessionId: context.sessionId,
        pageId: context.pageId,
        startTimeMs: fixation.startTimeMs,
        endTimeMs: fixation.endTimeMs,
        durationMs: fixation.durationMs,
        centroidViewportPoint: {
          ...fixation.centroidViewportPoint
        },
        dispersionX: fixation.dispersionX,
        dispersionY: fixation.dispersionY,
        dispersionPx: fixation.dispersionPx,
        sampleCount: fixation.sampleCount,
        qualityMean: fixation.qualityMean,
        aoiId: null,
        aoiDwellRatio: 0
      },
      peakSpeedPxPerSecond:
        fixation.peakSpeedPxPerSecond
    }
  );

  void chrome.runtime
    .sendMessage(message)
    .catch((error: unknown) => {
      logger.debug(
        "Completed fixation could not be routed to storage.",
        {
          fixationId: fixation.fixationId,
          transportError:
            error instanceof Error
              ? error.message
              : "Unknown fixation transport error"
        }
      );
    });
}

/* ==========================================================================
 * AOI probe broadcasting
 * ======================================================================== */

function reportAoiProbeFrame(
  result: GazeRuntimeFrameResult
): void {
  const context =
    faceStatusMessageContext;

  const completedFixation =
    result.fixation.completedFixation;

  const activeFixation =
    result.fixation.activeFixation;

  const viewportSize =
    result.stabilizedGaze.viewportSize;

  const completedProbe =
    completedFixation !== null
    && viewportSize !== null
    && viewportSize.width > 0
    && viewportSize.height > 0;

  const viewportPoint =
    completedProbe
      ? completedFixation.centroidViewportPoint
      : activeFixation
        ?.centroidViewportPoint
        ?? result.stabilizedGaze
          .stabilizedViewportPoint;

  const normalizedPoint =
    completedProbe
      ? {
          x:
            completedFixation.centroidViewportPoint.x
            / viewportSize.width,
          y:
            completedFixation.centroidViewportPoint.y
            / viewportSize.height
        }
      : activeFixation !== null
        && viewportSize !== null
        && viewportSize.width > 0
        && viewportSize.height > 0
          ? {
              x:
                activeFixation.centroidViewportPoint.x
                / viewportSize.width,
              y:
                activeFixation.centroidViewportPoint.y
                / viewportSize.height
            }
          : result.stabilizedGaze
            .stabilizedNormalizedPoint;

  const pointSource =
    completedProbe || activeFixation !== null
      ? "FIXATION_CENTROID" as const
      : "STABILIZED_GAZE" as const;

  if (
    context === null
    || context.sessionId === null
    || context.pageId === null
    || context.tabId === null
    || viewportPoint === null
    || normalizedPoint === null
    || !result.authoritativeGaze.collectionAllowed
    || (
      !completedProbe
      && !result.stabilizedGaze.currentSampleValid
    )
  ) {
    return;
  }

  const timestampMs =
    completedProbe
      ? completedFixation.endTimeMs
      : result.prediction.timestampMs;

  /**
   * A completed fixation bypasses the ordinary AOI probe throttle so even a
   * 100-150 ms fixation receives one durable coordinate/AOI snapshot.
   */
  if (
    !completedProbe
    && lastAoiProbeAtMs !== null
    && timestampMs - lastAoiProbeAtMs
      < AOI.PROBE_INTERVAL_MS
  ) {
    return;
  }

  lastAoiProbeAtMs = timestampMs;

  const rawPredictionNormalizedPoint =
    completedProbe
    || result.prediction.rawSpace !== "NORMALIZED"
      ? null
      : {
          x: result.prediction.rawPoint.x,
          y: result.prediction.rawPoint.y
        };

  const completedFixationSnapshot =
    completedProbe
      ? {
          event: {
            fixationId:
              completedFixation.fixationId,
            sessionId: context.sessionId,
            pageId: context.pageId,
            startTimeMs:
              completedFixation.startTimeMs,
            endTimeMs:
              completedFixation.endTimeMs,
            durationMs:
              completedFixation.durationMs,
            centroidViewportPoint: {
              ...completedFixation
                .centroidViewportPoint
            },
            dispersionX:
              completedFixation.dispersionX,
            dispersionY:
              completedFixation.dispersionY,
            dispersionPx:
              completedFixation.dispersionPx,
            sampleCount:
              completedFixation.sampleCount,
            qualityMean:
              completedFixation.qualityMean,
            aoiId: null,
            aoiDwellRatio: 0
          },
          peakSpeedPxPerSecond:
            completedFixation
              .peakSpeedPxPerSecond
        }
      : null;

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.AOI_PROBE,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "OFFSCREEN",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId:
          context.browserFrameId ?? 0
      },
      {
        timestampMs,
        normalizedPoint: {
          ...normalizedPoint
        },
        viewportPoint: {
          ...viewportPoint
        },
        pointSource,
        gazeQuality:
          completedProbe
            ? completedFixation.qualityMean
            : result.effectiveQualityScore,
        fixationId:
          completedProbe
            ? completedFixation.fixationId
            : activeFixation?.fixationId
              ?? null,
        degradedCollection:
          result.authoritativeGaze
            .degradedCollection,
        rawPredictionNormalizedPoint,
        authoritativeNormalizedPoint:
          completedProbe
            ? null
            : {
                ...result.authoritativeGaze
                  .normalizedPoint
              },
        stabilizedNormalizedPoint:
          completedProbe
            ? null
            : result.stabilizedGaze
              .stabilizedNormalizedPoint === null
              ? null
              : {
                  ...result.stabilizedGaze
                    .stabilizedNormalizedPoint
                },
        completedFixation:
          completedFixationSnapshot
      }
    );

  void chrome.runtime
    .sendMessage(message)
    .catch(
      (error: unknown) => {
        logger.debug(
          "AOI probe could not be routed to the research page.",
          {
            fixationCompletionProbe:
              completedProbe,
            transportError:
              error instanceof Error
                ? error.message
                : "Unknown AOI probe transport error"
          }
        );
      }
    );
}

let lastQuickRecalibrationDriftNoticeAtMs: number | null = null;

function reportRuntimeDriftStatus(
  result: GazeRuntimeFrameResult
): void {
  const status = result.driftStatus;
  const context = faceStatusMessageContext;

  if (
    status === null
    || !status.quickRecalibrationRecommended
    || result.maintenanceCalibrationActive
    || !result.authoritativeGaze.validationReady
    || context === null
    || context.sessionId === null
    || context.tabId === null
  ) {
    return;
  }

  if (
    lastQuickRecalibrationDriftNoticeAtMs !== null
    && status.timestampMs - lastQuickRecalibrationDriftNoticeAtMs
      < DRIFT_THRESHOLDS.QUICK_RECALIBRATION_COOLDOWN_MS
  ) {
    return;
  }

  lastQuickRecalibrationDriftNoticeAtMs = status.timestampMs;

  const message = createRuntimeMessage(
    MESSAGE_TYPES.DRIFT_STATUS,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BACKGROUND",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId ?? 0
    },
    { status: { ...status } }
  );

  void chrome.runtime.sendMessage(message).catch(() => {
    // Maintenance notification failure must never stop gaze tracking.
  });
}

function milestoneLabel(milliseconds: number): "T0" | "T2" | "T5" | "T10" {
  if (milliseconds === 0) return "T0";
  if (milliseconds === 2 * 60_000) return "T2";
  if (milliseconds === 5 * 60_000) return "T5";
  return "T10";
}

function reportLongitudinalRuntimeDiagnostic(
  result: GazeRuntimeFrameResult
): void {
  const context = faceStatusMessageContext;
  if (
    context === null
    || context.sessionId === null
    || !result.authoritativeGaze.validationReady
    || result.maintenanceCalibrationActive
  ) {
    return;
  }

  if (longitudinalDiagnosticSessionId !== context.sessionId) {
    longitudinalDiagnosticSessionId = context.sessionId;
    longitudinalDiagnosticStartedAtMs = result.prediction.timestampMs;
    emittedLongitudinalMilestones.clear();
  }

  longitudinalDiagnosticStartedAtMs ??= result.prediction.timestampMs;
  const elapsedMs = Math.max(0, result.prediction.timestampMs - longitudinalDiagnosticStartedAtMs);

  for (const milestoneMs of RUNTIME_MAINTENANCE.LONGITUDINAL_MILESTONES_MS) {
    if (emittedLongitudinalMilestones.has(milestoneMs) || elapsedMs < milestoneMs) continue;
    emittedLongitudinalMilestones.add(milestoneMs);

    const message = createRuntimeMessage(
      MESSAGE_TYPES.RUNTIME_QUALITY_DIAGNOSTIC,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "OFFSCREEN",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: context.browserFrameId ?? 0
      },
      {
        diagnostic: {
          timestampMs: result.prediction.timestampMs,
          milestone: milestoneLabel(milestoneMs),
          elapsedMs,
          gazeQualityScore: result.quality.score,
          effectiveGazeQualityScore: result.effectiveQualityScore,
          baselinePrecisionPx: result.baselinePrecisionPx,
          deepPrecisionPx: result.deepPrecisionPx,
          driftStatus: result.driftStatus === null ? null : { ...result.driftStatus },
          authoritativeStrategy: result.authoritativeGaze.strategy,
          collectionAllowed: result.authoritativeGaze.collectionAllowed,
          degradedCollection: result.authoritativeGaze.degradedCollection
        }
      }
    );

    void chrome.runtime.sendMessage(message).catch(() => {
      emittedLongitudinalMilestones.delete(milestoneMs);
    });
  }
}

/* ==========================================================================
 * Raw-gaze smoke diagnostics
 * ======================================================================== */

function reportRawGazeSmokeFrame(
  result: GazeRuntimeFrameResult
): void {
  const timestampMs =
    result.prediction.timestampMs;

  const completedFixation =
    result.fixation.completedFixation;

  if (completedFixation !== null) {
    logger.info(
      "Fixation completed.",
      {
        fixationId:
          completedFixation.fixationId,
        startTimeMs:
          completedFixation.startTimeMs,
        endTimeMs:
          completedFixation.endTimeMs,
        durationMs:
          completedFixation.durationMs,
        centroidViewportX:
          completedFixation.centroidViewportPoint.x,
        centroidViewportY:
          completedFixation.centroidViewportPoint.y,
        dispersionX:
          completedFixation.dispersionX,
        dispersionY:
          completedFixation.dispersionY,
        dispersionPx:
          completedFixation.dispersionPx,
        sampleCount:
          completedFixation.sampleCount,
        qualityMean:
          completedFixation.qualityMean,
        peakSpeedPxPerSecond:
          completedFixation.peakSpeedPxPerSecond
      }
    );
  }

  if (
    lastGazeSmokeLogAtMs !== null
    && timestampMs - lastGazeSmokeLogAtMs
      < GAZE_SMOKE_LOG_INTERVAL_MS
  ) {
    return;
  }

  lastGazeSmokeLogAtMs =
    timestampMs;

  logger.info(
    "[GazeSmoke] Raw gaze prediction.",
    {
      frameSequence:
        result.frameSequence,
      source:
        result.prediction.source,
      rawSpace:
        result.prediction.rawSpace,
      rawX:
        result.prediction.rawPoint.x,
      rawY:
        result.prediction.rawPoint.y,
      confidence:
        result.prediction.confidence,
      validationValid:
        result.validation.valid,
      gazeQuality:
        result.quality.score,
      effectiveGazeQuality:
        result.effectiveQualityScore,
      collectionSuspendedForDrift:
        result.collectionSuspendedForDrift,
      gazeQualityLevel:
        result.quality.level,
      deepObserverAvailable:
        result.observer.available,
      deepObserverInFlight:
        result.observer.inFlight,
      deepObserverAttemptCount:
        result.observer.attemptCount,
      deepObserverSuccessCount:
        result.observer.successCount,
      deepObserverFailureCount:
        result.observer.failureCount,
      deepObserverFrameSequence:
        result.observer.lastPrediction
          ?.frameSequence
        ?? null,
      deepObserverRawSpace:
        result.observer.lastPrediction
          ?.rawSpace
        ?? null,
      authoritativeStrategy:
        result.authoritativeGaze.strategy,
      configuredSessionStrategy:
        result.authoritativeGaze.configuredStrategy,
      authoritativeNormalizedX:
        result.authoritativeGaze.normalizedPoint.x,
      authoritativeNormalizedY:
        result.authoritativeGaze.normalizedPoint.y,
      authoritativeDeepWeight:
        result.authoritativeGaze.deepWeight,
      authoritativeDeepCandidateAgeMs:
        result.authoritativeGaze.deepCandidateAgeMs,
      authoritativeDeepSourceAgeMs:
        result.authoritativeGaze.deepCandidateSourceAgeMs,
      authoritativeDeepAvailabilityAgeMs:
        result.authoritativeGaze.deepCandidateAvailabilityAgeMs,
      authoritativeDeepFreshnessBudgetMs:
        result.authoritativeGaze.deepCandidateFreshnessBudgetMs,
      authoritativeDeepTemporalAlignmentApplied:
        result.authoritativeGaze.deepTemporalAlignmentApplied,
      authoritativeValidationReady:
        result.authoritativeGaze.validationReady,
      authoritativeCollectionAllowed:
        result.authoritativeGaze.collectionAllowed,
      authoritativeDegradedCollection:
        result.authoritativeGaze.degradedCollection,
      authoritativeRuntimeDriftSeverity:
        result.driftStatus?.severity ?? null,
      authoritativeRecalibrationRecommended:
        result.driftStatus?.quickRecalibrationRecommended ?? false,
      authoritativeFallbackReason:
        result.authoritativeGaze.fallbackReason,
      stabilizedGazeMode:
        result.stabilizedGaze.mode,
      stabilizedCurrentSampleValid:
        result.stabilizedGaze.currentSampleValid,
      stabilizedNormalizedX:
        result.stabilizedGaze.stabilizedNormalizedPoint
          ?.x
        ?? null,
      stabilizedNormalizedY:
        result.stabilizedGaze.stabilizedNormalizedPoint
          ?.y
        ?? null,
      stabilizedViewportX:
        result.stabilizedGaze.stabilizedViewportPoint
          ?.x
        ?? null,
      stabilizedViewportY:
        result.stabilizedGaze.stabilizedViewportPoint
          ?.y
        ?? null,
      stabilizedVisualAgeMs:
        result.stabilizedGaze.visualAgeMs,
      rawGazeSpeedPxPerSecond:
        result.stabilizedGaze.rawSpeedPxPerSecond,
      stabilizedGazeSpeedPxPerSecond:
        result.stabilizedGaze.stabilizedSpeedPxPerSecond,
      fixationState:
        result.fixation.state,
      fixationStrategyTransitionGuardApplied:
        result.fixation.strategyTransitionGuardApplied,
      fixationVelocityThresholdPxPerSecond:
        result.fixation.velocityThresholdPxPerSecond,
      fixationCandidateDurationMs:
        result.fixation.candidateDurationMs,
      fixationCandidateSampleCount:
        result.fixation.candidateSampleCount,
      activeFixationId:
        result.fixation.activeFixation?.fixationId
        ?? null,
      activeFixationDurationMs:
        result.fixation.activeFixation?.durationMs
        ?? null,
      activeFixationSampleCount:
        result.fixation.activeFixation?.sampleCount
        ?? null,
      activeFixationCentroidViewportX:
        result.fixation.activeFixation
          ?.centroidViewportPoint.x
        ?? null,
      activeFixationCentroidViewportY:
        result.fixation.activeFixation
          ?.centroidViewportPoint.y
        ?? null,
      activeFixationDispersionPx:
        result.fixation.activeFixation?.dispersionPx
        ?? null,
      completedFixationId:
        result.fixation.completedFixation?.fixationId
        ?? null,
      completedFixationDurationMs:
        result.fixation.completedFixation?.durationMs
        ?? null,
      deepObserverYawRad:
        result.observer.lastPrediction
          ?.rawPoint.x
        ?? null,
      deepObserverPitchRad:
        result.observer.lastPrediction
          ?.rawPoint.y
        ?? null,
      deepObserverConfidence:
        result.observer.lastPrediction
          ?.confidence
        ?? null,
      deepObserverLatencyMs:
        result.observer.lastPrediction
          ?.inferenceLatencyMs
        ?? null
    }
  );

  runtimeMessageListenerRegistered = true;
}

/* ==========================================================================
 * Background error reporting
 * ======================================================================== */

/**
 * Reports Offscreen bootstrap/runtime errors to the authoritative Background
 * context.
 *
 * Failure to deliver the error message is logged locally and must not create
 * an infinite reporting loop.
 */
function reportTrackerErrorToBackground(
  error: TrackerError
): void {
  const serialized =
    error.toSerializable();

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.TRACKER_ERROR,

      {
        messageId:
          createMessageId(),

        sentAtEpochMs:
          nowEpochMs(),

        source:
          "OFFSCREEN",

        target:
          "BACKGROUND",

        sessionId:
          null,

        pageId:
          null,

        tabId:
          null,

        browserFrameId:
          null
      },

      serialized
    );

  void chrome.runtime
    .sendMessage(message)
    .catch(
      (sendError: unknown) => {
        logger.error(
          "Failed to report Offscreen error to Background.",
          {
            originalErrorCode:
              error.code,

            transportError:
              sendError instanceof Error
                ? sendError.message
                : "Unknown message transport error"
          }
        );
      }
    );
}

/* ==========================================================================
 * Lifecycle cleanup
 * ======================================================================== */

function registerPageLifecycleCleanup():
void {
  if (pageLifecycleCleanupRegistered) {
    return;
  }

  globalThis.addEventListener(
    "pagehide",
    () => {
      if (
        trackerRuntime === null
      ) {
        return;
      }

      try {
        trackerRuntime.dispose();
      } catch (error: unknown) {
        const normalized =
          normalizeTrackerError(
            error,
            ERROR_CODES.UNKNOWN,
            "OFFSCREEN",
            "Offscreen tracker runtime cleanup failed."
          );

        logger.error(
          "Offscreen cleanup failed.",
          {
            code:
              normalized.code
          }
        );
      } finally {
        if (quickPreferenceListenerRegistered) {
          try {
            chrome.storage.onChanged.removeListener(
              handleQuickRecalibrationPreferenceChanged
            );
          } catch {
            // Offscreen teardown must continue even if the API is unavailable.
          }
          quickPreferenceListenerRegistered = false;
        }

        trackerRuntime =
          null;

        faceStatusMessageContext =
          null;

        lastFacePositionBroadcastAtMs =
          null;

        lastBroadcastStable =
          null;

        lastGazeSmokeLogAtMs =
          null;

        lastAoiProbeAtMs =
          null;
      }
    },
    {
      once: true
    }
  );

  pageLifecycleCleanupRegistered = true;
}

/* ==========================================================================
 * Bootstrap
 * ======================================================================== */

function createInitializedTrackerRuntime(): TrackerRuntime {
  const videoElement = getCameraVideoElement();

  const runtime = new TrackerRuntime(
    videoElement,
    reportTrackerErrorToBackground,
    reportFacePositionStatus,
    (result) => {
      reportRuntimeDriftStatus(result);
      reportLongitudinalRuntimeDiagnostic(result);
      if (!result.maintenanceCalibrationActive) {
        reportCompletedFixationFrame(result);
        reportAoiProbeFrame(result);
      }
      reportRawGazeSmokeFrame(result);
    }
  );

  runtime.initialize();
  return runtime;
}

function installInitializedTrackerRuntime(
  runtime: TrackerRuntime
): void {
  trackerRuntime = runtime;
  lastRuntimeInitializationError = null;

  registerQuickRecalibrationPreferenceListenerSafely();
  void loadQuickRecalibrationPreference(runtime);

  logger.info(
    "Offscreen tracker runtime is ready.",
    { ready: runtime.isReady() }
  );
}

function tryInitializeTrackerRuntime(): TrackerRuntime | null {
  if (trackerRuntime !== null && trackerRuntime.isReady()) {
    return trackerRuntime;
  }

  if (trackerRuntime !== null) {
    try {
      trackerRuntime.dispose();
    } catch {
      // The new initialization attempt remains authoritative.
    }
    trackerRuntime = null;
  }

  try {
    const runtime = createInitializedTrackerRuntime();
    installInitializedTrackerRuntime(runtime);
    return runtime;
  } catch (error: unknown) {
    const diagnostic = getErrorDiagnostic(error);
    const normalized = normalizeTrackerError(
      error,
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "Offscreen TrackerRuntime initialization failed.",
      {
        recoverable: true,
        details: {
          originalName: diagnostic.name,
          originalMessage: diagnostic.message,
          originalStack: diagnostic.stack
        }
      }
    );

    lastRuntimeInitializationError = normalized;
    trackerRuntime = null;

    logger.error(
      "Offscreen TrackerRuntime initialization attempt failed; transport remains available for retry.",
      {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        cause: diagnostic
      }
    );

    return null;
  }
}

async function ensureTrackerRuntimeReady(): Promise<TrackerRuntime> {
  const existing =
    trackerRuntime !== null && trackerRuntime.isReady()
      ? trackerRuntime
      : null;

  if (existing !== null) {
    return existing;
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const runtime = tryInitializeTrackerRuntime();
    if (runtime !== null) {
      return runtime;
    }

    if (attempt < 2) {
      await sleep(150);
    }
  }

  throw new TrackerError(
    ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
    "OFFSCREEN",
    "TrackerRuntime could not be initialized for the requested command.",
    {
      recoverable: true,
      details: {
        lastInitializationError:
          lastRuntimeInitializationError?.toSerializable() ?? null
      }
    }
  );
}

function bootstrapOffscreen(): void {
  registerRuntimeMessageListener();
  registerPageLifecycleCleanup();

  const runtime = tryInitializeTrackerRuntime();

  if (runtime === null) {
    logger.warn(
      "Offscreen document transport initialized, but TrackerRuntime will retry on the first command.",
      {
        lastInitializationError:
          lastRuntimeInitializationError?.toSerializable() ?? null
      }
    );
    return;
  }

  logger.info(
    "Offscreen document initialized.",
    { ready: runtime.isReady() }
  );
}

bootstrapOffscreen();