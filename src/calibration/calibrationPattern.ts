import {
  CALIBRATION
} from "../shared/constants";

import type {
  CalibrationMode,
  CalibrationTarget,
  Point2D,
  Size2D
} from "../shared/types";

/* ========================================================================== 
 * Internal helpers
 * ======================================================================== */

type PatternIndex = readonly [
  column: number,
  row: number
];

const STANDARD_SEQUENCE: readonly PatternIndex[] = [
  [2, 2],

  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],

  [2, 0],
  [4, 2],
  [2, 4],
  [0, 2],

  [1, 1],
  [3, 1],
  [3, 3],
  [1, 3],

  [2, 1],
  [3, 2],
  [2, 3],
  [1, 2]
] as const;

const PRECISION_SEQUENCE: readonly PatternIndex[] = [
  [2, 2],

  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],

  [2, 0],
  [4, 2],
  [2, 4],
  [0, 2],

  [1, 1],
  [3, 1],
  [3, 3],
  [1, 3],

  [2, 1],
  [3, 2],
  [2, 3],
  [1, 2],

  [1, 0],
  [3, 0],
  [4, 1],
  [4, 3],
  [3, 4],
  [1, 4],
  [0, 3],
  [0, 1]
] as const;

const VALIDATION_INSET_RATIO = 0.18;

function assertViewportSize(
  viewport: Size2D
): void {
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
  ) {
    throw new RangeError(
      "Calibration viewport dimensions must be finite and greater than zero."
    );
  }
}

function createFiveAxisValues():
readonly number[] {
  const outerLow =
    CALIBRATION.TARGET_MARGIN_RATIO;

  const outerHigh =
    1 - outerLow;

  const center = 0.5;

  const innerLow =
    (outerLow + center) / 2;

  const innerHigh =
    (center + outerHigh) / 2;

  return [
    outerLow,
    innerLow,
    center,
    innerHigh,
    outerHigh
  ];
}

function normalizedToViewport(
  normalizedPoint: Point2D,
  viewport: Size2D
): Point2D {
  return {
    x:
      normalizedPoint.x
      * viewport.width,

    y:
      normalizedPoint.y
      * viewport.height
  };
}

function createTargetsFromSequence(
  sequence: readonly PatternIndex[],
  viewport: Size2D
): readonly CalibrationTarget[] {
  assertViewportSize(viewport);

  const axis =
    createFiveAxisValues();

  return sequence.map(
    ([column, row], pointIndex) => {
      const x = axis[column];
      const y = axis[row];

      if (
        x === undefined
        || y === undefined
      ) {
        throw new RangeError(
          "Calibration pattern contains an invalid grid index."
        );
      }

      const normalizedPoint = {
        x,
        y
      };

      return {
        pointIndex,
        normalizedPoint,
        viewportPoint:
          normalizedToViewport(
            normalizedPoint,
            viewport
          )
      };
    }
  );
}

/* ========================================================================== 
 * Public API
 * ======================================================================== */

/**
 * Builds the ordered calibration target sequence.
 *
 * STANDARD_17 uses a balanced 17-point subset of a 5x5 lattice.
 * PRECISION_25 uses all 25 lattice points.
 *
 * The exact viewport edge is intentionally avoided so the visual target and
 * its hit area remain fully visible in ordinary browser windows.
 */
export function createCalibrationPattern(
  mode: CalibrationMode,
  viewport: Size2D
): readonly CalibrationTarget[] {
  switch (mode) {
    case "STANDARD_17":
      return createTargetsFromSequence(
        STANDARD_SEQUENCE,
        viewport
      );

    case "PRECISION_25":
      return createTargetsFromSequence(
        PRECISION_SEQUENCE,
        viewport
      );
  }
}


/**
 * Returns the eight 5x5 lattice positions that PRECISION_25 adds after the
 * shared STANDARD_17 prefix. Their original precision pointIndex values are
 * retained so an adaptive planner can log provenance before re-indexing a
 * selected subset into the active calibration sequence.
 */
export function createCalibrationExpansionCandidates(
  viewport: Size2D
): readonly CalibrationTarget[] {
  return createTargetsFromSequence(
    PRECISION_SEQUENCE,
    viewport
  ).slice(CALIBRATION.STANDARD_POINT_COUNT);
}

/**
 * Creates an independent 3x3 validation sequence.
 *
 * Validation observations must be collected after model fitting; they are
 * never included in the calibration-model training set.
 */
export function createCalibrationValidationPattern(
  viewport: Size2D
): readonly CalibrationTarget[] {
  assertViewportSize(viewport);

  const low = VALIDATION_INSET_RATIO;
  const center = 0.5;
  const high = 1 - VALIDATION_INSET_RATIO;

  const normalizedPoints: readonly Point2D[] = [
    { x: center, y: center },
    { x: low, y: low },
    { x: high, y: low },
    { x: high, y: high },
    { x: low, y: high },
    { x: center, y: low },
    { x: high, y: center },
    { x: center, y: high },
    { x: low, y: center }
  ];

  return normalizedPoints.map(
    (normalizedPoint, pointIndex) => ({
      pointIndex,
      normalizedPoint,
      viewportPoint:
        normalizedToViewport(
          normalizedPoint,
          viewport
        )
    })
  );
}

/**
 * Five spatial anchors used for runtime quick recalibration after persistent
 * calibration-pose drift. The caller supplies the starting point index so the
 * new samples extend the existing calibration set instead of replacing it.
 */
export function createQuickRecalibrationPattern(
  viewport: Size2D,
  startingPointIndex: number
): readonly CalibrationTarget[] {
  assertViewportSize(viewport);

  if (!Number.isInteger(startingPointIndex) || startingPointIndex < 0) {
    throw new RangeError(
      "Quick recalibration requires a non-negative integer starting point index."
    );
  }

  const low = VALIDATION_INSET_RATIO;
  const center = 0.5;
  const high = 1 - VALIDATION_INSET_RATIO;

  const normalizedPoints: readonly Point2D[] = [
    { x: center, y: center },
    { x: low, y: low },
    { x: high, y: low },
    { x: high, y: high },
    { x: low, y: high }
  ];

  return normalizedPoints.map((normalizedPoint, offset) => ({
    pointIndex: startingPointIndex + offset,
    normalizedPoint,
    viewportPoint: normalizedToViewport(normalizedPoint, viewport)
  }));
}

/**
 * Minimal independent quick-validation pattern. It deliberately contains one
 * CENTER, one EDGE and one CORNER target so the ordinary validation metrics
 * remain defined while keeping maintenance interruption short.
 */
export function createQuickValidationPattern(
  viewport: Size2D
): readonly CalibrationTarget[] {
  assertViewportSize(viewport);

  const low = VALIDATION_INSET_RATIO;
  const center = 0.5;
  const high = 1 - VALIDATION_INSET_RATIO;
  const normalizedPoints: readonly Point2D[] = [
    { x: center, y: center },
    { x: center, y: low },
    { x: high, y: high }
  ];

  return normalizedPoints.map((normalizedPoint, pointIndex) => ({
    pointIndex,
    normalizedPoint,
    viewportPoint: normalizedToViewport(normalizedPoint, viewport)
  }));
}

