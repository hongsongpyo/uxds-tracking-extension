import {
  classifyCalibrationValidationQuality
} from "../calibration/calibrationValidator";

import type {
  CalibrationValidationResult
} from "../calibration/calibrationValidator";

import type {
  CalibrationQualityLevel,
  CalibrationValidationMetrics,
  Point2D
} from "../shared/types";

import type {
  DeepIndependentValidationReport
} from "./deepIndependentValidator";

import type {
  HybridIndependentValidationReport
} from "./hybridIndependentEvaluator";

import type {
  CalibrationSessionGazeStrategy
} from "./calibrationSessionStrategySelector";

export interface SessionStrategyValidationResult {
  readonly strategy: CalibrationSessionGazeStrategy;
  readonly metrics: CalibrationValidationMetrics;
  readonly quality: CalibrationQualityLevel;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0)
    / values.length;
}

function percentile(
  values: readonly number[],
  probability: number
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? sorted[0] ?? 0;
  const upper = sorted[upperIndex] ?? lower;

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function rmse(values: readonly number[]): number {
  return Math.sqrt(
    mean(values.map((value) => value * value))
  );
}

function pointDelta(
  predicted: Point2D,
  target: Point2D
): Point2D {
  return {
    x: predicted.x - target.x,
    y: predicted.y - target.y
  };
}

function deepValidSampleRatio(
  report: DeepIndependentValidationReport
): number {
  const raw = report.pointResults.reduce(
    (total, point) => total + point.rawDeepSampleCount,
    0
  );
  const accepted = report.pointResults.reduce(
    (total, point) => total + point.acceptedDeepSampleCount,
    0
  );

  return raw > 0 ? accepted / raw : 0;
}

function deepMetrics(
  report: DeepIndependentValidationReport
): CalibrationValidationMetrics {
  const metrics = report.metrics;
  const rawErrors = report.pointResults.map(
    (point) => point.rawDeepErrorPx
  );
  const improvements = report.pointResults.map(
    (point) => point.rawDeepErrorPx - point.errorPx
  );

  return {
    viewportWidthPx: metrics.viewportWidthPx,
    viewportHeightPx: metrics.viewportHeightPx,
    rawMeanErrorPx: metrics.rawMeanErrorPx,
    rawP95ErrorPx: metrics.rawP95ErrorPx,
    rawRmsePx: rmse(rawErrors),
    meanErrorPx: metrics.meanErrorPx,
    medianErrorPx: metrics.medianErrorPx,
    rmsePx: metrics.rmsePx,
    p90ErrorPx: metrics.p90ErrorPx,
    p95ErrorPx: metrics.p95ErrorPx,
    maxErrorPx: metrics.maxErrorPx,
    horizontalErrorPx: metrics.horizontalErrorPx,
    verticalErrorPx: metrics.verticalErrorPx,
    centerErrorPx: metrics.centerErrorPx,
    edgeErrorPx: metrics.edgeErrorPx,
    cornerErrorPx: metrics.cornerErrorPx,
    meanErrorViewportWidthRatio:
      metrics.meanErrorViewportWidthRatio,
    p95ErrorViewportWidthRatio:
      metrics.p95ErrorViewportWidthRatio,
    meanPrecisionPx: metrics.meanPrecisionPx,
    p95PrecisionPx: metrics.p95PrecisionPx,
    meanPrecisionViewportWidthRatio:
      metrics.meanPrecisionViewportWidthRatio,
    p95PrecisionViewportWidthRatio:
      metrics.p95PrecisionViewportWidthRatio,
    meanCorrectionImprovementPx: mean(improvements),
    improvedPointCount:
      improvements.filter((value) => value > 0).length,
    degradedPointCount:
      improvements.filter((value) => value < 0).length,
    validSampleRatio: deepValidSampleRatio(report)
  };
}

function hybridMetrics(
  baseline: CalibrationValidationResult,
  deep: DeepIndependentValidationReport,
  hybrid: HybridIndependentValidationReport
): CalibrationValidationMetrics {
  const viewportWidth = baseline.metrics.viewportWidthPx;
  const viewportHeight = baseline.metrics.viewportHeightPx;
  const errors = hybrid.pointResults.map(
    (point) => point.selectedStrategyErrorPx
  );
  const deltas = hybrid.pointResults.map(
    (point) => pointDelta(
      point.selectedStrategyViewportPoint,
      point.targetViewportPoint
    )
  );

  const baselineByIndex = new Map(
    baseline.pointResults.map((point) => [point.pointIndex, point] as const)
  );
  const deepByIndex = new Map(
    deep.pointResults.map((point) => [point.pointIndex, point] as const)
  );

  const meanPrecisionProxies: number[] = [];
  const p95PrecisionProxies: number[] = [];

  for (const point of hybrid.pointResults) {
    const baselinePoint = baselineByIndex.get(point.pointIndex);
    const deepPoint = deepByIndex.get(point.pointIndex);

    if (baselinePoint === undefined || deepPoint === undefined) {
      continue;
    }

    const baselineWeight = 1 - point.selectedStrategyDeepWeight;
    const baselineMeanPrecision = baselinePoint.meanPrecisionPx ?? 0;
    const baselineP95Precision = baselinePoint.p95PrecisionPx
      ?? baselineMeanPrecision;

    meanPrecisionProxies.push(
      baselineWeight * baselineMeanPrecision
      + point.selectedStrategyDeepWeight * deepPoint.meanPrecisionPx
    );
    p95PrecisionProxies.push(
      baselineWeight * baselineP95Precision
      + point.selectedStrategyDeepWeight * deepPoint.p95PrecisionPx
    );
  }

  const meanErrorPx = mean(errors);
  const p95ErrorPx = percentile(errors, 0.95);
  const meanPrecisionPx = mean(meanPrecisionProxies);
  const p95PrecisionPx = percentile(p95PrecisionProxies, 0.95);
  const deepValidRatio = deepValidSampleRatio(deep);

  return {
    viewportWidthPx: viewportWidth,
    viewportHeightPx: viewportHeight,
    rawMeanErrorPx: meanErrorPx,
    rawP95ErrorPx: p95ErrorPx,
    rawRmsePx: rmse(errors),
    meanErrorPx,
    medianErrorPx: percentile(errors, 0.5),
    rmsePx: rmse(errors),
    p90ErrorPx: percentile(errors, 0.90),
    p95ErrorPx,
    maxErrorPx: Math.max(...errors),
    horizontalErrorPx: mean(
      deltas.map((delta) => Math.abs(delta.x))
    ),
    verticalErrorPx: mean(
      deltas.map((delta) => Math.abs(delta.y))
    ),
    centerErrorPx: hybrid.metrics.centerErrorPx,
    edgeErrorPx: hybrid.metrics.edgeErrorPx,
    cornerErrorPx: hybrid.metrics.cornerErrorPx,
    meanErrorViewportWidthRatio:
      meanErrorPx / viewportWidth,
    p95ErrorViewportWidthRatio:
      p95ErrorPx / viewportWidth,
    meanPrecisionPx,
    p95PrecisionPx,
    meanPrecisionViewportWidthRatio:
      meanPrecisionPx / viewportWidth,
    p95PrecisionViewportWidthRatio:
      p95PrecisionPx / viewportWidth,
    meanCorrectionImprovementPx: 0,
    improvedPointCount: 0,
    degradedPointCount: 0,
    validSampleRatio: Math.min(
      baseline.metrics.validSampleRatio,
      deepValidRatio
    )
  };
}

function makeResult(
  strategy: CalibrationSessionGazeStrategy,
  metrics: CalibrationValidationMetrics
): SessionStrategyValidationResult {
  return {
    strategy,
    metrics,
    quality: classifyCalibrationValidationQuality(metrics)
  };
}

export function evaluateBaselineSessionStrategyValidation(
  baseline: CalibrationValidationResult
): SessionStrategyValidationResult {
  return makeResult(
    "BASELINE_ONLY",
    baseline.metrics
  );
}

export function evaluateDeepSessionStrategyValidation(
  deep: DeepIndependentValidationReport
): SessionStrategyValidationResult {
  return makeResult(
    "DEEP_ONLY",
    deepMetrics(deep)
  );
}

export function evaluateHybridSessionStrategyValidation(
  baseline: CalibrationValidationResult,
  deep: DeepIndependentValidationReport,
  hybrid: HybridIndependentValidationReport
): SessionStrategyValidationResult {
  return makeResult(
    "SAFE_ADAPTIVE_HYBRID",
    hybridMetrics(baseline, deep, hybrid)
  );
}

export function evaluateSelectedSessionStrategyValidation(
  baseline: CalibrationValidationResult,
  deep: DeepIndependentValidationReport,
  hybrid: HybridIndependentValidationReport
): SessionStrategyValidationResult {
  const strategy = hybrid.metrics.selectedSessionStrategy;

  if (strategy === "BASELINE_ONLY") {
    return evaluateBaselineSessionStrategyValidation(baseline);
  }

  if (strategy === "DEEP_ONLY") {
    return evaluateDeepSessionStrategyValidation(deep);
  }

  return evaluateHybridSessionStrategyValidation(
    baseline,
    deep,
    hybrid
  );
}
