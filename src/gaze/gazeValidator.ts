import {
  GAZE_QUALITY_THRESHOLDS,
  GAZE_VALIDATION_DEFAULTS,
  NORMALIZED_COORDINATE
} from "../shared/constants";

import type {
  CoordinateSpace,
  GazePrediction,
  Point2D,
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Validation issue model
 * ======================================================================== */

export type GazeValidationIssueCode =
  | "TIMESTAMP_NON_FINITE"
  | "TIMESTAMP_NEGATIVE"
  | "TIMESTAMP_MISMATCH"
  | "RAW_POINT_NON_FINITE"
  | "RAW_SPACE_UNSUPPORTED"
  | "NORMALIZED_OUTSIDE_VIEWPORT"
  | "NORMALIZED_IMPLAUSIBLE"
  | "CONFIDENCE_NON_FINITE"
  | "CONFIDENCE_OUT_OF_RANGE"
  | "CONFIDENCE_TOO_LOW"
  | "FACE_INVALID"
  | "EYES_INVALID"
  | "HEAD_POSE_NON_FINITE";

export interface GazeValidationIssue {
  readonly code: GazeValidationIssueCode;

  /**
   * Fatal issues make the sample unsuitable for downstream research use.
   * Non-fatal issues are retained as diagnostics/context only.
   */
  readonly fatal: boolean;
}

export interface GazeValidationContext {
  /**
   * Capture timestamp expected for this prediction. When supplied, the
   * validator confirms that the gaze engine preserved the shared timeline.
   */
  readonly expectedTimestampMs?: TimestampMs;
}

export interface GazeValidationResult {
  /**
   * True only when no fatal validation issue was detected.
   */
  readonly valid: boolean;

  /**
   * True when a NORMALIZED raw point is within the visible 0..1 viewport.
   * `null` means the raw engine coordinate space is not NORMALIZED.
   */
  readonly insideNormalizedViewport: boolean | null;

  readonly issues: readonly GazeValidationIssue[];
}

/* ========================================================================== 
 * Primitive guards
 * ======================================================================== */

const SUPPORTED_COORDINATE_SPACES:
  ReadonlySet<CoordinateSpace> =
    new Set<CoordinateSpace>([
      "MODEL",
      "NORMALIZED",
      "VIEWPORT",
      "DOCUMENT",
      "SCREEN"
    ]);

function isFinitePoint(
  point: Point2D
): boolean {
  return (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function isFiniteHeadPose(
  prediction: GazePrediction
): boolean {
  return (
    Number.isFinite(prediction.headPose.yawDeg)
    && Number.isFinite(prediction.headPose.pitchDeg)
    && Number.isFinite(prediction.headPose.rollDeg)
  );
}

function isRuntimeCoordinateSpace(
  value: unknown
): value is CoordinateSpace {
  return (
    typeof value === "string"
    && SUPPORTED_COORDINATE_SPACES.has(
      value as CoordinateSpace
    )
  );
}

function normalizedPointInsideViewport(
  point: Point2D
): boolean {
  return (
    point.x >= NORMALIZED_COORDINATE.MIN
    && point.x <= NORMALIZED_COORDINATE.MAX
    && point.y >= NORMALIZED_COORDINATE.MIN
    && point.y <= NORMALIZED_COORDINATE.MAX
  );
}

function normalizedPointPlausible(
  point: Point2D
): boolean {
  const minimum =
    NORMALIZED_COORDINATE.MIN
    - GAZE_VALIDATION_DEFAULTS
      .NORMALIZED_OVERSCAN_MARGIN;

  const maximum =
    NORMALIZED_COORDINATE.MAX
    + GAZE_VALIDATION_DEFAULTS
      .NORMALIZED_OVERSCAN_MARGIN;

  return (
    point.x >= minimum
    && point.x <= maximum
    && point.y >= minimum
    && point.y <= maximum
  );
}

function timestampsMatch(
  actual: TimestampMs,
  expected: TimestampMs
): boolean {
  return (
    Math.abs(actual - expected)
    <= GAZE_VALIDATION_DEFAULTS
      .TIMESTAMP_TOLERANCE_MS
  );
}

/* ========================================================================== 
 * Validator
 * ======================================================================== */

/**
 * Validates one raw gaze-engine prediction without modifying it.
 *
 * Design rules:
 * - raw coordinates are never clamped or rewritten here;
 * - a small NORMALIZED overshoot beyond 0..1 remains usable and is reported
 *   as a non-fatal outside-viewport issue;
 * - malformed/non-finite/extreme output is rejected;
 * - low engine confidence follows the central MIN_VALID policy;
 * - calibration, residual correction, smoothing and final gaze-quality
 *   scoring belong to their own downstream modules.
 */
export function validateGazePrediction(
  prediction: GazePrediction,
  context: GazeValidationContext = {}
): GazeValidationResult {
  const issues: GazeValidationIssue[] = [];

  if (!Number.isFinite(prediction.timestampMs)) {
    issues.push({
      code: "TIMESTAMP_NON_FINITE",
      fatal: true
    });
  } else {
    if (prediction.timestampMs < 0) {
      issues.push({
        code: "TIMESTAMP_NEGATIVE",
        fatal: true
      });
    }

    if (
      context.expectedTimestampMs !== undefined
      && Number.isFinite(
        context.expectedTimestampMs
      )
      && !timestampsMatch(
        prediction.timestampMs,
        context.expectedTimestampMs
      )
    ) {
      issues.push({
        code: "TIMESTAMP_MISMATCH",
        fatal: true
      });
    }
  }

  const finiteRawPoint =
    isFinitePoint(prediction.rawPoint);

  if (!finiteRawPoint) {
    issues.push({
      code: "RAW_POINT_NON_FINITE",
      fatal: true
    });
  }

  const rawSpaceValid =
    isRuntimeCoordinateSpace(
      prediction.rawSpace
    );

  if (!rawSpaceValid) {
    issues.push({
      code: "RAW_SPACE_UNSUPPORTED",
      fatal: true
    });
  }

  let insideNormalizedViewport:
    boolean | null = null;

  if (
    finiteRawPoint
    && rawSpaceValid
    && prediction.rawSpace === "NORMALIZED"
  ) {
    insideNormalizedViewport =
      normalizedPointInsideViewport(
        prediction.rawPoint
      );

    if (!insideNormalizedViewport) {
      issues.push({
        code: "NORMALIZED_OUTSIDE_VIEWPORT",
        fatal: false
      });
    }

    if (
      !normalizedPointPlausible(
        prediction.rawPoint
      )
    ) {
      issues.push({
        code: "NORMALIZED_IMPLAUSIBLE",
        fatal: true
      });
    }
  }

  if (!Number.isFinite(prediction.confidence)) {
    issues.push({
      code: "CONFIDENCE_NON_FINITE",
      fatal: true
    });
  } else if (
    prediction.confidence < 0
    || prediction.confidence > 1
  ) {
    issues.push({
      code: "CONFIDENCE_OUT_OF_RANGE",
      fatal: true
    });
  } else if (
    prediction.confidence
      < GAZE_QUALITY_THRESHOLDS.MIN_VALID
  ) {
    issues.push({
      code: "CONFIDENCE_TOO_LOW",
      fatal: true
    });
  }

  if (!prediction.faceValid) {
    issues.push({
      code: "FACE_INVALID",
      fatal: true
    });
  }

  if (!prediction.eyesValid) {
    issues.push({
      code: "EYES_INVALID",
      fatal: true
    });
  }

  if (!isFiniteHeadPose(prediction)) {
    issues.push({
      code: "HEAD_POSE_NON_FINITE",
      fatal: true
    });
  }

  return {
    valid:
      !issues.some(
        (issue) => issue.fatal
      ),

    insideNormalizedViewport,

    issues
  };
}
