import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  Point2D
} from "../shared/types";

import type {
  CalibrationValidationResult
} from "../calibration/calibrationValidator";

import type {
  DeepIndependentValidationReport,
  DeepIndependentValidationPointResult,
  DeepValidationSpatialBucket
} from "./deepIndependentValidator";

import type {
  CalibrationHybridSelector,
  HybridDirectionalBucket,
  HybridSpatialBucket
} from "./calibrationHybridSelector";

import {
  estimateGazeScreenRegion
} from "./gazeRegionEstimator";

import type {
  GazeScreenRegion
} from "./gazeRegionEstimator";

import {
  estimateHybridUncertainty
} from "./hybridUncertainty";

export interface HybridIndependentPointResult {
  readonly pointIndex: number;
  readonly targetViewportPoint: Point2D;
  readonly baselineViewportPoint: Point2D;
  readonly deepViewportPoint: Point2D;
  readonly baselineBiasCorrectedViewportPoint: Point2D;
  readonly deepBiasCorrectedViewportPoint: Point2D;
  readonly hybridViewportPoint: Point2D;
  readonly selectedStrategyViewportPoint: Point2D;
  readonly baselineErrorPx: number;
  readonly deepErrorPx: number;
  readonly baselineBiasCorrectedErrorPx: number;
  readonly deepBiasCorrectedErrorPx: number;
  readonly hybridErrorPx: number;
  readonly selectedStrategyErrorPx: number;
  readonly selectedSessionStrategy:
    | "BASELINE_ONLY"
    | "DEEP_ONLY"
    | "SAFE_ADAPTIVE_HYBRID";
  readonly selectedStrategyDeepWeight: number;
  readonly calibrationRoutingInfluence: number;
  readonly liveRoutingAttenuation: number;
  readonly effectiveRoutingInfluence: number;
  readonly routingBucket: HybridSpatialBucket;
  readonly directionalRoutingBucket: HybridDirectionalBucket;
  readonly targetSpatialBucket: DeepValidationSpatialBucket;
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
  readonly baselineBiasCorrectionViewportPx: Point2D;
  readonly deepBiasCorrectionViewportPx: Point2D;
  readonly adaptiveUncertaintyRadiusNormalized: number;
  readonly uncertaintyUnclampedRadiusNormalized: number;
  readonly uncertaintyCalibrationPriorRadiusNormalized: number;
  readonly uncertaintyTemporalNoiseRadiusNormalized: number;
  readonly uncertaintyDisagreementRadiusNormalized: number;
  readonly uncertaintyBaselineRetentionRatio: number;
  readonly uncertaintyDeepRetentionRatio: number;
  readonly uncertaintyClamped: boolean;
  readonly baselineMeanPrecisionPx: number;
  readonly deepMeanPrecisionPx: number;
  readonly deepMeanConfidence: number;
  readonly deepSampleCount: number;
  readonly targetGazeRegion: GazeScreenRegion;
  readonly baselineGazeRegion: GazeScreenRegion;
  readonly deepGazeRegion: GazeScreenRegion;
  readonly hybridGazeRegion: GazeScreenRegion;
  readonly selectedStrategyGazeRegion: GazeScreenRegion;
  readonly baselineRegionHit: boolean;
  readonly deepRegionHit: boolean;
  readonly hybridRegionHit: boolean;
  readonly selectedStrategyRegionHit: boolean;
  readonly hybridRegionAmbiguous: boolean;
  readonly hybridRegionBoundaryMarginNormalized: number;
  readonly meanDeltaHeadYawDeg: number;
  readonly meanDeltaHeadPitchDeg: number;
  readonly meanDeltaHeadRollDeg: number;
  readonly meanDeltaFaceCenterX: number;
  readonly meanDeltaFaceCenterY: number;
  readonly meanFaceWidthScaleDelta: number;
  readonly meanFaceHeightScaleDelta: number;
  readonly meanFaceDistanceDelta: number;
}

export interface HybridIndependentMetrics {
  readonly pointCount: number;
  readonly meanErrorPx: number;
  readonly medianErrorPx: number;
  readonly rmsePx: number;
  readonly p90ErrorPx: number;
  readonly p95ErrorPx: number;
  readonly maxErrorPx: number;
  readonly selectedSessionStrategy:
    | "BASELINE_ONLY"
    | "DEEP_ONLY"
    | "SAFE_ADAPTIVE_HYBRID";
  readonly selectedStrategyMeanErrorPx: number;
  readonly selectedStrategyMedianErrorPx: number;
  readonly selectedStrategyRmsePx: number;
  readonly selectedStrategyP95ErrorPx: number;
  readonly selectedStrategyMaxErrorPx: number;
  readonly selectedStrategyRegionHitRate: number;
  readonly centerErrorPx: number;
  readonly edgeErrorPx: number;
  readonly cornerErrorPx: number;
  readonly baselineBiasCorrectedMeanErrorPx: number;
  readonly baselineBiasCorrectedP95ErrorPx: number;
  readonly deepBiasCorrectedMeanErrorPx: number;
  readonly deepBiasCorrectedP95ErrorPx: number;
  /** Exact 3x3 region hit rates directly measure coarse looked-at area. */
  readonly baselineRegionHitRate: number;
  readonly deepRegionHitRate: number;
  readonly hybridRegionHitRate: number;
  readonly hybridAmbiguousRegionRate: number;
  readonly meanAdaptiveUncertaintyRadiusNormalized: number;
  readonly p95AdaptiveUncertaintyRadiusNormalized: number;
  readonly uncertaintyClampRate: number;
  readonly baselineHorizontalBandHitRate: number;
  readonly deepHorizontalBandHitRate: number;
  readonly hybridHorizontalBandHitRate: number;
  readonly baselineVerticalBandHitRate: number;
  readonly deepVerticalBandHitRate: number;
  readonly hybridVerticalBandHitRate: number;
}

export interface HybridIndependentValidationReport {
  readonly calibrationId: string;
  readonly metrics: HybridIndependentMetrics;
  readonly pointResults: readonly HybridIndependentPointResult[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation has no values to average."
    );
  }

  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
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
      "Hybrid independent validation percentile request is invalid."
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
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function meanBucketError(
  points: readonly HybridIndependentPointResult[],
  bucket: DeepValidationSpatialBucket
): number {
  const values = points
    .filter((point) => point.targetSpatialBucket === bucket)
    .map((point) => point.hybridErrorPx);

  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Hybrid validation pattern does not contain a ${bucket.toLowerCase()} point.`
    );
  }

  return mean(values);
}

function toNormalized(
  point: Point2D,
  viewportWidth: number,
  viewportHeight: number
): Point2D {
  return {
    x: point.x / viewportWidth,
    y: point.y / viewportHeight
  };
}

function resolveDeepPoint(
  points: readonly DeepIndependentValidationPointResult[],
  pointIndex: number
): DeepIndependentValidationPointResult {
  const point = points.find(
    (candidate) => candidate.pointIndex === pointIndex
  );

  if (point === undefined) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation could not match a deep validation point.",
      { details: { pointIndex } }
    );
  }

  return point;
}

function hitRate(values: readonly boolean[]): number {
  return mean(values.map((value) => value ? 1 : 0));
}

/**
 * Evaluates a selector fitted exclusively from calibration grouped-CV data.
 * This function never updates selector parameters from independent validation.
 */
export function evaluateHybridIndependentValidation(
  calibrationId: string,
  baseline: CalibrationValidationResult,
  deep: DeepIndependentValidationReport,
  selector: CalibrationHybridSelector
): HybridIndependentValidationReport {
  const viewportWidth = deep.metrics.viewportWidthPx;
  const viewportHeight = deep.metrics.viewportHeightPx;

  const pointResults: HybridIndependentPointResult[] = [];

  for (const baselinePoint of baseline.pointResults) {
    const deepPoint = resolveDeepPoint(
      deep.pointResults,
      baselinePoint.pointIndex
    );

    const baselineNormalized = toNormalized(
      baselinePoint.correctedViewportPoint,
      viewportWidth,
      viewportHeight
    );

    const hybrid = selector.predict(
      baselineNormalized,
      deepPoint.representativeNormalizedPoint,
      {
        deepConfidence: deepPoint.meanConfidence,
        baselinePrecisionPx: baselinePoint.meanPrecisionPx ?? null,
        deepPrecisionPx: deepPoint.meanPrecisionPx,
        drift: {
          deltaHeadYawDeg: deepPoint.meanDeltaHeadYawDeg,
          deltaHeadPitchDeg: deepPoint.meanDeltaHeadPitchDeg,
          deltaHeadRollDeg: deepPoint.meanDeltaHeadRollDeg,
          deltaFaceCenterX: deepPoint.meanDeltaFaceCenterX,
          deltaFaceCenterY: deepPoint.meanDeltaFaceCenterY,
          faceWidthScaleDelta: deepPoint.meanFaceWidthScaleDelta,
          faceHeightScaleDelta: deepPoint.meanFaceHeightScaleDelta,
          faceDistanceDelta: deepPoint.meanFaceDistanceDelta
        }
      }
    );

    if (hybrid === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Hybrid selector is not fitted before independent validation."
      );
    }

    const baselineBiasCorrectedViewportPoint = {
      x:
        hybrid.baselineBiasCorrectedNormalizedPoint.x
        * viewportWidth,
      y:
        hybrid.baselineBiasCorrectedNormalizedPoint.y
        * viewportHeight
    };

    const deepBiasCorrectedViewportPoint = {
      x:
        hybrid.deepBiasCorrectedNormalizedPoint.x
        * viewportWidth,
      y:
        hybrid.deepBiasCorrectedNormalizedPoint.y
        * viewportHeight
    };

    const baselineBiasCorrectedErrorPx = Math.hypot(
      baselineBiasCorrectedViewportPoint.x
        - baselinePoint.targetViewportPoint.x,
      baselineBiasCorrectedViewportPoint.y
        - baselinePoint.targetViewportPoint.y
    );

    const deepBiasCorrectedErrorPx = Math.hypot(
      deepBiasCorrectedViewportPoint.x
        - baselinePoint.targetViewportPoint.x,
      deepBiasCorrectedViewportPoint.y
        - baselinePoint.targetViewportPoint.y
    );

    const hybridViewportPoint = {
      x:
        hybrid.adaptiveHybridNormalizedPoint.x
        * viewportWidth,
      y:
        hybrid.adaptiveHybridNormalizedPoint.y
        * viewportHeight
    };

    const selectedStrategyViewportPoint = {
      x: hybrid.normalizedPoint.x * viewportWidth,
      y: hybrid.normalizedPoint.y * viewportHeight
    };

    const hybridErrorPx = Math.hypot(
      hybridViewportPoint.x - baselinePoint.targetViewportPoint.x,
      hybridViewportPoint.y - baselinePoint.targetViewportPoint.y
    );

    const selectedStrategyErrorPx = Math.hypot(
      selectedStrategyViewportPoint.x
        - baselinePoint.targetViewportPoint.x,
      selectedStrategyViewportPoint.y
        - baselinePoint.targetViewportPoint.y
    );

    const targetRegion = estimateGazeScreenRegion(
      deepPoint.targetNormalizedPoint
    );

    const baselineRegion = estimateGazeScreenRegion(
      baselineNormalized
    );

    const deepRegion = estimateGazeScreenRegion(
      deepPoint.representativeNormalizedPoint
    );

    const minimumViewportDimension = Math.min(
      viewportWidth,
      viewportHeight
    );

    const selectedStrategyExpectedErrorPx =
      hybrid.selectedSessionStrategy === "BASELINE_ONLY"
        ? hybrid.baselineExpectedErrorPx
        : hybrid.selectedSessionStrategy === "DEEP_ONLY"
          ? hybrid.deepExpectedErrorPx
          : hybrid.expectedHybridErrorPx;

    const uncertainty = estimateHybridUncertainty({
      minimumViewportDimensionPx: minimumViewportDimension,
      expectedHybridErrorPx: selectedStrategyExpectedErrorPx,
      directionalPriorReliability:
        hybrid.directionalPriorReliability,
      baselineWeight: 1 - hybrid.selectedStrategyDeepWeight,
      deepWeight: hybrid.selectedStrategyDeepWeight,
      baselinePrecisionPx:
        baselinePoint.meanPrecisionPx ?? null,
      baselineAcceptedSampleCount:
        baselinePoint.sampleCount,
      baselineRejectedSampleCount:
        baselinePoint.rejectedCount,
      deepPrecisionPx: deepPoint.robustDeepPrecisionPx,
      deepAcceptedSampleCount:
        deepPoint.acceptedDeepSampleCount,
      deepRawSampleCount:
        deepPoint.rawDeepSampleCount,
      modelDisagreementNormalized:
        hybrid.modelDisagreementNormalized
    });

    const uncertaintyRadiusNormalized =
      uncertainty.radiusNormalized;

    const hybridRegion = estimateGazeScreenRegion(
      hybrid.adaptiveHybridNormalizedPoint,
      uncertaintyRadiusNormalized
    );

    const selectedStrategyRegion = estimateGazeScreenRegion(
      hybrid.normalizedPoint,
      uncertaintyRadiusNormalized
    );

    pointResults.push({
      pointIndex: baselinePoint.pointIndex,
      targetViewportPoint: {
        ...baselinePoint.targetViewportPoint
      },
      baselineViewportPoint: {
        ...baselinePoint.correctedViewportPoint
      },
      deepViewportPoint: {
        ...deepPoint.representativeViewportPoint
      },
      baselineBiasCorrectedViewportPoint,
      deepBiasCorrectedViewportPoint,
      hybridViewportPoint,
      selectedStrategyViewportPoint,
      baselineErrorPx: baselinePoint.errorPx,
      deepErrorPx: deepPoint.errorPx,
      baselineBiasCorrectedErrorPx,
      deepBiasCorrectedErrorPx,
      hybridErrorPx,
      selectedStrategyErrorPx,
      selectedSessionStrategy:
        hybrid.selectedSessionStrategy,
      selectedStrategyDeepWeight:
        hybrid.selectedStrategyDeepWeight,
      calibrationRoutingInfluence:
        hybrid.calibrationRoutingInfluence,
      liveRoutingAttenuation:
        hybrid.liveRoutingAttenuation,
      effectiveRoutingInfluence:
        hybrid.effectiveRoutingInfluence,
      routingBucket: hybrid.spatialBucket,
      directionalRoutingBucket: hybrid.directionalBucket,
      targetSpatialBucket: deepPoint.spatialBucket,
      deepWeight: hybrid.deepWeight,
      baselineWeight: hybrid.baselineWeight,
      errorDerivedDeepWeight:
        hybrid.errorDerivedDeepWeight,
      calibrationReliabilityDeepWeight:
        hybrid.calibrationReliabilityDeepWeight,
      calibrationReliabilityRoutingApplied:
        hybrid.calibrationReliabilityRoutingApplied,
      coarseCalibrationReliabilityDeepWeight:
        hybrid.coarseCalibrationReliabilityDeepWeight,
      coarseCalibrationReliabilityRoutingApplied:
        hybrid.coarseCalibrationReliabilityRoutingApplied,
      activeReliabilityRoutingMode:
        hybrid.activeReliabilityRoutingMode,
      baselineExpectedErrorPx: hybrid.baselineExpectedErrorPx,
      deepExpectedErrorPx: hybrid.deepExpectedErrorPx,
      expectedHybridErrorPx: hybrid.expectedHybridErrorPx,
      directionalPriorReliability:
        hybrid.directionalPriorReliability,
      driftSeverity: hybrid.driftSeverity,
      deepConfidencePenaltyMultiplier:
        hybrid.deepConfidencePenaltyMultiplier,
      baselineStabilityPenaltyMultiplier:
        hybrid.baselineStabilityPenaltyMultiplier,
      deepStabilityPenaltyMultiplier:
        hybrid.deepStabilityPenaltyMultiplier,
      rawModelDisagreementNormalized:
        hybrid.rawModelDisagreementNormalized,
      modelDisagreementNormalized:
        hybrid.modelDisagreementNormalized,
      baselineBiasCorrectionApplied:
        hybrid.baselineBiasCorrectionApplied,
      deepBiasCorrectionApplied:
        hybrid.deepBiasCorrectionApplied,
      baselineBiasCorrectionStrength:
        hybrid.baselineBiasCorrectionStrength,
      deepBiasCorrectionStrength:
        hybrid.deepBiasCorrectionStrength,
      baselineBiasCorrectionNormalized:
        hybrid.baselineBiasCorrectionNormalized,
      deepBiasCorrectionNormalized:
        hybrid.deepBiasCorrectionNormalized,
      baselineBiasCorrectionViewportPx: {
        x:
          hybrid.baselineBiasCorrectionNormalized.x
          * viewportWidth,
        y:
          hybrid.baselineBiasCorrectionNormalized.y
          * viewportHeight
      },
      deepBiasCorrectionViewportPx: {
        x:
          hybrid.deepBiasCorrectionNormalized.x
          * viewportWidth,
        y:
          hybrid.deepBiasCorrectionNormalized.y
          * viewportHeight
      },
      adaptiveUncertaintyRadiusNormalized:
        uncertaintyRadiusNormalized,
      uncertaintyUnclampedRadiusNormalized:
        uncertainty.unclampedRadiusNormalized,
      uncertaintyCalibrationPriorRadiusNormalized:
        uncertainty.calibrationPriorRadiusNormalized,
      uncertaintyTemporalNoiseRadiusNormalized:
        uncertainty.temporalNoiseRadiusNormalized,
      uncertaintyDisagreementRadiusNormalized:
        uncertainty.disagreementRadiusNormalized,
      uncertaintyBaselineRetentionRatio:
        uncertainty.baselineRetentionRatio,
      uncertaintyDeepRetentionRatio:
        uncertainty.deepRetentionRatio,
      uncertaintyClamped:
        uncertainty.clamped,
      baselineMeanPrecisionPx:
        baselinePoint.meanPrecisionPx ?? 0,
      deepMeanPrecisionPx:
        deepPoint.meanPrecisionPx,
      deepMeanConfidence: deepPoint.meanConfidence,
      deepSampleCount: deepPoint.sampleCount,
      targetGazeRegion: targetRegion.region,
      baselineGazeRegion: baselineRegion.region,
      deepGazeRegion: deepRegion.region,
      hybridGazeRegion: hybridRegion.region,
      selectedStrategyGazeRegion:
        selectedStrategyRegion.region,
      baselineRegionHit:
        baselineRegion.region === targetRegion.region,
      deepRegionHit:
        deepRegion.region === targetRegion.region,
      hybridRegionHit:
        hybridRegion.region === targetRegion.region,
      selectedStrategyRegionHit:
        selectedStrategyRegion.region === targetRegion.region,
      hybridRegionAmbiguous:
        hybridRegion.ambiguous,
      hybridRegionBoundaryMarginNormalized:
        hybridRegion.boundaryMarginNormalized,
      meanDeltaHeadYawDeg: deepPoint.meanDeltaHeadYawDeg,
      meanDeltaHeadPitchDeg: deepPoint.meanDeltaHeadPitchDeg,
      meanDeltaHeadRollDeg: deepPoint.meanDeltaHeadRollDeg,
      meanDeltaFaceCenterX: deepPoint.meanDeltaFaceCenterX,
      meanDeltaFaceCenterY: deepPoint.meanDeltaFaceCenterY,
      meanFaceWidthScaleDelta: deepPoint.meanFaceWidthScaleDelta,
      meanFaceHeightScaleDelta: deepPoint.meanFaceHeightScaleDelta,
      meanFaceDistanceDelta: deepPoint.meanFaceDistanceDelta
    });
  }

  const errors = pointResults.map(
    (point) => point.hybridErrorPx
  );

  const selectedStrategyErrors = pointResults.map(
    (point) => point.selectedStrategyErrorPx
  );

  const selectedSessionStrategy =
    pointResults[0]?.selectedSessionStrategy;

  if (selectedSessionStrategy === undefined) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Selected session strategy is unavailable during independent validation."
    );
  }

  const baselineBiasCorrectedErrors = pointResults.map(
    (point) => point.baselineBiasCorrectedErrorPx
  );

  const deepBiasCorrectedErrors = pointResults.map(
    (point) => point.deepBiasCorrectedErrorPx
  );

  const baselineHorizontalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.baselineViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.horizontalBand === predicted.horizontalBand;
  });

  const deepHorizontalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.deepViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.horizontalBand === predicted.horizontalBand;
  });

  const hybridHorizontalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.hybridViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.horizontalBand === predicted.horizontalBand;
  });

  const baselineVerticalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.baselineViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.verticalBand === predicted.verticalBand;
  });

  const deepVerticalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.deepViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.verticalBand === predicted.verticalBand;
  });

  const hybridVerticalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.hybridViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.verticalBand === predicted.verticalBand;
  });

  return {
    calibrationId,
    metrics: {
      pointCount: pointResults.length,
      meanErrorPx: mean(errors),
      medianErrorPx: percentile(errors, 0.5),
      rmsePx: Math.sqrt(
        mean(errors.map((error) => error * error))
      ),
      p90ErrorPx: percentile(errors, 0.90),
      p95ErrorPx: percentile(errors, 0.95),
      maxErrorPx: Math.max(...errors),
      selectedSessionStrategy,
      selectedStrategyMeanErrorPx:
        mean(selectedStrategyErrors),
      selectedStrategyMedianErrorPx:
        percentile(selectedStrategyErrors, 0.5),
      selectedStrategyRmsePx: Math.sqrt(
        mean(
          selectedStrategyErrors.map(
            (error) => error * error
          )
        )
      ),
      selectedStrategyP95ErrorPx:
        percentile(selectedStrategyErrors, 0.95),
      selectedStrategyMaxErrorPx:
        Math.max(...selectedStrategyErrors),
      selectedStrategyRegionHitRate: hitRate(
        pointResults.map(
          (point) => point.selectedStrategyRegionHit
        )
      ),
      centerErrorPx: meanBucketError(pointResults, "CENTER"),
      edgeErrorPx: meanBucketError(pointResults, "EDGE"),
      cornerErrorPx: meanBucketError(pointResults, "CORNER"),
      baselineBiasCorrectedMeanErrorPx:
        mean(baselineBiasCorrectedErrors),
      baselineBiasCorrectedP95ErrorPx:
        percentile(baselineBiasCorrectedErrors, 0.95),
      deepBiasCorrectedMeanErrorPx:
        mean(deepBiasCorrectedErrors),
      deepBiasCorrectedP95ErrorPx:
        percentile(deepBiasCorrectedErrors, 0.95),
      baselineRegionHitRate: hitRate(
        pointResults.map((point) => point.baselineRegionHit)
      ),
      deepRegionHitRate: hitRate(
        pointResults.map((point) => point.deepRegionHit)
      ),
      hybridRegionHitRate: hitRate(
        pointResults.map((point) => point.hybridRegionHit)
      ),
      hybridAmbiguousRegionRate: hitRate(
        pointResults.map((point) => point.hybridRegionAmbiguous)
      ),
      meanAdaptiveUncertaintyRadiusNormalized: mean(
        pointResults.map(
          (point) => point.adaptiveUncertaintyRadiusNormalized
        )
      ),
      p95AdaptiveUncertaintyRadiusNormalized: percentile(
        pointResults.map(
          (point) => point.adaptiveUncertaintyRadiusNormalized
        ),
        0.95
      ),
      uncertaintyClampRate: hitRate(
        pointResults.map((point) => point.uncertaintyClamped)
      ),
      baselineHorizontalBandHitRate:
        hitRate(baselineHorizontalHits),
      deepHorizontalBandHitRate:
        hitRate(deepHorizontalHits),
      hybridHorizontalBandHitRate:
        hitRate(hybridHorizontalHits),
      baselineVerticalBandHitRate:
        hitRate(baselineVerticalHits),
      deepVerticalBandHitRate:
        hitRate(deepVerticalHits),
      hybridVerticalBandHitRate:
        hitRate(hybridVerticalHits)
    },
    pointResults
  };
}
