import {
  describe,
  expect,
  it
} from "vitest";

import {
  FixationDetector
} from "../../../src/gaze/fixationDetector";

function stableInput(
  timestampMs: number,
  x: number,
  y: number,
  strategy: "SAFE_ADAPTIVE_HYBRID" | "BASELINE_FALLBACK" =
    "SAFE_ADAPTIVE_HYBRID"
) {
  return {
    timestampMs,
    stabilizedViewportPoint: { x, y },
    currentSampleValid: true,
    stabilizedSpeedPxPerSecond: null,
    qualityScore: 0.9,
    authoritativeStrategy: strategy
  } as const;
}

describe("FixationDetector", () => {
  it("promotes a stable candidate after the existing duration and sample thresholds", () => {
    const detector = new FixationDetector();

    detector.update(stableInput(1_000, 500, 400));
    detector.update(stableInput(1_033, 502, 401));
    detector.update(stableInput(1_066, 499, 399));
    detector.update(stableInput(1_099, 501, 400));

    const result = detector.update(
      stableInput(1_132, 500, 401)
    );

    expect(result.state).toBe("FIXATING");
    expect(result.activeFixation).not.toBeNull();
    expect(result.activeFixation?.durationMs).toBe(132);
    expect(result.activeFixation?.sampleCount).toBe(5);
    expect(result.activeFixation?.dispersionPx ?? 999)
      .toBeLessThan(80);
  });

  it("closes a confirmed fixation when a high-velocity movement starts", () => {
    const detector = new FixationDetector();

    detector.update(stableInput(2_000, 400, 300));
    detector.update(stableInput(2_033, 402, 301));
    detector.update(stableInput(2_066, 401, 299));
    detector.update(stableInput(2_099, 403, 300));
    detector.update(stableInput(2_132, 402, 302));

    const result = detector.update({
      ...stableInput(2_165, 800, 600),
      stabilizedSpeedPxPerSecond: 2_000
    });

    expect(result.completedFixation).not.toBeNull();
    expect(result.completedFixation?.durationMs).toBe(132);
    expect(result.state).toBe("CANDIDATE");
    expect(result.candidateSampleCount).toBe(1);
  });

  it("preserves a fixation across a short invalid gap but closes it after MAX_SAMPLE_GAP_MS", () => {
    const detector = new FixationDetector();

    detector.update(stableInput(3_000, 300, 250));
    detector.update(stableInput(3_033, 301, 250));
    detector.update(stableInput(3_066, 300, 251));
    detector.update(stableInput(3_099, 299, 250));
    detector.update(stableInput(3_132, 300, 250));

    const held = detector.update({
      timestampMs: 3_180,
      stabilizedViewportPoint: null,
      currentSampleValid: false,
      stabilizedSpeedPxPerSecond: null,
      qualityScore: 0,
      authoritativeStrategy: "SAFE_ADAPTIVE_HYBRID"
    });

    expect(held.state).toBe("GAP_HOLD");
    expect(held.completedFixation).toBeNull();
    expect(held.activeFixation).not.toBeNull();

    const closed = detector.update({
      timestampMs: 3_250,
      stabilizedViewportPoint: null,
      currentSampleValid: false,
      stabilizedSpeedPxPerSecond: null,
      qualityScore: 0,
      authoritativeStrategy: "SAFE_ADAPTIVE_HYBRID"
    });

    expect(closed.state).toBe("IDLE");
    expect(closed.completedFixation).not.toBeNull();
  });

  it("quarantines the exact strategy-switch frame without destroying a stable fixation", () => {
    const detector = new FixationDetector();

    detector.update(stableInput(4_000, 600, 350));
    detector.update(stableInput(4_033, 601, 350));
    detector.update(stableInput(4_066, 600, 351));
    detector.update(stableInput(4_099, 599, 350));
    const beforeSwitch = detector.update(
      stableInput(4_132, 600, 350)
    );

    const sampleCountBefore =
      beforeSwitch.activeFixation?.sampleCount ?? 0;

    const guarded = detector.update(
      stableInput(
        4_165,
        660,
        410,
        "BASELINE_FALLBACK"
      )
    );

    expect(guarded.state).toBe("TRANSITION_GUARD");
    expect(guarded.strategyTransitionGuardApplied).toBe(true);
    expect(guarded.activeFixation?.sampleCount)
      .toBe(sampleCountBefore);

    const resumed = detector.update(
      stableInput(
        4_198,
        601,
        350,
        "BASELINE_FALLBACK"
      )
    );

    expect(resumed.state).toBe("FIXATING");
    expect(resumed.activeFixation).not.toBeNull();
  });

  it("derives the velocity ceiling from existing fixation constants", () => {
    const detector = new FixationDetector();

    const result = detector.update(
      stableInput(5_000, 200, 200)
    );

    expect(result.velocityThresholdPxPerSecond)
      .toBe(800);
  });
});
