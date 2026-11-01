import {
  describe,
  expect,
  it
} from "vitest";

import {
  CalibrationHybridSelector
} from "../../../src/gaze/calibrationHybridSelector";

import type {
  CalibrationGroupedCvDiagnostics,
  CalibrationGroupedCvPointResult,
  CalibrationGroupedCvSpatialBucket
} from "../../../src/calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult,
  DeepPersonalMapperFitResult
} from "../../../src/gaze/deepPersonalMapper";

import type {
  Point2D
} from "../../../src/shared/types";

const TARGETS: readonly Point2D[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.18, y: 0.18 },
  { x: 0.82, y: 0.18 },
  { x: 0.82, y: 0.82 },
  { x: 0.18, y: 0.82 },
  { x: 0.5, y: 0.18 },
  { x: 0.82, y: 0.5 },
  { x: 0.5, y: 0.82 },
  { x: 0.18, y: 0.5 }
];

function coarseBucket(
  point: Point2D
): CalibrationGroupedCvSpatialBucket {
  const horizontalOuter = point.x <= 0.33 || point.x >= 0.67;
  const verticalOuter = point.y <= 0.33 || point.y >= 0.67;

  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }

  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }

  return "CENTER";
}

function baselineError(index: number): number {
  if (index === 5) {
    return 40;
  }

  if (index === 7) {
    return 200;
  }

  return 100;
}

function deepError(index: number): number {
  if (index === 5) {
    return 200;
  }

  if (index === 7) {
    return 40;
  }

  return 100;
}

function baselinePoint(
  target: Point2D,
  pointIndex: number
): CalibrationGroupedCvPointResult {
  return {
    pointIndex,
    targetNormalizedPoint: target,
    targetViewportPoint: {
      x: target.x * 1000,
      y: target.y * 800
    },
    predictedNormalizedPoint: target,
    predictedViewportPoint: {
      x: target.x * 1000,
      y: target.y * 800
    },
    errorPx: baselineError(pointIndex),
    spatialBucket: coarseBucket(target)
  };
}

function deepPoint(
  target: Point2D,
  pointIndex: number
): DeepGroupedCvPointResult {
  return {
    pointIndex,
    targetNormalizedPoint: target,
    targetViewportPoint: {
      x: target.x * 1000,
      y: target.y * 800
    },
    predictedNormalizedPoint: target,
    predictedViewportPoint: {
      x: target.x * 1000,
      y: target.y * 800
    },
    errorPx: deepError(pointIndex),
    spatialBucket: coarseBucket(target)
  };
}

function createFitInputs(): {
  readonly baseline: CalibrationGroupedCvDiagnostics;
  readonly deep: DeepPersonalMapperFitResult;
} {
  const baselinePoints = TARGETS.map(baselinePoint);
  const deepPoints = TARGETS.map(deepPoint);

  const baselineMean = baselinePoints.reduce(
    (sum, point) => sum + point.errorPx,
    0
  ) / baselinePoints.length;

  const deepMean = deepPoints.reduce(
    (sum, point) => sum + point.errorPx,
    0
  ) / deepPoints.length;

  const selectedCandidate = {
    kind: "LINEAR_RIDGE" as const,
    ridgeLambda: 0.1,
    rbfGammaScale: null,
    evaluatedPointCount: deepPoints.length,
    meanErrorPx: deepMean,
    p95ErrorPx: 200,
    rmsePx: deepMean
  };

  return {
    baseline: {
      pointCount: baselinePoints.length,
      meanErrorPx: baselineMean,
      p95ErrorPx: 200,
      rmsePx: baselineMean,
      pointResults: baselinePoints
    },
    deep: {
      modelReady: true,
      calibrationPointCount: deepPoints.length,
      projectedFeatureDimension: 4,
      combinedFeatureDimension: 8,
      selectedCandidate,
      candidates: [selectedCandidate],
      selectedPointResults: deepPoints,
      calibrationMeanConfidence: 0.7
    }
  };
}

describe("CalibrationHybridSelector", () => {
  it("learns different TOP and BOTTOM reliability from calibration-only CV", () => {
    const selector = new CalibrationHybridSelector();
    const inputs = createFitInputs();

    selector.fit(inputs.baseline, inputs.deep);

    const top = selector.predict(
      { x: 0.5, y: 0.18 },
      { x: 0.5, y: 0.18 },
      {
        deepConfidence: 0.75,
        drift: null
      }
    );

    const bottom = selector.predict(
      { x: 0.5, y: 0.82 },
      { x: 0.5, y: 0.82 },
      {
        deepConfidence: 0.75,
        drift: null
      }
    );

    expect(top?.directionalBucket).toBe("TOP");
    expect(bottom?.directionalBucket).toBe("BOTTOM");
    expect(top?.deepWeight).toBeLessThan(0.5);
    expect(bottom?.deepWeight).toBeGreaterThan(0.5);
  });

  it("backs directional confidence toward global when geometry drift is large", () => {
    const selector = new CalibrationHybridSelector();
    const inputs = createFitInputs();

    selector.fit(inputs.baseline, inputs.deep);

    const stable = selector.predict(
      { x: 0.5, y: 0.82 },
      { x: 0.5, y: 0.82 },
      {
        deepConfidence: 0.75,
        drift: null
      }
    );

    const drifted = selector.predict(
      { x: 0.5, y: 0.82 },
      { x: 0.5, y: 0.82 },
      {
        deepConfidence: 0.75,
        drift: {
          deltaHeadYawDeg: 10,
          deltaHeadPitchDeg: 10,
          deltaHeadRollDeg: 8,
          deltaFaceCenterX: 0.06,
          deltaFaceCenterY: 0.06,
          faceWidthScaleDelta: 0.15,
          faceHeightScaleDelta: 0.15,
          faceDistanceDelta: 0.15
        }
      }
    );

    expect(stable).not.toBeNull();
    expect(drifted).not.toBeNull();
    expect(drifted?.directionalPriorReliability)
      .toBeLessThan(stable?.directionalPriorReliability ?? 0);
  });
});

it("reduces weight for an engine whose current prediction window is jittery", () => {
  const selector = new CalibrationHybridSelector();
  const inputs = createFitInputs();

  selector.fit(inputs.baseline, inputs.deep);

  const stableDeep = selector.predict(
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 70,
      deepPrecisionPx: 15
    }
  );

  const jitteryDeep = selector.predict(
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 15,
      deepPrecisionPx: 90
    }
  );

  expect(stableDeep).not.toBeNull();
  expect(jitteryDeep).not.toBeNull();
  expect(stableDeep?.deepWeight)
    .toBeGreaterThan(jitteryDeep?.deepWeight ?? 1);
  expect(jitteryDeep?.deepStabilityPenaltyMultiplier)
    .toBeGreaterThan(stableDeep?.deepStabilityPenaltyMultiplier ?? 0);
});

it("reports model disagreement without using a target label", () => {
  const selector = new CalibrationHybridSelector();
  const inputs = createFitInputs();

  selector.fit(inputs.baseline, inputs.deep);

  const prediction = selector.predict(
    { x: 0.40, y: 0.50 },
    { x: 0.60, y: 0.50 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 20,
      deepPrecisionPx: 20
    }
  );

  expect(prediction).not.toBeNull();
  expect(prediction?.modelDisagreementNormalized)
    .toBeCloseTo(0.20, 6);
});

it("applies only calibration-validated residual bias before hybrid fusion", () => {
  const baselinePoints = TARGETS.map(
    (target, pointIndex): CalibrationGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.05 : -0.05;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepPoints = TARGETS.map(
    (target, pointIndex): DeepGroupedCvPointResult => {
      const predictedNormalizedPoint = {
        x: target.x + 0.04,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: 40,
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepMean = deepPoints.reduce(
    (sum, point) => sum + point.errorPx,
    0
  ) / deepPoints.length;

  const selectedCandidate = {
    kind: "LINEAR_RIDGE" as const,
    ridgeLambda: 0.1,
    rbfGammaScale: null,
    evaluatedPointCount: deepPoints.length,
    meanErrorPx: deepMean,
    p95ErrorPx: 40,
    rmsePx: 40
  };

  const selector = new CalibrationHybridSelector();
  const fit = selector.fit(
    {
      pointCount: baselinePoints.length,
      meanErrorPx: 50,
      p95ErrorPx: 50,
      rmsePx: 50,
      pointResults: baselinePoints
    },
    {
      modelReady: true,
      calibrationPointCount: deepPoints.length,
      projectedFeatureDimension: 4,
      combinedFeatureDimension: 8,
      selectedCandidate,
      candidates: [selectedCandidate],
      selectedPointResults: deepPoints,
      calibrationMeanConfidence: 0.7
    }
  );

  expect(fit.residualBias.baseline.correctionEnabled).toBe(false);
  expect(fit.residualBias.deep.correctionEnabled).toBe(true);
  expect(fit.residualBias.deep.correctionStrength)
    .toBeGreaterThan(0);
  expect(fit.residualBias.deep.correctionStrength)
    .toBeLessThanOrEqual(1);

  const prediction = selector.predict(
    { x: 0.50, y: 0.50 },
    { x: 0.54, y: 0.50 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 20,
      deepPrecisionPx: 20
    }
  );

  expect(prediction).not.toBeNull();
  expect(prediction?.baselineBiasCorrectionApplied).toBe(false);
  expect(prediction?.deepBiasCorrectionApplied).toBe(true);
  expect(prediction?.deepBiasCorrectionStrength)
    .toBe(fit.residualBias.deep.correctionStrength);
  expect(prediction?.deepBiasCorrectedNormalizedPoint.x)
    .toBeLessThan(0.54);
});

it("uses nested calibration-only engine reliability to exceed the legacy 0.8 Deep cap only when validated", () => {
  const baselinePoints = TARGETS.map(
    (target, pointIndex): CalibrationGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.12 : -0.12;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepPoints = TARGETS.map(
    (target, pointIndex): DeepGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.01 : -0.01;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepMean = deepPoints.reduce(
    (sum, point) => sum + point.errorPx,
    0
  ) / deepPoints.length;

  const selectedCandidate = {
    kind: "LINEAR_RIDGE" as const,
    ridgeLambda: 0.1,
    rbfGammaScale: null,
    evaluatedPointCount: deepPoints.length,
    meanErrorPx: deepMean,
    p95ErrorPx: deepMean,
    rmsePx: deepMean
  };

  const selector = new CalibrationHybridSelector();
  const fit = selector.fit(
    {
      pointCount: baselinePoints.length,
      meanErrorPx: 120,
      p95ErrorPx: 120,
      rmsePx: 120,
      pointResults: baselinePoints
    },
    {
      modelReady: true,
      calibrationPointCount: deepPoints.length,
      projectedFeatureDimension: 4,
      combinedFeatureDimension: 8,
      selectedCandidate,
      candidates: [selectedCandidate],
      selectedPointResults: deepPoints,
      calibrationMeanConfidence: 0.7
    }
  );

  expect(fit.engineReliability.routingEnabled).toBe(true);
  expect(fit.coarseEngineReliability.routingEnabled).toBe(true);

  const prediction = selector.predict(
    { x: 0.62, y: 0.50 },
    { x: 0.51, y: 0.50 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 20,
      deepPrecisionPx: 20
    }
  );

  expect(prediction).not.toBeNull();
  expect(prediction?.coarseCalibrationReliabilityRoutingApplied).toBe(true);
  expect(prediction?.calibrationReliabilityRoutingApplied).toBe(false);
  expect(prediction?.activeReliabilityRoutingMode).toBe("COARSE");
  expect(prediction?.deepWeight).toBeGreaterThan(0.8);
});

it("uses the calibration-selected session strategy for the final output while retaining the hybrid candidate", () => {
  const baselinePoints = TARGETS.map(
    (target, pointIndex): CalibrationGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.12 : -0.12;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepPoints = TARGETS.map(
    (target, pointIndex): DeepGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.015 : -0.015;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepMean = deepPoints.reduce(
    (sum, point) => sum + point.errorPx,
    0
  ) / deepPoints.length;

  const selectedCandidate = {
    kind: "LINEAR_RIDGE" as const,
    ridgeLambda: 0.1,
    rbfGammaScale: null,
    evaluatedPointCount: deepPoints.length,
    meanErrorPx: deepMean,
    p95ErrorPx: deepMean,
    rmsePx: deepMean
  };

  const selector = new CalibrationHybridSelector();
  const fit = selector.fit(
    {
      pointCount: baselinePoints.length,
      meanErrorPx: 120,
      p95ErrorPx: 120,
      rmsePx: 120,
      pointResults: baselinePoints
    },
    {
      modelReady: true,
      calibrationPointCount: deepPoints.length,
      projectedFeatureDimension: 4,
      combinedFeatureDimension: 8,
      selectedCandidate,
      candidates: [selectedCandidate],
      selectedPointResults: deepPoints,
      calibrationMeanConfidence: 0.7
    }
  );

  expect(fit.sessionStrategy.selectedStrategy).toBe("DEEP_ONLY");

  const prediction = selector.predict(
    { x: 0.40, y: 0.50 },
    { x: 0.55, y: 0.50 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 20,
      deepPrecisionPx: 20
    }
  );

  expect(prediction).not.toBeNull();
  expect(prediction?.selectedSessionStrategy).toBe("DEEP_ONLY");
  expect(prediction?.selectedStrategyDeepWeight).toBe(1);
  expect(prediction?.normalizedPoint.x)
    .toBeCloseTo(
      prediction?.deepBiasCorrectedNormalizedPoint.x ?? 0,
      8
    );
});

it("attenuates calibration reliability routing under strong disagreement and current instability", () => {
  const baselinePoints = TARGETS.map(
    (target, pointIndex): CalibrationGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.12 : -0.12;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepPoints = TARGETS.map(
    (target, pointIndex): DeepGroupedCvPointResult => {
      const offsetX = pointIndex % 2 === 0 ? 0.015 : -0.015;
      const predictedNormalizedPoint = {
        x: target.x + offsetX,
        y: target.y
      };

      return {
        pointIndex,
        targetNormalizedPoint: target,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        predictedNormalizedPoint,
        predictedViewportPoint: {
          x: predictedNormalizedPoint.x * 1000,
          y: predictedNormalizedPoint.y * 800
        },
        errorPx: Math.abs(offsetX * 1000),
        spatialBucket: coarseBucket(target)
      };
    }
  );

  const deepMean = deepPoints.reduce(
    (sum, point) => sum + point.errorPx,
    0
  ) / deepPoints.length;

  const selectedCandidate = {
    kind: "LINEAR_RIDGE" as const,
    ridgeLambda: 0.1,
    rbfGammaScale: null,
    evaluatedPointCount: deepPoints.length,
    meanErrorPx: deepMean,
    p95ErrorPx: deepMean,
    rmsePx: deepMean
  };

  const selector = new CalibrationHybridSelector();

  selector.fit(
    {
      pointCount: baselinePoints.length,
      meanErrorPx: 120,
      p95ErrorPx: 120,
      rmsePx: 120,
      pointResults: baselinePoints
    },
    {
      modelReady: true,
      calibrationPointCount: deepPoints.length,
      projectedFeatureDimension: 4,
      combinedFeatureDimension: 8,
      selectedCandidate,
      candidates: [selectedCandidate],
      selectedPointResults: deepPoints,
      calibrationMeanConfidence: 0.7
    }
  );

  const stable = selector.predict(
    { x: 0.40, y: 0.50 },
    { x: 0.62, y: 0.50 },
    {
      deepConfidence: 0.75,
      drift: null,
      baselinePrecisionPx: 20,
      deepPrecisionPx: 20
    }
  );

  const unstable = selector.predict(
    { x: 0.40, y: 0.50 },
    { x: 0.62, y: 0.50 },
    {
      deepConfidence: 0.58,
      drift: null,
      baselinePrecisionPx: 20,
      deepPrecisionPx: 250
    }
  );

  expect(stable).not.toBeNull();
  expect(unstable).not.toBeNull();
  expect(unstable?.liveRoutingAttenuation)
    .toBeLessThan(stable?.liveRoutingAttenuation ?? 0);
  expect(unstable?.effectiveRoutingInfluence)
    .toBeLessThan(stable?.effectiveRoutingInfluence ?? 0);
});
