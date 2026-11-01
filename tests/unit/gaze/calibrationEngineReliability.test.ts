import {
  describe,
  expect,
  it
} from "vitest";

import {
  adjustCalibrationReliabilityDeepWeight,
  fitCalibrationEngineReliabilityModel
} from "../../../src/gaze/calibrationEngineReliability";

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

describe("Calibration engine reliability routing", () => {
  it("enables stronger Deep routing when nested calibration points consistently favor Deep", () => {
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

    const fit = fitCalibrationEngineReliabilityModel(
      baseline,
      deep
    );

    expect(fit.routingEnabled).toBe(true);
    expect(fit.crossValidation.reliabilityMeanErrorPx)
      .toBeLessThan(fit.crossValidation.currentMeanErrorPx);
    expect(fit.crossValidation.reliabilityP95ErrorPx)
      .toBeLessThanOrEqual(fit.crossValidation.currentP95ErrorPx);
    expect(fit.globalPrior.deepWinFraction).toBe(1);
    expect(fit.globalPrior.deepWeight).toBeGreaterThan(0.8);
  });

  it("keeps the established error-derived routing when the new model does not improve nested calibration", () => {
    const baseline = TARGETS.map(
      (target, pointIndex) => makeBaselinePoint(
        pointIndex,
        target,
        0.10
      )
    );

    const deep = TARGETS.map(
      (target, pointIndex) => makeDeepPoint(
        pointIndex,
        target,
        -0.10
      )
    );

    const fit = fitCalibrationEngineReliabilityModel(
      baseline,
      deep
    );

    expect(fit.routingEnabled).toBe(false);
    expect(fit.globalPrior.deepWeight).toBeCloseTo(0.5, 6);
  });

  it("excludes the held-out point from its own nested routing prior", () => {
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
        pointIndex === 0 ? 0.25 : 0.02
      )
    );

    const fit = fitCalibrationEngineReliabilityModel(
      baseline,
      deep
    );

    const heldOut = fit.crossValidation.pointResults.find(
      (point) => point.pointIndex === 0
    );

    expect(heldOut).toBeDefined();
    // Point 0 itself strongly favors Baseline, while all other training
    // points favor Deep. A high nested Deep weight proves point 0's own
    // target-derived optimal weight was not used to fit its routing prior.
    expect(heldOut?.reliabilityDeepWeight).toBeGreaterThan(0.8);
  });

  it("uses current target-free stability/confidence penalties to move a calibration routing weight", () => {
    const base = 0.8;

    const deepPenalized = adjustCalibrationReliabilityDeepWeight(
      base,
      1,
      2
    );

    const baselinePenalized = adjustCalibrationReliabilityDeepWeight(
      base,
      2,
      1
    );

    expect(deepPenalized).toBeLessThan(base);
    expect(baselinePenalized).toBeGreaterThan(base);
  });
});
