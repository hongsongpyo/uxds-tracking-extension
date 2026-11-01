import {
  describe,
  expect,
  it
} from "vitest";

import {
  validateGazePrediction
} from "../../../src/gaze/gazeValidator";

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

describe("validateGazePrediction", () => {
  it("accepts a finite synchronized normalized prediction", () => {
    const result = validateGazePrediction(
      createPrediction(),
      {
        expectedTimestampMs: 100
      }
    );

    expect(result.valid).toBe(true);
    expect(result.insideNormalizedViewport)
      .toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects non-finite gaze coordinates", () => {
    const result = validateGazePrediction(
      createPrediction({
        rawPoint: {
          x: Number.NaN,
          y: 0.5
        }
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "RAW_POINT_NON_FINITE"
          && issue.fatal
      )
    ).toBe(true);
  });

  it("rejects low confidence", () => {
    const result = validateGazePrediction(
      createPrediction({
        confidence: 0.2
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "CONFIDENCE_TOO_LOW"
      )
    ).toBe(true);
  });

  it("keeps a small normalized overshoot as a non-fatal diagnostic", () => {
    const prediction = createPrediction({
      rawPoint: {
        x: 1.1,
        y: 0.5
      }
    });

    const result = validateGazePrediction(
      prediction
    );

    expect(result.valid).toBe(true);
    expect(result.insideNormalizedViewport)
      .toBe(false);
    expect(prediction.rawPoint.x).toBe(1.1);
    expect(
      result.issues.some(
        (issue) =>
          issue.code
            === "NORMALIZED_OUTSIDE_VIEWPORT"
          && !issue.fatal
      )
    ).toBe(true);
  });

  it("rejects an implausibly distant normalized point", () => {
    const result = validateGazePrediction(
      createPrediction({
        rawPoint: {
          x: 2,
          y: 0.5
        }
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "NORMALIZED_IMPLAUSIBLE"
          && issue.fatal
      )
    ).toBe(true);
  });

  it("rejects face or eye invalidity", () => {
    const faceResult = validateGazePrediction(
      createPrediction({
        faceValid: false
      })
    );

    const eyeResult = validateGazePrediction(
      createPrediction({
        eyesValid: false
      })
    );

    expect(faceResult.valid).toBe(false);
    expect(eyeResult.valid).toBe(false);
  });

  it("rejects a mismatched capture timestamp", () => {
    const result = validateGazePrediction(
      createPrediction(),
      {
        expectedTimestampMs: 105
      }
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.code === "TIMESTAMP_MISMATCH"
      )
    ).toBe(true);
  });
});
