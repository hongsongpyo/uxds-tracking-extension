import {
  FACE_GEOMETRY_RUNTIME,
  FACE_LANDMARK_INDICES
} from "../shared/constants";

import type {
  Point2D,
  Rect2D,
  TimestampMs
} from "../shared/types";

import type {
  FaceLandmarkerFrameResult,
  FaceLandmarkPoint
} from "./faceLandmarker";

/* ========================================================================== 
 * Public geometry types
 * ======================================================================== */

/**
 * Rectangle expressed in normalized image coordinates.
 *
 * left/top/right/bottom use the same 0..1 image coordinate system as the
 * Face Landmarker output. Width/height are derived values.
 */
export interface NormalizedFaceBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface FaceAnchorGeometry {
  readonly noseTipNormalized:
    Point2D;

  readonly foreheadTopNormalized:
    Point2D;

  readonly chinNormalized:
    Point2D;

  readonly leftCheekNormalized:
    Point2D;

  readonly rightCheekNormalized:
    Point2D;
}

export interface EyeCenterGeometry {
  readonly leftNormalized:
    Point2D;

  readonly rightNormalized:
    Point2D;

  readonly midpointNormalized:
    Point2D;

  readonly leftPx:
    Point2D;

  readonly rightPx:
    Point2D;

  readonly midpointPx:
    Point2D;

  /**
   * Euclidean eye-center distance in source-frame pixels.
   */
  readonly interocularDistancePx:
    number;

  /**
   * Pixel distance normalized by frame width.
   */
  readonly interocularDistanceRatio:
    number;
}

/**
 * Stable face geometry derived from one Face Landmarker frame.
 *
 * `proximityProxy` is a dimensionless scale value where a larger value means
 * a larger face in the camera frame and therefore, in ordinary webcam use,
 * typically a participant closer to the camera. It is not a metric depth.
 */
export interface FaceGeometry {
  readonly boundsNormalized:
    NormalizedFaceBounds;

  readonly boundsPx:
    Rect2D;

  readonly centerNormalized:
    Point2D;

  readonly centerPx:
    Point2D;

  readonly widthRatio:
    number;

  readonly heightRatio:
    number;

  readonly areaRatio:
    number;

  readonly aspectRatio:
    number;

  readonly proximityProxy:
    number;

  readonly eyeCenters:
    EyeCenterGeometry;

  readonly anchors:
    FaceAnchorGeometry;
}

export interface FaceGeometryFrameResult {
  readonly frameSequence: number;
  readonly timestampMs: TimestampMs;

  readonly frameWidth: number;
  readonly frameHeight: number;

  readonly faceDetected: boolean;

  /**
   * False when a face was reported but the required semantic landmarks were
   * unavailable or produced degenerate geometry.
   */
  readonly geometryValid: boolean;

  readonly geometry:
    FaceGeometry | null;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

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

function distance(
  first: Point2D,
  second: Point2D
): number {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y
  );
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

function calculateBounds(
  landmarks: readonly FaceLandmarkPoint[],
  indices: readonly number[]
): NormalizedFaceBounds | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const index of indices) {
    const landmark =
      getLandmark(
        landmarks,
        index
      );

    if (landmark === null) {
      return null;
    }

    left = Math.min(
      left,
      landmark.x
    );

    top = Math.min(
      top,
      landmark.y
    );

    right = Math.max(
      right,
      landmark.x
    );

    bottom = Math.max(
      bottom,
      landmark.y
    );
  }

  const width =
    right - left;

  const height =
    bottom - top;

  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width
      < FACE_GEOMETRY_RUNTIME
        .MIN_NORMALIZED_DIMENSION
    || height
      < FACE_GEOMETRY_RUNTIME
        .MIN_NORMALIZED_DIMENSION
  ) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width,
    height
  };
}

function boundsToPixelRect(
  bounds: NormalizedFaceBounds,
  frameWidth: number,
  frameHeight: number
): Rect2D {
  return {
    left:
      bounds.left
      * frameWidth,

    top:
      bounds.top
      * frameHeight,

    width:
      bounds.width
      * frameWidth,

    height:
      bounds.height
      * frameHeight
  };
}

/* ========================================================================== 
 * Face geometry analyzer
 * ======================================================================== */

/**
 * Stateless face geometry calculator.
 *
 * It intentionally consumes the MediaPipe-independent result exported by
 * faceLandmarker.ts rather than importing MediaPipe itself.
 */
export class FaceGeometryAnalyzer {
  public analyze(
    result: FaceLandmarkerFrameResult
  ): FaceGeometryFrameResult {
    if (
      !result.faceDetected
      || result.landmarks.length === 0
    ) {
      return this.createInvalidResult(
        result,
        false
      );
    }

    const geometry =
      this.calculateGeometry(
        result
      );

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

      geometryValid:
        geometry !== null,

      geometry
    };
  }

  private calculateGeometry(
    result: FaceLandmarkerFrameResult
  ): FaceGeometry | null {
    if (
      result.frameWidth <= 0
      || result.frameHeight <= 0
    ) {
      return null;
    }

    const bounds =
      calculateBounds(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .FACE_OVAL
      );

    if (bounds === null) {
      return null;
    }

    const noseTip =
      getLandmark(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .NOSE_TIP
      );

    const foreheadTop =
      getLandmark(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .FOREHEAD_TOP
      );

    const chin =
      getLandmark(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .CHIN
      );

    const leftCheek =
      getLandmark(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .LEFT_CHEEK
      );

    const rightCheek =
      getLandmark(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .RIGHT_CHEEK
      );

    const leftEyeCenter =
      averageLandmarks(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .LEFT_EYE_CONTOUR
      );

    const rightEyeCenter =
      averageLandmarks(
        result.landmarks,
        FACE_LANDMARK_INDICES
          .RIGHT_EYE_CONTOUR
      );

    if (
      noseTip === null
      || foreheadTop === null
      || chin === null
      || leftCheek === null
      || rightCheek === null
      || leftEyeCenter === null
      || rightEyeCenter === null
    ) {
      return null;
    }

    const centerNormalized = {
      x:
        bounds.left
        + bounds.width / 2,

      y:
        bounds.top
        + bounds.height / 2
    } satisfies Point2D;

    const centerPx =
      toPixelPoint(
        centerNormalized,
        result.frameWidth,
        result.frameHeight
      );

    const leftEyePx =
      toPixelPoint(
        leftEyeCenter,
        result.frameWidth,
        result.frameHeight
      );

    const rightEyePx =
      toPixelPoint(
        rightEyeCenter,
        result.frameWidth,
        result.frameHeight
      );

    const eyeMidpointNormalized =
      midpoint(
        leftEyeCenter,
        rightEyeCenter
      );

    const eyeMidpointPx =
      midpoint(
        leftEyePx,
        rightEyePx
      );

    const interocularDistancePx =
      distance(
        leftEyePx,
        rightEyePx
      );

    if (
      interocularDistancePx
      < FACE_GEOMETRY_RUNTIME
        .MIN_PIXEL_DISTANCE
    ) {
      return null;
    }

    const areaRatio =
      bounds.width
      * bounds.height;

    const aspectRatio =
      bounds.width
      / bounds.height;

    return {
      boundsNormalized:
        bounds,

      boundsPx:
        boundsToPixelRect(
          bounds,
          result.frameWidth,
          result.frameHeight
        ),

      centerNormalized,
      centerPx,

      widthRatio:
        bounds.width,

      heightRatio:
        bounds.height,

      areaRatio,

      aspectRatio,

      proximityProxy:
        Math.sqrt(
          areaRatio
        ),

      eyeCenters: {
        leftNormalized:
          leftEyeCenter,

        rightNormalized:
          rightEyeCenter,

        midpointNormalized:
          eyeMidpointNormalized,

        leftPx:
          leftEyePx,

        rightPx:
          rightEyePx,

        midpointPx:
          eyeMidpointPx,

        interocularDistancePx,

        interocularDistanceRatio:
          interocularDistancePx
          / result.frameWidth
      },

      anchors: {
        noseTipNormalized:
          toPoint2D(
            noseTip
          ),

        foreheadTopNormalized:
          toPoint2D(
            foreheadTop
          ),

        chinNormalized:
          toPoint2D(
            chin
          ),

        leftCheekNormalized:
          toPoint2D(
            leftCheek
          ),

        rightCheekNormalized:
          toPoint2D(
            rightCheek
          )
      }
    };
  }

  private createInvalidResult(
    result: FaceLandmarkerFrameResult,
    faceDetected: boolean
  ): FaceGeometryFrameResult {
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
      geometryValid: false,
      geometry: null
    };
  }
}
