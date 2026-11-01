import {
  describe,
  expect,
  it
} from "vitest";

import {
  GazeFilter
} from "../../../src/gaze/gazeFilter";

describe("GazeFilter", () => {
  it("applies adaptive One-Euro smoothing without snapping to the new point", () => {
    const filter = new GazeFilter();

    const first = filter.update({
      timestampMs: 100,
      correctedViewportPoint: {
        x: 100,
        y: 100
      },
      gazeValid: true
    });

    const second = filter.update({
      timestampMs: 140,
      correctedViewportPoint: {
        x: 200,
        y: 50
      },
      gazeValid: true
    });

    expect(first.mode).toBe("FILTERED");
    expect(second.filteredViewportPoint?.x)
      .toBeGreaterThan(100);
    expect(second.filteredViewportPoint?.x)
      .toBeLessThan(200);
    expect(second.filteredViewportPoint?.y)
      .toBeGreaterThan(50);
    expect(second.filteredViewportPoint?.y)
      .toBeLessThan(100);
  });

  it("can strengthen low-speed smoothing without modifying raw input semantics", () => {
    const normal = new GazeFilter();
    const boosted = new GazeFilter();

    normal.update({
      timestampMs: 100,
      correctedViewportPoint: { x: 100, y: 100 },
      gazeValid: true
    });
    boosted.update({
      timestampMs: 100,
      correctedViewportPoint: { x: 100, y: 100 },
      gazeValid: true,
      smoothingMultiplier: 2
    });

    const normalResult = normal.update({
      timestampMs: 140,
      correctedViewportPoint: { x: 110, y: 100 },
      gazeValid: true
    });
    const boostedResult = boosted.update({
      timestampMs: 140,
      correctedViewportPoint: { x: 110, y: 100 },
      gazeValid: true,
      smoothingMultiplier: 2
    });

    expect(boostedResult.filteredViewportPoint?.x ?? 110)
      .toBeLessThan(normalResult.filteredViewportPoint?.x ?? 100);
  });

  it("holds the last visual point for a short invalid interval without marking the sample valid", () => {
    const filter = new GazeFilter();

    filter.update({
      timestampMs: 100,
      correctedViewportPoint: {
        x: 10,
        y: 20
      },
      gazeValid: true
    });

    const held = filter.update({
      timestampMs: 200,
      correctedViewportPoint: null,
      gazeValid: false
    });

    expect(held.mode).toBe("HELD");
    expect(held.currentSampleValid).toBe(false);
    expect(held.visualAgeMs).toBe(100);
    expect(held.filteredViewportPoint).toEqual({
      x: 10,
      y: 20
    });
  });

  it("hides the visual point after the 180 ms hold window", () => {
    const filter = new GazeFilter();

    filter.update({
      timestampMs: 100,
      correctedViewportPoint: {
        x: 10,
        y: 20
      },
      gazeValid: true
    });

    const hidden = filter.update({
      timestampMs: 281,
      correctedViewportPoint: null,
      gazeValid: false
    });

    expect(hidden.mode).toBe("HIDDEN");
    expect(hidden.filteredViewportPoint)
      .toBeNull();
  });

  it("resumes filtering from a new valid point after hidden state", () => {
    const filter = new GazeFilter();

    filter.update({
      timestampMs: 100,
      correctedViewportPoint: {
        x: 10,
        y: 20
      },
      gazeValid: true
    });

    filter.update({
      timestampMs: 281,
      correctedViewportPoint: null,
      gazeValid: false
    });

    const resumed = filter.update({
      timestampMs: 300,
      correctedViewportPoint: {
        x: 500,
        y: 400
      },
      gazeValid: true
    });

    expect(resumed.mode).toBe("FILTERED");
    expect(resumed.filteredViewportPoint).toEqual({
      x: 500,
      y: 400
    });
  });

  it("resets temporal smoothing when timestamps regress", () => {
    const filter = new GazeFilter();

    filter.update({
      timestampMs: 200,
      correctedViewportPoint: {
        x: 100,
        y: 100
      },
      gazeValid: true
    });

    const regressed = filter.update({
      timestampMs: 150,
      correctedViewportPoint: {
        x: 300,
        y: 300
      },
      gazeValid: true
    });

    expect(regressed.filteredViewportPoint).toEqual({
      x: 300,
      y: 300
    });
  });
});
