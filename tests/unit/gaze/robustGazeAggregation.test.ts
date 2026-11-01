import {
  describe,
  expect,
  it
} from "vitest";

import {
  aggregateRobustGazePoints
} from "../../../src/gaze/robustGazeAggregation";

const VIEWPORT = {
  width: 1_920,
  height: 1_080
} as const;

describe("aggregateRobustGazePoints", () => {
  it("keeps a compact gaze cluster without inventing outliers", () => {
    const result = aggregateRobustGazePoints(
      [
        { x: 0.498, y: 0.501 },
        { x: 0.500, y: 0.499 },
        { x: 0.502, y: 0.500 },
        { x: 0.501, y: 0.502 },
        { x: 0.499, y: 0.498 },
        { x: 0.500, y: 0.501 }
      ],
      VIEWPORT
    );

    expect(result.acceptedSampleCount).toBe(6);
    expect(result.spatialOutlierRejectedSampleCount).toBe(0);
    expect(Number.isFinite(result.robustPrecisionPx)).toBe(true);
  });

  it("rejects one clearly separated spatial outlier without using a target", () => {
    const result = aggregateRobustGazePoints(
      [
        { x: 0.498, y: 0.501 },
        { x: 0.500, y: 0.499 },
        { x: 0.502, y: 0.500 },
        { x: 0.501, y: 0.502 },
        { x: 0.499, y: 0.498 },
        { x: 0.90, y: 0.10 }
      ],
      VIEWPORT
    );

    expect(result.acceptedSampleCount).toBe(5);
    expect(result.spatialOutlierRejectedSampleCount).toBe(1);
    expect(result.robustPrecisionPx).toBeLessThan(result.rawPrecisionPx);
    expect(result.robustCenter.x).toBeCloseTo(0.5, 2);
    expect(result.robustCenter.y).toBeCloseTo(0.5, 2);
  });

  it("handles an almost-zero MAD without division or NaN problems", () => {
    const result = aggregateRobustGazePoints(
      [
        { x: 0.4, y: 0.6 },
        { x: 0.4, y: 0.6 },
        { x: 0.4, y: 0.6 },
        { x: 0.4, y: 0.6 },
        { x: 0.4, y: 0.6 }
      ],
      VIEWPORT
    );

    expect(result.madRadiusNormalized).toBe(0);
    expect(result.acceptedSampleCount).toBe(5);
    expect(result.robustPrecisionPx).toBe(0);
    expect(Number.isFinite(result.allowedRadiusNormalized)).toBe(true);
  });

  it("safely aggregates a single sample for low-sample fallback diagnostics", () => {
    const result = aggregateRobustGazePoints(
      [{ x: 0.25, y: 0.75 }],
      VIEWPORT
    );

    expect(result.acceptedSampleCount).toBe(1);
    expect(result.robustCenter).toEqual({ x: 0.25, y: 0.75 });
    expect(result.rawPrecisionPx).toBe(0);
    expect(result.robustPrecisionPx).toBe(0);
  });

  it("rejects non-finite data rather than propagating NaN or Infinity", () => {
    expect(() => aggregateRobustGazePoints(
      [
        { x: 0.5, y: 0.5 },
        { x: Number.NaN, y: 0.5 }
      ],
      VIEWPORT
    )).toThrow();

    expect(() => aggregateRobustGazePoints(
      [{ x: Number.POSITIVE_INFINITY, y: 0.5 }],
      VIEWPORT
    )).toThrow();
  });
});
