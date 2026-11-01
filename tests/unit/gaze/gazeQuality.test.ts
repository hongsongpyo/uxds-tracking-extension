import {
  describe,
  expect,
  it
} from "vitest";

import {
  evaluateGazeQuality
} from "../../../src/gaze/gazeQuality";

import {
  validateGazePrediction
} from "../../../src/gaze/gazeValidator";

import type {
  FaceQualityFrameResult
} from "../../../src/face/faceQuality";

import type {
  GazePrediction
} from "../../../src/shared/types";

function createPrediction(
  overrides: Partial<GazePrediction> = {}
): GazePrediction {
  return {
    timestampMs: 100,
    rawPoint: {
      x: 0.5,
      y: 0.5
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
    source: "WEB_EYE_TRACK",
    ...overrides
  };
}

function createFaceQuality(
  overrides: Partial<FaceQualityFrameResult> = {}
): FaceQualityFrameResult {
  return {
    frameSequence: 1,
    timestampMs: 100,
    trackingQuality: {
      faceValid: true,
      eyesValid: true,
      leftEyeVisible: true,
      rightEyeVisible: true,
      blink: false,
      faceConfidence: 0.9,
      eyeConfidence: 0.9,
      faceDistanceRatio: 1,
      headPose: {
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0
      },
      qualityScore: 0.9,
      qualityLevel: "GOOD"
    },
    positionStatus: {
      faceDetected: true,
      bothEyesVisible: true,
      horizontallyCentered: true,
      verticallyCentered: true,
      distanceAcceptable: true,
      headPoseAcceptable: true,
      brightnessAcceptable: true,
      stable: true
    },
    usableForGaze: true,
    issues: [],
    ...overrides
  };
}

describe("evaluateGazeQuality", () => {
  it("returns GOOD for a strong valid prediction and face frame", () => {
    const prediction = createPrediction();
    const validation = validateGazePrediction(
      prediction,
      {
        expectedTimestampMs: 100
      }
    );

    const result = evaluateGazeQuality({
      prediction,
      validation,
      faceQuality: createFaceQuality()
    });

    expect(result.valid).toBe(true);
    expect(result.level).toBe("GOOD");
    expect(result.score).toBeCloseTo(0.9);
  });

  it("cannot upgrade an invalid gaze validation with a high numeric quality score", () => {
    const prediction = createPrediction({
      rawPoint: {
        x: Number.NaN,
        y: 0.5
      }
    });

    const validation = validateGazePrediction(
      prediction
    );

    const result = evaluateGazeQuality({
      prediction,
      validation,
      faceQuality: createFaceQuality()
    });

    expect(result.valid).toBe(false);
    expect(result.level).toBe("INVALID");
    expect(
      result.issues.some(
        (issue) => issue.code === "VALIDATION_INVALID"
      )
    ).toBe(true);
  });

  it("forces INVALID while a blink is in progress", () => {
    const prediction = createPrediction();
    const validation = validateGazePrediction(
      prediction
    );

    const faceQuality = createFaceQuality({
      trackingQuality: {
        ...createFaceQuality()
          .trackingQuality,
        blink: true
      }
    });

    const result = evaluateGazeQuality({
      prediction,
      validation,
      faceQuality
    });

    expect(result.valid).toBe(false);
    expect(result.level).toBe("INVALID");
    expect(
      result.issues.some(
        (issue) => issue.code === "BLINK_IN_PROGRESS"
      )
    ).toBe(true);
  });

  it("forces INVALID when prediction and face timestamps do not match", () => {
    const prediction = createPrediction();
    const validation = validateGazePrediction(
      prediction
    );

    const result = evaluateGazeQuality({
      prediction,
      validation,
      faceQuality: createFaceQuality({
        timestampMs: 110
      })
    });

    expect(result.valid).toBe(false);
    expect(result.level).toBe("INVALID");
  });

  it("forces INVALID when the face pipeline is unusable", () => {
    const prediction = createPrediction();
    const validation = validateGazePrediction(
      prediction
    );

    const result = evaluateGazeQuality({
      prediction,
      validation,
      faceQuality: createFaceQuality({
        usableForGaze: false
      })
    });

    expect(result.valid).toBe(false);
    expect(result.level).toBe("INVALID");
  });
});
