import {
  describe,
  expect,
  it
} from "vitest";

import {
  AuthoritativeGazeStabilizer
} from "../../../src/gaze/authoritativeGazeStabilizer";

const VIEWPORT = {
  width: 1_000,
  height: 800
};

describe("AuthoritativeGazeStabilizer", () => {
  it("preserves raw authoritative gaze while producing a separately stabilized stream", () => {
    const stabilizer =
      new AuthoritativeGazeStabilizer();

    const first = stabilizer.update({
      timestampMs: 1_000,
      normalizedPoint: { x: 0.5, y: 0.5 },
      viewport: VIEWPORT,
      gazeValid: true
    });

    const second = stabilizer.update({
      timestampMs: 1_033,
      normalizedPoint: { x: 0.54, y: 0.5 },
      viewport: VIEWPORT,
      gazeValid: true
    });

    expect(second.rawNormalizedPoint).toEqual({
      x: 0.54,
      y: 0.5
    });
    expect(second.stabilizedNormalizedPoint).not.toBeNull();
    expect(
      second.stabilizedNormalizedPoint?.x
    ).toBeGreaterThan(first.rawNormalizedPoint.x);
    expect(
      second.stabilizedNormalizedPoint?.x
    ).toBeLessThan(second.rawNormalizedPoint.x);
    expect(second.currentSampleValid).toBe(true);
  });

  it("reduces alternating low-amplitude jitter without replacing raw samples", () => {
    const stabilizer =
      new AuthoritativeGazeStabilizer();

    const rawXs = [
      0.5,
      0.51,
      0.49,
      0.51,
      0.49,
      0.51,
      0.49
    ];

    const outputs = rawXs.map(
      (x, index) => stabilizer.update({
        timestampMs: 2_000 + index * 33,
        normalizedPoint: { x, y: 0.5 },
        viewport: VIEWPORT,
        gazeValid: true
      })
    );

    const rawTail = rawXs.slice(1);
    const stabilizedTail = outputs
      .slice(1)
      .map((output) =>
        output.stabilizedNormalizedPoint?.x
        ?? Number.NaN
      );

    const rawMeanDeviation =
      rawTail.reduce(
        (sum, x) => sum + Math.abs(x - 0.5),
        0
      ) / rawTail.length;

    const stabilizedMeanDeviation =
      stabilizedTail.reduce(
        (sum, x) => sum + Math.abs(x - 0.5),
        0
      ) / stabilizedTail.length;

    expect(stabilizedMeanDeviation)
      .toBeLessThan(rawMeanDeviation);
  });

  it("marks a short visual hold invalid and hides it after the established hold window", () => {
    const stabilizer =
      new AuthoritativeGazeStabilizer();

    stabilizer.update({
      timestampMs: 3_000,
      normalizedPoint: { x: 0.4, y: 0.4 },
      viewport: VIEWPORT,
      gazeValid: true
    });

    const held = stabilizer.update({
      timestampMs: 3_100,
      normalizedPoint: { x: 0.8, y: 0.8 },
      viewport: VIEWPORT,
      gazeValid: false
    });

    expect(held.mode).toBe("HELD");
    expect(held.currentSampleValid).toBe(false);

    const hidden = stabilizer.update({
      timestampMs: 3_250,
      normalizedPoint: { x: 0.8, y: 0.8 },
      viewport: VIEWPORT,
      gazeValid: false
    });

    expect(hidden.mode).toBe("HIDDEN");
    expect(hidden.stabilizedNormalizedPoint).toBeNull();
    expect(hidden.currentSampleValid).toBe(false);
  });

  it("refuses to synthesize stabilized gaze without viewport metadata", () => {
    const stabilizer =
      new AuthoritativeGazeStabilizer();

    const result = stabilizer.update({
      timestampMs: 4_000,
      normalizedPoint: { x: 0.5, y: 0.5 },
      viewport: null,
      gazeValid: true
    });

    expect(result.mode).toBe("UNAVAILABLE");
    expect(result.stabilizedNormalizedPoint).toBeNull();
    expect(result.currentSampleValid).toBe(false);
  });

  it("reports raw and stabilized pixel velocities for valid consecutive samples", () => {
    const stabilizer =
      new AuthoritativeGazeStabilizer();

    stabilizer.update({
      timestampMs: 5_000,
      normalizedPoint: { x: 0.2, y: 0.5 },
      viewport: VIEWPORT,
      gazeValid: true
    });

    const result = stabilizer.update({
      timestampMs: 5_100,
      normalizedPoint: { x: 0.3, y: 0.5 },
      viewport: VIEWPORT,
      gazeValid: true
    });

    expect(result.deltaTimeMs).toBe(100);
    expect(result.rawSpeedPxPerSecond).toBeCloseTo(1_000, 6);
    expect(result.stabilizedSpeedPxPerSecond).not.toBeNull();
    expect(result.stabilizedSpeedPxPerSecond ?? 0)
      .toBeLessThan(result.rawSpeedPxPerSecond ?? 0);
  });
});

describe("reacquisition after a camera gap", () => {
  it("does not hold the old fixation or reject the first new position after missing frames", () => {
    const stabilizer = new AuthoritativeGazeStabilizer();
    stabilizer.update({ timestampMs: 1000, normalizedPoint: { x: 0.1, y: 0.1 },
      viewport: VIEWPORT, gazeValid: true });
    const resumed = stabilizer.update({ timestampMs: 11000, normalizedPoint: { x: 0.9, y: 0.9 },
      viewport: VIEWPORT, gazeValid: true });
    expect(resumed.currentSampleValid).toBe(true);
    expect(resumed.stabilizedNormalizedPoint).toEqual({ x: 0.9, y: 0.9 });
    expect(resumed.rawSpeedPxPerSecond).toBeNull();
  });
});
