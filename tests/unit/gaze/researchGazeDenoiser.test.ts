import {
  describe,
  expect,
  it
} from "vitest";

import {
  ResearchGazeDenoiser
} from "../../../src/gaze/researchGazeDenoiser";

import type {
  ResearchGazeDenoiserResult
} from "../../../src/gaze/researchGazeDenoiser";

function feed(
  denoiser: ResearchGazeDenoiser,
  points: readonly number[]
): ResearchGazeDenoiserResult | null {
  let result: ResearchGazeDenoiserResult | null = null;

  points.forEach((x, index) => {
    result = denoiser.update({
      timestampMs: 100 + index * 33,
      correctedViewportPoint: {
        x,
        y: 100
      },
      gazeValid: true
    });
  });

  return result;
}

describe("ResearchGazeDenoiser", () => {
  it("repairs an isolated center spike while preserving the center timestamp", () => {
    const denoiser =
      new ResearchGazeDenoiser();

    const result = feed(
      denoiser,
      [100, 102, 240, 103, 101]
    );

    expect(result).not.toBeNull();
    expect(result?.spikeRepaired).toBe(true);
    expect(result?.denoisedViewportPoint.x)
      .toBeCloseTo(102.5);
    expect(result?.timestampMs)
      .toBe(166);
  });

  it("does not flatten a sustained saccade", () => {
    const denoiser =
      new ResearchGazeDenoiser();

    const result = feed(
      denoiser,
      [100, 120, 180, 240, 260]
    );

    expect(result?.spikeRepaired).toBe(false);
    expect(result?.denoisedViewportPoint.x)
      .toBe(180);
  });
});
