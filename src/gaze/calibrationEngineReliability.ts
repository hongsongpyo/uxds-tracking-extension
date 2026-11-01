import {
  DEEP_PERSONALIZATION,
  NUMERIC_EPSILON
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  CalibrationGroupedCvPointResult
} from "../calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult
} from "./deepPersonalMapper";

import {
  classifyGazeScreenRegion
} from "./gazeRegionEstimator";

import type {
  GazeScreenRegion
} from "./gazeRegionEstimator";

import type {
  Point2D
} from "../shared/types";

export interface CalibrationEngineReliabilityPrior {
  readonly bucket: GazeScreenRegion | "GLOBAL";
  readonly calibrationPointCount: number;
  readonly deepWinFraction: number;
  /** Positive means Deep had lower grouped-CV error than Baseline. */
  readonly meanDeepAdvantagePx: number;
  /** Calibration-only target projection onto the Baseline→Deep segment. */
  readonly optimalDeepWeightMean: number;
  /** Shrunk routing weight used by the live hybrid selector. */
  readonly deepWeight: number;
}

export interface CalibrationEngineReliabilityCvPointResult {
  readonly pointIndex: number;
  readonly routingBucket: GazeScreenRegion;
  readonly currentDeepWeight: number;
  readonly reliabilityDeepWeight: number;
  readonly currentHybridErrorPx: number;
  readonly reliabilityHybridErrorPx: number;
  readonly improved: boolean;
}

export interface CalibrationEngineReliabilityCvDiagnostics {
  readonly pointCount: number;
  readonly currentMeanErrorPx: number;
  readonly reliabilityMeanErrorPx: number;
  readonly currentP95ErrorPx: number;
  readonly reliabilityP95ErrorPx: number;
  readonly currentRmsePx: number;
  readonly reliabilityRmsePx: number;
  readonly improvedPointFraction: number;
  readonly meanImprovementPx: number;
  readonly p95ImprovementPx: number;
  readonly routingEnabled: boolean;
  readonly pointResults:
    readonly CalibrationEngineReliabilityCvPointResult[];
}

export interface CalibrationEngineReliabilityFitResult {
  readonly routingEnabled: boolean;
  readonly globalPrior: CalibrationEngineReliabilityPrior;
  readonly directionalPriors:
    Readonly<Record<GazeScreenRegion, CalibrationEngineReliabilityPrior>>;
  readonly crossValidation: CalibrationEngineReliabilityCvDiagnostics;
}

interface ReliabilityObservation {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly baselineNormalizedPoint: Point2D;
  readonly baselineViewportPoint: Point2D;
  readonly baselineErrorPx: number;
  readonly deepNormalizedPoint: Point2D;
  readonly deepViewportPoint: Point2D;
  readonly deepErrorPx: number;
  readonly targetBucket: GazeScreenRegion;
  readonly optimalDeepWeight: number;
}

const DIRECTIONAL_BUCKETS: readonly GazeScreenRegion[] = [
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

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability model cannot average an empty set."
    );
  }

  return values.reduce((sum, value) => sum + value, 0)
    / values.length;
}

function percentile(
  values: readonly number[],
  probability: number
): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability model cannot compute an empty percentile."
    );
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function rmse(values: readonly number[]): number {
  return Math.sqrt(mean(values.map((value) => value * value)));
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

  const rawWeight =
    (baseline * baseline)
    / (baseline * baseline + deep * deep);

  return clamp(
    rawWeight,
    DEEP_PERSONALIZATION.HYBRID_MIN_DEEP_WEIGHT,
    DEEP_PERSONALIZATION.HYBRID_MAX_DEEP_WEIGHT
  );
}

function optimalDeepWeight(
  target: Point2D,
  baseline: Point2D,
  deep: Point2D
): number {
  const dx = deep.x - baseline.x;
  const dy = deep.y - baseline.y;
  const denominator = dx * dx + dy * dy;

  if (denominator <= NUMERIC_EPSILON) {
    return 0.5;
  }

  const tx = target.x - baseline.x;
  const ty = target.y - baseline.y;

  return clamp(
    (tx * dx + ty * dy) / denominator,
    0,
    1
  );
}

function blendPoint(
  baseline: Point2D,
  deep: Point2D,
  deepWeight: number
): Point2D {
  const baselineWeight = 1 - deepWeight;

  return {
    x: baselineWeight * baseline.x + deepWeight * deep.x,
    y: baselineWeight * baseline.y + deepWeight * deep.y
  };
}

function pointErrorPx(
  point: Point2D,
  target: Point2D
): number {
  return Math.hypot(
    point.x - target.x,
    point.y - target.y
  );
}

function createObservations(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  deepPoints: readonly DeepGroupedCvPointResult[]
): readonly ReliabilityObservation[] {
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point] as const)
  );

  const observations = baselinePoints.map((baseline) => {
    const deep = deepByIndex.get(baseline.pointIndex);

    if (deep === undefined) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Engine reliability model requires matched Baseline and Deep grouped-CV points.",
        { details: { pointIndex: baseline.pointIndex } }
      );
    }

    return {
      pointIndex: baseline.pointIndex,
      targetNormalizedPoint: baseline.targetNormalizedPoint,
      targetViewportPoint: baseline.targetViewportPoint,
      baselineNormalizedPoint: baseline.predictedNormalizedPoint,
      baselineViewportPoint: baseline.predictedViewportPoint,
      baselineErrorPx: baseline.errorPx,
      deepNormalizedPoint: deep.predictedNormalizedPoint,
      deepViewportPoint: deep.predictedViewportPoint,
      deepErrorPx: deep.errorPx,
      targetBucket: classifyGazeScreenRegion(
        baseline.targetNormalizedPoint
      ),
      optimalDeepWeight: optimalDeepWeight(
        baseline.targetViewportPoint,
        baseline.predictedViewportPoint,
        deep.predictedViewportPoint
      )
    } satisfies ReliabilityObservation;
  });

  if (
    observations.length
      < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Engine reliability routing requires the complete grouped calibration set."
    );
  }

  return observations;
}

function buildGlobalPrior(
  observations: readonly ReliabilityObservation[]
): CalibrationEngineReliabilityPrior {
  if (observations.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability global prior requires calibration observations."
    );
  }

  const optimalWeights = observations.map(
    (point) => point.optimalDeepWeight
  );

  const optimalDeepWeightMean = mean(optimalWeights);

  // Even globally consistent calibration evidence should remain reversible by
  // live confidence/stability evidence. Reuse the established bucket
  // pseudocount as a neutral 0.5 prior instead of permitting an exact 0/1
  // routing weight from a small calibration set.
  const globalEvidenceWeight =
    observations.length
    / (
      observations.length
      + DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT
    );

  return {
    bucket: "GLOBAL",
    calibrationPointCount: observations.length,
    deepWinFraction: mean(
      observations.map(
        (point) => point.deepErrorPx < point.baselineErrorPx ? 1 : 0
      )
    ),
    meanDeepAdvantagePx: mean(
      observations.map(
        (point) => point.baselineErrorPx - point.deepErrorPx
      )
    ),
    optimalDeepWeightMean,
    deepWeight:
      globalEvidenceWeight * optimalDeepWeightMean
      + (1 - globalEvidenceWeight) * 0.5
  };
}

function buildDirectionalPrior(
  bucket: GazeScreenRegion,
  observations: readonly ReliabilityObservation[],
  globalPrior: CalibrationEngineReliabilityPrior
): CalibrationEngineReliabilityPrior {
  const local = observations.filter(
    (point) => point.targetBucket === bucket
  );

  if (local.length === 0) {
    return {
      bucket,
      calibrationPointCount: 0,
      deepWinFraction: globalPrior.deepWinFraction,
      meanDeepAdvantagePx: globalPrior.meanDeepAdvantagePx,
      optimalDeepWeightMean: globalPrior.optimalDeepWeightMean,
      deepWeight: globalPrior.deepWeight
    };
  }

  const localWeight =
    local.length
    / (
      local.length
      + DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT
    );

  const localOptimalWeight = mean(
    local.map((point) => point.optimalDeepWeight)
  );

  const localDeepWinFraction = mean(
    local.map(
      (point) => point.deepErrorPx < point.baselineErrorPx ? 1 : 0
    )
  );

  const localMeanAdvantage = mean(
    local.map(
      (point) => point.baselineErrorPx - point.deepErrorPx
    )
  );

  return {
    bucket,
    calibrationPointCount: local.length,
    deepWinFraction:
      localWeight * localDeepWinFraction
      + (1 - localWeight) * globalPrior.deepWinFraction,
    meanDeepAdvantagePx:
      localWeight * localMeanAdvantage
      + (1 - localWeight) * globalPrior.meanDeepAdvantagePx,
    optimalDeepWeightMean: localOptimalWeight,
    deepWeight:
      localWeight * localOptimalWeight
      + (1 - localWeight) * globalPrior.deepWeight
  };
}

function buildDirectionalPriors(
  observations: readonly ReliabilityObservation[],
  globalPrior: CalibrationEngineReliabilityPrior
): Readonly<Record<GazeScreenRegion, CalibrationEngineReliabilityPrior>> {
  return Object.fromEntries(
    DIRECTIONAL_BUCKETS.map(
      (bucket) => [
        bucket,
        buildDirectionalPrior(
          bucket,
          observations,
          globalPrior
        )
      ] as const
    )
  ) as Readonly<
    Record<GazeScreenRegion, CalibrationEngineReliabilityPrior>
  >;
}

function errorPriorForBucket(
  observations: readonly ReliabilityObservation[],
  bucket: GazeScreenRegion,
  globalBaselineErrorPx: number,
  globalDeepErrorPx: number
): {
  readonly baselineExpectedErrorPx: number;
  readonly deepExpectedErrorPx: number;
} {
  const local = observations.filter(
    (point) => point.targetBucket === bucket
  );

  if (local.length === 0) {
    return {
      baselineExpectedErrorPx: globalBaselineErrorPx,
      deepExpectedErrorPx: globalDeepErrorPx
    };
  }

  const localWeight =
    local.length
    / (
      local.length
      + DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT
    );

  return {
    baselineExpectedErrorPx:
      localWeight * mean(local.map((point) => point.baselineErrorPx))
      + (1 - localWeight) * globalBaselineErrorPx,
    deepExpectedErrorPx:
      localWeight * mean(local.map((point) => point.deepErrorPx))
      + (1 - localWeight) * globalDeepErrorPx
  };
}

function nestedCrossValidation(
  observations: readonly ReliabilityObservation[]
): CalibrationEngineReliabilityCvDiagnostics {
  const pointResults:
    CalibrationEngineReliabilityCvPointResult[] = [];

  for (const heldOut of observations) {
    const training = observations.filter(
      (point) => point.pointIndex !== heldOut.pointIndex
    );

    const globalBaselineErrorPx = mean(
      training.map((point) => point.baselineErrorPx)
    );

    const globalDeepErrorPx = mean(
      training.map((point) => point.deepErrorPx)
    );

    const currentGlobalDeepWeight = deepWeightFromExpectedErrors(
      globalBaselineErrorPx,
      globalDeepErrorPx
    );

    const routingPoint = blendPoint(
      heldOut.baselineNormalizedPoint,
      heldOut.deepNormalizedPoint,
      currentGlobalDeepWeight
    );

    const routingBucket = classifyGazeScreenRegion(routingPoint);

    const currentErrorPrior = errorPriorForBucket(
      training,
      routingBucket,
      globalBaselineErrorPx,
      globalDeepErrorPx
    );

    const currentDeepWeight = deepWeightFromExpectedErrors(
      currentErrorPrior.baselineExpectedErrorPx,
      currentErrorPrior.deepExpectedErrorPx
    );

    const reliabilityGlobal = buildGlobalPrior(training);
    const reliabilityDirectional = buildDirectionalPrior(
      routingBucket,
      training,
      reliabilityGlobal
    );

    const reliabilityDeepWeight = reliabilityDirectional.deepWeight;

    const currentHybrid = blendPoint(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      currentDeepWeight
    );

    const reliabilityHybrid = blendPoint(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      reliabilityDeepWeight
    );

    const currentHybridErrorPx = pointErrorPx(
      currentHybrid,
      heldOut.targetViewportPoint
    );

    const reliabilityHybridErrorPx = pointErrorPx(
      reliabilityHybrid,
      heldOut.targetViewportPoint
    );

    pointResults.push({
      pointIndex: heldOut.pointIndex,
      routingBucket,
      currentDeepWeight,
      reliabilityDeepWeight,
      currentHybridErrorPx,
      reliabilityHybridErrorPx,
      improved: reliabilityHybridErrorPx < currentHybridErrorPx
    });
  }

  const currentErrors = pointResults.map(
    (point) => point.currentHybridErrorPx
  );

  const reliabilityErrors = pointResults.map(
    (point) => point.reliabilityHybridErrorPx
  );

  const currentMeanErrorPx = mean(currentErrors);
  const reliabilityMeanErrorPx = mean(reliabilityErrors);
  const currentP95ErrorPx = percentile(currentErrors, 0.95);
  const reliabilityP95ErrorPx = percentile(reliabilityErrors, 0.95);

  const routingEnabled =
    reliabilityMeanErrorPx < currentMeanErrorPx
    && reliabilityP95ErrorPx <= currentP95ErrorPx;

  return {
    pointCount: pointResults.length,
    currentMeanErrorPx,
    reliabilityMeanErrorPx,
    currentP95ErrorPx,
    reliabilityP95ErrorPx,
    currentRmsePx: rmse(currentErrors),
    reliabilityRmsePx: rmse(reliabilityErrors),
    improvedPointFraction: mean(
      pointResults.map((point) => point.improved ? 1 : 0)
    ),
    meanImprovementPx:
      currentMeanErrorPx - reliabilityMeanErrorPx,
    p95ImprovementPx:
      currentP95ErrorPx - reliabilityP95ErrorPx,
    routingEnabled,
    pointResults
  };
}

export function fitCalibrationEngineReliabilityModel(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  deepPoints: readonly DeepGroupedCvPointResult[]
): CalibrationEngineReliabilityFitResult {
  const observations = createObservations(
    baselinePoints,
    deepPoints
  );

  const globalPrior = buildGlobalPrior(observations);
  const directionalPriors = buildDirectionalPriors(
    observations,
    globalPrior
  );

  const crossValidation = nestedCrossValidation(observations);

  return {
    routingEnabled: crossValidation.routingEnabled,
    globalPrior,
    directionalPriors,
    crossValidation
  };
}

/**
 * Applies target-free live reliability penalties to a calibration-only routing
 * weight. Penalty ratios operate in inverse-variance space, matching the
 * established hybrid selector's reliability interpretation.
 */
export function adjustCalibrationReliabilityDeepWeight(
  calibrationDeepWeight: number,
  baselinePenaltyMultiplier: number,
  deepPenaltyMultiplier: number
): number {
  const base = clamp(calibrationDeepWeight, 0, 1);

  if (base <= NUMERIC_EPSILON) {
    return 0;
  }

  if (base >= 1 - NUMERIC_EPSILON) {
    return 1;
  }

  const baselinePenalty = Math.max(
    NUMERIC_EPSILON,
    baselinePenaltyMultiplier
  );

  const deepPenalty = Math.max(
    NUMERIC_EPSILON,
    deepPenaltyMultiplier
  );

  const odds = base / (1 - base);
  const adjustedOdds = odds * (
    baselinePenalty * baselinePenalty
    / (deepPenalty * deepPenalty)
  );

  return adjustedOdds / (1 + adjustedOdds);
}
