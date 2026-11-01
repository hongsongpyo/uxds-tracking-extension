import {
  CALIBRATION
} from "../shared/constants";

import {
  createLogger
} from "../shared/logger";

import type {
  CalibrationId,
  CalibrationRawSample,
  CalibrationTarget,
  FaceBaseline,
  FaceTrackingQuality,
  GazePrediction,
  Point2D,
  TimestampMs
} from "../shared/types";

import {
  createCalibrationStabilityProfile,
  getCalibrationBaselineDriftReason,
  selectBestCalibrationCandidateWindow,
  selectBestCalibrationStableWindow
} from "./calibrationStability";

import type {
  CalibrationStabilityMetrics
} from "./calibrationStability";

const logger =
  createLogger("CALIBRATION");

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export type CalibrationCollectionPhase =
  | "IDLE"
  | "SETTLING"
  | "COLLECTING"
  | "READY"
  | "TIMED_OUT";

export type CalibrationSampleRejectionReason =
  | "BEFORE_TARGET"
  | "SETTLING"
  | "UNSUPPORTED_GAZE_SPACE"
  | "GAZE_INVALID"
  | "GAZE_QUALITY_LOW"
  | "FACE_INVALID"
  | "EYES_INVALID"
  | "BLINK"
  | "HEAD_POSE_DRIFT"
  | "FACE_POSITION_DRIFT";

export interface CalibrationObservation {
  readonly prediction: GazePrediction;
  readonly gazeValid: boolean;
  readonly gazeQuality: number;
  readonly face: FaceTrackingQuality;

  /**
   * Current face center in normalized camera coordinates. Optional for test
   * doubles/legacy callers; production calibration supplies it so baseline
   * drift and within-window head/face stability can be evaluated.
   */
  readonly faceCenterNormalized?:
    Point2D | null;
}

export interface CalibrationSampleDecision {
  readonly phase: CalibrationCollectionPhase;
  readonly stored: boolean;
  readonly accepted: boolean;
  readonly rejectionReason:
    CalibrationSampleRejectionReason | null;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
}

export interface CalibrationPointCollection {
  readonly calibrationId: CalibrationId;
  readonly target: CalibrationTarget;
  readonly targetShownAtMs: TimestampMs;
  readonly samples:
    readonly CalibrationRawSample[];
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly rejectionRatio: number;
  readonly phase: CalibrationCollectionPhase;
  readonly sufficient: boolean;

  /** Best accepted stable fixation window found within the candidate period. */
  readonly stability?:
    CalibrationStabilityMetrics | null;
}

export interface CalibrationCollectorSnapshot {
  readonly phase: CalibrationCollectionPhase;
  readonly calibrationId: CalibrationId | null;
  readonly pointIndex: number | null;
  readonly targetShownAtMs: TimestampMs | null;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function isFiniteTimestamp(
  value: number
): boolean {
  return (
    Number.isFinite(value)
    && value >= 0
  );
}

function calculateRejectionRatio(
  accepted: number,
  rejected: number
): number {
  const total = accepted + rejected;

  if (total === 0) {
    return 0;
  }

  return rejected / total;
}

/* ========================================================================== 
 * Collector
 * ======================================================================== */

/**
 * Collects multiple raw gaze observations for one calibration target.
 *
 * The first TARGET_SETTLE_MS are intentionally ignored and are not counted
 * as rejected research samples. After settling, 800-1200 ms of candidate
 * observations are collected. A point may finish at the minimum interval only
 * when a stable sliding window already exists; otherwise collection continues
 * to the maximum interval and the point is retried if no stable window exists.
 */
export class CalibrationCollector {
  private calibrationId:
    CalibrationId | null =
      null;

  private target:
    CalibrationTarget | null =
      null;

  private targetShownAtMs:
    TimestampMs | null =
      null;

  private samples:
    CalibrationRawSample[] = [];

  private acceptedSampleCount = 0;
  private rejectedSampleCount = 0;

  private observedPredictionTimestampsMs: number[] = [];

  private rejectionReasonCounts:
    Partial<Record<CalibrationSampleRejectionReason, number>> = {};

  private faceBaseline:
    FaceBaseline | null = null;

  public beginPoint(
    calibrationId: CalibrationId,
    target: CalibrationTarget,
    targetShownAtMs: TimestampMs,
    faceBaseline: FaceBaseline | null = null
  ): void {
    if (
      calibrationId.length === 0
      || !Number.isInteger(target.pointIndex)
      || target.pointIndex < 0
      || !isFiniteTimestamp(targetShownAtMs)
    ) {
      throw new RangeError(
        "CalibrationCollector.beginPoint() received invalid point metadata."
      );
    }

    this.calibrationId = calibrationId;
    this.target = target;
    this.targetShownAtMs = targetShownAtMs;
    this.samples = [];
    this.acceptedSampleCount = 0;
    this.rejectedSampleCount = 0;
    this.observedPredictionTimestampsMs = [];
    this.rejectionReasonCounts = {};
    this.faceBaseline =
      faceBaseline === null
        ? null
        : {
            ...faceBaseline,
            headPose: {
              ...faceBaseline.headPose
            }
          };
  }

  public observe(
    observation: CalibrationObservation
  ): CalibrationSampleDecision {
    const calibrationId =
      this.calibrationId;

    const target =
      this.target;

    const targetShownAtMs =
      this.targetShownAtMs;

    if (
      calibrationId === null
      || target === null
      || targetShownAtMs === null
    ) {
      return this.createDecision(
        "IDLE",
        false,
        false,
        null
      );
    }

    const timestampMs =
      observation.prediction.timestampMs;

    if (
      timestampMs >= targetShownAtMs
        + CALIBRATION.TARGET_SETTLE_MS
    ) {
      const previousTimestampMs =
        this.observedPredictionTimestampsMs.at(-1);

      if (
        previousTimestampMs === undefined
        || timestampMs > previousTimestampMs
      ) {
        this.observedPredictionTimestampsMs.push(timestampMs);
      }
    }

    if (!isFiniteTimestamp(timestampMs)) {
      return this.storeRejectedObservation(
        observation,
        "GAZE_INVALID"
      );
    }

    const elapsedMs =
      timestampMs - targetShownAtMs;

    if (elapsedMs < 0) {
      return this.createDecision(
        "SETTLING",
        false,
        false,
        "BEFORE_TARGET"
      );
    }

    if (
      elapsedMs
      < CALIBRATION.TARGET_SETTLE_MS
    ) {
      return this.createDecision(
        "SETTLING",
        false,
        false,
        "SETTLING"
      );
    }

    if (
      elapsedMs
      >= this.getAdaptivePointTimeoutMs()
    ) {
      return this.createDecision(
        "TIMED_OUT",
        false,
        false,
        null
      );
    }

    const rejectionReason =
      this.getRejectionReason(
        observation
      );

    if (rejectionReason !== null) {
      return this.storeRejectedObservation(
        observation,
        rejectionReason
      );
    }

    this.samples.push(
      this.createRawSample(
        observation,
        true
      )
    );

    this.acceptedSampleCount += 1;

    return this.createDecision(
      this.getPhaseAt(timestampMs),
      true,
      true,
      null
    );
  }

  public getSnapshot(
    timestampMs?: TimestampMs
  ): CalibrationCollectorSnapshot {
    return {
      phase:
        this.getPhaseAt(
          timestampMs
          ?? this.targetShownAtMs
          ?? 0
        ),

      calibrationId:
        this.calibrationId,

      pointIndex:
        this.target?.pointIndex
        ?? null,

      targetShownAtMs:
        this.targetShownAtMs,

      acceptedSampleCount:
        this.acceptedSampleCount,

      rejectedSampleCount:
        this.rejectedSampleCount
    };
  }

  public finishPoint(
    timestampMs: TimestampMs
  ): CalibrationPointCollection {
    if (
      this.calibrationId === null
      || this.target === null
      || this.targetShownAtMs === null
    ) {
      throw new Error(
        "CalibrationCollector has no active calibration point."
      );
    }

    const phase =
      this.getPhaseAt(timestampMs);

    const rejectionRatio =
      calculateRejectionRatio(
        this.acceptedSampleCount,
        this.rejectedSampleCount
      );

    const stableWindow =
      selectBestCalibrationStableWindow(
        this.samples
      );

    const diagnosticWindow =
      stableWindow
      ?? selectBestCalibrationCandidateWindow(
        this.samples
      );

    const stability =
      diagnosticWindow?.metrics
      ?? null;

    const effectiveSampleRateHz =
      this.getEffectiveObservedSampleRateHz();

    const adaptiveStabilityProfile =
      createCalibrationStabilityProfile(
        this.samples
      );

    logger.info(
      "Calibration point collection diagnostics.",
      {
        pointIndex: this.target.pointIndex,
        phase,
        acceptedSampleCount: this.acceptedSampleCount,
        rejectedSampleCount: this.rejectedSampleCount,
        rejectionRatio,
        rejectionReasonCounts: { ...this.rejectionReasonCounts },
        effectiveBaselineSampleRateHz: effectiveSampleRateHz,
        adaptivePointTimeoutMs: this.getAdaptivePointTimeoutMs(),
        adaptiveStabilityProfile,
        stability
      }
    );

    /*
     * V5 flat diagnostic: Chrome collapses structured Object payloads in copied
     * console logs. Keep a single-line summary so cross-device failures can be
     * diagnosed from pasted text without manually expanding the Object.
     */
    logger.info(
      [
        "[CalibrationPointSummary]",
        `point=${this.target.pointIndex + 1}`,
        `phase=${phase}`,
        `accepted=${this.acceptedSampleCount}`,
        `rejected=${this.rejectedSampleCount}`,
        `rejectionRatio=${rejectionRatio.toFixed(3)}`,
        `baselineHz=${effectiveSampleRateHz === null ? "NA" : effectiveSampleRateHz.toFixed(2)}`,
        `stable=${stability?.stable ?? false}`,
        `failures=${stability?.failureReasons.join(",") || "NONE"}`,
        `dispersion=${stability === null ? "NA" : stability.gazeDispersionRmsNormalized.toFixed(4)}`,
        `velocity=${stability === null ? "NA" : stability.gazeVelocityRmsNormalizedPerSecond.toFixed(3)}`,
        `inlierRatio=${stability === null ? "NA" : stability.spatialInlierRatio.toFixed(3)}`,
        `stableSamples=${stability?.sampleCount ?? 0}`,
        `requiredStableSamples=${adaptiveStabilityProfile.minSampleCount}`,
        `windowMs=${Math.round(adaptiveStabilityProfile.windowMs)}`,
        `maxGapMs=${Math.round(adaptiveStabilityProfile.maxFrameGapMs)}`
      ].join(" ")
    );

    const sufficient =
      this.acceptedSampleCount
        >= CALIBRATION
          .MIN_ACCEPTED_SAMPLES_PER_POINT
      && rejectionRatio
        <= CALIBRATION.MAX_REJECTION_RATIO
      && stability?.stable === true;

    return {
      calibrationId:
        this.calibrationId,

      target:
        this.target,

      targetShownAtMs:
        this.targetShownAtMs,

      samples:
        [...this.samples],

      acceptedSampleCount:
        this.acceptedSampleCount,

      rejectedSampleCount:
        this.rejectedSampleCount,

      rejectionRatio,
      phase,
      sufficient,
      stability
    };
  }

  public reset(): void {
    this.calibrationId = null;
    this.target = null;
    this.targetShownAtMs = null;
    this.samples = [];
    this.acceptedSampleCount = 0;
    this.rejectedSampleCount = 0;
    this.observedPredictionTimestampsMs = [];
    this.rejectionReasonCounts = {};
    this.faceBaseline = null;
  }

  private getPhaseAt(
    timestampMs: TimestampMs
  ): CalibrationCollectionPhase {
    if (
      this.targetShownAtMs === null
      || !isFiniteTimestamp(timestampMs)
    ) {
      return "IDLE";
    }

    const elapsedMs =
      timestampMs - this.targetShownAtMs;

    if (elapsedMs < CALIBRATION.TARGET_SETTLE_MS) {
      return "SETTLING";
    }

    if (elapsedMs >= this.getAdaptivePointTimeoutMs()) {
      return "TIMED_OUT";
    }

    const minimumCandidateWindowComplete =
      elapsedMs
      >= CALIBRATION.TARGET_SETTLE_MS
        + CALIBRATION.SAMPLE_WINDOW_MIN_MS;

    const maximumCandidateWindowComplete =
      elapsedMs
      >= CALIBRATION.TARGET_SETTLE_MS
        + CALIBRATION.SAMPLE_WINDOW_MAX_MS;

    const enoughSamples =
      this.acceptedSampleCount
        >= CALIBRATION
          .MIN_ACCEPTED_SAMPLES_PER_POINT;

    if (
      minimumCandidateWindowComplete
      && enoughSamples
      && selectBestCalibrationStableWindow(
        this.samples
      ) !== null
    ) {
      return "READY";
    }

    /*
     * Stop the candidate interval after 1200 ms when enough samples exist.
     * `finishPoint()` will mark it insufficient if no stable sub-window was
     * found, which lets the visible calibration flow retry this target.
     */
    if (
      maximumCandidateWindowComplete
      && enoughSamples
    ) {
      return "READY";
    }

    return "COLLECTING";
  }

  private getRejectionReason(
    observation: CalibrationObservation
  ): CalibrationSampleRejectionReason | null {
    if (
      observation.prediction.rawSpace
      !== "NORMALIZED"
    ) {
      return "UNSUPPORTED_GAZE_SPACE";
    }

    if (!observation.gazeValid) {
      return "GAZE_INVALID";
    }

    if (
      !Number.isFinite(observation.gazeQuality)
      || observation.gazeQuality
        < CALIBRATION.MIN_SAMPLE_QUALITY
    ) {
      return "GAZE_QUALITY_LOW";
    }

    if (
      !observation.face.faceValid
      || !observation.prediction.faceValid
    ) {
      return "FACE_INVALID";
    }

    if (
      !observation.face.eyesValid
      || !observation.prediction.eyesValid
    ) {
      return "EYES_INVALID";
    }

    if (observation.face.blink) {
      return "BLINK";
    }

    const baselineDriftReason =
      getCalibrationBaselineDriftReason(
        this.faceBaseline,
        {
          headPose:
            observation.face.headPose,
          faceDistanceRatio:
            observation.face.faceDistanceRatio,
          faceCenterNormalized:
            observation.faceCenterNormalized
            ?? null
        }
      );

    if (baselineDriftReason !== null) {
      return baselineDriftReason;
    }

    return null;
  }

  private getEffectiveObservedSampleRateHz(): number | null {
    if (this.observedPredictionTimestampsMs.length < 2) {
      return null;
    }

    const first = this.observedPredictionTimestampsMs[0];
    const last = this.observedPredictionTimestampsMs.at(-1);

    if (first === undefined || last === undefined) {
      return null;
    }

    const durationMs = last - first;

    if (durationMs <= 0) {
      return null;
    }

    return (this.observedPredictionTimestampsMs.length - 1)
      * 1000
      / durationMs;
  }

  private getAdaptivePointTimeoutMs(): number {
    if (this.observedPredictionTimestampsMs.length < 4) {
      return CALIBRATION.POINT_TIMEOUT_MS;
    }

    const effectiveHz =
      this.getEffectiveObservedSampleRateHz();

    if (effectiveHz === null) {
      return CALIBRATION.POINT_TIMEOUT_MS;
    }

    if (effectiveHz < CALIBRATION.POINT_TIMEOUT_LOW_FPS_THRESHOLD_HZ) {
      return CALIBRATION.POINT_TIMEOUT_LOW_FPS_MS;
    }

    if (effectiveHz < CALIBRATION.POINT_TIMEOUT_MEDIUM_FPS_THRESHOLD_HZ) {
      return CALIBRATION.POINT_TIMEOUT_MEDIUM_FPS_MS;
    }

    return CALIBRATION.POINT_TIMEOUT_MS;
  }

  private storeRejectedObservation(
    observation: CalibrationObservation,
    reason: CalibrationSampleRejectionReason
  ): CalibrationSampleDecision {
    this.samples.push(
      this.createRawSample(
        observation,
        false
      )
    );

    this.rejectedSampleCount += 1;
    this.rejectionReasonCounts[reason] =
      (this.rejectionReasonCounts[reason] ?? 0) + 1;

    return this.createDecision(
      this.getPhaseAt(
        observation.prediction.timestampMs
      ),
      true,
      false,
      reason
    );
  }

  private createRawSample(
    observation: CalibrationObservation,
    accepted: boolean
  ): CalibrationRawSample {
    const calibrationId =
      this.calibrationId;

    const target =
      this.target;

    if (
      calibrationId === null
      || target === null
    ) {
      throw new Error(
        "CalibrationCollector active point disappeared during sample creation."
      );
    }

    return {
      calibrationId,
      pointIndex:
        target.pointIndex,
      timestampMs:
        observation.prediction.timestampMs,
      targetViewportPoint:
        target.viewportPoint,
      rawGazePoint:
        observation.prediction.rawPoint,
      rawGazeSpace:
        observation.prediction.rawSpace,
      headPose:
        observation.face.headPose,
      faceDistanceRatio:
        observation.face.faceDistanceRatio,
      faceCenterNormalized:
        observation.faceCenterNormalized
        ?? null,
      faceValid:
        observation.face.faceValid,
      eyesValid:
        observation.face.eyesValid,
      blink:
        observation.face.blink,
      quality:
        observation.gazeQuality,
      accepted
    };
  }

  private createDecision(
    phase: CalibrationCollectionPhase,
    stored: boolean,
    accepted: boolean,
    rejectionReason:
      CalibrationSampleRejectionReason | null
  ): CalibrationSampleDecision {
    return {
      phase,
      stored,
      accepted,
      rejectionReason,
      acceptedSampleCount:
        this.acceptedSampleCount,
      rejectedSampleCount:
        this.rejectedSampleCount
    };
  }
}
