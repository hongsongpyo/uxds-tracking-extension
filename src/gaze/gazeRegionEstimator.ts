import type {
  Point2D
} from "../shared/types";

/**
 * Coarse 3x3 gaze region used for directional calibration priors and
 * conservative screen-region diagnostics. The thresholds intentionally match
 * the independent 3x3 validation layout semantics rather than any specific DOM
 * AOI. AOI inference remains a later, uncertainty-aware layer.
 */
export type GazeScreenRegion =
  | "TOP_LEFT"
  | "TOP"
  | "TOP_RIGHT"
  | "LEFT"
  | "CENTER"
  | "RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM"
  | "BOTTOM_RIGHT";

export type GazeHorizontalBand =
  | "LEFT"
  | "CENTER"
  | "RIGHT";

export type GazeVerticalBand =
  | "TOP"
  | "CENTER"
  | "BOTTOM";

export interface GazeRegionEstimate {
  readonly region: GazeScreenRegion;
  readonly horizontalBand: GazeHorizontalBand;
  readonly verticalBand: GazeVerticalBand;
  /**
   * Distance in normalized viewport coordinates to the nearest internal 1/3
   * region boundary on either axis.
   */
  readonly boundaryMarginNormalized: number;
  /**
   * True when the expected spatial uncertainty overlaps a 3x3 region boundary.
   * Ambiguous does not mean invalid; it means the coarse region should not be
   * treated as a hard AOI decision.
   */
  readonly ambiguous: boolean;
}

const LOW_BOUNDARY = 1 / 3;
const HIGH_BOUNDARY = 2 / 3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function horizontalBand(
  x: number
): GazeHorizontalBand {
  if (x < LOW_BOUNDARY) {
    return "LEFT";
  }

  if (x > HIGH_BOUNDARY) {
    return "RIGHT";
  }

  return "CENTER";
}

function verticalBand(
  y: number
): GazeVerticalBand {
  if (y < LOW_BOUNDARY) {
    return "TOP";
  }

  if (y > HIGH_BOUNDARY) {
    return "BOTTOM";
  }

  return "CENTER";
}

function regionFromBands(
  horizontal: GazeHorizontalBand,
  vertical: GazeVerticalBand
): GazeScreenRegion {
  if (vertical === "TOP") {
    if (horizontal === "LEFT") {
      return "TOP_LEFT";
    }

    if (horizontal === "RIGHT") {
      return "TOP_RIGHT";
    }

    return "TOP";
  }

  if (vertical === "BOTTOM") {
    if (horizontal === "LEFT") {
      return "BOTTOM_LEFT";
    }

    if (horizontal === "RIGHT") {
      return "BOTTOM_RIGHT";
    }

    return "BOTTOM";
  }

  if (horizontal === "LEFT") {
    return "LEFT";
  }

  if (horizontal === "RIGHT") {
    return "RIGHT";
  }

  return "CENTER";
}

function distanceToNearestInternalBoundary(
  value: number
): number {
  return Math.min(
    Math.abs(value - LOW_BOUNDARY),
    Math.abs(value - HIGH_BOUNDARY)
  );
}

export function classifyGazeScreenRegion(
  point: Point2D
): GazeScreenRegion {
  const x = clamp01(point.x);
  const y = clamp01(point.y);

  return regionFromBands(
    horizontalBand(x),
    verticalBand(y)
  );
}

export function estimateGazeScreenRegion(
  point: Point2D,
  uncertaintyRadiusNormalized = 0
): GazeRegionEstimate {
  const x = clamp01(point.x);
  const y = clamp01(point.y);
  const horizontal = horizontalBand(x);
  const vertical = verticalBand(y);

  const boundaryMarginNormalized = Math.min(
    distanceToNearestInternalBoundary(x),
    distanceToNearestInternalBoundary(y)
  );

  const safeUncertainty = Number.isFinite(
    uncertaintyRadiusNormalized
  )
    ? Math.max(0, uncertaintyRadiusNormalized)
    : 0;

  return {
    region: regionFromBands(horizontal, vertical),
    horizontalBand: horizontal,
    verticalBand: vertical,
    boundaryMarginNormalized,
    ambiguous:
      safeUncertainty > 0
      && boundaryMarginNormalized <= safeUncertainty
  };
}

export function isDiagonalGazeRegion(
  region: GazeScreenRegion
): boolean {
  return (
    region === "TOP_LEFT"
    || region === "TOP_RIGHT"
    || region === "BOTTOM_LEFT"
    || region === "BOTTOM_RIGHT"
  );
}

export function isCardinalGazeRegion(
  region: GazeScreenRegion
): boolean {
  return (
    region === "TOP"
    || region === "RIGHT"
    || region === "BOTTOM"
    || region === "LEFT"
  );
}
