import {
  FACE_LANDMARK_INDICES,
  HEAD_POSE_RUNTIME
} from "../shared/constants";

import type {
  HeadPose,
  TimestampMs
} from "../shared/types";

import type {
  FaceGeometryFrameResult
} from "./faceGeometry";

import type {
  FaceLandmarkerFrameResult,
  FaceLandmarkPoint,
  FacialTransformationMatrix
} from "./faceLandmarker";

/* ========================================================================== 
 * Public head-pose types
 * ======================================================================== */

/**
 * Indicates which input produced the final head-pose estimate.
 *
 * TRANSFORMATION_MATRIX is preferred because MediaPipe's face geometry
 * pipeline explicitly separates rigid head pose from facial expression.
 * LANDMARK_FALLBACK is an approximate backup used only when the matrix is
 * unavailable or fails validation.
 */
export type HeadPoseSource =
  | "TRANSFORMATION_MATRIX"
  | "LANDMARK_FALLBACK";

export interface HeadPoseDiagnostics {
  /**
   * Uniform scale estimated from the 3x3 transform block.
   * Only available for matrix-derived pose.
   */
  readonly matrixScale: number | null;

  /**
   * Maximum absolute dot product between normalized matrix axes.
   * Zero is perfectly orthogonal.
   */
  readonly orthogonalityError: number | null;

  /**
   * Relative spread between the three axis scales.
   * Zero is a perfect uniform scale.
   */
  readonly scaleSpread: number | null;
}

export interface HeadPoseFrameResult {
  readonly frameSequence: number;
  readonly timestampMs: TimestampMs;

  readonly faceDetected: boolean;
  readonly poseValid: boolean;

  readonly headPose: HeadPose | null;
  readonly source: HeadPoseSource | null;

  readonly diagnostics: HeadPoseDiagnostics;
}

/* ========================================================================== 
 * Internal vector / matrix helpers
 * ======================================================================== */

interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface RotationMatrix3 {
  readonly r00: number;
  readonly r01: number;
  readonly r02: number;

  readonly r10: number;
  readonly r11: number;
  readonly r12: number;

  readonly r20: number;
  readonly r21: number;
  readonly r22: number;
}

interface MatrixPoseExtraction {
  readonly headPose: HeadPose;
  readonly matrixScale: number;
  readonly orthogonalityError: number;
  readonly scaleSpread: number;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function vectorLength(
  vector: Vector3
): number {
  return Math.hypot(
    vector.x,
    vector.y,
    vector.z
  );
}

function subtract(
  first: Vector3,
  second: Vector3
): Vector3 {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z
  };
}

function scaleVector(
  vector: Vector3,
  scalar: number
): Vector3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar
  };
}

function dot(
  first: Vector3,
  second: Vector3
): number {
  return (
    first.x * second.x
    + first.y * second.y
    + first.z * second.z
  );
}

function cross(
  first: Vector3,
  second: Vector3
): Vector3 {
  return {
    x:
      first.y * second.z
      - first.z * second.y,

    y:
      first.z * second.x
      - first.x * second.z,

    z:
      first.x * second.y
      - first.y * second.x
  };
}

function normalize(
  vector: Vector3,
  minimumLength: number
): Vector3 | null {
  const length =
    vectorLength(
      vector
    );

  if (
    !Number.isFinite(length)
    || length < minimumLength
  ) {
    return null;
  }

  return scaleVector(
    vector,
    1 / length
  );
}

function isFiniteVector(
  vector: Vector3
): boolean {
  return (
    Number.isFinite(vector.x)
    && Number.isFinite(vector.y)
    && Number.isFinite(vector.z)
  );
}

function radiansToDegrees(
  radians: number
): number {
  return (
    radians
    * HEAD_POSE_RUNTIME
      .RADIANS_TO_DEGREES
  );
}

/* ========================================================================== 
 * Transformation-matrix extraction
 * ======================================================================== */

/**
 * MediaPipe MatrixData is column-major by default.
 *
 * index = column * rows + row
 */
function getColumnMajorValue(
  matrix: FacialTransformationMatrix,
  row: number,
  column: number
): number | null {
  const index =
    column * matrix.rows
    + row;

  const value =
    matrix.data[index];

  return (
    value !== undefined
    && Number.isFinite(value)
  )
    ? value
    : null;
}

function getMatrixAxis(
  matrix: FacialTransformationMatrix,
  column: number
): Vector3 | null {
  const x =
    getColumnMajorValue(
      matrix,
      0,
      column
    );

  const y =
    getColumnMajorValue(
      matrix,
      1,
      column
    );

  const z =
    getColumnMajorValue(
      matrix,
      2,
      column
    );

  if (
    x === null
    || y === null
    || z === null
  ) {
    return null;
  }

  return {
    x,
    y,
    z
  };
}

function createRotationMatrix(
  xAxis: Vector3,
  yAxis: Vector3,
  zAxis: Vector3
): RotationMatrix3 {
  return {
    r00: xAxis.x,
    r01: yAxis.x,
    r02: zAxis.x,

    r10: xAxis.y,
    r11: yAxis.y,
    r12: zAxis.y,

    r20: xAxis.z,
    r21: yAxis.z,
    r22: zAxis.z
  };
}

/**
 * Extracts XYZ-axis Euler angles from a right-handed rotation matrix using
 * the decomposition R = Rz(roll) * Ry(yaw) * Rx(pitch).
 *
 * Consequently:
 * - pitch is rotation about X
 * - yaw is rotation about Y
 * - roll is rotation about Z
 *
 * Signs follow the right-hand rule of MediaPipe's metric face coordinate
 * system. Downstream calibration may subtract a participant-specific neutral
 * baseline; this function intentionally does not apply UI/mirror sign hacks.
 */
function rotationMatrixToHeadPose(
  rotation: RotationMatrix3
): HeadPose | null {
  const yawRad =
    Math.asin(
      clamp(
        -rotation.r20,
        -1,
        1
      )
    );

  const cosYaw =
    Math.cos(
      yawRad
    );

  let pitchRad: number;
  let rollRad: number;

  if (
    Math.abs(cosYaw)
    > HEAD_POSE_RUNTIME
      .GIMBAL_LOCK_COS_THRESHOLD
  ) {
    pitchRad =
      Math.atan2(
        rotation.r21,
        rotation.r22
      );

    rollRad =
      Math.atan2(
        rotation.r10,
        rotation.r00
      );
  } else {
    /**
     * At gimbal lock yaw is +/- 90 degrees, so pitch and roll cannot be
     * uniquely separated. Keep roll at zero and retain the combined X-axis
     * rotation in pitch for deterministic behavior.
     */
    pitchRad =
      Math.atan2(
        -rotation.r12,
        rotation.r11
      );

    rollRad = 0;
  }

  const headPose = {
    yawDeg:
      radiansToDegrees(
        yawRad
      ),

    pitchDeg:
      radiansToDegrees(
        pitchRad
      ),

    rollDeg:
      radiansToDegrees(
        rollRad
      )
  } satisfies HeadPose;

  return (
    Number.isFinite(headPose.yawDeg)
    && Number.isFinite(headPose.pitchDeg)
    && Number.isFinite(headPose.rollDeg)
  )
    ? headPose
    : null;
}

function extractMatrixPose(
  matrix: FacialTransformationMatrix
): MatrixPoseExtraction | null {
  if (
    matrix.rows
      !== HEAD_POSE_RUNTIME
        .MATRIX_ROWS
    || matrix.columns
      !== HEAD_POSE_RUNTIME
        .MATRIX_COLUMNS
    || matrix.data.length
      < HEAD_POSE_RUNTIME
        .MATRIX_ELEMENT_COUNT
  ) {
    return null;
  }

  const xAxisRaw =
    getMatrixAxis(
      matrix,
      0
    );

  const yAxisRaw =
    getMatrixAxis(
      matrix,
      1
    );

  const zAxisRaw =
    getMatrixAxis(
      matrix,
      2
    );

  if (
    xAxisRaw === null
    || yAxisRaw === null
    || zAxisRaw === null
  ) {
    return null;
  }

  const xScale =
    vectorLength(
      xAxisRaw
    );

  const yScale =
    vectorLength(
      yAxisRaw
    );

  const zScale =
    vectorLength(
      zAxisRaw
    );

  if (
    !Number.isFinite(xScale)
    || !Number.isFinite(yScale)
    || !Number.isFinite(zScale)
    || xScale
      < HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    || yScale
      < HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    || zScale
      < HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
  ) {
    return null;
  }

  const matrixScale =
    (xScale + yScale + zScale)
    / 3;

  const scaleSpread =
    (
      Math.max(
        xScale,
        yScale,
        zScale
      )
      - Math.min(
        xScale,
        yScale,
        zScale
      )
    ) / matrixScale;

  if (
    scaleSpread
    > HEAD_POSE_RUNTIME
      .MAX_RELATIVE_SCALE_SPREAD
  ) {
    return null;
  }

  const xAxis =
    normalize(
      xAxisRaw,
      HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    );

  const yAxisInitial =
    normalize(
      yAxisRaw,
      HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    );

  const zAxisInitial =
    normalize(
      zAxisRaw,
      HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    );

  if (
    xAxis === null
    || yAxisInitial === null
    || zAxisInitial === null
  ) {
    return null;
  }

  const orthogonalityError =
    Math.max(
      Math.abs(
        dot(
          xAxis,
          yAxisInitial
        )
      ),
      Math.abs(
        dot(
          xAxis,
          zAxisInitial
        )
      ),
      Math.abs(
        dot(
          yAxisInitial,
          zAxisInitial
        )
      )
    );

  if (
    orthogonalityError
    > HEAD_POSE_RUNTIME
      .MAX_ORTHOGONALITY_ERROR
  ) {
    return null;
  }

  /**
   * Re-orthogonalize the near-rotation matrix to suppress small numerical
   * errors while preserving the X-axis direction from MediaPipe.
   */
  const yWithoutX =
    subtract(
      yAxisInitial,
      scaleVector(
        xAxis,
        dot(
          yAxisInitial,
          xAxis
        )
      )
    );

  const yAxis =
    normalize(
      yWithoutX,
      HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    );

  if (yAxis === null) {
    return null;
  }

  const zAxis =
    normalize(
      cross(
        xAxis,
        yAxis
      ),
      HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    );

  if (
    zAxis === null
    || dot(
      zAxis,
      zAxisInitial
    )
      < HEAD_POSE_RUNTIME
        .MIN_THIRD_AXIS_ALIGNMENT
  ) {
    return null;
  }

  const correctedYAxis =
    normalize(
      cross(
        zAxis,
        xAxis
      ),
      HEAD_POSE_RUNTIME
        .MIN_AXIS_SCALE
    );

  if (correctedYAxis === null) {
    return null;
  }

  const rotation =
    createRotationMatrix(
      xAxis,
      correctedYAxis,
      zAxis
    );

  const headPose =
    rotationMatrixToHeadPose(
      rotation
    );

  if (headPose === null) {
    return null;
  }

  return {
    headPose,
    matrixScale,
    orthogonalityError,
    scaleSpread
  };
}

/* ========================================================================== 
 * Landmark fallback
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

/**
 * Converts normalized MediaPipe screen landmarks into an isotropic-ish local
 * coordinate system suitable only for the fallback orientation estimate.
 *
 * X and Z use image-width scale. Y is adjusted by height/width so pixel aspect
 * does not distort the vertical axis. Screen Y is inverted so +Y points up.
 * MediaPipe screen-landmark Z becomes more negative toward the camera; it is
 * negated here so the fallback basis remains right-handed and intuitive.
 */
function toFallbackVector(
  landmark: FaceLandmarkPoint,
  frameWidth: number,
  frameHeight: number
): Vector3 {
  const verticalScale =
    frameHeight / frameWidth;

  return {
    x: landmark.x,
    y: -landmark.y * verticalScale,
    z: -landmark.z
  };
}

function estimateFallbackPose(
  result: FaceLandmarkerFrameResult,
  geometryResult: FaceGeometryFrameResult
): HeadPose | null {
  if (
    !geometryResult.geometryValid
    || geometryResult.geometry === null
    || result.frameWidth <= 0
    || result.frameHeight <= 0
  ) {
    return null;
  }

  const rightCheekLandmark =
    getLandmark(
      result.landmarks,
      FACE_LANDMARK_INDICES
        .RIGHT_CHEEK
    );

  const leftCheekLandmark =
    getLandmark(
      result.landmarks,
      FACE_LANDMARK_INDICES
        .LEFT_CHEEK
    );

  const foreheadLandmark =
    getLandmark(
      result.landmarks,
      FACE_LANDMARK_INDICES
        .FOREHEAD_TOP
    );

  const chinLandmark =
    getLandmark(
      result.landmarks,
      FACE_LANDMARK_INDICES
        .CHIN
    );

  if (
    rightCheekLandmark === null
    || leftCheekLandmark === null
    || foreheadLandmark === null
    || chinLandmark === null
  ) {
    return null;
  }

  const rightCheek =
    toFallbackVector(
      rightCheekLandmark,
      result.frameWidth,
      result.frameHeight
    );

  const leftCheek =
    toFallbackVector(
      leftCheekLandmark,
      result.frameWidth,
      result.frameHeight
    );

  const forehead =
    toFallbackVector(
      foreheadLandmark,
      result.frameWidth,
      result.frameHeight
    );

  const chin =
    toFallbackVector(
      chinLandmark,
      result.frameWidth,
      result.frameHeight
    );

  const xAxis =
    normalize(
      subtract(
        leftCheek,
        rightCheek
      ),
      HEAD_POSE_RUNTIME
        .MIN_FALLBACK_AXIS_LENGTH
    );

  const yGuide =
    normalize(
      subtract(
        forehead,
        chin
      ),
      HEAD_POSE_RUNTIME
        .MIN_FALLBACK_AXIS_LENGTH
    );

  if (
    xAxis === null
    || yGuide === null
  ) {
    return null;
  }

  const zAxis =
    normalize(
      cross(
        xAxis,
        yGuide
      ),
      HEAD_POSE_RUNTIME
        .MIN_FALLBACK_AXIS_LENGTH
    );

  if (zAxis === null) {
    return null;
  }

  const yAxis =
    normalize(
      cross(
        zAxis,
        xAxis
      ),
      HEAD_POSE_RUNTIME
        .MIN_FALLBACK_AXIS_LENGTH
    );

  if (
    yAxis === null
    || !isFiniteVector(xAxis)
    || !isFiniteVector(yAxis)
    || !isFiniteVector(zAxis)
  ) {
    return null;
  }

  return rotationMatrixToHeadPose(
    createRotationMatrix(
      xAxis,
      yAxis,
      zAxis
    )
  );
}

/* ========================================================================== 
 * Head-pose estimator
 * ======================================================================== */

/**
 * Stateless head-pose estimator.
 *
 * Preferred path:
 *   MediaPipe facial transformation matrix -> validated rotation -> Euler pose
 *
 * Fallback path:
 *   face landmarks + geometry -> approximate 3D face basis -> Euler pose
 *
 * The fallback intentionally remains distinguishable through `source` so
 * faceQuality.ts can reduce confidence when the preferred matrix is missing.
 */
export class HeadPoseEstimator {
  public analyze(
    result: FaceLandmarkerFrameResult,
    geometryResult: FaceGeometryFrameResult
  ): HeadPoseFrameResult {
    if (
      !result.faceDetected
      || result.landmarks.length === 0
    ) {
      return this.createInvalidResult(
        result,
        false
      );
    }

    const matrixResult =
      result.transformationMatrix
        === null
        ? null
        : extractMatrixPose(
          result.transformationMatrix
        );

    if (matrixResult !== null) {
      return {
        frameSequence:
          result.frameSequence,

        timestampMs:
          result.timestampMs,

        faceDetected: true,
        poseValid: true,

        headPose:
          matrixResult.headPose,

        source:
          "TRANSFORMATION_MATRIX",

        diagnostics: {
          matrixScale:
            matrixResult.matrixScale,

          orthogonalityError:
            matrixResult
              .orthogonalityError,

          scaleSpread:
            matrixResult.scaleSpread
        }
      };
    }

    const fallbackPose =
      estimateFallbackPose(
        result,
        geometryResult
      );

    if (fallbackPose !== null) {
      return {
        frameSequence:
          result.frameSequence,

        timestampMs:
          result.timestampMs,

        faceDetected: true,
        poseValid: true,

        headPose:
          fallbackPose,

        source:
          "LANDMARK_FALLBACK",

        diagnostics: {
          matrixScale: null,
          orthogonalityError: null,
          scaleSpread: null
        }
      };
    }

    return this.createInvalidResult(
      result,
      true
    );
  }

  private createInvalidResult(
    result: FaceLandmarkerFrameResult,
    faceDetected: boolean
  ): HeadPoseFrameResult {
    return {
      frameSequence:
        result.frameSequence,

      timestampMs:
        result.timestampMs,

      faceDetected,
      poseValid: false,

      headPose: null,
      source: null,

      diagnostics: {
        matrixScale: null,
        orthogonalityError: null,
        scaleSpread: null
      }
    };
  }
}
