import {
  describe,
  expect,
  it
} from "vitest";

import {
  fitCalibrationCoarseEngineReliabilityModel
} from "../../../src/gaze/calibrationCoarseEngineReliability";

import type {
  CalibrationGroupedCvPointResult,
  CalibrationGroupedCvSpatialBucket
} from "../../../src/calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult
} from "../../../src/gaze/deepPersonalMapper";

import type {
  Point2D
} from "../../../src/shared/types";

const WIDTH = 1000;
const HEIGHT = 800;

const TARGETS: readonly Point2D[] = [
  { x: 0.50, y: 0.50 },
  { x: 0.10, y: 0.10 },
  { x: 0.90, y: 0.10 },
  { x: 0.90, y: 0.90 },
  { x: 0.10, y: 0.90 },
  { x: 0.50, y: 0.10 },
  { x: 0.90, y: 0.50 },
  { x: 0.50, y: 0.90 },
  { x: 0.10, y: 0.50 },
  { x: 0.30, y: 0.30 },
  { x: 0.70, y: 0.30 },
  { x: 0.70, y: 0.70 },
  { x: 0.30, y: 0.70 },
  { x: 0.50, y: 0.30 },
  { x: 0.70, y: 0.50 },
  { x: 0.50, y: 0.70 },
  { x: 0.30, y: 0.50 }
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

function makeBaselinePoint(
  pointIndex: number,
  target: Point2D,
  offsetX: number
): CalibrationGroupedCvPointResult {
  const predictedNormalizedPoint = {
    x: target.x + offsetX,
    y: target.y
  };

  return {
    pointIndex,
    targetNormalizedPoint: target,
    targetViewportPoint: {
      x: target.x * WIDTH,
      y: target.y * HEIGHT
    },
    predictedNormalizedPoint,
    predictedViewportPoint: {
      x: predictedNormalizedPoint.x * WIDTH,
      y: predictedNormalizedPoint.y * HEIGHT
    },
    errorPx: Math.abs(offsetX * WIDTH),
    spatialBucket: coarseBucket(target)
  };
}

function makeDeepPoint(
  pointIndex: number,
  target: Point2D,
  offsetX: number
): DeepGroupedCvPointResult {
  const predictedNormalizedPoint = {
    x: target.x + offsetX,
    y: target.y
  };

  return {
    pointIndex,
    targetNormalizedPoint: target,
    targetViewportPoint: {
      x: target.x * WIDTH,
      y: target.y * HEIGHT
    },
    predictedNormalizedPoint,
    predictedViewportPoint: {
      x: predictedNormalizedPoint.x * WIDTH,
      y: predictedNormalizedPoint.y * HEIGHT
    },
    errorPx: Math.abs(offsetX * WIDTH),
    spatialBucket: coarseBucket(target)
  };
}

describe("Calibration coarse engine reliability routing", () => {
  it("enables robust coarse routing when grouped calibration consistently favors Deep", () => {
    const baseline = TARGETS.map(
      (target, pointIndex) => makeBaselinePoint(
        pointIndex,
        target,
        pointIndex % 2 === 0 ? 0.20 : -0.20
      )
    );

    const deep = TARGETS.map(
      (target, pointIndex) => makeDeepPoint(
        pointIndex,
        target,
        pointIndex % 2 === 0 ? 0.02 : -0.02
      )
    );

    const fit = fitCalibrationCoarseEngineReliabilityModel(
      baseline,
      deep
    );

    expect(fit.routingEnabled).toBe(true);
    expect(fit.crossValidation.coarseReliabilityMeanErrorPx)
      .toBeLessThan(fit.crossValidation.currentMeanErrorPx);
    expect(fit.crossValidation.coarseReliabilityP95ErrorPx)
      .toBeLessThanOrEqual(fit.crossValidation.currentP95ErrorPx);
    expect(fit.globalPrior.deepWinFraction).toBe(1);
    expect(fit.globalPrior.deepWeight).toBeGreaterThan(0.8);
    expect(fit.bucketPriors.EDGE.calibrationPointCount).toBe(8);
    expect(fit.bucketPriors.CORNER.calibrationPointCount).toBe(8);
  });

  it("uses median paired evidence so one extreme calibration outlier does not dominate a coarse bucket", () => {
    const baseline = TARGETS.map(
      (target, pointIndex) => makeBaselinePoint(
        pointIndex,
        target,
        0.18
      )
    );

    const deep = TARGETS.map(
      (target, pointIndex) => makeDeepPoint(
        pointIndex,
        target,
        pointIndex === 1 ? 0.60 : 0.03
      )
    );

    const fit = fitCalibrationCoarseEngineReliabilityModel(
      baseline,
      deep
    );

    expect(fit.bucketPriors.CORNER.deepWinFraction)
      .toBeGreaterThan(0.8);
    expect(fit.bucketPriors.CORNER.medianDeepAdvantagePx)
      .toBeGreaterThan(0);
    expect(fit.bucketPriors.CORNER.robustDeepWeightMedian)
      .toBeGreaterThan(0.8);
    expect(fit.bucketPriors.CORNER.deepWeight)
      .toBeGreaterThan(0.75);
  });

  it("keeps the established routing when coarse paired evidence does not improve nested calibration", () => {
    const baseline = TARGETS.map(
      (target, pointIndex) => makeBaselinePoint(
        pointIndex,
        target,
        pointIndex % 2 === 0 ? 0.10 : -0.10
      )
    );

    const deep = TARGETS.map(
      (target, pointIndex) => makeDeepPoint(
        pointIndex,
        target,
        pointIndex % 2 === 0 ? -0.10 : 0.10
      )
    );

    const fit = fitCalibrationCoarseEngineReliabilityModel(
      baseline,
      deep
    );

    expect(fit.routingEnabled).toBe(false);
    expect(fit.globalPrior.deepWeight).toBeCloseTo(0.5, 6);
  });

  it("excludes the held-out calibration point from its own coarse routing prior", () => {
    const baseline = TARGETS.map(
      (target, pointIndex) => makeBaselinePoint(
        pointIndex,
        target,
        pointIndex === 0 ? 0.02 : 0.20
      )
    );

    const deep = TARGETS.map(
      (target, pointIndex) => makeDeepPoint(
        pointIndex,
        target,
        // Keep the held-out prediction inside the CENTER routing region while
        // still making Deep substantially worse than Baseline for this point.
        // This makes the test sensitive to leakage: if point 0 were included
        // in its own CENTER prior, the resulting Deep weight would drop.
        pointIndex === 0 ? 0.16 : 0.02
      )
    );

    const fit = fitCalibrationCoarseEngineReliabilityModel(
      baseline,
      deep
    );

    const heldOut = fit.crossValidation.pointResults.find(
      (point) => point.pointIndex === 0
    );

    expect(heldOut).toBeDefined();
    expect(heldOut?.routingBucket).toBe("CENTER");
    expect(heldOut?.coarseReliabilityDeepWeight)
      .toBeGreaterThan(0.8);
  });
});
