import { GAZE_RUNTIME_DEFAULTS } from "../shared/constants";

import {
  GazeFilter
} from "./gazeFilter";

import {
  GazeOutlierRejector
} from "./gazeOutlierRejector";

import type {
  GazeFilterMode
} from "./gazeFilter";

import type {
  Point2D,
  Size2D,
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Public model
 * ======================================================================== */

export type AuthoritativeGazeStabilizationMode =
  | GazeFilterMode
  | "UNAVAILABLE";

export interface AuthoritativeGazeStabilizerInput {
  readonly timestampMs: TimestampMs;
  readonly normalizedPoint: Point2D;
  readonly viewport: Size2D | null;

  /**
   * True only for a research-eligible current authoritative sample. A held
   * visualization point is never promoted back into a valid research sample.
   */
  readonly gazeValid: boolean;

  /** Derived-stream-only adaptive stability boost from runtime precision. */
  readonly smoothingMultiplier?: number;
}

export interface AuthoritativeGazeStabilizationResult {
  readonly timestampMs: TimestampMs;
  readonly mode: AuthoritativeGazeStabilizationMode;

  /** Raw authoritative point is preserved verbatim for later re-analysis. */
  readonly rawNormalizedPoint: Point2D;
  readonly rawViewportPoint: Point2D | null;

  /** One-Euro derived stream used by fixation/AOI stages, never validation. */
  readonly stabilizedNormalizedPoint: Point2D | null;
  readonly stabilizedViewportPoint: Point2D | null;

  /** CSS viewport used for this pixel mapping. */
  readonly viewportSize: Size2D | null;

  readonly currentSampleValid: boolean;
  readonly sourceTimestampMs: TimestampMs | null;
  readonly visualAgeMs: number | null;

  /** Current-frame motion diagnostics for the upcoming fixation detector. */
  readonly deltaTimeMs: number | null;
  readonly rawSpeedPxPerSecond: number | null;
  readonly stabilizedSpeedPxPerSecond: number | null;
}

interface PreviousValidSample {
  readonly timestampMs: TimestampMs;
  readonly rawViewportPoint: Point2D;
  readonly stabilizedViewportPoint: Point2D;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function isFinitePositiveViewport(
  viewport: Size2D | null
): viewport is Size2D {
  return (
    viewport !== null
    && Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0
  );
}

function isFinitePoint(
  point: Point2D
): boolean {
  return (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function copyPoint(point: Point2D): Point2D {
  return {
    x: point.x,
    y: point.y
  };
}

function toViewportPoint(
  normalizedPoint: Point2D,
  viewport: Size2D
): Point2D {
  return {
    x: normalizedPoint.x * viewport.width,
    y: normalizedPoint.y * viewport.height
  };
}

function toNormalizedPoint(
  viewportPoint: Point2D,
  viewport: Size2D
): Point2D {
  return {
    x: viewportPoint.x / viewport.width,
    y: viewportPoint.y / viewport.height
  };
}

function speedPxPerSecond(
  previous: Point2D,
  current: Point2D,
  deltaTimeMs: number
): number | null {
  if (
    !Number.isFinite(deltaTimeMs)
    || deltaTimeMs <= 0
  ) {
    return null;
  }

  return (
    Math.hypot(
      current.x - previous.x,
      current.y - previous.y
    )
    / (deltaTimeMs / 1_000)
  );
}

/* ========================================================================== 
 * Authoritative runtime stabilizer
 * ======================================================================== */

/**
 * Research-safe temporal stabilization for the final authoritative gaze.
 *
 * Architectural boundaries:
 * - calibration and independent validation NEVER consume this output;
 * - raw authoritative gaze remains unchanged and is returned alongside it;
 * - the existing One-Euro viewport filter is reused rather than introducing
 *   a second independently tuned smoothing algorithm;
 * - short invalid gaps may visually hold the previous point, but held points
 *   have `currentSampleValid=false` and must not become fixation samples;
 * - the filter resets across missing viewport metadata or long invalid gaps.
 */
export class AuthoritativeGazeStabilizer {
  private readonly filter =
    new GazeFilter();

  private readonly outlierRejector =
    new GazeOutlierRejector();

  private previousValidSample:
    PreviousValidSample | null = null;

  private lastInputTimestampMs: number | null = null;
  private lastViewport: Size2D | null = null;

  public update(
    input: AuthoritativeGazeStabilizerInput
  ): AuthoritativeGazeStabilizationResult {
    const rawNormalizedPoint =
      copyPoint(input.normalizedPoint);

    if (
      !isFinitePositiveViewport(input.viewport)
      || !isFinitePoint(input.normalizedPoint)
      || !Number.isFinite(input.timestampMs)
      || input.timestampMs < 0
    ) {
      this.reset();

      return {
        timestampMs: input.timestampMs,
        mode: "UNAVAILABLE",
        rawNormalizedPoint,
        rawViewportPoint: null,
        stabilizedNormalizedPoint: null,
        stabilizedViewportPoint: null,
        viewportSize: null,
        currentSampleValid: false,
        sourceTimestampMs: null,
        visualAgeMs: null,
        deltaTimeMs: null,
        rawSpeedPxPerSecond: null,
        stabilizedSpeedPxPerSecond: null
      };
    }

    const viewport = input.viewport;
    const gapMs = this.lastInputTimestampMs === null
      ? null : input.timestampMs - this.lastInputTimestampMs;
    if (
      (gapMs !== null && (gapMs <= 0 || gapMs > GAZE_RUNTIME_DEFAULTS.MAX_VISUAL_HOLD_MS))
      || (this.lastViewport !== null
        && (viewport.width !== this.lastViewport.width || viewport.height !== this.lastViewport.height))
    ) {
      this.reset();
    }
    this.lastInputTimestampMs = input.timestampMs;
    this.lastViewport = { ...viewport };
    const rawViewportPoint =
      toViewportPoint(
        input.normalizedPoint,
        viewport
      );

    const outlierDecision =
      this.outlierRejector.update(
        input.timestampMs,
        rawViewportPoint,
        input.gazeValid
      );

    const filtered = this.filter.update({
      timestampMs: input.timestampMs,
      correctedViewportPoint:
        outlierDecision.point,
      gazeValid:
        input.gazeValid
        && outlierDecision.accepted,
      smoothingMultiplier:
        input.smoothingMultiplier ?? 1
    });

    const stabilizedViewportPoint =
      filtered.filteredViewportPoint === null
        ? null
        : copyPoint(
            filtered.filteredViewportPoint
          );

    const stabilizedNormalizedPoint =
      stabilizedViewportPoint === null
        ? null
        : toNormalizedPoint(
            stabilizedViewportPoint,
            viewport
          );

    let deltaTimeMs: number | null = null;
    let rawSpeed: number | null = null;
    let stabilizedSpeed: number | null = null;

    if (
      filtered.currentSampleValid
      && stabilizedViewportPoint !== null
    ) {
      const previous =
        this.previousValidSample;

      if (previous !== null) {
        deltaTimeMs =
          input.timestampMs
          - previous.timestampMs;

        rawSpeed = speedPxPerSecond(
          previous.rawViewportPoint,
          rawViewportPoint,
          deltaTimeMs
        );

        stabilizedSpeed = speedPxPerSecond(
          previous.stabilizedViewportPoint,
          stabilizedViewportPoint,
          deltaTimeMs
        );
      }

      this.previousValidSample = {
        timestampMs: input.timestampMs,
        rawViewportPoint:
          copyPoint(rawViewportPoint),
        stabilizedViewportPoint:
          copyPoint(stabilizedViewportPoint)
      };
    } else if (filtered.mode === "HIDDEN") {
      this.outlierRejector.reset();
      this.previousValidSample = null;
    }

    return {
      timestampMs: input.timestampMs,
      mode: filtered.mode,
      rawNormalizedPoint,
      rawViewportPoint:
        copyPoint(rawViewportPoint),
      stabilizedNormalizedPoint,
      stabilizedViewportPoint,
      viewportSize: { ...viewport },
      currentSampleValid:
        filtered.currentSampleValid,
      sourceTimestampMs:
        filtered.sourceTimestampMs,
      visualAgeMs:
        filtered.visualAgeMs,
      deltaTimeMs,
      rawSpeedPxPerSecond: rawSpeed,
      stabilizedSpeedPxPerSecond:
        stabilizedSpeed
    };
  }

  public reset(): void {
    this.lastInputTimestampMs = null;
    this.lastViewport = null;
    this.filter.reset();
    this.outlierRejector.reset();
    this.previousValidSample = null;
  }
}
