import {
  GAZE_QUALITY_RUNTIME,
  GAZE_QUALITY_THRESHOLDS,
  GAZE_VALIDATION_DEFAULTS
} from "../shared/constants";

import {
  clamp01
} from "../shared/utils";

import type {
  DataQualityLevel,
  GazePrediction,
  TimestampMs
} from "../shared/types";

import type {
  FaceQualityFrameResult
} from "../face/faceQuality";

import type {
  GazeValidationResult
} from "./gazeValidator";

/* ========================================================================== 
 * Public model
 * ======================================================================== */

export type GazeQualityIssueCode =
  | "VALIDATION_INVALID"
  | "FACE_PIPELINE_UNUSABLE"
  | "FACE_PIPELINE_INVALID"
  | "BLINK_IN_PROGRESS"
  | "FRAME_TIMESTAMP_MISMATCH"
  | "FACE_VALIDITY_MISMATCH"
  | "EYE_VALIDITY_MISMATCH"
  | "ENGINE_CONFIDENCE_NON_FINITE"
  | "FACE_QUALITY_NON_FINITE"
  | "QUALITY_SCORE_NON_FINITE"
  | "QUALITY_SCORE_TOO_LOW";

export interface GazeQualityIssue {
  readonly code: GazeQualityIssueCode;
  readonly fatal: boolean;
}

export interface GazeQualityComponents {
  /**
   * Confidence emitted by the active gaze engine after that engine's own
   * model-specific normalization.
   */
  readonly engineConfidence: number;

  /**
   * Existing FaceQuality composite. It already includes face, eye, head-pose,
   * positioning, camera-quality and blink information.
   */
  readonly facePipelineQuality: number;

  /**
   * Exposed separately for diagnostics. These values are already represented
   * inside `facePipelineQuality` and are therefore not weighted again.
   */
  readonly faceConfidence: number;
  readonly eyeConfidence: number;
}

export interface GazeQualityEvaluationInput {
  readonly prediction: GazePrediction;
  readonly validation: GazeValidationResult;
  readonly faceQuality: FaceQualityFrameResult;
}

export interface GazeQualityResult {
  readonly timestampMs: TimestampMs;

  /**
   * Final research-use decision. A high numeric score cannot make a sample
   * valid when its structural validation or face pipeline is invalid.
   */
  readonly valid: boolean;

  /** Final normalized quality score in the closed interval [0, 1]. */
  readonly score: number;

  readonly level: DataQualityLevel;

  readonly components: GazeQualityComponents;
  readonly issues: readonly GazeQualityIssue[];
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function timestampsMatch(
  predictionTimestampMs: TimestampMs,
  faceTimestampMs: TimestampMs
): boolean {
  return (
    Number.isFinite(predictionTimestampMs)
    && Number.isFinite(faceTimestampMs)
    && Math.abs(
      predictionTimestampMs
      - faceTimestampMs
    )
      <= GAZE_VALIDATION_DEFAULTS
        .TIMESTAMP_TOLERANCE_MS
  );
}

function classifyQualityLevel(
  score: number,
  structurallyValid: boolean
): DataQualityLevel {
  if (
    !structurallyValid
    || !Number.isFinite(score)
    || score
      < GAZE_QUALITY_THRESHOLDS.MIN_VALID
  ) {
    return "INVALID";
  }

  if (
    score >= GAZE_QUALITY_THRESHOLDS.GOOD
  ) {
    return "GOOD";
  }

  if (
    score >= GAZE_QUALITY_THRESHOLDS.FAIR
  ) {
    return "FAIR";
  }

  if (
    score >= GAZE_QUALITY_THRESHOLDS.POOR
  ) {
    return "POOR";
  }

  return "INVALID";
}

function calculateWeightedScore(
  engineConfidence: number,
  facePipelineQuality: number
): number {
  if (
    !Number.isFinite(engineConfidence)
    || !Number.isFinite(facePipelineQuality)
  ) {
    return 0;
  }

  const score =
    clamp01(engineConfidence)
      * GAZE_QUALITY_RUNTIME
        .ENGINE_CONFIDENCE_WEIGHT
    + clamp01(facePipelineQuality)
      * GAZE_QUALITY_RUNTIME
        .FACE_PIPELINE_WEIGHT;

  return clamp01(score);
}

/* ========================================================================== 
 * Evaluator
 * ======================================================================== */

/**
 * Produces the final per-prediction gaze-quality score without modifying the
 * raw gaze prediction.
 *
 * Quality composition deliberately has two independent inputs:
 * 1. gaze-engine confidence; and
 * 2. the already-computed FaceQuality pipeline composite.
 *
 * The FaceQuality composite is reused as-is because it already accounts for
 * face/eye geometry, head pose, face position, camera quality and blink
 * penalties. Re-weighting those same signals here would count them twice.
 *
 * Structural validity always wins over the numeric score: an invalid gaze
 * prediction, blink frame, mismatched frame or unusable face pipeline remains
 * INVALID even if the weighted score happens to be high.
 */
export function evaluateGazeQuality(
  input: GazeQualityEvaluationInput
): GazeQualityResult {
  const {
    prediction,
    validation,
    faceQuality
  } = input;

  const trackingQuality =
    faceQuality.trackingQuality;

  const issues: GazeQualityIssue[] = [];

  if (!validation.valid) {
    issues.push({
      code: "VALIDATION_INVALID",
      fatal: true
    });
  }

  if (!faceQuality.usableForGaze) {
    issues.push({
      code: "FACE_PIPELINE_UNUSABLE",
      fatal: true
    });
  }

  if (
    trackingQuality.qualityLevel
      === "INVALID"
  ) {
    issues.push({
      code: "FACE_PIPELINE_INVALID",
      fatal: true
    });
  }

  if (trackingQuality.blink) {
    issues.push({
      code: "BLINK_IN_PROGRESS",
      fatal: true
    });
  }

  if (
    !timestampsMatch(
      prediction.timestampMs,
      faceQuality.timestampMs
    )
  ) {
    issues.push({
      code: "FRAME_TIMESTAMP_MISMATCH",
      fatal: true
    });
  }

  if (
    prediction.faceValid
      !== trackingQuality.faceValid
  ) {
    issues.push({
      code: "FACE_VALIDITY_MISMATCH",
      fatal: true
    });
  }

  if (
    prediction.eyesValid
      !== trackingQuality.eyesValid
  ) {
    issues.push({
      code: "EYE_VALIDITY_MISMATCH",
      fatal: true
    });
  }

  if (!Number.isFinite(prediction.confidence)) {
    issues.push({
      code: "ENGINE_CONFIDENCE_NON_FINITE",
      fatal: true
    });
  }

  if (
    !Number.isFinite(
      trackingQuality.qualityScore
    )
  ) {
    issues.push({
      code: "FACE_QUALITY_NON_FINITE",
      fatal: true
    });
  }

  const score =
    calculateWeightedScore(
      prediction.confidence,
      trackingQuality.qualityScore
    );

  if (!Number.isFinite(score)) {
    issues.push({
      code: "QUALITY_SCORE_NON_FINITE",
      fatal: true
    });
  }

  if (
    score
      < GAZE_QUALITY_THRESHOLDS.MIN_VALID
  ) {
    issues.push({
      code: "QUALITY_SCORE_TOO_LOW",
      fatal: true
    });
  }

  const structurallyValid =
    !issues.some(
      (issue) => issue.fatal
    );

  const level =
    classifyQualityLevel(
      score,
      structurallyValid
    );

  return {
    timestampMs:
      prediction.timestampMs,

    valid:
      structurallyValid
      && level !== "INVALID",

    score,
    level,

    components: {
      engineConfidence:
        Number.isFinite(
          prediction.confidence
        )
          ? clamp01(prediction.confidence)
          : 0,

      facePipelineQuality:
        Number.isFinite(
          trackingQuality.qualityScore
        )
          ? clamp01(
              trackingQuality.qualityScore
            )
          : 0,

      faceConfidence:
        Number.isFinite(
          trackingQuality.faceConfidence
        )
          ? clamp01(
              trackingQuality.faceConfidence
            )
          : 0,

      eyeConfidence:
        Number.isFinite(
          trackingQuality.eyeConfidence
        )
          ? clamp01(
              trackingQuality.eyeConfidence
            )
          : 0
    },

    issues
  };
}
