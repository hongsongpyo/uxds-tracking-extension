import {
  describe,
  expect,
  it
} from "vitest";

import {
  CALIBRATION
} from "../../../src/shared/constants";

import {
  createCalibrationExpansionCandidates,
  createCalibrationPattern,
  createCalibrationValidationPattern
} from "../../../src/calibration/calibrationPattern";

describe("calibrationPattern", () => {
  const viewport = {
    width: 1000,
    height: 800
  };

  it("creates 17-point and 25-point calibration patterns", () => {
    const standard =
      createCalibrationPattern(
        "STANDARD_17",
        viewport
      );

    const precision =
      createCalibrationPattern(
        "PRECISION_25",
        viewport
      );

    expect(standard).toHaveLength(17);
    expect(precision).toHaveLength(25);
    expect(standard[0]?.normalizedPoint)
      .toEqual({ x: 0.5, y: 0.5 });
    expect(precision[0]?.normalizedPoint)
      .toEqual({ x: 0.5, y: 0.5 });
  });

  it("keeps targets inside the configured edge margin and maps to viewport pixels", () => {
    const targets =
      createCalibrationPattern(
        "PRECISION_25",
        viewport
      );

    for (const target of targets) {
      expect(target.normalizedPoint.x)
        .toBeGreaterThanOrEqual(
          CALIBRATION.TARGET_MARGIN_RATIO
        );
      expect(target.normalizedPoint.x)
        .toBeLessThanOrEqual(
          1 - CALIBRATION.TARGET_MARGIN_RATIO
        );
      expect(target.normalizedPoint.y)
        .toBeGreaterThanOrEqual(
          CALIBRATION.TARGET_MARGIN_RATIO
        );
      expect(target.normalizedPoint.y)
        .toBeLessThanOrEqual(
          1 - CALIBRATION.TARGET_MARGIN_RATIO
        );
      expect(target.viewportPoint.x)
        .toBeCloseTo(
          target.normalizedPoint.x
          * viewport.width
        );
      expect(target.viewportPoint.y)
        .toBeCloseTo(
          target.normalizedPoint.y
          * viewport.height
        );
    }
  });


  it("exposes exactly the eight PRECISION_25-only lattice candidates", () => {
    const standard =
      createCalibrationPattern(
        "STANDARD_17",
        viewport
      );

    const precision =
      createCalibrationPattern(
        "PRECISION_25",
        viewport
      );

    const expansion =
      createCalibrationExpansionCandidates(
        viewport
      );

    expect(expansion).toHaveLength(8);
    expect(expansion.map((target) => target.pointIndex))
      .toEqual([17, 18, 19, 20, 21, 22, 23, 24]);

    const standardKeys = new Set(
      standard.map(
        (target) =>
          `${target.normalizedPoint.x}:${target.normalizedPoint.y}`
      )
    );

    for (const target of expansion) {
      expect(
        standardKeys.has(
          `${target.normalizedPoint.x}:${target.normalizedPoint.y}`
        )
      ).toBe(false);
    }

    expect([
      ...standard.map((target) => target.normalizedPoint),
      ...expansion.map((target) => target.normalizedPoint)
    ]).toHaveLength(precision.length);
  });

  it("creates an independent 3x3 validation pattern", () => {
    const targets =
      createCalibrationValidationPattern(
        viewport
      );

    expect(targets).toHaveLength(9);
    expect(targets[0]?.normalizedPoint)
      .toEqual({ x: 0.5, y: 0.5 });

    const unique =
      new Set(
        targets.map(
          (target) =>
            `${target.normalizedPoint.x}:${target.normalizedPoint.y}`
        )
      );

    expect(unique.size).toBe(9);
  });
});
