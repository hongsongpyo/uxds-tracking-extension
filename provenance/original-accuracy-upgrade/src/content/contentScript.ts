import {
  createCalibrationPattern,
  createCalibrationValidationPattern,
  createQuickRecalibrationPattern,
  createQuickValidationPattern
} from "../calibration/calibrationPattern";

import {
  CALIBRATION,
  DRIFT_THRESHOLDS,
  QUICK_RECALIBRATION,
  RUNTIME_MAINTENANCE
} from "../shared/constants";

import {
  MESSAGE_TYPES,
  createRuntimeMessage,
  isCompatibleMessageProtocol
} from "../shared/messages";

import {
  createMessageId,
  isFiniteNumber,
  isRecord,
  nowEpochMs,
  nowTimelineMs,
  sleep
} from "../shared/utils";

import {
  CalibrationOverlay
} from "./calibrationOverlay";

import {
  PreCalibrationOverlay
} from "./preCalibrationOverlay";

import {
  GazeOverlay
} from "./gazeOverlay";

import {
  DomAoiResolver
} from "./domAoiResolver";

import {
  PageCoordinateTracker,
  remapNormalizedPointToViewport
} from "./pageCoordinateTracker";

import type {
  AoiProbePayload,
  CalibrationPointResultPayload,
  QuickRecalibrationStartedPayload,
  StartCalibrationPayload,
  StartQuickRecalibrationPayload,
  StartQuickValidationPayload,
  StartValidationPayload,
  ValidationPointResultPayload
} from "../shared/messages";

import type {
  CalibrationMode,
  CalibrationTarget,
  PreCalibrationFeedback,
  ScrollEventRecord
} from "../shared/types";

/* ========================================================================== 
 * Runtime guards
 * ======================================================================== */

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
  if (
    !isRecord(value)
    || !isRecord(value.status)
    || typeof value.instruction
      !== "string"
    || !FACE_POSITION_INSTRUCTION_VALUES
      .has(value.instruction)
    || typeof value.readyForCalibration
      !== "boolean"
    || !isRecord(value.metrics)
  ) {
    return false;
  }

  const status =
    value.status;

  const validStatus =
    typeof status.faceDetected === "boolean"
    && typeof status.bothEyesVisible === "boolean"
    && typeof status.horizontallyCentered === "boolean"
    && typeof status.verticallyCentered === "boolean"
    && typeof status.distanceAcceptable === "boolean"
    && typeof status.headPoseAcceptable === "boolean"
    && typeof status.brightnessAcceptable === "boolean"
    && typeof status.stable === "boolean";

  if (!validStatus) {
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
    && isFiniteNumber(
      metrics.stableProgress
    )
  );
}

function isCalibrationMode(
  value: unknown
): value is CalibrationMode {
  return (
    value === "STANDARD_17"
    || value === "PRECISION_25"
  );
}

function isNullablePoint2D(
  value: unknown
): boolean {
  return (
    value === null
    || (
      isRecord(value)
      && isFiniteNumber(value.x)
      && isFiniteNumber(value.y)
    )
  );
}

function isCompletedFixationSnapshotPayload(
  value: unknown
): boolean {
  if (value === null) {
    return true;
  }

  if (
    !isRecord(value)
    || !isRecord(value.event)
    || !isFiniteNumber(value.peakSpeedPxPerSecond)
  ) {
    return false;
  }

  const event = value.event;
  return (
    typeof event.fixationId === "string"
    && typeof event.sessionId === "string"
    && typeof event.pageId === "string"
    && isFiniteNumber(event.startTimeMs)
    && isFiniteNumber(event.endTimeMs)
    && isFiniteNumber(event.durationMs)
    && isRecord(event.centroidViewportPoint)
    && isFiniteNumber(event.centroidViewportPoint.x)
    && isFiniteNumber(event.centroidViewportPoint.y)
    && isFiniteNumber(event.dispersionX)
    && isFiniteNumber(event.dispersionY)
    && isFiniteNumber(event.dispersionPx)
    && Number.isInteger(event.sampleCount)
    && isFiniteNumber(event.qualityMean)
  );
}

function isAoiProbePayload(
  value: unknown
): value is AoiProbePayload {
  return (
    isRecord(value)
    && isFiniteNumber(value.timestampMs)
    && isRecord(value.normalizedPoint)
    && isFiniteNumber(value.normalizedPoint.x)
    && isFiniteNumber(value.normalizedPoint.y)
    && isRecord(value.viewportPoint)
    && isFiniteNumber(value.viewportPoint.x)
    && isFiniteNumber(value.viewportPoint.y)
    && (
      value.pointSource === "STABILIZED_GAZE"
      || value.pointSource === "FIXATION_CENTROID"
    )
    && isFiniteNumber(value.gazeQuality)
    && value.gazeQuality >= 0
    && value.gazeQuality <= 1
    && (
      value.fixationId === null
      || typeof value.fixationId === "string"
    )
    && typeof value.degradedCollection === "boolean"
    && isNullablePoint2D(value.rawPredictionNormalizedPoint)
    && isNullablePoint2D(value.authoritativeNormalizedPoint)
    && isNullablePoint2D(value.stabilizedNormalizedPoint)
    && isCompletedFixationSnapshotPayload(value.completedFixation)
  );
}

function isCalibrationTarget(
  value: unknown
): value is CalibrationTarget {
  if (
    !isRecord(value)
    || !Number.isInteger(value.pointIndex)
    || !isRecord(value.normalizedPoint)
    || !isRecord(value.viewportPoint)
  ) {
    return false;
  }

  return (
    isFiniteNumber(value.normalizedPoint.x)
    && isFiniteNumber(value.normalizedPoint.y)
    && isFiniteNumber(value.viewportPoint.x)
    && isFiniteNumber(value.viewportPoint.y)
  );
}

function isStartCalibrationPayload(
  value: unknown
): value is StartCalibrationPayload {
  return (
    isRecord(value)
    && typeof value.calibrationId
      === "string"
    && value.calibrationId.length > 0
    && isCalibrationMode(
      value.mode
    )
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
  value: unknown
): value is CalibrationPointResultPayload {
  if (!isRecord(value)) {
    return false;
  }

  const failureReason =
    value.failureReason;

  return (
    typeof value.calibrationId
      === "string"
    && isFiniteNumber(
      value.pointIndex
    )
    && Number.isInteger(
      value.pointIndex
    )
    && typeof value.sufficient
      === "boolean"
    && isFiniteNumber(
      value.acceptedSampleCount
    )
    && isFiniteNumber(
      value.rejectedSampleCount
    )
    && isFiniteNumber(
      value.rejectionRatio
    )
    && isFiniteNumber(
      value.completedPointCount
    )
    && isFiniteNumber(
      value.expectedPointCount
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
    && typeof value.modelReady
      === "boolean"
    && (
      value.trainingRmseNormalized
        === null
      || isFiniteNumber(
        value.trainingRmseNormalized
      )
    )
    && (
      value.trainingDiagnostics === null
      || isCalibrationTrainingDiagnostics(
        value.trainingDiagnostics
      )
    )
    && Array.isArray(value.adaptiveExpansionTargets)
    && value.adaptiveExpansionTargets.every(
      (target) => isCalibrationTarget(target)
    )
  );
}

function isStartValidationPayload(
  value: unknown
): value is StartValidationPayload {
  return (
    isRecord(value)
    && typeof value.calibrationId
      === "string"
    && value.calibrationId.length > 0
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
  );
}

function isValidationMetrics(
  value: unknown
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return [
    value.viewportWidthPx,
    value.viewportHeightPx,
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
  ].every(
    (metric) =>
      isFiniteNumber(metric)
      && metric >= 0
  )
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
    && value.validSampleRatio <= 1;
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
      value.correctedViewportPoint
    )
    && isFiniteNumber(value.errorXPx)
    && isFiniteNumber(value.errorYPx)
    && isFiniteNumber(value.errorPx)
    && value.errorPx >= 0
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
  value: unknown
): value is ValidationPointResultPayload {
  if (!isRecord(value)) {
    return false;
  }

  const failureReason =
    value.failureReason;

  const qualityValid =
    value.quality === null
    || value.quality === "GOOD"
    || value.quality === "ACCEPTABLE"
    || value.quality === "POOR"
    || value.quality === "FAIL";

  const metricsValid =
    value.metrics === null
    || isValidationMetrics(
      value.metrics
    );

  const selectedStrategyValidation =
    value.selectedStrategyValidation;

  const selectedStrategyValidationValid =
    selectedStrategyValidation === null
    || (
      isRecord(selectedStrategyValidation)
      && (
        selectedStrategyValidation.strategy === "BASELINE_ONLY"
        || selectedStrategyValidation.strategy === "DEEP_ONLY"
        || selectedStrategyValidation.strategy === "SAFE_ADAPTIVE_HYBRID"
      )
      && isValidationMetrics(
        selectedStrategyValidation.metrics
      )
      && (
        selectedStrategyValidation.quality === "GOOD"
        || selectedStrategyValidation.quality === "ACCEPTABLE"
        || selectedStrategyValidation.quality === "POOR"
        || selectedStrategyValidation.quality === "FAIL"
      )
    );

  const pointResultsValid =
    value.pointResults === null
    || (
      Array.isArray(value.pointResults)
      && value.pointResults.every(
        isCalibrationPointDiagnostic
      )
    );

  return (
    typeof value.calibrationId
      === "string"
    && isCalibrationCorrectionStrategy(
      value.correctionStrategy
    )
    && isFiniteNumber(
      value.pointIndex
    )
    && Number.isInteger(
      value.pointIndex
    )
    && typeof value.sufficient
      === "boolean"
    && isFiniteNumber(
      value.acceptedSampleCount
    )
    && isFiniteNumber(
      value.rejectedSampleCount
    )
    && isFiniteNumber(
      value.rejectionRatio
    )
    && isFiniteNumber(
      value.completedPointCount
    )
    && isFiniteNumber(
      value.expectedPointCount
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
    && typeof value.validationComplete
      === "boolean"
    && qualityValid
    && metricsValid
    && selectedStrategyValidationValid
    && pointResultsValid
    && (
      value.validationComplete
        ? value.metrics !== null
          && value.quality !== null
          && value.pointResults !== null
        : value.metrics === null
          && value.quality === null
          && value.selectedStrategyValidation === null
          && value.pointResults === null
    )
  );
}

/* ==========================================================================
 * D26 live CSS viewport synchronization
 * ======================================================================== */

interface ResearchViewportMessageContext {
  readonly sessionId: string;
  readonly pageId: string;
  readonly tabId: number;
  readonly browserFrameId: number;
}

let latestResearchViewportContext:
  ResearchViewportMessageContext | null = null;

let lastViewportSyncSignature:
  string | null = null;

function clearResearchViewportSync(): void {
  latestResearchViewportContext = null;
  lastViewportSyncSignature = null;
}

function reportViewportContextIfChanged(
  context: ResearchViewportMessageContext
): void {
  latestResearchViewportContext = { ...context };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const devicePixelRatio = window.devicePixelRatio;

  if (
    !Number.isFinite(viewportWidth)
    || viewportWidth <= 0
    || !Number.isFinite(viewportHeight)
    || viewportHeight <= 0
    || !Number.isFinite(devicePixelRatio)
    || devicePixelRatio <= 0
  ) {
    return;
  }

  const signature = [
    context.sessionId,
    context.pageId,
    context.tabId,
    context.browserFrameId,
    viewportWidth,
    viewportHeight,
    devicePixelRatio
  ].join("::");

  if (signature === lastViewportSyncSignature) {
    return;
  }

  lastViewportSyncSignature = signature;

  const message = createRuntimeMessage(
    MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "CONTENT",
      target: "BACKGROUND",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId
    },
    {
      viewportWidth,
      viewportHeight,
      devicePixelRatio
    }
  );

  void chrome.runtime.sendMessage(message).catch(() => {
    // A transient viewport-sync failure must not stop local gaze remapping.
  });
}

function reportLatestViewportContext(): void {
  if (latestResearchViewportContext === null) {
    return;
  }

  reportViewportContextIfChanged(
    latestResearchViewportContext
  );
}

/* ==========================================================================
 * D23 DOM/AOI probe handling
 * ======================================================================== */

async function handleAoiProbe(
  resolver: DomAoiResolver,
  coordinateTracker: PageCoordinateTracker,
  meta: {
    readonly sessionId: string;
    readonly pageId: string;
    readonly tabId: number;
    readonly browserFrameId: number;
  },
  payload: AoiProbePayload
): Promise<void> {
  coordinateTracker.activate(meta);
  reportViewportContextIfChanged(meta);

  const currentViewportPoint =
    remapNormalizedPointToViewport(
      payload.normalizedPoint,
      window.innerWidth,
      window.innerHeight
    );

  const coordinates =
    coordinateTracker.capture(
      currentViewportPoint
    );

  const stabilizedGazeViewportPoint =
    payload.stabilizedNormalizedPoint === null
      ? null
      : remapNormalizedPointToViewport(
          payload.stabilizedNormalizedPoint,
          window.innerWidth,
          window.innerHeight
        );

  const gazeCoordinates =
    stabilizedGazeViewportPoint === null
      ? null
      : coordinateTracker.capture(
          stabilizedGazeViewportPoint
        );

  const resolution = await resolver.resolve(
    payload.timestampMs,
    currentViewportPoint
  );

  if (
    resolution.upserted.length > 0
    || resolution.removedAoiIds.length > 0
  ) {
    const registryMessage = createRuntimeMessage(
      MESSAGE_TYPES.AOI_REGISTRY_UPDATE,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: meta.sessionId,
        pageId: meta.pageId,
        tabId: meta.tabId,
        browserFrameId: meta.browserFrameId
      },
      {
        pageId: meta.pageId,
        browserFrameId: meta.browserFrameId,
        upserted: resolution.upserted,
        removedAoiIds: resolution.removedAoiIds,
        fullSnapshot: false
      }
    );

    await chrome.runtime.sendMessage(registryMessage);
  }

  const hitMessage = createRuntimeMessage(
    MESSAGE_TYPES.AOI_HIT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "CONTENT",
      target: "BACKGROUND",
      sessionId: meta.sessionId,
      pageId: meta.pageId,
      tabId: meta.tabId,
      browserFrameId: meta.browserFrameId
    },
    {
      pageId: meta.pageId,
      browserFrameId: meta.browserFrameId,
      fixationId: payload.fixationId,
      pointSource: payload.pointSource,
      gazeQuality: payload.gazeQuality,
      degradedCollection: payload.degradedCollection,
      probeNormalizedPoint: {
        ...payload.normalizedPoint
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
      completedFixation:
        payload.completedFixation === null
          ? null
          : {
              event: {
                ...payload.completedFixation.event,
                centroidViewportPoint: {
                  ...currentViewportPoint
                }
              },
              peakSpeedPxPerSecond:
                payload.completedFixation
                  .peakSpeedPxPerSecond
            },
      coordinates,
      gazeCoordinates,
      hit: resolution.hit
    }
  );

  await chrome.runtime.sendMessage(hitMessage);
}

/* ========================================================================== 
 * Calibration message helpers
 * ======================================================================== */

interface CalibrationMessageContext {
  readonly sessionId: string;
  readonly pageId: string | null;
  readonly tabId: number;
}

function waitForNextPaint():
Promise<void> {
  return new Promise<void>(
    (resolve) => {
      window.requestAnimationFrame(
        () => {
          resolve();
        }
      );
    }
  );
}

async function sendCalibrationPoint(
  context: CalibrationMessageContext,
  calibrationId: string,
  target: CalibrationTarget,
  targetShownAtMs: number,
  attempt: number
): Promise<CalibrationPointResultPayload> {
  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.CALIBRATION_POINT,
      {
        messageId:
          createMessageId(),
        sentAtEpochMs:
          nowEpochMs(),
        source:
          "CONTENT",
        target:
          "BACKGROUND",
        sessionId:
          context.sessionId,
        pageId:
          context.pageId,
        tabId:
          context.tabId,
        browserFrameId: 0
      },
      {
        calibrationId,
        target,
        targetShownAtMs,
        attempt
      }
    );

  const rawResult: unknown =
    await chrome.runtime
      .sendMessage(message);

  if (
    !isRecord(rawResult)
    || rawResult.ok !== true
    || rawResult.handled !== true
    || !isRecord(rawResult.response)
  ) {
    const messageText =
      isRecord(rawResult)
      && isRecord(rawResult.error)
      && typeof rawResult.error.message
        === "string"
        ? rawResult.error.message
        : "Calibration point request failed.";

    throw new Error(messageText);
  }

  const response =
    rawResult.response;

  if (
    !isCompatibleMessageProtocol(
      response.protocolVersion
    )
    || response.type
      !== MESSAGE_TYPES.CALIBRATION_POINT_RESULT
    || !isRecord(response.meta)
    || response.meta.source
      !== "BACKGROUND"
    || response.meta.target
      !== "CONTENT"
    || !isCalibrationPointResultPayload(
      response.payload
    )
  ) {
    throw new Error(
      "Calibration point response was invalid."
    );
  }

  return {
    ...response.payload
  };
}

async function startValidation(
  context: CalibrationMessageContext,
  calibrationId: string,
  viewportWidth: number,
  viewportHeight: number,
  expectedPointCount: number
): Promise<StartValidationPayload> {
  const payload: StartValidationPayload = {
    calibrationId,
    viewportWidth,
    viewportHeight,
    expectedPointCount
  };

  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.START_VALIDATION,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: 0
      },
      payload
    );

  const rawResult: unknown =
    await chrome.runtime
      .sendMessage(message);

  if (
    !isRecord(rawResult)
    || rawResult.ok !== true
    || rawResult.handled !== true
    || !isRecord(rawResult.response)
  ) {
    const messageText =
      isRecord(rawResult)
      && isRecord(rawResult.error)
      && typeof rawResult.error.message
        === "string"
        ? rawResult.error.message
        : "Validation startup failed.";

    throw new Error(messageText);
  }

  const response =
    rawResult.response;

  if (
    !isCompatibleMessageProtocol(
      response.protocolVersion
    )
    || response.type
      !== MESSAGE_TYPES.START_VALIDATION
    || !isRecord(response.meta)
    || response.meta.source
      !== "BACKGROUND"
    || response.meta.target
      !== "CONTENT"
    || !isStartValidationPayload(
      response.payload
    )
  ) {
    throw new Error(
      "Validation startup response was invalid."
    );
  }

  return {
    ...response.payload
  };
}

async function sendValidationPoint(
  context: CalibrationMessageContext,
  calibrationId: string,
  target: CalibrationTarget,
  targetShownAtMs: number,
  attempt: number
): Promise<ValidationPointResultPayload> {
  const message =
    createRuntimeMessage(
      MESSAGE_TYPES.VALIDATION_POINT,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: 0
      },
      {
        calibrationId,
        target,
        targetShownAtMs,
        attempt
      }
    );

  const rawResult: unknown =
    await chrome.runtime
      .sendMessage(message);

  if (
    !isRecord(rawResult)
    || rawResult.ok !== true
    || rawResult.handled !== true
    || !isRecord(rawResult.response)
  ) {
    const messageText =
      isRecord(rawResult)
      && isRecord(rawResult.error)
      && typeof rawResult.error.message
        === "string"
        ? rawResult.error.message
        : "Validation point request failed.";

    throw new Error(messageText);
  }

  const response =
    rawResult.response;

  if (
    !isCompatibleMessageProtocol(
      response.protocolVersion
    )
    || response.type
      !== MESSAGE_TYPES.VALIDATION_POINT_RESULT
    || !isRecord(response.meta)
    || response.meta.source
      !== "BACKGROUND"
    || response.meta.target
      !== "CONTENT"
    || !isValidationPointResultPayload(
      response.payload
    )
  ) {
    throw new Error(
      "Validation point response was invalid."
    );
  }

  return {
    ...response.payload,
    metrics:
      response.payload.metrics === null
        ? null
        : {
            ...response.payload.metrics
          }
  };
}

/* ========================================================================== 
 * Main-frame UI runtime
 * ======================================================================== */

if (window.top === window) {
  const preCalibrationOverlay =
    new PreCalibrationOverlay();

  const calibrationOverlay =
    new CalibrationOverlay();

  const gazeOverlay =
    new GazeOverlay();

  let activePreCalibrationSessionId:
    string | null =
      null;

  let preCalibrationCompleted =
    false;

  let completionHideTimerId:
    number | null =
      null;

  let calibrationGeneration = 0;

  let activeCalibrationId:
    string | null =
      null;

  let quickRecalibrationInFlight = false;
  let quickRecalibrationFailureCount = 0;
  const quickRecalibrationStartedAtMs: number[] = [];

  let automaticQuickRecalibrationEnabled: boolean =
    QUICK_RECALIBRATION.DEFAULT_ENABLED;

  const handleQuickRecalibrationPreferenceChanged = (
    changes: {
      [key: string]: chrome.storage.StorageChange;
    },
    areaName: string
  ): void => {
    if (
      areaName !== "local"
      || !(QUICK_RECALIBRATION.STORAGE_KEY in changes)
    ) {
      return;
    }

    const value =
      changes[QUICK_RECALIBRATION.STORAGE_KEY]
        ?.newValue;

    automaticQuickRecalibrationEnabled =
      typeof value === "boolean"
        ? value
        : QUICK_RECALIBRATION.DEFAULT_ENABLED;
  };

  chrome.storage.onChanged.addListener(
    handleQuickRecalibrationPreferenceChanged
  );

  void chrome.storage.local.get(
    QUICK_RECALIBRATION.STORAGE_KEY
  ).then((stored) => {
    const value =
      stored[QUICK_RECALIBRATION.STORAGE_KEY];

    automaticQuickRecalibrationEnabled =
      typeof value === "boolean"
        ? value
        : QUICK_RECALIBRATION.DEFAULT_ENABLED;
  }).catch(() => {
    automaticQuickRecalibrationEnabled =
      QUICK_RECALIBRATION.DEFAULT_ENABLED;
  });

  window.addEventListener(
    "pagehide",
    () => {
      chrome.storage.onChanged.removeListener(
        handleQuickRecalibrationPreferenceChanged
      );
    },
    { once: true }
  );

  let aoiResolver:
    DomAoiResolver | null =
      null;

  let aoiResolverPageId:
    string | null =
      null;

  let aoiResolverFrameId:
    number | null =
      null;

  let aoiProbeInFlight =
    false;

  let aoiProbeGeneration = 0;

  interface PendingAoiProbeRequest {
    readonly context: ResearchViewportMessageContext;
    readonly payload: AoiProbePayload;
  }

  const pendingFixationCompletionProbes:
    PendingAoiProbeRequest[] = [];

  const pageCoordinateTracker =
    new PageCoordinateTracker(
      (event: ScrollEventRecord) => {
        const message = createRuntimeMessage(
          MESSAGE_TYPES.SCROLL_EVENT,
          {
            messageId: createMessageId(),
            sentAtEpochMs: nowEpochMs(),
            source: "CONTENT",
            target: "BACKGROUND",
            sessionId: event.sessionId,
            pageId: event.pageId,
            tabId: event.tabId,
            browserFrameId:
              event.browserFrameId
          },
          {
            event
          }
        );

        void chrome.runtime
          .sendMessage(message)
          .catch(() => {
            /**
             * Scroll telemetry is derived research data. A transient message
             * failure must not stop the gaze/calibration runtime.
             */
          });
      }
    );

  window.addEventListener(
    "resize",
    reportLatestViewportContext,
    { passive: true }
  );

  window.visualViewport?.addEventListener(
    "resize",
    reportLatestViewportContext,
    { passive: true }
  );

  async function startQuickRecalibration(
    context: CalibrationMessageContext,
    calibrationId: string,
    viewportWidth: number,
    viewportHeight: number
  ): Promise<QuickRecalibrationStartedPayload> {
    const payload: StartQuickRecalibrationPayload = {
      calibrationId,
      viewportWidth,
      viewportHeight,
      pointCount: DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
    };
    const message = createRuntimeMessage(
      MESSAGE_TYPES.START_QUICK_RECALIBRATION,
      {
        messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
        source: "CONTENT", target: "BACKGROUND",
        sessionId: context.sessionId, pageId: context.pageId,
        tabId: context.tabId, browserFrameId: 0
      },
      payload
    );
    const rawResult: unknown = await chrome.runtime.sendMessage(message);
    if (
      !isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true
      || !isRecord(rawResult.response)
    ) {
      throw new Error("Quick recalibration startup failed.");
    }
    const response = rawResult.response;
    if (
      !isCompatibleMessageProtocol(response.protocolVersion)
      || response.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED
      || !isRecord(response.payload)
      || response.payload.calibrationId !== calibrationId
      || !isFiniteNumber(response.payload.startingPointIndex)
      || !Number.isInteger(response.payload.startingPointIndex)
      || !isFiniteNumber(response.payload.expectedPointCount)
      || !Number.isInteger(response.payload.expectedPointCount)
      || response.payload.pointCount !== DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
      || typeof response.payload.runId !== "string" || response.payload.runId.length === 0
    ) {
      throw new Error("Quick recalibration startup response was invalid.");
    }
    return {
      calibrationId,
      startingPointIndex: response.payload.startingPointIndex,
      expectedPointCount: response.payload.expectedPointCount,
      pointCount: response.payload.pointCount,
      runId: response.payload.runId
    };
  }

  async function sendQuickRecalibrationPoint(
    context: CalibrationMessageContext,
    runId: string,
    calibrationId: string,
    target: CalibrationTarget,
    targetShownAtMs: number,
    attempt: number
  ): Promise<CalibrationPointResultPayload> {
    const message = createRuntimeMessage(
      MESSAGE_TYPES.QUICK_RECALIBRATION_POINT,
      {
        messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
        source: "CONTENT", target: "BACKGROUND",
        sessionId: context.sessionId, pageId: context.pageId,
        tabId: context.tabId, browserFrameId: 0
      },
      { calibrationId, runId, target, targetShownAtMs, attempt }
    );
    const rawResult: unknown = await chrome.runtime.sendMessage(message);
    if (
      !isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true
      || !isRecord(rawResult.response)
    ) {
      throw new Error("Quick recalibration point request failed.");
    }
    const response = rawResult.response;
    if (
      !isCompatibleMessageProtocol(response.protocolVersion)
      || response.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT
      || !isCalibrationPointResultPayload(response.payload)
    ) {
      throw new Error("Quick recalibration point response was invalid.");
    }
    return { ...response.payload };
  }

  async function startQuickValidation(
    context: CalibrationMessageContext,
    runId: string,
    calibrationId: string,
    viewportWidth: number,
    viewportHeight: number
  ): Promise<void> {
    const payload: StartQuickValidationPayload = {
      calibrationId,
      runId,
      viewportWidth,
      viewportHeight,
      expectedPointCount: DRIFT_THRESHOLDS.QUICK_REVALIDATION_POINT_COUNT
    };
    const message = createRuntimeMessage(
      MESSAGE_TYPES.START_QUICK_VALIDATION,
      {
        messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
        source: "CONTENT", target: "BACKGROUND",
        sessionId: context.sessionId, pageId: context.pageId,
        tabId: context.tabId, browserFrameId: 0
      },
      payload
    );
    const rawResult: unknown = await chrome.runtime.sendMessage(message);
    if (
      !isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true
      || !isRecord(rawResult.response)
      || rawResult.response.type !== MESSAGE_TYPES.START_QUICK_VALIDATION
    ) {
      throw new Error("Quick validation startup failed.");
    }
  }

  async function sendQuickValidationPoint(
    context: CalibrationMessageContext,
    runId: string,
    calibrationId: string,
    target: CalibrationTarget,
    targetShownAtMs: number,
    attempt: number
  ): Promise<ValidationPointResultPayload> {
    const message = createRuntimeMessage(
      MESSAGE_TYPES.QUICK_VALIDATION_POINT,
      {
        messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
        source: "CONTENT", target: "BACKGROUND",
        sessionId: context.sessionId, pageId: context.pageId,
        tabId: context.tabId, browserFrameId: 0
      },
      { calibrationId, runId, target, targetShownAtMs, attempt }
    );
    const rawResult: unknown = await chrome.runtime.sendMessage(message);
    if (
      !isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true
      || !isRecord(rawResult.response)
    ) {
      throw new Error("Quick validation point request failed.");
    }
    const response = rawResult.response;
    if (
      !isCompatibleMessageProtocol(response.protocolVersion)
      || response.type !== MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT
      || !isValidationPointResultPayload(response.payload)
    ) {
      throw new Error("Quick validation point response was invalid.");
    }
    return {
      ...response.payload,
      metrics: response.payload.metrics === null ? null : { ...response.payload.metrics }
    };
  }

  async function requestFullRecalibration(
    context: CalibrationMessageContext,
    reason: string
  ): Promise<void> {
    calibrationGeneration += 1;
    activeCalibrationId = null;
    quickRecalibrationInFlight = false;
    quickRecalibrationFailureCount = 0;
    quickRecalibrationStartedAtMs.length = 0;

    calibrationOverlay.showError(
      `빠른 재보정으로 정확도를 회복하지 못해 전체 보정을 다시 시작합니다. (${reason})`
    );
    await sleep(900);

    const message = createRuntimeMessage(
      MESSAGE_TYPES.START_FACE_POSITIONING,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: 0
      },
      {}
    );
    const rawResult: unknown = await chrome.runtime.sendMessage(message);
    if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true) {
      throw new Error("Full recalibration escalation could not restart face positioning.");
    }
  }

  async function abortQuickRecalibration(
    context: CalibrationMessageContext,
    calibrationId: string,
    runId: string
  ): Promise<void> {
    const message = createRuntimeMessage(
      MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
      { messageId: createMessageId(), sentAtEpochMs: nowEpochMs(),
        source: "CONTENT", target: "BACKGROUND",
        sessionId: context.sessionId, pageId: context.pageId,
        tabId: context.tabId, browserFrameId: 0 },
      { calibrationId, runId }
    );
    const result: unknown = await chrome.runtime.sendMessage(message);
    if (!isRecord(result) || result.ok !== true || result.handled !== true) {
      throw new Error("Quick rollback request could not be delivered.");
    }
  }

  async function runQuickRecalibration(
    calibrationId: string,
    context: CalibrationMessageContext,
    generation: number
  ): Promise<void> {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    calibrationOverlay.showQuickRecalibrationPreparing(
      DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
    );

    const started = await startQuickRecalibration(
      context, calibrationId, viewport.width, viewport.height
    );
    const targets = createQuickRecalibrationPattern(
      viewport, started.startingPointIndex
    );

    try {
    await sleep(CALIBRATION.UI_START_DELAY_MS);
    let lastResult: CalibrationPointResultPayload | null = null;

    for (let localIndex = 0; localIndex < targets.length; localIndex += 1) {
      const target = targets[localIndex];
      if (target === undefined) continue;
      if (generation !== calibrationGeneration || activeCalibrationId !== calibrationId) {
        throw new Error("Quick recalibration was cancelled by a newer context.");
      }

      let completed = false;
      for (let attempt = 1; attempt <= CALIBRATION.MAX_POINT_ATTEMPTS; attempt += 1) {
        calibrationOverlay.showQuickRecalibrationTarget(
          target, localIndex, targets.length, attempt
        );
        await waitForNextPaint();
        const result = await sendQuickRecalibrationPoint(
          context, started.runId, calibrationId, target, nowTimelineMs(), attempt
        );
        lastResult = result;
        if (result.sufficient) { completed = true; break; }
        if (attempt < CALIBRATION.MAX_POINT_ATTEMPTS) {
          calibrationOverlay.showRetrying();
          await sleep(CALIBRATION.POINT_RETRY_PAUSE_MS);
        }
      }
      if (!completed) {
        throw new Error(`Quick recalibration point ${localIndex + 1} failed.`);
      }
    }

    if (generation !== calibrationGeneration || activeCalibrationId !== calibrationId) {
      throw new Error("Quick recalibration context changed before validation.");
    }
    if (lastResult === null || !lastResult.modelReady) {
      throw new Error("Quick recalibration finished without a refitted model.");
    }

    const validationTargets = createQuickValidationPattern(viewport);
    calibrationOverlay.showQuickValidationPreparing(validationTargets.length);
    await startQuickValidation(
      context, started.runId, calibrationId, viewport.width, viewport.height
    );
    await sleep(300);

    let finalValidation: ValidationPointResultPayload | null = null;
    for (const target of validationTargets) {
      let completed = false;
      for (let attempt = 1; attempt <= CALIBRATION.MAX_POINT_ATTEMPTS; attempt += 1) {
        calibrationOverlay.showQuickValidationTarget(
          target, target.pointIndex, validationTargets.length, attempt
        );
        await waitForNextPaint();
        const result = await sendQuickValidationPoint(
          context, started.runId, calibrationId, target, nowTimelineMs(), attempt
        );
        finalValidation = result;
        if (result.sufficient) { completed = true; break; }
        if (attempt < CALIBRATION.MAX_POINT_ATTEMPTS) {
          calibrationOverlay.showRetrying();
          await sleep(CALIBRATION.POINT_RETRY_PAUSE_MS);
        }
      }
      if (!completed) throw new Error("Quick validation could not collect enough valid gaze samples.");
    }

    if (
      finalValidation === null
      || !finalValidation.validationComplete
      || finalValidation.metrics === null
      || finalValidation.quality === null
    ) {
      throw new Error("Quick validation finished without a final quality result.");
    }

    const readinessQuality = finalValidation.selectedStrategyValidation?.quality
      ?? finalValidation.quality;
    const readinessMetrics = finalValidation.selectedStrategyValidation?.metrics
      ?? finalValidation.metrics;
    calibrationOverlay.showQuickValidationCompleted(readinessQuality, readinessMetrics);
    const quickValidationPassed =
      readinessQuality === "GOOD" || readinessQuality === "ACCEPTABLE";
    await sleep(
      quickValidationPassed
        ? 1_200
        : CALIBRATION.DEGRADED_COLLECTION_WARNING_MS
    );
    if (!quickValidationPassed) {
      throw new Error(`Quick re-validation quality remained ${readinessQuality}.`);
    }
    quickRecalibrationFailureCount = 0;
    if (generation === calibrationGeneration && activeCalibrationId === calibrationId) {
      calibrationOverlay.hide();
    }
    } catch (error: unknown) {
      try {
        await abortQuickRecalibration(context, calibrationId, started.runId);
      } catch (rollbackError: unknown) {
        throw new Error(`Quick recalibration failed and rollback was not confirmed: ${
          rollbackError instanceof Error ? rollbackError.message : "unknown error"
        }`, { cause: error });
      }
      throw error;
    }
  }

  async function runValidation(
    calibrationId: string,
    context: CalibrationMessageContext,
    generation: number
  ): Promise<void> {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    const targets =
      createCalibrationValidationPattern(
        viewport
      );

    calibrationOverlay
      .showValidationPreparing(
        targets.length
      );

    await startValidation(
      context,
      calibrationId,
      viewport.width,
      viewport.height,
      targets.length
    );

    await sleep(
      CALIBRATION.UI_START_DELAY_MS
    );

    let finalResult:
      ValidationPointResultPayload | null =
        null;

    for (const target of targets) {
      if (
        generation
        !== calibrationGeneration
        || activeCalibrationId
          !== calibrationId
      ) {
        return;
      }

      let pointCompleted = false;

      for (
        let attempt = 1;
        attempt
          <= CALIBRATION.MAX_POINT_ATTEMPTS;
        attempt += 1
      ) {
        calibrationOverlay
          .showValidationTarget(
            target,
            target.pointIndex,
            targets.length,
            attempt
          );

        await waitForNextPaint();

        const targetShownAtMs =
          nowTimelineMs();

        const result =
          await sendValidationPoint(
            context,
            calibrationId,
            target,
            targetShownAtMs,
            attempt
          );

        finalResult = result;

        if (result.sufficient) {
          pointCompleted = true;
          break;
        }

        if (
          attempt
          < CALIBRATION.MAX_POINT_ATTEMPTS
        ) {
          calibrationOverlay
            .showRetrying();

          await sleep(
            CALIBRATION
              .POINT_RETRY_PAUSE_MS
          );
        }
      }

      if (!pointCompleted) {
        throw new Error(
          `Validation point ${target.pointIndex + 1} could not collect enough valid gaze samples.`
        );
      }
    }

    if (
      finalResult === null
      || !finalResult.validationComplete
      || finalResult.metrics === null
      || finalResult.quality === null
    ) {
      throw new Error(
        "Validation targets finished but no final validation result was produced."
      );
    }

    const readinessResult =
      finalResult.selectedStrategyValidation;

    const readinessQuality =
      readinessResult?.quality
      ?? finalResult.quality;
    const readinessMetrics =
      readinessResult?.metrics
      ?? finalResult.metrics;

    calibrationOverlay
      .showValidationCompleted(
        readinessQuality,
        readinessMetrics
      );

    const passed =
      readinessResult !== null
      && (
        readinessQuality === "GOOD"
        || readinessQuality === "ACCEPTABLE"
      );

    const degradedCollectionAllowed =
      readinessResult !== null
      && readinessQuality === "POOR";

    if (passed || degradedCollectionAllowed) {
      await sleep(
        passed
          ? 1_400
          : CALIBRATION.DEGRADED_COLLECTION_WARNING_MS
      );

      if (
        generation
          === calibrationGeneration
        && activeCalibrationId
          === calibrationId
      ) {
        calibrationOverlay.hide();
      }
    }
  }

  async function runCalibration(
    payload: StartCalibrationPayload,
    context: CalibrationMessageContext,
    generation: number
  ): Promise<void> {
    const viewport = {
      width:
        window.innerWidth,
      height:
        window.innerHeight
    };

    const targets = [
      ...createCalibrationPattern(
        payload.mode,
        viewport
      )
    ];

    calibrationOverlay.showPreparing(
      targets.length
    );

    await sleep(
      CALIBRATION.UI_START_DELAY_MS
    );

    let lastResult:
      CalibrationPointResultPayload | null =
        null;

    for (const target of targets) {
      if (
        generation
        !== calibrationGeneration
        || activeCalibrationId
          !== payload.calibrationId
      ) {
        return;
      }

      let pointCompleted = false;

      for (
        let attempt = 1;
        attempt
          <= CALIBRATION.MAX_POINT_ATTEMPTS;
        attempt += 1
      ) {
        calibrationOverlay.showTarget(
          target,
          target.pointIndex,
          targets.length,
          attempt
        );

        await waitForNextPaint();

        const targetShownAtMs =
          nowTimelineMs();

        const result =
          await sendCalibrationPoint(
            context,
            payload.calibrationId,
            target,
            targetShownAtMs,
            attempt
          );

        lastResult = result;

        if (result.sufficient) {
          pointCompleted = true;

          if (result.adaptiveExpansionTargets.length > 0) {
            targets.push(
              ...result.adaptiveExpansionTargets
            );

            calibrationOverlay.showAdaptiveExpansion(
              result.completedPointCount,
              result.expectedPointCount,
              result.adaptiveExpansionTargets.length
            );

            await sleep(700);
          }

          break;
        }

        if (
          attempt
          < CALIBRATION.MAX_POINT_ATTEMPTS
        ) {
          calibrationOverlay
            .showRetrying();

          await sleep(
            CALIBRATION
              .POINT_RETRY_PAUSE_MS
          );
        }
      }

      if (!pointCompleted) {
        const reason =
          lastResult?.failureReason
          ?? "INSUFFICIENT_SAMPLES";


        const reasonText =
          reason === "UNSTABLE_GAZE"
            ? "gaze/head position was not stable enough"
            : reason === "OUTLIER_REJECTION"
              ? "too many samples were removed as outliers"
              : "not enough valid gaze samples were collected";

        throw new Error(
          `Calibration point ${target.pointIndex + 1} failed: ${reasonText}. `
          + `Accepted ${lastResult?.acceptedSampleCount ?? 0}, `
          + `rejected ${lastResult?.rejectedSampleCount ?? 0}.`
        );
      }
    }

    if (
      lastResult === null
      || !lastResult.modelReady
    ) {
      throw new Error(
        "Calibration targets finished but the residual model was not fitted."
      );
    }

    calibrationOverlay.showCompleted(
      targets.length,
      lastResult.trainingRmseNormalized
    );

    await sleep(700);

    if (
      generation === calibrationGeneration
      && activeCalibrationId
        === payload.calibrationId
    ) {
      await runValidation(
        payload.calibrationId,
        context,
        generation
      );
    }
  }

  function processAoiProbeRequest(
    request: PendingAoiProbeRequest
  ): void {
    if (aoiProbeInFlight) {
      if (request.payload.completedFixation !== null) {
        pendingFixationCompletionProbes.push(request);
      }
      return;
    }

    if (
      aoiResolver === null
      || aoiResolverPageId !== request.context.pageId
      || aoiResolverFrameId !== request.context.browserFrameId
    ) {
      aoiResolver = new DomAoiResolver(
        request.context.pageId,
        request.context.browserFrameId
      );

      aoiResolverPageId = request.context.pageId;
      aoiResolverFrameId = request.context.browserFrameId;
    }

    const resolver = aoiResolver;
    const generation = aoiProbeGeneration;
    aoiProbeInFlight = true;

    void handleAoiProbe(
      resolver,
      pageCoordinateTracker,
      request.context,
      request.payload
    ).catch(() => {
      /**
       * AOI resolution is derived research data. A transient DOM/message
       * failure must not stop gaze/calibration runtime collection.
       */
    }).finally(() => {
      if (generation !== aoiProbeGeneration) {
        return;
      }

      aoiProbeInFlight = false;

      const nextCompletion =
        pendingFixationCompletionProbes.shift();

      if (nextCompletion !== undefined) {
        processAoiProbeRequest(nextCompletion);
      }
    });
  }

  chrome.runtime.onMessage.addListener(
    (rawMessage: unknown) => {
      if (!isRecord(rawMessage)) {
        return false;
      }

      if (
        !isCompatibleMessageProtocol(
          rawMessage.protocolVersion
        )
        || !isRecord(rawMessage.meta)
        || rawMessage.meta.target
          !== "CONTENT"
        || rawMessage.meta.source
          !== "BACKGROUND"
      ) {
        return false;
      }

      if (
        rawMessage.type
        === MESSAGE_TYPES.RESET_TRACKER
      ) {
        calibrationGeneration += 1;
        activeCalibrationId = null;
        quickRecalibrationInFlight = false;
        quickRecalibrationFailureCount = 0;
        quickRecalibrationStartedAtMs.length = 0;
        activePreCalibrationSessionId = null;
        preCalibrationCompleted = false;

        if (completionHideTimerId !== null) {
          window.clearTimeout(completionHideTimerId);
          completionHideTimerId = null;
        }

        preCalibrationOverlay.hide();
        calibrationOverlay.hide();
        gazeOverlay.setTemporarilySuppressed(false);
        gazeOverlay.hide();

        aoiProbeGeneration += 1;
        aoiResolver = null;
        aoiResolverPageId = null;
        aoiResolverFrameId = null;
        aoiProbeInFlight = false;
        pendingFixationCompletionProbes.length = 0;

        pageCoordinateTracker.deactivate();
        clearResearchViewportSync();

        return false;
      }

      if (
        rawMessage.type
        === MESSAGE_TYPES.AOI_PROBE
      ) {
        if (quickRecalibrationInFlight) {
          return false;
        }
        if (
          rawMessage.meta.source !== "BACKGROUND"
          || typeof rawMessage.meta.sessionId !== "string"
          || typeof rawMessage.meta.pageId !== "string"
          || !isFiniteNumber(rawMessage.meta.tabId)
          || !isFiniteNumber(rawMessage.meta.browserFrameId)
          || !isAoiProbePayload(rawMessage.payload)
        ) {
          return false;
        }

        gazeOverlay.updateNormalizedPoint(
          rawMessage.payload.stabilizedNormalizedPoint
        );

        processAoiProbeRequest({
          context: {
            sessionId: rawMessage.meta.sessionId,
            pageId: rawMessage.meta.pageId,
            tabId: rawMessage.meta.tabId,
            browserFrameId: rawMessage.meta.browserFrameId
          },
          payload: rawMessage.payload
        });

        return false;
      }

      if (rawMessage.type === MESSAGE_TYPES.DRIFT_STATUS) {
        if (
          !automaticQuickRecalibrationEnabled
          || quickRecalibrationInFlight
          || activeCalibrationId === null
          || !isRecord(rawMessage.payload)
          || !isRecord(rawMessage.payload.status)
          || rawMessage.payload.status.quickRecalibrationRecommended !== true
          || typeof rawMessage.meta.sessionId !== "string"
          || !isFiniteNumber(rawMessage.meta.tabId)
        ) {
          return false;
        }

        const nowMs = nowTimelineMs();
        while (
          quickRecalibrationStartedAtMs.length > 0
          && nowMs - (quickRecalibrationStartedAtMs[0] ?? nowMs)
            > RUNTIME_MAINTENANCE.QUICK_REPEAT_WINDOW_MS
        ) {
          quickRecalibrationStartedAtMs.shift();
        }

        const calibrationId = activeCalibrationId;
        const context: CalibrationMessageContext = {
          sessionId: rawMessage.meta.sessionId,
          pageId: typeof rawMessage.meta.pageId === "string" ? rawMessage.meta.pageId : null,
          tabId: rawMessage.meta.tabId
        };

        if (
          quickRecalibrationFailureCount
            >= RUNTIME_MAINTENANCE.QUICK_FAILURE_LIMIT_BEFORE_FULL_CALIBRATION
          || quickRecalibrationStartedAtMs.length
            >= RUNTIME_MAINTENANCE.QUICK_REPEAT_LIMIT_BEFORE_FULL_CALIBRATION
        ) {
          void requestFullRecalibration(context, "persistent drift").catch(() => {
            calibrationOverlay.showError("전체 재보정을 자동으로 시작하지 못했습니다. Tracker를 다시 초기화해주세요.");
          });
          return false;
        }

        quickRecalibrationStartedAtMs.push(nowMs);
        quickRecalibrationInFlight = true;
        gazeOverlay.setTemporarilySuppressed(true);
        gazeOverlay.hide();
        calibrationGeneration += 1;
        const generation = calibrationGeneration;

        void runQuickRecalibration(calibrationId, context, generation)
          .catch((error: unknown) => {
            if (generation !== calibrationGeneration) return;
            quickRecalibrationFailureCount += 1;
            if (
              quickRecalibrationFailureCount
                >= RUNTIME_MAINTENANCE.QUICK_FAILURE_LIMIT_BEFORE_FULL_CALIBRATION
            ) {
              void requestFullRecalibration(context, "quick recalibration failure").catch(() => {
                calibrationOverlay.showError("전체 재보정을 자동으로 시작하지 못했습니다. Tracker를 다시 초기화해주세요.");
              });
              return;
            }
            calibrationOverlay.showError(
              error instanceof Error
                ? `빠른 재보정 실패: ${error.message}`
                : "빠른 재보정에 실패했습니다."
            );
            window.setTimeout(() => calibrationOverlay.hide(), 2_500);
          })
          .finally(() => {
            if (generation === calibrationGeneration) {
              quickRecalibrationInFlight = false;
              gazeOverlay.setTemporarilySuppressed(false);
            }
          });

        return false;
      }

      if (
        rawMessage.type
        === MESSAGE_TYPES.FACE_POSITION_STATUS
      ) {
        if (
          !isRecord(rawMessage.payload)
          || !isPreCalibrationFeedback(
            rawMessage.payload.feedback
          )
        ) {
          return false;
        }

        const sessionId =
          typeof rawMessage.meta.sessionId
            === "string"
            ? rawMessage.meta.sessionId
            : null;

        /**
         * A new session may reuse the same page/content-script instance.
         * Reset only the UI latch when the authoritative session changes.
         */
        if (
          sessionId
          !== activePreCalibrationSessionId
        ) {
          activePreCalibrationSessionId =
            sessionId;

          preCalibrationCompleted =
            false;

          if (completionHideTimerId !== null) {
            window.clearTimeout(
              completionHideTimerId
            );

            completionHideTimerId =
              null;
          }
        }

        const feedback =
          rawMessage.payload.feedback;

        /**
         * READY is terminal for the pre-calibration overlay within the current
         * session. Handle it before render() so a newly injected Content Script
         * can never mount the face-position UI merely because the Offscreen
         * monitor is already latched ready.
         */
        if (feedback.readyForCalibration) {
          preCalibrationCompleted =
            true;

          if (completionHideTimerId !== null) {
            window.clearTimeout(
              completionHideTimerId
            );

            completionHideTimerId =
              null;
          }

          preCalibrationOverlay.hide();

          return false;
        }

        /**
         * An explicit monitor reset in a later calibration retry can reuse the
         * same session. A non-ready status after completion therefore reopens
         * the preparation UI intentionally. Transient face-quality changes do
         * not reach this branch because PreCalibrationMonitor latches READY.
         */
        if (preCalibrationCompleted) {
          preCalibrationCompleted =
            false;
        }

        preCalibrationOverlay.render(
          feedback
        );

        return false;
      }

      if (
        rawMessage.type
        === MESSAGE_TYPES.START_CALIBRATION
      ) {
        if (
          !isStartCalibrationPayload(
            rawMessage.payload
          )
          || typeof rawMessage.meta.sessionId
            !== "string"
          || !isFiniteNumber(
            rawMessage.meta.tabId
          )
        ) {
          return false;
        }

        if (
          activeCalibrationId
          === rawMessage.payload.calibrationId
        ) {
          return false;
        }

        gazeOverlay.setTemporarilySuppressed(true);
        gazeOverlay.hide();

        preCalibrationCompleted = true;

        if (completionHideTimerId !== null) {
          window.clearTimeout(
            completionHideTimerId
          );
          completionHideTimerId = null;
        }

        preCalibrationOverlay.hide();

        calibrationGeneration += 1;

        const generation =
          calibrationGeneration;

        activeCalibrationId =
          rawMessage.payload.calibrationId;

        const context:
          CalibrationMessageContext = {
            sessionId:
              rawMessage.meta.sessionId,
            pageId:
              typeof rawMessage.meta.pageId
                === "string"
                ? rawMessage.meta.pageId
                : null,
            tabId:
              rawMessage.meta.tabId
          };

        void runCalibration(
          rawMessage.payload,
          context,
          generation
        ).catch(
          (error: unknown) => {
            if (
              generation
              !== calibrationGeneration
            ) {
              return;
            }

            calibrationOverlay.showError(
              error instanceof Error
                ? error.message
                : "Calibration failed."
            );
          }
        ).finally(() => {
          if (
            generation
            === calibrationGeneration
          ) {
            gazeOverlay.setTemporarilySuppressed(
              false
            );
          }
        });

        return false;
      }

      return false;
    }
  );
}
