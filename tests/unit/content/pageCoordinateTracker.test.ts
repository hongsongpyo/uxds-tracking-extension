import {
  describe,
  expect,
  it
} from "vitest";

import {
  classifyScrollDirection,
  remapNormalizedPointToViewport
} from "../../../src/content/pageCoordinateTracker";

describe("PageCoordinateTracker pure helpers", () => {
  it("classifies dominant vertical scrolling", () => {
    expect(classifyScrollDirection(2, 12)).toBe("DOWN");
    expect(classifyScrollDirection(-2, -12)).toBe("UP");
  });

  it("classifies dominant horizontal scrolling", () => {
    expect(classifyScrollDirection(20, 3)).toBe("RIGHT");
    expect(classifyScrollDirection(-20, 3)).toBe("LEFT");
  });

  it("returns NONE when there is no movement", () => {
    expect(classifyScrollDirection(0, 0)).toBe("NONE");
  });
  it("remaps normalized gaze into the current CSS viewport after zoom changes", () => {
    expect(
      remapNormalizedPointToViewport(
        { x: 0.8, y: 0.5 },
        1512,
        857
      )
    ).toEqual({
      x: 1209.6000000000001,
      y: 428.5
    });
  });

});
