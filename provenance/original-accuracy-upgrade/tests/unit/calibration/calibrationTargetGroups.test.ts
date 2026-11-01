import { describe, expect, it } from "vitest";
import { sameCalibrationTarget } from "../../../src/calibration/calibrationTargetGroups";

describe("spatial training target grouping", () => {
  it("treats repeated known calibration positions as one holdout, regardless of visit index", () => {
    expect(sameCalibrationTarget({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBe(true);
    expect(sameCalibrationTarget({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 })).toBe(false);
    expect(sameCalibrationTarget({ x: NaN, y: 0.5 }, { x: NaN, y: 0.5 })).toBe(false);
  });
});
