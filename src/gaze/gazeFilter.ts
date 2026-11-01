import {
  GAZE_FILTER_DEFAULTS,
  GAZE_RUNTIME_DEFAULTS
} from "../shared/constants";

import type {
  Point2D,
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Public model
 * ======================================================================== */

export interface GazeFilterConfig {
  /** Minimum cutoff used by the One-Euro display filter. */
  readonly minCutoffHz: number;

  /**
   * Velocity sensitivity. Larger values reduce smoothing during rapid gaze
   * movement and therefore reduce visual latency around saccades.
   */
  readonly beta: number;

  /** Cutoff used to smooth the velocity estimate itself. */
  readonly derivativeCutoffHz: number;

  /**
   * Maximum visualization-only hold interval for a temporarily invalid gaze.
   * Held points never become valid research samples.
   */
  readonly maxVisualHoldMs: number;
}

export interface GazeFilterInput {
  readonly timestampMs: TimestampMs;
  readonly correctedViewportPoint: Point2D | null;
  readonly gazeValid: boolean;

  /**
   * V7-B visualization/derived-stream only stability boost. Values > 1 make
   * low-speed gaze smoother while One-Euro velocity adaptation still reduces
   * lag during saccades. Raw/calibration/validation coordinates never use it.
   */
  readonly smoothingMultiplier?: number;
}

export type GazeFilterMode =
  | "FILTERED"
  | "HELD"
  | "HIDDEN";

export interface GazeFilterResult {
  readonly timestampMs: TimestampMs;
  readonly filteredViewportPoint: Point2D | null;
  readonly mode: GazeFilterMode;
  readonly currentSampleValid: boolean;
  readonly sourceTimestampMs: TimestampMs | null;
  readonly visualAgeMs: number | null;
}

export interface GazeFilterSnapshot {
  readonly initialized: boolean;
  readonly lastInputTimestampMs: TimestampMs | null;
  readonly lastValidTimestampMs: TimestampMs | null;
  readonly filteredViewportPoint: Point2D | null;
}

/* ========================================================================== 
 * Configuration / helpers
 * ======================================================================== */

const DEFAULT_GAZE_FILTER_CONFIG: GazeFilterConfig = {
  minCutoffHz:
    GAZE_FILTER_DEFAULTS.ONE_EURO_MIN_CUTOFF_HZ,
  beta:
    GAZE_FILTER_DEFAULTS.ONE_EURO_BETA,
  derivativeCutoffHz:
    GAZE_FILTER_DEFAULTS.ONE_EURO_DERIVATIVE_CUTOFF_HZ,
  maxVisualHoldMs:
    GAZE_RUNTIME_DEFAULTS.MAX_VISUAL_HOLD_MS
};

function validateConfig(
  config: GazeFilterConfig
): void {
  if (
    !Number.isFinite(config.minCutoffHz)
    || config.minCutoffHz <= 0
    || !Number.isFinite(config.beta)
    || config.beta < 0
    || !Number.isFinite(config.derivativeCutoffHz)
    || config.derivativeCutoffHz <= 0
    || !Number.isFinite(config.maxVisualHoldMs)
    || config.maxVisualHoldMs < 0
  ) {
    throw new RangeError(
      "GazeFilter received an invalid One-Euro configuration."
    );
  }
}

function isFinitePoint(
  point: Point2D | null
): point is Point2D {
  return (
    point !== null
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function clonePoint(
  point: Point2D
): Point2D {
  return {
    x: point.x,
    y: point.y
  };
}

function lowPassAlpha(
  cutoffHz: number,
  deltaSeconds: number
): number {
  if (
    !Number.isFinite(deltaSeconds)
    || deltaSeconds <= 0
  ) {
    return 1;
  }

  const tau =
    1 / (2 * Math.PI * cutoffHz);

  return 1 / (1 + tau / deltaSeconds);
}

function lowPass(
  previous: number,
  current: number,
  alpha: number
): number {
  return (
    previous
    + alpha * (current - previous)
  );
}

/* ========================================================================== 
 * One-Euro display filter
 * ======================================================================== */

/**
 * Adaptive One-Euro filter for corrected viewport gaze coordinates.
 *
 * Architectural rules:
 * - raw gaze is never accepted or modified here;
 * - calibration validation must use unfiltered corrected gaze;
 * - low velocity -> stronger smoothing, high velocity -> weaker smoothing;
 * - invalid samples may visually hold a point briefly but remain invalid;
 * - timestamp regression resets all temporal state.
 */
export class GazeFilter {
  private readonly config:
    GazeFilterConfig;

  private lastFilteredPoint:
    Point2D | null = null;

  private lastRawPoint:
    Point2D | null = null;

  private filteredDerivative:
    Point2D = {
      x: 0,
      y: 0
    };

  private lastValidTimestampMs:
    TimestampMs | null = null;

  private lastInputTimestampMs:
    TimestampMs | null = null;

  public constructor(
    config: GazeFilterConfig = DEFAULT_GAZE_FILTER_CONFIG
  ) {
    validateConfig(config);
    this.config = { ...config };
  }

  public update(
    input: GazeFilterInput
  ): GazeFilterResult {
    if (
      !Number.isFinite(input.timestampMs)
      || input.timestampMs < 0
    ) {
      this.reset();
      return this.createHiddenResult(input.timestampMs);
    }

    if (
      this.lastInputTimestampMs !== null
      && input.timestampMs < this.lastInputTimestampMs
    ) {
      this.reset();
    }

    this.lastInputTimestampMs = input.timestampMs;

    if (
      input.gazeValid
      && isFinitePoint(input.correctedViewportPoint)
    ) {
      return this.handleValidPoint(
        input.timestampMs,
        input.correctedViewportPoint,
        input.smoothingMultiplier ?? 1
      );
    }

    return this.handleInvalidPoint(input.timestampMs);
  }

  public reset(): void {
    this.lastFilteredPoint = null;
    this.lastRawPoint = null;
    this.filteredDerivative = {
      x: 0,
      y: 0
    };
    this.lastValidTimestampMs = null;
    this.lastInputTimestampMs = null;
  }

  public getSnapshot(): GazeFilterSnapshot {
    return {
      initialized:
        this.lastFilteredPoint !== null,
      lastInputTimestampMs:
        this.lastInputTimestampMs,
      lastValidTimestampMs:
        this.lastValidTimestampMs,
      filteredViewportPoint:
        this.lastFilteredPoint === null
          ? null
          : clonePoint(this.lastFilteredPoint)
    };
  }

  private handleValidPoint(
    timestampMs: TimestampMs,
    correctedPoint: Point2D,
    smoothingMultiplier: number
  ): GazeFilterResult {
    if (
      this.lastFilteredPoint === null
      || this.lastRawPoint === null
      || this.lastValidTimestampMs === null
    ) {
      const initial = clonePoint(correctedPoint);

      this.lastFilteredPoint = initial;
      this.lastRawPoint = clonePoint(correctedPoint);
      this.lastValidTimestampMs = timestampMs;

      return this.createFilteredResult(
        timestampMs,
        initial
      );
    }

    const deltaSeconds =
      Math.max(
        1e-6,
        (timestampMs - this.lastValidTimestampMs) / 1_000
      );

    const rawDerivative = {
      x:
        (correctedPoint.x - this.lastRawPoint.x)
        / deltaSeconds,
      y:
        (correctedPoint.y - this.lastRawPoint.y)
        / deltaSeconds
    };

    const derivativeAlpha =
      lowPassAlpha(
        this.config.derivativeCutoffHz,
        deltaSeconds
      );

    this.filteredDerivative = {
      x: lowPass(
        this.filteredDerivative.x,
        rawDerivative.x,
        derivativeAlpha
      ),
      y: lowPass(
        this.filteredDerivative.y,
        rawDerivative.y,
        derivativeAlpha
      )
    };

    const speed =
      Math.hypot(
        this.filteredDerivative.x,
        this.filteredDerivative.y
      );

    const safeSmoothingMultiplier =
      Number.isFinite(smoothingMultiplier)
      && smoothingMultiplier >= 1
        ? smoothingMultiplier
        : 1;

    const adaptiveCutoffHz =
      this.config.minCutoffHz / safeSmoothingMultiplier
      + this.config.beta * speed;

    const pointAlpha =
      lowPassAlpha(
        adaptiveCutoffHz,
        deltaSeconds
      );

    const filteredPoint = {
      x: lowPass(
        this.lastFilteredPoint.x,
        correctedPoint.x,
        pointAlpha
      ),
      y: lowPass(
        this.lastFilteredPoint.y,
        correctedPoint.y,
        pointAlpha
      )
    };

    this.lastRawPoint = clonePoint(correctedPoint);
    this.lastFilteredPoint = filteredPoint;
    this.lastValidTimestampMs = timestampMs;

    return this.createFilteredResult(
      timestampMs,
      filteredPoint
    );
  }

  private handleInvalidPoint(
    timestampMs: TimestampMs
  ): GazeFilterResult {
    if (
      this.lastFilteredPoint === null
      || this.lastValidTimestampMs === null
    ) {
      return this.createHiddenResult(timestampMs);
    }

    const visualAgeMs =
      timestampMs - this.lastValidTimestampMs;

    if (
      visualAgeMs >= 0
      && visualAgeMs <= this.config.maxVisualHoldMs
    ) {
      return {
        timestampMs,
        filteredViewportPoint:
          clonePoint(this.lastFilteredPoint),
        mode: "HELD",
        currentSampleValid: false,
        sourceTimestampMs:
          this.lastValidTimestampMs,
        visualAgeMs
      };
    }

    this.lastFilteredPoint = null;
    this.lastRawPoint = null;
    this.filteredDerivative = {
      x: 0,
      y: 0
    };
    this.lastValidTimestampMs = null;

    return this.createHiddenResult(timestampMs);
  }

  private createFilteredResult(
    timestampMs: TimestampMs,
    point: Point2D
  ): GazeFilterResult {
    return {
      timestampMs,
      filteredViewportPoint:
        clonePoint(point),
      mode: "FILTERED",
      currentSampleValid: true,
      sourceTimestampMs: timestampMs,
      visualAgeMs: 0
    };
  }

  private createHiddenResult(
    timestampMs: TimestampMs
  ): GazeFilterResult {
    return {
      timestampMs,
      filteredViewportPoint: null,
      mode: "HIDDEN",
      currentSampleValid: false,
      sourceTimestampMs: null,
      visualAgeMs: null
    };
  }
}
