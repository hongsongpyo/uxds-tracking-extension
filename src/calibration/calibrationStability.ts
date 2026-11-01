import {
  CALIBRATION
} from "../shared/constants";

import type {
  CalibrationRawSample,
  FaceBaseline,
  HeadPose,
  Point2D
} from "../shared/types";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export type CalibrationStabilityFailureReason =
  | "TOO_FEW_SAMPLES"
  | "WINDOW_TOO_SHORT"
  | "GAZE_VELOCITY"
  | "GAZE_DISPERSION"
  | "HEAD_YAW"
  | "HEAD_PITCH"
  | "HEAD_ROLL"
  | "FACE_CENTER"
  | "FACE_DISTANCE"
  | "SPATIAL_OUTLIERS";

export interface CalibrationStabilityProfile {
  readonly effectiveSampleRateHz: number | null;
  readonly medianFrameIntervalMs: number | null;
  readonly windowMs: number;
  readonly minSampleCount: number;
  readonly maxFrameGapMs: number;
}

export interface CalibrationStabilityMetrics {
  readonly stable: boolean;
  readonly sampleCount: number;
  readonly candidateSampleCount: number;
  readonly durationMs: number;

  readonly gazeVelocityRmsNormalizedPerSecond: number;
  readonly gazeDispersionRmsNormalized: number;

  readonly yawSpanDeg: number;
  readonly pitchSpanDeg: number;
  readonly rollSpanDeg: number;

  readonly faceCenterSpanNormalized: number;
  readonly faceDistanceSpanRatio: number;

  /** Fraction of candidate samples retained by the calibration-only robust spatial gate. */
  readonly spatialInlierRatio: number;

  /** Cross-device cadence profile actually used for this stability decision. */
  readonly profile: CalibrationStabilityProfile;

  /** Explicit diagnostics so a failed point can be diagnosed on another host. */
  readonly failureReasons: readonly CalibrationStabilityFailureReason[];

  /**
   * Dimensionless lower-is-better score used only to rank candidate windows.
   * A score below 1 does not by itself imply stability; `stable` requires all
   * individual guards to pass.
   */
  readonly score: number;
}

export interface CalibrationStableWindow {
  readonly startTimestampMs: number;
  readonly endTimestampMs: number;
  readonly samples: readonly CalibrationRawSample[];
  readonly metrics: CalibrationStabilityMetrics;
}

export type CalibrationBaselineDriftReason =
  | "HEAD_POSE_DRIFT"
  | "FACE_POSITION_DRIFT";

/* ========================================================================== 
 * Numeric helpers
 * ======================================================================== */

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

function median(
  values: readonly number[]
): number | null {
  const finite = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (finite.length === 0) {
    return null;
  }

  const middle = Math.floor(finite.length / 2);

  if (finite.length % 2 === 1) {
    return finite[middle] ?? null;
  }

  const lower = finite[middle - 1];
  const upper = finite[middle];

  if (lower === undefined || upper === undefined) {
    return null;
  }

  return (lower + upper) / 2;
}

function finiteRange(
  values: readonly number[]
): number {
  const finite = values.filter(
    (value) => Number.isFinite(value)
  );

  if (finite.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let minimum = finite[0] ?? 0;
  let maximum = minimum;

  for (const value of finite) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  return maximum - minimum;
}

function rms(
  values: readonly number[]
): number {
  if (values.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let sumSquares = 0;

  for (const value of values) {
    sumSquares += value * value;
  }

  return Math.sqrt(
    sumSquares / values.length
  );
}

function meanPoint(
  points: readonly Point2D[]
): Point2D {
  let sumX = 0;
  let sumY = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
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

/**
 * V5 calibration-only temporal stabilizer. It never uses the calibration
 * target and never mutates/stores the raw sample. A centered median-of-three
 * trajectory suppresses one-frame alternation/spikes when evaluating fixation
 * stability on slower or noisier webcam hosts.
 */
function createTemporalMedianTrajectory(
  samples: readonly CalibrationRawSample[]
): Point2D[] {
  const radius =
    CALIBRATION.STABILITY_TEMPORAL_MEDIAN_RADIUS;

  if (radius <= 0 || samples.length <= 2) {
    return samples.map((sample) => ({
      ...sample.rawGazePoint
    }));
  }

  return samples.map((sample, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(samples.length, index + radius + 1);
    const window = samples.slice(start, end);
    const medianX = median(
      window.map((entry) => entry.rawGazePoint.x)
    );
    const medianY = median(
      window.map((entry) => entry.rawGazePoint.y)
    );

    return {
      x: medianX ?? sample.rawGazePoint.x,
      y: medianY ?? sample.rawGazePoint.y
    };
  });
}

function isUsableAcceptedSample(
  sample: CalibrationRawSample
): boolean {
  return (
    sample.accepted
    && sample.rawGazeSpace === "NORMALIZED"
    && Number.isFinite(sample.timestampMs)
    && Number.isFinite(sample.rawGazePoint.x)
    && Number.isFinite(sample.rawGazePoint.y)
    && Number.isFinite(sample.headPose.yawDeg)
    && Number.isFinite(sample.headPose.pitchDeg)
    && Number.isFinite(sample.headPose.rollDeg)
    && Number.isFinite(sample.faceDistanceRatio)
  );
}

function scoreRatio(
  value: number,
  threshold: number
): number {
  if (
    !Number.isFinite(value)
    || threshold <= 0
  ) {
    return 10;
  }

  return Math.min(
    10,
    value / threshold
  );
}

function getPositiveIntervalsMs(
  samples: readonly CalibrationRawSample[]
): number[] {
  const intervals: number[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    if (previous === undefined || current === undefined) {
      continue;
    }

    const deltaMs = current.timestampMs - previous.timestampMs;

    if (
      deltaMs > 0
      && deltaMs <= CALIBRATION.STABILITY_CADENCE_MAX_INTERVAL_MS
    ) {
      intervals.push(deltaMs);
    }
  }

  return intervals;
}

/**
 * Builds a cadence-aware stability profile.
 *
 * The old fixed rule required 10 samples inside 500 ms. That is physically
 * impossible below ~20 Hz even when the participant is perfectly still. The
 * profile keeps the original rule on healthy hosts and reduces only the sample
 * count / expands the temporal window when the measured baseline cadence is
 * lower. Spatial, gaze-velocity and head/face quality thresholds stay intact.
 */
export function createCalibrationStabilityProfile(
  inputSamples: readonly CalibrationRawSample[]
): CalibrationStabilityProfile {
  const samples = inputSamples
    .filter(isUsableAcceptedSample)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const medianFrameIntervalMs =
    median(getPositiveIntervalsMs(samples));

  if (
    medianFrameIntervalMs === null
    || medianFrameIntervalMs <= 0
  ) {
    return {
      effectiveSampleRateHz: null,
      medianFrameIntervalMs: null,
      windowMs: CALIBRATION.STABILITY_WINDOW_MS,
      minSampleCount: CALIBRATION.STABILITY_MIN_SAMPLE_COUNT,
      maxFrameGapMs: CALIBRATION.STABILITY_MAX_FRAME_GAP_MS
    };
  }

  const effectiveSampleRateHz = 1_000 / medianFrameIntervalMs;

  const minSampleCount = clamp(
    Math.round(
      effectiveSampleRateHz
      * CALIBRATION.STABILITY_ADAPTIVE_TARGET_DURATION_MS
      / 1_000
    ),
    CALIBRATION.STABILITY_ADAPTIVE_MIN_SAMPLE_COUNT,
    CALIBRATION.STABILITY_MIN_SAMPLE_COUNT
  );

  const spanForRequiredSamplesMs =
    Math.max(0, minSampleCount - 1)
    * medianFrameIntervalMs
    * CALIBRATION.STABILITY_ADAPTIVE_WINDOW_MARGIN;

  const windowMs = clamp(
    Math.max(
      CALIBRATION.STABILITY_WINDOW_MS,
      spanForRequiredSamplesMs
    ),
    CALIBRATION.STABILITY_WINDOW_MS,
    CALIBRATION.STABILITY_ADAPTIVE_MAX_WINDOW_MS
  );

  const maxFrameGapMs = clamp(
    Math.max(
      CALIBRATION.STABILITY_MAX_FRAME_GAP_MS,
      medianFrameIntervalMs
        * CALIBRATION.STABILITY_ADAPTIVE_FRAME_GAP_MULTIPLIER
    ),
    CALIBRATION.STABILITY_MAX_FRAME_GAP_MS,
    CALIBRATION.STABILITY_ADAPTIVE_MAX_FRAME_GAP_MS
  );

  return {
    effectiveSampleRateHz,
    medianFrameIntervalMs,
    windowMs,
    minSampleCount,
    maxFrameGapMs
  };
}

interface SpatialPrefilterResult {
  readonly samples: readonly CalibrationRawSample[];
  readonly inlierRatio: number;
}

/**
 * Removes isolated webcam-model spikes before the stability decision.
 * The target location is deliberately not used here, so this cannot force the
 * gaze toward the calibration target. It only asks whether the predictions
 * contain a dominant self-consistent fixation cluster.
 */
function spatialPrefilterCalibrationWindow(
  samples: readonly CalibrationRawSample[]
): SpatialPrefilterResult {
  if (samples.length === 0) {
    return {
      samples: [],
      inlierRatio: 0
    };
  }

  const medianX = median(
    samples.map((sample) => sample.rawGazePoint.x)
  );
  const medianY = median(
    samples.map((sample) => sample.rawGazePoint.y)
  );

  if (medianX === null || medianY === null) {
    return {
      samples,
      inlierRatio: 1
    };
  }

  const center: Point2D = {
    x: medianX,
    y: medianY
  };

  const radii = samples.map(
    (sample) => distance(sample.rawGazePoint, center)
  );

  const medianRadius = median(radii) ?? 0;
  const mad = median(
    radii.map((radius) => Math.abs(radius - medianRadius))
  ) ?? 0;

  const robustSigma = 1.4826 * mad;
  const allowedRadius =
    medianRadius
    + Math.max(
      CALIBRATION.STABILITY_PREFILTER_MIN_RADIUS_NORMALIZED,
      CALIBRATION.STABILITY_PREFILTER_MAD_SCALE * robustSigma
    );

  const inliers = samples.filter(
    (sample) =>
      distance(sample.rawGazePoint, center)
      <= allowedRadius
  );

  return {
    samples: inliers,
    inlierRatio: inliers.length / samples.length
  };
}

/* ========================================================================== 
 * Stability metrics
 * ======================================================================== */

export function evaluateCalibrationWindowStability(
  inputSamples: readonly CalibrationRawSample[],
  profileOverride?: CalibrationStabilityProfile,
  candidateSampleCountOverride?: number,
  spatialInlierRatioOverride?: number
): CalibrationStabilityMetrics {
  const samples = inputSamples
    .filter(isUsableAcceptedSample)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const profile =
    profileOverride
    ?? createCalibrationStabilityProfile(samples);

  const candidateSampleCount =
    candidateSampleCountOverride
    ?? samples.length;

  const spatialInlierRatio =
    spatialInlierRatioOverride
    ?? (candidateSampleCount > 0
      ? samples.length / candidateSampleCount
      : 0);

  if (samples.length === 0) {
    return {
      stable: false,
      sampleCount: 0,
      candidateSampleCount,
      durationMs: 0,
      gazeVelocityRmsNormalizedPerSecond:
        Number.POSITIVE_INFINITY,
      gazeDispersionRmsNormalized:
        Number.POSITIVE_INFINITY,
      yawSpanDeg:
        Number.POSITIVE_INFINITY,
      pitchSpanDeg:
        Number.POSITIVE_INFINITY,
      rollSpanDeg:
        Number.POSITIVE_INFINITY,
      faceCenterSpanNormalized:
        Number.POSITIVE_INFINITY,
      faceDistanceSpanRatio:
        Number.POSITIVE_INFINITY,
      spatialInlierRatio,
      profile,
      failureReasons: ["TOO_FEW_SAMPLES"],
      score:
        Number.POSITIVE_INFINITY
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];

  if (
    first === undefined
    || last === undefined
  ) {
    throw new Error(
      "Calibration stability window unexpectedly lost its edge samples."
    );
  }

  const durationMs =
    Math.max(
      0,
      last.timestampMs - first.timestampMs
    );

  const velocities: number[] = [];

  const stabilityPoints =
    createTemporalMedianTrajectory(samples);

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousPoint = stabilityPoints[index - 1];
    const currentPoint = stabilityPoints[index];

    if (
      previous === undefined
      || current === undefined
      || previousPoint === undefined
      || currentPoint === undefined
    ) {
      continue;
    }

    const deltaMs =
      current.timestampMs
      - previous.timestampMs;

    if (
      deltaMs <= 0
      || deltaMs > profile.maxFrameGapMs
    ) {
      continue;
    }

    velocities.push(
      distance(
        previousPoint,
        currentPoint
      )
      * 1_000
      / deltaMs
    );
  }

  const center =
    meanPoint(stabilityPoints);

  const gazeDispersionRmsNormalized =
    rms(
      stabilityPoints.map(
        (point) => distance(point, center)
      )
    );

  const gazeVelocityRmsNormalizedPerSecond =
    velocities.length > 0
      ? rms(velocities)
      : Number.POSITIVE_INFINITY;

  const yawSpanDeg =
    finiteRange(
      samples.map(
        (sample) => sample.headPose.yawDeg
      )
    );

  const pitchSpanDeg =
    finiteRange(
      samples.map(
        (sample) => sample.headPose.pitchDeg
      )
    );

  const rollSpanDeg =
    finiteRange(
      samples.map(
        (sample) => sample.headPose.rollDeg
      )
    );

  const centerSamples =
    samples
      .map(
        (sample) => sample.faceCenterNormalized
      )
      .filter(
        (point): point is Point2D =>
          point !== null
          && point !== undefined
          && Number.isFinite(point.x)
          && Number.isFinite(point.y)
      );

  const faceCenterSpanNormalized =
    centerSamples.length >= 2
      ? Math.hypot(
          finiteRange(
            centerSamples.map(
              (point) => point.x
            )
          ),
          finiteRange(
            centerSamples.map(
              (point) => point.y
            )
          )
        )
      : 0;

  const faceDistanceSpanRatio =
    finiteRange(
      samples.map(
        (sample) => sample.faceDistanceRatio
      )
    );

  const failureReasons: CalibrationStabilityFailureReason[] = [];

  if (samples.length < profile.minSampleCount) {
    failureReasons.push("TOO_FEW_SAMPLES");
  }

  if (
    durationMs
      < CALIBRATION.STABILITY_MIN_WINDOW_DURATION_MS
  ) {
    failureReasons.push("WINDOW_TOO_SHORT");
  }

  if (
    gazeVelocityRmsNormalizedPerSecond
      > CALIBRATION.STABILITY_MAX_GAZE_VELOCITY_RMS_PER_SEC
  ) {
    failureReasons.push("GAZE_VELOCITY");
  }

  if (
    gazeDispersionRmsNormalized
      > CALIBRATION.STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED
  ) {
    failureReasons.push("GAZE_DISPERSION");
  }

  if (yawSpanDeg > CALIBRATION.STABILITY_MAX_YAW_SPAN_DEG) {
    failureReasons.push("HEAD_YAW");
  }

  if (pitchSpanDeg > CALIBRATION.STABILITY_MAX_PITCH_SPAN_DEG) {
    failureReasons.push("HEAD_PITCH");
  }

  if (rollSpanDeg > CALIBRATION.STABILITY_MAX_ROLL_SPAN_DEG) {
    failureReasons.push("HEAD_ROLL");
  }

  if (
    faceCenterSpanNormalized
      > CALIBRATION.STABILITY_MAX_FACE_CENTER_SPAN_NORMALIZED
  ) {
    failureReasons.push("FACE_CENTER");
  }

  if (
    faceDistanceSpanRatio
      > CALIBRATION.STABILITY_MAX_FACE_DISTANCE_SPAN_RATIO
  ) {
    failureReasons.push("FACE_DISTANCE");
  }

  if (
    spatialInlierRatio
      < CALIBRATION.STABILITY_PREFILTER_MIN_INLIER_RATIO
  ) {
    failureReasons.push("SPATIAL_OUTLIERS");
  }

  const stable = failureReasons.length === 0;

  const outlierPenalty =
    1 - clamp(spatialInlierRatio, 0, 1);

  const score =
    (
      scoreRatio(
        gazeVelocityRmsNormalizedPerSecond,
        CALIBRATION.STABILITY_MAX_GAZE_VELOCITY_RMS_PER_SEC
      )
      + scoreRatio(
        gazeDispersionRmsNormalized,
        CALIBRATION.STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED
      )
      + scoreRatio(
        yawSpanDeg,
        CALIBRATION.STABILITY_MAX_YAW_SPAN_DEG
      )
      + scoreRatio(
        pitchSpanDeg,
        CALIBRATION.STABILITY_MAX_PITCH_SPAN_DEG
      )
      + scoreRatio(
        rollSpanDeg,
        CALIBRATION.STABILITY_MAX_ROLL_SPAN_DEG
      )
      + scoreRatio(
        faceCenterSpanNormalized,
        CALIBRATION.STABILITY_MAX_FACE_CENTER_SPAN_NORMALIZED
      )
      + scoreRatio(
        faceDistanceSpanRatio,
        CALIBRATION.STABILITY_MAX_FACE_DISTANCE_SPAN_RATIO
      )
      + outlierPenalty
    ) / 8;

  return {
    stable,
    sampleCount: samples.length,
    candidateSampleCount,
    durationMs,
    gazeVelocityRmsNormalizedPerSecond,
    gazeDispersionRmsNormalized,
    yawSpanDeg,
    pitchSpanDeg,
    rollSpanDeg,
    faceCenterSpanNormalized,
    faceDistanceSpanRatio,
    spatialInlierRatio,
    profile,
    failureReasons,
    score
  };
}

/**
 * Finds the most stable contiguous time window among accepted candidate
 * samples. On lower-rate hosts the temporal window and required sample count
 * adapt to the measured cadence. Isolated model spikes are robustly removed
 * before evaluating dispersion/velocity, while the target coordinate itself is
 * never used for this decision.
 */
function selectBestCalibrationWindow(
  inputSamples: readonly CalibrationRawSample[],
  requireStable: boolean
): CalibrationStableWindow | null {
  const samples = inputSamples
    .filter(isUsableAcceptedSample)
    .sort(
      (a, b) => a.timestampMs - b.timestampMs
    );

  const profile =
    createCalibrationStabilityProfile(samples);

  if (samples.length < profile.minSampleCount) {
    return null;
  }

  let best:
    CalibrationStableWindow | null = null;

  for (
    let endIndex = 0;
    endIndex < samples.length;
    endIndex += 1
  ) {
    const endSample = samples[endIndex];

    if (endSample === undefined) {
      continue;
    }

    const minimumTimestamp =
      endSample.timestampMs
      - profile.windowMs;

    let startIndex = endIndex;

    while (
      startIndex > 0
      && (samples[startIndex - 1]?.timestampMs
        ?? Number.NEGATIVE_INFINITY)
        >= minimumTimestamp
    ) {
      startIndex -= 1;
    }

    const candidateSamples =
      samples.slice(
        startIndex,
        endIndex + 1
      );

    if (candidateSamples.length < profile.minSampleCount) {
      continue;
    }

    const prefiltered =
      spatialPrefilterCalibrationWindow(
        candidateSamples
      );

    if (prefiltered.samples.length === 0) {
      continue;
    }

    const metrics =
      evaluateCalibrationWindowStability(
        prefiltered.samples,
        profile,
        candidateSamples.length,
        prefiltered.inlierRatio
      );

    if (requireStable && !metrics.stable) {
      continue;
    }

    const startSample = prefiltered.samples[0];
    const lastSample =
      prefiltered.samples[prefiltered.samples.length - 1];

    if (
      startSample === undefined
      || lastSample === undefined
    ) {
      continue;
    }

    const candidate: CalibrationStableWindow = {
      startTimestampMs:
        startSample.timestampMs,
      endTimestampMs:
        lastSample.timestampMs,
      samples: prefiltered.samples,
      metrics
    };

    if (
      best === null
      || candidate.metrics.score
        < best.metrics.score
      || (
        candidate.metrics.score
          === best.metrics.score
        && candidate.samples.length
          > best.samples.length
      )
    ) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Returns only a window that passes every stability guard.
 */
export function selectBestCalibrationStableWindow(
  inputSamples: readonly CalibrationRawSample[]
): CalibrationStableWindow | null {
  return selectBestCalibrationWindow(
    inputSamples,
    true
  );
}

/**
 * Returns the best available candidate even when it is not stable. This is
 * diagnostics-only and is never used as training data unless the same window
 * also passes selectBestCalibrationStableWindow().
 */
export function selectBestCalibrationCandidateWindow(
  inputSamples: readonly CalibrationRawSample[]
): CalibrationStableWindow | null {
  return selectBestCalibrationWindow(
    inputSamples,
    false
  );
}

/* ========================================================================== 
 * Baseline drift gate
 * ======================================================================== */

function absPoseDelta(
  current: HeadPose,
  baseline: HeadPose
): HeadPose {
  return {
    yawDeg:
      Math.abs(
        current.yawDeg
        - baseline.yawDeg
      ),
    pitchDeg:
      Math.abs(
        current.pitchDeg
        - baseline.pitchDeg
      ),
    rollDeg:
      Math.abs(
        current.rollDeg
        - baseline.rollDeg
      )
  };
}

export function getCalibrationBaselineDriftReason(
  baseline: FaceBaseline | null,
  sample: {
    readonly headPose: HeadPose;
    readonly faceDistanceRatio: number;
    readonly faceCenterNormalized?: Point2D | null;
  }
): CalibrationBaselineDriftReason | null {
  if (baseline === null) {
    return null;
  }

  const poseDelta =
    absPoseDelta(
      sample.headPose,
      baseline.headPose
    );

  if (
    poseDelta.yawDeg
      > CALIBRATION.BASELINE_MAX_YAW_DELTA_DEG
    || poseDelta.pitchDeg
      > CALIBRATION.BASELINE_MAX_PITCH_DELTA_DEG
    || poseDelta.rollDeg
      > CALIBRATION.BASELINE_MAX_ROLL_DELTA_DEG
  ) {
    return "HEAD_POSE_DRIFT";
  }

  const faceCenter =
    sample.faceCenterNormalized;

  const centerTooFar =
    faceCenter !== null
    && faceCenter !== undefined
    && (
      Math.abs(
        faceCenter.x - baseline.centerX
      )
        > CALIBRATION.BASELINE_MAX_FACE_CENTER_DELTA_NORMALIZED
      || Math.abs(
        faceCenter.y - baseline.centerY
      )
        > CALIBRATION.BASELINE_MAX_FACE_CENTER_DELTA_NORMALIZED
    );

  const distanceTooFar =
    Number.isFinite(sample.faceDistanceRatio)
    && Math.abs(
      sample.faceDistanceRatio
      - baseline.distanceRatio
    )
      > CALIBRATION.BASELINE_MAX_FACE_DISTANCE_DELTA_RATIO;

  if (
    centerTooFar
    || distanceTooFar
  ) {
    return "FACE_POSITION_DRIFT";
  }

  return null;
}
