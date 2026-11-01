import {
  describe,
  expect,
  it
} from "vitest";

import {
  cleanCalibrationPoint
} from "../../../src/calibration/calibrationCleaner";

import {
  CalibrationModel
} from "../../../src/calibration/calibrationModel";

import {
  ERROR_CODES,
  TrackerError
} from "../../../src/shared/errors";

import type {
  CalibrationCleanedPoint
} from "../../../src/calibration/calibrationCleaner";

import type {
  CalibrationPointCollection
} from "../../../src/calibration/calibrationCollector";

import type {
  CalibrationRawSample,
  Point2D
} from "../../../src/shared/types";

function createRawSample(
  timestampMs: number,
  point: Point2D,
  accepted = true
): CalibrationRawSample {
  return {
    calibrationId: "calibration_test",
    pointIndex: 0,
    timestampMs,
    targetViewportPoint: {
      x: 500,
      y: 400
    },
    rawGazePoint: point,
    rawGazeSpace: "NORMALIZED",
    headPose: {
      yawDeg: 1,
      pitchDeg: -1,
      rollDeg: 0.5
    },
    faceDistanceRatio: 1,
    faceValid: true,
    eyesValid: true,
    blink: false,
    quality: 0.9,
    accepted
  };
}

function createCollection(
  samples: readonly CalibrationRawSample[]
): CalibrationPointCollection {
  const accepted =
    samples.filter(
      (sample) => sample.accepted
    ).length;

  const rejected =
    samples.length - accepted;

  return {
    calibrationId: "calibration_test",
    target: {
      pointIndex: 0,
      normalizedPoint: {
        x: 0.5,
        y: 0.5
      },
      viewportPoint: {
        x: 500,
        y: 400
      }
    },
    targetShownAtMs: 1000,
    samples,
    acceptedSampleCount: accepted,
    rejectedSampleCount: rejected,
    rejectionRatio:
      samples.length === 0
        ? 0
        : rejected / samples.length,
    phase: "READY",
    sufficient: true
  };
}

function createCleanedPoint(
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
    samples: [],
    acceptedSampleCount: 10,
    rejectedSampleCount: 0,
    rejectionRatio: 0,
    meanHeadPose: {
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0
    },
    meanFaceDistanceRatio: 1,
    meanQuality: 0.9
  };
}

function syntheticTarget(
  raw: Point2D
): Point2D {
  return {
    x:
      raw.x
      + 0.05
      + 0.10 * raw.x
      - 0.02 * raw.y,
    y:
      raw.y
      - 0.03
      + 0.04 * raw.x
      + 0.08 * raw.y
  };
}


function distanceForTest(first: Point2D, second: Point2D): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

describe("calibration cleaning and residual model", () => {
  it("removes a large raw-gaze outlier while preserving the stable cluster", () => {
    const samples: CalibrationRawSample[] = [];

    for (let index = 0; index < 11; index += 1) {
      samples.push(
        createRawSample(
          1500 + index * 30,
          {
            x: 0.40 + index * 0.0005,
            y: 0.60 - index * 0.0004
          }
        )
      );
    }

    samples.push(
      createRawSample(
        1850,
        {
          x: 1.35,
          y: -0.40
        }
      )
    );

    const cleaned =
      cleanCalibrationPoint(
        createCollection(samples)
      );

    expect(cleaned.acceptedSampleCount)
      .toBe(11);

    // The new stable-window stage excludes the late outlier before MAD
    // cleaning. `rejectedSampleCount` therefore describes rejections inside
    // the selected stable window, while candidateAcceptedSampleCount keeps
    // the pre-window diagnostic count.
    expect(cleaned.rejectedSampleCount)
      .toBe(0);
    expect(cleaned.candidateAcceptedSampleCount)
      .toBe(12);
    expect(cleaned.stability?.sampleCount)
      .toBe(11);

    expect(cleaned.representativeRawPoint.x)
      .toBeCloseTo(0.4025, 3);
    expect(cleaned.representativeRawPoint.y)
      .toBeCloseTo(0.598, 3);
  });

  it("throws a calibration-specific error when too few samples remain", () => {
    const samples = Array.from(
      { length: 5 },
      (_, index) =>
        createRawSample(
          1500 + index * 30,
          { x: 0.5, y: 0.5 }
        )
    );

    try {
      cleanCalibrationPoint(
        createCollection(samples)
      );
      throw new Error(
        "Expected cleaning to fail."
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(
        TrackerError
      );

      if (error instanceof TrackerError) {
        expect(error.code).toBe(
          ERROR_CODES
            .CALIBRATION_INSUFFICIENT_SAMPLES
        );
      }
    }
  });


  it("keeps a valid adaptive low-FPS stable window during cleaning", () => {
    const samples = Array.from(
      { length: 12 },
      (_, index) =>
        createRawSample(
          1500 + index * 100,
          {
            x: 0.50 + (index % 2 === 0 ? 0.001 : -0.001),
            y: 0.50 + (index % 3 === 0 ? 0.001 : 0)
          }
        )
    );

    const cleaned = cleanCalibrationPoint(
      createCollection(samples)
    );

    expect(cleaned.stability?.stable).toBe(true);
    expect(cleaned.stability?.profile.effectiveSampleRateHz)
      .toBeCloseTo(10, 1);
    expect(cleaned.stability?.profile.minSampleCount).toBe(5);
    expect(cleaned.acceptedSampleCount).toBeGreaterThanOrEqual(5);
  });

  it("learns an affine personal residual correction from spatial calibration points", () => {
    const raws: readonly Point2D[] = [
      { x: 0.10, y: 0.10 },
      { x: 0.82, y: 0.10 },
      { x: 0.10, y: 0.90 },
      { x: 0.82, y: 0.90 },
      { x: 0.50, y: 0.50 },
      { x: 0.25, y: 0.70 },
      { x: 0.72, y: 0.28 }
    ];

    const points = raws.map(
      (raw, pointIndex) =>
        createCleanedPoint(
          pointIndex,
          raw,
          syntheticTarget(raw)
        )
    );

    const model =
      new CalibrationModel();

    const fitted = model.fit(points);

    const testRaw = {
      x: 0.37,
      y: 0.64
    };

    const predicted =
      model.predict(testRaw);

    const expected =
      syntheticTarget(testRaw);

    expect(fitted.trainingPointCount)
      .toBe(points.length);
    expect(predicted.x)
      .toBeCloseTo(expected.x, 3);
    expect(predicted.y)
      .toBeCloseTo(expected.y, 3);
  });

  it("selects a nonlinear calibration mapper when leave-one-point-out error improves", () => {
    const points: CalibrationCleanedPoint[] = [];
    let pointIndex = 0;

    for (const x of [0.10, 0.30, 0.50, 0.70, 0.90]) {
      for (const y of [0.10, 0.30, 0.50, 0.70, 0.90]) {
        const raw = { x, y };
        const dx = x - 0.5;
        const dy = y - 0.5;
        const target = {
          x: x + 0.035 + 0.11 * dx * dx - 0.055 * dx * dy,
          y: y - 0.025 + 0.085 * dy * dy + 0.045 * dx * dy
        };
        points.push(createCleanedPoint(pointIndex, raw, target));
        pointIndex += 1;
      }
    }

    const model = new CalibrationModel();
    const fitted = model.fit(points);
    const testRaw = { x: 0.42, y: 0.77 };
    const dx = testRaw.x - 0.5;
    const dy = testRaw.y - 0.5;
    const expected = {
      x: testRaw.x + 0.035 + 0.11 * dx * dx - 0.055 * dx * dy,
      y: testRaw.y - 0.025 + 0.085 * dy * dy + 0.045 * dx * dy
    };
    const predicted = model.predict(testRaw);

    expect(fitted.kind).not.toBe("AFFINE_RESIDUAL");
    expect(distanceForTest(predicted, expected)).toBeLessThan(0.012);
    expect(fitted.selectionCvMeanErrorNormalized).toBeTypeOf("number");
  });

});
