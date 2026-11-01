import {
  GAZE_FILTER_DEFAULTS
} from "../shared/constants";

import type {
  Point2D
} from "../shared/types";

interface PendingJump {
  readonly timestampMs: number;
  readonly point: Point2D;
}

export interface GazeOutlierRejectorResult {
  readonly point: Point2D | null;
  readonly accepted: boolean;
  readonly heldForConfirmation: boolean;
  readonly isolatedSpikeRejected: boolean;
}

function distance(first: Point2D, second: Point2D): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

/** One-frame confirmation gate for very large isolated jumps. */
export class GazeOutlierRejector {
  private lastAccepted: Point2D | null = null;
  private pending: PendingJump | null = null;
  private lastTimestampMs: number | null = null;

  public update(
    timestampMs: number,
    point: Point2D | null,
    valid: boolean
  ): GazeOutlierRejectorResult {
    if (
      !valid
      || point === null
      || !Number.isFinite(timestampMs)
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
    ) {
      this.pending = null;
      return {
        point: null,
        accepted: false,
        heldForConfirmation: false,
        isolatedSpikeRejected: false
      };
    }

    if (
      this.lastTimestampMs !== null
      && timestampMs <= this.lastTimestampMs
    ) {
      this.reset();
    }
    this.lastTimestampMs = timestampMs;

    if (this.lastAccepted === null) {
      this.lastAccepted = { ...point };
      return {
        point: { ...point },
        accepted: true,
        heldForConfirmation: false,
        isolatedSpikeRejected: false
      };
    }

    const pending = this.pending;
    if (pending !== null) {
      const pendingAgeMs = timestampMs - pending.timestampMs;
      const confirmsJump =
        pendingAgeMs <= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_MAX_CONFIRM_MS
        && distance(point, pending.point)
          <= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_CONFIRM_RADIUS_PX;

      const returnedToPrevious =
        distance(point, this.lastAccepted)
          <= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_RETURN_RADIUS_PX;

      this.pending = null;

      if (confirmsJump || !returnedToPrevious) {
        this.lastAccepted = { ...point };
        return {
          point: { ...point },
          accepted: true,
          heldForConfirmation: false,
          isolatedSpikeRejected: false
        };
      }

      this.lastAccepted = { ...point };
      return {
        point: { ...point },
        accepted: true,
        heldForConfirmation: false,
        isolatedSpikeRejected: true
      };
    }

    if (
      distance(point, this.lastAccepted)
        >= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_JUMP_PX
    ) {
      this.pending = {
        timestampMs,
        point: { ...point }
      };
      return {
        point: null,
        accepted: false,
        heldForConfirmation: true,
        isolatedSpikeRejected: false
      };
    }

    this.lastAccepted = { ...point };
    return {
      point: { ...point },
      accepted: true,
      heldForConfirmation: false,
      isolatedSpikeRejected: false
    };
  }

  public reset(): void {
    this.lastAccepted = null;
    this.pending = null;
    this.lastTimestampMs = null;
  }
}
