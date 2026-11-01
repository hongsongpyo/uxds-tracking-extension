import {
  CALIBRATION
} from "../shared/constants";

import type {
  Point2D,
  Size2D
} from "../shared/types";

export interface RobustGazeAggregationResult {
  readonly rawSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly spatialOutlierRejectedSampleCount: number;
  readonly rawCenter: Point2D;
  readonly robustCenter: Point2D;
  readonly rawPrecisionPx: number;
  readonly robustPrecisionPx: number;
  readonly rawDispersionRmsNormalized: number;
  readonly robustDispersionRmsNormalized: number;
  readonly medianCenter: Point2D;
  readonly medianRadiusNormalized: number;
  readonly madRadiusNormalized: number;
  readonly allowedRadiusNormalized: number;
  readonly acceptedIndices: readonly number[];
}

function assertFinitePoint(
  point: Point2D
): void {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
  ) {
    throw new RangeError(
      "Robust gaze aggregation requires finite points."
    );
  }
}

function assertViewport(
  viewport: Size2D
): void {
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
  ) {
    throw new RangeError(
      "Robust gaze aggregation requires a positive finite viewport."
    );
  }
}

function mean(
  values: readonly number[]
): number {
  if (values.length === 0) {
    throw new RangeError(
      "mean() requires at least one value."
    );
  }

  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}

function percentile(
  values: readonly number[],
  probability: number
): number {
  if (
    values.length === 0
    || probability < 0
    || probability > 1
  ) {
    throw new RangeError(
      "percentile() received invalid input."
    );
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new RangeError(
      "percentile() could not resolve a value."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function median(
  values: readonly number[]
): number {
  return percentile(values, 0.5);
}

function meanPoint(
  points: readonly Point2D[]
): Point2D {
  return {
    x: mean(points.map((point) => point.x)),
    y: mean(points.map((point) => point.y))
  };
}

function medianPoint(
  points: readonly Point2D[]
): Point2D {
  return {
    x: median(points.map((point) => point.x)),
    y: median(points.map((point) => point.y))
  };
}

function normalizedDistance(
  first: Point2D,
  second: Point2D
): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y
  );
}

function viewportDistance(
  first: Point2D,
  second: Point2D,
  viewport: Size2D
): number {
  return Math.hypot(
    (first.x - second.x) * viewport.width,
    (first.y - second.y) * viewport.height
  );
}

function meanPrecisionPx(
  points: readonly Point2D[],
  center: Point2D,
  viewport: Size2D
): number {
  return mean(
    points.map(
      (point) => viewportDistance(point, center, viewport)
    )
  );
}

function dispersionRmsNormalized(
  points: readonly Point2D[],
  center: Point2D
): number {
  return Math.sqrt(
    mean(
      points.map((point) => {
        const distance = normalizedDistance(point, center);
        return distance * distance;
      })
    )
  );
}

/**
 * Target-free robust aggregation for one fixation target window.
 *
 * The validation target is intentionally not accepted as an argument. The
 * inlier decision depends only on the predictions themselves: coordinate-wise
 * median -> radial distances -> radial MAD -> retained-inlier arithmetic mean.
 * This mirrors the established calibration cleaner without allowing an
 * independent-validation label to influence filtering.
 */
export function aggregateRobustGazePoints(
  points: readonly Point2D[],
  viewport: Size2D
): RobustGazeAggregationResult {
  assertViewport(viewport);

  if (points.length === 0) {
    throw new RangeError(
      "Robust gaze aggregation requires at least one point."
    );
  }

  for (const point of points) {
    assertFinitePoint(point);
  }

  const rawCenter = meanPoint(points);
  const medianCenter = medianPoint(points);
  const radialDistances = points.map(
    (point) => normalizedDistance(point, medianCenter)
  );
  const medianRadiusNormalized = median(radialDistances);
  const absoluteDeviations = radialDistances.map(
    (radius) => Math.abs(radius - medianRadiusNormalized)
  );
  const madRadiusNormalized = median(absoluteDeviations);
  const robustSigma = 1.4826 * madRadiusNormalized;
  const allowedRadiusNormalized =
    medianRadiusNormalized
    + Math.max(
      CALIBRATION.OUTLIER_MIN_RADIUS_NORMALIZED,
      CALIBRATION.OUTLIER_MAD_SCALE * robustSigma
    );

  const acceptedIndices: number[] = [];
  const acceptedPoints: Point2D[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const radius = radialDistances[index];

    if (
      point !== undefined
      && radius !== undefined
      && radius <= allowedRadiusNormalized
    ) {
      acceptedIndices.push(index);
      acceptedPoints.push(point);
    }
  }

  /*
   * The MAD guard above always retains the median cluster in normal finite
   * input. Keep a defensive fallback so downstream validation can never
   * produce NaN merely because every point was rejected numerically.
   */
  const robustPoints = acceptedPoints.length > 0
    ? acceptedPoints
    : points;

  const robustCenter = meanPoint(robustPoints);

  return {
    rawSampleCount: points.length,
    acceptedSampleCount: robustPoints.length,
    spatialOutlierRejectedSampleCount:
      points.length - robustPoints.length,
    rawCenter,
    robustCenter,
    rawPrecisionPx:
      meanPrecisionPx(points, rawCenter, viewport),
    robustPrecisionPx:
      meanPrecisionPx(robustPoints, robustCenter, viewport),
    rawDispersionRmsNormalized:
      dispersionRmsNormalized(points, rawCenter),
    robustDispersionRmsNormalized:
      dispersionRmsNormalized(robustPoints, robustCenter),
    medianCenter,
    medianRadiusNormalized,
    madRadiusNormalized,
    allowedRadiusNormalized,
    acceptedIndices
  };
}
