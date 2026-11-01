import {
  DEEP_PERSONALIZATION
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  CalibrationGroupedCvDiagnostics,
  CalibrationGroupedCvPointResult,
  CalibrationGroupedCvSpatialBucket
} from "../calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult,
  DeepPersonalMapperFitResult
} from "./deepPersonalMapper";

import {
  classifyGazeScreenRegion,
  isCardinalGazeRegion,
  isDiagonalGazeRegion
} from "./gazeRegionEstimator";

import type {
  GazeScreenRegion
} from "./gazeRegionEstimator";

import type {
  Point2D
} from "../shared/types";

import {
  applyCalibrationResidualBias,
  fitCalibrationResidualBiasModel
} from "./calibrationResidualBiasModel";

import type {
  CalibrationResidualBiasFitResult
} from "./calibrationResidualBiasModel";

import {
  adjustCalibrationReliabilityDeepWeight,
  fitCalibrationEngineReliabilityModel
} from "./calibrationEngineReliability";

import type {
  CalibrationEngineReliabilityFitResult
} from "./calibrationEngineReliability";

import {
  fitCalibrationCoarseEngineReliabilityModel
} from "./calibrationCoarseEngineReliability";

import type {
  CalibrationCoarseReliabilityFitResult
} from "./calibrationCoarseEngineReliability";

import {
  fitCalibrationSessionStrategy
} from "./calibrationSessionStrategySelector";

import type {
  CalibrationSessionGazeStrategy,
  CalibrationSessionStrategyFitResult
} from "./calibrationSessionStrategySelector";

export type HybridSpatialBucket =
  CalibrationGroupedCvSpatialBucket;

export type HybridDirectionalBucket =
  GazeScreenRegion;

export interface HybridBucketPrior {
  readonly bucket:
    | HybridSpatialBucket
    | HybridDirectionalBucket
    | "GLOBAL";
  readonly calibrationPointCount: number;
  readonly baselineExpectedErrorPx: number;
  readonly deepExpectedErrorPx: number;
  readonly deepWeight: number;
}

export interface CalibrationHybridFitResult {
  readonly calibrationPointCount: number;
  readonly globalPrior: HybridBucketPrior;
  /** Legacy coarse priors retained for diagnostics/fallback. */
  readonly bucketPriors:
    Readonly<Record<HybridSpatialBucket, HybridBucketPrior>>;
  /**
   * Direction-aware priors. STANDARD_17 contributes two points per non-center
   * direction and one center point, then shrinks each estimate toward global.
   */
  readonly directionalPriors:
    Readonly<Record<HybridDirectionalBucket, HybridBucketPrior>>;
  /**
   * Stage D16 calibration-only second-order residual bias model. The nested
   * pointwise diagnostics decide whether baseline/deep correction is enabled;
   * independent validation never changes this fit.
   */
  readonly residualBias: CalibrationResidualBiasFitResult;
  /**
   * Stage D16-B paired engine-reliability routing. Nested leave-one-point-out
   * calibration diagnostics decide whether stronger routing is safe.
   */
  readonly engineReliability: CalibrationEngineReliabilityFitResult;
  /**
   * Stage D16-C coarse CENTER/EDGE/CORNER reliability model. It uses robust
   * paired calibration-error evidence and nested grouped diagnostics.
   */
  readonly coarseEngineReliability: CalibrationCoarseReliabilityFitResult;
  /**
   * Calibration-only session-level selector. It chooses Baseline, Deep, or a
   * conservative adaptive hybrid before independent validation is observed.
   */
  readonly sessionStrategy: CalibrationSessionStrategyFitResult;
}

export interface HybridDriftContext {
  readonly deltaHeadYawDeg: number;
  readonly deltaHeadPitchDeg: number;
  readonly deltaHeadRollDeg: number;
  readonly deltaFaceCenterX: number;
  readonly deltaFaceCenterY: number;
  readonly faceWidthScaleDelta: number;
  readonly faceHeightScaleDelta: number;
  readonly faceDistanceDelta: number;
}

export interface CalibrationHybridPredictionContext {
  readonly deepConfidence: number | null;
  readonly drift: HybridDriftContext | null;
  /** Target-free current-window jitter around each engine centroid. */
  readonly baselinePrecisionPx?: number | null;
  readonly deepPrecisionPx?: number | null;
}

export interface CalibrationHybridPrediction {
  /** Final calibration-selected session output. */
  readonly normalizedPoint: Point2D;
  /** Adaptive-hybrid candidate retained for diagnostics/comparison. */
  readonly adaptiveHybridNormalizedPoint: Point2D;
  readonly selectedSessionStrategy: CalibrationSessionGazeStrategy;
  readonly selectedStrategyDeepWeight: number;
  readonly adaptiveHybridDeepWeight: number;
  readonly calibrationRoutingInfluence: number;
  readonly liveRoutingAttenuation: number;
  readonly effectiveRoutingInfluence: number;
  readonly spatialBucket: HybridSpatialBucket;
  readonly directionalBucket: HybridDirectionalBucket;
  readonly deepWeight: number;
  readonly baselineWeight: number;
  readonly errorDerivedDeepWeight: number;
  readonly calibrationReliabilityDeepWeight: number;
  readonly calibrationReliabilityRoutingApplied: boolean;
  readonly coarseCalibrationReliabilityDeepWeight: number;
  readonly coarseCalibrationReliabilityRoutingApplied: boolean;
  readonly activeReliabilityRoutingMode:
    | "ERROR_DERIVED"
    | "DIRECTIONAL"
    | "COARSE";
  readonly baselineExpectedErrorPx: number;
  readonly deepExpectedErrorPx: number;
  readonly expectedHybridErrorPx: number;
  readonly directionalPriorReliability: number;
  readonly driftSeverity: number;
  readonly deepConfidencePenaltyMultiplier: number;
  readonly baselineStabilityPenaltyMultiplier: number;
  readonly deepStabilityPenaltyMultiplier: number;
  readonly rawModelDisagreementNormalized: number;
  readonly modelDisagreementNormalized: number;
  readonly baselineBiasCorrectionApplied: boolean;
  readonly deepBiasCorrectionApplied: boolean;
  readonly baselineBiasCorrectionStrength: number;
  readonly deepBiasCorrectionStrength: number;
  readonly baselineBiasCorrectionNormalized: Point2D;
  readonly deepBiasCorrectionNormalized: Point2D;
  readonly baselineBiasCorrectedNormalizedPoint: Point2D;
  readonly deepBiasCorrectedNormalizedPoint: Point2D;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Hybrid selector cannot average an empty calibration-error set."
    );
  }

  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

function coarseBucketFromRegion(
  region: HybridDirectionalBucket
): HybridSpatialBucket {
  if (region === "CENTER") {
    return "CENTER";
  }

  if (isDiagonalGazeRegion(region)) {
    return "CORNER";
  }

  if (isCardinalGazeRegion(region)) {
    return "EDGE";
  }

  return "CENTER";
}

function deepWeightFromExpectedErrors(
  baselineExpectedErrorPx: number,
  deepExpectedErrorPx: number
): number {
  const baseline = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    baselineExpectedErrorPx
  );

  const deep = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    deepExpectedErrorPx
  );

  // Reliability is proportional to inverse variance. After normalization,
  // deepWeight = baseline^2 / (baseline^2 + deep^2).
  const rawWeight =
    (baseline * baseline)
    / (
      baseline * baseline
      + deep * deep
    );

  return clamp(
    rawWeight,
    DEEP_PERSONALIZATION.HYBRID_MIN_DEEP_WEIGHT,
    DEEP_PERSONALIZATION.HYBRID_MAX_DEEP_WEIGHT
  );
}

function expectedHybridError(
  baselineExpectedErrorPx: number,
  deepExpectedErrorPx: number,
  deepWeight: number
): number {
  const baselineWeight = 1 - deepWeight;

  // Conservative error proxy. It is not presented as a physical uncertainty;
  // it is only a calibration-derived ranking/quality prior.
  return Math.sqrt(
    baselineWeight * baselineWeight
      * baselineExpectedErrorPx * baselineExpectedErrorPx
    + deepWeight * deepWeight
      * deepExpectedErrorPx * deepExpectedErrorPx
  );
}

function normalizedExcess(
  magnitude: number,
  soft: number,
  hard: number
): number {
  if (!Number.isFinite(magnitude)) {
    return 1;
  }

  if (magnitude <= soft) {
    return 0;
  }

  if (hard <= soft) {
    return 1;
  }

  return clamp(
    (magnitude - soft) / (hard - soft),
    0,
    1
  );
}

function computeDriftSeverity(
  drift: HybridDriftContext | null
): number {
  if (drift === null) {
    return 0;
  }

  const yaw = normalizedExcess(
    Math.abs(drift.deltaHeadYawDeg),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_SOFT_DEG,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_HARD_DEG
  );

  const pitch = normalizedExcess(
    Math.abs(drift.deltaHeadPitchDeg),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_SOFT_DEG,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_HARD_DEG
  );

  const roll = normalizedExcess(
    Math.abs(drift.deltaHeadRollDeg),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_SOFT_DEG,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_HARD_DEG
  );

  const faceCenterMagnitude = Math.hypot(
    drift.deltaFaceCenterX,
    drift.deltaFaceCenterY
  );

  const faceCenter = normalizedExcess(
    faceCenterMagnitude,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_FACE_CENTER_SOFT,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_FACE_CENTER_HARD
  );

  const scaleMagnitude = Math.max(
    Math.abs(drift.faceWidthScaleDelta),
    Math.abs(drift.faceHeightScaleDelta)
  );

  const scale = normalizedExcess(
    scaleMagnitude,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_SCALE_SOFT,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_SCALE_HARD
  );

  const distance = normalizedExcess(
    Math.abs(drift.faceDistanceDelta),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_DISTANCE_SOFT,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_DISTANCE_HARD
  );

  // Head pose is the strongest signal because gaze calibration is most
  // directly conditioned on it. Face translation/scale are secondary.
  return clamp(
    0.22 * yaw
      + 0.28 * pitch
      + 0.10 * roll
      + 0.18 * faceCenter
      + 0.12 * scale
      + 0.10 * distance,
    0,
    1
  );
}

function temporalStabilityPenaltyMultiplier(
  precisionPx: number | null | undefined,
  expectedErrorPx: number,
  driftSeverity: number
): number {
  if (
    precisionPx === null
    || precisionPx === undefined
    || !Number.isFinite(precisionPx)
    || precisionPx < 0
  ) {
    return 1;
  }

  const ratio = precisionPx / Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    expectedErrorPx
  );

  const jitterSeverity = normalizedExcess(
    ratio,
    DEEP_PERSONALIZATION.HYBRID_STABILITY_SOFT_RATIO,
    DEEP_PERSONALIZATION.HYBRID_STABILITY_HARD_RATIO
  );

  const evidenceStrength = clamp(
    DEEP_PERSONALIZATION.HYBRID_STABILITY_BASE_STRENGTH
      + driftSeverity
        * DEEP_PERSONALIZATION.HYBRID_STABILITY_DRIFT_STRENGTH,
    0,
    1
  );

  return 1 + jitterSeverity * evidenceStrength * (
    DEEP_PERSONALIZATION.HYBRID_MAX_STABILITY_ERROR_MULTIPLIER
      - 1
  );
}

function deepConfidencePenaltyMultiplier(
  confidence: number | null
): number {
  if (
    confidence === null
    || !Number.isFinite(confidence)
  ) {
    return DEEP_PERSONALIZATION
      .HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER;
  }

  const reference =
    DEEP_PERSONALIZATION.HYBRID_DEEP_CONFIDENCE_REFERENCE;

  if (confidence >= reference) {
    return 1;
  }

  const floor =
    DEEP_PERSONALIZATION.HYBRID_DEEP_CONFIDENCE_FLOOR;

  const fraction = clamp(
    (reference - confidence)
      / Math.max(1e-6, reference - floor),
    0,
    1
  );

  return 1 + fraction * (
    DEEP_PERSONALIZATION
      .HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER
    - 1
  );
}

function buildPrior(
  bucket: HybridBucketPrior["bucket"],
  baselinePoints:
    readonly CalibrationGroupedCvPointResult[],
  deepPoints:
    readonly DeepGroupedCvPointResult[],
  globalBaselineErrorPx: number,
  globalDeepErrorPx: number,
  pseudoCount: number
): HybridBucketPrior {
  const baselineErrors = baselinePoints.map(
    (point) => point.errorPx
  );

  const deepErrors = deepPoints.map(
    (point) => point.errorPx
  );

  if (
    baselineErrors.length !== deepErrors.length
    || baselineErrors.length === 0
  ) {
    if (bucket === "GLOBAL") {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Hybrid selector calibration diagnostics are incomplete."
      );
    }

    return {
      bucket,
      calibrationPointCount: 0,
      baselineExpectedErrorPx: globalBaselineErrorPx,
      deepExpectedErrorPx: globalDeepErrorPx,
      deepWeight: deepWeightFromExpectedErrors(
        globalBaselineErrorPx,
        globalDeepErrorPx
      )
    };
  }

  const localBaseline = mean(baselineErrors);
  const localDeep = mean(deepErrors);

  if (bucket === "GLOBAL") {
    return {
      bucket,
      calibrationPointCount: baselineErrors.length,
      baselineExpectedErrorPx: localBaseline,
      deepExpectedErrorPx: localDeep,
      deepWeight: deepWeightFromExpectedErrors(
        localBaseline,
        localDeep
      )
    };
  }

  const localWeight =
    baselineErrors.length
    / (baselineErrors.length + pseudoCount);

  const baselineExpectedErrorPx =
    localWeight * localBaseline
    + (1 - localWeight) * globalBaselineErrorPx;

  const deepExpectedErrorPx =
    localWeight * localDeep
    + (1 - localWeight) * globalDeepErrorPx;

  return {
    bucket,
    calibrationPointCount: baselineErrors.length,
    baselineExpectedErrorPx,
    deepExpectedErrorPx,
    deepWeight: deepWeightFromExpectedErrors(
      baselineExpectedErrorPx,
      deepExpectedErrorPx
    )
  };
}

const DIRECTIONAL_BUCKETS:
readonly HybridDirectionalBucket[] = [
  "TOP_LEFT",
  "TOP",
  "TOP_RIGHT",
  "LEFT",
  "CENTER",
  "RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM",
  "BOTTOM_RIGHT"
] as const;

/**
 * Calibration-only uncertainty-weighted fusion of the established residual
 * path and L2CS personalized path.
 *
 * Stage D13 adds direction-specific priors and drift-aware backoff. Stage D16
 * adds calibration-only residual-bias correction guarded by nested pointwise
 * cross-validation. Stage D16-B additionally learns paired engine-routing
 * weights with a second nested point exclusion and activates them only when
 * calibration Mean and P95 both improve. Stage D16-C adds a lower-variance
 * CENTER/EDGE/CORNER robust paired-error reliability model and gives it
 * precedence only when its own nested Mean/P95 gate passes. Independent
 * validation still never changes selector parameters.
 */
export class CalibrationHybridSelector {
  private fitResult:
    CalibrationHybridFitResult | null = null;

  public fit(
    baselineCv: CalibrationGroupedCvDiagnostics,
    deepFit: DeepPersonalMapperFitResult
  ): CalibrationHybridFitResult {
    const deepByIndex = new Map(
      deepFit.selectedPointResults.map(
        (point) => [point.pointIndex, point] as const
      )
    );

    const matchedBaseline =
      baselineCv.pointResults.filter(
        (point) => deepByIndex.has(point.pointIndex)
      );

    const matchedDeep = matchedBaseline.map(
      (point) => deepByIndex.get(point.pointIndex)
    ).filter(
      (point): point is DeepGroupedCvPointResult =>
        point !== undefined
    );

    if (
      matchedBaseline.length
        < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT
      || matchedBaseline.length !== matchedDeep.length
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Hybrid selector requires matching grouped-CV results from both gaze paths."
      );
    }

    const residualBias = fitCalibrationResidualBiasModel(
      matchedBaseline,
      matchedDeep
    );

    const baselineBiasCvByIndex = new Map(
      residualBias.baseline.crossValidation.pointResults.map(
        (point) => [point.pointIndex, point] as const
      )
    );

    const deepBiasCvByIndex = new Map(
      residualBias.deep.crossValidation.pointResults.map(
        (point) => [point.pointIndex, point] as const
      )
    );

    const priorBaseline = matchedBaseline.map(
      (point): CalibrationGroupedCvPointResult => {
        if (!residualBias.baseline.correctionEnabled) {
          return point;
        }

        const corrected = baselineBiasCvByIndex.get(
          point.pointIndex
        );

        if (corrected === undefined) {
          return point;
        }

        return {
          ...point,
          predictedNormalizedPoint:
            corrected.correctedNormalizedPoint,
          predictedViewportPoint:
            corrected.correctedViewportPoint,
          errorPx: corrected.correctedErrorPx
        };
      }
    );

    const priorDeep = matchedDeep.map(
      (point): DeepGroupedCvPointResult => {
        if (!residualBias.deep.correctionEnabled) {
          return point;
        }

        const corrected = deepBiasCvByIndex.get(
          point.pointIndex
        );

        if (corrected === undefined) {
          return point;
        }

        return {
          ...point,
          predictedNormalizedPoint:
            corrected.correctedNormalizedPoint,
          predictedViewportPoint:
            corrected.correctedViewportPoint,
          errorPx: corrected.correctedErrorPx
        };
      }
    );

    const engineReliability =
      fitCalibrationEngineReliabilityModel(
        priorBaseline,
        priorDeep
      );

    const coarseEngineReliability =
      fitCalibrationCoarseEngineReliabilityModel(
        priorBaseline,
        priorDeep
      );

    const sessionStrategy =
      fitCalibrationSessionStrategy(
        priorBaseline,
        priorDeep,
        engineReliability,
        coarseEngineReliability
      );

    const globalBaselineErrorPx = mean(
      priorBaseline.map((point) => point.errorPx)
    );

    const globalDeepErrorPx = mean(
      priorDeep.map((point) => point.errorPx)
    );

    const globalPrior = buildPrior(
      "GLOBAL",
      priorBaseline,
      priorDeep,
      globalBaselineErrorPx,
      globalDeepErrorPx,
      0
    );

    const makeCoarseBucket = (
      bucket: HybridSpatialBucket
    ): HybridBucketPrior => {
      const baselineBucket = priorBaseline.filter(
        (point) => point.spatialBucket === bucket
      );

      const indices = new Set(
        baselineBucket.map((point) => point.pointIndex)
      );

      const deepBucket = priorDeep.filter(
        (point) => indices.has(point.pointIndex)
      );

      return buildPrior(
        bucket,
        baselineBucket,
        deepBucket,
        globalBaselineErrorPx,
        globalDeepErrorPx,
        DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT
      );
    };

    const makeDirectionalBucket = (
      bucket: HybridDirectionalBucket
    ): HybridBucketPrior => {
      const baselineBucket = priorBaseline.filter(
        (point) =>
          classifyGazeScreenRegion(
            point.targetNormalizedPoint
          ) === bucket
      );

      const indices = new Set(
        baselineBucket.map((point) => point.pointIndex)
      );

      const deepBucket = priorDeep.filter(
        (point) => indices.has(point.pointIndex)
      );

      return buildPrior(
        bucket,
        baselineBucket,
        deepBucket,
        globalBaselineErrorPx,
        globalDeepErrorPx,
        DEEP_PERSONALIZATION
          .HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT
      );
    };

    const directionalPriors = Object.fromEntries(
      DIRECTIONAL_BUCKETS.map(
        (bucket) => [
          bucket,
          makeDirectionalBucket(bucket)
        ] as const
      )
    ) as Readonly<
      Record<HybridDirectionalBucket, HybridBucketPrior>
    >;

    this.fitResult = {
      calibrationPointCount: matchedBaseline.length,
      globalPrior,
      bucketPriors: {
        CENTER: makeCoarseBucket("CENTER"),
        EDGE: makeCoarseBucket("EDGE"),
        CORNER: makeCoarseBucket("CORNER")
      },
      directionalPriors,
      residualBias,
      engineReliability,
      coarseEngineReliability,
      sessionStrategy
    };

    return this.fitResult;
  }

  public predict(
    baselineNormalizedPoint: Point2D,
    deepNormalizedPoint: Point2D,
    context: CalibrationHybridPredictionContext = {
      deepConfidence: null,
      drift: null,
      baselinePrecisionPx: null,
      deepPrecisionPx: null
    }
  ): CalibrationHybridPrediction | null {
    const fit = this.fitResult;

    if (fit === null) {
      return null;
    }

    // Route using the global calibration-only prior rather than a hard 50/50
    // midpoint. This makes directional classification less sensitive to one
    // model producing a large outlier.
    const globalDeepWeight = fit.globalPrior.deepWeight;
    const routingPoint = {
      x: clamp(
        (1 - globalDeepWeight) * baselineNormalizedPoint.x
          + globalDeepWeight * deepNormalizedPoint.x,
        0,
        1
      ),
      y: clamp(
        (1 - globalDeepWeight) * baselineNormalizedPoint.y
          + globalDeepWeight * deepNormalizedPoint.y,
        0,
        1
      )
    };

    const directionalBucket =
      classifyGazeScreenRegion(routingPoint);

    const spatialBucket =
      coarseBucketFromRegion(directionalBucket);

    const directionalPrior =
      fit.directionalPriors[directionalBucket];

    const driftSeverity =
      computeDriftSeverity(context.drift);

    const directionalPriorReliability = clamp(
      1
        - driftSeverity * (
          1
          - DEEP_PERSONALIZATION
            .HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY
        ),
      DEEP_PERSONALIZATION
        .HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY,
      1
    );

    const baselineBias = applyCalibrationResidualBias(
      baselineNormalizedPoint,
      fit.residualBias.baseline,
      directionalBucket,
      directionalPriorReliability
    );

    const deepBias = applyCalibrationResidualBias(
      deepNormalizedPoint,
      fit.residualBias.deep,
      directionalBucket,
      directionalPriorReliability
    );

    const baselinePriorExpectedErrorPx =
      directionalPriorReliability
        * directionalPrior.baselineExpectedErrorPx
      + (1 - directionalPriorReliability)
        * fit.globalPrior.baselineExpectedErrorPx;

    const confidencePenalty =
      deepConfidencePenaltyMultiplier(
        context.deepConfidence
      );

    const deepPriorExpectedErrorPx = (
      directionalPriorReliability
        * directionalPrior.deepExpectedErrorPx
      + (1 - directionalPriorReliability)
        * fit.globalPrior.deepExpectedErrorPx
    ) * confidencePenalty;

    const baselineStabilityPenalty =
      temporalStabilityPenaltyMultiplier(
        context.baselinePrecisionPx,
        baselinePriorExpectedErrorPx,
        driftSeverity
      );

    const deepStabilityPenalty =
      temporalStabilityPenaltyMultiplier(
        context.deepPrecisionPx,
        deepPriorExpectedErrorPx,
        driftSeverity
      );

    const baselineExpectedErrorPx =
      baselinePriorExpectedErrorPx
      * baselineStabilityPenalty;

    const deepExpectedErrorPx =
      deepPriorExpectedErrorPx
      * deepStabilityPenalty;

    const errorDerivedDeepWeight = deepWeightFromExpectedErrors(
      baselineExpectedErrorPx,
      deepExpectedErrorPx
    );

    const reliabilityDirectionalPrior =
      fit.engineReliability.directionalPriors[directionalBucket];

    const calibrationReliabilityDeepWeight =
      directionalPriorReliability
        * reliabilityDirectionalPrior.deepWeight
      + (1 - directionalPriorReliability)
        * fit.engineReliability.globalPrior.deepWeight;

    const reliabilityAdjustedDeepWeight =
      adjustCalibrationReliabilityDeepWeight(
        calibrationReliabilityDeepWeight,
        baselineStabilityPenalty,
        confidencePenalty * deepStabilityPenalty
      );

    const directionalCalibrationReliabilityRoutingEnabled =
      fit.engineReliability.routingEnabled;

    const coarseReliabilityPrior =
      fit.coarseEngineReliability.bucketPriors[spatialBucket];

    const coarseCalibrationReliabilityDeepWeight =
      directionalPriorReliability
        * coarseReliabilityPrior.deepWeight
      + (1 - directionalPriorReliability)
        * fit.coarseEngineReliability.globalPrior.deepWeight;

    const coarseReliabilityAdjustedDeepWeight =
      adjustCalibrationReliabilityDeepWeight(
        coarseCalibrationReliabilityDeepWeight,
        baselineStabilityPenalty,
        confidencePenalty * deepStabilityPenalty
      );

    const coarseCalibrationReliabilityRoutingApplied =
      fit.coarseEngineReliability.routingEnabled;

    const calibrationReliabilityRoutingApplied =
      !coarseCalibrationReliabilityRoutingApplied
      && directionalCalibrationReliabilityRoutingEnabled;

    const activeReliabilityRoutingMode =
      coarseCalibrationReliabilityRoutingApplied
        ? "COARSE"
        : calibrationReliabilityRoutingApplied
          ? "DIRECTIONAL"
          : "ERROR_DERIVED";

    const reliabilityCandidateDeepWeight =
      coarseCalibrationReliabilityRoutingApplied
        ? coarseReliabilityAdjustedDeepWeight
        : calibrationReliabilityRoutingApplied
          ? reliabilityAdjustedDeepWeight
          : errorDerivedDeepWeight;

    const rawModelDisagreementNormalized = Math.hypot(
      baselineNormalizedPoint.x - deepNormalizedPoint.x,
      baselineNormalizedPoint.y - deepNormalizedPoint.y
    );

    const disagreementSeverity = normalizedExcess(
      rawModelDisagreementNormalized,
      DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_SOFT_NORMALIZED,
      DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_HARD_NORMALIZED
    );

    const baselineInstabilitySeverity = clamp(
      (baselineStabilityPenalty - 1)
        / Math.max(
          1e-6,
          DEEP_PERSONALIZATION.HYBRID_MAX_STABILITY_ERROR_MULTIPLIER - 1
        ),
      0,
      1
    );

    const deepInstabilitySeverity = clamp(
      Math.max(
        (deepStabilityPenalty - 1)
          / Math.max(
            1e-6,
            DEEP_PERSONALIZATION.HYBRID_MAX_STABILITY_ERROR_MULTIPLIER - 1
          ),
        (confidencePenalty - 1)
          / Math.max(
            1e-6,
            DEEP_PERSONALIZATION.HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER - 1
          )
      ),
      0,
      1
    );

    // Reliability priors are calibration evidence, not an override. When the
    // two models strongly disagree while either current stream is unstable,
    // smoothly fall back toward the target-free error-derived weight.
    const liveRoutingAttenuation = clamp(
      1
        - disagreementSeverity
          * Math.max(
            baselineInstabilitySeverity,
            deepInstabilitySeverity
          ),
      0,
      1
    );

    const calibrationRoutingInfluence =
      activeReliabilityRoutingMode === "ERROR_DERIVED"
        ? 0
        : fit.sessionStrategy.calibrationRoutingInfluence;

    const effectiveRoutingInfluence = clamp(
      calibrationRoutingInfluence * liveRoutingAttenuation,
      0,
      1
    );

    const adaptiveHybridDeepWeight = clamp(
      errorDerivedDeepWeight
        + effectiveRoutingInfluence
          * (reliabilityCandidateDeepWeight - errorDerivedDeepWeight),
      0,
      1
    );

    const adaptiveHybridBaselineWeight =
      1 - adaptiveHybridDeepWeight;

    const modelDisagreementNormalized = Math.hypot(
      baselineBias.correctedNormalizedPoint.x
        - deepBias.correctedNormalizedPoint.x,
      baselineBias.correctedNormalizedPoint.y
        - deepBias.correctedNormalizedPoint.y
    );

    const adaptiveHybridNormalizedPoint = {
      x:
        adaptiveHybridBaselineWeight
          * baselineBias.correctedNormalizedPoint.x
        + adaptiveHybridDeepWeight
          * deepBias.correctedNormalizedPoint.x,
      y:
        adaptiveHybridBaselineWeight
          * baselineBias.correctedNormalizedPoint.y
        + adaptiveHybridDeepWeight
          * deepBias.correctedNormalizedPoint.y
    };

    const selectedSessionStrategy =
      fit.sessionStrategy.selectedStrategy;

    const selectedStrategyDeepWeight =
      selectedSessionStrategy === "BASELINE_ONLY"
        ? 0
        : selectedSessionStrategy === "DEEP_ONLY"
          ? 1
          : adaptiveHybridDeepWeight;

    const normalizedPoint =
      selectedSessionStrategy === "BASELINE_ONLY"
        ? baselineBias.correctedNormalizedPoint
        : selectedSessionStrategy === "DEEP_ONLY"
          ? deepBias.correctedNormalizedPoint
          : adaptiveHybridNormalizedPoint;

    const deepWeight = adaptiveHybridDeepWeight;
    const baselineWeight = adaptiveHybridBaselineWeight;

    return {
      normalizedPoint,
      adaptiveHybridNormalizedPoint,
      selectedSessionStrategy,
      selectedStrategyDeepWeight,
      adaptiveHybridDeepWeight,
      calibrationRoutingInfluence,
      liveRoutingAttenuation,
      effectiveRoutingInfluence,
      spatialBucket,
      directionalBucket,
      deepWeight,
      baselineWeight,
      errorDerivedDeepWeight,
      calibrationReliabilityDeepWeight,
      calibrationReliabilityRoutingApplied,
      coarseCalibrationReliabilityDeepWeight,
      coarseCalibrationReliabilityRoutingApplied,
      activeReliabilityRoutingMode,
      baselineExpectedErrorPx,
      deepExpectedErrorPx,
      expectedHybridErrorPx:
        expectedHybridError(
          baselineExpectedErrorPx,
          deepExpectedErrorPx,
          deepWeight
        ),
      directionalPriorReliability,
      driftSeverity,
      deepConfidencePenaltyMultiplier:
        confidencePenalty,
      baselineStabilityPenaltyMultiplier:
        baselineStabilityPenalty,
      deepStabilityPenaltyMultiplier:
        deepStabilityPenalty,
      rawModelDisagreementNormalized,
      modelDisagreementNormalized,
      baselineBiasCorrectionApplied:
        baselineBias.applied,
      deepBiasCorrectionApplied:
        deepBias.applied,
      baselineBiasCorrectionStrength:
        baselineBias.correctionStrength,
      deepBiasCorrectionStrength:
        deepBias.correctionStrength,
      baselineBiasCorrectionNormalized:
        baselineBias.correctionNormalized,
      deepBiasCorrectionNormalized:
        deepBias.correctionNormalized,
      baselineBiasCorrectedNormalizedPoint:
        baselineBias.correctedNormalizedPoint,
      deepBiasCorrectedNormalizedPoint:
        deepBias.correctedNormalizedPoint
    };
  }

  public getFitResult():
  CalibrationHybridFitResult | null {
    return this.fitResult;
  }

  public reset(): void {
    this.fitResult = null;
  }
}
