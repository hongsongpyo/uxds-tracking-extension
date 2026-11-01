import {
  describe,
  expect,
  it
} from "vitest";

import {
  evaluateCalibrationWindowStability,
  getCalibrationBaselineDriftReason,
  selectBestCalibrationStableWindow
} from "../../../src/calibration/calibrationStability";

import type {
  CalibrationRawSample,
  FaceBaseline
} from "../../../src/shared/types";

function createSample(
  index: number,
  overrides: Partial<CalibrationRawSample> = {}
): CalibrationRawSample {
  return {
    calibrationId: "calibration_test",
    pointIndex: 0,
    timestampMs: 1_500 + index * 33,
    targetViewportPoint: {
      x: 500,
      y: 400
    },
    rawGazePoint: {
      x: 0.5 + (index % 2 === 0 ? 0.002 : -0.002),
      y: 0.5 + (index % 3 === 0 ? 0.002 : -0.001)
    },
    rawGazeSpace: "NORMALIZED",
    headPose: {
      yawDeg: 0.2,
      pitchDeg: -0.1,
      rollDeg: 0.1
    },
    faceDistanceRatio: 1,
    faceCenterNormalized: {
      x: 0.5,
      y: 0.5
    },
    faceValid: true,
    eyesValid: true,
    blink: false,
    quality: 0.95,
    accepted: true,
    ...overrides
  };
}

const baseline: FaceBaseline = {
  centerX: 0.5,
  centerY: 0.5,
  width: 0.3,
  height: 0.4,
  headPose: {
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0
  },
  distanceRatio: 1
};

describe("calibration stability", () => {
  it("accepts a stable fixation window", () => {
    const samples = Array.from(
      { length: 15 },
      (_, index) => createSample(index)
    );

    const metrics =
      evaluateCalibrationWindowStability(samples);

    expect(metrics.stable).toBe(true);
    expect(metrics.sampleCount).toBe(15);
    expect(metrics.durationMs)
      .toBeGreaterThanOrEqual(280);
  });

  it("selects the stable segment instead of an early saccade", () => {
    const samples = Array.from(
      { length: 25 },
      (_, index) =>
        createSample(
          index,
          index < 5
            ? {
                rawGazePoint: {
                  x: 0.1 + index * 0.12,
                  y: 0.2 + index * 0.08
                }
              }
            : {}
        )
    );

    const window =
      selectBestCalibrationStableWindow(samples);

    expect(window).not.toBeNull();
    expect(window?.metrics.stable).toBe(true);
    expect(window?.startTimestampMs)
      .toBeGreaterThanOrEqual(
        samples[4]?.timestampMs ?? 0
      );
  });

  it("rejects large head-pose and face-position drift from the baseline", () => {
    expect(
      getCalibrationBaselineDriftReason(
        baseline,
        {
          headPose: {
            yawDeg: 20,
            pitchDeg: 0,
            rollDeg: 0
          },
          faceDistanceRatio: 1,
          faceCenterNormalized: {
            x: 0.5,
            y: 0.5
          }
        }
      )
    ).toBe("HEAD_POSE_DRIFT");

    expect(
      getCalibrationBaselineDriftReason(
        baseline,
        {
          headPose: {
            yawDeg: 0,
            pitchDeg: 0,
            rollDeg: 0
          },
          faceDistanceRatio: 1,
          faceCenterNormalized: {
            x: 0.64,
            y: 0.5
          }
        }
      )
    ).toBe("FACE_POSITION_DRIFT");
  });
});

it("adapts the stable-window sample requirement to a 10 Hz baseline cadence", () => {
  const samples = Array.from(
    { length: 12 },
    (_, index) => createSample(
      index,
      {
        timestampMs: 1_500 + index * 100
      }
    )
  );

  const window =
    selectBestCalibrationStableWindow(samples);

  expect(window).not.toBeNull();
  expect(window?.metrics.stable).toBe(true);
  expect(window?.metrics.profile.effectiveSampleRateHz)
    .toBeCloseTo(10, 1);
  expect(window?.metrics.profile.minSampleCount)
    .toBeLessThan(10);
  expect(window?.metrics.profile.windowMs)
    .toBeGreaterThanOrEqual(500);
});

it("removes an isolated gaze-model spike before stability scoring", () => {
  const samples = Array.from(
    { length: 15 },
    (_, index) => createSample(
      index,
      index === 7
        ? {
            rawGazePoint: {
              x: 0.92,
              y: 0.12
            }
          }
        : {}
    )
  );

  const window =
    selectBestCalibrationStableWindow(samples);

  expect(window).not.toBeNull();
  expect(window?.metrics.stable).toBe(true);
  expect(window?.metrics.candidateSampleCount)
    .toBeGreaterThan(window?.metrics.sampleCount ?? 0);
  expect(window?.metrics.spatialInlierRatio)
    .toBeGreaterThanOrEqual(0.60);
});
