import {
  describe,
  expect,
  it
} from "vitest";

import {
  CalibrationCollector
} from "../../../src/calibration/calibrationCollector";

import type {
  CalibrationObservation
} from "../../../src/calibration/calibrationCollector";

import type {
  CalibrationTarget
} from "../../../src/shared/types";

const target: CalibrationTarget = {
  pointIndex: 0,
  normalizedPoint: {
    x: 0.5,
    y: 0.5
  },
  viewportPoint: {
    x: 500,
    y: 400
  }
};

function createObservation(
  timestampMs: number,
  options: {
    blink?: boolean;
    gazeValid?: boolean;
    gazeQuality?: number;
  } = {}
): CalibrationObservation {
  const blink = options.blink ?? false;

  return {
    prediction: {
      timestampMs,
      rawPoint: {
        x: 0.48,
        y: 0.52
      },
      rawSpace: "NORMALIZED",
      confidence: 0.9,
      faceValid: true,
      eyesValid: true,
      headPose: {
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0
      },
      source: "WEB_EYE_TRACK"
    },
    gazeValid:
      options.gazeValid ?? true,
    gazeQuality:
      options.gazeQuality ?? 0.9,
    face: {
      faceValid: true,
      eyesValid: true,
      leftEyeVisible: true,
      rightEyeVisible: true,
      blink,
      faceConfidence: 0.95,
      eyeConfidence: 0.95,
      faceDistanceRatio: 1,
      headPose: {
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0
      },
      qualityScore: 0.9,
      qualityLevel: "GOOD"
    }
  };
}

describe("CalibrationCollector", () => {
  it("ignores the settle interval and accepts stable valid samples", () => {
    const collector =
      new CalibrationCollector();

    collector.beginPoint(
      "calibration_test",
      target,
      1000
    );

    const settling =
      collector.observe(
        createObservation(1200)
      );

    const collecting =
      collector.observe(
        createObservation(1450)
      );

    expect(settling.stored).toBe(false);
    expect(settling.phase).toBe("SETTLING");
    expect(collecting.stored).toBe(true);
    expect(collecting.accepted).toBe(true);
    expect(collecting.phase).toBe("COLLECTING");
  });

  it("stores blink frames as rejected calibration samples", () => {
    const collector =
      new CalibrationCollector();

    collector.beginPoint(
      "calibration_test",
      target,
      1000
    );

    const decision =
      collector.observe(
        createObservation(
          1500,
          { blink: true }
        )
      );

    expect(decision.accepted).toBe(false);
    expect(decision.rejectionReason)
      .toBe("BLINK");

    const result =
      collector.finishPoint(1600);

    expect(result.rejectedSampleCount)
      .toBe(1);
    expect(result.samples[0]?.accepted)
      .toBe(false);
  });

  it("becomes ready after the stable window when enough samples were accepted", () => {
    const collector =
      new CalibrationCollector();

    collector.beginPoint(
      "calibration_test",
      target,
      1000
    );

    for (let index = 0; index < 10; index += 1) {
      collector.observe(
        createObservation(
          1450 + index * 50
        )
      );
    }

    const snapshot =
      collector.getSnapshot(2300);

    expect(snapshot.phase).toBe("READY");

    const result =
      collector.finishPoint(2300);

    expect(result.sufficient).toBe(true);
    expect(result.acceptedSampleCount)
      .toBe(10);
  });
});

it("can finish a stable calibration point when the baseline runs at 10 Hz", () => {
  const collector =
    new CalibrationCollector();

  collector.beginPoint(
    "calibration_low_rate",
    target,
    1000
  );

  for (let index = 0; index < 12; index += 1) {
    collector.observe(
      createObservation(
        1450 + index * 100
      )
    );
  }

  const result =
    collector.finishPoint(2600);

  expect(result.sufficient).toBe(true);
  expect(result.stability?.stable).toBe(true);
  expect(result.stability?.profile.effectiveSampleRateHz)
    .toBeCloseTo(10, 1);
});
