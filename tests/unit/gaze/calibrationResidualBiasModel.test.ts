import {
  describe,
  expect,
  it
} from "vitest";

import {
  applyCalibrationResidualBias,
  fitCalibrationResidualBiasModel
} from "../../../src/gaze/calibrationResidualBiasModel";

import type {
  CalibrationResidualSourcePoint
} from "../../../src/gaze/calibrationResidualBiasModel";

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

function makePoint(
  pointIndex: number,
  target: Point2D,
  predictionOffset: Point2D
): CalibrationResidualSourcePoint {
  const predictedNormalizedPoint = {
    x: target.x + predictionOffset.x,
    y: target.y + predictionOffset.y
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
    }
  };
}

function duplicateForBothEngines(
  points: readonly CalibrationResidualSourcePoint[]
): ReturnType<typeof fitCalibrationResidualBiasModel> {
  return fitCalibrationResidualBiasModel(points, points);
}

describe("Calibration residual bias model", () => {
  it("learns a coherent systematic calibration-only bias with nested point exclusion", () => {
    const points = TARGETS.map(
      (target, pointIndex) =>
        makePoint(
          pointIndex,
          target,
          { x: 0.04, y: -0.03 }
        )
    );

    const fit = duplicateForBothEngines(points);
    const diagnostics = fit.deep.crossValidation;

    expect(fit.deep.correctionEnabled).toBe(true);
    expect(diagnostics.correctedMeanErrorPx)
      .toBeLessThan(diagnostics.rawMeanErrorPx);
    expect(diagnostics.correctedP95ErrorPx)
      .toBeLessThanOrEqual(diagnostics.rawP95ErrorPx);
    expect(diagnostics.improvedPointFraction).toBe(1);
  });

  it("does not enable a correction when nested calibration evidence does not improve the engine", () => {
    const points = TARGETS.map(
      (target, pointIndex) =>
        makePoint(
          pointIndex,
          target,
          {
            x: pointIndex % 2 === 0 ? 0.05 : -0.05,
            y: pointIndex % 3 === 0 ? 0.04 : -0.04
          }
        )
    );

    const fit = duplicateForBothEngines(points);

    expect(fit.deep.correctionEnabled).toBe(false);
  });

  it("learns different directional residual vectors for top and bottom gaze", () => {
    const points = TARGETS.map(
      (target, pointIndex) => {
        const offsetY = target.y <= 0.33
          ? 0.05
          : target.y >= 0.67
            ? -0.05
            : 0;

        return makePoint(
          pointIndex,
          target,
          { x: 0.02, y: offsetY }
        );
      }
    );

    const fit = duplicateForBothEngines(points);

    expect(
      fit.deep.directionalPriors.TOP
        .meanResidualNormalized.y
    ).toBeLessThan(0);

    expect(
      fit.deep.directionalPriors.BOTTOM
        .meanResidualNormalized.y
    ).toBeGreaterThan(0);
  });

  it("does not use the held-out point residual when producing its nested correction", () => {
    const points = TARGETS.map(
      (target, pointIndex) =>
        makePoint(
          pointIndex,
          target,
          pointIndex === 0
            ? { x: -0.25, y: 0 }
            : { x: 0.04, y: 0 }
        )
    );

    const fit = duplicateForBothEngines(points);
    const heldOut = fit.deep.crossValidation.pointResults.find(
      (point) => point.pointIndex === 0
    );

    expect(heldOut).toBeDefined();
    // The held-out point needs a positive residual (+0.25), but the other
    // eight calibration points all teach a negative correction. A negative
    // nested correction proves its own residual was excluded from fitting.
    expect(heldOut?.correctionNormalized.x).toBeLessThan(0);
  });


  it("shrinks full-strength bias when calibration-only inner folds are mixed but still beneficial", () => {
    const points = TARGETS.map(
      (target, pointIndex) =>
        makePoint(
          pointIndex,
          target,
          pointIndex % 3 === 0
            ? { x: -0.01, y: 0.015 }
            : { x: 0.04, y: -0.03 }
        )
    );

    const fit = duplicateForBothEngines(points);
    const diagnostics = fit.deep.crossValidation;

    expect(fit.deep.correctionEnabled).toBe(true);
    expect(fit.deep.correctionStrength).toBeGreaterThan(0);
    expect(fit.deep.correctionStrength).toBeLessThan(1);
    expect(diagnostics.correctedMeanErrorPx)
      .toBeLessThan(diagnostics.rawMeanErrorPx);
    expect(diagnostics.correctedP95ErrorPx)
      .toBeLessThanOrEqual(diagnostics.rawP95ErrorPx);
    expect(diagnostics.correctedP95ErrorPx)
      .toBeLessThan(diagnostics.fullStrengthCorrectedP95ErrorPx);
  });

  it("does not use the outer held-out point when estimating its correction strength", () => {
    const points = TARGETS.map(
      (target, pointIndex) =>
        makePoint(
          pointIndex,
          target,
          pointIndex === 0
            ? { x: -0.25, y: 0 }
            : { x: 0.04, y: -0.03 }
        )
    );

    const fit = duplicateForBothEngines(points);
    const heldOut = fit.deep.crossValidation.pointResults.find(
      (point) => point.pointIndex === 0
    );

    expect(heldOut).toBeDefined();
    // The other eight points teach a coherent full-strength bias. If point 0
    // leaked into alpha selection, its opposite residual would shrink alpha.
    expect(heldOut?.correctionStrength).toBeGreaterThan(0.9);
  });

  it("backs directional correction toward the global bias when drift reliability drops", () => {
    const points = TARGETS.map(
      (target, pointIndex) => {
        const offsetX = target.y <= 0.33 ? 0.04 : 0.02;
        return makePoint(
          pointIndex,
          target,
          { x: offsetX, y: 0 }
        );
      }
    );

    const fit = duplicateForBothEngines(points);

    expect(fit.deep.correctionEnabled).toBe(true);

    const stable = applyCalibrationResidualBias(
      { x: 0.5, y: 0.18 },
      fit.deep,
      "TOP",
      1
    );

    const drifted = applyCalibrationResidualBias(
      { x: 0.5, y: 0.18 },
      fit.deep,
      "TOP",
      0.55
    );

    expect(Math.abs(stable.correctionNormalized.x))
      .toBeGreaterThan(Math.abs(drifted.correctionNormalized.x));
  });
});
