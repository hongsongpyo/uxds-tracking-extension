import {
  CALIBRATION,
  DEEP_PERSONALIZATION
} from "../shared/constants";

import type {
  GazeObserverRuntimeSample
} from "./gazePredictor";

function finiteSample(
  sample: GazeObserverRuntimeSample
): boolean {
  return (
    Number.isFinite(sample.prediction.timestampMs)
    && Number.isFinite(sample.prediction.rawPoint.x)
    && Number.isFinite(sample.prediction.rawPoint.y)
    && Number.isFinite(sample.geometry.headPose.yawDeg)
    && Number.isFinite(sample.geometry.headPose.pitchDeg)
    && Number.isFinite(sample.geometry.headPose.rollDeg)
    && Number.isFinite(sample.geometry.faceCenterNormalized.x)
    && Number.isFinite(sample.geometry.faceCenterNormalized.y)
    && Number.isFinite(sample.geometry.faceDistanceRatio)
  );
}

function shouldStartNewWindow(
  previous: GazeObserverRuntimeSample,
  current: GazeObserverRuntimeSample
): boolean {
  const gazeAngleDelta = Math.hypot(
    current.prediction.rawPoint.x - previous.prediction.rawPoint.x,
    current.prediction.rawPoint.y - previous.prediction.rawPoint.y
  );

  const headDelta = Math.max(
    Math.abs(
      current.geometry.headPose.yawDeg
        - previous.geometry.headPose.yawDeg
    ),
    Math.abs(
      current.geometry.headPose.pitchDeg
        - previous.geometry.headPose.pitchDeg
    ),
    Math.abs(
      current.geometry.headPose.rollDeg
        - previous.geometry.headPose.rollDeg
    )
  );

  const faceCenterDelta = Math.hypot(
    current.geometry.faceCenterNormalized.x
      - previous.geometry.faceCenterNormalized.x,
    current.geometry.faceCenterNormalized.y
      - previous.geometry.faceCenterNormalized.y
  );

  const distanceDelta = Math.abs(
    current.geometry.faceDistanceRatio
      - previous.geometry.faceDistanceRatio
  );

  return (
    gazeAngleDelta
      > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_GAZE_ANGLE_DELTA_RAD
    || headDelta
      > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_HEAD_DELTA_DEG
    || faceCenterDelta
      > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_FACE_CENTER_DELTA
    || distanceDelta
      > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_DISTANCE_DELTA
  );
}

/**
 * Keeps only a tiny, synchronized set of recent high-quality deep samples.
 * This removes the previous `[sample, sample]` pseudo-average while avoiding
 * long moving averages that would add visible saccade latency.
 */
export class RuntimeDeepFeatureAggregator {
  private readonly samples: GazeObserverRuntimeSample[] = [];

  private lastTimestampMs: number | null = null;

  public update(
    sample: GazeObserverRuntimeSample
  ): readonly GazeObserverRuntimeSample[] | null {
    if (
      !finiteSample(sample)
      || !sample.quality.usableForGaze
      || !sample.quality.faceValid
      || !sample.quality.eyesValid
      || sample.quality.blink
      || !Number.isFinite(sample.quality.qualityScore)
      || sample.quality.qualityScore < CALIBRATION.MIN_SAMPLE_QUALITY
      || !Number.isFinite(sample.prediction.confidence)
      || sample.prediction.confidence < 0
      || sample.prediction.confidence > 1
    ) {
      this.reset();
      return null;
    }

    const timestampMs = sample.prediction.timestampMs;

    if (
      this.lastTimestampMs !== null
      && timestampMs <= this.lastTimestampMs
    ) {
      this.reset();
    }

    const previous = this.samples.at(-1);

    if (
      previous !== undefined
      && shouldStartNewWindow(previous, sample)
    ) {
      this.samples.length = 0;
    }

    this.lastTimestampMs = timestampMs;
    this.samples.push(sample);

    const oldestAllowed =
      timestampMs
      - DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_AGE_MS;

    while (
      this.samples.length > 0
      && (this.samples[0]?.prediction.timestampMs ?? timestampMs)
        < oldestAllowed
    ) {
      this.samples.shift();
    }

    while (
      this.samples.length
        > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_SAMPLE_COUNT
    ) {
      this.samples.shift();
    }

    if (
      this.samples.length
        < DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MIN_SAMPLE_COUNT
    ) {
      return null;
    }

    return [...this.samples];
  }

  public reset(): void {
    this.samples.length = 0;
    this.lastTimestampMs = null;
  }
}
