import {
  EYE_GEOMETRY_RUNTIME,
  FACE_LANDMARK_INDICES
} from "../shared/constants";

import type {
  Point2D,
  TimestampMs
} from "../shared/types";

import type {
  FaceLandmarkerFrameResult,
  FaceLandmarkPoint
} from "./faceLandmarker";

/* ========================================================================== 
 * Public eye-geometry types
 * ======================================================================== */

export type EyeSide =
  | "LEFT"
  | "RIGHT";

/**
 * Geometry for one anatomical eye.
 *
 * Left/right follow MediaPipe's anatomical convention rather than the
 * mirrored appearance of a webcam preview.
 */
export interface EyeGeometry {
  readonly side: EyeSide;

  readonly contourCenterNormalized:
    Point2D;

  readonly contourCenterPx:
    Point2D;

  readonly irisCenterNormalized:
    Point2D;

  readonly irisCenterPx:
    Point2D;

  readonly outerCornerNormalized:
    Point2D;

  readonly innerCornerNormalized:
    Point2D;

  readonly outerCornerPx:
    Point2D;

  readonly innerCornerPx:
    Point2D;

  /**
   * Corner-to-corner eye width in source-frame pixels.
   */
  readonly eyeWidthPx: number;

  /**
   * Eye width normalized by source-frame width.
   */
  readonly eyeWidthRatio: number;

  /**
   * Mean distance across three upper/lower eyelid landmark pairs.
   */
  readonly meanLidOpeningPx: number;

  /**
   * EAR-like opening metric used by blinkDetector.ts.
   *
   * meanLidOpeningPx / eyeWidthPx
   */
  readonly lidOpeningRatio: number;

  /**
   * Mean radial distance from iris center to the four iris landmarks.
   */
  readonly irisRadiusPx: number;

  readonly irisDiameterPx: number;

  /**
   * Iris position along the physical eye axis in image coordinates.
   *
   * 0   ~= image-left corner
   * 0.5 ~= midpoint between corners
   * 1   ~= image-right corner
   *
   * The value is intentionally not clamped so out-of-range measurements can
   * be detected by later quality modules instead of being silently hidden.
   */
  readonly irisHorizontalPositionRatio:
    number;

  /**
   * Signed iris displacement from the eye midpoint along the eye axis,
   * normalized by eye width. Zero means centered.
   */
  readonly irisHorizontalOffsetRatio:
    number;

  /**
   * Signed iris displacement perpendicular to the eye axis, normalized by
   * eye width. Positive values point approximately toward image-down.
   */
  readonly irisVerticalOffsetRatio:
    number;
}

export interface EyeGeometryFrameResult {
  readonly frameSequence: number;
  readonly timestampMs: TimestampMs;

  readonly frameWidth: number;
  readonly frameHeight: number;

  readonly faceDetected: boolean;

  readonly leftEyeValid: boolean;
  readonly rightEyeValid: boolean;
  readonly bothEyesValid: boolean;

  /**
   * True only when both anatomical eyes have usable contour, eyelid and iris
   * geometry. A closed eye may still be geometrically valid; blink state is a
   * separate responsibility of blinkDetector.ts.
   */
  readonly geometryValid: boolean;

  readonly leftEye: EyeGeometry | null;
  readonly rightEye: EyeGeometry | null;
}

/* ========================================================================== 
 * Internal configuration types
 * ======================================================================== */

interface EyeLandmarkConfiguration {
  readonly side: EyeSide;
  readonly contourIndices:
    readonly number[];
  readonly irisIndices:
    readonly number[];
  readonly outerCornerIndex:
    number;
  readonly innerCornerIndex:
    number;
  readonly eyelidPairs:
    readonly (readonly [number, number])[];
}

interface Vector2 {
  readonly x: number;
  readonly y: number;
}

const LEFT_EYE_CONFIGURATION:
EyeLandmarkConfiguration = {
  side: "LEFT",
  contourIndices:
    FACE_LANDMARK_INDICES
      .LEFT_EYE_CONTOUR,
  irisIndices:
    FACE_LANDMARK_INDICES
      .LEFT_IRIS,
  outerCornerIndex:
    FACE_LANDMARK_INDICES
      .LEFT_EYE_OUTER_CORNER,
  innerCornerIndex:
    FACE_LANDMARK_INDICES
      .LEFT_EYE_INNER_CORNER,
  eyelidPairs:
    FACE_LANDMARK_INDICES
      .LEFT_EYELID_PAIRS
};

const RIGHT_EYE_CONFIGURATION:
EyeLandmarkConfiguration = {
  side: "RIGHT",
  contourIndices:
    FACE_LANDMARK_INDICES
      .RIGHT_EYE_CONTOUR,
  irisIndices:
    FACE_LANDMARK_INDICES
      .RIGHT_IRIS,
  outerCornerIndex:
    FACE_LANDMARK_INDICES
      .RIGHT_EYE_OUTER_CORNER,
  innerCornerIndex:
    FACE_LANDMARK_INDICES
      .RIGHT_EYE_INNER_CORNER,
  eyelidPairs:
    FACE_LANDMARK_INDICES
      .RIGHT_EYELID_PAIRS
};

/* ========================================================================== 
 * Landmark / vector helpers
 * ======================================================================== */

function getLandmark(
  landmarks: readonly FaceLandmarkPoint[],
  index: number
): FaceLandmarkPoint | null {
  const landmark =
    landmarks[index];

  if (
    landmark === undefined
    || !Number.isFinite(landmark.x)
    || !Number.isFinite(landmark.y)
    || !Number.isFinite(landmark.z)
  ) {
    return null;
  }

  return landmark;
}

function toPoint2D(
  landmark: FaceLandmarkPoint
): Point2D {
  return {
    x: landmark.x,
    y: landmark.y
  };
}

function toPixelPoint(
  point: Point2D,
  frameWidth: number,
  frameHeight: number
): Point2D {
  return {
    x: point.x * frameWidth,
    y: point.y * frameHeight
  };
}

function averageLandmarks(
  landmarks: readonly FaceLandmarkPoint[],
  indices: readonly number[]
): Point2D | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const index of indices) {
    const landmark =
      getLandmark(
        landmarks,
        index
      );

    if (landmark === null) {
      return null;
    }

    sumX += landmark.x;
    sumY += landmark.y;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return {
    x: sumX / count,
    y: sumY / count
  };
}

function midpoint(
  first: Point2D,
  second: Point2D
): Point2D {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function subtract(
  first: Point2D,
  second: Point2D
): Vector2 {
  return {
    x: first.x - second.x,
    y: first.y - second.y
  };
}

function dot(
  first: Vector2,
  second: Vector2
): number {
  return (
    first.x * second.x
    + first.y * second.y
  );
}

function vectorLength(
  vector: Vector2
): number {
  return Math.hypot(
    vector.x,
    vector.y
  );
}

function normalize(
  vector: Vector2
): Vector2 | null {
  const length =
    vectorLength(
      vector
    );

  if (
    !Number.isFinite(length)
    || length
      < EYE_GEOMETRY_RUNTIME
        .MIN_AXIS_LENGTH_PX
  ) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function distance(
  first: Point2D,
  second: Point2D
): number {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y
  );
}

/**
 * Returns eye corners ordered by their image-space x coordinate.
 *
 * Using the image-left -> image-right axis gives both eyes the same sign
 * convention for iris features and automatically follows moderate head roll.
 */
function orderCornersByImageX(
  first: Point2D,
  second: Point2D
): readonly [Point2D, Point2D] {
  return first.x <= second.x
    ? [first, second]
    : [second, first];
}

function calculateMeanLidOpeningPx(
  landmarks: readonly FaceLandmarkPoint[],
  pairs: readonly (readonly [number, number])[],
  frameWidth: number,
  frameHeight: number
): number | null {
  if (pairs.length === 0) {
    return null;
  }

  let total = 0;

  for (const pair of pairs) {
    const upper =
      getLandmark(
        landmarks,
        pair[0]
      );

    const lower =
      getLandmark(
        landmarks,
        pair[1]
      );

    if (
      upper === null
      || lower === null
    ) {
      return null;
    }

    total += distance(
      toPixelPoint(
        toPoint2D(upper),
        frameWidth,
        frameHeight
      ),
      toPixelPoint(
        toPoint2D(lower),
        frameWidth,
        frameHeight
      )
    );
  }

  const mean =
    total / pairs.length;

  return Number.isFinite(mean)
    ? mean
    : null;
}

function calculateIrisRadiusPx(
  landmarks: readonly FaceLandmarkPoint[],
  irisIndices: readonly number[],
  irisCenterPx: Point2D,
  frameWidth: number,
  frameHeight: number
): number | null {
  if (irisIndices.length === 0) {
    return null;
  }

  let totalRadius = 0;

  for (const index of irisIndices) {
    const landmark =
      getLandmark(
        landmarks,
        index
      );

    if (landmark === null) {
      return null;
    }

    totalRadius += distance(
      irisCenterPx,
      toPixelPoint(
        toPoint2D(landmark),
        frameWidth,
        frameHeight
      )
    );
  }

  const radius =
    totalRadius / irisIndices.length;

  return Number.isFinite(radius)
    ? radius
    : null;
}

/* ========================================================================== 
 * Eye geometry calculation
 * ======================================================================== */

function calculateEyeGeometry(
  result: FaceLandmarkerFrameResult,
  configuration: EyeLandmarkConfiguration
): EyeGeometry | null {
  const contourCenterNormalized =
    averageLandmarks(
      result.landmarks,
      configuration.contourIndices
    );

  const irisCenterNormalized =
    averageLandmarks(
      result.landmarks,
      configuration.irisIndices
    );

  const outerCorner =
    getLandmark(
      result.landmarks,
      configuration.outerCornerIndex
    );

  const innerCorner =
    getLandmark(
      result.landmarks,
      configuration.innerCornerIndex
    );

  if (
    contourCenterNormalized === null
    || irisCenterNormalized === null
    || outerCorner === null
    || innerCorner === null
  ) {
    return null;
  }

  const outerCornerNormalized =
    toPoint2D(
      outerCorner
    );

  const innerCornerNormalized =
    toPoint2D(
      innerCorner
    );

  const contourCenterPx =
    toPixelPoint(
      contourCenterNormalized,
      result.frameWidth,
      result.frameHeight
    );

  const irisCenterPx =
    toPixelPoint(
      irisCenterNormalized,
      result.frameWidth,
      result.frameHeight
    );

  const outerCornerPx =
    toPixelPoint(
      outerCornerNormalized,
      result.frameWidth,
      result.frameHeight
    );

  const innerCornerPx =
    toPixelPoint(
      innerCornerNormalized,
      result.frameWidth,
      result.frameHeight
    );

  const eyeWidthPx =
    distance(
      outerCornerPx,
      innerCornerPx
    );

  if (
    !Number.isFinite(eyeWidthPx)
    || eyeWidthPx
      < EYE_GEOMETRY_RUNTIME
        .MIN_EYE_WIDTH_PX
  ) {
    return null;
  }

  const meanLidOpeningPx =
    calculateMeanLidOpeningPx(
      result.landmarks,
      configuration.eyelidPairs,
      result.frameWidth,
      result.frameHeight
    );

  const irisRadiusPx =
    calculateIrisRadiusPx(
      result.landmarks,
      configuration.irisIndices,
      irisCenterPx,
      result.frameWidth,
      result.frameHeight
    );

  if (
    meanLidOpeningPx === null
    || irisRadiusPx === null
  ) {
    return null;
  }

  const irisDiameterPx =
    irisRadiusPx * 2;

  if (
    irisDiameterPx
      < EYE_GEOMETRY_RUNTIME
        .MIN_IRIS_DIAMETER_PX
  ) {
    return null;
  }

  const [imageLeftCorner, imageRightCorner] =
    orderCornersByImageX(
      outerCornerPx,
      innerCornerPx
    );

  const eyeAxis =
    normalize(
      subtract(
        imageRightCorner,
        imageLeftCorner
      )
    );

  if (eyeAxis === null) {
    return null;
  }

  /**
   * Rotating the left-to-right eye axis by +90 degrees in image coordinates
   * produces an approximately image-down vector because image y grows down.
   */
  const imageDownAxis = {
    x: -eyeAxis.y,
    y: eyeAxis.x
  } satisfies Vector2;

  const cornerMidpoint =
    midpoint(
      imageLeftCorner,
      imageRightCorner
    );

  const irisFromMidpoint =
    subtract(
      irisCenterPx,
      cornerMidpoint
    );

  const horizontalOffsetPx =
    dot(
      irisFromMidpoint,
      eyeAxis
    );

  const verticalOffsetPx =
    dot(
      irisFromMidpoint,
      imageDownAxis
    );

  const irisHorizontalOffsetRatio =
    horizontalOffsetPx
    / eyeWidthPx;

  const irisVerticalOffsetRatio =
    verticalOffsetPx
    / eyeWidthPx;

  const irisHorizontalPositionRatio =
    0.5
    + irisHorizontalOffsetRatio;

  const lidOpeningRatio =
    meanLidOpeningPx
    / eyeWidthPx;

  const eyeWidthRatio =
    eyeWidthPx
    / result.frameWidth;

  if (
    !Number.isFinite(lidOpeningRatio)
    || !Number.isFinite(eyeWidthRatio)
    || !Number.isFinite(
      irisHorizontalPositionRatio
    )
    || !Number.isFinite(
      irisHorizontalOffsetRatio
    )
    || !Number.isFinite(
      irisVerticalOffsetRatio
    )
  ) {
    return null;
  }

  return {
    side:
      configuration.side,

    contourCenterNormalized,
    contourCenterPx,

    irisCenterNormalized,
    irisCenterPx,

    outerCornerNormalized,
    innerCornerNormalized,

    outerCornerPx,
    innerCornerPx,

    eyeWidthPx,
    eyeWidthRatio,

    meanLidOpeningPx,
    lidOpeningRatio,

    irisRadiusPx,
    irisDiameterPx,

    irisHorizontalPositionRatio,
    irisHorizontalOffsetRatio,
    irisVerticalOffsetRatio
  };
}

/* ========================================================================== 
 * Analyzer
 * ======================================================================== */

/**
 * Stateless eye-geometry analyzer.
 *
 * This module deliberately performs geometry only. It does not classify
 * blinks, calculate gaze, persist eye landmarks, or depend directly on
 * MediaPipe classes.
 */
export class EyeGeometryAnalyzer {
  public analyze(
    result: FaceLandmarkerFrameResult
  ): EyeGeometryFrameResult {
    if (
      !result.faceDetected
      || result.landmarks.length === 0
      || result.frameWidth <= 0
      || result.frameHeight <= 0
    ) {
      return this.createInvalidResult(
        result,
        false
      );
    }

    const leftEye =
      calculateEyeGeometry(
        result,
        LEFT_EYE_CONFIGURATION
      );

    const rightEye =
      calculateEyeGeometry(
        result,
        RIGHT_EYE_CONFIGURATION
      );

    const leftEyeValid =
      leftEye !== null;

    const rightEyeValid =
      rightEye !== null;

    const bothEyesValid =
      leftEyeValid
      && rightEyeValid;

    return {
      frameSequence:
        result.frameSequence,

      timestampMs:
        result.timestampMs,

      frameWidth:
        result.frameWidth,

      frameHeight:
        result.frameHeight,

      faceDetected: true,

      leftEyeValid,
      rightEyeValid,
      bothEyesValid,

      geometryValid:
        bothEyesValid,

      leftEye,
      rightEye
    };
  }

  private createInvalidResult(
    result: FaceLandmarkerFrameResult,
    faceDetected: boolean
  ): EyeGeometryFrameResult {
    return {
      frameSequence:
        result.frameSequence,

      timestampMs:
        result.timestampMs,

      frameWidth:
        result.frameWidth,

      frameHeight:
        result.frameHeight,

      faceDetected,

      leftEyeValid: false,
      rightEyeValid: false,
      bothEyesValid: false,
      geometryValid: false,

      leftEye: null,
      rightEye: null
    };
  }
}
