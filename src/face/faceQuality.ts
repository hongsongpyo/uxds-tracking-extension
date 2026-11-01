import {
  CAMERA_QUALITY_THRESHOLDS,
  FACE_POSITION_THRESHOLDS,
  FACE_QUALITY_RUNTIME,
  FACE_QUALITY_THRESHOLDS,
  NORMALIZED_COORDINATE
} from "../shared/constants";

import {
  clamp01
} from "../shared/utils";

import type {
  CameraQuality,
  DataQualityLevel,
  FaceBaseline,
  FacePositionStatus,
  FaceTrackingQuality,
  HeadPose,
  TimestampMs
} from "../shared/types";

import type {
  BlinkFrameResult
} from "./blinkDetector";

import type {
  EyeGeometry,
  EyeGeometryFrameResult
} from "./eyeGeometry";

import type {
  FaceGeometryFrameResult
} from "./faceGeometry";

import type {
  FaceLandmarkerFrameResult
} from "./faceLandmarker";

import type {
  HeadPoseFrameResult
} from "./headPose";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export type FaceQualityIssue =
  | "NO_FACE"
  | "FACE_GEOMETRY_INVALID"
  | "HEAD_POSE_INVALID"
  | "HEAD_POSE_EXCESSIVE"
  | "LEFT_EYE_INVALID"
  | "RIGHT_EYE_INVALID"
  | "EYE_GEOMETRY_IMPLAUSIBLE"
  | "BLINK_IN_PROGRESS"
  | "ASYMMETRIC_EYE_CLOSURE"
  | "FACE_NOT_CENTERED"
  | "FACE_DISTANCE_INVALID"
  | "LIGHTING_INVALID"
  | "CAMERA_QUALITY_INVALID"
  | "FRAME_MISMATCH";

export interface FaceQualityEvaluationInput {
  readonly landmarker:
    FaceLandmarkerFrameResult;

  readonly geometry:
    FaceGeometryFrameResult;

  readonly headPose:
    HeadPoseFrameResult;

  readonly eyes:
    EyeGeometryFrameResult;

  readonly blink:
    BlinkFrameResult;

  /**
   * Latest transient camera-quality measurement for the same runtime period.
   * It does not need to originate from the exact same video frame.
   */
  readonly cameraQuality:
    CameraQuality | null;

  /**
   * Optional participant-specific baseline available after pre-calibration.
   * Before a baseline exists, absolute face-size guards are used instead.
   */
  readonly baseline?:
    FaceBaseline | null;
}

export interface FaceQualityFrameResult {
  readonly frameSequence: number;
  readonly timestampMs: TimestampMs;

  readonly trackingQuality:
    FaceTrackingQuality;

  readonly positionStatus:
    FacePositionStatus;

  /**
   * True when the current frame is suitable as an input to gaze estimation.
   */
  readonly usableForGaze: boolean;

  readonly issues:
    readonly FaceQualityIssue[];
}

/* ========================================================================== 
 * Internal helpers
 * ======================================================================== */

const ZERO_HEAD_POSE: HeadPose = {
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0
};

function classifyQualityLevel(
  score: number,
  structurallyValid: boolean
): DataQualityLevel {
  if (
    !structurallyValid
    || !Number.isFinite(score)
    || score < FACE_QUALITY_THRESHOLDS
      .POOR_QUALITY_SCORE
  ) {
    return "INVALID";
  }

  if (
    score >= FACE_QUALITY_THRESHOLDS
      .GOOD_QUALITY_SCORE
  ) {
    return "GOOD";
  }

  if (
    score >= FACE_QUALITY_THRESHOLDS
      .FAIR_QUALITY_SCORE
  ) {
    return "FAIR";
  }

  return "POOR";
}

function calculateFaceConfidence(
  landmarker: FaceLandmarkerFrameResult,
  geometry: FaceGeometryFrameResult,
  headPose: HeadPoseFrameResult
): number {
  if (!landmarker.faceDetected) {
    return 0;
  }

  let score = 0;

  if (geometry.geometryValid) {
    score += FACE_QUALITY_RUNTIME
      .FACE_CONFIDENCE_GEOMETRY_WEIGHT;
  }

  if (headPose.poseValid) {
    score += FACE_QUALITY_RUNTIME
      .FACE_CONFIDENCE_POSE_WEIGHT;
  }

  if (
    headPose.source
      === "TRANSFORMATION_MATRIX"
  ) {
    score += FACE_QUALITY_RUNTIME
      .FACE_CONFIDENCE_MATRIX_BONUS;
  }

  if (
    landmarker.landmarkCount
      < FACE_QUALITY_RUNTIME
        .EXPECTED_LANDMARK_COUNT
  ) {
    const completeness =
      clamp01(
        landmarker.landmarkCount
        / FACE_QUALITY_RUNTIME
          .EXPECTED_LANDMARK_COUNT
      );

    score *= completeness;
  }

  return clamp01(score);
}

function isEyeGeometryPlausible(
  eye: EyeGeometry | null
): boolean {
  if (eye === null) {
    return false;
  }

  if (
    !Number.isFinite(
      eye.irisHorizontalPositionRatio
    )
    || !Number.isFinite(
      eye.irisVerticalOffsetRatio
    )
    || !Number.isFinite(
      eye.irisDiameterPx
    )
    || !Number.isFinite(
      eye.eyeWidthPx
    )
    || eye.eyeWidthPx <= 0
  ) {
    return false;
  }

  const irisToEyeWidthRatio =
    eye.irisDiameterPx
    / eye.eyeWidthPx;

  return (
    eye.irisHorizontalPositionRatio
      >= FACE_QUALITY_RUNTIME
        .EYE_HORIZONTAL_POSITION_MIN
    && eye.irisHorizontalPositionRatio
      <= FACE_QUALITY_RUNTIME
        .EYE_HORIZONTAL_POSITION_MAX
    && Math.abs(
      eye.irisVerticalOffsetRatio
    )
      <= FACE_QUALITY_RUNTIME
        .EYE_MAX_ABS_VERTICAL_OFFSET_RATIO
    && irisToEyeWidthRatio
      >= FACE_QUALITY_RUNTIME
        .EYE_MIN_IRIS_TO_EYE_WIDTH_RATIO
    && irisToEyeWidthRatio
      <= FACE_QUALITY_RUNTIME
        .EYE_MAX_IRIS_TO_EYE_WIDTH_RATIO
  );
}

function calculateEyeConfidence(
  eyes: EyeGeometryFrameResult
): number {
  let score = 0;

  if (eyes.leftEyeValid) {
    score += FACE_QUALITY_RUNTIME
      .SINGLE_EYE_GEOMETRY_WEIGHT;
  }

  if (eyes.rightEyeValid) {
    score += FACE_QUALITY_RUNTIME
      .SINGLE_EYE_GEOMETRY_WEIGHT;
  }

  if (
    score > 0
    && (
      !isEyeGeometryPlausible(
        eyes.leftEye
      )
      || !isEyeGeometryPlausible(
        eyes.rightEye
      )
    )
  ) {
    score *= FACE_QUALITY_RUNTIME
      .IMPLAUSIBLE_EYE_SCORE_MULTIPLIER;
  }

  return clamp01(score);
}

function calculateHeadPoseScore(
  result: HeadPoseFrameResult
): number {
  const pose =
    result.headPose;

  if (
    !result.poseValid
    || pose === null
  ) {
    return 0;
  }

  const yawScore =
    clamp01(
      1
      - Math.abs(pose.yawDeg)
      / FACE_POSITION_THRESHOLDS
        .MAX_ABS_YAW_DEG
    );

  const pitchScore =
    clamp01(
      1
      - Math.abs(pose.pitchDeg)
      / FACE_POSITION_THRESHOLDS
        .MAX_ABS_PITCH_DEG
    );

  const rollScore =
    clamp01(
      1
      - Math.abs(pose.rollDeg)
      / FACE_POSITION_THRESHOLDS
        .MAX_ABS_ROLL_DEG
    );

  let score =
    (
      yawScore
      + pitchScore
      + rollScore
    ) / 3;

  if (
    result.source
      === "LANDMARK_FALLBACK"
  ) {
    score *= FACE_QUALITY_RUNTIME
      .FALLBACK_POSE_SCORE_MULTIPLIER;
  }

  return clamp01(score);
}

function isHeadPoseAcceptable(
  pose: HeadPose | null
): boolean {
  if (pose === null) {
    return false;
  }

  return (
    Math.abs(pose.yawDeg)
      <= FACE_POSITION_THRESHOLDS
        .MAX_ABS_YAW_DEG
    && Math.abs(pose.pitchDeg)
      <= FACE_POSITION_THRESHOLDS
        .MAX_ABS_PITCH_DEG
    && Math.abs(pose.rollDeg)
      <= FACE_POSITION_THRESHOLDS
        .MAX_ABS_ROLL_DEG
  );
}

function calculateFaceDistanceRatio(
  geometry: FaceGeometryFrameResult,
  baseline: FaceBaseline | null
): number {
  const current =
    geometry.geometry;

  if (current === null) {
    return 0;
  }

  if (
    baseline === null
    || baseline.width <= 0
    || baseline.height <= 0
  ) {
    /**
     * Before a baseline exists, 1 is the neutral relative-distance value.
     * Pre-calibration distance validity is determined from absolute frame
     * ratios instead of this placeholder.
     */
    return 1;
  }

  const widthRatio =
    current.widthRatio
    / baseline.width;

  const heightRatio =
    current.heightRatio
    / baseline.height;

  if (
    !Number.isFinite(widthRatio)
    || !Number.isFinite(heightRatio)
    || widthRatio <= 0
    || heightRatio <= 0
  ) {
    return 0;
  }

  return Math.sqrt(
    widthRatio * heightRatio
  );
}

function isDistanceAcceptable(
  geometry: FaceGeometryFrameResult,
  faceDistanceRatio: number,
  baseline: FaceBaseline | null
): boolean {
  const current =
    geometry.geometry;

  if (current === null) {
    return false;
  }

  if (baseline !== null) {
    return (
      faceDistanceRatio
        >= FACE_POSITION_THRESHOLDS
          .MIN_FACE_DISTANCE_RATIO
      && faceDistanceRatio
        <= FACE_POSITION_THRESHOLDS
          .MAX_FACE_DISTANCE_RATIO
    );
  }

  return (
    current.widthRatio
      >= FACE_QUALITY_RUNTIME
        .MIN_PRECALIBRATION_FACE_WIDTH_RATIO
    && current.widthRatio
      <= FACE_QUALITY_RUNTIME
        .MAX_PRECALIBRATION_FACE_WIDTH_RATIO
    && current.heightRatio
      >= FACE_QUALITY_RUNTIME
        .MIN_PRECALIBRATION_FACE_HEIGHT_RATIO
    && current.heightRatio
      <= FACE_QUALITY_RUNTIME
        .MAX_PRECALIBRATION_FACE_HEIGHT_RATIO
  );
}

function calculatePositionStatus(
  geometry: FaceGeometryFrameResult,
  headPose: HeadPoseFrameResult,
  eyes: EyeGeometryFrameResult,
  cameraQuality: CameraQuality | null,
  faceDistanceRatio: number,
  baseline: FaceBaseline | null,
  stable: boolean
): FacePositionStatus {
  const faceGeometry =
    geometry.geometry;

  const horizontallyCentered =
    faceGeometry !== null
    && Math.abs(
      faceGeometry.centerNormalized.x
      - NORMALIZED_COORDINATE.CENTER
    )
      <= FACE_POSITION_THRESHOLDS
        .MAX_CENTER_OFFSET_X_RATIO;

  const verticallyCentered =
    faceGeometry !== null
    && Math.abs(
      faceGeometry.centerNormalized.y
      - NORMALIZED_COORDINATE.CENTER
    )
      <= FACE_POSITION_THRESHOLDS
        .MAX_CENTER_OFFSET_Y_RATIO;

  const brightnessAcceptable =
    cameraQuality !== null
    && Number.isFinite(
      cameraQuality.brightness
    )
    && cameraQuality.brightness
      >= CAMERA_QUALITY_THRESHOLDS
        .MIN_BRIGHTNESS
    && cameraQuality.brightness
      <= CAMERA_QUALITY_THRESHOLDS
        .MAX_BRIGHTNESS;

  return {
    faceDetected:
      geometry.faceDetected,

    bothEyesVisible:
      eyes.bothEyesValid,

    horizontallyCentered,
    verticallyCentered,

    distanceAcceptable:
      isDistanceAcceptable(
        geometry,
        faceDistanceRatio,
        baseline
      ),

    headPoseAcceptable:
      isHeadPoseAcceptable(
        headPose.headPose
      ),

    brightnessAcceptable,
    stable
  };
}

function calculatePositionScore(
  status: FacePositionStatus
): number {
  const checks = [
    status.horizontallyCentered,
    status.verticallyCentered,
    status.distanceAcceptable,
    status.headPoseAcceptable
  ];

  let passed = 0;

  for (const check of checks) {
    if (check) {
      passed += 1;
    }
  }

  return passed / checks.length;
}

function cameraQualityToScore(
  quality: CameraQuality | null
): number {
  if (quality === null) {
    return FACE_QUALITY_RUNTIME
      .CAMERA_INVALID_SCORE;
  }

  switch (quality.quality) {
    case "GOOD":
      return FACE_QUALITY_RUNTIME
        .CAMERA_GOOD_SCORE;

    case "FAIR":
      return FACE_QUALITY_RUNTIME
        .CAMERA_FAIR_SCORE;

    case "POOR":
      return FACE_QUALITY_RUNTIME
        .CAMERA_POOR_SCORE;

    case "INVALID":
      return FACE_QUALITY_RUNTIME
        .CAMERA_INVALID_SCORE;
  }
}

function framesMatch(
  input: FaceQualityEvaluationInput
): boolean {
  const sequence =
    input.landmarker.frameSequence;

  const timestamp =
    input.landmarker.timestampMs;

  return (
    input.geometry.frameSequence
      === sequence
    && input.headPose.frameSequence
      === sequence
    && input.eyes.frameSequence
      === sequence
    && input.blink.frameSequence
      === sequence
    && input.geometry.timestampMs
      === timestamp
    && input.headPose.timestampMs
      === timestamp
    && input.eyes.timestampMs
      === timestamp
    && input.blink.timestampMs
      === timestamp
  );
}

/* ========================================================================== 
 * Evaluator
 * ======================================================================== */

/**
 * Combines the transient face/eye pipeline outputs into one quality decision.
 *
 * The evaluator is stateful only for the pre-calibration stability timer.
 * It does not retain landmarks, images or webcam frames.
 */
export class FaceQualityEvaluator {
  private stableCandidateStartedAtMs:
    TimestampMs | null =
      null;

  private lastTimestampMs:
    TimestampMs | null =
      null;

  public evaluate(
    input: FaceQualityEvaluationInput
  ): FaceQualityFrameResult {
    const baseline =
      input.baseline ?? null;

    if (!framesMatch(input)) {
      this.resetStability();

      return this.createFrameMismatchResult(
        input.landmarker
      );
    }

    if (
      this.lastTimestampMs !== null
      && input.landmarker.timestampMs
        < this.lastTimestampMs
    ) {
      this.resetStability();
    }

    this.lastTimestampMs =
      input.landmarker.timestampMs;

    const faceConfidence =
      calculateFaceConfidence(
        input.landmarker,
        input.geometry,
        input.headPose
      );

    const eyeConfidence =
      calculateEyeConfidence(
        input.eyes
      );

    const currentBlink =
      input.blink.bothEyesClosed
      || input.blink.blinkInProgress;

    const leftEyeVisible =
      input.eyes.leftEyeValid;

    const rightEyeVisible =
      input.eyes.rightEyeValid;

    const eyeGeometryPlausible =
      isEyeGeometryPlausible(
        input.eyes.leftEye
      )
      && isEyeGeometryPlausible(
        input.eyes.rightEye
      );

    const faceValid =
      input.landmarker.faceDetected
      && input.geometry.geometryValid
      && input.headPose.poseValid
      && faceConfidence
        >= FACE_QUALITY_THRESHOLDS
          .MIN_FACE_CONFIDENCE;

    const eyesValid =
      input.eyes.bothEyesValid
      && eyeGeometryPlausible
      && eyeConfidence
        >= FACE_QUALITY_THRESHOLDS
          .MIN_EYE_CONFIDENCE
      && !currentBlink
      && !input.blink.asymmetricClosure;

    const faceDistanceRatio =
      calculateFaceDistanceRatio(
        input.geometry,
        baseline
      );

    const provisionalPosition =
      calculatePositionStatus(
        input.geometry,
        input.headPose,
        input.eyes,
        input.cameraQuality,
        faceDistanceRatio,
        baseline,
        false
      );

    const stableCandidate =
      faceValid
      && eyesValid
      && provisionalPosition
        .horizontallyCentered
      && provisionalPosition
        .verticallyCentered
      && provisionalPosition
        .distanceAcceptable
      && provisionalPosition
        .headPoseAcceptable
      && provisionalPosition
        .brightnessAcceptable;

    const stable =
      this.updateStability(
        input.landmarker.timestampMs,
        stableCandidate
      );

    const positionStatus =
      calculatePositionStatus(
        input.geometry,
        input.headPose,
        input.eyes,
        input.cameraQuality,
        faceDistanceRatio,
        baseline,
        stable
      );

    const headPoseScore =
      calculateHeadPoseScore(
        input.headPose
      );

    const positionScore =
      calculatePositionScore(
        positionStatus
      );

    const cameraScore =
      cameraQualityToScore(
        input.cameraQuality
      );

    let qualityScore =
      faceConfidence
        * FACE_QUALITY_RUNTIME
          .FACE_SCORE_WEIGHT
      + eyeConfidence
        * FACE_QUALITY_RUNTIME
          .EYE_SCORE_WEIGHT
      + headPoseScore
        * FACE_QUALITY_RUNTIME
          .HEAD_POSE_SCORE_WEIGHT
      + positionScore
        * FACE_QUALITY_RUNTIME
          .POSITION_SCORE_WEIGHT
      + cameraScore
        * FACE_QUALITY_RUNTIME
          .CAMERA_SCORE_WEIGHT;

    if (currentBlink) {
      qualityScore *=
        FACE_QUALITY_RUNTIME
          .BLINK_SCORE_MULTIPLIER;
    } else if (
      input.blink.asymmetricClosure
    ) {
      qualityScore *=
        FACE_QUALITY_RUNTIME
          .ASYMMETRIC_CLOSURE_SCORE_MULTIPLIER;
    }

    qualityScore =
      clamp01(qualityScore);

    const structurallyValid =
      faceValid
      && eyesValid;

    const qualityLevel =
      classifyQualityLevel(
        qualityScore,
        structurallyValid
      );

    const headPose =
      input.headPose.headPose
      ?? ZERO_HEAD_POSE;

    const trackingQuality:
    FaceTrackingQuality = {
      faceValid,
      eyesValid,

      leftEyeVisible,
      rightEyeVisible,

      blink: currentBlink,

      faceConfidence,
      eyeConfidence,

      faceDistanceRatio,

      headPose,

      qualityScore,
      qualityLevel
    };

    const issues =
      this.collectIssues(
        input,
        positionStatus,
        eyeGeometryPlausible
      );

    return {
      frameSequence:
        input.landmarker.frameSequence,

      timestampMs:
        input.landmarker.timestampMs,

      trackingQuality,
      positionStatus,

      usableForGaze:
        structurallyValid
        && qualityLevel
          !== "INVALID",

      issues
    };
  }

  public reset(): void {
    this.resetStability();
    this.lastTimestampMs = null;
  }

  private updateStability(
    timestampMs: TimestampMs,
    validCandidate: boolean
  ): boolean {
    if (!validCandidate) {
      this.stableCandidateStartedAtMs =
        null;

      return false;
    }

    if (
      this.stableCandidateStartedAtMs
      === null
    ) {
      this.stableCandidateStartedAtMs =
        timestampMs;

      return false;
    }

    return (
      timestampMs
      - this.stableCandidateStartedAtMs
      >= FACE_POSITION_THRESHOLDS
        .REQUIRED_STABLE_DURATION_MS
    );
  }

  private resetStability(): void {
    this.stableCandidateStartedAtMs =
      null;
  }

  private collectIssues(
    input: FaceQualityEvaluationInput,
    status: FacePositionStatus,
    eyeGeometryPlausible: boolean
  ): readonly FaceQualityIssue[] {
    const issues:
      FaceQualityIssue[] = [];

    if (!input.landmarker.faceDetected) {
      issues.push("NO_FACE");
    }

    if (!input.geometry.geometryValid) {
      issues.push(
        "FACE_GEOMETRY_INVALID"
      );
    }

    if (!input.headPose.poseValid) {
      issues.push("HEAD_POSE_INVALID");
    } else if (!status.headPoseAcceptable) {
      issues.push("HEAD_POSE_EXCESSIVE");
    }

    if (!input.eyes.leftEyeValid) {
      issues.push("LEFT_EYE_INVALID");
    }

    if (!input.eyes.rightEyeValid) {
      issues.push("RIGHT_EYE_INVALID");
    }

    if (
      input.eyes.bothEyesValid
      && !eyeGeometryPlausible
    ) {
      issues.push(
        "EYE_GEOMETRY_IMPLAUSIBLE"
      );
    }

    if (
      input.blink.bothEyesClosed
      || input.blink.blinkInProgress
    ) {
      issues.push("BLINK_IN_PROGRESS");
    }

    if (input.blink.asymmetricClosure) {
      issues.push(
        "ASYMMETRIC_EYE_CLOSURE"
      );
    }

    if (
      !status.horizontallyCentered
      || !status.verticallyCentered
    ) {
      issues.push("FACE_NOT_CENTERED");
    }

    if (!status.distanceAcceptable) {
      issues.push(
        "FACE_DISTANCE_INVALID"
      );
    }

    if (!status.brightnessAcceptable) {
      issues.push("LIGHTING_INVALID");
    }

    if (
      input.cameraQuality === null
      || input.cameraQuality.quality
        === "INVALID"
    ) {
      issues.push(
        "CAMERA_QUALITY_INVALID"
      );
    }

    return issues;
  }

  private createFrameMismatchResult(
    landmarker: FaceLandmarkerFrameResult
  ): FaceQualityFrameResult {
    const trackingQuality:
    FaceTrackingQuality = {
      faceValid: false,
      eyesValid: false,

      leftEyeVisible: false,
      rightEyeVisible: false,

      blink: false,

      faceConfidence: 0,
      eyeConfidence: 0,

      faceDistanceRatio: 0,

      headPose:
        ZERO_HEAD_POSE,

      qualityScore: 0,
      qualityLevel: "INVALID"
    };

    const positionStatus:
    FacePositionStatus = {
      faceDetected:
        landmarker.faceDetected,

      bothEyesVisible: false,

      horizontallyCentered: false,
      verticallyCentered: false,

      distanceAcceptable: false,
      headPoseAcceptable: false,
      brightnessAcceptable: false,

      stable: false
    };

    return {
      frameSequence:
        landmarker.frameSequence,

      timestampMs:
        landmarker.timestampMs,

      trackingQuality,
      positionStatus,
      usableForGaze: false,
      issues: ["FRAME_MISMATCH"]
    };
  }
}
