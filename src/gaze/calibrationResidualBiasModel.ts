import {
  DEEP_PERSONALIZATION,
  NUMERIC_EPSILON
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  Point2D
} from "../shared/types";

import {
  classifyGazeScreenRegion
} from "./gazeRegionEstimator";

import type {
  GazeScreenRegion
} from "./gazeRegionEstimator";

export interface CalibrationResidualSourcePoint {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly predictedNormalizedPoint: Point2D;
  readonly predictedViewportPoint: Point2D;
}

export interface CalibrationResidualBiasPrior {
  readonly bucket: GazeScreenRegion | "GLOBAL";
  readonly calibrationPointCount: number;
  readonly meanResidualNormalized: Point2D;
  readonly meanResidualViewportPx: Point2D;
  readonly varianceXPx2: number;
  readonly varianceYPx2: number;
  readonly covarianceXYPx2: number;
  readonly residualRmsPx: number;
}

export interface CalibrationResidualBiasCvPointResult {
  readonly pointIndex: number;
  readonly routingBucket: GazeScreenRegion;
  readonly rawErrorPx: number;
  readonly fullStrengthCorrectedErrorPx: number;
  readonly correctedErrorPx: number;
  readonly correctionStrength: number;
  readonly correctionNormalized: Point2D;
  readonly correctionViewportPx: Point2D;
  readonly correctedNormalizedPoint: Point2D;
  readonly correctedViewportPoint: Point2D;
  readonly improved: boolean;
}

export interface CalibrationResidualBiasStrengthDiagnostics {
  readonly pointCount: number;
  readonly medianOptimalStrength: number;
  readonly fullCorrectionImprovedPointFraction: number;
  readonly medianFullCorrectionImprovementPx: number;
  readonly fullCorrectionImprovementMadPx: number;
  readonly selectedCorrectionStrength: number;
}

export interface CalibrationResidualBiasCvDiagnostics {
  readonly pointCount: number;
  readonly rawMeanErrorPx: number;
  readonly fullStrengthCorrectedMeanErrorPx: number;
  readonly correctedMeanErrorPx: number;
  readonly rawP95ErrorPx: number;
  readonly fullStrengthCorrectedP95ErrorPx: number;
  readonly correctedP95ErrorPx: number;
  readonly rawRmsePx: number;
  readonly fullStrengthCorrectedRmsePx: number;
  readonly correctedRmsePx: number;
  readonly meanCorrectionStrength: number;
  readonly improvedPointFraction: number;
  readonly meanImprovementPx: number;
  readonly p95ImprovementPx: number;
  readonly correctionEnabled: boolean;
  readonly pointResults:
    readonly CalibrationResidualBiasCvPointResult[];
}

export interface EngineCalibrationResidualBiasFit {
  readonly correctionEnabled: boolean;
  readonly correctionStrength: number;
  readonly strengthDiagnostics:
    CalibrationResidualBiasStrengthDiagnostics;
  readonly globalPrior: CalibrationResidualBiasPrior;
  readonly directionalPriors:
    Readonly<Record<GazeScreenRegion, CalibrationResidualBiasPrior>>;
  readonly crossValidation: CalibrationResidualBiasCvDiagnostics;
}

export interface CalibrationResidualBiasFitResult {
  readonly baseline: EngineCalibrationResidualBiasFit;
  readonly deep: EngineCalibrationResidualBiasFit;
}

export interface ResidualBiasCorrectionResult {
  readonly applied: boolean;
  readonly directionalBucket: GazeScreenRegion;
  readonly correctionStrength: number;
  readonly correctionNormalized: Point2D;
  readonly correctedNormalizedPoint: Point2D;
}

interface ResidualObservation {
  readonly source: CalibrationResidualSourcePoint;
  readonly targetBucket: GazeScreenRegion;
  readonly residualNormalized: Point2D;
  readonly residualViewportPx: Point2D;
  readonly rawErrorPx: number;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
}

const DIRECTIONAL_BUCKETS:
readonly GazeScreenRegion[] = [
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
    return 0;
  }

  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];

  if (upper === undefined) {
    return 0;
  }

  if (sorted.length % 2 === 1) {
    return upper;
  }

  const lower = sorted[middle - 1];
  return lower === undefined
    ? upper
    : (lower + upper) / 2;
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
  if (
    values.length === 0
    || probability < 0
    || probability > 1
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias diagnostics received an invalid percentile request."
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
      "Residual-bias percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function inferViewportDimension(
  targetViewportValue: number,
  targetNormalizedValue: number,
  predictedViewportValue: number,
  predictedNormalizedValue: number
): number {
  if (Math.abs(targetNormalizedValue) > NUMERIC_EPSILON) {
    const fromTarget = targetViewportValue / targetNormalizedValue;

    if (Number.isFinite(fromTarget) && fromTarget > 0) {
      return fromTarget;
    }
  }

  if (Math.abs(predictedNormalizedValue) > NUMERIC_EPSILON) {
    const fromPrediction =
      predictedViewportValue / predictedNormalizedValue;

    if (Number.isFinite(fromPrediction) && fromPrediction > 0) {
      return fromPrediction;
    }
  }

  throw new TrackerError(
    ERROR_CODES.CALIBRATION_MODEL_FAILED,
    "CALIBRATION",
    "Residual-bias model could not infer the calibration viewport size."
  );
}

function toObservation(
  point: CalibrationResidualSourcePoint
): ResidualObservation {
  const viewportWidthPx = inferViewportDimension(
    point.targetViewportPoint.x,
    point.targetNormalizedPoint.x,
    point.predictedViewportPoint.x,
    point.predictedNormalizedPoint.x
  );

  const viewportHeightPx = inferViewportDimension(
    point.targetViewportPoint.y,
    point.targetNormalizedPoint.y,
    point.predictedViewportPoint.y,
    point.predictedNormalizedPoint.y
  );

  const residualNormalized = {
    x:
      point.targetNormalizedPoint.x
      - point.predictedNormalizedPoint.x,
    y:
      point.targetNormalizedPoint.y
      - point.predictedNormalizedPoint.y
  };

  const residualViewportPx = {
    x:
      point.targetViewportPoint.x
      - point.predictedViewportPoint.x,
    y:
      point.targetViewportPoint.y
      - point.predictedViewportPoint.y
  };

  const rawErrorPx = Math.hypot(
    residualViewportPx.x,
    residualViewportPx.y
  );

  return {
    source: point,
    targetBucket:
      classifyGazeScreenRegion(point.targetNormalizedPoint),
    residualNormalized,
    residualViewportPx,
    rawErrorPx,
    viewportWidthPx,
    viewportHeightPx
  };
}

function covarianceStatistics(
  observations: readonly ResidualObservation[]
): {
  readonly varianceXPx2: number;
  readonly varianceYPx2: number;
  readonly covarianceXYPx2: number;
  readonly residualRmsPx: number;
} {
  if (observations.length === 0) {
    return {
      varianceXPx2: 0,
      varianceYPx2: 0,
      covarianceXYPx2: 0,
      residualRmsPx: 0
    };
  }

  const meanX = mean(
    observations.map(
      (item) => item.residualViewportPx.x
    )
  );

  const meanY = mean(
    observations.map(
      (item) => item.residualViewportPx.y
    )
  );

  const denominator = Math.max(
    1,
    observations.length - 1
  );

  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumSquaredMagnitude = 0;

  for (const observation of observations) {
    const centeredX =
      observation.residualViewportPx.x - meanX;
    const centeredY =
      observation.residualViewportPx.y - meanY;

    sumX2 += centeredX * centeredX;
    sumY2 += centeredY * centeredY;
    sumXY += centeredX * centeredY;

    sumSquaredMagnitude +=
      observation.residualViewportPx.x
        * observation.residualViewportPx.x
      + observation.residualViewportPx.y
        * observation.residualViewportPx.y;
  }

  return {
    varianceXPx2: sumX2 / denominator,
    varianceYPx2: sumY2 / denominator,
    covarianceXYPx2: sumXY / denominator,
    residualRmsPx: Math.sqrt(
      sumSquaredMagnitude / observations.length
    )
  };
}

function meanResidualNormalized(
  observations: readonly ResidualObservation[]
): Point2D {
  return {
    x: mean(
      observations.map(
        (item) => item.residualNormalized.x
      )
    ),
    y: mean(
      observations.map(
        (item) => item.residualNormalized.y
      )
    )
  };
}

function meanResidualViewportPx(
  observations: readonly ResidualObservation[]
): Point2D {
  return {
    x: mean(
      observations.map(
        (item) => item.residualViewportPx.x
      )
    ),
    y: mean(
      observations.map(
        (item) => item.residualViewportPx.y
      )
    )
  };
}

function buildPrior(
  bucket: CalibrationResidualBiasPrior["bucket"],
  allObservations: readonly ResidualObservation[],
  pseudoCount: number
): CalibrationResidualBiasPrior {
  if (allObservations.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Residual-bias model requires calibration observations."
    );
  }

  const globalNormalized =
    meanResidualNormalized(allObservations);
  const globalViewport =
    meanResidualViewportPx(allObservations);
  const globalCovariance =
    covarianceStatistics(allObservations);

  if (bucket === "GLOBAL") {
    return {
      bucket,
      calibrationPointCount: allObservations.length,
      meanResidualNormalized: globalNormalized,
      meanResidualViewportPx: globalViewport,
      ...globalCovariance
    };
  }

  const local = allObservations.filter(
    (item) => item.targetBucket === bucket
  );

  if (local.length === 0) {
    return {
      bucket,
      calibrationPointCount: 0,
      meanResidualNormalized: globalNormalized,
      meanResidualViewportPx: globalViewport,
      ...globalCovariance
    };
  }

  const localNormalized = meanResidualNormalized(local);
  const localViewport = meanResidualViewportPx(local);
  const localCovariance = covarianceStatistics(local);

  const localWeight =
    local.length / (local.length + pseudoCount);
  const globalWeight = 1 - localWeight;

  return {
    bucket,
    calibrationPointCount: local.length,
    meanResidualNormalized: {
      x:
        localWeight * localNormalized.x
        + globalWeight * globalNormalized.x,
      y:
        localWeight * localNormalized.y
        + globalWeight * globalNormalized.y
    },
    meanResidualViewportPx: {
      x:
        localWeight * localViewport.x
        + globalWeight * globalViewport.x,
      y:
        localWeight * localViewport.y
        + globalWeight * globalViewport.y
    },
    varianceXPx2:
      localWeight * localCovariance.varianceXPx2
      + globalWeight * globalCovariance.varianceXPx2,
    varianceYPx2:
      localWeight * localCovariance.varianceYPx2
      + globalWeight * globalCovariance.varianceYPx2,
    covarianceXYPx2:
      localWeight * localCovariance.covarianceXYPx2
      + globalWeight * globalCovariance.covarianceXYPx2,
    residualRmsPx:
      localWeight * localCovariance.residualRmsPx
      + globalWeight * globalCovariance.residualRmsPx
  };
}

function buildDirectionalPriors(
  observations: readonly ResidualObservation[]
): Readonly<Record<GazeScreenRegion, CalibrationResidualBiasPrior>> {
  return Object.fromEntries(
    DIRECTIONAL_BUCKETS.map(
      (bucket) => [
        bucket,
        buildPrior(
          bucket,
          observations,
          DEEP_PERSONALIZATION
            .HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT
        )
      ] as const
    )
  ) as Readonly<
    Record<GazeScreenRegion, CalibrationResidualBiasPrior>
  >;
}

function correctedPoint(
  observation: ResidualObservation,
  correctionNormalized: Point2D
): {
  readonly normalized: Point2D;
  readonly viewport: Point2D;
} {
  const normalized = {
    x: clamp(
      observation.source.predictedNormalizedPoint.x
        + correctionNormalized.x,
      0,
      1
    ),
    y: clamp(
      observation.source.predictedNormalizedPoint.y
        + correctionNormalized.y,
      0,
      1
    )
  };

  return {
    normalized,
    viewport: {
      x: normalized.x * observation.viewportWidthPx,
      y: normalized.y * observation.viewportHeightPx
    }
  };
}

interface CorrectionStrengthEstimate {
  readonly diagnostics: CalibrationResidualBiasStrengthDiagnostics;
}

function optimalCorrectionStrength(
  observation: ResidualObservation,
  correctionNormalized: Point2D
): number {
  const correctionViewportPx = {
    x: correctionNormalized.x * observation.viewportWidthPx,
    y: correctionNormalized.y * observation.viewportHeightPx
  };

  const denominator =
    correctionViewportPx.x * correctionViewportPx.x
    + correctionViewportPx.y * correctionViewportPx.y;

  if (denominator <= NUMERIC_EPSILON) {
    return 0;
  }

  const numerator =
    observation.residualViewportPx.x * correctionViewportPx.x
    + observation.residualViewportPx.y * correctionViewportPx.y;

  return clamp(numerator / denominator, 0, 1);
}

function estimateCorrectionStrength(
  observations: readonly ResidualObservation[]
): CorrectionStrengthEstimate {
  if (observations.length < 2) {
    return {
      diagnostics: {
        pointCount: observations.length,
        medianOptimalStrength: 0,
        fullCorrectionImprovedPointFraction: 0,
        medianFullCorrectionImprovementPx: 0,
        fullCorrectionImprovementMadPx: 0,
        selectedCorrectionStrength: 0
      }
    };
  }

  const optimalStrengths: number[] = [];
  const fullCorrectionImprovementsPx: number[] = [];

  for (const heldOut of observations) {
    const training = observations.filter(
      (item) =>
        item.source.pointIndex !== heldOut.source.pointIndex
    );

    if (training.length === 0) {
      continue;
    }

    const priors = buildDirectionalPriors(training);
    const routingBucket = classifyGazeScreenRegion(
      heldOut.source.predictedNormalizedPoint
    );
    const correctionNormalized =
      priors[routingBucket].meanResidualNormalized;

    const fullStrength = correctedPoint(
      heldOut,
      correctionNormalized
    );

    const fullStrengthErrorPx = Math.hypot(
      fullStrength.viewport.x
        - heldOut.source.targetViewportPoint.x,
      fullStrength.viewport.y
        - heldOut.source.targetViewportPoint.y
    );

    optimalStrengths.push(
      optimalCorrectionStrength(
        heldOut,
        correctionNormalized
      )
    );

    fullCorrectionImprovementsPx.push(
      heldOut.rawErrorPx - fullStrengthErrorPx
    );
  }

  const medianOptimalStrength = median(optimalStrengths);
  const medianFullCorrectionImprovementPx = median(
    fullCorrectionImprovementsPx
  );
  const fullCorrectionImprovementMadPx =
    medianAbsoluteDeviation(
      fullCorrectionImprovementsPx,
      medianFullCorrectionImprovementPx
    );
  const fullCorrectionImprovedPointFraction = mean(
    fullCorrectionImprovementsPx.map(
      (improvement) => improvement > 0 ? 1 : 0
    )
  );

  const positiveMedianImprovementPx = Math.max(
    0,
    medianFullCorrectionImprovementPx
  );

  // D16-D conservative shrinkage. The strength is learned only from
  // calibration inner-LOPO evidence. Consistent positive full-strength
  // improvement preserves alpha near the robust optimal value; mixed or
  // high-dispersion evidence shrinks alpha toward zero.
  const improvementConsistency =
    positiveMedianImprovementPx <= NUMERIC_EPSILON
      ? 0
      : fullCorrectionImprovedPointFraction
        * positiveMedianImprovementPx
        / (
          positiveMedianImprovementPx
          + fullCorrectionImprovementMadPx
          + NUMERIC_EPSILON
        );

  const selectedCorrectionStrength = clamp(
    medianOptimalStrength * improvementConsistency,
    0,
    1
  );

  return {
    diagnostics: {
      pointCount: optimalStrengths.length,
      medianOptimalStrength,
      fullCorrectionImprovedPointFraction,
      medianFullCorrectionImprovementPx,
      fullCorrectionImprovementMadPx,
      selectedCorrectionStrength
    }
  };
}

function fitEngine(
  sourcePoints: readonly CalibrationResidualSourcePoint[]
): EngineCalibrationResidualBiasFit {
  if (
    sourcePoints.length
    < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Residual-bias model requires enough grouped calibration points.",
      {
        details: {
          pointCount: sourcePoints.length,
          requiredPointCount:
            DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT
        }
      }
    );
  }

  const observations = sourcePoints.map(toObservation);
  const cvPointResults:
    CalibrationResidualBiasCvPointResult[] = [];

  for (const heldOut of observations) {
    const training = observations.filter(
      (item) =>
        item.source.pointIndex
        !== heldOut.source.pointIndex
    );

    if (training.length === 0) {
      continue;
    }

    const directionalPriors =
      buildDirectionalPriors(training);

    // The held-out calibration target is deliberately NOT used for routing
    // or alpha selection. Alpha is estimated by a second, inner LOPO over
    // the outer-training points only.
    const strengthEstimate =
      estimateCorrectionStrength(training);
    const correctionStrength =
      strengthEstimate.diagnostics.selectedCorrectionStrength;

    const routingBucket = classifyGazeScreenRegion(
      heldOut.source.predictedNormalizedPoint
    );

    const prior = directionalPriors[routingBucket];
    const fullStrengthCorrectionNormalized = {
      ...prior.meanResidualNormalized
    };

    const fullStrengthCorrected = correctedPoint(
      heldOut,
      fullStrengthCorrectionNormalized
    );

    const fullStrengthCorrectedErrorPx = Math.hypot(
      fullStrengthCorrected.viewport.x
        - heldOut.source.targetViewportPoint.x,
      fullStrengthCorrected.viewport.y
        - heldOut.source.targetViewportPoint.y
    );

    const correctionNormalized = {
      x:
        correctionStrength
        * fullStrengthCorrectionNormalized.x,
      y:
        correctionStrength
        * fullStrengthCorrectionNormalized.y
    };

    const corrected = correctedPoint(
      heldOut,
      correctionNormalized
    );

    const correctedErrorPx = Math.hypot(
      corrected.viewport.x
        - heldOut.source.targetViewportPoint.x,
      corrected.viewport.y
        - heldOut.source.targetViewportPoint.y
    );

    cvPointResults.push({
      pointIndex: heldOut.source.pointIndex,
      routingBucket,
      rawErrorPx: heldOut.rawErrorPx,
      fullStrengthCorrectedErrorPx,
      correctedErrorPx,
      correctionStrength,
      correctionNormalized,
      correctionViewportPx: {
        x:
          correctionNormalized.x
          * heldOut.viewportWidthPx,
        y:
          correctionNormalized.y
          * heldOut.viewportHeightPx
      },
      correctedNormalizedPoint: corrected.normalized,
      correctedViewportPoint: corrected.viewport,
      improved: correctedErrorPx < heldOut.rawErrorPx
    });
  }

  if (cvPointResults.length !== observations.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias grouped diagnostics are incomplete."
    );
  }

  const rawErrors = cvPointResults.map(
    (item) => item.rawErrorPx
  );
  const fullStrengthCorrectedErrors = cvPointResults.map(
    (item) => item.fullStrengthCorrectedErrorPx
  );
  const correctedErrors = cvPointResults.map(
    (item) => item.correctedErrorPx
  );

  const rawMeanErrorPx = mean(rawErrors);
  const fullStrengthCorrectedMeanErrorPx = mean(
    fullStrengthCorrectedErrors
  );
  const correctedMeanErrorPx = mean(correctedErrors);
  const rawP95ErrorPx = percentile(rawErrors, 0.95);
  const fullStrengthCorrectedP95ErrorPx = percentile(
    fullStrengthCorrectedErrors,
    0.95
  );
  const correctedP95ErrorPx = percentile(
    correctedErrors,
    0.95
  );
  const rawRmsePx = Math.sqrt(
    mean(rawErrors.map((value) => value * value))
  );
  const fullStrengthCorrectedRmsePx = Math.sqrt(
    mean(
      fullStrengthCorrectedErrors.map(
        (value) => value * value
      )
    )
  );
  const correctedRmsePx = Math.sqrt(
    mean(correctedErrors.map((value) => value * value))
  );

  const finalStrengthEstimate =
    estimateCorrectionStrength(observations);
  const correctionStrength =
    finalStrengthEstimate.diagnostics.selectedCorrectionStrength;

  // This gate is calibration-only model selection. D16-D uses the outer
  // nested shrinkage result, never independent validation, and also requires
  // a non-zero strength estimated from all calibration observations.
  const correctionEnabled =
    correctionStrength > NUMERIC_EPSILON
    && correctedMeanErrorPx < rawMeanErrorPx
    && correctedP95ErrorPx <= rawP95ErrorPx;

  const crossValidation: CalibrationResidualBiasCvDiagnostics = {
    pointCount: cvPointResults.length,
    rawMeanErrorPx,
    fullStrengthCorrectedMeanErrorPx,
    correctedMeanErrorPx,
    rawP95ErrorPx,
    fullStrengthCorrectedP95ErrorPx,
    correctedP95ErrorPx,
    rawRmsePx,
    fullStrengthCorrectedRmsePx,
    correctedRmsePx,
    meanCorrectionStrength: mean(
      cvPointResults.map((item) => item.correctionStrength)
    ),
    improvedPointFraction: mean(
      cvPointResults.map((item) => item.improved ? 1 : 0)
    ),
    meanImprovementPx:
      rawMeanErrorPx - correctedMeanErrorPx,
    p95ImprovementPx:
      rawP95ErrorPx - correctedP95ErrorPx,
    correctionEnabled,
    pointResults: cvPointResults
  };

  return {
    correctionEnabled,
    correctionStrength,
    strengthDiagnostics: finalStrengthEstimate.diagnostics,
    globalPrior: buildPrior(
      "GLOBAL",
      observations,
      0
    ),
    directionalPriors:
      buildDirectionalPriors(observations),
    crossValidation
  };
}

export function fitCalibrationResidualBiasModel(
  baselinePoints:
    readonly CalibrationResidualSourcePoint[],
  deepPoints:
    readonly CalibrationResidualSourcePoint[]
): CalibrationResidualBiasFitResult {
  if (baselinePoints.length !== deepPoints.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias model requires matched baseline and deep grouped-CV points."
    );
  }

  const baselineIndices = new Set(
    baselinePoints.map((point) => point.pointIndex)
  );

  if (
    deepPoints.some(
      (point) => !baselineIndices.has(point.pointIndex)
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias baseline/deep calibration point indices do not match."
    );
  }

  return {
    baseline: fitEngine(baselinePoints),
    deep: fitEngine(deepPoints)
  };
}

export function applyCalibrationResidualBias(
  point: Point2D,
  fit: EngineCalibrationResidualBiasFit,
  directionalBucket: GazeScreenRegion,
  directionalPriorReliability: number
): ResidualBiasCorrectionResult {
  if (!fit.correctionEnabled) {
    return {
      applied: false,
      directionalBucket,
      correctionStrength: 0,
      correctionNormalized: { x: 0, y: 0 },
      correctedNormalizedPoint: { ...point }
    };
  }

  const localPrior = fit.directionalPriors[directionalBucket];
  const globalPrior = fit.globalPrior;
  const reliability = clamp(
    directionalPriorReliability,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY,
    1
  );

  const blendedCorrectionNormalized = {
    x:
      reliability * localPrior.meanResidualNormalized.x
      + (1 - reliability)
        * globalPrior.meanResidualNormalized.x,
    y:
      reliability * localPrior.meanResidualNormalized.y
      + (1 - reliability)
        * globalPrior.meanResidualNormalized.y
  };

  const correctionStrength = fit.correctionStrength;
  const correctionNormalized = {
    x: correctionStrength * blendedCorrectionNormalized.x,
    y: correctionStrength * blendedCorrectionNormalized.y
  };

  return {
    applied: true,
    directionalBucket,
    correctionStrength,
    correctionNormalized,
    correctedNormalizedPoint: {
      x: clamp(point.x + correctionNormalized.x, 0, 1),
      y: clamp(point.y + correctionNormalized.y, 0, 1)
    }
  };
}
