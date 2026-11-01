import {
  describe,
  expect,
  it
} from "vitest";

import type {
  CalibrationCleanedPoint
} from "../../../src/calibration/calibrationCleaner";

import {
  CalibrationModel
} from "../../../src/calibration/calibrationModel";

import {
  validateCalibrationModel
} from "../../../src/calibration/calibrationValidator";

import {
  ResidualCorrector
} from "../../../src/gaze/residualCorrector";

import type {
  Point2D
} from "../../../src/shared/types";

function targetFromRaw(
  raw: Point2D
): Point2D {
  return {
    x: raw.x + 0.04,
    y: raw.y - 0.025
  };
}

function cleanedPoint(
  pointIndex: number,
  raw: Point2D,
  target: Point2D
): CalibrationCleanedPoint {
  return {
    calibrationId: "calibration_test",
    pointIndex,
    targetNormalizedPoint: target,
    targetViewportPoint: {
      x: target.x * 1000,
      y: target.y * 800
    },
    representativeRawPoint: raw,
    samples: Array.from(
      { length: 12 },
      (_, sampleIndex) => ({
        calibrationId: "calibration_test",
        pointIndex,
        timestampMs: 1_000 + sampleIndex * 30,
        targetViewportPoint: {
          x: target.x * 1000,
          y: target.y * 800
        },
        rawGazePoint: {
          x:
            raw.x
            + (sampleIndex % 2 === 0
              ? 0.001
              : -0.001),
          y:
            raw.y
            + (sampleIndex % 3 === 0
              ? 0.001
              : -0.001)
        },
        rawGazeSpace: "NORMALIZED" as const,
        headPose: {
          yawDeg: 0,
          pitchDeg: 0,
          rollDeg: 0
        },
        faceDistanceRatio: 1,
        faceValid: true,
        eyesValid: true,
        blink: false,
        quality: 0.9,
        accepted: true
      })
    ),
    acceptedSampleCount: 12,
    rejectedSampleCount: 1,
    rejectionRatio: 1 / 13,
    meanHeadPose: {
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0
    },
    meanFaceDistanceRatio: 1,
    meanQuality: 0.9
  };
}

describe("calibration validation and residual correction", () => {
  it("reports GOOD validation for an independently collected synthetic set", () => {
    const trainingRaw: readonly Point2D[] = [
      { x: 0.08, y: 0.08 },
      { x: 0.92, y: 0.08 },
      { x: 0.92, y: 0.92 },
      { x: 0.08, y: 0.92 },
      { x: 0.50, y: 0.50 },
      { x: 0.25, y: 0.50 },
      { x: 0.75, y: 0.50 }
    ];

    const model =
      new CalibrationModel();

    model.fit(
      trainingRaw.map(
        (raw, pointIndex) =>
          cleanedPoint(
            pointIndex,
            raw,
            targetFromRaw(raw)
          )
      )
    );

    const targetCoordinates: readonly Point2D[] = [
      { x: 0.50, y: 0.50 },
      { x: 0.18, y: 0.18 },
      { x: 0.82, y: 0.18 },
      { x: 0.82, y: 0.82 },
      { x: 0.18, y: 0.82 },
      { x: 0.50, y: 0.18 },
      { x: 0.82, y: 0.50 },
      { x: 0.50, y: 0.82 },
      { x: 0.18, y: 0.50 }
    ];

    const validationPoints =
      targetCoordinates.map(
        (target, pointIndex) => {
          const raw = {
            x: target.x - 0.04,
            y: target.y + 0.025
          };

          return cleanedPoint(
            pointIndex,
            raw,
            target
          );
        }
      );

    const result =
      validateCalibrationModel(
        model,
        validationPoints,
        {
          width: 1000,
          height: 800
        }
      );

    expect(result.pointResults)
      .toHaveLength(9);
    expect(result.quality).toBe("GOOD");
    expect(result.metrics.meanErrorPx)
      .toBeLessThan(2);
    expect(result.metrics.cornerErrorPx)
      .toBeLessThan(2);
    expect(
      result.metrics
        .meanErrorViewportWidthRatio
    ).toBeLessThan(0.01);
    expect(result.metrics.meanPrecisionPx)
      .toBeGreaterThan(0);
    expect(result.metrics.validSampleRatio)
      .toBeCloseTo(12 / 13, 10);
  });

  it("converts corrected normalized gaze to viewport coordinates without clamping", () => {
    const rawTraining: readonly Point2D[] = [
      { x: 0.10, y: 0.10 },
      { x: 0.90, y: 0.10 },
      { x: 0.10, y: 0.90 },
      { x: 0.90, y: 0.90 },
      { x: 0.50, y: 0.50 }
    ];

    const model =
      new CalibrationModel();

    const fitted = model.fit(
      rawTraining.map(
        (raw, pointIndex) =>
          cleanedPoint(
            pointIndex,
            raw,
            targetFromRaw(raw)
          )
      )
    );

    const corrector =
      new ResidualCorrector();

    corrector.setModel(fitted);

    const result =
      corrector.correct(
        { x: 0.96, y: 0.50 },
        "NORMALIZED",
        {
          width: 1000,
          height: 800
        }
      );

    expect(result.correctedNormalizedPoint.x)
      .toBeGreaterThan(0.99);
    expect(result.correctedViewportPoint.x)
      .toBeGreaterThan(990);
    expect(result.correction.viewportOffsetXPx)
      .toBeGreaterThan(35);
  });
});
