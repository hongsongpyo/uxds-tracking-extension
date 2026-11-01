import type { Point2D } from "../shared/types";

/**
 * Calibration repeats may have a new pointIndex but the same physical target.
 * Both visits must be excluded from a spatial holdout, or grouped CV leaks
 * target-specific labels into its training fold. This does NOT use independent
 * validation targets, only known calibration targets.
 */
export function sameCalibrationTarget(a: Point2D, b: Point2D): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y)
    && Number.isFinite(b.x) && Number.isFinite(b.y)
    && Math.abs(a.x - b.x) <= 1e-6
    && Math.abs(a.y - b.y) <= 1e-6;
}
