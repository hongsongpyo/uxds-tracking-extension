import {
  DEEP_PERSONALIZATION,
  GAZE_RUNTIME_DEFAULTS
} from "../shared/constants";

import {
  nowTimelineMs
} from "../shared/utils";

import type {
  FaceBaseline,
  GazePrediction,
  Point2D
} from "../shared/types";

import type {
  GazeObserverRuntimeSample
} from "./gazePredictor";

import type {
  CalibrationHybridPrediction,
  CalibrationHybridSelector,
  HybridDriftContext
} from "./calibrationHybridSelector";

import type {
  CalibrationSessionGazeStrategy
} from "./calibrationSessionStrategySelector";

/* ========================================================================== 
 * Runtime deep candidate
 * ======================================================================== */

export interface PersonalizedDeepRuntimeCandidate {
  /** Frame timestamp used by the deep model. */
  readonly sourceTimestampMs: number;

  /** Runtime time at which the personalized deep prediction became usable. */
  readonly availableAtTimestampMs: number;

  /** Measured ONNX inference latency for this deep observation. */
  readonly inferenceLatencyMs: number;

  /** Baseline gaze from the exact source frame used by the deep model. */
  readonly sourceBaselinePoint: Point2D;

  readonly normalizedPoint: Point2D;
  readonly confidence: number;
  readonly drift: HybridDriftContext;
}

export type SessionGazeFallbackReason =
  | "STRATEGY_NOT_READY"
  | "VALIDATION_NOT_READY"
  | "BASELINE_SELECTED"
  | "DEEP_UNAVAILABLE"
  | "DEEP_SOURCE_FROM_FUTURE"
  | "DEEP_SOURCE_TOO_OLD"
  | "DEEP_STALE"
  | "DRIFT_RECALIBRATION_REQUIRED"
  | "BASELINE_SAFETY_OVERRIDE"
  | "HYBRID_PREDICTION_UNAVAILABLE";

export interface SessionGazeRuntimeContext {
  /**
   * Independent validation is a readiness/safety gate only. It must never fit,
   * re-rank or retune model parameters. V6 permits only a conservative
   * one-way demotion from Deep/Hybrid to the established Baseline.
   */
  readonly validationReady: boolean;

  /**
   * POOR independent validation may be used for explicitly degraded research
   * collection after the participant has been warned. This never upgrades the
   * validation result itself and never changes model selection or weights.
   */
  readonly allowDegradedCollection?: boolean;

  /** Optional current-frame drift, preferred over stale source-frame drift. */
  readonly currentDrift?: HybridDriftContext | null;

  /** Target-free rolling precision estimates for live reliability routing. */
  readonly baselinePrecisionPx?: number | null;
  readonly deepPrecisionPx?: number | null;

  /** Persistent high pose drift may temporarily force the stable baseline. */
  readonly forceBaselineForDrift?: boolean;

  /** Persistent calibration-pose OOD may suspend data collection until maintenance completes. */
  readonly suspendCollectionForDrift?: boolean;

  /**
   * Independent-validation/session-safety override. This may only demote a
   * calibration-selected Deep/Hybrid strategy to the established Baseline; it
   * never promotes or retunes a model from validation labels.
   */
  readonly forceBaselineStrategy?: boolean;
}

export interface SessionGazeRuntimeSelection {
  readonly strategy:
    CalibrationSessionGazeStrategy | "BASELINE_FALLBACK";
  readonly configuredStrategy:
    CalibrationSessionGazeStrategy | null;
  readonly normalizedPoint: Point2D;
  readonly deepWeight: number;

  /** Backward-compatible source-frame age diagnostic. */
  readonly deepCandidateAgeMs: number | null;

  readonly deepCandidateSourceAgeMs: number | null;
  readonly deepCandidateAvailabilityAgeMs: number | null;
  readonly deepCandidateFreshnessBudgetMs: number | null;
  readonly deepTemporalAlignmentApplied: boolean;
  readonly validationReady: boolean;
  /** True when this frame may feed stabilization/fixation/data collection. */
  readonly collectionAllowed: boolean;
  /** True only when collection is proceeding despite POOR validation. */
  readonly degradedCollection: boolean;

  readonly usedFreshDeepCandidate: boolean;
  readonly fallbackReason:
    SessionGazeFallbackReason | null;
  readonly hybridPrediction:
    CalibrationHybridPrediction | null;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function finitePoint(
  point: Point2D
): boolean {
  return (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function copyPoint(point: Point2D): Point2D {
  return {
    x: point.x,
    y: point.y
  };
}

function baselineFallback(
  baselinePoint: Point2D,
  configuredStrategy:
    CalibrationSessionGazeStrategy | null,
  validationReady: boolean,
  collectionAllowed: boolean,
  fallbackReason: SessionGazeFallbackReason,
  sourceAgeMs: number | null = null,
  availabilityAgeMs: number | null = null,
  freshnessBudgetMs: number | null = null
): SessionGazeRuntimeSelection {
  return {
    strategy: "BASELINE_FALLBACK",
    configuredStrategy,
    normalizedPoint: copyPoint(baselinePoint),
    deepWeight: 0,
    deepCandidateAgeMs: sourceAgeMs,
    deepCandidateSourceAgeMs: sourceAgeMs,
    deepCandidateAvailabilityAgeMs:
      availabilityAgeMs,
    deepCandidateFreshnessBudgetMs:
      freshnessBudgetMs,
    deepTemporalAlignmentApplied: false,
    validationReady,
    collectionAllowed,
    degradedCollection:
      collectionAllowed && !validationReady,
    usedFreshDeepCandidate: false,
    fallbackReason,
    hybridPrediction: null
  };
}

function resolveFreshnessBudgetMs(
  candidate: PersonalizedDeepRuntimeCandidate
): number {
  const observerAttemptIntervalMs =
    1_000
    / GAZE_RUNTIME_DEFAULTS
      .DEEP_OBSERVER_SAMPLE_RATE_HZ;

  /*
   * The observer is serial (in-flight guarded), so the next usable deep
   * prediction cannot normally arrive faster than the slower of the configured
   * attempt interval and the measured inference latency. Keep the previous
   * candidate only for that empirically justified interval; MAX_VISUAL_HOLD_MS
   * remains the minimum continuity budget already established by the project.
   */
  return Math.max(
    GAZE_RUNTIME_DEFAULTS.MAX_VISUAL_HOLD_MS,
    observerAttemptIntervalMs,
    candidate.inferenceLatencyMs
  );
}

function temporallyAlignDeepPoint(
  currentBaselinePoint: Point2D,
  candidate: PersonalizedDeepRuntimeCandidate
): Point2D {
  /*
   * Deep prediction is generated from an older camera frame because L2CS is
   * asynchronous. Preserve the deep-vs-baseline residual from that exact
   * source frame and transport it onto the current baseline position:
   *
   *   alignedDeep(t) = baseline(t)
   *                  + [deep(t0) - baseline(t0)]
   *
   * This avoids holding an old absolute screen coordinate while the user's
   * gaze moves during inference.
   */
  return {
    x: clamp01(
      currentBaselinePoint.x
      + candidate.normalizedPoint.x
      - candidate.sourceBaselinePoint.x
    ),
    y: clamp01(
      currentBaselinePoint.y
      + candidate.normalizedPoint.y
      - candidate.sourceBaselinePoint.y
    )
  };
}

export function createDeepRuntimeCandidate(
  sample: GazeObserverRuntimeSample,
  normalizedPoint: Point2D,
  baseline: FaceBaseline,
  sourceBaselinePoint: Point2D,
  availableAtTimestampMs: number = nowTimelineMs()
): PersonalizedDeepRuntimeCandidate | null {
  if (
    !Number.isFinite(sample.prediction.timestampMs)
    || !finitePoint(normalizedPoint)
    || !finitePoint(sourceBaselinePoint)
    || !Number.isFinite(availableAtTimestampMs)
    || !Number.isFinite(
      sample.prediction.inferenceLatencyMs
    )
  ) {
    return null;
  }

  const geometry = sample.geometry;

  const baselineWidth = Math.max(
    Number.EPSILON,
    baseline.width
  );

  const baselineHeight = Math.max(
    Number.EPSILON,
    baseline.height
  );

  const baselineDistance = Math.max(
    Number.EPSILON,
    baseline.distanceRatio
  );

  return {
    sourceTimestampMs:
      sample.prediction.timestampMs,
    availableAtTimestampMs,
    inferenceLatencyMs: Math.max(
      0,
      sample.prediction.inferenceLatencyMs
    ),
    sourceBaselinePoint:
      copyPoint(sourceBaselinePoint),
    normalizedPoint: {
      x: clamp01(normalizedPoint.x),
      y: clamp01(normalizedPoint.y)
    },
    confidence: clamp01(
      sample.prediction.confidence
    ),
    drift: {
      deltaHeadYawDeg:
        geometry.headPose.yawDeg
        - baseline.headPose.yawDeg,
      deltaHeadPitchDeg:
        geometry.headPose.pitchDeg
        - baseline.headPose.pitchDeg,
      deltaHeadRollDeg:
        geometry.headPose.rollDeg
        - baseline.headPose.rollDeg,
      deltaFaceCenterX:
        geometry.faceCenterNormalized.x
        - baseline.centerX,
      deltaFaceCenterY:
        geometry.faceCenterNormalized.y
        - baseline.centerY,
      faceWidthScaleDelta:
        geometry.faceWidthRatio
        / baselineWidth
        - 1,
      faceHeightScaleDelta:
        geometry.faceHeightRatio
        / baselineHeight
        - 1,
      faceDistanceDelta:
        geometry.faceDistanceRatio
        / baselineDistance
        - 1
    }
  };
}

/**
 * Promotes the calibration-selected strategy to the live tracking path.
 *
 * Safety properties:
 * - calibration/validation never call this to fit or select a model;
 * - independent validation is used only as a READY/safety gate and may only
 *   demote Deep/Hybrid to Baseline; it never retunes weights or promotes a
 *   model;
 * - asynchronous Deep predictions are aligned to the current Baseline motion
 *   using the Baseline prediction from the exact source frame;
 * - freshness is measured from when the Deep result became available, while
 *   the source-frame age has a separate hard alignment guard;
 * - any missing/stale/degraded deep path falls back to the established
 *   baseline prediction rather than synthesizing gaze.
 */
export function selectSessionRuntimeGaze(
  baselinePrediction: GazePrediction,
  deepCandidate: PersonalizedDeepRuntimeCandidate | null,
  selector: CalibrationHybridSelector | null,
  context: SessionGazeRuntimeContext = {
    validationReady: false,
    allowDegradedCollection: false
  }
): SessionGazeRuntimeSelection {
  const baselinePoint =
    baselinePrediction.rawPoint;

  const activeSelector = selector;
  const fit = activeSelector?.getFitResult() ?? null;

  if (
    !Number.isFinite(baselinePrediction.timestampMs)
    || baselinePrediction.rawSpace !== "NORMALIZED"
    || !finitePoint(baselinePoint)
  ) {
    return baselineFallback(
      baselinePoint,
      null,
      context.validationReady,
      false,
      "STRATEGY_NOT_READY"
    );
  }

  const configuredStrategy =
    fit?.sessionStrategy.selectedStrategy
    ?? null;

  const collectionAllowed =
    context.validationReady
    || context.allowDegradedCollection === true;

  if (!collectionAllowed) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      false,
      false,
      "VALIDATION_NOT_READY"
    );
  }

  // A collection stop is a session gate, not a Deep-only fallback. Evaluate it
  // before all baseline overrides, missing-model and stale-candidate exits.
  if (context.suspendCollectionForDrift === true) {
    return baselineFallback(
      baselinePoint, configuredStrategy, context.validationReady, false,
      "DRIFT_RECALIBRATION_REQUIRED"
    );
  }

  if (context.forceBaselineStrategy === true) {
    return {
      strategy: "BASELINE_ONLY",
      configuredStrategy,
      normalizedPoint: copyPoint(baselinePoint),
      deepWeight: 0,
      deepCandidateAgeMs: null,
      deepCandidateSourceAgeMs: null,
      deepCandidateAvailabilityAgeMs: null,
      deepCandidateFreshnessBudgetMs: null,
      deepTemporalAlignmentApplied: false,
      validationReady: context.validationReady,
      collectionAllowed: true,
      degradedCollection: !context.validationReady,
      usedFreshDeepCandidate: false,
      fallbackReason: "BASELINE_SAFETY_OVERRIDE",
      hybridPrediction: null
    };
  }

  if (
    fit === null
    || activeSelector === null
    || configuredStrategy === null
  ) {
    return baselineFallback(
      baselinePoint,
      null,
      context.validationReady,
      false,
      "STRATEGY_NOT_READY"
    );
  }

  if (configuredStrategy === "BASELINE_ONLY") {
    return {
      strategy: "BASELINE_ONLY",
      configuredStrategy,
      normalizedPoint:
        copyPoint(baselinePoint),
      deepWeight: 0,
      deepCandidateAgeMs: null,
      deepCandidateSourceAgeMs: null,
      deepCandidateAvailabilityAgeMs: null,
      deepCandidateFreshnessBudgetMs: null,
      deepTemporalAlignmentApplied: false,
      validationReady: context.validationReady,
      collectionAllowed: true,
      degradedCollection: !context.validationReady,
      usedFreshDeepCandidate: false,
      fallbackReason: "BASELINE_SELECTED",
      hybridPrediction: null
    };
  }

  if (
    deepCandidate === null
    || !Number.isFinite(deepCandidate.sourceTimestampMs)
    || !Number.isFinite(deepCandidate.availableAtTimestampMs)
    || !Number.isFinite(deepCandidate.inferenceLatencyMs)
    || deepCandidate.inferenceLatencyMs < 0
    || !finitePoint(deepCandidate.normalizedPoint)
    || !finitePoint(deepCandidate.sourceBaselinePoint)
    || !Number.isFinite(deepCandidate.confidence)
  ) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_UNAVAILABLE"
    );
  }

  const sourceAgeMs =
    baselinePrediction.timestampMs
    - deepCandidate.sourceTimestampMs;

  if (sourceAgeMs < 0) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_SOURCE_FROM_FUTURE",
      sourceAgeMs
    );
  }

  /*
   * Live tracking uses a dedicated source-age guard. Independent-validation
   * dwell is intentionally longer because it waits on a stationary target and
   * must not define temporal validity for a moving live gaze stream.
   */
  if (
    sourceAgeMs
      > DEEP_PERSONALIZATION
        .LIVE_DEEP_MAX_SOURCE_AGE_MS
  ) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_SOURCE_TOO_OLD",
      sourceAgeMs
    );
  }

  const availabilityAgeMs = Math.max(
    0,
    baselinePrediction.timestampMs
      - deepCandidate.availableAtTimestampMs
  );

  const freshnessBudgetMs =
    resolveFreshnessBudgetMs(deepCandidate);

  if (availabilityAgeMs > freshnessBudgetMs) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_STALE",
      sourceAgeMs,
      availabilityAgeMs,
      freshnessBudgetMs
    );
  }

  if (context.forceBaselineForDrift === true) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DRIFT_RECALIBRATION_REQUIRED",
      sourceAgeMs,
      availabilityAgeMs,
      freshnessBudgetMs
    );
  }

  const alignedDeepPoint =
    temporallyAlignDeepPoint(
      baselinePoint,
      deepCandidate
    );

  if (configuredStrategy === "DEEP_ONLY") {
    return {
      strategy: "DEEP_ONLY",
      configuredStrategy,
      normalizedPoint: alignedDeepPoint,
      deepWeight: 1,
      deepCandidateAgeMs: sourceAgeMs,
      deepCandidateSourceAgeMs: sourceAgeMs,
      deepCandidateAvailabilityAgeMs:
        availabilityAgeMs,
      deepCandidateFreshnessBudgetMs:
        freshnessBudgetMs,
      deepTemporalAlignmentApplied: true,
      validationReady: context.validationReady,
      collectionAllowed: true,
      degradedCollection: !context.validationReady,
      usedFreshDeepCandidate: true,
      fallbackReason: null,
      hybridPrediction: null
    };
  }

  const hybridPrediction = activeSelector.predict(
    baselinePoint,
    alignedDeepPoint,
    {
      deepConfidence:
        deepCandidate.confidence,
      drift:
        context.currentDrift
        ?? deepCandidate.drift,
      baselinePrecisionPx:
        context.baselinePrecisionPx ?? null,
      deepPrecisionPx:
        context.deepPrecisionPx ?? null
    }
  );

  if (hybridPrediction === null) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "HYBRID_PREDICTION_UNAVAILABLE",
      sourceAgeMs,
      availabilityAgeMs,
      freshnessBudgetMs
    );
  }

  return {
    strategy: "SAFE_ADAPTIVE_HYBRID",
    configuredStrategy,
    normalizedPoint: {
      ...hybridPrediction.normalizedPoint
    },
    deepWeight:
      hybridPrediction.selectedStrategyDeepWeight,
    deepCandidateAgeMs: sourceAgeMs,
    deepCandidateSourceAgeMs: sourceAgeMs,
    deepCandidateAvailabilityAgeMs:
      availabilityAgeMs,
    deepCandidateFreshnessBudgetMs:
      freshnessBudgetMs,
    deepTemporalAlignmentApplied: true,
    validationReady: context.validationReady,
    collectionAllowed: true,
    degradedCollection: !context.validationReady,
    usedFreshDeepCandidate: true,
    fallbackReason: null,
    hybridPrediction
  };
}
