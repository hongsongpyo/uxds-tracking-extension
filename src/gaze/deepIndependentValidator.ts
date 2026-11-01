import {
  CALIBRATION,
  DEEP_PERSONALIZATION
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  FaceBaseline,
  Point2D,
  Size2D
} from "../shared/types";

import type {
  GazeObserverRuntimeSample
} from "./gazePredictor";

import type {
  DeepPersonalMapper
} from "./deepPersonalMapper";

import {
  aggregateRobustGazePoints
} from "./robustGazeAggregation";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export type DeepValidationSpatialBucket =
  | "CENTER"
  | "EDGE"
  | "CORNER";

export interface DeepIndependentValidationPointInput {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly samples:
    readonly GazeObserverRuntimeSample[];
}

export interface DeepIndependentValidationPointResult {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  /** Robust accepted sample count retained for backward-compatible consumers. */
  readonly sampleCount: number;
  readonly rawDeepSampleCount: number;
  readonly qualityRejectedDeepSampleCount: number;
  readonly spatialOutlierRejectedDeepSampleCount: number;
  readonly acceptedDeepSampleCount: number;
  readonly rawDeepCenterNormalizedPoint: Point2D;
  readonly rawDeepCenterViewportPoint: Point2D;
  readonly robustDeepCenterNormalizedPoint: Point2D;
  readonly robustDeepCenterViewportPoint: Point2D;
  readonly rawDeepPrecisionPx: number;
  readonly robustDeepPrecisionPx: number;
  readonly robustDispersionRmsNormalized: number;
  readonly rawDeepErrorPx: number;
  readonly meanConfidence: number;
  readonly meanDeltaHeadYawDeg: number;
  readonly meanDeltaHeadPitchDeg: number;
  readonly meanDeltaHeadRollDeg: number;
  readonly meanDeltaFaceCenterX: number;
  readonly meanDeltaFaceCenterY: number;
  readonly meanFaceWidthScaleDelta: number;
  readonly meanFaceHeightScaleDelta: number;
  readonly meanFaceDistanceDelta: number;
  readonly representativeNormalizedPoint: Point2D;
  readonly representativeViewportPoint: Point2D;
  readonly errorXPx: number;
  readonly errorYPx: number;
  readonly errorPx: number;
  readonly meanPrecisionPx: number;
  readonly p95PrecisionPx: number;
  /** Per-sample spread around this target centroid, used for aggregate precision. */
  readonly precisionDistancesPx: readonly number[];
  readonly spatialBucket:
    DeepValidationSpatialBucket;
}

export interface DeepValidationDwellAssessment {
  readonly rawSampleCount: number;
  readonly qualityRejectedSampleCount: number;
  readonly spatialOutlierRejectedSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly robustPrecisionPx: number | null;
  readonly robustDispersionRmsNormalized: number | null;
  readonly stable: boolean;
}

export interface DeepIndependentValidationMetrics {
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly pointCount: number;
  readonly totalSampleCount: number;
  readonly meanSampleCountPerPoint: number;
  readonly meanConfidence: number;

  readonly rawMeanErrorPx: number;
  readonly rawP95ErrorPx: number;
  readonly meanErrorPx: number;
  readonly medianErrorPx: number;
  readonly rmsePx: number;
  readonly p90ErrorPx: number;
  readonly p95ErrorPx: number;
  readonly maxErrorPx: number;
  readonly horizontalErrorPx: number;
  readonly verticalErrorPx: number;
  readonly centerErrorPx: number;
  readonly edgeErrorPx: number;
  readonly cornerErrorPx: number;
  readonly meanErrorViewportWidthRatio: number;
  readonly p95ErrorViewportWidthRatio: number;

  readonly meanPrecisionPx: number;
  readonly p95PrecisionPx: number;
  readonly meanPrecisionViewportWidthRatio: number;
  readonly p95PrecisionViewportWidthRatio: number;
}

export interface DeepIndependentValidationReport {
  readonly calibrationId: string;
  readonly expectedPointCount: number;
  readonly metrics:
    DeepIndependentValidationMetrics;
  readonly pointResults:
    readonly DeepIndependentValidationPointResult[];
}

export interface DeepIndependentValidatorSnapshot {
  readonly calibrationId: string | null;
  readonly expectedPointCount: number;
  readonly completedPointCount: number;
  readonly reportReady: boolean;
}

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
      "Deep independent validation requires a positive finite viewport."
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
      "Deep independent validation metric has no values."
    );
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
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
      "Deep independent validation percentile request is invalid."
    );
  }

  const sorted =
    [...values].sort((a, b) => a - b);

  const position =
    (sorted.length - 1) * probability;

  const lowerIndex =
    Math.floor(position);

  const upperIndex =
    Math.ceil(position);

  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (
    lower === undefined
    || upper === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validation percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return (
    lower
    + (upper - lower)
      * (position - lowerIndex)
  );
}

function median(
  values: readonly number[]
): number {
  return percentile(values, 0.5);
}

function toViewportPoint(
  point: Point2D,
  viewport: Size2D
): Point2D {
  return {
    x: point.x * viewport.width,
    y: point.y * viewport.height
  };
}

function classifySpatialBucket(
  point: Point2D
): DeepValidationSpatialBucket {
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

function meanBucketError(
  points:
    readonly DeepIndependentValidationPointResult[],
  bucket: DeepValidationSpatialBucket
): number {
  const values =
    points
      .filter(
        (point) =>
          point.spatialBucket === bucket
      )
      .map((point) => point.errorPx);

  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Deep validation pattern does not contain a ${bucket.toLowerCase()} point.`
    );
  }

  return mean(values);
}

function assertFinitePrediction(
  point: Point2D
): void {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep personal mapper produced a non-finite independent-validation prediction."
    );
  }
}

interface PreparedDeepPrediction {
  readonly sample: GazeObserverRuntimeSample;
  readonly point: Point2D;
}

interface PreparedDeepSamples {
  readonly rawSampleCount: number;
  readonly qualityRejectedSampleCount: number;
  readonly predicted: readonly PreparedDeepPrediction[];
}

function isQualityAcceptedDeepSample(
  sample: GazeObserverRuntimeSample
): boolean {
  return (
    sample.quality.usableForGaze
    && sample.quality.faceValid
    && sample.quality.eyesValid
    && !sample.quality.blink
    && Number.isFinite(sample.quality.qualityScore)
    && sample.quality.qualityScore >= CALIBRATION.MIN_SAMPLE_QUALITY
    && Number.isFinite(sample.prediction.confidence)
    && sample.prediction.confidence >= 0
    && sample.prediction.confidence <= 1
  );
}

function prepareDeepPredictions(
  samples: readonly GazeObserverRuntimeSample[],
  mapper: DeepPersonalMapper,
  baseline: FaceBaseline
): PreparedDeepSamples {
  const qualityAccepted = samples.filter(
    isQualityAcceptedDeepSample
  );

  const predicted = qualityAccepted
    .map((sample) => ({
      sample,
      point: mapper.predict(sample, baseline)
    }))
    .filter(
      (entry): entry is PreparedDeepPrediction =>
        entry.point !== null
        && Number.isFinite(entry.point.x)
        && Number.isFinite(entry.point.y)
    );

  return {
    rawSampleCount: samples.length,
    qualityRejectedSampleCount:
      samples.length - predicted.length,
    predicted
  };
}

/* ========================================================================== 
 * Validator
 * ======================================================================== */

/**
 * Independent validation for the already-fitted deep personal mapper.
 *
 * IMPORTANT:
 * - Validation samples are never added back to DeepPersonalMapper.
 * - No hyperparameter/model selection happens here.
 * - The target sequence is the same independent sequence used by the
 *   authoritative WebEyeTrack validation run.
 */
export class DeepIndependentValidator {
  private calibrationId:
    string | null = null;

  private viewport:
    Size2D | null = null;

  private expectedPointCount = 0;

  private readonly points =
    new Map<
      number,
      DeepIndependentValidationPointResult
    >();

  private report:
    DeepIndependentValidationReport | null = null;

  public start(
    calibrationId: string,
    viewport: Size2D,
    expectedPointCount: number
  ): void {
    if (
      calibrationId.trim().length === 0
      || !Number.isInteger(expectedPointCount)
      || expectedPointCount
        < CALIBRATION.MIN_VALIDATION_POINT_COUNT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Deep independent validation startup metadata is invalid."
      );
    }

    assertViewport(viewport);

    this.calibrationId = calibrationId;
    this.viewport = { ...viewport };
    this.expectedPointCount = expectedPointCount;
    this.points.clear();
    this.report = null;
  }

  public assessDwell(
    samples: readonly GazeObserverRuntimeSample[],
    mapper: DeepPersonalMapper,
    baseline: FaceBaseline
  ): DeepValidationDwellAssessment {
    if (this.viewport === null) {
      return {
        rawSampleCount: samples.length,
        qualityRejectedSampleCount: samples.length,
        spatialOutlierRejectedSampleCount: 0,
        acceptedSampleCount: 0,
        robustPrecisionPx: null,
        robustDispersionRmsNormalized: null,
        stable: false
      };
    }

    const prepared = prepareDeepPredictions(
      samples,
      mapper,
      baseline
    );

    if (prepared.predicted.length === 0) {
      return {
        rawSampleCount: prepared.rawSampleCount,
        qualityRejectedSampleCount:
          prepared.qualityRejectedSampleCount,
        spatialOutlierRejectedSampleCount: 0,
        acceptedSampleCount: 0,
        robustPrecisionPx: null,
        robustDispersionRmsNormalized: null,
        stable: false
      };
    }

    const aggregation = aggregateRobustGazePoints(
      prepared.predicted.map((entry) => entry.point),
      this.viewport
    );

    return {
      rawSampleCount: prepared.rawSampleCount,
      qualityRejectedSampleCount:
        prepared.qualityRejectedSampleCount,
      spatialOutlierRejectedSampleCount:
        aggregation.spatialOutlierRejectedSampleCount,
      acceptedSampleCount:
        aggregation.acceptedSampleCount,
      robustPrecisionPx:
        aggregation.robustPrecisionPx,
      robustDispersionRmsNormalized:
        aggregation.robustDispersionRmsNormalized,
      stable:
        aggregation.robustDispersionRmsNormalized
          <= CALIBRATION.STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED
    };
  }

  public addPoint(
    input: DeepIndependentValidationPointInput,
    mapper: DeepPersonalMapper,
    baseline: FaceBaseline
  ): DeepIndependentValidationPointResult {
    if (
      this.calibrationId === null
      || this.viewport === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Deep independent validation has not been started."
      );
    }

    if (
      !Number.isInteger(input.pointIndex)
      || input.pointIndex < 0
      || input.pointIndex >= this.expectedPointCount
      || input.samples.length
        < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few synchronized deep observations are available for this independent validation point.",
        {
          details: {
            pointIndex: input.pointIndex,
            sampleCount: input.samples.length,
            requiredSampleCount:
              DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
          }
        }
      );
    }

    const prepared = prepareDeepPredictions(
      input.samples,
      mapper,
      baseline
    );

    if (
      prepared.predicted.length
        < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Deep personal mapper produced too few quality-accepted independent-validation predictions.",
        {
          details: {
            pointIndex: input.pointIndex,
            rawSampleCount: prepared.rawSampleCount,
            qualityRejectedSampleCount:
              prepared.qualityRejectedSampleCount,
            predictionCount: prepared.predicted.length
          }
        }
      );
    }

    for (const entry of prepared.predicted) {
      assertFinitePrediction(entry.point);
    }

    const aggregation = aggregateRobustGazePoints(
      prepared.predicted.map((entry) => entry.point),
      this.viewport
    );

    if (
      aggregation.acceptedSampleCount
        < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few deep predictions remain after target-free spatial outlier rejection.",
        {
          details: {
            pointIndex: input.pointIndex,
            rawSampleCount: prepared.rawSampleCount,
            qualityRejectedSampleCount:
              prepared.qualityRejectedSampleCount,
            spatialOutlierRejectedSampleCount:
              aggregation.spatialOutlierRejectedSampleCount,
            acceptedSampleCount:
              aggregation.acceptedSampleCount
          }
        }
      );
    }

    const acceptedPredicted = aggregation.acceptedIndices
      .map((index) => prepared.predicted[index])
      .filter(
        (entry): entry is PreparedDeepPrediction =>
          entry !== undefined
      );

    const representativeNormalizedPoint = {
      ...aggregation.robustCenter
    };
    const representativeViewportPoint = toViewportPoint(
      representativeNormalizedPoint,
      this.viewport
    );
    const rawDeepCenterViewportPoint = toViewportPoint(
      aggregation.rawCenter,
      this.viewport
    );

    const rawDeepErrorPx = Math.hypot(
      rawDeepCenterViewportPoint.x - input.targetViewportPoint.x,
      rawDeepCenterViewportPoint.y - input.targetViewportPoint.y
    );

    const errorXPx =
      representativeViewportPoint.x
      - input.targetViewportPoint.x;
    const errorYPx =
      representativeViewportPoint.y
      - input.targetViewportPoint.y;
    const errorPx = Math.hypot(errorXPx, errorYPx);

    const sampleViewportPoints = acceptedPredicted.map(
      (entry) => toViewportPoint(entry.point, this.viewport as Size2D)
    );
    const precisionDistances = sampleViewportPoints.map(
      (point) => Math.hypot(
        point.x - representativeViewportPoint.x,
        point.y - representativeViewportPoint.y
      )
    );

    const result: DeepIndependentValidationPointResult = {
      pointIndex: input.pointIndex,
      targetNormalizedPoint: { ...input.targetNormalizedPoint },
      targetViewportPoint: { ...input.targetViewportPoint },
      sampleCount: aggregation.acceptedSampleCount,
      rawDeepSampleCount: prepared.rawSampleCount,
      qualityRejectedDeepSampleCount:
        prepared.qualityRejectedSampleCount,
      spatialOutlierRejectedDeepSampleCount:
        aggregation.spatialOutlierRejectedSampleCount,
      acceptedDeepSampleCount:
        aggregation.acceptedSampleCount,
      rawDeepCenterNormalizedPoint: { ...aggregation.rawCenter },
      rawDeepCenterViewportPoint,
      robustDeepCenterNormalizedPoint: { ...aggregation.robustCenter },
      robustDeepCenterViewportPoint: { ...representativeViewportPoint },
      rawDeepPrecisionPx: aggregation.rawPrecisionPx,
      robustDeepPrecisionPx: aggregation.robustPrecisionPx,
      robustDispersionRmsNormalized:
        aggregation.robustDispersionRmsNormalized,
      rawDeepErrorPx,
      meanConfidence: mean(
        acceptedPredicted.map((entry) => entry.sample.prediction.confidence)
      ),
      meanDeltaHeadYawDeg: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.headPose.yawDeg - baseline.headPose.yawDeg
        )
      ),
      meanDeltaHeadPitchDeg: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.headPose.pitchDeg - baseline.headPose.pitchDeg
        )
      ),
      meanDeltaHeadRollDeg: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.headPose.rollDeg - baseline.headPose.rollDeg
        )
      ),
      meanDeltaFaceCenterX: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceCenterNormalized.x - baseline.centerX
        )
      ),
      meanDeltaFaceCenterY: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceCenterNormalized.y - baseline.centerY
        )
      ),
      meanFaceWidthScaleDelta: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceWidthRatio / Math.max(baseline.width, 1e-6) - 1
        )
      ),
      meanFaceHeightScaleDelta: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceHeightRatio / Math.max(baseline.height, 1e-6) - 1
        )
      ),
      meanFaceDistanceDelta: mean(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceDistanceRatio - baseline.distanceRatio
        )
      ),
      representativeNormalizedPoint,
      representativeViewportPoint,
      errorXPx,
      errorYPx,
      errorPx,
      meanPrecisionPx: aggregation.robustPrecisionPx,
      p95PrecisionPx: percentile(precisionDistances, 0.95),
      precisionDistancesPx: precisionDistances,
      spatialBucket: classifySpatialBucket(input.targetNormalizedPoint)
    };

    this.points.set(input.pointIndex, result);
    this.report = null;

    return result;
  }

  public finish():
  DeepIndependentValidationReport {
    if (
      this.calibrationId === null
      || this.viewport === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Deep independent validation has not been started."
      );
    }

    const pointResults =
      [...this.points.values()]
        .sort(
          (first, second) =>
            first.pointIndex - second.pointIndex
        );

    if (
      pointResults.length
      !== this.expectedPointCount
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Deep independent validation does not contain every expected target.",
        {
          details: {
            completedPointCount:
              pointResults.length,
            expectedPointCount:
              this.expectedPointCount
          }
        }
      );
    }

    const rawErrors =
      pointResults.map((point) => point.rawDeepErrorPx);

    const errors =
      pointResults.map((point) => point.errorPx);

    const precisionDistances =
      pointResults.flatMap(
        (point) =>
          point.precisionDistancesPx
      );

    const squaredErrors =
      errors.map((error) => error * error);

    const totalSampleCount =
      pointResults.reduce(
        (total, point) =>
          total + point.sampleCount,
        0
      );

    const meanErrorPx = mean(errors);
    const p95ErrorPx = percentile(errors, 0.95);
    const meanPrecisionPx =
      mean(precisionDistances);
    const p95PrecisionPx =
      percentile(precisionDistances, 0.95);

    const metrics:
      DeepIndependentValidationMetrics = {
        viewportWidthPx: this.viewport.width,
        viewportHeightPx: this.viewport.height,
        pointCount: pointResults.length,
        totalSampleCount,
        meanSampleCountPerPoint:
          totalSampleCount / pointResults.length,
        meanConfidence:
          mean(
            pointResults.map(
              (point) => point.meanConfidence
            )
          ),
        rawMeanErrorPx: mean(rawErrors),
        rawP95ErrorPx: percentile(rawErrors, 0.95),
        meanErrorPx,
        medianErrorPx: median(errors),
        rmsePx:
          Math.sqrt(mean(squaredErrors)),
        p90ErrorPx: percentile(errors, 0.90),
        p95ErrorPx,
        maxErrorPx: Math.max(...errors),
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
            "CENTER"
          ),
        edgeErrorPx:
          meanBucketError(
            pointResults,
            "EDGE"
          ),
        cornerErrorPx:
          meanBucketError(
            pointResults,
            "CORNER"
          ),
        meanErrorViewportWidthRatio:
          meanErrorPx / this.viewport.width,
        p95ErrorViewportWidthRatio:
          p95ErrorPx / this.viewport.width,
        meanPrecisionPx,
        p95PrecisionPx,
        meanPrecisionViewportWidthRatio:
          meanPrecisionPx / this.viewport.width,
        p95PrecisionViewportWidthRatio:
          p95PrecisionPx / this.viewport.width
      };

    this.report = {
      calibrationId: this.calibrationId,
      expectedPointCount:
        this.expectedPointCount,
      metrics,
      pointResults
    };

    return this.report;
  }

  public getSnapshot():
  DeepIndependentValidatorSnapshot {
    return {
      calibrationId: this.calibrationId,
      expectedPointCount:
        this.expectedPointCount,
      completedPointCount:
        this.points.size,
      reportReady:
        this.report !== null
    };
  }

  public reset(): void {
    this.calibrationId = null;
    this.viewport = null;
    this.expectedPointCount = 0;
    this.points.clear();
    this.report = null;
  }
}
