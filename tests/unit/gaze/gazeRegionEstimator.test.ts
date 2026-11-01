import {
  describe,
  expect,
  it
} from "vitest";

import {
  classifyGazeScreenRegion,
  estimateGazeScreenRegion
} from "../../../src/gaze/gazeRegionEstimator";

describe("gazeRegionEstimator", () => {
  it("classifies the nine coarse screen regions", () => {
    expect(classifyGazeScreenRegion({ x: 0.18, y: 0.18 }))
      .toBe("TOP_LEFT");
    expect(classifyGazeScreenRegion({ x: 0.50, y: 0.18 }))
      .toBe("TOP");
    expect(classifyGazeScreenRegion({ x: 0.82, y: 0.18 }))
      .toBe("TOP_RIGHT");
    expect(classifyGazeScreenRegion({ x: 0.18, y: 0.50 }))
      .toBe("LEFT");
    expect(classifyGazeScreenRegion({ x: 0.50, y: 0.50 }))
      .toBe("CENTER");
    expect(classifyGazeScreenRegion({ x: 0.82, y: 0.50 }))
      .toBe("RIGHT");
    expect(classifyGazeScreenRegion({ x: 0.18, y: 0.82 }))
      .toBe("BOTTOM_LEFT");
    expect(classifyGazeScreenRegion({ x: 0.50, y: 0.82 }))
      .toBe("BOTTOM");
    expect(classifyGazeScreenRegion({ x: 0.82, y: 0.82 }))
      .toBe("BOTTOM_RIGHT");
  });

  it("marks a region ambiguous when uncertainty overlaps a 1/3 boundary", () => {
    const estimate = estimateGazeScreenRegion(
      { x: 0.35, y: 0.5 },
      0.03
    );

    expect(estimate.region).toBe("CENTER");
    expect(estimate.ambiguous).toBe(true);
  });
});
