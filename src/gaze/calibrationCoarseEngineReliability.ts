import {
  DEEP_PERSONALIZATION,
  NUMERIC_EPSILON
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  CalibrationGroupedCvPointResult,
  CalibrationGroupedCvSpatialBucket
} from "../calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult
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

export interface CalibrationCoarseReliabilityPrior {
  readonly bucket: CalibrationGroupedCvSpatialBucket | "GLOBAL";
  readonly calibrationPointCount: number;
  readonly deepWinFraction: number;
  /** Positive means Deep had lower grouped-CV error than Baseline. */
  readonly medianDeepAdvantagePx: number;
  /** Robust spread of paired Deep advantage values. */
  readonly deepAdvantageMadPx: number;
  /** Median inverse-variance Deep weight from paired calibration errors. */
  readonly robustDeepWeightMedian: number;
  /** Shrunk target-free routing weight used by the live hybrid selector. */
  readonly deepWeight: number;
}

export interface CalibrationCoarseReliabilityCvPointResult {
  readonly pointIndex: number;
  readonly routingBucket: CalibrationGroupedCvSpatialBucket;
  readonly currentDeepWeight: number;
  readonly coarseReliabilityDeepWeight: number;
  readonly currentHybridErrorPx: number;
  readonly coarseReliabilityHybridErrorPx: number;
  readonly improved: boolean;
}

export interface CalibrationCoarseReliabilityCvDiagnostics {
  readonly pointCount: number;
  readonly currentMeanErrorPx: number;
  readonly coarseReliabilityMeanErrorPx: number;
  readonly currentP95ErrorPx: number;
  readonly coarseReliabilityP95ErrorPx: number;
  readonly currentRmsePx: number;
  readonly coarseReliabilityRmsePx: number;
  readonly improvedPointFraction: number;
  readonly meanImprovementPx: number;
  readonly p95ImprovementPx: number;
  readonly routingEnabled: boolean;
  readonly pointResults:
    readonly CalibrationCoarseReliabilityCvPointResult[];
}

export interface CalibrationCoarseReliabilityFitResult {
  readonly routingEnabled: boolean;
  readonly globalPrior: CalibrationCoarseReliabilityPrior;
  readonly bucketPriors: Readonly<
    Record<
      CalibrationGroupedCvSpatialBucket,
      CalibrationCoarseReliabilityPrior
    >
  >;
  readonly crossValidation: CalibrationCoarseReliabilityCvDiagnostics;
}

interface ReliabilityObservation {
  readonly pointIndex: number;
  readonly targetViewportPoint: Point2D;
  readonly baselineNormalizedPoint: Point2D;
  readonly baselineViewportPoint: Point2D;
  readonly baselineErrorPx: number;
  readonly deepNormalizedPoint: Point2D;
  readonly deepViewportPoint: Point2D;
  readonly deepErrorPx: number;
  readonly targetSpatialBucket: CalibrationGroupedCvSpatialBucket;
  readonly targetDirectionalBucket: GazeScreenRegion;
  readonly deepAdvantagePx: number;
  readonly pairedDeepWeight: number;
}

const SPATIAL_BUCKETS:
readonly CalibrationGroupedCvSpatialBucket[] = [
  "CENTER",
  "EDGE",
  "CORNER"
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
      "Coarse engine reliability model cannot average an empty set."
    );
  }

  return values.reduce((sum, value) => sum + value, 0)
    / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability model cannot compute an empty median."
    );
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const value = sorted[middle];

    if (value === undefined) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Coarse engine reliability median could not resolve its value."
      );
    }

    return value;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];

  if (lower === undefined || upper === undefined) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability median could not resolve its values."
    );
  }

  return (lower + upper) / 2;
}

function medianAbsoluteDeviation(
  values: readonly number[],
  center: number
): number {
  return median(
    values.map((value) => Math.abs(value - center))
  );
}

function percentile(
  values: readonly number[],
  probability: number
): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability model cannot compute an empty percentile."
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
      "Coarse engine reliability percentile could not resolve its values."
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

function pairedDeepWeight(
  baselineErrorPx: number,
  deepErrorPx: number
): number {
  const baseline = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    baselineErrorPx
  );

  const deep = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    deepErrorPx
  );

  const denominator = baseline * baseline + deep * deep;

  if (denominator <= NUMERIC_EPSILON) {
    return 0.5;
  }

  return clamp(
    (baseline * baseline) / denominator,
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

function coarseBucketFromRegion(
  region: GazeScreenRegion
): CalibrationGroupedCvSpatialBucket {
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
        "Coarse engine reliability requires matched Baseline and Deep grouped-CV points.",
        { details: { pointIndex: baseline.pointIndex } }
      );
    }

    return {
      pointIndex: baseline.pointIndex,
      targetViewportPoint: baseline.targetViewportPoint,
      baselineNormalizedPoint: baseline.predictedNormalizedPoint,
      baselineViewportPoint: baseline.predictedViewportPoint,
      baselineErrorPx: baseline.errorPx,
      deepNormalizedPoint: deep.predictedNormalizedPoint,
      deepViewportPoint: deep.predictedViewportPoint,
      deepErrorPx: deep.errorPx,
      targetSpatialBucket: baseline.spatialBucket,
      targetDirectionalBucket: classifyGazeScreenRegion(
        baseline.targetNormalizedPoint
      ),
      deepAdvantagePx: baseline.errorPx - deep.errorPx,
      pairedDeepWeight: pairedDeepWeight(
        baseline.errorPx,
        deep.errorPx
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
      "Coarse engine reliability routing requires the complete grouped calibration set."
    );
  }

  return observations;
}

function rawPriorStatistics(
  bucket: CalibrationGroupedCvSpatialBucket | "GLOBAL",
  observations: readonly ReliabilityObservation[]
): CalibrationCoarseReliabilityPrior {
  if (observations.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability prior requires calibration observations."
    );
  }

  const advantages = observations.map(
    (point) => point.deepAdvantagePx
  );

  const medianDeepAdvantagePx = median(advantages);
  const robustDeepWeightMedian = median(
    observations.map((point) => point.pairedDeepWeight)
  );

  return {
    bucket,
    calibrationPointCount: observations.length,
    deepWinFraction: mean(
      observations.map(
        (point) => point.deepErrorPx < point.baselineErrorPx ? 1 : 0
      )
    ),
    medianDeepAdvantagePx,
    deepAdvantageMadPx: medianAbsoluteDeviation(
      advantages,
      medianDeepAdvantagePx
    ),
    robustDeepWeightMedian,
    deepWeight: robustDeepWeightMedian
  };
}

function buildGlobalPrior(
  observations: readonly ReliabilityObservation[]
): CalibrationCoarseReliabilityPrior {
  const raw = rawPriorStatistics("GLOBAL", observations);

  const evidenceWeight =
    observations.length
    / (
      observations.length
      + DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT
    );

  return {
    ...raw,
    deepWeight:
      evidenceWeight * raw.robustDeepWeightMedian
      + (1 - evidenceWeight) * 0.5
  };
}

function buildBucketPrior(
  bucket: CalibrationGroupedCvSpatialBucket,
  observations: readonly ReliabilityObservation[],
  globalPrior: CalibrationCoarseReliabilityPrior
): CalibrationCoarseReliabilityPrior {
  const local = observations.filter(
    (point) => point.targetSpatialBucket === bucket
  );

  if (local.length === 0) {
    return {
      ...globalPrior,
      bucket,
      calibrationPointCount: 0
    };
  }

  const raw = rawPriorStatistics(bucket, local);
  const localWeight =
    local.length
    / (
      local.length
      + DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT
    );

  return {
    ...raw,
    deepWeight:
      localWeight * raw.robustDeepWeightMedian
      + (1 - localWeight) * globalPrior.deepWeight
  };
}

function buildBucketPriors(
  observations: readonly ReliabilityObservation[],
  globalPrior: CalibrationCoarseReliabilityPrior
): Readonly<
  Record<
    CalibrationGroupedCvSpatialBucket,
    CalibrationCoarseReliabilityPrior
  >
> {
  return Object.fromEntries(
    SPATIAL_BUCKETS.map(
      (bucket) => [
        bucket,
        buildBucketPrior(bucket, observations, globalPrior)
      ] as const
    )
  ) as Readonly<
    Record<
      CalibrationGroupedCvSpatialBucket,
      CalibrationCoarseReliabilityPrior
    >
  >;
}

function directionalErrorPrior(
  observations: readonly ReliabilityObservation[],
  bucket: GazeScreenRegion,
  globalBaselineErrorPx: number,
  globalDeepErrorPx: number
): {
  readonly baselineExpectedErrorPx: number;
  readonly deepExpectedErrorPx: number;
} {
  const local = observations.filter(
    (point) => point.targetDirectionalBucket === bucket
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
): CalibrationCoarseReliabilityCvDiagnostics {
  const pointResults:
    CalibrationCoarseReliabilityCvPointResult[] = [];

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

    const directionalBucket = classifyGazeScreenRegion(routingPoint);
    const routingBucket = coarseBucketFromRegion(directionalBucket);

    const currentErrorPrior = directionalErrorPrior(
      training,
      directionalBucket,
      globalBaselineErrorPx,
      globalDeepErrorPx
    );

    const currentDeepWeight = deepWeightFromExpectedErrors(
      currentErrorPrior.baselineExpectedErrorPx,
      currentErrorPrior.deepExpectedErrorPx
    );

    const globalPrior = buildGlobalPrior(training);
    const bucketPrior = buildBucketPrior(
      routingBucket,
      training,
      globalPrior
    );

    const coarseReliabilityDeepWeight = bucketPrior.deepWeight;

    const currentHybrid = blendPoint(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      currentDeepWeight
    );

    const coarseReliabilityHybrid = blendPoint(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      coarseReliabilityDeepWeight
    );

    const currentHybridErrorPx = pointErrorPx(
      currentHybrid,
      heldOut.targetViewportPoint
    );

    const coarseReliabilityHybridErrorPx = pointErrorPx(
      coarseReliabilityHybrid,
      heldOut.targetViewportPoint
    );

    pointResults.push({
      pointIndex: heldOut.pointIndex,
      routingBucket,
      currentDeepWeight,
      coarseReliabilityDeepWeight,
      currentHybridErrorPx,
      coarseReliabilityHybridErrorPx,
      improved: coarseReliabilityHybridErrorPx < currentHybridErrorPx
    });
  }

  const currentErrors = pointResults.map(
    (point) => point.currentHybridErrorPx
  );

  const coarseErrors = pointResults.map(
    (point) => point.coarseReliabilityHybridErrorPx
  );

  const currentMeanErrorPx = mean(currentErrors);
  const coarseReliabilityMeanErrorPx = mean(coarseErrors);
  const currentP95ErrorPx = percentile(currentErrors, 0.95);
  const coarseReliabilityP95ErrorPx = percentile(coarseErrors, 0.95);

  const routingEnabled =
    coarseReliabilityMeanErrorPx < currentMeanErrorPx
    && coarseReliabilityP95ErrorPx <= currentP95ErrorPx;

  return {
    pointCount: pointResults.length,
    currentMeanErrorPx,
    coarseReliabilityMeanErrorPx,
    currentP95ErrorPx,
    coarseReliabilityP95ErrorPx,
    currentRmsePx: rmse(currentErrors),
    coarseReliabilityRmsePx: rmse(coarseErrors),
    improvedPointFraction: mean(
      pointResults.map((point) => point.improved ? 1 : 0)
    ),
    meanImprovementPx:
      currentMeanErrorPx - coarseReliabilityMeanErrorPx,
    p95ImprovementPx:
      currentP95ErrorPx - coarseReliabilityP95ErrorPx,
    routingEnabled,
    pointResults
  };
}

export function fitCalibrationCoarseEngineReliabilityModel(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  deepPoints: readonly DeepGroupedCvPointResult[]
): CalibrationCoarseReliabilityFitResult {
  const observations = createObservations(
    baselinePoints,
    deepPoints
  );

  const globalPrior = buildGlobalPrior(observations);
  const bucketPriors = buildBucketPriors(
    observations,
    globalPrior
  );

  const crossValidation = nestedCrossValidation(observations);

  return {
    routingEnabled: crossValidation.routingEnabled,
    globalPrior,
    bucketPriors,
    crossValidation
  };
}
