import {
  GAZE_FILTER_DEFAULTS
} from "../shared/constants";

import type {
  Point2D,
  TimestampMs
} from "../shared/types";

export interface ResearchGazeDenoiserInput {
  readonly timestampMs: TimestampMs;
  readonly correctedViewportPoint: Point2D | null;
  readonly gazeValid: boolean;
}

export interface ResearchGazeDenoiserResult {
  /** Timestamp of the center sample in the five-sample causal buffer. */
  readonly timestampMs: TimestampMs;
  readonly denoisedViewportPoint: Point2D;
  readonly spikeRepaired: boolean;
}

interface BufferedPoint {
  readonly timestampMs: TimestampMs;
  readonly point: Point2D;
}

function distance(
  first: Point2D,
  second: Point2D
): number {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y
  );
}

function midpoint(
  first: Point2D,
  second: Point2D
): Point2D {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

/**
 * Conservative five-sample research denoiser.
 *
 * It intentionally does NOT smooth every sample. It only repairs an isolated
 * center spike when the samples immediately before/after remain spatially
 * close while the center deviates strongly from their midpoint. This keeps
 * sustained saccades intact better than a continuous low-pass filter.
 *
 * Raw gaze and calibration-validation metrics must remain untouched. This is
 * a derived stream for later fixation/dwell/scanpath processing.
 */
export class ResearchGazeDenoiser {
  private readonly buffer:
    BufferedPoint[] = [];

  private lastTimestampMs:
    TimestampMs | null = null;

  public update(
    input: ResearchGazeDenoiserInput
  ): ResearchGazeDenoiserResult | null {
    if (
      !Number.isFinite(input.timestampMs)
      || input.timestampMs < 0
      || !input.gazeValid
      || input.correctedViewportPoint === null
      || !Number.isFinite(input.correctedViewportPoint.x)
      || !Number.isFinite(input.correctedViewportPoint.y)
    ) {
      this.reset();
      return null;
    }

    if (
      this.lastTimestampMs !== null
      && input.timestampMs <= this.lastTimestampMs
    ) {
      this.reset();
    }

    this.lastTimestampMs = input.timestampMs;

    this.buffer.push({
      timestampMs: input.timestampMs,
      point: {
        ...input.correctedViewportPoint
      }
    });

    const windowSize =
      GAZE_FILTER_DEFAULTS.RESEARCH_DENOISE_WINDOW_SIZE;

    if (this.buffer.length < windowSize) {
      return null;
    }

    while (this.buffer.length > windowSize) {
      this.buffer.shift();
    }

    const before = this.buffer[1];
    const center = this.buffer[2];
    const after = this.buffer[3];

    if (
      before === undefined
      || center === undefined
      || after === undefined
    ) {
      return null;
    }

    const neighborDistance =
      distance(before.point, after.point);

    const expectedCenter =
      midpoint(before.point, after.point);

    const centerDeviation =
      distance(center.point, expectedCenter);

    const spikeRepaired =
      neighborDistance
        <= GAZE_FILTER_DEFAULTS
          .RESEARCH_SPIKE_NEIGHBOR_RADIUS_PX
      && centerDeviation
        >= GAZE_FILTER_DEFAULTS
          .RESEARCH_SPIKE_CENTER_DEVIATION_PX;

    return {
      timestampMs: center.timestampMs,
      denoisedViewportPoint:
        spikeRepaired
          ? expectedCenter
          : { ...center.point },
      spikeRepaired
    };
  }

  public reset(): void {
    this.buffer.length = 0;
    this.lastTimestampMs = null;
  }
}
