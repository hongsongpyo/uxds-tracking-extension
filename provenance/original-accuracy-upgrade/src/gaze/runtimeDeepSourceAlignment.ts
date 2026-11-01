import type { Point2D } from "../shared/types";
import type { GazeObserverRuntimeSample } from "./gazePredictor";

/** A saved baseline prediction from exactly one deep-observed source frame. */
export interface SynchronizedBaselineSample {
  readonly timestampMs: number;
  readonly normalizedPoint: Point2D;
}

/**
 * DeepPersonalMapper aggregates 2-3 source frames. The correction residual
 * must therefore be measured against baselines from THOSE SAME frames, not
 * against only the newest source frame. Mismatches return null, allowing the
 * established Baseline route to remain authoritative.
 *
 * This is a calibration-free time alignment operation. It never learns from
 * validation targets or clicks, and never changes the raw baseline values.
 */
export function meanSynchronizedSourceBaseline(
  deepFrames: readonly GazeObserverRuntimeSample[],
  baselineHistory: ReadonlyMap<number, SynchronizedBaselineSample>
): Point2D | null {
  if (deepFrames.length === 0) return null;
  let totalX = 0;
  let totalY = 0;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  const observedSequences = new Set<number>();
  for (const frame of deepFrames) {
    const { frameSequence, timestampMs } = frame.prediction;
    if (!Number.isSafeInteger(frameSequence) || frameSequence < 0
      || !Number.isFinite(timestampMs) || timestampMs <= previousTimestamp
      || observedSequences.has(frameSequence)) return null;
    const baseline = baselineHistory.get(frameSequence);
    if (baseline === undefined || baseline.timestampMs !== timestampMs
      || !Number.isFinite(baseline.normalizedPoint.x)
      || !Number.isFinite(baseline.normalizedPoint.y)) return null;
    observedSequences.add(frameSequence);
    totalX += baseline.normalizedPoint.x;
    totalY += baseline.normalizedPoint.y;
    previousTimestamp = timestampMs;
  }
  return {
    x: totalX / deepFrames.length,
    y: totalY / deepFrames.length
  };
}
