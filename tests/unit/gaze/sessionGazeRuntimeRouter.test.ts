import {
  describe,
  expect,
  it
} from "vitest";

import {
  selectSessionRuntimeGaze
} from "../../../src/gaze/sessionGazeRuntimeRouter";

import type {
  PersonalizedDeepRuntimeCandidate
} from "../../../src/gaze/sessionGazeRuntimeRouter";

import type {
  GazePrediction
} from "../../../src/shared/types";

function baselinePrediction(
  timestampMs: number = 1_000,
  x: number = 0.5,
  y: number = 0.5
): GazePrediction {
  return {
    timestampMs,
    rawPoint: {
      x,
      y
    },
    rawSpace: "NORMALIZED",
    confidence: 0.8,
    faceValid: true,
    eyesValid: true,
    headPose: {
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0
    },
    source: "WEB_EYE_TRACK"
  };
}

function deepCandidate(
  overrides: Partial<PersonalizedDeepRuntimeCandidate> = {}
): PersonalizedDeepRuntimeCandidate {
  return {
    sourceTimestampMs: 600,
    availableAtTimestampMs: 950,
    inferenceLatencyMs: 400,
    sourceBaselinePoint: {
      x: 0.4,
      y: 0.6
    },
    normalizedPoint: {
      x: 0.7,
      y: 0.2
    },
    confidence: 0.9,
    drift: {
      deltaHeadYawDeg: 0,
      deltaHeadPitchDeg: 0,
      deltaHeadRollDeg: 0,
      deltaFaceCenterX: 0,
      deltaFaceCenterY: 0,
      faceWidthScaleDelta: 0,
      faceHeightScaleDelta: 0,
      faceDistanceDelta: 0
    },
    ...overrides
  };
}

function deepOnlySelector(): never {
  return {
    getFitResult: () => ({
      sessionStrategy: {
        selectedStrategy: "DEEP_ONLY"
      }
    })
  } as never;
}

describe(
  "session gaze runtime routing",
  () => {
    it(
      "falls back to baseline before a session strategy is fitted",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            deepCandidate(),
            null,
            {
              validationReady: true
            }
          );

        expect(selected.strategy)
          .toBe("BASELINE_FALLBACK");
        expect(selected.fallbackReason)
          .toBe("STRATEGY_NOT_READY");
        expect(selected.normalizedPoint)
          .toEqual({ x: 0.5, y: 0.5 });
        expect(selected.deepWeight)
          .toBe(0);
      }
    );

    it(
      "does not promote a calibration-selected strategy before independent validation passes",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            deepCandidate(),
            deepOnlySelector(),
            {
              validationReady: false
            }
          );

        expect(selected.strategy)
          .toBe("BASELINE_FALLBACK");
        expect(selected.fallbackReason)
          .toBe("VALIDATION_NOT_READY");
        expect(selected.validationReady)
          .toBe(false);
      }
    );

    it(
      "allows an explicitly degraded POOR-validation collection without pretending validation passed",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            deepCandidate(),
            deepOnlySelector(),
            {
              validationReady: false,
              allowDegradedCollection: true
            }
          );

        expect(selected.strategy)
          .toBe("DEEP_ONLY");
        expect(selected.validationReady)
          .toBe(false);
        expect(selected.collectionAllowed)
          .toBe(true);
        expect(selected.degradedCollection)
          .toBe(true);
        expect(selected.fallbackReason)
          .toBeNull();
      }
    );

    it(
      "demotes an independently unsafe Deep strategy to the validated Baseline",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            deepCandidate(),
            deepOnlySelector(),
            {
              validationReady: true,
              forceBaselineStrategy: true
            }
          );

        expect(selected.strategy)
          .toBe("BASELINE_ONLY");
        expect(selected.configuredStrategy)
          .toBe("DEEP_ONLY");
        expect(selected.deepWeight)
          .toBe(0);
        expect(selected.collectionAllowed)
          .toBe(true);
        expect(selected.fallbackReason)
          .toBe("BASELINE_SAFETY_OVERRIDE");
      }
    );

    it(
      "allows a validated Baseline safety override even when no hybrid selector could be fitted",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            null,
            null,
            {
              validationReady: true,
              forceBaselineStrategy: true
            }
          );

        expect(selected.strategy)
          .toBe("BASELINE_ONLY");
        expect(selected.configuredStrategy)
          .toBeNull();
        expect(selected.collectionAllowed)
          .toBe(true);
        expect(selected.fallbackReason)
          .toBe("BASELINE_SAFETY_OVERRIDE");
      }
    );

    it(
      "accepts a newly available deep result even when its source frame is older than the visual hold budget",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            deepCandidate(),
            deepOnlySelector(),
            {
              validationReady: true
            }
          );

        expect(selected.strategy)
          .toBe("DEEP_ONLY");
        expect(selected.deepCandidateSourceAgeMs)
          .toBe(400);
        expect(selected.deepCandidateAvailabilityAgeMs)
          .toBe(50);
        expect(selected.deepCandidateFreshnessBudgetMs)
          .toBe(400);
        expect(selected.deepTemporalAlignmentApplied)
          .toBe(true);

        /*
         * source residual = Deep(0.7, 0.2) - Baseline(0.4, 0.6)
         *                 = (+0.3, -0.4)
         * current baseline = (0.5, 0.5)
         * aligned Deep     = (0.8, 0.1)
         */
        expect(selected.normalizedPoint.x)
          .toBeCloseTo(0.8, 12);
        expect(selected.normalizedPoint.y)
          .toBeCloseTo(0.1, 12);
      }
    );

    it(
      "rejects a deep result that has been sitting unused longer than its measured cadence budget",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(),
            deepCandidate({
              sourceTimestampMs: 600,
              availableAtTimestampMs: 500,
              inferenceLatencyMs: 400
            }),
            deepOnlySelector(),
            {
              validationReady: true
            }
          );

        expect(selected.strategy)
          .toBe("BASELINE_FALLBACK");
        expect(selected.fallbackReason)
          .toBe("DEEP_STALE");
        expect(selected.deepCandidateAvailabilityAgeMs)
          .toBe(500);
        expect(selected.deepCandidateFreshnessBudgetMs)
          .toBe(400);
      }
    );

    it(
      "rejects temporal alignment when the deep source frame is beyond the established maximum deep dwell",
      () => {
        const selected =
          selectSessionRuntimeGaze(
            baselinePrediction(
              4_000,
              0.5,
              0.5
            ),
            deepCandidate({
              sourceTimestampMs: 1_000,
              availableAtTimestampMs: 3_950,
              inferenceLatencyMs: 500
            }),
            deepOnlySelector(),
            {
              validationReady: true
            }
          );

        expect(selected.strategy)
          .toBe("BASELINE_FALLBACK");
        expect(selected.fallbackReason)
          .toBe("DEEP_SOURCE_TOO_OLD");
        expect(selected.deepCandidateSourceAgeMs)
          .toBe(3_000);
      }
    );
  }
);

describe("runtime safety gate precedence", () => {
  it("suspends the validated baseline safety override when drift requests a pause", () => {
    const selected = selectSessionRuntimeGaze(baselinePrediction(), null, null, {
      validationReady: true,
      forceBaselineStrategy: true,
      forceBaselineForDrift: true,
      suspendCollectionForDrift: true
    });
    expect(selected.collectionAllowed).toBe(false);
    expect(selected.fallbackReason).toBe("DRIFT_RECALIBRATION_REQUIRED");
  });

  it("suspends even when the deep candidate is missing", () => {
    const selected = selectSessionRuntimeGaze(baselinePrediction(), null, deepOnlySelector(), {
      validationReady: true,
      forceBaselineForDrift: true,
      suspendCollectionForDrift: true
    });
    expect(selected.collectionAllowed).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects nonfinite deep source time %s", (timestamp) => {
    const selected = selectSessionRuntimeGaze(
      baselinePrediction(), deepCandidate({ sourceTimestampMs: timestamp }), deepOnlySelector(),
      { validationReady: true }
    );
    expect(selected.usedFreshDeepCandidate).toBe(false);
    expect(selected.normalizedPoint).toEqual({ x: 0.5, y: 0.5 });
  });
});
