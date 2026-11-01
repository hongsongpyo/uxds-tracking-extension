import {
  CAMERA_QUALITY_THRESHOLDS,
  FACE_POSITION_THRESHOLDS,
  FACE_QUALITY_RUNTIME,
  NORMALIZED_COORDINATE,
  PRE_CALIBRATION_RUNTIME
} from "../shared/constants";

import {
  clamp01
} from "../shared/utils";

import type {
  CameraQuality,
  FaceBaseline,
  FacePositionInstruction,
  PreCalibrationFeedback,
  TimestampMs
} from "../shared/types";

import type {
  FaceGeometryFrameResult
} from "../face/faceGeometry";

import type {
  HeadPoseFrameResult
} from "../face/headPose";

import type {
  FaceQualityFrameResult
} from "../face/faceQuality";

/* ========================================================================== 
 * Public contracts
 * ======================================================================== */

export interface PreCalibrationFrameInput {
  readonly geometry:
    FaceGeometryFrameResult;

  readonly headPose:
    HeadPoseFrameResult;

  readonly quality:
    FaceQualityFrameResult;

  readonly cameraQuality:
    CameraQuality | null;
}

export interface PreCalibrationFrameResult {
  readonly feedback:
    PreCalibrationFeedback;

  /**
   * Latest robust baseline captured from a completed stable interval.
   * Null until the participant has held a valid pose long enough.
   */
  readonly baseline:
    FaceBaseline | null;

  /**
   * True only on the frame where a new baseline is committed.
   */
  readonly baselineCaptured:
    boolean;
}

/* ========================================================================== 
 * Internal baseline observation
 * ======================================================================== */

interface BaselineObservation {
  readonly centerX: number;
  readonly centerY: number;

  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly proximityProxy: number;

  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function median(
  values: readonly number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (first, second) =>
        first - second
    );

  const middle =
    Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  const lower =
    sorted[middle - 1] ?? 0;

  const upper =
    sorted[middle] ?? lower;

  return (lower + upper) / 2;
}

function cloneBaseline(
  baseline: FaceBaseline | null
): FaceBaseline | null {
  if (baseline === null) {
    return null;
  }

  return {
    ...baseline,
    headPose: {
      ...baseline.headPose
    }
  };
}

function isStableCandidate(
  input: PreCalibrationFrameInput
): boolean {
  const status =
    input.quality.positionStatus;

  const tracking =
    input.quality.trackingQuality;

  return (
    tracking.faceValid
    && tracking.eyesValid
    && !tracking.blink
    && status.faceDetected
    && status.bothEyesVisible
    && status.horizontallyCentered
    && status.verticallyCentered
    && status.distanceAcceptable
    && status.headPoseAcceptable
    && status.brightnessAcceptable
  );
}

function createObservation(
  input: PreCalibrationFrameInput
): BaselineObservation | null {
  const geometry =
    input.geometry.geometry;

  const pose =
    input.headPose.headPose;

  if (
    geometry === null
    || pose === null
  ) {
    return null;
  }

  const values = [
    geometry.centerNormalized.x,
    geometry.centerNormalized.y,
    geometry.widthRatio,
    geometry.heightRatio,
    geometry.proximityProxy,
    pose.yawDeg,
    pose.pitchDeg,
    pose.rollDeg
  ];

  if (
    values.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    return null;
  }

  return {
    centerX:
      geometry.centerNormalized.x,

    centerY:
      geometry.centerNormalized.y,

    widthRatio:
      geometry.widthRatio,

    heightRatio:
      geometry.heightRatio,

    proximityProxy:
      geometry.proximityProxy,

    yawDeg:
      pose.yawDeg,

    pitchDeg:
      pose.pitchDeg,

    rollDeg:
      pose.rollDeg
  };
}

function createBaseline(
  observations:
    readonly BaselineObservation[]
): FaceBaseline {
  return {
    centerX:
      median(
        observations.map(
          (item) => item.centerX
        )
      ),

    centerY:
      median(
        observations.map(
          (item) => item.centerY
        )
      ),

    width:
      median(
        observations.map(
          (item) => item.widthRatio
        )
      ),

    height:
      median(
        observations.map(
          (item) => item.heightRatio
        )
      ),

    headPose: {
      yawDeg:
        median(
          observations.map(
            (item) => item.yawDeg
          )
        ),

      pitchDeg:
        median(
          observations.map(
            (item) => item.pitchDeg
          )
        ),

      rollDeg:
        median(
          observations.map(
            (item) => item.rollDeg
          )
        )
    },

    /**
     * The baseline itself defines the neutral relative-distance value 1.0.
     * Absolute camera-space size remains represented by width/height.
     */
    distanceRatio: 1
  };
}

function determineInstruction(
  input: PreCalibrationFrameInput,
  stableProgress: number,
  readyForCalibration: boolean
): FacePositionInstruction {
  if (readyForCalibration) {
    return "READY";
  }

  const status =
    input.quality.positionStatus;

  const geometry =
    input.geometry.geometry;

  if (
    !status.faceDetected
    || geometry === null
  ) {
    return "FIND_FACE";
  }

  if (!status.bothEyesVisible) {
    return "SHOW_BOTH_EYES";
  }

  const brightness =
    input.cameraQuality?.brightness
    ?? null;

  if (
    brightness === null
    || brightness
      < CAMERA_QUALITY_THRESHOLDS
        .MIN_BRIGHTNESS
  ) {
    return "IMPROVE_LIGHTING";
  }

  if (
    brightness
      > CAMERA_QUALITY_THRESHOLDS
        .MAX_BRIGHTNESS
  ) {
    return "REDUCE_LIGHTING";
  }

  if (!status.distanceAcceptable) {
    const tooFar =
      geometry.widthRatio
        < FACE_QUALITY_RUNTIME
          .MIN_PRECALIBRATION_FACE_WIDTH_RATIO
      || geometry.heightRatio
        < FACE_QUALITY_RUNTIME
          .MIN_PRECALIBRATION_FACE_HEIGHT_RATIO;

    return tooFar
      ? "MOVE_CLOSER"
      : "MOVE_FARTHER";
  }

  if (!status.horizontallyCentered) {
    /**
     * Mirror camera X so the instruction follows the selfie-view overlay.
     */
    const mirroredCenterX =
      1 - geometry.centerNormalized.x;

    return mirroredCenterX
      < NORMALIZED_COORDINATE.CENTER
      ? "MOVE_RIGHT"
      : "MOVE_LEFT";
  }

  if (!status.verticallyCentered) {
    return geometry.centerNormalized.y
      < NORMALIZED_COORDINATE.CENTER
      ? "MOVE_DOWN"
      : "MOVE_UP";
  }

  if (!status.headPoseAcceptable) {
    return "FACE_FORWARD";
  }

  if (stableProgress < 1) {
    return "HOLD_STEADY";
  }

  return "HOLD_STEADY";
}

/* ========================================================================== 
 * Monitor
 * ======================================================================== */

/**
 * Converts the continuous face/eye quality stream into participant-facing
 * pre-calibration guidance and a robust multi-frame face baseline.
 *
 * No image, eye crop, or landmark array is retained.
 */
export class PreCalibrationMonitor {
  private stableCandidateStartedAtMs:
    TimestampMs | null =
      null;

  private observations:
    BaselineObservation[] = [];

  private baseline:
    FaceBaseline | null =
      null;

  private baselineCapturedForCurrentStableInterval =
    false;

  /**
   * Completion is latched after the first valid baseline capture.
   * A later blink or small pose deviation must not restart pre-calibration.
   * The latch is cleared only by an explicit reset() for a new run.
   */
  private completed =
    false;

  private lastTimestampMs:
    TimestampMs | null =
      null;

  public evaluate(
    input: PreCalibrationFrameInput
  ): PreCalibrationFrameResult {
    const timestampMs =
      input.quality.timestampMs;

    if (
      this.lastTimestampMs !== null
      && timestampMs < this.lastTimestampMs
    ) {
      this.resetStableCandidate();
    }

    this.lastTimestampMs =
      timestampMs;

    /**
     * Once a robust baseline has been committed, pre-calibration is complete.
     * Keep the result latched even if a later frame contains a blink, temporary
     * face-quality dip, or minor pose deviation. Calibration itself will apply
     * its own per-sample quality gates.
     */
    if (
      this.completed
      && this.baseline !== null
    ) {
      const geometry =
        input.geometry.geometry;

      const pose =
        input.headPose.headPose;

      return {
        feedback: {
          status: {
            ...input.quality.positionStatus,
            stable: true
          },

          instruction: "READY",
          readyForCalibration: true,

          cameraFaceBoxNormalized:
            geometry === null
              ? null
              : {
                  left:
                    geometry.boundsNormalized.left,
                  top:
                    geometry.boundsNormalized.top,
                  width:
                    geometry.boundsNormalized.width,
                  height:
                    geometry.boundsNormalized.height
                },

          metrics: {
            centerX:
              geometry?.centerNormalized.x
              ?? null,

            centerY:
              geometry?.centerNormalized.y
              ?? null,

            widthRatio:
              geometry?.widthRatio
              ?? null,

            heightRatio:
              geometry?.heightRatio
              ?? null,

            proximityProxy:
              geometry?.proximityProxy
              ?? null,

            yawDeg:
              pose?.yawDeg
              ?? null,

            pitchDeg:
              pose?.pitchDeg
              ?? null,

            rollDeg:
              pose?.rollDeg
              ?? null,

            brightness:
              input.cameraQuality
                ?.brightness
              ?? null,

            stableDurationMs:
              FACE_POSITION_THRESHOLDS
                .REQUIRED_STABLE_DURATION_MS,

            stableProgress: 1
          }
        },

        baseline:
          cloneBaseline(
            this.baseline
          ),

        baselineCaptured: false
      };
    }

    const stableCandidate =
      isStableCandidate(input);

    let baselineCaptured =
      false;

    if (!stableCandidate) {
      this.resetStableCandidate();
    } else {
      if (
        this.stableCandidateStartedAtMs
        === null
      ) {
        this.stableCandidateStartedAtMs =
          timestampMs;
      }

      const observation =
        createObservation(input);

      if (observation !== null) {
        this.observations.push(
          observation
        );

        if (
          this.observations.length
          > PRE_CALIBRATION_RUNTIME
            .MAX_BASELINE_SAMPLE_COUNT
        ) {
          this.observations.shift();
        }
      }
    }

    const stableDurationMs =
      stableCandidate
      && this.stableCandidateStartedAtMs
        !== null
        ? Math.max(
            0,
            timestampMs
              - this.stableCandidateStartedAtMs
          )
        : 0;

    const stableProgress =
      clamp01(
        stableDurationMs
        / FACE_POSITION_THRESHOLDS
          .REQUIRED_STABLE_DURATION_MS
      );

    const baselineReady =
      stableCandidate
      && stableProgress >= 1
      && this.observations.length
        >= PRE_CALIBRATION_RUNTIME
          .MIN_BASELINE_SAMPLE_COUNT;

    if (
      baselineReady
      && !this.baselineCapturedForCurrentStableInterval
    ) {
      this.baseline =
        createBaseline(
          this.observations
        );

      this.baselineCapturedForCurrentStableInterval =
        true;

      this.completed =
        true;

      baselineCaptured =
        true;
    }

    const readyForCalibration =
      baselineReady
      && this.baseline !== null;

    const geometry =
      input.geometry.geometry;

    const pose =
      input.headPose.headPose;

    const feedback:
      PreCalibrationFeedback = {
        status: {
          ...input.quality.positionStatus,
          stable:
            readyForCalibration
        },

        instruction:
          determineInstruction(
            input,
            stableProgress,
            readyForCalibration
          ),

        readyForCalibration,

        cameraFaceBoxNormalized:
          geometry === null
            ? null
            : {
                left:
                  geometry.boundsNormalized.left,
                top:
                  geometry.boundsNormalized.top,
                width:
                  geometry.boundsNormalized.width,
                height:
                  geometry.boundsNormalized.height
              },

        metrics: {
          centerX:
            geometry?.centerNormalized.x
            ?? null,

          centerY:
            geometry?.centerNormalized.y
            ?? null,

          widthRatio:
            geometry?.widthRatio
            ?? null,

          heightRatio:
            geometry?.heightRatio
            ?? null,

          proximityProxy:
            geometry?.proximityProxy
            ?? null,

          yawDeg:
            pose?.yawDeg
            ?? null,

          pitchDeg:
            pose?.pitchDeg
            ?? null,

          rollDeg:
            pose?.rollDeg
            ?? null,

          brightness:
            input.cameraQuality
              ?.brightness
            ?? null,

          stableDurationMs,
          stableProgress
        }
      };

    return {
      feedback,
      baseline:
        cloneBaseline(
          this.baseline
        ),
      baselineCaptured
    };
  }

  public getBaseline():
  FaceBaseline | null {
    return cloneBaseline(
      this.baseline
    );
  }

  public reset(): void {
    this.resetStableCandidate();

    this.baseline =
      null;

    this.baselineCapturedForCurrentStableInterval =
      false;

    this.completed =
      false;

    this.lastTimestampMs =
      null;
  }

  private resetStableCandidate(): void {
    this.stableCandidateStartedAtMs =
      null;

    this.observations = [];

    this.baselineCapturedForCurrentStableInterval =
      false;
  }
}
