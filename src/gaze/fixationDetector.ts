import {
  FIXATION_DEFAULTS
} from "../shared/constants";

import {
  createFixationId
} from "../shared/utils";

import type {
  FixationId,
  Point2D,
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Public model
 * ======================================================================== */

export type RuntimeFixationStrategy =
  | "BASELINE_ONLY"
  | "DEEP_ONLY"
  | "SAFE_ADAPTIVE_HYBRID"
  | "BASELINE_FALLBACK";

export type FixationDetectorState =
  | "IDLE"
  | "CANDIDATE"
  | "FIXATING"
  | "GAP_HOLD"
  | "TRANSITION_GUARD";

export interface RuntimeFixation {
  readonly fixationId: FixationId;
  readonly startTimeMs: TimestampMs;
  readonly endTimeMs: TimestampMs;
  readonly durationMs: number;
  readonly centroidViewportPoint: Point2D;
  readonly dispersionX: number;
  readonly dispersionY: number;
  readonly dispersionPx: number;
  readonly sampleCount: number;
  readonly qualityMean: number;
  readonly peakSpeedPxPerSecond: number;
}

export interface FixationDetectorInput {
  readonly timestampMs: TimestampMs;
  readonly stabilizedViewportPoint: Point2D | null;
  readonly currentSampleValid: boolean;
  readonly stabilizedSpeedPxPerSecond: number | null;
  readonly qualityScore: number;
  readonly authoritativeStrategy: RuntimeFixationStrategy;
}

export interface FixationDetectionResult {
  readonly timestampMs: TimestampMs;
  readonly state: FixationDetectorState;

  /** Confirmed fixation that is still receiving valid samples. */
  readonly activeFixation: RuntimeFixation | null;

  /** Emitted once on the frame that closes a confirmed fixation. */
  readonly completedFixation: RuntimeFixation | null;

  /** Candidate diagnostics remain useful before MIN_DURATION_MS is reached. */
  readonly candidateDurationMs: number;
  readonly candidateSampleCount: number;

  /**
   * True when the exact frame on which the authoritative strategy changed was
   * intentionally excluded from fixation evidence. The candidate itself is
   * preserved across this one-frame quarantine when the time gap stays valid.
   */
  readonly strategyTransitionGuardApplied: boolean;

  /** Derived exclusively from existing fixation constants; no new tuning knob. */
  readonly velocityThresholdPxPerSecond: number;
}

interface FixationSample {
  readonly timestampMs: TimestampMs;
  readonly viewportPoint: Point2D;
  readonly qualityScore: number;
  readonly speedPxPerSecond: number;
}

interface DispersionMetrics {
  readonly centroid: Point2D;
  readonly dispersionX: number;
  readonly dispersionY: number;
  readonly dispersionPx: number;
  readonly qualityMean: number;
  readonly peakSpeedPxPerSecond: number;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

const VELOCITY_THRESHOLD_PX_PER_SECOND =
  FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX
  / (FIXATION_DEFAULTS.MIN_DURATION_MS / 1_000);

function isFinitePoint(
  point: Point2D | null
): point is Point2D {
  return (
    point !== null
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function copyPoint(point: Point2D): Point2D {
  return {
    x: point.x,
    y: point.y
  };
}

function resolveSpeed(
  suppliedSpeedPxPerSecond: number | null,
  previousSample: FixationSample | null,
  timestampMs: TimestampMs,
  point: Point2D
): number {
  if (
    suppliedSpeedPxPerSecond !== null
    && Number.isFinite(suppliedSpeedPxPerSecond)
    && suppliedSpeedPxPerSecond >= 0
  ) {
    return suppliedSpeedPxPerSecond;
  }

  if (previousSample === null) {
    return 0;
  }

  const deltaTimeMs =
    timestampMs - previousSample.timestampMs;

  if (
    !Number.isFinite(deltaTimeMs)
    || deltaTimeMs <= 0
  ) {
    return 0;
  }

  return (
    Math.hypot(
      point.x - previousSample.viewportPoint.x,
      point.y - previousSample.viewportPoint.y
    )
    / (deltaTimeMs / 1_000)
  );
}

function calculateMetrics(
  samples: readonly FixationSample[]
): DispersionMetrics | null {
  if (samples.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;
  let qualitySum = 0;
  let peakSpeed = 0;

  for (const sample of samples) {
    const point = sample.viewportPoint;

    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);

    sumX += point.x;
    sumY += point.y;
    qualitySum += sample.qualityScore;
    peakSpeed = Math.max(
      peakSpeed,
      sample.speedPxPerSecond
    );
  }

  const dispersionX = maxX - minX;
  const dispersionY = maxY - minY;

  return {
    centroid: {
      x: sumX / samples.length,
      y: sumY / samples.length
    },
    dispersionX,
    dispersionY,
    dispersionPx:
      Math.hypot(dispersionX, dispersionY),
    qualityMean:
      qualitySum / samples.length,
    peakSpeedPxPerSecond: peakSpeed
  };
}

/* ========================================================================== 
 * D22 fixation detector
 * ======================================================================== */

/**
 * Online fixation detector for the D21 stabilized authoritative stream.
 *
 * The detector deliberately combines two conservative signals:
 * - I-DT style bounding-box dispersion in viewport pixels;
 * - a velocity ceiling derived from the existing dispersion/min-duration
 *   configuration, avoiding an additional empirically untuned threshold.
 *
 * Research-safety rules:
 * - held/hidden D21 samples are never inserted into a fixation;
 * - a short invalid gap may preserve an existing candidate, but the gap does
 *   not contribute duration or samples;
 * - the exact frame of an authoritative-strategy transition is quarantined;
 * - strategy transitions therefore cannot create a fixation by themselves;
 * - completed fixations are immutable snapshots and raw gaze remains intact.
 */
export class FixationDetector {
  private samples: FixationSample[] = [];

  private activeFixationId:
    FixationId | null = null;

  private lastValidTimestampMs:
    TimestampMs | null = null;

  private lastInputTimestampMs:
    TimestampMs | null = null;

  private lastStrategy:
    RuntimeFixationStrategy | null = null;

  public update(
    input: FixationDetectorInput
  ): FixationDetectionResult {
    if (
      !Number.isFinite(input.timestampMs)
      || input.timestampMs < 0
    ) {
      this.reset();
      return this.createResult(
        input.timestampMs,
        "IDLE",
        null,
        false
      );
    }

    if (
      this.lastInputTimestampMs !== null
      && input.timestampMs < this.lastInputTimestampMs
    ) {
      this.reset();
    }

    this.lastInputTimestampMs =
      input.timestampMs;

    if (
      !input.currentSampleValid
      || !isFinitePoint(input.stabilizedViewportPoint)
    ) {
      return this.handleInvalidSample(input.timestampMs);
    }

    const strategyTransition =
      this.lastStrategy !== null
      && input.authoritativeStrategy
        !== this.lastStrategy;

    this.lastStrategy =
      input.authoritativeStrategy;

    if (strategyTransition) {
      const completed =
        this.closeIfGapExceeded(input.timestampMs);

      return this.createResult(
        input.timestampMs,
        completed === null
          ? "TRANSITION_GUARD"
          : "IDLE",
        completed,
        true
      );
    }

    return this.handleValidSample(input);
  }

  /**
   * Flushes a currently confirmed fixation without fabricating an extra gaze
   * sample. D25 can call this during experiment/session shutdown before the
   * detector is reset.
   */
  public flush(): RuntimeFixation | null {
    const completed = this.finalizeConfirmedFixation();
    this.clearCandidate();
    return completed;
  }

  public reset(): void {
    this.samples = [];
    this.activeFixationId = null;
    this.lastValidTimestampMs = null;
    this.lastInputTimestampMs = null;
    this.lastStrategy = null;
  }

  private handleValidSample(
    input: FixationDetectorInput
  ): FixationDetectionResult {
    const point = input.stabilizedViewportPoint;

    if (!isFinitePoint(point)) {
      return this.handleInvalidSample(input.timestampMs);
    }

    let completedFixation:
      RuntimeFixation | null = null;

    if (
      this.lastValidTimestampMs !== null
      && input.timestampMs - this.lastValidTimestampMs
        > FIXATION_DEFAULTS.MAX_SAMPLE_GAP_MS
    ) {
      completedFixation =
        this.finalizeConfirmedFixation();
      this.clearCandidate();
    }

    const previousSample =
      this.samples.length === 0
        ? null
        : this.samples[this.samples.length - 1]
          ?? null;

    const speedPxPerSecond =
      resolveSpeed(
        input.stabilizedSpeedPxPerSecond,
        previousSample,
        input.timestampMs,
        point
      );

    const currentSample: FixationSample = {
      timestampMs: input.timestampMs,
      viewportPoint: copyPoint(point),
      qualityScore: clamp01(input.qualityScore),
      speedPxPerSecond
    };

    if (
      previousSample !== null
      && speedPxPerSecond
        > VELOCITY_THRESHOLD_PX_PER_SECOND
    ) {
      const velocityCompleted =
        this.finalizeConfirmedFixation();

      if (completedFixation === null) {
        completedFixation = velocityCompleted;
      }

      this.clearCandidate();
      this.samples.push(currentSample);
      this.lastValidTimestampMs = input.timestampMs;

      return this.createResult(
        input.timestampMs,
        "CANDIDATE",
        completedFixation,
        false
      );
    }

    if (this.activeFixationId !== null) {
      this.samples.push(currentSample);

      const metrics =
        calculateMetrics(this.samples);

      if (
        metrics !== null
        && metrics.dispersionPx
          > FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX
      ) {
        this.samples.pop();

        const dispersionCompleted =
          this.finalizeConfirmedFixation();

        if (completedFixation === null) {
          completedFixation = dispersionCompleted;
        }

        this.clearCandidate();
        this.samples.push(currentSample);
      }
    } else {
      this.samples.push(currentSample);
      this.trimCandidateToDispersion();
      this.promoteCandidateIfReady();
    }

    this.lastValidTimestampMs = input.timestampMs;

    return this.createResult(
      input.timestampMs,
      this.activeFixationId === null
        ? "CANDIDATE"
        : "FIXATING",
      completedFixation,
      false
    );
  }

  private handleInvalidSample(
    timestampMs: TimestampMs
  ): FixationDetectionResult {
    const completed =
      this.closeIfGapExceeded(timestampMs);

    return this.createResult(
      timestampMs,
      completed !== null
        ? "IDLE"
        : this.samples.length > 0
          ? "GAP_HOLD"
          : "IDLE",
      completed,
      false
    );
  }

  private closeIfGapExceeded(
    timestampMs: TimestampMs
  ): RuntimeFixation | null {
    if (
      this.lastValidTimestampMs === null
      || timestampMs - this.lastValidTimestampMs
        <= FIXATION_DEFAULTS.MAX_SAMPLE_GAP_MS
    ) {
      return null;
    }

    const completed =
      this.finalizeConfirmedFixation();

    this.clearCandidate();

    return completed;
  }

  private trimCandidateToDispersion(): void {
    let metrics = calculateMetrics(this.samples);

    while (
      this.samples.length > 1
      && metrics !== null
      && metrics.dispersionPx
        > FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX
    ) {
      this.samples.shift();
      metrics = calculateMetrics(this.samples);
    }
  }

  private promoteCandidateIfReady(): void {
    if (
      this.activeFixationId !== null
      || this.samples.length
        < FIXATION_DEFAULTS.MIN_SAMPLE_COUNT
    ) {
      return;
    }

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const metrics = calculateMetrics(this.samples);

    if (
      first === undefined
      || last === undefined
      || metrics === null
    ) {
      return;
    }

    const durationMs =
      last.timestampMs - first.timestampMs;

    if (
      durationMs >= FIXATION_DEFAULTS.MIN_DURATION_MS
      && metrics.dispersionPx
        <= FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX
    ) {
      this.activeFixationId = createFixationId();
    }
  }

  private finalizeConfirmedFixation(): RuntimeFixation | null {
    if (this.activeFixationId === null) {
      return null;
    }

    const snapshot =
      this.buildFixation(this.activeFixationId);

    return snapshot;
  }

  private buildActiveFixation(): RuntimeFixation | null {
    if (this.activeFixationId === null) {
      return null;
    }

    return this.buildFixation(this.activeFixationId);
  }

  private buildFixation(
    fixationId: FixationId
  ): RuntimeFixation | null {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const metrics = calculateMetrics(this.samples);

    if (
      first === undefined
      || last === undefined
      || metrics === null
    ) {
      return null;
    }

    return {
      fixationId,
      startTimeMs: first.timestampMs,
      endTimeMs: last.timestampMs,
      durationMs:
        last.timestampMs - first.timestampMs,
      centroidViewportPoint:
        copyPoint(metrics.centroid),
      dispersionX: metrics.dispersionX,
      dispersionY: metrics.dispersionY,
      dispersionPx: metrics.dispersionPx,
      sampleCount: this.samples.length,
      qualityMean: metrics.qualityMean,
      peakSpeedPxPerSecond:
        metrics.peakSpeedPxPerSecond
    };
  }

  private candidateDurationMs(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];

    if (
      first === undefined
      || last === undefined
    ) {
      return 0;
    }

    return Math.max(
      0,
      last.timestampMs - first.timestampMs
    );
  }

  private createResult(
    timestampMs: TimestampMs,
    state: FixationDetectorState,
    completedFixation: RuntimeFixation | null,
    strategyTransitionGuardApplied: boolean
  ): FixationDetectionResult {
    return {
      timestampMs,
      state,
      activeFixation: this.buildActiveFixation(),
      completedFixation,
      candidateDurationMs: this.candidateDurationMs(),
      candidateSampleCount: this.samples.length,
      strategyTransitionGuardApplied,
      velocityThresholdPxPerSecond:
        VELOCITY_THRESHOLD_PX_PER_SECOND
    };
  }

  private clearCandidate(): void {
    this.samples = [];
    this.activeFixationId = null;
    this.lastValidTimestampMs = null;
  }
}
