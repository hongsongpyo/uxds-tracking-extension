import {
  BLINK_THRESHOLDS
} from "../shared/constants";

import type {
  TimestampMs
} from "../shared/types";

import type {
  EyeGeometryFrameResult
} from "./eyeGeometry";

/* ========================================================================== 
 * Public blink types
 * ======================================================================== */

export type EyeClosureState =
  | "UNKNOWN"
  | "OPEN"
  | "CLOSED";

export type BlinkEventKind =
  | "BLINK"
  | "PROLONGED_CLOSURE";

export interface BlinkEvent {
  readonly kind: BlinkEventKind;
  readonly startedAtMs: TimestampMs;
  readonly endedAtMs: TimestampMs | null;
  readonly durationMs: number;
}

export interface BlinkDetectorConfig {
  /**
   * Eye is considered closed only when lidOpeningRatio falls to or below
   * this threshold.
   */
  readonly closedThreshold: number;

  /**
   * A previously closed eye is considered open again only when the ratio
   * reaches or exceeds this threshold. Keeping this above closedThreshold
   * creates hysteresis and suppresses threshold chatter.
   */
  readonly openThreshold: number;

  readonly minBlinkDurationMs: number;
  readonly maxBlinkDurationMs: number;

  /**
   * Both eyes must remain OPEN for this long before a closure is finalized.
   * The blink end timestamp remains the first reopening frame, so this does
   * not inflate the measured closure duration.
   */
  readonly reopenConfirmationMs: number;

  /**
   * Short landmark dropouts are tolerated without discarding an in-progress
   * blink candidate. Longer gaps reset the temporal detector state.
   */
  readonly maxInvalidSampleGapMs: number;
}

export interface BlinkFrameResult {
  readonly frameSequence: number;
  readonly timestampMs: TimestampMs;

  /**
   * True when this frame contains usable binocular eye geometry.
   */
  readonly valid: boolean;

  readonly leftEyeState: EyeClosureState;
  readonly rightEyeState: EyeClosureState;

  readonly bothEyesOpen: boolean;
  readonly bothEyesClosed: boolean;

  /**
   * Exactly one eye is classified CLOSED while the other is OPEN.
   * This is exposed as a quality/debug signal rather than being counted as
   * a binocular blink.
   */
  readonly asymmetricClosure: boolean;

  /**
   * True while a binocular closure candidate is active. Consumers that need
   * to invalidate gaze during eyelid closure should use bothEyesClosed or
   * blinkInProgress rather than waiting for blinkDetected on reopening.
   */
  readonly blinkInProgress: boolean;

  /**
   * Duration of the currently active closure candidate, measured from the
   * first confirmed both-eyes-CLOSED frame. Null when no candidate exists.
   */
  readonly activeClosureDurationMs:
    number | null;

  /**
   * Becomes true for the frame on which a valid blink is finalized.
   */
  readonly blinkDetected: boolean;

  /**
   * Becomes true once when an uninterrupted closure exceeds the configured
   * maximum blink duration. It is not counted as a normal blink.
   */
  readonly prolongedClosureDetected:
    boolean;

  readonly event: BlinkEvent | null;
}

/* ========================================================================== 
 * Configuration
 * ======================================================================== */

const DEFAULT_BLINK_CONFIG: BlinkDetectorConfig = {
  closedThreshold:
    BLINK_THRESHOLDS.CLOSED_THRESHOLD,

  openThreshold:
    BLINK_THRESHOLDS.OPEN_THRESHOLD,

  minBlinkDurationMs:
    BLINK_THRESHOLDS.MIN_BLINK_DURATION_MS,

  maxBlinkDurationMs:
    BLINK_THRESHOLDS.MAX_BLINK_DURATION_MS,

  reopenConfirmationMs:
    BLINK_THRESHOLDS.REOPEN_CONFIRMATION_MS,

  maxInvalidSampleGapMs:
    BLINK_THRESHOLDS.MAX_INVALID_SAMPLE_GAP_MS
};

function validateConfig(
  config: BlinkDetectorConfig
): void {
  if (
    !Number.isFinite(config.closedThreshold)
    || !Number.isFinite(config.openThreshold)
    || config.closedThreshold < 0
    || config.openThreshold <= config.closedThreshold
  ) {
    throw new RangeError(
      "Blink thresholds must be finite and OPEN_THRESHOLD must be greater than CLOSED_THRESHOLD."
    );
  }

  if (
    !Number.isFinite(config.minBlinkDurationMs)
    || !Number.isFinite(config.maxBlinkDurationMs)
    || config.minBlinkDurationMs < 0
    || config.maxBlinkDurationMs
      < config.minBlinkDurationMs
  ) {
    throw new RangeError(
      "Blink duration thresholds are invalid."
    );
  }

  if (
    !Number.isFinite(config.reopenConfirmationMs)
    || config.reopenConfirmationMs < 0
    || !Number.isFinite(
      config.maxInvalidSampleGapMs
    )
    || config.maxInvalidSampleGapMs < 0
  ) {
    throw new RangeError(
      "Blink temporal guard values must be finite and non-negative."
    );
  }
}

/* ========================================================================== 
 * State helpers
 * ======================================================================== */

function classifyEyeState(
  previousState: EyeClosureState,
  lidOpeningRatio: number,
  config: BlinkDetectorConfig
): EyeClosureState {
  if (!Number.isFinite(lidOpeningRatio)) {
    return "UNKNOWN";
  }

  switch (previousState) {
    case "UNKNOWN":
      if (
        lidOpeningRatio
          <= config.closedThreshold
      ) {
        return "CLOSED";
      }

      if (
        lidOpeningRatio
          >= config.openThreshold
      ) {
        return "OPEN";
      }

      return "UNKNOWN";

    case "OPEN":
      return lidOpeningRatio
        <= config.closedThreshold
        ? "CLOSED"
        : "OPEN";

    case "CLOSED":
      return lidOpeningRatio
        >= config.openThreshold
        ? "OPEN"
        : "CLOSED";
  }
}

function nonNegativeDuration(
  startMs: TimestampMs,
  endMs: TimestampMs
): number {
  return Math.max(
    0,
    endMs - startMs
  );
}

/* ========================================================================== 
 * Blink detector
 * ======================================================================== */

/**
 * Stateful binocular blink detector.
 *
 * Input is intentionally limited to the geometry adapter result so this
 * module has no MediaPipe dependency. A blink candidate begins when both
 * eyes cross the CLOSED threshold and is accepted only after both eyes have
 * reopened stably for reopenConfirmationMs.
 */
export class BlinkDetector {
  private readonly config:
    BlinkDetectorConfig;

  private leftEyeState:
    EyeClosureState = "UNKNOWN";

  private rightEyeState:
    EyeClosureState = "UNKNOWN";

  private closureStartedAtMs:
    TimestampMs | null = null;

  private reopenStartedAtMs:
    TimestampMs | null = null;

  private prolongedClosureReported = false;

  private lastValidTimestampMs:
    TimestampMs | null = null;

  private lastInputTimestampMs:
    TimestampMs | null = null;

  public constructor(
    config: BlinkDetectorConfig = DEFAULT_BLINK_CONFIG
  ) {
    validateConfig(config);

    this.config = {
      closedThreshold:
        config.closedThreshold,
      openThreshold:
        config.openThreshold,
      minBlinkDurationMs:
        config.minBlinkDurationMs,
      maxBlinkDurationMs:
        config.maxBlinkDurationMs,
      reopenConfirmationMs:
        config.reopenConfirmationMs,
      maxInvalidSampleGapMs:
        config.maxInvalidSampleGapMs
    };
  }

  public analyze(
    frame: EyeGeometryFrameResult
  ): BlinkFrameResult {
    if (!Number.isFinite(frame.timestampMs)) {
      this.reset();
      return this.handleInvalidFrame(frame);
    }

    this.handleTimestampDiscontinuity(
      frame.timestampMs
    );

    this.lastInputTimestampMs =
      frame.timestampMs;

    if (
      !frame.geometryValid
      || frame.leftEye === null
      || frame.rightEye === null
    ) {
      return this.handleInvalidFrame(
        frame
      );
    }

    this.handleValidSampleGap(
      frame.timestampMs
    );

    this.lastValidTimestampMs =
      frame.timestampMs;

    this.leftEyeState =
      classifyEyeState(
        this.leftEyeState,
        frame.leftEye.lidOpeningRatio,
        this.config
      );

    this.rightEyeState =
      classifyEyeState(
        this.rightEyeState,
        frame.rightEye.lidOpeningRatio,
        this.config
      );

    const bothEyesOpen =
      this.leftEyeState === "OPEN"
      && this.rightEyeState === "OPEN";

    const bothEyesClosed =
      this.leftEyeState === "CLOSED"
      && this.rightEyeState === "CLOSED";

    const asymmetricClosure =
      (
        this.leftEyeState === "CLOSED"
        && this.rightEyeState === "OPEN"
      )
      || (
        this.leftEyeState === "OPEN"
        && this.rightEyeState === "CLOSED"
      );

    if (
      this.closureStartedAtMs === null
      && bothEyesClosed
    ) {
      this.closureStartedAtMs =
        frame.timestampMs;

      this.reopenStartedAtMs = null;
      this.prolongedClosureReported = false;
    }

    let event: BlinkEvent | null = null;

    if (this.closureStartedAtMs !== null) {
      event = this.updateActiveClosure(
        frame.timestampMs,
        bothEyesOpen,
        bothEyesClosed
      );
    }

    const activeClosureDurationMs =
      this.closureStartedAtMs === null
        ? null
        : nonNegativeDuration(
          this.closureStartedAtMs,
          frame.timestampMs
        );

    return {
      frameSequence:
        frame.frameSequence,

      timestampMs:
        frame.timestampMs,

      valid: true,

      leftEyeState:
        this.leftEyeState,

      rightEyeState:
        this.rightEyeState,

      bothEyesOpen,
      bothEyesClosed,
      asymmetricClosure,

      blinkInProgress:
        this.closureStartedAtMs !== null,

      activeClosureDurationMs,

      blinkDetected:
        event?.kind === "BLINK",

      prolongedClosureDetected:
        event?.kind
          === "PROLONGED_CLOSURE",

      event
    };
  }

  /**
   * Clears temporal state. Call this when starting a new tracking session,
   * after a camera restart, or after a discontinuous video timeline.
   */
  public reset(): void {
    this.leftEyeState = "UNKNOWN";
    this.rightEyeState = "UNKNOWN";

    this.closureStartedAtMs = null;
    this.reopenStartedAtMs = null;
    this.prolongedClosureReported = false;

    this.lastValidTimestampMs = null;
    this.lastInputTimestampMs = null;
  }

  private handleTimestampDiscontinuity(
    timestampMs: TimestampMs
  ): void {
    if (
      this.lastInputTimestampMs !== null
      && timestampMs < this.lastInputTimestampMs
    ) {
      this.reset();
    }
  }

  private handleValidSampleGap(
    timestampMs: TimestampMs
  ): void {
    if (this.lastValidTimestampMs === null) {
      return;
    }

    const gapMs =
      timestampMs - this.lastValidTimestampMs;

    if (
      gapMs
        > this.config.maxInvalidSampleGapMs
    ) {
      this.resetTemporalClosureState();
      this.leftEyeState = "UNKNOWN";
      this.rightEyeState = "UNKNOWN";
    }
  }

  private handleInvalidFrame(
    frame: EyeGeometryFrameResult
  ): BlinkFrameResult {
    if (
      this.lastValidTimestampMs !== null
      && frame.timestampMs
        - this.lastValidTimestampMs
        > this.config.maxInvalidSampleGapMs
    ) {
      this.resetTemporalClosureState();
      this.leftEyeState = "UNKNOWN";
      this.rightEyeState = "UNKNOWN";
    }

    return {
      frameSequence:
        frame.frameSequence,

      timestampMs:
        frame.timestampMs,

      valid: false,

      leftEyeState: "UNKNOWN",
      rightEyeState: "UNKNOWN",

      bothEyesOpen: false,
      bothEyesClosed: false,
      asymmetricClosure: false,

      blinkInProgress:
        this.closureStartedAtMs !== null,

      activeClosureDurationMs:
        this.closureStartedAtMs === null
          ? null
          : nonNegativeDuration(
            this.closureStartedAtMs,
            frame.timestampMs
          ),

      blinkDetected: false,
      prolongedClosureDetected: false,
      event: null
    };
  }

  private updateActiveClosure(
    timestampMs: TimestampMs,
    bothEyesOpen: boolean,
    bothEyesClosed: boolean
  ): BlinkEvent | null {
    const closureStartedAtMs =
      this.closureStartedAtMs;

    if (closureStartedAtMs === null) {
      return null;
    }

    const currentDurationMs =
      nonNegativeDuration(
        closureStartedAtMs,
        timestampMs
      );

    if (
      currentDurationMs
        > this.config.maxBlinkDurationMs
      && !this.prolongedClosureReported
    ) {
      this.prolongedClosureReported = true;

      return {
        kind: "PROLONGED_CLOSURE",
        startedAtMs:
          closureStartedAtMs,
        endedAtMs: null,
        durationMs:
          currentDurationMs
      };
    }

    if (bothEyesClosed) {
      this.reopenStartedAtMs = null;
      return null;
    }

    if (!bothEyesOpen) {
      return null;
    }

    if (this.reopenStartedAtMs === null) {
      this.reopenStartedAtMs = timestampMs;
    }

    const reopenedForMs =
      nonNegativeDuration(
        this.reopenStartedAtMs,
        timestampMs
      );

    if (
      reopenedForMs
        < this.config.reopenConfirmationMs
    ) {
      return null;
    }

    const endedAtMs =
      this.reopenStartedAtMs;

    const durationMs =
      nonNegativeDuration(
        closureStartedAtMs,
        endedAtMs
      );

    const shouldReportBlink =
      !this.prolongedClosureReported
      && durationMs
        >= this.config.minBlinkDurationMs
      && durationMs
        <= this.config.maxBlinkDurationMs;

    this.resetTemporalClosureState();

    return shouldReportBlink
      ? {
        kind: "BLINK",
        startedAtMs:
          closureStartedAtMs,
        endedAtMs,
        durationMs
      }
      : null;
  }

  private resetTemporalClosureState(): void {
    this.closureStartedAtMs = null;
    this.reopenStartedAtMs = null;
    this.prolongedClosureReported = false;
  }
}
