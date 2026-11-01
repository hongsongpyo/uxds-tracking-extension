import {
  DRIFT_THRESHOLDS,
  RUNTIME_MAINTENANCE
} from "../shared/constants";

import type {
  DriftSeverity,
  DriftStatus,
  Size2D
} from "../shared/types";

import type {
  HybridDriftContext
} from "./calibrationHybridSelector";

function severityRank(severity: DriftSeverity): number {
  switch (severity) {
    case "NONE": return 0;
    case "LOW": return 1;
    case "MEDIUM": return 2;
    case "HIGH": return 3;
  }
}

function maximumSeverity(
  first: DriftSeverity,
  second: DriftSeverity
): DriftSeverity {
  return severityRank(first) >= severityRank(second) ? first : second;
}

function thresholdSeverity(
  value: number,
  low: number,
  medium: number,
  high: number
): DriftSeverity {
  if (value >= high) return "HIGH";
  if (value >= medium) return "MEDIUM";
  if (value >= low) return "LOW";
  return "NONE";
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

export interface RuntimeGazeDriftMonitorState {
  readonly monitoringStartedAtMs: number | null;
  readonly precisionReferenceSamples: readonly number[];
  readonly precisionReferenceWidthRatio: number | null;
}

/**
 * Runtime maintenance monitor.
 *
 * It combines three target-free safeguards:
 * 1. head/face departure from the calibrated pose envelope;
 * 2. sustained deterioration in fixation-like gaze precision relative to the
 *    participant's own early-session reference;
 * 3. a periodic multi-point maintenance interval for long sessions.
 *
 * Accuracy itself cannot be measured without a known target. The monitor only
 * decides when a short known-target recalibration/check is warranted. Raw gaze
 * is never modified here.
 */
export class RuntimeGazeDriftMonitor {
  private highStartedAtMs: number | null = null;
  private mediumStartedAtMs: number | null = null;

  private precisionHighStartedAtMs: number | null = null;
  private precisionMediumStartedAtMs: number | null = null;

  private monitoringStartedAtMs: number | null = null;

  private readonly precisionReferenceSamples: number[] = [];
  // Store dispersion in viewport-width units so CSS zoom/resizing cannot
  // appear to improve or degrade the participant's precision by itself.
  private precisionReferenceWidthRatio: number | null = null;
  private lastObservationTimestampMs: number | null = null;

  public update(
    timestampMs: number,
    drift: HybridDriftContext | null,
    viewport: Size2D | null,
    gazeVariancePx: number | null,
    qualityScore: number
  ): DriftStatus | null {
    if (
      drift === null
      || viewport === null
      || !Number.isFinite(viewport.width)
      || !Number.isFinite(viewport.height)
      || viewport.width <= 0
      || viewport.height <= 0
      || !Number.isFinite(timestampMs)
      || timestampMs < 0
      || !Object.values(drift).every(Number.isFinite)
    ) {
      this.interrupt();
      return null;
    }

    if (this.lastObservationTimestampMs !== null) {
      const gapMs = timestampMs - this.lastObservationTimestampMs;
      if (gapMs <= 0) {
        this.reset();
      } else if (gapMs > RUNTIME_MAINTENANCE.MAX_CONTINUOUS_OBSERVATION_GAP_MS) {
        this.interrupt();
      }
    }
    const qualityUsable = Number.isFinite(qualityScore)
      && qualityScore >= RUNTIME_MAINTENANCE.AUTO_QUICK_RECALIBRATION_MIN_QUALITY;
    if (!qualityUsable) this.interrupt();
    this.lastObservationTimestampMs = qualityUsable ? timestampMs : null;
    this.monitoringStartedAtMs ??= timestampMs;
    const monitoringElapsedMs = Math.max(
      0,
      timestampMs - this.monitoringStartedAtMs
    );

    const faceCenterDeltaPx = Math.hypot(
      drift.deltaFaceCenterX * viewport.width,
      drift.deltaFaceCenterY * viewport.height
    );

    const faceDistanceDeltaRatio = Math.abs(drift.faceDistanceDelta);
    const yawDeltaDeg = Math.abs(drift.deltaHeadYawDeg);
    const pitchDeltaDeg = Math.abs(drift.deltaHeadPitchDeg);
    const rollDeltaDeg = Math.abs(drift.deltaHeadRollDeg);
    const headDeltaDeg = Math.max(yawDeltaDeg, pitchDeltaDeg, rollDeltaDeg);

    let rawPoseSeverity: DriftSeverity = "NONE";
    rawPoseSeverity = maximumSeverity(
      rawPoseSeverity,
      thresholdSeverity(
        faceCenterDeltaPx,
        DRIFT_THRESHOLDS.FACE_CENTER_LOW_PX,
        DRIFT_THRESHOLDS.FACE_CENTER_MEDIUM_PX,
        DRIFT_THRESHOLDS.FACE_CENTER_HIGH_PX
      )
    );
    rawPoseSeverity = maximumSeverity(
      rawPoseSeverity,
      thresholdSeverity(
        faceDistanceDeltaRatio,
        DRIFT_THRESHOLDS.FACE_DISTANCE_LOW_RATIO,
        DRIFT_THRESHOLDS.FACE_DISTANCE_MEDIUM_RATIO,
        DRIFT_THRESHOLDS.FACE_DISTANCE_HIGH_RATIO
      )
    );
    rawPoseSeverity = maximumSeverity(
      rawPoseSeverity,
      thresholdSeverity(
        headDeltaDeg,
        DRIFT_THRESHOLDS.HEAD_POSE_LOW_DEG,
        DRIFT_THRESHOLDS.HEAD_POSE_MEDIUM_DEG,
        DRIFT_THRESHOLDS.HEAD_POSE_HIGH_DEG
      )
    );

    if (qualityUsable && rawPoseSeverity === "HIGH") {
      this.highStartedAtMs ??= timestampMs;
      this.mediumStartedAtMs ??= timestampMs;
    } else {
      this.highStartedAtMs = null;
      if (qualityUsable && rawPoseSeverity === "MEDIUM") {
        this.mediumStartedAtMs ??= timestampMs;
      } else {
        this.mediumStartedAtMs = null;
      }
    }

    const highDurationMs = this.highStartedAtMs === null
      ? 0
      : timestampMs - this.highStartedAtMs;
    const mediumDurationMs = this.mediumStartedAtMs === null
      ? 0
      : timestampMs - this.mediumStartedAtMs;

    const poseSeverity: DriftSeverity =
      rawPoseSeverity === "HIGH"
        && highDurationMs < DRIFT_THRESHOLDS.HIGH_PERSIST_MS
        ? "MEDIUM"
        : rawPoseSeverity;

    const poseRecalibrationRecommended =
      highDurationMs >= DRIFT_THRESHOLDS.QUICK_RECALIBRATION_HIGH_PERSIST_MS
      || (
        rawPoseSeverity === "MEDIUM"
        && mediumDurationMs
          >= DRIFT_THRESHOLDS.QUICK_RECALIBRATION_MEDIUM_PERSIST_MS
      );

    const finitePrecision =
      gazeVariancePx !== null
      && Number.isFinite(gazeVariancePx)
      && gazeVariancePx > 0
        ? gazeVariancePx
        : null;

    this.updatePrecisionReference(
      monitoringElapsedMs,
      finitePrecision === null ? null : finitePrecision / viewport.width,
      qualityScore
    );

    const precisionReferencePx = this.precisionReferenceWidthRatio === null
      ? null
      : this.precisionReferenceWidthRatio * viewport.width;
    const precisionRatio =
      finitePrecision !== null
      && precisionReferencePx !== null
      && precisionReferencePx > 0
        ? finitePrecision / precisionReferencePx
        : null;

    let rawPrecisionSeverity: DriftSeverity = "NONE";

    if (
      qualityUsable
      && monitoringElapsedMs
        >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_CAPTURE_MS
      && finitePrecision !== null
    ) {
      const viewportWidthRatio = finitePrecision / viewport.width;

      if (
        viewportWidthRatio
          >= RUNTIME_MAINTENANCE.PRECISION_HIGH_VIEWPORT_WIDTH_RATIO
        || (precisionRatio !== null
          && precisionRatio >= RUNTIME_MAINTENANCE.PRECISION_HIGH_RATIO)
      ) {
        rawPrecisionSeverity = "HIGH";
      } else if (
        viewportWidthRatio
          >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_VIEWPORT_WIDTH_RATIO
        || (precisionRatio !== null
          && precisionRatio >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_RATIO)
      ) {
        rawPrecisionSeverity = "MEDIUM";
      } else if (
        precisionRatio !== null
        && precisionRatio >= RUNTIME_MAINTENANCE.PRECISION_LOW_RATIO
      ) {
        rawPrecisionSeverity = "LOW";
      }
    }

    if (rawPrecisionSeverity === "HIGH") {
      this.precisionHighStartedAtMs ??= timestampMs;
      this.precisionMediumStartedAtMs ??= timestampMs;
    } else if (rawPrecisionSeverity === "MEDIUM") {
      this.precisionHighStartedAtMs = null;
      this.precisionMediumStartedAtMs ??= timestampMs;
    } else {
      this.precisionHighStartedAtMs = null;
      this.precisionMediumStartedAtMs = null;
    }

    const precisionHighDurationMs = this.precisionHighStartedAtMs === null
      ? 0
      : timestampMs - this.precisionHighStartedAtMs;
    const precisionMediumDurationMs = this.precisionMediumStartedAtMs === null
      ? 0
      : timestampMs - this.precisionMediumStartedAtMs;

    let precisionSeverity: DriftSeverity = "NONE";
    if (
      rawPrecisionSeverity === "HIGH"
      && precisionHighDurationMs
        >= RUNTIME_MAINTENANCE.PRECISION_HIGH_PERSIST_MS
    ) {
      precisionSeverity = "HIGH";
    } else if (
      (rawPrecisionSeverity === "HIGH" || rawPrecisionSeverity === "MEDIUM")
      && precisionMediumDurationMs
        >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_PERSIST_MS
    ) {
      precisionSeverity = "MEDIUM";
    } else if (rawPrecisionSeverity !== "NONE") {
      precisionSeverity = "LOW";
    }

    const precisionRecalibrationRecommended =
      precisionHighDurationMs
        >= RUNTIME_MAINTENANCE.PRECISION_HIGH_PERSIST_MS
      || precisionMediumDurationMs
        >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_PERSIST_MS;

    const periodicMaintenanceDue =
      monitoringElapsedMs >= RUNTIME_MAINTENANCE.PERIODIC_MAINTENANCE_INTERVAL_MS;

    const automaticActionEligible =
      monitoringElapsedMs
        >= RUNTIME_MAINTENANCE.AUTO_QUICK_RECALIBRATION_MIN_MONITORING_MS
      && Number.isFinite(qualityScore)
      && qualityScore
        >= RUNTIME_MAINTENANCE.AUTO_QUICK_RECALIBRATION_MIN_QUALITY;

    const quickRecalibrationRecommended =
      automaticActionEligible
      && (
        poseRecalibrationRecommended
        || precisionRecalibrationRecommended
        || periodicMaintenanceDue
      );

    const maintenanceReason = quickRecalibrationRecommended
      ? poseRecalibrationRecommended
        ? "POSE" as const
        : precisionRecalibrationRecommended
          ? "PRECISION" as const
          : periodicMaintenanceDue
            ? "PERIODIC" as const
            : null
      : null;

    return {
      timestampMs,
      severity: maximumSeverity(poseSeverity, precisionSeverity),
      faceCenterDeltaPx,
      faceDistanceDeltaRatio,
      yawDeltaDeg,
      pitchDeltaDeg,
      rollDeltaDeg,
      gazeVariance: finitePrecision ?? 0,
      precisionReferencePx,
      precisionRatio,
      monitoringElapsedMs,
      periodicMaintenanceDue,
      maintenanceReason,
      qualityScore: Number.isFinite(qualityScore) ? qualityScore : 0,
      quickRecalibrationRecommended
    };
  }

  /** Save the participant-specific reference, not transient persistence timers. */
  public captureState(): RuntimeGazeDriftMonitorState {
    return {
      monitoringStartedAtMs: this.monitoringStartedAtMs,
      precisionReferenceSamples: [...this.precisionReferenceSamples],
      precisionReferenceWidthRatio: this.precisionReferenceWidthRatio
    };
  }

  public restoreState(state: RuntimeGazeDriftMonitorState): void {
    this.interrupt();
    this.monitoringStartedAtMs = state.monitoringStartedAtMs;
    this.precisionReferenceSamples.length = 0;
    this.precisionReferenceSamples.push(...state.precisionReferenceSamples);
    this.precisionReferenceWidthRatio = state.precisionReferenceWidthRatio;
  }

  /** Break continuous evidence at page changes/gaps, preserving the session baseline. */
  public interrupt(): void {
    this.lastObservationTimestampMs = null;
    this.highStartedAtMs = null;
    this.mediumStartedAtMs = null;
    this.precisionHighStartedAtMs = null;
    this.precisionMediumStartedAtMs = null;
  }

  /** A new calibration/session invalidates both evidence and the reference. */
  public reset(): void {
    this.interrupt();
    this.monitoringStartedAtMs = null;
    this.precisionReferenceSamples.length = 0;
    this.precisionReferenceWidthRatio = null;
  }

  private updatePrecisionReference(
    monitoringElapsedMs: number,
    precisionWidthRatio: number | null,
    qualityScore: number
  ): void {
    if (this.precisionReferenceWidthRatio !== null) return;

    if (
      precisionWidthRatio !== null
      && Number.isFinite(qualityScore)
      && qualityScore >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_QUALITY
      && monitoringElapsedMs <= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MAX_CAPTURE_MS
    ) {
      this.precisionReferenceSamples.push(precisionWidthRatio);
    }

    const targetReached =
      monitoringElapsedMs >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_CAPTURE_MS
      && this.precisionReferenceSamples.length
        >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_TARGET_SAMPLES;

    const captureExpired =
      monitoringElapsedMs >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MAX_CAPTURE_MS
      && this.precisionReferenceSamples.length
        >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_SAMPLES;

    if (targetReached || captureExpired) {
      this.precisionReferenceWidthRatio = median(this.precisionReferenceSamples);
    }
  }
}
