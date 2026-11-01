import {
  CALIBRATION,
  CALIBRATION_VALIDATION_THRESHOLDS
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  CalibrationPointResult,
  CalibrationQualityLevel,
  CalibrationValidationMetrics,
  Point2D,
  Size2D
} from "../shared/types";

import type {
  CalibrationCleanedPoint
} from "./calibrationCleaner";

import type {
  CalibrationModel
} from "./calibrationModel";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export interface CalibrationValidationResult {
  readonly metrics: CalibrationValidationMetrics;
  readonly quality: CalibrationQualityLevel;
  readonly pointResults:
    readonly CalibrationPointResult[];
}

type SpatialBucket =
  | "CENTER"
  | "EDGE"
  | "CORNER";

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function assertViewport(
  viewport: Size2D
): void {
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration validation requires a positive finite viewport size."
    );
  }
}

function mean(
  values: readonly number[]
): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration validation metric has no values."
    );
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
}

function median(
  values: readonly number[]
): number {
  return percentile(values, 0.5);
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
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration percentile request is invalid."
    );
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const position =
    (sorted.length - 1)
    * probability;

  const lowerIndex =
    Math.floor(position);

  const upperIndex =
    Math.ceil(position);

  const lower =
    sorted[lowerIndex];

  const upper =
    sorted[upperIndex];

  if (
    lower === undefined
    || upper === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration percentile could not resolve its sample values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const fraction =
    position - lowerIndex;

  return (
    lower
    + (upper - lower) * fraction
  );
}

function toViewportPoint(
  normalized: Point2D,
  viewport: Size2D
): Point2D {
  return {
    x: normalized.x * viewport.width,
    y: normalized.y * viewport.height
  };
}


function correctedSamplePrecisionDistances(
  point: CalibrationCleanedPoint,
  model: CalibrationModel,
  viewport: Size2D
): readonly number[] {
  const correctedSamples =
    point.samples
      .filter(
        (sample) =>
          sample.accepted
          && sample.rawGazeSpace
            === "NORMALIZED"
      )
      .map(
        (sample) =>
          toViewportPoint(
            model.predict(
              sample.rawGazePoint
            ),
            viewport
          )
      );

  if (correctedSamples.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Independent validation point has no accepted samples for precision analysis.",
      {
        details: {
          pointIndex: point.pointIndex
        }
      }
    );
  }

  const center = {
    x: mean(
      correctedSamples.map(
        (sample) => sample.x
      )
    ),
    y: mean(
      correctedSamples.map(
        (sample) => sample.y
      )
    )
  };

  return correctedSamples.map(
    (sample) =>
      Math.hypot(
        sample.x - center.x,
        sample.y - center.y
      )
  );
}

function sampleValidityRatio(
  points: readonly CalibrationCleanedPoint[]
): number {
  let accepted = 0;
  let total = 0;

  for (const point of points) {
    accepted +=
      point.acceptedSampleCount;

    total +=
      point.acceptedSampleCount
      + point.rejectedSampleCount;
  }

  if (total <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Independent validation has no stored samples for validity analysis."
    );
  }

  return accepted / total;
}

function classifySpatialBucket(
  point: Point2D
): SpatialBucket {
  const horizontalOuter =
    point.x <= 0.33
    || point.x >= 0.67;

  const verticalOuter =
    point.y <= 0.33
    || point.y >= 0.67;

  if (
    horizontalOuter
    && verticalOuter
  ) {
    return "CORNER";
  }

  if (
    horizontalOuter
    || verticalOuter
  ) {
    return "EDGE";
  }

  return "CENTER";
}

export function classifyCalibrationValidationQuality(
  metrics: CalibrationValidationMetrics
): CalibrationQualityLevel {
  const thresholds =
    CALIBRATION_VALIDATION_THRESHOLDS;

  const meetsGood =
    metrics.meanErrorViewportWidthRatio
      <= thresholds
        .GOOD_MAX_MEAN_ERROR_WIDTH_RATIO
    && metrics.p95ErrorViewportWidthRatio
      <= thresholds
        .GOOD_MAX_P95_ERROR_WIDTH_RATIO
    && metrics.meanPrecisionViewportWidthRatio
      <= thresholds
        .GOOD_MAX_MEAN_PRECISION_WIDTH_RATIO
    && metrics.p95PrecisionViewportWidthRatio
      <= thresholds
        .GOOD_MAX_P95_PRECISION_WIDTH_RATIO
    && metrics.validSampleRatio
      >= thresholds
        .GOOD_MIN_VALID_SAMPLE_RATIO;

  if (meetsGood) {
    return "GOOD";
  }

  const meetsAcceptable =
    metrics.meanErrorViewportWidthRatio
      <= thresholds
        .ACCEPTABLE_MAX_MEAN_ERROR_WIDTH_RATIO
    && metrics.p95ErrorViewportWidthRatio
      <= thresholds
        .ACCEPTABLE_MAX_P95_ERROR_WIDTH_RATIO
    && metrics.meanPrecisionViewportWidthRatio
      <= thresholds
        .ACCEPTABLE_MAX_MEAN_PRECISION_WIDTH_RATIO
    && metrics.p95PrecisionViewportWidthRatio
      <= thresholds
        .ACCEPTABLE_MAX_P95_PRECISION_WIDTH_RATIO
    && metrics.validSampleRatio
      >= thresholds
        .ACCEPTABLE_MIN_VALID_SAMPLE_RATIO;

  if (meetsAcceptable) {
    return "ACCEPTABLE";
  }

  const meetsPoor =
    metrics.meanErrorViewportWidthRatio
      <= thresholds
        .POOR_MAX_MEAN_ERROR_WIDTH_RATIO
    && metrics.p95ErrorViewportWidthRatio
      <= thresholds
        .POOR_MAX_P95_ERROR_WIDTH_RATIO
    && metrics.meanPrecisionViewportWidthRatio
      <= thresholds
        .POOR_MAX_MEAN_PRECISION_WIDTH_RATIO
    && metrics.p95PrecisionViewportWidthRatio
      <= thresholds
        .POOR_MAX_P95_PRECISION_WIDTH_RATIO
    && metrics.validSampleRatio
      >= thresholds
        .POOR_MIN_VALID_SAMPLE_RATIO
    && metrics.p95ErrorPx
      <= thresholds
        .ABSOLUTE_MAX_P95_ERROR_PX;

  return meetsPoor
    ? "POOR"
    : "FAIL";
}

function meanBucketError(
  results: readonly CalibrationPointResult[],
  sourcePoints: readonly CalibrationCleanedPoint[],
  bucket: SpatialBucket
): number {
  const values: number[] = [];

  for (
    let index = 0;
    index < results.length;
    index += 1
  ) {
    const result = results[index];
    const sourcePoint = sourcePoints[index];

    if (
      result !== undefined
      && sourcePoint !== undefined
      && classifySpatialBucket(
        sourcePoint.targetNormalizedPoint
      ) === bucket
    ) {
      values.push(result.errorPx);
    }
  }

  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Validation pattern does not contain a ${bucket.toLowerCase()} point.`
    );
  }

  return mean(values);
}

/* ========================================================================== 
 * Public validation
 * ======================================================================== */

/**
 * Evaluates a fitted calibration model on independently collected targets.
 * Validation points must not be reused for model fitting.
 */
export function validateCalibrationModel(
  model: CalibrationModel,
  validationPoints:
    readonly CalibrationCleanedPoint[],
  viewport: Size2D
): CalibrationValidationResult {
  assertViewport(viewport);

  if (
    validationPoints.length
      < CALIBRATION.MIN_VALIDATION_POINT_COUNT
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Too few independent validation points were provided.",
      {
        details: {
          pointCount:
            validationPoints.length,
          requiredPointCount:
            CALIBRATION
              .MIN_VALIDATION_POINT_COUNT
        }
      }
    );
  }

  const pointResults =
    validationPoints.map(
      (point): CalibrationPointResult => {
        const rawViewportPoint =
          toViewportPoint(
            point.representativeRawPoint,
            viewport
          );

        const rawErrorXPx =
          rawViewportPoint.x
          - point.targetViewportPoint.x;

        const rawErrorYPx =
          rawViewportPoint.y
          - point.targetViewportPoint.y;

        const rawErrorPx =
          Math.hypot(
            rawErrorXPx,
            rawErrorYPx
          );

        const correctedNormalized =
          model.predict(
            point.representativeRawPoint
          );

        const correctedViewportPoint =
          toViewportPoint(
            correctedNormalized,
            viewport
          );

        const errorXPx =
          correctedViewportPoint.x
          - point.targetViewportPoint.x;

        const errorYPx =
          correctedViewportPoint.y
          - point.targetViewportPoint.y;

        const errorPx =
          Math.hypot(
            errorXPx,
            errorYPx
          );

        const pointPrecisionDistances =
          correctedSamplePrecisionDistances(
            point,
            model,
            viewport
          );

        return {
          calibrationId:
            point.calibrationId,
          pointIndex:
            point.pointIndex,
          targetViewportPoint:
            point.targetViewportPoint,
          rawMeanPoint:
            point.representativeRawPoint,
          rawMeanSpace:
            "NORMALIZED",
          rawViewportPoint,
          rawErrorXPx,
          rawErrorYPx,
          rawErrorPx,
          correctedViewportPoint,
          errorXPx,
          errorYPx,
          errorPx,
          correctionImprovementPx:
            rawErrorPx - errorPx,
          sampleCount:
            point.acceptedSampleCount,
          rejectedCount:
            point.rejectedSampleCount,
          meanPrecisionPx:
            mean(pointPrecisionDistances),
          p95PrecisionPx:
            percentile(pointPrecisionDistances, 0.95),
          meanHeadPose:
            point.meanHeadPose,
          meanFaceDistanceRatio:
            point.meanFaceDistanceRatio,
          meanQuality:
            point.meanQuality
        };
      }
    );

  const rawErrors =
    pointResults.map(
      (point) => point.rawErrorPx
    );

  const rawSquaredErrors =
    rawErrors.map(
      (error) => error * error
    );

  const errors =
    pointResults.map(
      (point) => point.errorPx
    );

  const squaredErrors =
    errors.map(
      (error) => error * error
    );

  const precisionDistances =
    validationPoints.flatMap(
      (point) =>
        correctedSamplePrecisionDistances(
          point,
          model,
          viewport
        )
    );

  const meanErrorPx =
    mean(errors);

  const p95ErrorPx =
    percentile(errors, 0.95);

  const meanPrecisionPx =
    mean(precisionDistances);

  const p95PrecisionPx =
    percentile(
      precisionDistances,
      0.95
    );

  const metrics:
  CalibrationValidationMetrics = {
    viewportWidthPx:
      viewport.width,
    viewportHeightPx:
      viewport.height,
    rawMeanErrorPx:
      mean(rawErrors),
    rawP95ErrorPx:
      percentile(rawErrors, 0.95),
    rawRmsePx:
      Math.sqrt(
        mean(rawSquaredErrors)
      ),
    meanErrorPx,
    medianErrorPx:
      median(errors),
    rmsePx:
      Math.sqrt(
        mean(squaredErrors)
      ),
    p90ErrorPx:
      percentile(errors, 0.90),
    p95ErrorPx,
    maxErrorPx:
      Math.max(...errors),
    horizontalErrorPx:
      mean(
        pointResults.map(
          (point) =>
            Math.abs(point.errorXPx)
        )
      ),
    verticalErrorPx:
      mean(
        pointResults.map(
          (point) =>
            Math.abs(point.errorYPx)
        )
      ),
    centerErrorPx:
      meanBucketError(
        pointResults,
        validationPoints,
        "CENTER"
      ),
    edgeErrorPx:
      meanBucketError(
        pointResults,
        validationPoints,
        "EDGE"
      ),
    cornerErrorPx:
      meanBucketError(
        pointResults,
        validationPoints,
        "CORNER"
      ),
    meanErrorViewportWidthRatio:
      meanErrorPx / viewport.width,
    p95ErrorViewportWidthRatio:
      p95ErrorPx / viewport.width,
    meanPrecisionPx,
    p95PrecisionPx,
    meanPrecisionViewportWidthRatio:
      meanPrecisionPx / viewport.width,
    p95PrecisionViewportWidthRatio:
      p95PrecisionPx / viewport.width,
    meanCorrectionImprovementPx:
      mean(
        pointResults.map(
          (point) =>
            point.correctionImprovementPx
        )
      ),
    improvedPointCount:
      pointResults.filter(
        (point) =>
          point.correctionImprovementPx > 0
      ).length,
    degradedPointCount:
      pointResults.filter(
        (point) =>
          point.correctionImprovementPx < 0
      ).length,
    validSampleRatio:
      sampleValidityRatio(
        validationPoints
      )
  };

  return {
    metrics,
    quality:
      classifyCalibrationValidationQuality(
        metrics
      ),
    pointResults
  };
}
