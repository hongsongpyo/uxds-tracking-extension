import {
  createLogger
} from "../chunks/chunk-ROMKNLNQ.js";
import {
  AOI,
  BLINK_THRESHOLDS,
  CALIBRATION,
  CALIBRATION_VALIDATION_THRESHOLDS,
  CAMERA_QUALITY_SAMPLING,
  CAMERA_QUALITY_THRESHOLDS,
  CAMERA_RUNTIME,
  DEEP_PERSONALIZATION,
  DRIFT_THRESHOLDS,
  ERROR_CODES,
  EYE_GEOMETRY_RUNTIME,
  FACE_GEOMETRY_RUNTIME,
  FACE_LANDMARKER_RUNTIME,
  FACE_LANDMARK_INDICES,
  FACE_PIPELINE_RUNTIME,
  FACE_POSITION_THRESHOLDS,
  FACE_QUALITY_RUNTIME,
  FACE_QUALITY_THRESHOLDS,
  FIXATION_DEFAULTS,
  GAZE_FILTER_DEFAULTS,
  GAZE_QUALITY_RUNTIME,
  GAZE_QUALITY_THRESHOLDS,
  GAZE_RUNTIME_DEFAULTS,
  GAZE_VALIDATION_DEFAULTS,
  HEAD_POSE_RUNTIME,
  L2CS_GAZE_MODEL,
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  NORMALIZED_COORDINATE,
  NUMERIC_EPSILON,
  ONNX_RUNTIME_WEB,
  PRE_CALIBRATION_RUNTIME,
  QUICK_RECALIBRATION,
  RUNTIME_MAINTENANCE,
  TIME,
  TrackerError,
  WEB_EYE_TRACK_RUNTIME,
  clamp01,
  createCameraConstraints,
  createFixationId,
  createMessageId,
  createRuntimeMessage,
  distance2D,
  getUnknownErrorMessage,
  isCameraRequest,
  isCompatibleMessageProtocol,
  isFiniteNumber,
  isMessageType,
  isNonEmptyString,
  isNormalizedPoint,
  isNullableFiniteNumber,
  isNullableString,
  isRecord,
  isTrackerError,
  normalizeCameraError,
  normalizeTrackerError,
  nowEpochMs,
  nowTimelineMs,
  readActualCameraSettings,
  sleep
} from "../chunks/chunk-6TH637DM.js";
import "../chunks/chunk-NRCRLAHV.js";

// src/camera/cameraManager.ts
var logger = createLogger("CAMERA");
var CameraManager = class {
  constructor(videoElement, onDisconnected = null) {
    this.videoElement = videoElement;
    this.onDisconnected = onDisconnected;
  }
  videoElement;
  onDisconnected;
  lifecycle = "IDLE";
  stream = null;
  videoTrack = null;
  settings = null;
  startPromise = null;
  /* ========================================================================
   * Start
   * ====================================================================== */
  start(request) {
    this.assertNotDisposed();
    if (this.lifecycle === "RUNNING" && this.settings !== null) {
      return Promise.resolve({
        ...this.settings
      });
    }
    if (this.startPromise !== null) {
      return this.startPromise;
    }
    const pending = this.startInternal(request);
    this.startPromise = pending;
    const clearStartPromise = () => {
      if (this.startPromise === pending) {
        this.startPromise = null;
      }
    };
    void pending.then(
      clearStartPromise,
      clearStartPromise
    );
    return pending;
  }
  async startInternal(request) {
    if (this.lifecycle === "STOPPING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CAMERA",
        "Camera cannot start while it is stopping."
      );
    }
    this.lifecycle = "STARTING";
    try {
      const mediaDevices = globalThis.navigator.mediaDevices;
      if (mediaDevices === void 0 || typeof mediaDevices.getUserMedia !== "function") {
        throw new TrackerError(
          ERROR_CODES.CAMERA_START_FAILED,
          "CAMERA",
          "MediaDevices.getUserMedia() is unavailable in the Offscreen runtime."
        );
      }
      const acquiredStream = await mediaDevices.getUserMedia(
        createCameraConstraints(
          request
        )
      );
      this.stream = acquiredStream;
      if (this.lifecycle !== "STARTING") {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "CAMERA",
          "Camera startup was cancelled before getUserMedia() completed.",
          {
            details: {
              lifecycle: this.lifecycle
            }
          }
        );
      }
      const videoTracks = acquiredStream.getVideoTracks();
      const track = videoTracks[0];
      if (track === void 0) {
        throw new TrackerError(
          ERROR_CODES.CAMERA_NOT_FOUND,
          "CAMERA",
          "getUserMedia() returned no video track."
        );
      }
      this.videoTrack = track;
      track.addEventListener(
        "ended",
        this.handleTrackEnded
      );
      this.videoElement.srcObject = acquiredStream;
      await this.videoElement.play();
      await this.waitForVideoReady();
      if (track.readyState !== "live") {
        throw new TrackerError(
          ERROR_CODES.CAMERA_DISCONNECTED,
          "CAMERA",
          "Camera track ended during startup."
        );
      }
      const actualSettings = readActualCameraSettings(
        track,
        this.videoElement,
        request
      );
      this.settings = {
        ...actualSettings
      };
      this.lifecycle = "RUNNING";
      logger.info(
        "Camera started.",
        {
          width: actualSettings.width,
          height: actualSettings.height,
          frameRate: actualSettings.frameRate
        }
      );
      return {
        ...actualSettings
      };
    } catch (error) {
      const disposed = this.isDisposedLifecycle();
      this.releaseCurrentStream();
      if (!disposed) {
        this.lifecycle = "IDLE";
      }
      throw normalizeCameraError(
        error
      );
    }
  }
  /* ========================================================================
   * Runtime state
   * ====================================================================== */
  isRunning() {
    return this.lifecycle === "RUNNING" && this.videoTrack !== null && this.videoTrack.readyState === "live";
  }
  getSettings() {
    if (this.settings === null) {
      return null;
    }
    return {
      ...this.settings
    };
  }
  getSnapshot() {
    return {
      lifecycle: this.lifecycle,
      running: this.isRunning(),
      settings: this.getSettings()
    };
  }
  /* ========================================================================
   * Stop / disposal
   * ====================================================================== */
  stop() {
    if (this.lifecycle === "DISPOSED" || this.lifecycle === "IDLE") {
      return;
    }
    this.lifecycle = "STOPPING";
    try {
      this.releaseCurrentStream();
      this.lifecycle = "IDLE";
      logger.info(
        "Camera stopped."
      );
    } catch (error) {
      this.lifecycle = "IDLE";
      throw normalizeTrackerError(
        error,
        ERROR_CODES.CAMERA_START_FAILED,
        "CAMERA",
        "Camera cleanup failed."
      );
    }
  }
  dispose() {
    if (this.lifecycle === "DISPOSED") {
      return;
    }
    this.stop();
    this.lifecycle = "DISPOSED";
  }
  /* ========================================================================
   * Video readiness
   * ====================================================================== */
  waitForVideoReady() {
    if (this.isVideoReady()) {
      return Promise.resolve();
    }
    return new Promise(
      (resolve, reject) => {
        const cleanup = () => {
          globalThis.clearTimeout(
            timeoutId
          );
          this.videoElement.removeEventListener(
            "loadeddata",
            handleReady
          );
          this.videoElement.removeEventListener(
            "canplay",
            handleReady
          );
        };
        const handleReady = () => {
          if (!this.isVideoReady()) {
            return;
          }
          cleanup();
          resolve();
        };
        const timeoutId = globalThis.setTimeout(
          () => {
            cleanup();
            reject(
              new TrackerError(
                ERROR_CODES.CAMERA_START_FAILED,
                "CAMERA",
                "Camera video did not become ready before the startup timeout.",
                {
                  details: {
                    timeoutMs: CAMERA_RUNTIME.VIDEO_READY_TIMEOUT_MS,
                    readyState: this.videoElement.readyState,
                    videoWidth: this.videoElement.videoWidth,
                    videoHeight: this.videoElement.videoHeight
                  }
                }
              )
            );
          },
          CAMERA_RUNTIME.VIDEO_READY_TIMEOUT_MS
        );
        this.videoElement.addEventListener(
          "loadeddata",
          handleReady
        );
        this.videoElement.addEventListener(
          "canplay",
          handleReady
        );
      }
    );
  }
  isVideoReady() {
    return this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0;
  }
  /* ========================================================================
   * Unexpected disconnection
   * ====================================================================== */
  handleTrackEnded = () => {
    if (this.lifecycle === "STOPPING" || this.lifecycle === "DISPOSED") {
      return;
    }
    this.releaseCurrentStream();
    this.lifecycle = "IDLE";
    const error = new TrackerError(
      ERROR_CODES.CAMERA_DISCONNECTED,
      "CAMERA",
      "The active camera stream ended unexpectedly."
    );
    logger.warn(
      "Camera disconnected unexpectedly."
    );
    if (this.onDisconnected === null) {
      return;
    }
    try {
      this.onDisconnected(error);
    } catch (callbackError) {
      logger.error(
        "Camera disconnect handler failed.",
        {
          message: callbackError instanceof Error ? callbackError.message : "Unknown disconnect-handler error"
        }
      );
    }
  };
  /* ========================================================================
   * Stream cleanup
   * ====================================================================== */
  releaseCurrentStream() {
    const track = this.videoTrack;
    if (track !== null) {
      track.removeEventListener(
        "ended",
        this.handleTrackEnded
      );
    }
    const stream = this.stream;
    this.videoTrack = null;
    this.stream = null;
    this.settings = null;
    if (stream !== null) {
      for (const mediaTrack of stream.getTracks()) {
        mediaTrack.stop();
      }
    }
    this.videoElement.pause();
    if (this.videoElement.srcObject !== null) {
      this.videoElement.srcObject = null;
    }
  }
  /* ========================================================================
   * Guards
   * ====================================================================== */
  isDisposedLifecycle() {
    return this.lifecycle === "DISPOSED";
  }
  assertNotDisposed() {
    if (this.lifecycle !== "DISPOSED") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CAMERA",
      "Disposed CameraManager cannot be used."
    );
  }
};

// src/calibration/calibrationStability.ts
function clamp(value, minimum, maximum) {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}
function median(values) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a2, b2) => a2 - b2);
  if (finite.length === 0) {
    return null;
  }
  const middle = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) {
    return finite[middle] ?? null;
  }
  const lower = finite[middle - 1];
  const upper = finite[middle];
  if (lower === void 0 || upper === void 0) {
    return null;
  }
  return (lower + upper) / 2;
}
function finiteRange(values) {
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
function rms(values) {
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
function meanPoint(points) {
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
function distance(first, second) {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y
  );
}
function createTemporalMedianTrajectory(samples) {
  const radius = CALIBRATION.STABILITY_TEMPORAL_MEDIAN_RADIUS;
  if (radius <= 0 || samples.length <= 2) {
    return samples.map((sample) => ({
      ...sample.rawGazePoint
    }));
  }
  return samples.map((sample, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(samples.length, index + radius + 1);
    const window2 = samples.slice(start, end);
    const medianX = median(
      window2.map((entry) => entry.rawGazePoint.x)
    );
    const medianY = median(
      window2.map((entry) => entry.rawGazePoint.y)
    );
    return {
      x: medianX ?? sample.rawGazePoint.x,
      y: medianY ?? sample.rawGazePoint.y
    };
  });
}
function isUsableAcceptedSample(sample) {
  return sample.accepted && sample.rawGazeSpace === "NORMALIZED" && Number.isFinite(sample.timestampMs) && Number.isFinite(sample.rawGazePoint.x) && Number.isFinite(sample.rawGazePoint.y) && Number.isFinite(sample.headPose.yawDeg) && Number.isFinite(sample.headPose.pitchDeg) && Number.isFinite(sample.headPose.rollDeg) && Number.isFinite(sample.faceDistanceRatio);
}
function scoreRatio(value, threshold) {
  if (!Number.isFinite(value) || threshold <= 0) {
    return 10;
  }
  return Math.min(
    10,
    value / threshold
  );
}
function getPositiveIntervalsMs(samples) {
  const intervals = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === void 0 || current === void 0) {
      continue;
    }
    const deltaMs = current.timestampMs - previous.timestampMs;
    if (deltaMs > 0 && deltaMs <= CALIBRATION.STABILITY_CADENCE_MAX_INTERVAL_MS) {
      intervals.push(deltaMs);
    }
  }
  return intervals;
}
function createCalibrationStabilityProfile(inputSamples) {
  const samples = inputSamples.filter(isUsableAcceptedSample).sort((a2, b2) => a2.timestampMs - b2.timestampMs);
  const medianFrameIntervalMs = median(getPositiveIntervalsMs(samples));
  if (medianFrameIntervalMs === null || medianFrameIntervalMs <= 0) {
    return {
      effectiveSampleRateHz: null,
      medianFrameIntervalMs: null,
      windowMs: CALIBRATION.STABILITY_WINDOW_MS,
      minSampleCount: CALIBRATION.STABILITY_MIN_SAMPLE_COUNT,
      maxFrameGapMs: CALIBRATION.STABILITY_MAX_FRAME_GAP_MS
    };
  }
  const effectiveSampleRateHz = 1e3 / medianFrameIntervalMs;
  const minSampleCount = clamp(
    Math.round(
      effectiveSampleRateHz * CALIBRATION.STABILITY_ADAPTIVE_TARGET_DURATION_MS / 1e3
    ),
    CALIBRATION.STABILITY_ADAPTIVE_MIN_SAMPLE_COUNT,
    CALIBRATION.STABILITY_MIN_SAMPLE_COUNT
  );
  const spanForRequiredSamplesMs = Math.max(0, minSampleCount - 1) * medianFrameIntervalMs * CALIBRATION.STABILITY_ADAPTIVE_WINDOW_MARGIN;
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
      medianFrameIntervalMs * CALIBRATION.STABILITY_ADAPTIVE_FRAME_GAP_MULTIPLIER
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
function spatialPrefilterCalibrationWindow(samples) {
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
  const center = {
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
  const allowedRadius = medianRadius + Math.max(
    CALIBRATION.STABILITY_PREFILTER_MIN_RADIUS_NORMALIZED,
    CALIBRATION.STABILITY_PREFILTER_MAD_SCALE * robustSigma
  );
  const inliers = samples.filter(
    (sample) => distance(sample.rawGazePoint, center) <= allowedRadius
  );
  return {
    samples: inliers,
    inlierRatio: inliers.length / samples.length
  };
}
function evaluateCalibrationWindowStability(inputSamples, profileOverride, candidateSampleCountOverride, spatialInlierRatioOverride) {
  const samples = inputSamples.filter(isUsableAcceptedSample).sort((a2, b2) => a2.timestampMs - b2.timestampMs);
  const profile = profileOverride ?? createCalibrationStabilityProfile(samples);
  const candidateSampleCount = candidateSampleCountOverride ?? samples.length;
  const spatialInlierRatio = spatialInlierRatioOverride ?? (candidateSampleCount > 0 ? samples.length / candidateSampleCount : 0);
  if (samples.length === 0) {
    return {
      stable: false,
      sampleCount: 0,
      candidateSampleCount,
      durationMs: 0,
      gazeVelocityRmsNormalizedPerSecond: Number.POSITIVE_INFINITY,
      gazeDispersionRmsNormalized: Number.POSITIVE_INFINITY,
      yawSpanDeg: Number.POSITIVE_INFINITY,
      pitchSpanDeg: Number.POSITIVE_INFINITY,
      rollSpanDeg: Number.POSITIVE_INFINITY,
      faceCenterSpanNormalized: Number.POSITIVE_INFINITY,
      faceDistanceSpanRatio: Number.POSITIVE_INFINITY,
      spatialInlierRatio,
      profile,
      failureReasons: ["TOO_FEW_SAMPLES"],
      score: Number.POSITIVE_INFINITY
    };
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === void 0 || last === void 0) {
    throw new Error(
      "Calibration stability window unexpectedly lost its edge samples."
    );
  }
  const durationMs = Math.max(
    0,
    last.timestampMs - first.timestampMs
  );
  const velocities = [];
  const stabilityPoints = createTemporalMedianTrajectory(samples);
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousPoint = stabilityPoints[index - 1];
    const currentPoint = stabilityPoints[index];
    if (previous === void 0 || current === void 0 || previousPoint === void 0 || currentPoint === void 0) {
      continue;
    }
    const deltaMs = current.timestampMs - previous.timestampMs;
    if (deltaMs <= 0 || deltaMs > profile.maxFrameGapMs) {
      continue;
    }
    velocities.push(
      distance(
        previousPoint,
        currentPoint
      ) * 1e3 / deltaMs
    );
  }
  const center = meanPoint(stabilityPoints);
  const gazeDispersionRmsNormalized = rms(
    stabilityPoints.map(
      (point) => distance(point, center)
    )
  );
  const gazeVelocityRmsNormalizedPerSecond = velocities.length > 0 ? rms(velocities) : Number.POSITIVE_INFINITY;
  const yawSpanDeg = finiteRange(
    samples.map(
      (sample) => sample.headPose.yawDeg
    )
  );
  const pitchSpanDeg = finiteRange(
    samples.map(
      (sample) => sample.headPose.pitchDeg
    )
  );
  const rollSpanDeg = finiteRange(
    samples.map(
      (sample) => sample.headPose.rollDeg
    )
  );
  const centerSamples = samples.map(
    (sample) => sample.faceCenterNormalized
  ).filter(
    (point) => point !== null && point !== void 0 && Number.isFinite(point.x) && Number.isFinite(point.y)
  );
  const faceCenterSpanNormalized = centerSamples.length >= 2 ? Math.hypot(
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
  ) : 0;
  const faceDistanceSpanRatio = finiteRange(
    samples.map(
      (sample) => sample.faceDistanceRatio
    )
  );
  const failureReasons = [];
  if (samples.length < profile.minSampleCount) {
    failureReasons.push("TOO_FEW_SAMPLES");
  }
  if (durationMs < CALIBRATION.STABILITY_MIN_WINDOW_DURATION_MS) {
    failureReasons.push("WINDOW_TOO_SHORT");
  }
  if (gazeVelocityRmsNormalizedPerSecond > CALIBRATION.STABILITY_MAX_GAZE_VELOCITY_RMS_PER_SEC) {
    failureReasons.push("GAZE_VELOCITY");
  }
  if (gazeDispersionRmsNormalized > CALIBRATION.STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED) {
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
  if (faceCenterSpanNormalized > CALIBRATION.STABILITY_MAX_FACE_CENTER_SPAN_NORMALIZED) {
    failureReasons.push("FACE_CENTER");
  }
  if (faceDistanceSpanRatio > CALIBRATION.STABILITY_MAX_FACE_DISTANCE_SPAN_RATIO) {
    failureReasons.push("FACE_DISTANCE");
  }
  if (spatialInlierRatio < CALIBRATION.STABILITY_PREFILTER_MIN_INLIER_RATIO) {
    failureReasons.push("SPATIAL_OUTLIERS");
  }
  const stable = failureReasons.length === 0;
  const outlierPenalty = 1 - clamp(spatialInlierRatio, 0, 1);
  const score = (scoreRatio(
    gazeVelocityRmsNormalizedPerSecond,
    CALIBRATION.STABILITY_MAX_GAZE_VELOCITY_RMS_PER_SEC
  ) + scoreRatio(
    gazeDispersionRmsNormalized,
    CALIBRATION.STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED
  ) + scoreRatio(
    yawSpanDeg,
    CALIBRATION.STABILITY_MAX_YAW_SPAN_DEG
  ) + scoreRatio(
    pitchSpanDeg,
    CALIBRATION.STABILITY_MAX_PITCH_SPAN_DEG
  ) + scoreRatio(
    rollSpanDeg,
    CALIBRATION.STABILITY_MAX_ROLL_SPAN_DEG
  ) + scoreRatio(
    faceCenterSpanNormalized,
    CALIBRATION.STABILITY_MAX_FACE_CENTER_SPAN_NORMALIZED
  ) + scoreRatio(
    faceDistanceSpanRatio,
    CALIBRATION.STABILITY_MAX_FACE_DISTANCE_SPAN_RATIO
  ) + outlierPenalty) / 8;
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
function selectBestCalibrationWindow(inputSamples, requireStable) {
  const samples = inputSamples.filter(isUsableAcceptedSample).sort(
    (a2, b2) => a2.timestampMs - b2.timestampMs
  );
  const profile = createCalibrationStabilityProfile(samples);
  if (samples.length < profile.minSampleCount) {
    return null;
  }
  let best = null;
  for (let endIndex = 0; endIndex < samples.length; endIndex += 1) {
    const endSample = samples[endIndex];
    if (endSample === void 0) {
      continue;
    }
    const minimumTimestamp = endSample.timestampMs - profile.windowMs;
    let startIndex = endIndex;
    while (startIndex > 0 && (samples[startIndex - 1]?.timestampMs ?? Number.NEGATIVE_INFINITY) >= minimumTimestamp) {
      startIndex -= 1;
    }
    const candidateSamples = samples.slice(
      startIndex,
      endIndex + 1
    );
    if (candidateSamples.length < profile.minSampleCount) {
      continue;
    }
    const prefiltered = spatialPrefilterCalibrationWindow(
      candidateSamples
    );
    if (prefiltered.samples.length === 0) {
      continue;
    }
    const metrics = evaluateCalibrationWindowStability(
      prefiltered.samples,
      profile,
      candidateSamples.length,
      prefiltered.inlierRatio
    );
    if (requireStable && !metrics.stable) {
      continue;
    }
    const startSample = prefiltered.samples[0];
    const lastSample = prefiltered.samples[prefiltered.samples.length - 1];
    if (startSample === void 0 || lastSample === void 0) {
      continue;
    }
    const candidate = {
      startTimestampMs: startSample.timestampMs,
      endTimestampMs: lastSample.timestampMs,
      samples: prefiltered.samples,
      metrics
    };
    if (best === null || candidate.metrics.score < best.metrics.score || candidate.metrics.score === best.metrics.score && candidate.samples.length > best.samples.length) {
      best = candidate;
    }
  }
  return best;
}
function selectBestCalibrationStableWindow(inputSamples) {
  return selectBestCalibrationWindow(
    inputSamples,
    true
  );
}
function selectBestCalibrationCandidateWindow(inputSamples) {
  return selectBestCalibrationWindow(
    inputSamples,
    false
  );
}
function absPoseDelta(current, baseline) {
  return {
    yawDeg: Math.abs(
      current.yawDeg - baseline.yawDeg
    ),
    pitchDeg: Math.abs(
      current.pitchDeg - baseline.pitchDeg
    ),
    rollDeg: Math.abs(
      current.rollDeg - baseline.rollDeg
    )
  };
}
function getCalibrationBaselineDriftReason(baseline, sample) {
  if (baseline === null) {
    return null;
  }
  const poseDelta = absPoseDelta(
    sample.headPose,
    baseline.headPose
  );
  if (poseDelta.yawDeg > CALIBRATION.BASELINE_MAX_YAW_DELTA_DEG || poseDelta.pitchDeg > CALIBRATION.BASELINE_MAX_PITCH_DELTA_DEG || poseDelta.rollDeg > CALIBRATION.BASELINE_MAX_ROLL_DELTA_DEG) {
    return "HEAD_POSE_DRIFT";
  }
  const faceCenter = sample.faceCenterNormalized;
  const centerTooFar = faceCenter !== null && faceCenter !== void 0 && (Math.abs(
    faceCenter.x - baseline.centerX
  ) > CALIBRATION.BASELINE_MAX_FACE_CENTER_DELTA_NORMALIZED || Math.abs(
    faceCenter.y - baseline.centerY
  ) > CALIBRATION.BASELINE_MAX_FACE_CENTER_DELTA_NORMALIZED);
  const distanceTooFar = Number.isFinite(sample.faceDistanceRatio) && Math.abs(
    sample.faceDistanceRatio - baseline.distanceRatio
  ) > CALIBRATION.BASELINE_MAX_FACE_DISTANCE_DELTA_RATIO;
  if (centerTooFar || distanceTooFar) {
    return "FACE_POSITION_DRIFT";
  }
  return null;
}

// src/calibration/calibrationCollector.ts
var logger2 = createLogger("CALIBRATION");
function isFiniteTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}
function calculateRejectionRatio(accepted, rejected) {
  const total = accepted + rejected;
  if (total === 0) {
    return 0;
  }
  return rejected / total;
}
var CalibrationCollector = class {
  calibrationId = null;
  target = null;
  targetShownAtMs = null;
  samples = [];
  acceptedSampleCount = 0;
  rejectedSampleCount = 0;
  observedPredictionTimestampsMs = [];
  rejectionReasonCounts = {};
  faceBaseline = null;
  beginPoint(calibrationId, target, targetShownAtMs, faceBaseline = null) {
    if (calibrationId.length === 0 || !Number.isInteger(target.pointIndex) || target.pointIndex < 0 || !isFiniteTimestamp(targetShownAtMs)) {
      throw new RangeError(
        "CalibrationCollector.beginPoint() received invalid point metadata."
      );
    }
    this.calibrationId = calibrationId;
    this.target = target;
    this.targetShownAtMs = targetShownAtMs;
    this.samples = [];
    this.acceptedSampleCount = 0;
    this.rejectedSampleCount = 0;
    this.observedPredictionTimestampsMs = [];
    this.rejectionReasonCounts = {};
    this.faceBaseline = faceBaseline === null ? null : {
      ...faceBaseline,
      headPose: {
        ...faceBaseline.headPose
      }
    };
  }
  observe(observation) {
    const calibrationId = this.calibrationId;
    const target = this.target;
    const targetShownAtMs = this.targetShownAtMs;
    if (calibrationId === null || target === null || targetShownAtMs === null) {
      return this.createDecision(
        "IDLE",
        false,
        false,
        null
      );
    }
    const timestampMs = observation.prediction.timestampMs;
    if (timestampMs >= targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS) {
      const previousTimestampMs = this.observedPredictionTimestampsMs.at(-1);
      if (previousTimestampMs === void 0 || timestampMs > previousTimestampMs) {
        this.observedPredictionTimestampsMs.push(timestampMs);
      }
    }
    if (!isFiniteTimestamp(timestampMs)) {
      return this.storeRejectedObservation(
        observation,
        "GAZE_INVALID"
      );
    }
    const elapsedMs = timestampMs - targetShownAtMs;
    if (elapsedMs < 0) {
      return this.createDecision(
        "SETTLING",
        false,
        false,
        "BEFORE_TARGET"
      );
    }
    if (elapsedMs < CALIBRATION.TARGET_SETTLE_MS) {
      return this.createDecision(
        "SETTLING",
        false,
        false,
        "SETTLING"
      );
    }
    if (elapsedMs >= this.getAdaptivePointTimeoutMs()) {
      return this.createDecision(
        "TIMED_OUT",
        false,
        false,
        null
      );
    }
    const rejectionReason = this.getRejectionReason(
      observation
    );
    if (rejectionReason !== null) {
      return this.storeRejectedObservation(
        observation,
        rejectionReason
      );
    }
    this.samples.push(
      this.createRawSample(
        observation,
        true
      )
    );
    this.acceptedSampleCount += 1;
    return this.createDecision(
      this.getPhaseAt(timestampMs),
      true,
      true,
      null
    );
  }
  getSnapshot(timestampMs) {
    return {
      phase: this.getPhaseAt(
        timestampMs ?? this.targetShownAtMs ?? 0
      ),
      calibrationId: this.calibrationId,
      pointIndex: this.target?.pointIndex ?? null,
      targetShownAtMs: this.targetShownAtMs,
      acceptedSampleCount: this.acceptedSampleCount,
      rejectedSampleCount: this.rejectedSampleCount
    };
  }
  finishPoint(timestampMs) {
    if (this.calibrationId === null || this.target === null || this.targetShownAtMs === null) {
      throw new Error(
        "CalibrationCollector has no active calibration point."
      );
    }
    const phase = this.getPhaseAt(timestampMs);
    const rejectionRatio = calculateRejectionRatio(
      this.acceptedSampleCount,
      this.rejectedSampleCount
    );
    const stableWindow = selectBestCalibrationStableWindow(
      this.samples
    );
    const diagnosticWindow = stableWindow ?? selectBestCalibrationCandidateWindow(
      this.samples
    );
    const stability = diagnosticWindow?.metrics ?? null;
    const effectiveSampleRateHz = this.getEffectiveObservedSampleRateHz();
    const adaptiveStabilityProfile = createCalibrationStabilityProfile(
      this.samples
    );
    logger2.info(
      "Calibration point collection diagnostics.",
      {
        pointIndex: this.target.pointIndex,
        phase,
        acceptedSampleCount: this.acceptedSampleCount,
        rejectedSampleCount: this.rejectedSampleCount,
        rejectionRatio,
        rejectionReasonCounts: { ...this.rejectionReasonCounts },
        effectiveBaselineSampleRateHz: effectiveSampleRateHz,
        adaptivePointTimeoutMs: this.getAdaptivePointTimeoutMs(),
        adaptiveStabilityProfile,
        stability
      }
    );
    logger2.info(
      [
        "[CalibrationPointSummary]",
        `point=${this.target.pointIndex + 1}`,
        `phase=${phase}`,
        `accepted=${this.acceptedSampleCount}`,
        `rejected=${this.rejectedSampleCount}`,
        `rejectionRatio=${rejectionRatio.toFixed(3)}`,
        `baselineHz=${effectiveSampleRateHz === null ? "NA" : effectiveSampleRateHz.toFixed(2)}`,
        `stable=${stability?.stable ?? false}`,
        `failures=${stability?.failureReasons.join(",") || "NONE"}`,
        `dispersion=${stability === null ? "NA" : stability.gazeDispersionRmsNormalized.toFixed(4)}`,
        `velocity=${stability === null ? "NA" : stability.gazeVelocityRmsNormalizedPerSecond.toFixed(3)}`,
        `inlierRatio=${stability === null ? "NA" : stability.spatialInlierRatio.toFixed(3)}`,
        `stableSamples=${stability?.sampleCount ?? 0}`,
        `requiredStableSamples=${adaptiveStabilityProfile.minSampleCount}`,
        `windowMs=${Math.round(adaptiveStabilityProfile.windowMs)}`,
        `maxGapMs=${Math.round(adaptiveStabilityProfile.maxFrameGapMs)}`
      ].join(" ")
    );
    const sufficient = this.acceptedSampleCount >= CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT && rejectionRatio <= CALIBRATION.MAX_REJECTION_RATIO && stability?.stable === true;
    return {
      calibrationId: this.calibrationId,
      target: this.target,
      targetShownAtMs: this.targetShownAtMs,
      samples: [...this.samples],
      acceptedSampleCount: this.acceptedSampleCount,
      rejectedSampleCount: this.rejectedSampleCount,
      rejectionRatio,
      phase,
      sufficient,
      stability
    };
  }
  reset() {
    this.calibrationId = null;
    this.target = null;
    this.targetShownAtMs = null;
    this.samples = [];
    this.acceptedSampleCount = 0;
    this.rejectedSampleCount = 0;
    this.observedPredictionTimestampsMs = [];
    this.rejectionReasonCounts = {};
    this.faceBaseline = null;
  }
  getPhaseAt(timestampMs) {
    if (this.targetShownAtMs === null || !isFiniteTimestamp(timestampMs)) {
      return "IDLE";
    }
    const elapsedMs = timestampMs - this.targetShownAtMs;
    if (elapsedMs < CALIBRATION.TARGET_SETTLE_MS) {
      return "SETTLING";
    }
    if (elapsedMs >= this.getAdaptivePointTimeoutMs()) {
      return "TIMED_OUT";
    }
    const minimumCandidateWindowComplete = elapsedMs >= CALIBRATION.TARGET_SETTLE_MS + CALIBRATION.SAMPLE_WINDOW_MIN_MS;
    const maximumCandidateWindowComplete = elapsedMs >= CALIBRATION.TARGET_SETTLE_MS + CALIBRATION.SAMPLE_WINDOW_MAX_MS;
    const enoughSamples = this.acceptedSampleCount >= CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT;
    if (minimumCandidateWindowComplete && enoughSamples && selectBestCalibrationStableWindow(
      this.samples
    ) !== null) {
      return "READY";
    }
    if (maximumCandidateWindowComplete && enoughSamples) {
      return "READY";
    }
    return "COLLECTING";
  }
  getRejectionReason(observation) {
    if (observation.prediction.rawSpace !== "NORMALIZED") {
      return "UNSUPPORTED_GAZE_SPACE";
    }
    if (!observation.gazeValid) {
      return "GAZE_INVALID";
    }
    if (!Number.isFinite(observation.gazeQuality) || observation.gazeQuality < CALIBRATION.MIN_SAMPLE_QUALITY) {
      return "GAZE_QUALITY_LOW";
    }
    if (!observation.face.faceValid || !observation.prediction.faceValid) {
      return "FACE_INVALID";
    }
    if (!observation.face.eyesValid || !observation.prediction.eyesValid) {
      return "EYES_INVALID";
    }
    if (observation.face.blink) {
      return "BLINK";
    }
    const baselineDriftReason = getCalibrationBaselineDriftReason(
      this.faceBaseline,
      {
        headPose: observation.face.headPose,
        faceDistanceRatio: observation.face.faceDistanceRatio,
        faceCenterNormalized: observation.faceCenterNormalized ?? null
      }
    );
    if (baselineDriftReason !== null) {
      return baselineDriftReason;
    }
    return null;
  }
  getEffectiveObservedSampleRateHz() {
    if (this.observedPredictionTimestampsMs.length < 2) {
      return null;
    }
    const first = this.observedPredictionTimestampsMs[0];
    const last = this.observedPredictionTimestampsMs.at(-1);
    if (first === void 0 || last === void 0) {
      return null;
    }
    const durationMs = last - first;
    if (durationMs <= 0) {
      return null;
    }
    return (this.observedPredictionTimestampsMs.length - 1) * 1e3 / durationMs;
  }
  getAdaptivePointTimeoutMs() {
    if (this.observedPredictionTimestampsMs.length < 4) {
      return CALIBRATION.POINT_TIMEOUT_MS;
    }
    const effectiveHz = this.getEffectiveObservedSampleRateHz();
    if (effectiveHz === null) {
      return CALIBRATION.POINT_TIMEOUT_MS;
    }
    if (effectiveHz < CALIBRATION.POINT_TIMEOUT_LOW_FPS_THRESHOLD_HZ) {
      return CALIBRATION.POINT_TIMEOUT_LOW_FPS_MS;
    }
    if (effectiveHz < CALIBRATION.POINT_TIMEOUT_MEDIUM_FPS_THRESHOLD_HZ) {
      return CALIBRATION.POINT_TIMEOUT_MEDIUM_FPS_MS;
    }
    return CALIBRATION.POINT_TIMEOUT_MS;
  }
  storeRejectedObservation(observation, reason) {
    this.samples.push(
      this.createRawSample(
        observation,
        false
      )
    );
    this.rejectedSampleCount += 1;
    this.rejectionReasonCounts[reason] = (this.rejectionReasonCounts[reason] ?? 0) + 1;
    return this.createDecision(
      this.getPhaseAt(
        observation.prediction.timestampMs
      ),
      true,
      false,
      reason
    );
  }
  createRawSample(observation, accepted) {
    const calibrationId = this.calibrationId;
    const target = this.target;
    if (calibrationId === null || target === null) {
      throw new Error(
        "CalibrationCollector active point disappeared during sample creation."
      );
    }
    return {
      calibrationId,
      pointIndex: target.pointIndex,
      timestampMs: observation.prediction.timestampMs,
      targetViewportPoint: target.viewportPoint,
      rawGazePoint: observation.prediction.rawPoint,
      rawGazeSpace: observation.prediction.rawSpace,
      headPose: observation.face.headPose,
      faceDistanceRatio: observation.face.faceDistanceRatio,
      faceCenterNormalized: observation.faceCenterNormalized ?? null,
      faceValid: observation.face.faceValid,
      eyesValid: observation.face.eyesValid,
      blink: observation.face.blink,
      quality: observation.gazeQuality,
      accepted
    };
  }
  createDecision(phase, stored, accepted, rejectionReason) {
    return {
      phase,
      stored,
      accepted,
      rejectionReason,
      acceptedSampleCount: this.acceptedSampleCount,
      rejectedSampleCount: this.rejectedSampleCount
    };
  }
};

// src/calibration/calibrationCleaner.ts
function median2(values) {
  if (values.length === 0) {
    throw new RangeError(
      "median() requires at least one value."
    );
  }
  const sorted = [...values].sort(
    (a2, b2) => a2 - b2
  );
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[middle];
    if (value === void 0) {
      throw new RangeError(
        "median() could not resolve the middle value."
      );
    }
    return value;
  }
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === void 0 || upper === void 0) {
    throw new RangeError(
      "median() could not resolve the middle pair."
    );
  }
  return (lower + upper) / 2;
}
function mean(values) {
  if (values.length === 0) {
    throw new RangeError(
      "mean() requires at least one value."
    );
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}
function meanPoint2(points) {
  return {
    x: mean(
      points.map((point) => point.x)
    ),
    y: mean(
      points.map((point) => point.y)
    )
  };
}
function calculateRejectionRatio2(accepted, rejected) {
  const total = accepted + rejected;
  if (total === 0) {
    return 1;
  }
  return rejected / total;
}
function isUsableAcceptedSample2(sample) {
  return sample.accepted && sample.rawGazeSpace === "NORMALIZED" && Number.isFinite(
    sample.rawGazePoint.x
  ) && Number.isFinite(
    sample.rawGazePoint.y
  );
}
function cleanCalibrationPoint(collection) {
  const candidateAccepted = collection.samples.filter(
    isUsableAcceptedSample2
  );
  const stableWindow = selectBestCalibrationStableWindow(
    candidateAccepted
  );
  const initialAccepted = stableWindow?.samples ?? [];
  const requiredStableSampleCount = stableWindow?.metrics.profile.minSampleCount ?? CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT;
  if (stableWindow === null || initialAccepted.length < requiredStableSampleCount) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Calibration point has too few usable gaze samples before outlier cleaning.",
      {
        details: {
          pointIndex: collection.target.pointIndex,
          usableSampleCount: initialAccepted.length,
          candidateAcceptedSampleCount: candidateAccepted.length,
          stableWindowFound: stableWindow !== null,
          requiredSampleCount: requiredStableSampleCount
        }
      }
    );
  }
  const medianPoint2 = {
    x: median2(
      initialAccepted.map(
        (sample) => sample.rawGazePoint.x
      )
    ),
    y: median2(
      initialAccepted.map(
        (sample) => sample.rawGazePoint.y
      )
    )
  };
  const radialDistances = initialAccepted.map(
    (sample) => distance2D(
      sample.rawGazePoint,
      medianPoint2
    )
  );
  const medianRadius = median2(radialDistances);
  const absoluteDeviations = radialDistances.map(
    (radius) => Math.abs(
      radius - medianRadius
    )
  );
  const mad = median2(absoluteDeviations);
  const robustSigma = 1.4826 * mad;
  const allowedRadius = medianRadius + Math.max(
    CALIBRATION.OUTLIER_MIN_RADIUS_NORMALIZED,
    CALIBRATION.OUTLIER_MAD_SCALE * robustSigma
  );
  const inlierTimestamps = /* @__PURE__ */ new Set();
  for (let index = 0; index < initialAccepted.length; index += 1) {
    const sample = initialAccepted[index];
    const radius = radialDistances[index];
    if (sample !== void 0 && radius !== void 0 && radius <= allowedRadius) {
      inlierTimestamps.add(
        sample.timestampMs
      );
    }
  }
  const stableWindowSamples = collection.samples.filter(
    (sample) => sample.timestampMs >= stableWindow.startTimestampMs && sample.timestampMs <= stableWindow.endTimestampMs
  );
  const finalSamples = stableWindowSamples.map(
    (sample) => {
      const accepted = isUsableAcceptedSample2(sample) && inlierTimestamps.has(
        sample.timestampMs
      );
      return {
        ...sample,
        accepted
      };
    }
  );
  const finalAccepted = finalSamples.filter(
    (sample) => sample.accepted
  );
  if (finalAccepted.length < requiredStableSampleCount) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Calibration point has too few samples after robust outlier cleaning.",
      {
        details: {
          pointIndex: collection.target.pointIndex,
          acceptedAfterCleaning: finalAccepted.length,
          requiredSampleCount: requiredStableSampleCount,
          allowedRadius
        }
      }
    );
  }
  const acceptedSampleCount = finalAccepted.length;
  const rejectedSampleCount = finalSamples.length - acceptedSampleCount;
  const rejectionRatio = calculateRejectionRatio2(
    acceptedSampleCount,
    rejectedSampleCount
  );
  if (rejectionRatio > CALIBRATION.MAX_REJECTION_RATIO) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Calibration point rejection ratio is too high.",
      {
        details: {
          pointIndex: collection.target.pointIndex,
          rejectionRatio,
          maximumAllowed: CALIBRATION.MAX_REJECTION_RATIO
        }
      }
    );
  }
  return {
    calibrationId: collection.calibrationId,
    pointIndex: collection.target.pointIndex,
    targetNormalizedPoint: collection.target.normalizedPoint,
    targetViewportPoint: collection.target.viewportPoint,
    representativeRawPoint: meanPoint2(
      finalAccepted.map(
        (sample) => sample.rawGazePoint
      )
    ),
    samples: finalSamples,
    acceptedSampleCount,
    rejectedSampleCount,
    rejectionRatio,
    meanHeadPose: {
      yawDeg: mean(
        finalAccepted.map(
          (sample) => sample.headPose.yawDeg
        )
      ),
      pitchDeg: mean(
        finalAccepted.map(
          (sample) => sample.headPose.pitchDeg
        )
      ),
      rollDeg: mean(
        finalAccepted.map(
          (sample) => sample.headPose.rollDeg
        )
      )
    },
    meanFaceDistanceRatio: mean(
      finalAccepted.map(
        (sample) => sample.faceDistanceRatio
      )
    ),
    meanQuality: mean(
      finalAccepted.map(
        (sample) => sample.quality
      )
    ),
    stability: stableWindow.metrics,
    stableWindowStartTimestampMs: stableWindow.startTimestampMs,
    stableWindowEndTimestampMs: stableWindow.endTimestampMs,
    candidateAcceptedSampleCount: candidateAccepted.length
  };
}

// src/calibration/calibrationTargetGroups.ts
function sameCalibrationTarget(a2, b2) {
  return Number.isFinite(a2.x) && Number.isFinite(a2.y) && Number.isFinite(b2.x) && Number.isFinite(b2.y) && Math.abs(a2.x - b2.x) <= 1e-6 && Math.abs(a2.y - b2.y) <= 1e-6;
}

// src/calibration/calibrationModel.ts
function createIdentityCalibrationResidualModel(trainingPointCount, trainingRmseNormalized = 0) {
  if (!Number.isInteger(trainingPointCount) || trainingPointCount < CALIBRATION.MIN_MODEL_POINT_COUNT || !Number.isFinite(trainingRmseNormalized) || trainingRmseNormalized < 0) {
    throw new RangeError(
      "Identity calibration residual model metadata is invalid."
    );
  }
  return {
    version: 1,
    kind: "AFFINE_RESIDUAL",
    residualX: [0, 0, 0],
    residualY: [0, 0, 0],
    trainingPointCount,
    trainingRmseNormalized
  };
}
function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  if (size === 0 || vector.length !== size || matrix.some((row) => row.length !== size)) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration residual model received an invalid linear system."
    );
  }
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    vector[rowIndex] ?? 0
  ]);
  for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    let pivotMagnitude = Math.abs(
      augmented[pivotRow]?.[pivotColumn] ?? 0
    );
    for (let candidateRow = pivotColumn + 1; candidateRow < size; candidateRow += 1) {
      const candidateMagnitude = Math.abs(
        augmented[candidateRow]?.[pivotColumn] ?? 0
      );
      if (candidateMagnitude > pivotMagnitude) {
        pivotMagnitude = candidateMagnitude;
        pivotRow = candidateRow;
      }
    }
    if (pivotMagnitude <= NUMERIC_EPSILON) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model matrix is singular."
      );
    }
    if (pivotRow !== pivotColumn) {
      const temporary = augmented[pivotColumn];
      augmented[pivotColumn] = augmented[pivotRow] ?? [];
      augmented[pivotRow] = temporary ?? [];
    }
    const pivotValues = augmented[pivotColumn];
    if (pivotValues === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model lost its pivot row."
      );
    }
    const pivot = pivotValues[pivotColumn] ?? 0;
    for (let column = pivotColumn; column <= size; column += 1) {
      pivotValues[column] = (pivotValues[column] ?? 0) / pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivotColumn) continue;
      const rowValues = augmented[row];
      if (rowValues === void 0) continue;
      const factor = rowValues[pivotColumn] ?? 0;
      for (let column = pivotColumn; column <= size; column += 1) {
        rowValues[column] = (rowValues[column] ?? 0) - factor * (pivotValues[column] ?? 0);
      }
    }
  }
  const solution = augmented.map((row) => row[size] ?? Number.NaN);
  if (solution.some((value) => !Number.isFinite(value))) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration residual model produced non-finite coefficients."
    );
  }
  return solution;
}
function percentile(values, percentileValue) {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  );
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}
function mean2(values) {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function squaredDistance(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}
function affineFeatures(rawPoint) {
  return [1, rawPoint.x, rawPoint.y];
}
function quadraticFeatures(rawPoint) {
  return [
    1,
    rawPoint.x,
    rawPoint.y,
    rawPoint.x * rawPoint.x,
    rawPoint.x * rawPoint.y,
    rawPoint.y * rawPoint.y
  ];
}
function fitFeatureResidualAxis(points, axis, featureBuilder, lambda) {
  const firstFeatures = featureBuilder(
    points[0]?.representativeRawPoint ?? { x: 0, y: 0 }
  );
  const dimension = firstFeatures.length;
  const normalMatrix = Array.from(
    { length: dimension },
    () => Array(dimension).fill(0)
  );
  const normalVector = Array(dimension).fill(0);
  for (const point of points) {
    const raw = point.representativeRawPoint;
    const target = point.targetNormalizedPoint;
    const features = featureBuilder(raw);
    const residual = axis === "x" ? target.x - raw.x : target.y - raw.y;
    for (let row = 0; row < dimension; row += 1) {
      const featureRow = features[row] ?? 0;
      normalVector[row] = (normalVector[row] ?? 0) + featureRow * residual;
      const matrixRow = normalMatrix[row];
      if (matrixRow === void 0) continue;
      for (let column = 0; column < dimension; column += 1) {
        matrixRow[column] = (matrixRow[column] ?? 0) + featureRow * (features[column] ?? 0);
      }
    }
  }
  for (let index = 1; index < dimension; index += 1) {
    const row = normalMatrix[index];
    if (row !== void 0) {
      row[index] = (row[index] ?? 0) + lambda;
    }
  }
  return solveLinearSystem(normalMatrix, normalVector);
}
function dot(coefficients, features) {
  let result = 0;
  const count = Math.min(coefficients.length, features.length);
  for (let index = 0; index < count; index += 1) {
    result += (coefficients[index] ?? 0) * (features[index] ?? 0);
  }
  return result;
}
function rbfKernel(first, second, gamma) {
  return Math.exp(-gamma * squaredDistance(first, second));
}
function fitRbfResidualAxis(points, axis, affineCoefficients, gamma, lambda) {
  const count = points.length;
  const matrix = Array.from(
    { length: count },
    () => Array(count).fill(0)
  );
  const targetResidual = Array(count).fill(0);
  for (let row = 0; row < count; row += 1) {
    const point = points[row];
    if (point === void 0) continue;
    const raw = point.representativeRawPoint;
    const target = point.targetNormalizedPoint;
    const observedResidual = axis === "x" ? target.x - raw.x : target.y - raw.y;
    const affineResidual = dot(affineCoefficients, affineFeatures(raw));
    targetResidual[row] = observedResidual - affineResidual;
    const matrixRow = matrix[row];
    if (matrixRow === void 0) continue;
    for (let column = 0; column < count; column += 1) {
      const anchor = points[column]?.representativeRawPoint;
      if (anchor === void 0) continue;
      matrixRow[column] = rbfKernel(raw, anchor, gamma);
    }
    matrixRow[row] = (matrixRow[row] ?? 0) + lambda;
  }
  return solveLinearSystem(matrix, targetResidual);
}
function modelKind(model) {
  return model.kind ?? "AFFINE_RESIDUAL";
}
function predictResidualAxis(model, rawPoint, axis) {
  const coefficients = axis === "x" ? model.residualX : model.residualY;
  const kind = modelKind(model);
  if (kind === "QUADRATIC_RESIDUAL") {
    return dot(coefficients, quadraticFeatures(rawPoint));
  }
  const affineResidual = dot(coefficients, affineFeatures(rawPoint));
  if (kind !== "RBF_RESIDUAL") return affineResidual;
  const anchors = model.rbfAnchors ?? [];
  const alpha = axis === "x" ? model.rbfAlphaX ?? [] : model.rbfAlphaY ?? [];
  const gamma = model.rbfGamma ?? 0;
  if (anchors.length === 0 || anchors.length !== alpha.length || !Number.isFinite(gamma) || gamma <= 0) {
    return affineResidual;
  }
  let localResidual = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor === void 0) continue;
    localResidual += (alpha[index] ?? 0) * rbfKernel(rawPoint, anchor, gamma);
  }
  return affineResidual + localResidual;
}
function predictWithModel(model, rawPoint) {
  return {
    x: rawPoint.x + predictResidualAxis(model, rawPoint, "x"),
    y: rawPoint.y + predictResidualAxis(model, rawPoint, "y")
  };
}
function assertTrainingPoint(point) {
  if (!isNormalizedPoint(point.targetNormalizedPoint) || !Number.isFinite(point.representativeRawPoint.x) || !Number.isFinite(point.representativeRawPoint.y)) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration model received a non-finite or invalid training point.",
      { details: { pointIndex: point.pointIndex } }
    );
  }
}
function fitCandidateModel(points, candidate) {
  const affineX = fitFeatureResidualAxis(
    points,
    "x",
    affineFeatures,
    candidate.lambda
  );
  const affineY = fitFeatureResidualAxis(
    points,
    "y",
    affineFeatures,
    candidate.lambda
  );
  if (candidate.kind === "AFFINE_RESIDUAL") {
    return {
      version: 1,
      kind: candidate.kind,
      residualX: affineX,
      residualY: affineY,
      trainingPointCount: points.length,
      trainingRmseNormalized: 0
    };
  }
  if (candidate.kind === "QUADRATIC_RESIDUAL") {
    return {
      version: 1,
      kind: candidate.kind,
      residualX: fitFeatureResidualAxis(
        points,
        "x",
        quadraticFeatures,
        candidate.lambda
      ),
      residualY: fitFeatureResidualAxis(
        points,
        "y",
        quadraticFeatures,
        candidate.lambda
      ),
      trainingPointCount: points.length,
      trainingRmseNormalized: 0
    };
  }
  const gamma = candidate.gamma ?? 8;
  return {
    version: 1,
    kind: candidate.kind,
    residualX: affineX,
    residualY: affineY,
    rbfAnchors: points.map((point) => ({ ...point.representativeRawPoint })),
    rbfAlphaX: fitRbfResidualAxis(
      points,
      "x",
      affineX,
      gamma,
      candidate.lambda
    ),
    rbfAlphaY: fitRbfResidualAxis(
      points,
      "y",
      affineY,
      gamma,
      candidate.lambda
    ),
    rbfGamma: gamma,
    trainingPointCount: points.length,
    trainingRmseNormalized: 0
  };
}
function candidateModels() {
  return [
    {
      kind: "AFFINE_RESIDUAL",
      lambda: CALIBRATION.RESIDUAL_RIDGE_LAMBDA,
      complexityPenalty: 0
    },
    ...CALIBRATION.RESIDUAL_QUADRATIC_RIDGE_LAMBDAS.map((lambda) => ({
      kind: "QUADRATIC_RESIDUAL",
      lambda,
      complexityPenalty: CALIBRATION.RESIDUAL_QUADRATIC_COMPLEXITY_PENALTY
    })),
    ...CALIBRATION.RESIDUAL_RBF_GAMMAS.flatMap(
      (gamma) => CALIBRATION.RESIDUAL_RBF_RIDGE_LAMBDAS.map((lambda) => ({
        kind: "RBF_RESIDUAL",
        lambda,
        gamma,
        complexityPenalty: CALIBRATION.RESIDUAL_RBF_COMPLEXITY_PENALTY
      }))
    )
  ];
}
function evaluateCandidate(points, candidate) {
  const errors = [];
  for (let holdoutIndex = 0; holdoutIndex < points.length; holdoutIndex += 1) {
    const heldOut = points[holdoutIndex];
    if (heldOut === void 0) continue;
    const trainingPoints = points.filter(
      (point) => !sameCalibrationTarget(
        point.targetNormalizedPoint,
        heldOut.targetNormalizedPoint
      )
    );
    if (trainingPoints.length < CALIBRATION.MIN_MODEL_POINT_COUNT) return null;
    try {
      const foldModel = fitCandidateModel(trainingPoints, candidate);
      const predicted = predictWithModel(
        foldModel,
        heldOut.representativeRawPoint
      );
      const error = distance2D(predicted, heldOut.targetNormalizedPoint);
      if (!Number.isFinite(error)) return null;
      errors.push(error);
    } catch {
      return null;
    }
  }
  if (errors.length !== points.length) return null;
  const meanError = mean2(errors);
  const p95Error = percentile(errors, 0.95);
  return {
    candidate,
    meanError,
    p95Error,
    score: meanError + CALIBRATION.RESIDUAL_CV_P95_WEIGHT * p95Error + candidate.complexityPenalty
  };
}
function calculateTrainingRmse(points, model) {
  let squaredErrorSum = 0;
  for (const point of points) {
    const corrected = predictWithModel(model, point.representativeRawPoint);
    const error = distance2D(corrected, point.targetNormalizedPoint);
    squaredErrorSum += error * error;
  }
  return Math.sqrt(squaredErrorSum / points.length);
}
function isFiniteArray(values) {
  return values !== void 0 && values.length > 0 && values.every((value) => Number.isFinite(value));
}
function isFinitePoint(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
var CalibrationModel = class {
  model = null;
  fit(points) {
    if (points.length < CALIBRATION.MIN_MODEL_POINT_COUNT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few calibration points are available to fit the residual model.",
        {
          details: {
            pointCount: points.length,
            requiredPointCount: CALIBRATION.MIN_MODEL_POINT_COUNT
          }
        }
      );
    }
    for (const point of points) assertTrainingPoint(point);
    const evaluations = candidateModels().map((candidate) => evaluateCandidate(points, candidate)).filter((value) => value !== null).sort((first, second) => first.score - second.score);
    const affineEvaluation = evaluations.find(
      (evaluation) => evaluation.candidate.kind === "AFFINE_RESIDUAL"
    ) ?? null;
    const bestEvaluation = evaluations[0] ?? null;
    if (bestEvaluation === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "No calibration residual candidate could be fitted safely."
      );
    }
    const selectedEvaluation = affineEvaluation !== null && bestEvaluation.candidate.kind !== "AFFINE_RESIDUAL" && affineEvaluation.score - bestEvaluation.score < CALIBRATION.RESIDUAL_NONLINEAR_MIN_CV_IMPROVEMENT ? affineEvaluation : bestEvaluation;
    const fitted = fitCandidateModel(points, selectedEvaluation.candidate);
    const model = {
      ...fitted,
      trainingRmseNormalized: calculateTrainingRmse(points, fitted),
      selectionCvMeanErrorNormalized: selectedEvaluation.meanError,
      selectionCvP95ErrorNormalized: selectedEvaluation.p95Error
    };
    this.model = model;
    return model;
  }
  predict(rawPoint) {
    const model = this.model;
    if (model === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model is not fitted."
      );
    }
    if (!isFinitePoint(rawPoint)) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model received a non-finite raw gaze point."
      );
    }
    return predictWithModel(model, rawPoint);
  }
  getModel() {
    return this.model;
  }
  setModel(model) {
    const kind = modelKind(model);
    const expectedCoefficientCount = kind === "QUADRATIC_RESIDUAL" ? 6 : 3;
    const baseValid = model.version === 1 && model.trainingPointCount >= CALIBRATION.MIN_MODEL_POINT_COUNT && Number.isFinite(model.trainingRmseNormalized) && model.trainingRmseNormalized >= 0 && model.residualX.length === expectedCoefficientCount && model.residualY.length === expectedCoefficientCount && model.residualX.every((value) => Number.isFinite(value)) && model.residualY.every((value) => Number.isFinite(value));
    const rbfValid = kind !== "RBF_RESIDUAL" || Array.isArray(model.rbfAnchors) && model.rbfAnchors.length > 0 && model.rbfAnchors.every(isFinitePoint) && isFiniteArray(model.rbfAlphaX) && isFiniteArray(model.rbfAlphaY) && model.rbfAlphaX?.length === model.rbfAnchors.length && model.rbfAlphaY?.length === model.rbfAnchors.length && Number.isFinite(model.rbfGamma) && (model.rbfGamma ?? 0) > 0;
    if (!baseValid || !rbfValid) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model payload is invalid."
      );
    }
    this.model = model;
  }
  clear() {
    this.model = null;
  }
};

// src/calibration/calibrationManager.ts
function getExpectedPointCount(mode) {
  switch (mode) {
    case "STANDARD_17":
      return CALIBRATION.STANDARD_POINT_COUNT;
    case "PRECISION_25":
      return CALIBRATION.PRECISION_POINT_COUNT;
  }
}
function isFiniteTarget(target) {
  return Number.isInteger(target.pointIndex) && target.pointIndex >= 0 && Number.isFinite(
    target.normalizedPoint.x
  ) && Number.isFinite(
    target.normalizedPoint.y
  ) && target.normalizedPoint.x >= 0 && target.normalizedPoint.x <= 1 && target.normalizedPoint.y >= 0 && target.normalizedPoint.y <= 1 && Number.isFinite(
    target.viewportPoint.x
  ) && Number.isFinite(
    target.viewportPoint.y
  ) && target.viewportPoint.x >= 0 && target.viewportPoint.y >= 0;
}
function mean3(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration training diagnostics require at least one value."
    );
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}
function percentile2(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration training diagnostic percentile request is invalid."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration training diagnostic percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function createTrainingDiagnostics(points, model) {
  const rawErrors = [];
  const correctedErrors = [];
  for (const point of points) {
    const normalizedTarget = point.targetNormalizedPoint;
    if (normalizedTarget.x <= 0 || normalizedTarget.y <= 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration training diagnostics cannot infer viewport size from a zero target coordinate.",
        {
          details: {
            pointIndex: point.pointIndex
          }
        }
      );
    }
    const viewportWidth = point.targetViewportPoint.x / normalizedTarget.x;
    const viewportHeight = point.targetViewportPoint.y / normalizedTarget.y;
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration training diagnostics inferred an invalid viewport size.",
        {
          details: {
            pointIndex: point.pointIndex
          }
        }
      );
    }
    const raw = point.representativeRawPoint;
    const corrected = model.predict(raw);
    const rawErrorPx = Math.hypot(
      raw.x * viewportWidth - point.targetViewportPoint.x,
      raw.y * viewportHeight - point.targetViewportPoint.y
    );
    const correctedErrorPx = Math.hypot(
      corrected.x * viewportWidth - point.targetViewportPoint.x,
      corrected.y * viewportHeight - point.targetViewportPoint.y
    );
    rawErrors.push(rawErrorPx);
    correctedErrors.push(correctedErrorPx);
  }
  const improvements = rawErrors.map(
    (rawError, index) => rawError - (correctedErrors[index] ?? rawError)
  );
  return {
    pointCount: points.length,
    rawMeanErrorPx: mean3(rawErrors),
    rawP95ErrorPx: percentile2(rawErrors, 0.95),
    rawRmsePx: Math.sqrt(
      mean3(rawErrors.map((error) => error * error))
    ),
    correctedMeanErrorPx: mean3(correctedErrors),
    correctedP95ErrorPx: percentile2(correctedErrors, 0.95),
    correctedRmsePx: Math.sqrt(
      mean3(correctedErrors.map((error) => error * error))
    ),
    meanCorrectionImprovementPx: mean3(improvements),
    improvedPointCount: improvements.filter((value) => value > 0).length,
    degradedPointCount: improvements.filter((value) => value < 0).length,
    unchangedPointCount: improvements.filter((value) => value === 0).length
  };
}
function classifyGroupedCvSpatialBucket(point) {
  const horizontalOuter = point.x <= 0.33 || point.x >= 0.67;
  const verticalOuter = point.y <= 0.33 || point.y >= 0.67;
  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }
  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }
  return "CENTER";
}
function inferPointViewportSize(point) {
  const normalized = point.targetNormalizedPoint;
  const viewport = point.targetViewportPoint;
  const width = normalized.x > 0 ? viewport.x / normalized.x : Number.NaN;
  const height = normalized.y > 0 ? viewport.y / normalized.y : Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Grouped calibration cross-validation could not infer the viewport size.",
      {
        details: {
          pointIndex: point.pointIndex
        }
      }
    );
  }
  return { width, height };
}
var CalibrationManager = class _CalibrationManager {
  collector = new CalibrationCollector();
  model = new CalibrationModel();
  calibrationId = null;
  mode = null;
  expectedPointCount = 0;
  activePoint = null;
  cleanedPoints = [];
  faceBaseline = null;
  start(calibrationId, mode, faceBaseline = null) {
    if (calibrationId.trim().length === 0) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Calibration run requires a non-empty calibration ID."
      );
    }
    this.collector.reset();
    this.model.clear();
    this.calibrationId = calibrationId;
    this.mode = mode;
    this.expectedPointCount = getExpectedPointCount(mode);
    this.activePoint = null;
    this.cleanedPoints = [];
    this.faceBaseline = faceBaseline === null ? null : {
      ...faceBaseline,
      headPose: {
        ...faceBaseline.headPose
      }
    };
  }
  /**
   * Opens a maintenance-calibration extension while preserving every original
   * cleaned point. The currently installed ResidualCorrector keeps serving the
   * previous model until the additional points have all been collected and a
   * new model is fitted.
   */
  /** A detached copy: an unvalidated maintenance fit must not mutate the live model. */
  forkForQuickRecalibration() {
    if (this.calibrationId === null || this.mode === null || this.activePoint !== null || this.model.getModel() === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A fitted, idle calibration is required to create a maintenance candidate."
      );
    }
    const originalModel = this.model.getModel();
    if (originalModel === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Cannot copy a calibration without a fitted model."
      );
    }
    const candidate = new _CalibrationManager();
    candidate.calibrationId = this.calibrationId;
    candidate.mode = this.mode;
    candidate.expectedPointCount = this.expectedPointCount;
    candidate.cleanedPoints = [...this.cleanedPoints];
    candidate.faceBaseline = this.faceBaseline === null ? null : {
      ...this.faceBaseline,
      headPose: { ...this.faceBaseline.headPose }
    };
    candidate.model.setModel(originalModel);
    return candidate;
  }
  beginIncrementalCalibration(additionalPointCount) {
    if (this.calibrationId === null || this.mode === null || this.activePoint !== null || this.model.getModel() === null || !Number.isInteger(additionalPointCount) || additionalPointCount <= 0) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration cannot extend the current calibration state."
      );
    }
    const startingPointIndex = this.cleanedPoints.length;
    this.expectedPointCount = startingPointIndex + additionalPointCount;
    this.model.clear();
    return {
      startingPointIndex,
      expectedPointCount: this.expectedPointCount
    };
  }
  /**
   * Extends an active STANDARD_17 run with a balanced subset of the remaining
   * PRECISION_25 lattice points. The provisional fitted residual is cleared so
   * modelReady cannot become true again until every selected extra point has
   * been collected and the model has been refit on the full calibration set.
   */
  extendExpectedPointCount(nextExpectedPointCount) {
    if (this.calibrationId === null || this.mode !== "STANDARD_17" || this.activePoint !== null || !Number.isInteger(nextExpectedPointCount) || nextExpectedPointCount <= this.expectedPointCount || nextExpectedPointCount > CALIBRATION.PRECISION_POINT_COUNT || this.cleanedPoints.length !== this.expectedPointCount) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Adaptive calibration expansion request is invalid for the current run.",
        {
          details: {
            mode: this.mode,
            completedPointCount: this.cleanedPoints.length,
            currentExpectedPointCount: this.expectedPointCount,
            requestedExpectedPointCount: nextExpectedPointCount
          }
        }
      );
    }
    this.expectedPointCount = nextExpectedPointCount;
    this.model.clear();
  }
  beginPoint(calibrationId, target, targetShownAtMs) {
    this.assertActiveCalibration(
      calibrationId
    );
    if (this.activePoint !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A calibration point is already being collected.",
        {
          details: {
            activePointIndex: this.activePoint.pointIndex,
            requestedPointIndex: target.pointIndex
          }
        }
      );
    }
    const expectedPointIndex = this.cleanedPoints.length;
    if (!isFiniteTarget(target) || target.pointIndex !== expectedPointIndex || target.pointIndex >= this.expectedPointCount) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Calibration target is invalid or out of sequence.",
        {
          details: {
            requestedPointIndex: target.pointIndex,
            expectedPointIndex,
            expectedPointCount: this.expectedPointCount
          }
        }
      );
    }
    this.activePoint = {
      pointIndex: target.pointIndex,
      normalizedPoint: {
        ...target.normalizedPoint
      },
      viewportPoint: {
        ...target.viewportPoint
      }
    };
    this.collector.beginPoint(
      calibrationId,
      this.activePoint,
      targetShownAtMs,
      this.faceBaseline
    );
  }
  observe(observation) {
    return this.collector.observe(
      observation
    );
  }
  finishActivePoint(timestampMs) {
    const calibrationId = this.calibrationId;
    const activePoint = this.activePoint;
    if (calibrationId === null || activePoint === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration has no active point to finish."
      );
    }
    const collection = this.collector.finishPoint(
      timestampMs
    );
    if (!collection.sufficient) {
      const failureReason = collection.stability?.stable === false || collection.acceptedSampleCount >= CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT && collection.stability === null ? "UNSTABLE_GAZE" : "INSUFFICIENT_SAMPLES";
      return this.completeInsufficientPoint(
        activePoint,
        collection.acceptedSampleCount,
        collection.rejectedSampleCount,
        collection.rejectionRatio,
        failureReason,
        collection.stability
      );
    }
    let cleaned;
    try {
      cleaned = cleanCalibrationPoint(
        collection
      );
    } catch (error) {
      if (isTrackerError(error) && error.code === ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES) {
        return this.completeInsufficientPoint(
          activePoint,
          collection.acceptedSampleCount,
          collection.rejectedSampleCount,
          collection.rejectionRatio,
          "OUTLIER_REJECTION"
        );
      }
      throw error;
    }
    this.cleanedPoints.push(
      cleaned
    );
    this.activePoint = null;
    this.collector.reset();
    let fittedModel = null;
    let trainingDiagnostics = null;
    if (this.cleanedPoints.length === this.expectedPointCount) {
      fittedModel = this.model.fit(
        this.cleanedPoints
      );
      trainingDiagnostics = createTrainingDiagnostics(
        this.cleanedPoints,
        this.model
      );
    }
    return {
      calibrationId,
      pointIndex: cleaned.pointIndex,
      sufficient: true,
      acceptedSampleCount: cleaned.acceptedSampleCount,
      rejectedSampleCount: cleaned.rejectedSampleCount,
      rejectionRatio: cleaned.rejectionRatio,
      completedPointCount: this.cleanedPoints.length,
      expectedPointCount: this.expectedPointCount,
      failureReason: null,
      stableWindowStartTimestampMs: cleaned.stableWindowStartTimestampMs ?? null,
      stableWindowEndTimestampMs: cleaned.stableWindowEndTimestampMs ?? null,
      stability: cleaned.stability ?? null,
      modelReady: fittedModel !== null,
      trainingRmseNormalized: fittedModel?.trainingRmseNormalized ?? null,
      trainingDiagnostics,
      model: fittedModel,
      adaptiveExpansionTargets: []
    };
  }
  getSnapshot() {
    return {
      calibrationId: this.calibrationId,
      mode: this.mode,
      active: this.calibrationId !== null,
      activePointIndex: this.activePoint?.pointIndex ?? null,
      completedPointCount: this.cleanedPoints.length,
      expectedPointCount: this.expectedPointCount,
      modelReady: this.model.getModel() !== null
    };
  }
  getModel() {
    return this.model.getModel();
  }
  /**
   * Leave-one-calibration-point-out diagnostics for the established
   * WebEyeTrack residual path. This is calibration-only evidence and is
   * safe to use for a later hybrid selector without touching independent
   * validation targets.
   */
  getGroupedCrossValidationDiagnostics() {
    const points = [...this.cleanedPoints];
    if (points.length < CALIBRATION.MIN_MODEL_POINT_COUNT + 1) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few calibration points are available for grouped residual cross-validation.",
        {
          details: {
            pointCount: points.length,
            requiredPointCount: CALIBRATION.MIN_MODEL_POINT_COUNT + 1
          }
        }
      );
    }
    const pointResults = [];
    for (let heldOutIndex = 0; heldOutIndex < points.length; heldOutIndex += 1) {
      const heldOut = points[heldOutIndex];
      if (heldOut === void 0) {
        continue;
      }
      const training = points.filter(
        (point) => !sameCalibrationTarget(
          point.targetNormalizedPoint,
          heldOut.targetNormalizedPoint
        )
      );
      const foldModel = new CalibrationModel();
      foldModel.fit(training);
      const predictedNormalizedPoint = foldModel.predict(heldOut.representativeRawPoint);
      const viewport = inferPointViewportSize(heldOut);
      const predictedViewportPoint = {
        x: predictedNormalizedPoint.x * viewport.width,
        y: predictedNormalizedPoint.y * viewport.height
      };
      const errorPx2 = Math.hypot(
        predictedViewportPoint.x - heldOut.targetViewportPoint.x,
        predictedViewportPoint.y - heldOut.targetViewportPoint.y
      );
      pointResults.push({
        pointIndex: heldOut.pointIndex,
        targetNormalizedPoint: {
          ...heldOut.targetNormalizedPoint
        },
        targetViewportPoint: {
          ...heldOut.targetViewportPoint
        },
        predictedNormalizedPoint,
        predictedViewportPoint,
        errorPx: errorPx2,
        spatialBucket: classifyGroupedCvSpatialBucket(
          heldOut.targetNormalizedPoint
        )
      });
    }
    const errors = pointResults.map(
      (point) => point.errorPx
    );
    return {
      pointCount: pointResults.length,
      meanErrorPx: mean3(errors),
      p95ErrorPx: percentile2(errors, 0.95),
      rmsePx: Math.sqrt(
        mean3(errors.map((error) => error * error))
      ),
      pointResults
    };
  }
  reset() {
    this.collector.reset();
    this.model.clear();
    this.calibrationId = null;
    this.mode = null;
    this.expectedPointCount = 0;
    this.activePoint = null;
    this.cleanedPoints = [];
    this.faceBaseline = null;
  }
  /**
   * Replaces the project-owned residual model after an engine-level
   * personalization step. Used to install an identity residual so the native
   * WebEyeTrack correction is not double-corrected during validation.
   */
  setModel(model) {
    this.model.setModel(model);
  }
  completeInsufficientPoint(activePoint, acceptedSampleCount, rejectedSampleCount, rejectionRatio, failureReason, stability = null) {
    const calibrationId = this.calibrationId;
    if (calibrationId === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration ID disappeared while finishing a point."
      );
    }
    this.activePoint = null;
    this.collector.reset();
    return {
      calibrationId,
      pointIndex: activePoint.pointIndex,
      sufficient: false,
      acceptedSampleCount,
      rejectedSampleCount,
      rejectionRatio,
      completedPointCount: this.cleanedPoints.length,
      expectedPointCount: this.expectedPointCount,
      failureReason,
      stableWindowStartTimestampMs: null,
      stableWindowEndTimestampMs: null,
      stability,
      modelReady: false,
      trainingRmseNormalized: null,
      trainingDiagnostics: null,
      model: null,
      adaptiveExpansionTargets: []
    };
  }
  assertActiveCalibration(calibrationId) {
    if (this.calibrationId === null || this.mode === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration has not been started."
      );
    }
    if (calibrationId !== this.calibrationId) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Calibration point belongs to a different calibration run.",
        {
          details: {
            expectedCalibrationId: this.calibrationId,
            receivedCalibrationId: calibrationId
          }
        }
      );
    }
  }
};

// src/calibration/preCalibration.ts
function median3(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort(
    (first, second) => first - second
  );
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  const lower = sorted[middle - 1] ?? 0;
  const upper = sorted[middle] ?? lower;
  return (lower + upper) / 2;
}
function cloneBaseline(baseline) {
  if (baseline === null) {
    return null;
  }
  return {
    ...baseline,
    headPose: {
      ...baseline.headPose
    }
  };
}
function isStableCandidate(input) {
  const status = input.quality.positionStatus;
  const tracking = input.quality.trackingQuality;
  return tracking.faceValid && tracking.eyesValid && !tracking.blink && status.faceDetected && status.bothEyesVisible && status.horizontallyCentered && status.verticallyCentered && status.distanceAcceptable && status.headPoseAcceptable && status.brightnessAcceptable;
}
function createObservation(input) {
  const geometry = input.geometry.geometry;
  const pose = input.headPose.headPose;
  if (geometry === null || pose === null) {
    return null;
  }
  const values = [
    geometry.centerNormalized.x,
    geometry.centerNormalized.y,
    geometry.widthRatio,
    geometry.heightRatio,
    geometry.proximityProxy,
    pose.yawDeg,
    pose.pitchDeg,
    pose.rollDeg
  ];
  if (values.some(
    (value) => !Number.isFinite(value)
  )) {
    return null;
  }
  return {
    centerX: geometry.centerNormalized.x,
    centerY: geometry.centerNormalized.y,
    widthRatio: geometry.widthRatio,
    heightRatio: geometry.heightRatio,
    proximityProxy: geometry.proximityProxy,
    yawDeg: pose.yawDeg,
    pitchDeg: pose.pitchDeg,
    rollDeg: pose.rollDeg
  };
}
function createBaseline(observations) {
  return {
    centerX: median3(
      observations.map(
        (item) => item.centerX
      )
    ),
    centerY: median3(
      observations.map(
        (item) => item.centerY
      )
    ),
    width: median3(
      observations.map(
        (item) => item.widthRatio
      )
    ),
    height: median3(
      observations.map(
        (item) => item.heightRatio
      )
    ),
    headPose: {
      yawDeg: median3(
        observations.map(
          (item) => item.yawDeg
        )
      ),
      pitchDeg: median3(
        observations.map(
          (item) => item.pitchDeg
        )
      ),
      rollDeg: median3(
        observations.map(
          (item) => item.rollDeg
        )
      )
    },
    /**
     * The baseline itself defines the neutral relative-distance value 1.0.
     * Absolute camera-space size remains represented by width/height.
     */
    distanceRatio: 1
  };
}
function determineInstruction(input, stableProgress, readyForCalibration) {
  if (readyForCalibration) {
    return "READY";
  }
  const status = input.quality.positionStatus;
  const geometry = input.geometry.geometry;
  if (!status.faceDetected || geometry === null) {
    return "FIND_FACE";
  }
  if (!status.bothEyesVisible) {
    return "SHOW_BOTH_EYES";
  }
  const brightness = input.cameraQuality?.brightness ?? null;
  if (brightness === null || brightness < CAMERA_QUALITY_THRESHOLDS.MIN_BRIGHTNESS) {
    return "IMPROVE_LIGHTING";
  }
  if (brightness > CAMERA_QUALITY_THRESHOLDS.MAX_BRIGHTNESS) {
    return "REDUCE_LIGHTING";
  }
  if (!status.distanceAcceptable) {
    const tooFar = geometry.widthRatio < FACE_QUALITY_RUNTIME.MIN_PRECALIBRATION_FACE_WIDTH_RATIO || geometry.heightRatio < FACE_QUALITY_RUNTIME.MIN_PRECALIBRATION_FACE_HEIGHT_RATIO;
    return tooFar ? "MOVE_CLOSER" : "MOVE_FARTHER";
  }
  if (!status.horizontallyCentered) {
    const mirroredCenterX = 1 - geometry.centerNormalized.x;
    return mirroredCenterX < NORMALIZED_COORDINATE.CENTER ? "MOVE_RIGHT" : "MOVE_LEFT";
  }
  if (!status.verticallyCentered) {
    return geometry.centerNormalized.y < NORMALIZED_COORDINATE.CENTER ? "MOVE_DOWN" : "MOVE_UP";
  }
  if (!status.headPoseAcceptable) {
    return "FACE_FORWARD";
  }
  if (stableProgress < 1) {
    return "HOLD_STEADY";
  }
  return "HOLD_STEADY";
}
var PreCalibrationMonitor = class {
  stableCandidateStartedAtMs = null;
  observations = [];
  baseline = null;
  baselineCapturedForCurrentStableInterval = false;
  /**
   * Completion is latched after the first valid baseline capture.
   * A later blink or small pose deviation must not restart pre-calibration.
   * The latch is cleared only by an explicit reset() for a new run.
   */
  completed = false;
  lastTimestampMs = null;
  evaluate(input) {
    const timestampMs = input.quality.timestampMs;
    if (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs) {
      this.resetStableCandidate();
    }
    this.lastTimestampMs = timestampMs;
    if (this.completed && this.baseline !== null) {
      const geometry2 = input.geometry.geometry;
      const pose2 = input.headPose.headPose;
      return {
        feedback: {
          status: {
            ...input.quality.positionStatus,
            stable: true
          },
          instruction: "READY",
          readyForCalibration: true,
          cameraFaceBoxNormalized: geometry2 === null ? null : {
            left: geometry2.boundsNormalized.left,
            top: geometry2.boundsNormalized.top,
            width: geometry2.boundsNormalized.width,
            height: geometry2.boundsNormalized.height
          },
          metrics: {
            centerX: geometry2?.centerNormalized.x ?? null,
            centerY: geometry2?.centerNormalized.y ?? null,
            widthRatio: geometry2?.widthRatio ?? null,
            heightRatio: geometry2?.heightRatio ?? null,
            proximityProxy: geometry2?.proximityProxy ?? null,
            yawDeg: pose2?.yawDeg ?? null,
            pitchDeg: pose2?.pitchDeg ?? null,
            rollDeg: pose2?.rollDeg ?? null,
            brightness: input.cameraQuality?.brightness ?? null,
            stableDurationMs: FACE_POSITION_THRESHOLDS.REQUIRED_STABLE_DURATION_MS,
            stableProgress: 1
          }
        },
        baseline: cloneBaseline(
          this.baseline
        ),
        baselineCaptured: false
      };
    }
    const stableCandidate = isStableCandidate(input);
    let baselineCaptured = false;
    if (!stableCandidate) {
      this.resetStableCandidate();
    } else {
      if (this.stableCandidateStartedAtMs === null) {
        this.stableCandidateStartedAtMs = timestampMs;
      }
      const observation = createObservation(input);
      if (observation !== null) {
        this.observations.push(
          observation
        );
        if (this.observations.length > PRE_CALIBRATION_RUNTIME.MAX_BASELINE_SAMPLE_COUNT) {
          this.observations.shift();
        }
      }
    }
    const stableDurationMs = stableCandidate && this.stableCandidateStartedAtMs !== null ? Math.max(
      0,
      timestampMs - this.stableCandidateStartedAtMs
    ) : 0;
    const stableProgress = clamp01(
      stableDurationMs / FACE_POSITION_THRESHOLDS.REQUIRED_STABLE_DURATION_MS
    );
    const baselineReady = stableCandidate && stableProgress >= 1 && this.observations.length >= PRE_CALIBRATION_RUNTIME.MIN_BASELINE_SAMPLE_COUNT;
    if (baselineReady && !this.baselineCapturedForCurrentStableInterval) {
      this.baseline = createBaseline(
        this.observations
      );
      this.baselineCapturedForCurrentStableInterval = true;
      this.completed = true;
      baselineCaptured = true;
    }
    const readyForCalibration = baselineReady && this.baseline !== null;
    const geometry = input.geometry.geometry;
    const pose = input.headPose.headPose;
    const feedback = {
      status: {
        ...input.quality.positionStatus,
        stable: readyForCalibration
      },
      instruction: determineInstruction(
        input,
        stableProgress,
        readyForCalibration
      ),
      readyForCalibration,
      cameraFaceBoxNormalized: geometry === null ? null : {
        left: geometry.boundsNormalized.left,
        top: geometry.boundsNormalized.top,
        width: geometry.boundsNormalized.width,
        height: geometry.boundsNormalized.height
      },
      metrics: {
        centerX: geometry?.centerNormalized.x ?? null,
        centerY: geometry?.centerNormalized.y ?? null,
        widthRatio: geometry?.widthRatio ?? null,
        heightRatio: geometry?.heightRatio ?? null,
        proximityProxy: geometry?.proximityProxy ?? null,
        yawDeg: pose?.yawDeg ?? null,
        pitchDeg: pose?.pitchDeg ?? null,
        rollDeg: pose?.rollDeg ?? null,
        brightness: input.cameraQuality?.brightness ?? null,
        stableDurationMs,
        stableProgress
      }
    };
    return {
      feedback,
      baseline: cloneBaseline(
        this.baseline
      ),
      baselineCaptured
    };
  }
  getBaseline() {
    return cloneBaseline(
      this.baseline
    );
  }
  reset() {
    this.resetStableCandidate();
    this.baseline = null;
    this.baselineCapturedForCurrentStableInterval = false;
    this.completed = false;
    this.lastTimestampMs = null;
  }
  resetStableCandidate() {
    this.stableCandidateStartedAtMs = null;
    this.observations = [];
    this.baselineCapturedForCurrentStableInterval = false;
  }
};

// src/calibration/calibrationValidator.ts
function assertViewport(viewport) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration validation requires a positive finite viewport size."
    );
  }
}
function mean4(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration validation metric has no values."
    );
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}
function median4(values) {
  return percentile3(values, 0.5);
}
function percentile3(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration percentile request is invalid."
    );
  }
  const sorted = [...values].sort(
    (a2, b2) => a2 - b2
  );
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Calibration percentile could not resolve its sample values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const fraction = position - lowerIndex;
  return lower + (upper - lower) * fraction;
}
function toViewportPoint(normalized, viewport) {
  return {
    x: normalized.x * viewport.width,
    y: normalized.y * viewport.height
  };
}
function correctedSamplePrecisionDistances(point, model, viewport) {
  const correctedSamples = point.samples.filter(
    (sample) => sample.accepted && sample.rawGazeSpace === "NORMALIZED"
  ).map(
    (sample) => toViewportPoint(
      model.predict(
        sample.rawGazePoint
      ),
      viewport
    )
  );
  if (correctedSamples.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Independent validation point has no accepted samples for precision analysis.",
      {
        details: {
          pointIndex: point.pointIndex
        }
      }
    );
  }
  const center = {
    x: mean4(
      correctedSamples.map(
        (sample) => sample.x
      )
    ),
    y: mean4(
      correctedSamples.map(
        (sample) => sample.y
      )
    )
  };
  return correctedSamples.map(
    (sample) => Math.hypot(
      sample.x - center.x,
      sample.y - center.y
    )
  );
}
function sampleValidityRatio(points) {
  let accepted = 0;
  let total = 0;
  for (const point of points) {
    accepted += point.acceptedSampleCount;
    total += point.acceptedSampleCount + point.rejectedSampleCount;
  }
  if (total <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Independent validation has no stored samples for validity analysis."
    );
  }
  return accepted / total;
}
function classifySpatialBucket(point) {
  const horizontalOuter = point.x <= 0.33 || point.x >= 0.67;
  const verticalOuter = point.y <= 0.33 || point.y >= 0.67;
  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }
  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }
  return "CENTER";
}
function classifyCalibrationValidationQuality(metrics) {
  const thresholds = CALIBRATION_VALIDATION_THRESHOLDS;
  const meetsGood = metrics.meanErrorViewportWidthRatio <= thresholds.GOOD_MAX_MEAN_ERROR_WIDTH_RATIO && metrics.p95ErrorViewportWidthRatio <= thresholds.GOOD_MAX_P95_ERROR_WIDTH_RATIO && metrics.meanPrecisionViewportWidthRatio <= thresholds.GOOD_MAX_MEAN_PRECISION_WIDTH_RATIO && metrics.p95PrecisionViewportWidthRatio <= thresholds.GOOD_MAX_P95_PRECISION_WIDTH_RATIO && metrics.validSampleRatio >= thresholds.GOOD_MIN_VALID_SAMPLE_RATIO;
  if (meetsGood) {
    return "GOOD";
  }
  const meetsAcceptable = metrics.meanErrorViewportWidthRatio <= thresholds.ACCEPTABLE_MAX_MEAN_ERROR_WIDTH_RATIO && metrics.p95ErrorViewportWidthRatio <= thresholds.ACCEPTABLE_MAX_P95_ERROR_WIDTH_RATIO && metrics.meanPrecisionViewportWidthRatio <= thresholds.ACCEPTABLE_MAX_MEAN_PRECISION_WIDTH_RATIO && metrics.p95PrecisionViewportWidthRatio <= thresholds.ACCEPTABLE_MAX_P95_PRECISION_WIDTH_RATIO && metrics.validSampleRatio >= thresholds.ACCEPTABLE_MIN_VALID_SAMPLE_RATIO;
  if (meetsAcceptable) {
    return "ACCEPTABLE";
  }
  const meetsPoor = metrics.meanErrorViewportWidthRatio <= thresholds.POOR_MAX_MEAN_ERROR_WIDTH_RATIO && metrics.p95ErrorViewportWidthRatio <= thresholds.POOR_MAX_P95_ERROR_WIDTH_RATIO && metrics.meanPrecisionViewportWidthRatio <= thresholds.POOR_MAX_MEAN_PRECISION_WIDTH_RATIO && metrics.p95PrecisionViewportWidthRatio <= thresholds.POOR_MAX_P95_PRECISION_WIDTH_RATIO && metrics.validSampleRatio >= thresholds.POOR_MIN_VALID_SAMPLE_RATIO && metrics.p95ErrorPx <= thresholds.ABSOLUTE_MAX_P95_ERROR_PX;
  return meetsPoor ? "POOR" : "FAIL";
}
function meanBucketError(results, sourcePoints, bucket) {
  const values = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const sourcePoint = sourcePoints[index];
    if (result !== void 0 && sourcePoint !== void 0 && classifySpatialBucket(
      sourcePoint.targetNormalizedPoint
    ) === bucket) {
      values.push(result.errorPx);
    }
  }
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Validation pattern does not contain a ${bucket.toLowerCase()} point.`
    );
  }
  return mean4(values);
}
function validateCalibrationModel(model, validationPoints, viewport) {
  assertViewport(viewport);
  if (validationPoints.length < CALIBRATION.MIN_VALIDATION_POINT_COUNT) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Too few independent validation points were provided.",
      {
        details: {
          pointCount: validationPoints.length,
          requiredPointCount: CALIBRATION.MIN_VALIDATION_POINT_COUNT
        }
      }
    );
  }
  const pointResults = validationPoints.map(
    (point) => {
      const rawViewportPoint = toViewportPoint(
        point.representativeRawPoint,
        viewport
      );
      const rawErrorXPx = rawViewportPoint.x - point.targetViewportPoint.x;
      const rawErrorYPx = rawViewportPoint.y - point.targetViewportPoint.y;
      const rawErrorPx = Math.hypot(
        rawErrorXPx,
        rawErrorYPx
      );
      const correctedNormalized = model.predict(
        point.representativeRawPoint
      );
      const correctedViewportPoint = toViewportPoint(
        correctedNormalized,
        viewport
      );
      const errorXPx = correctedViewportPoint.x - point.targetViewportPoint.x;
      const errorYPx = correctedViewportPoint.y - point.targetViewportPoint.y;
      const errorPx2 = Math.hypot(
        errorXPx,
        errorYPx
      );
      const pointPrecisionDistances = correctedSamplePrecisionDistances(
        point,
        model,
        viewport
      );
      return {
        calibrationId: point.calibrationId,
        pointIndex: point.pointIndex,
        targetViewportPoint: point.targetViewportPoint,
        rawMeanPoint: point.representativeRawPoint,
        rawMeanSpace: "NORMALIZED",
        rawViewportPoint,
        rawErrorXPx,
        rawErrorYPx,
        rawErrorPx,
        correctedViewportPoint,
        errorXPx,
        errorYPx,
        errorPx: errorPx2,
        correctionImprovementPx: rawErrorPx - errorPx2,
        sampleCount: point.acceptedSampleCount,
        rejectedCount: point.rejectedSampleCount,
        meanPrecisionPx: mean4(pointPrecisionDistances),
        p95PrecisionPx: percentile3(pointPrecisionDistances, 0.95),
        meanHeadPose: point.meanHeadPose,
        meanFaceDistanceRatio: point.meanFaceDistanceRatio,
        meanQuality: point.meanQuality
      };
    }
  );
  const rawErrors = pointResults.map(
    (point) => point.rawErrorPx
  );
  const rawSquaredErrors = rawErrors.map(
    (error) => error * error
  );
  const errors = pointResults.map(
    (point) => point.errorPx
  );
  const squaredErrors = errors.map(
    (error) => error * error
  );
  const precisionDistances = validationPoints.flatMap(
    (point) => correctedSamplePrecisionDistances(
      point,
      model,
      viewport
    )
  );
  const meanErrorPx = mean4(errors);
  const p95ErrorPx = percentile3(errors, 0.95);
  const meanPrecisionPx2 = mean4(precisionDistances);
  const p95PrecisionPx = percentile3(
    precisionDistances,
    0.95
  );
  const metrics = {
    viewportWidthPx: viewport.width,
    viewportHeightPx: viewport.height,
    rawMeanErrorPx: mean4(rawErrors),
    rawP95ErrorPx: percentile3(rawErrors, 0.95),
    rawRmsePx: Math.sqrt(
      mean4(rawSquaredErrors)
    ),
    meanErrorPx,
    medianErrorPx: median4(errors),
    rmsePx: Math.sqrt(
      mean4(squaredErrors)
    ),
    p90ErrorPx: percentile3(errors, 0.9),
    p95ErrorPx,
    maxErrorPx: Math.max(...errors),
    horizontalErrorPx: mean4(
      pointResults.map(
        (point) => Math.abs(point.errorXPx)
      )
    ),
    verticalErrorPx: mean4(
      pointResults.map(
        (point) => Math.abs(point.errorYPx)
      )
    ),
    centerErrorPx: meanBucketError(
      pointResults,
      validationPoints,
      "CENTER"
    ),
    edgeErrorPx: meanBucketError(
      pointResults,
      validationPoints,
      "EDGE"
    ),
    cornerErrorPx: meanBucketError(
      pointResults,
      validationPoints,
      "CORNER"
    ),
    meanErrorViewportWidthRatio: meanErrorPx / viewport.width,
    p95ErrorViewportWidthRatio: p95ErrorPx / viewport.width,
    meanPrecisionPx: meanPrecisionPx2,
    p95PrecisionPx,
    meanPrecisionViewportWidthRatio: meanPrecisionPx2 / viewport.width,
    p95PrecisionViewportWidthRatio: p95PrecisionPx / viewport.width,
    meanCorrectionImprovementPx: mean4(
      pointResults.map(
        (point) => point.correctionImprovementPx
      )
    ),
    improvedPointCount: pointResults.filter(
      (point) => point.correctionImprovementPx > 0
    ).length,
    degradedPointCount: pointResults.filter(
      (point) => point.correctionImprovementPx < 0
    ).length,
    validSampleRatio: sampleValidityRatio(
      validationPoints
    )
  };
  return {
    metrics,
    quality: classifyCalibrationValidationQuality(
      metrics
    ),
    pointResults
  };
}

// src/calibration/validationManager.ts
function assertViewport2(viewport) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Validation requires a positive finite viewport size."
    );
  }
}
function isFiniteTarget2(target) {
  return Number.isInteger(target.pointIndex) && target.pointIndex >= 0 && Number.isFinite(
    target.normalizedPoint.x
  ) && Number.isFinite(
    target.normalizedPoint.y
  ) && target.normalizedPoint.x >= 0 && target.normalizedPoint.x <= 1 && target.normalizedPoint.y >= 0 && target.normalizedPoint.y <= 1 && Number.isFinite(
    target.viewportPoint.x
  ) && Number.isFinite(
    target.viewportPoint.y
  ) && target.viewportPoint.x >= 0 && target.viewportPoint.y >= 0;
}
var ValidationManager = class {
  collector = new CalibrationCollector();
  model = new CalibrationModel();
  calibrationId = null;
  viewport = null;
  activePoint = null;
  cleanedPoints = [];
  validation = null;
  faceBaseline = null;
  start(calibrationId, model, viewport, expectedPointCount, faceBaseline = null) {
    if (calibrationId.trim().length === 0 || !Number.isInteger(expectedPointCount) || expectedPointCount < CALIBRATION.MIN_VALIDATION_POINT_COUNT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Validation startup metadata is invalid."
      );
    }
    assertViewport2(viewport);
    this.collector.reset();
    this.model.setModel(model);
    this.calibrationId = calibrationId;
    this.viewport = {
      ...viewport
    };
    this.expectedPointCount = expectedPointCount;
    this.activePoint = null;
    this.cleanedPoints = [];
    this.validation = null;
    this.faceBaseline = faceBaseline === null ? null : {
      ...faceBaseline,
      headPose: {
        ...faceBaseline.headPose
      }
    };
  }
  expectedPointCount = 0;
  beginPoint(calibrationId, target, targetShownAtMs) {
    this.assertActiveValidation(
      calibrationId
    );
    if (this.validation !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation is already complete."
      );
    }
    if (this.activePoint !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A validation point is already being collected."
      );
    }
    const expectedPointIndex = this.cleanedPoints.length;
    if (!isFiniteTarget2(target) || target.pointIndex !== expectedPointIndex || target.pointIndex >= this.expectedPointCount) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Validation target is invalid or out of sequence.",
        {
          details: {
            requestedPointIndex: target.pointIndex,
            expectedPointIndex,
            expectedPointCount: this.expectedPointCount
          }
        }
      );
    }
    this.activePoint = {
      pointIndex: target.pointIndex,
      normalizedPoint: {
        ...target.normalizedPoint
      },
      viewportPoint: {
        ...target.viewportPoint
      }
    };
    this.collector.beginPoint(
      calibrationId,
      this.activePoint,
      targetShownAtMs,
      this.faceBaseline
    );
  }
  observe(observation) {
    return this.collector.observe(
      observation
    );
  }
  finishActivePoint(timestampMs) {
    const calibrationId = this.calibrationId;
    const activePoint = this.activePoint;
    if (calibrationId === null || activePoint === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation has no active point to finish."
      );
    }
    const collection = this.collector.finishPoint(
      timestampMs
    );
    if (!collection.sufficient) {
      const failureReason = collection.stability?.stable === false || collection.acceptedSampleCount >= CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT && collection.stability === null ? "UNSTABLE_GAZE" : "INSUFFICIENT_SAMPLES";
      return this.completeInsufficientPoint(
        activePoint,
        collection.acceptedSampleCount,
        collection.rejectedSampleCount,
        collection.rejectionRatio,
        failureReason
      );
    }
    let cleaned;
    try {
      cleaned = cleanCalibrationPoint(
        collection
      );
    } catch (error) {
      if (isTrackerError(error) && error.code === ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES) {
        return this.completeInsufficientPoint(
          activePoint,
          collection.acceptedSampleCount,
          collection.rejectedSampleCount,
          collection.rejectionRatio,
          "OUTLIER_REJECTION"
        );
      }
      throw error;
    }
    this.cleanedPoints.push(
      cleaned
    );
    this.activePoint = null;
    this.collector.reset();
    if (this.cleanedPoints.length === this.expectedPointCount) {
      const viewport = this.viewport;
      if (viewport === null) {
        throw new TrackerError(
          ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
          "CALIBRATION",
          "Validation viewport disappeared before scoring."
        );
      }
      this.validation = validateCalibrationModel(
        this.model,
        this.cleanedPoints,
        viewport
      );
    }
    return {
      calibrationId,
      pointIndex: cleaned.pointIndex,
      sufficient: true,
      acceptedSampleCount: cleaned.acceptedSampleCount,
      rejectedSampleCount: cleaned.rejectedSampleCount,
      rejectionRatio: cleaned.rejectionRatio,
      completedPointCount: this.cleanedPoints.length,
      expectedPointCount: this.expectedPointCount,
      failureReason: null,
      validationComplete: this.validation !== null,
      validation: this.validation
    };
  }
  getSnapshot() {
    return {
      calibrationId: this.calibrationId,
      active: this.calibrationId !== null,
      activePointIndex: this.activePoint?.pointIndex ?? null,
      completedPointCount: this.cleanedPoints.length,
      expectedPointCount: this.expectedPointCount,
      validationComplete: this.validation !== null
    };
  }
  reset() {
    this.collector.reset();
    this.model.clear();
    this.calibrationId = null;
    this.viewport = null;
    this.activePoint = null;
    this.cleanedPoints = [];
    this.validation = null;
    this.expectedPointCount = 0;
  }
  completeInsufficientPoint(activePoint, acceptedSampleCount, rejectedSampleCount, rejectionRatio, failureReason) {
    const calibrationId = this.calibrationId;
    if (calibrationId === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration ID disappeared while finishing a validation point."
      );
    }
    this.activePoint = null;
    this.collector.reset();
    return {
      calibrationId,
      pointIndex: activePoint.pointIndex,
      sufficient: false,
      acceptedSampleCount,
      rejectedSampleCount,
      rejectionRatio,
      completedPointCount: this.cleanedPoints.length,
      expectedPointCount: this.expectedPointCount,
      failureReason,
      validationComplete: false,
      validation: null
    };
  }
  assertActiveValidation(calibrationId) {
    if (this.calibrationId === null || this.viewport === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation has not been started."
      );
    }
    if (calibrationId !== this.calibrationId) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Validation point belongs to a different calibration run."
      );
    }
  }
};

// src/camera/cameraQuality.ts
function toLuminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
var CameraQualityEstimator = class {
  canvas;
  context;
  frameTimestamps = [];
  disposed = false;
  constructor() {
    this.canvas = new OffscreenCanvas(
      CAMERA_QUALITY_SAMPLING.WIDTH,
      CAMERA_QUALITY_SAMPLING.HEIGHT
    );
    const context = this.canvas.getContext(
      "2d",
      {
        willReadFrequently: true
      }
    );
    if (context === null) {
      throw new TrackerError(
        ERROR_CODES.CAMERA_QUALITY_FAILED,
        "CAMERA",
        "Could not create the camera-quality 2D canvas context."
      );
    }
    this.context = context;
  }
  evaluate(frame) {
    this.assertUsable();
    try {
      this.context.drawImage(
        frame.source,
        0,
        0,
        CAMERA_QUALITY_SAMPLING.WIDTH,
        CAMERA_QUALITY_SAMPLING.HEIGHT
      );
      const imageData = this.context.getImageData(
        0,
        0,
        CAMERA_QUALITY_SAMPLING.WIDTH,
        CAMERA_QUALITY_SAMPLING.HEIGHT
      );
      const brightness = this.calculateBrightness(
        imageData.data
      );
      const sharpness = this.calculateSharpness(
        imageData.data,
        imageData.width,
        imageData.height
      );
      const frameRateActual = this.updateFrameRate(
        frame.metadata.timestampMs
      );
      return {
        brightness,
        sharpness,
        frameRateActual,
        quality: this.classifyQuality(
          brightness,
          sharpness,
          frameRateActual
        )
      };
    } catch (error) {
      throw normalizeTrackerError(
        error,
        ERROR_CODES.CAMERA_QUALITY_FAILED,
        "CAMERA",
        "Camera quality evaluation failed."
      );
    }
  }
  reset() {
    this.assertUsable();
    this.frameTimestamps.length = 0;
  }
  dispose() {
    this.frameTimestamps.length = 0;
    this.disposed = true;
  }
  /* ========================================================================
   * Brightness
   * ====================================================================== */
  calculateBrightness(data) {
    let luminanceSum = 0;
    let pixelCount = 0;
    for (let index = 0; index + 2 < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (red === void 0 || green === void 0 || blue === void 0) {
        continue;
      }
      luminanceSum += toLuminance(
        red,
        green,
        blue
      );
      pixelCount += 1;
    }
    if (pixelCount === 0) {
      return 0;
    }
    return clamp01(
      luminanceSum / pixelCount / 255
    );
  }
  /* ========================================================================
   * Sharpness
   * ====================================================================== */
  /**
   * Mean absolute luminance gradient normalized to 0..1.
   *
   * This is intentionally lightweight. It is a runtime blur signal rather
   * than a calibrated optical sharpness measurement.
   */
  calculateSharpness(data, width, height) {
    if (width < 2 || height < 2) {
      return 0;
    }
    let gradientSum = 0;
    let comparisonCount = 0;
    const luminanceAt = (x2, y2) => {
      const offset = (y2 * width + x2) * 4;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      return toLuminance(
        red,
        green,
        blue
      );
    };
    for (let y2 = 0; y2 < height - 1; y2 += 1) {
      for (let x2 = 0; x2 < width - 1; x2 += 1) {
        const current = luminanceAt(x2, y2);
        const right = luminanceAt(
          x2 + 1,
          y2
        );
        const below = luminanceAt(
          x2,
          y2 + 1
        );
        gradientSum += Math.abs(
          current - right
        ) + Math.abs(
          current - below
        );
        comparisonCount += 2;
      }
    }
    if (comparisonCount === 0) {
      return 0;
    }
    return clamp01(
      gradientSum / comparisonCount / 255
    );
  }
  /* ========================================================================
   * Actual frame rate
   * ====================================================================== */
  updateFrameRate(timestampMs) {
    this.frameTimestamps.push(
      timestampMs
    );
    const maximumTimestampCount = CAMERA_QUALITY_SAMPLING.FPS_WINDOW_SIZE + 1;
    if (this.frameTimestamps.length > maximumTimestampCount) {
      this.frameTimestamps.shift();
    }
    if (this.frameTimestamps.length < 2) {
      return 0;
    }
    const first = this.frameTimestamps[0];
    const last = this.frameTimestamps[this.frameTimestamps.length - 1];
    if (first === void 0 || last === void 0) {
      return 0;
    }
    const elapsedMs = last - first;
    if (elapsedMs <= 0) {
      return 0;
    }
    return (this.frameTimestamps.length - 1) * TIME.MS_PER_SECOND / elapsedMs;
  }
  /* ========================================================================
   * Quality classification
   * ====================================================================== */
  classifyQuality(brightness, sharpness, frameRateActual) {
    if (!Number.isFinite(brightness) || !Number.isFinite(sharpness) || !Number.isFinite(frameRateActual)) {
      return "INVALID";
    }
    const lightingAcceptable = brightness >= CAMERA_QUALITY_THRESHOLDS.MIN_BRIGHTNESS && brightness <= CAMERA_QUALITY_THRESHOLDS.MAX_BRIGHTNESS;
    const sharpnessAcceptable = sharpness >= CAMERA_QUALITY_THRESHOLDS.MIN_SHARPNESS;
    if (!lightingAcceptable || !sharpnessAcceptable) {
      return "POOR";
    }
    if (this.frameTimestamps.length < CAMERA_QUALITY_SAMPLING.MIN_FPS_SAMPLE_COUNT) {
      return "FAIR";
    }
    if (frameRateActual < CAMERA_QUALITY_THRESHOLDS.MIN_ACCEPTABLE_FPS) {
      return "POOR";
    }
    return "GOOD";
  }
  assertUsable() {
    if (!this.disposed) {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CAMERA",
      "Disposed CameraQualityEstimator cannot be used."
    );
  }
};

// src/camera/frameCapture.ts
var FrameCapture = class {
  constructor(videoElement) {
    this.videoElement = videoElement;
  }
  videoElement;
  frameSequence = 0;
  disposed = false;
  /**
   * Returns a view of the current decoded video frame.
   *
   * This method intentionally avoids ImageData/ImageBitmap allocation so the
   * future face/gaze inference loop can consume the video source directly.
   */
  captureCurrentFrame() {
    this.assertUsable();
    if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || this.videoElement.videoWidth <= 0 || this.videoElement.videoHeight <= 0) {
      throw new TrackerError(
        ERROR_CODES.CAMERA_FRAME_UNAVAILABLE,
        "CAMERA",
        "No decoded camera frame is currently available.",
        {
          details: {
            readyState: this.videoElement.readyState,
            videoWidth: this.videoElement.videoWidth,
            videoHeight: this.videoElement.videoHeight
          }
        }
      );
    }
    this.frameSequence += 1;
    return {
      source: this.videoElement,
      metadata: {
        frameSequence: this.frameSequence,
        timestampMs: nowTimelineMs(),
        width: this.videoElement.videoWidth,
        height: this.videoElement.videoHeight
      }
    };
  }
  reset() {
    this.assertUsable();
    this.frameSequence = 0;
  }
  dispose() {
    this.disposed = true;
  }
  assertUsable() {
    if (!this.disposed) {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CAMERA",
      "Disposed FrameCapture cannot be used."
    );
  }
};

// src/face/blinkDetector.ts
var DEFAULT_BLINK_CONFIG = {
  closedThreshold: BLINK_THRESHOLDS.CLOSED_THRESHOLD,
  openThreshold: BLINK_THRESHOLDS.OPEN_THRESHOLD,
  minBlinkDurationMs: BLINK_THRESHOLDS.MIN_BLINK_DURATION_MS,
  maxBlinkDurationMs: BLINK_THRESHOLDS.MAX_BLINK_DURATION_MS,
  reopenConfirmationMs: BLINK_THRESHOLDS.REOPEN_CONFIRMATION_MS,
  maxInvalidSampleGapMs: BLINK_THRESHOLDS.MAX_INVALID_SAMPLE_GAP_MS
};
function validateConfig(config) {
  if (!Number.isFinite(config.closedThreshold) || !Number.isFinite(config.openThreshold) || config.closedThreshold < 0 || config.openThreshold <= config.closedThreshold) {
    throw new RangeError(
      "Blink thresholds must be finite and OPEN_THRESHOLD must be greater than CLOSED_THRESHOLD."
    );
  }
  if (!Number.isFinite(config.minBlinkDurationMs) || !Number.isFinite(config.maxBlinkDurationMs) || config.minBlinkDurationMs < 0 || config.maxBlinkDurationMs < config.minBlinkDurationMs) {
    throw new RangeError(
      "Blink duration thresholds are invalid."
    );
  }
  if (!Number.isFinite(config.reopenConfirmationMs) || config.reopenConfirmationMs < 0 || !Number.isFinite(
    config.maxInvalidSampleGapMs
  ) || config.maxInvalidSampleGapMs < 0) {
    throw new RangeError(
      "Blink temporal guard values must be finite and non-negative."
    );
  }
}
function classifyEyeState(previousState, lidOpeningRatio, config) {
  if (!Number.isFinite(lidOpeningRatio)) {
    return "UNKNOWN";
  }
  switch (previousState) {
    case "UNKNOWN":
      if (lidOpeningRatio <= config.closedThreshold) {
        return "CLOSED";
      }
      if (lidOpeningRatio >= config.openThreshold) {
        return "OPEN";
      }
      return "UNKNOWN";
    case "OPEN":
      return lidOpeningRatio <= config.closedThreshold ? "CLOSED" : "OPEN";
    case "CLOSED":
      return lidOpeningRatio >= config.openThreshold ? "OPEN" : "CLOSED";
  }
}
function nonNegativeDuration(startMs, endMs) {
  return Math.max(
    0,
    endMs - startMs
  );
}
var BlinkDetector = class {
  config;
  leftEyeState = "UNKNOWN";
  rightEyeState = "UNKNOWN";
  closureStartedAtMs = null;
  reopenStartedAtMs = null;
  prolongedClosureReported = false;
  lastValidTimestampMs = null;
  lastInputTimestampMs = null;
  constructor(config = DEFAULT_BLINK_CONFIG) {
    validateConfig(config);
    this.config = {
      closedThreshold: config.closedThreshold,
      openThreshold: config.openThreshold,
      minBlinkDurationMs: config.minBlinkDurationMs,
      maxBlinkDurationMs: config.maxBlinkDurationMs,
      reopenConfirmationMs: config.reopenConfirmationMs,
      maxInvalidSampleGapMs: config.maxInvalidSampleGapMs
    };
  }
  analyze(frame) {
    if (!Number.isFinite(frame.timestampMs)) {
      this.reset();
      return this.handleInvalidFrame(frame);
    }
    this.handleTimestampDiscontinuity(
      frame.timestampMs
    );
    this.lastInputTimestampMs = frame.timestampMs;
    if (!frame.geometryValid || frame.leftEye === null || frame.rightEye === null) {
      return this.handleInvalidFrame(
        frame
      );
    }
    this.handleValidSampleGap(
      frame.timestampMs
    );
    this.lastValidTimestampMs = frame.timestampMs;
    this.leftEyeState = classifyEyeState(
      this.leftEyeState,
      frame.leftEye.lidOpeningRatio,
      this.config
    );
    this.rightEyeState = classifyEyeState(
      this.rightEyeState,
      frame.rightEye.lidOpeningRatio,
      this.config
    );
    const bothEyesOpen = this.leftEyeState === "OPEN" && this.rightEyeState === "OPEN";
    const bothEyesClosed = this.leftEyeState === "CLOSED" && this.rightEyeState === "CLOSED";
    const asymmetricClosure = this.leftEyeState === "CLOSED" && this.rightEyeState === "OPEN" || this.leftEyeState === "OPEN" && this.rightEyeState === "CLOSED";
    if (this.closureStartedAtMs === null && bothEyesClosed) {
      this.closureStartedAtMs = frame.timestampMs;
      this.reopenStartedAtMs = null;
      this.prolongedClosureReported = false;
    }
    let event = null;
    if (this.closureStartedAtMs !== null) {
      event = this.updateActiveClosure(
        frame.timestampMs,
        bothEyesOpen,
        bothEyesClosed
      );
    }
    const activeClosureDurationMs = this.closureStartedAtMs === null ? null : nonNegativeDuration(
      this.closureStartedAtMs,
      frame.timestampMs
    );
    return {
      frameSequence: frame.frameSequence,
      timestampMs: frame.timestampMs,
      valid: true,
      leftEyeState: this.leftEyeState,
      rightEyeState: this.rightEyeState,
      bothEyesOpen,
      bothEyesClosed,
      asymmetricClosure,
      blinkInProgress: this.closureStartedAtMs !== null,
      activeClosureDurationMs,
      blinkDetected: event?.kind === "BLINK",
      prolongedClosureDetected: event?.kind === "PROLONGED_CLOSURE",
      event
    };
  }
  /**
   * Clears temporal state. Call this when starting a new tracking session,
   * after a camera restart, or after a discontinuous video timeline.
   */
  reset() {
    this.leftEyeState = "UNKNOWN";
    this.rightEyeState = "UNKNOWN";
    this.closureStartedAtMs = null;
    this.reopenStartedAtMs = null;
    this.prolongedClosureReported = false;
    this.lastValidTimestampMs = null;
    this.lastInputTimestampMs = null;
  }
  handleTimestampDiscontinuity(timestampMs) {
    if (this.lastInputTimestampMs !== null && timestampMs < this.lastInputTimestampMs) {
      this.reset();
    }
  }
  handleValidSampleGap(timestampMs) {
    if (this.lastValidTimestampMs === null) {
      return;
    }
    const gapMs = timestampMs - this.lastValidTimestampMs;
    if (gapMs > this.config.maxInvalidSampleGapMs) {
      this.resetTemporalClosureState();
      this.leftEyeState = "UNKNOWN";
      this.rightEyeState = "UNKNOWN";
    }
  }
  handleInvalidFrame(frame) {
    if (this.lastValidTimestampMs !== null && frame.timestampMs - this.lastValidTimestampMs > this.config.maxInvalidSampleGapMs) {
      this.resetTemporalClosureState();
      this.leftEyeState = "UNKNOWN";
      this.rightEyeState = "UNKNOWN";
    }
    return {
      frameSequence: frame.frameSequence,
      timestampMs: frame.timestampMs,
      valid: false,
      leftEyeState: "UNKNOWN",
      rightEyeState: "UNKNOWN",
      bothEyesOpen: false,
      bothEyesClosed: false,
      asymmetricClosure: false,
      blinkInProgress: this.closureStartedAtMs !== null,
      activeClosureDurationMs: this.closureStartedAtMs === null ? null : nonNegativeDuration(
        this.closureStartedAtMs,
        frame.timestampMs
      ),
      blinkDetected: false,
      prolongedClosureDetected: false,
      event: null
    };
  }
  updateActiveClosure(timestampMs, bothEyesOpen, bothEyesClosed) {
    const closureStartedAtMs = this.closureStartedAtMs;
    if (closureStartedAtMs === null) {
      return null;
    }
    const currentDurationMs = nonNegativeDuration(
      closureStartedAtMs,
      timestampMs
    );
    if (currentDurationMs > this.config.maxBlinkDurationMs && !this.prolongedClosureReported) {
      this.prolongedClosureReported = true;
      return {
        kind: "PROLONGED_CLOSURE",
        startedAtMs: closureStartedAtMs,
        endedAtMs: null,
        durationMs: currentDurationMs
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
    const reopenedForMs = nonNegativeDuration(
      this.reopenStartedAtMs,
      timestampMs
    );
    if (reopenedForMs < this.config.reopenConfirmationMs) {
      return null;
    }
    const endedAtMs = this.reopenStartedAtMs;
    const durationMs = nonNegativeDuration(
      closureStartedAtMs,
      endedAtMs
    );
    const shouldReportBlink = !this.prolongedClosureReported && durationMs >= this.config.minBlinkDurationMs && durationMs <= this.config.maxBlinkDurationMs;
    this.resetTemporalClosureState();
    return shouldReportBlink ? {
      kind: "BLINK",
      startedAtMs: closureStartedAtMs,
      endedAtMs,
      durationMs
    } : null;
  }
  resetTemporalClosureState() {
    this.closureStartedAtMs = null;
    this.reopenStartedAtMs = null;
    this.prolongedClosureReported = false;
  }
};

// src/face/eyeGeometry.ts
var LEFT_EYE_CONFIGURATION = {
  side: "LEFT",
  contourIndices: FACE_LANDMARK_INDICES.LEFT_EYE_CONTOUR,
  irisIndices: FACE_LANDMARK_INDICES.LEFT_IRIS,
  outerCornerIndex: FACE_LANDMARK_INDICES.LEFT_EYE_OUTER_CORNER,
  innerCornerIndex: FACE_LANDMARK_INDICES.LEFT_EYE_INNER_CORNER,
  eyelidPairs: FACE_LANDMARK_INDICES.LEFT_EYELID_PAIRS
};
var RIGHT_EYE_CONFIGURATION = {
  side: "RIGHT",
  contourIndices: FACE_LANDMARK_INDICES.RIGHT_EYE_CONTOUR,
  irisIndices: FACE_LANDMARK_INDICES.RIGHT_IRIS,
  outerCornerIndex: FACE_LANDMARK_INDICES.RIGHT_EYE_OUTER_CORNER,
  innerCornerIndex: FACE_LANDMARK_INDICES.RIGHT_EYE_INNER_CORNER,
  eyelidPairs: FACE_LANDMARK_INDICES.RIGHT_EYELID_PAIRS
};
function getLandmark(landmarks, index) {
  const landmark = landmarks[index];
  if (landmark === void 0 || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) || !Number.isFinite(landmark.z)) {
    return null;
  }
  return landmark;
}
function toPoint2D(landmark) {
  return {
    x: landmark.x,
    y: landmark.y
  };
}
function toPixelPoint(point, frameWidth, frameHeight) {
  return {
    x: point.x * frameWidth,
    y: point.y * frameHeight
  };
}
function averageLandmarks(landmarks, indices) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const index of indices) {
    const landmark = getLandmark(
      landmarks,
      index
    );
    if (landmark === null) {
      return null;
    }
    sumX += landmark.x;
    sumY += landmark.y;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return {
    x: sumX / count,
    y: sumY / count
  };
}
function midpoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}
function subtract(first, second) {
  return {
    x: first.x - second.x,
    y: first.y - second.y
  };
}
function dot2(first, second) {
  return first.x * second.x + first.y * second.y;
}
function vectorLength(vector) {
  return Math.hypot(
    vector.x,
    vector.y
  );
}
function normalize(vector) {
  const length = vectorLength(
    vector
  );
  if (!Number.isFinite(length) || length < EYE_GEOMETRY_RUNTIME.MIN_AXIS_LENGTH_PX) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}
function distance2(first, second) {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y
  );
}
function orderCornersByImageX(first, second) {
  return first.x <= second.x ? [first, second] : [second, first];
}
function calculateMeanLidOpeningPx(landmarks, pairs, frameWidth, frameHeight) {
  if (pairs.length === 0) {
    return null;
  }
  let total = 0;
  for (const pair of pairs) {
    const upper = getLandmark(
      landmarks,
      pair[0]
    );
    const lower = getLandmark(
      landmarks,
      pair[1]
    );
    if (upper === null || lower === null) {
      return null;
    }
    total += distance2(
      toPixelPoint(
        toPoint2D(upper),
        frameWidth,
        frameHeight
      ),
      toPixelPoint(
        toPoint2D(lower),
        frameWidth,
        frameHeight
      )
    );
  }
  const mean15 = total / pairs.length;
  return Number.isFinite(mean15) ? mean15 : null;
}
function calculateIrisRadiusPx(landmarks, irisIndices, irisCenterPx, frameWidth, frameHeight) {
  if (irisIndices.length === 0) {
    return null;
  }
  let totalRadius = 0;
  for (const index of irisIndices) {
    const landmark = getLandmark(
      landmarks,
      index
    );
    if (landmark === null) {
      return null;
    }
    totalRadius += distance2(
      irisCenterPx,
      toPixelPoint(
        toPoint2D(landmark),
        frameWidth,
        frameHeight
      )
    );
  }
  const radius = totalRadius / irisIndices.length;
  return Number.isFinite(radius) ? radius : null;
}
function calculateEyeGeometry(result, configuration) {
  const contourCenterNormalized = averageLandmarks(
    result.landmarks,
    configuration.contourIndices
  );
  const irisCenterNormalized = averageLandmarks(
    result.landmarks,
    configuration.irisIndices
  );
  const outerCorner = getLandmark(
    result.landmarks,
    configuration.outerCornerIndex
  );
  const innerCorner = getLandmark(
    result.landmarks,
    configuration.innerCornerIndex
  );
  if (contourCenterNormalized === null || irisCenterNormalized === null || outerCorner === null || innerCorner === null) {
    return null;
  }
  const outerCornerNormalized = toPoint2D(
    outerCorner
  );
  const innerCornerNormalized = toPoint2D(
    innerCorner
  );
  const contourCenterPx = toPixelPoint(
    contourCenterNormalized,
    result.frameWidth,
    result.frameHeight
  );
  const irisCenterPx = toPixelPoint(
    irisCenterNormalized,
    result.frameWidth,
    result.frameHeight
  );
  const outerCornerPx = toPixelPoint(
    outerCornerNormalized,
    result.frameWidth,
    result.frameHeight
  );
  const innerCornerPx = toPixelPoint(
    innerCornerNormalized,
    result.frameWidth,
    result.frameHeight
  );
  const eyeWidthPx = distance2(
    outerCornerPx,
    innerCornerPx
  );
  if (!Number.isFinite(eyeWidthPx) || eyeWidthPx < EYE_GEOMETRY_RUNTIME.MIN_EYE_WIDTH_PX) {
    return null;
  }
  const meanLidOpeningPx = calculateMeanLidOpeningPx(
    result.landmarks,
    configuration.eyelidPairs,
    result.frameWidth,
    result.frameHeight
  );
  const irisRadiusPx = calculateIrisRadiusPx(
    result.landmarks,
    configuration.irisIndices,
    irisCenterPx,
    result.frameWidth,
    result.frameHeight
  );
  if (meanLidOpeningPx === null || irisRadiusPx === null) {
    return null;
  }
  const irisDiameterPx = irisRadiusPx * 2;
  if (irisDiameterPx < EYE_GEOMETRY_RUNTIME.MIN_IRIS_DIAMETER_PX) {
    return null;
  }
  const [imageLeftCorner, imageRightCorner] = orderCornersByImageX(
    outerCornerPx,
    innerCornerPx
  );
  const eyeAxis = normalize(
    subtract(
      imageRightCorner,
      imageLeftCorner
    )
  );
  if (eyeAxis === null) {
    return null;
  }
  const imageDownAxis = {
    x: -eyeAxis.y,
    y: eyeAxis.x
  };
  const cornerMidpoint = midpoint(
    imageLeftCorner,
    imageRightCorner
  );
  const irisFromMidpoint = subtract(
    irisCenterPx,
    cornerMidpoint
  );
  const horizontalOffsetPx = dot2(
    irisFromMidpoint,
    eyeAxis
  );
  const verticalOffsetPx = dot2(
    irisFromMidpoint,
    imageDownAxis
  );
  const irisHorizontalOffsetRatio = horizontalOffsetPx / eyeWidthPx;
  const irisVerticalOffsetRatio = verticalOffsetPx / eyeWidthPx;
  const irisHorizontalPositionRatio = 0.5 + irisHorizontalOffsetRatio;
  const lidOpeningRatio = meanLidOpeningPx / eyeWidthPx;
  const eyeWidthRatio = eyeWidthPx / result.frameWidth;
  if (!Number.isFinite(lidOpeningRatio) || !Number.isFinite(eyeWidthRatio) || !Number.isFinite(
    irisHorizontalPositionRatio
  ) || !Number.isFinite(
    irisHorizontalOffsetRatio
  ) || !Number.isFinite(
    irisVerticalOffsetRatio
  )) {
    return null;
  }
  return {
    side: configuration.side,
    contourCenterNormalized,
    contourCenterPx,
    irisCenterNormalized,
    irisCenterPx,
    outerCornerNormalized,
    innerCornerNormalized,
    outerCornerPx,
    innerCornerPx,
    eyeWidthPx,
    eyeWidthRatio,
    meanLidOpeningPx,
    lidOpeningRatio,
    irisRadiusPx,
    irisDiameterPx,
    irisHorizontalPositionRatio,
    irisHorizontalOffsetRatio,
    irisVerticalOffsetRatio
  };
}
var EyeGeometryAnalyzer = class {
  analyze(result) {
    if (!result.faceDetected || result.landmarks.length === 0 || result.frameWidth <= 0 || result.frameHeight <= 0) {
      return this.createInvalidResult(
        result,
        false
      );
    }
    const leftEye = calculateEyeGeometry(
      result,
      LEFT_EYE_CONFIGURATION
    );
    const rightEye = calculateEyeGeometry(
      result,
      RIGHT_EYE_CONFIGURATION
    );
    const leftEyeValid = leftEye !== null;
    const rightEyeValid = rightEye !== null;
    const bothEyesValid = leftEyeValid && rightEyeValid;
    return {
      frameSequence: result.frameSequence,
      timestampMs: result.timestampMs,
      frameWidth: result.frameWidth,
      frameHeight: result.frameHeight,
      faceDetected: true,
      leftEyeValid,
      rightEyeValid,
      bothEyesValid,
      geometryValid: bothEyesValid,
      leftEye,
      rightEye
    };
  }
  createInvalidResult(result, faceDetected) {
    return {
      frameSequence: result.frameSequence,
      timestampMs: result.timestampMs,
      frameWidth: result.frameWidth,
      frameHeight: result.frameHeight,
      faceDetected,
      leftEyeValid: false,
      rightEyeValid: false,
      bothEyesValid: false,
      geometryValid: false,
      leftEye: null,
      rightEye: null
    };
  }
};

// src/face/faceGeometry.ts
function toPoint2D2(landmark) {
  return {
    x: landmark.x,
    y: landmark.y
  };
}
function toPixelPoint2(point, frameWidth, frameHeight) {
  return {
    x: point.x * frameWidth,
    y: point.y * frameHeight
  };
}
function distance3(first, second) {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y
  );
}
function midpoint2(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}
function getLandmark2(landmarks, index) {
  const landmark = landmarks[index];
  if (landmark === void 0 || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) || !Number.isFinite(landmark.z)) {
    return null;
  }
  return landmark;
}
function averageLandmarks2(landmarks, indices) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const index of indices) {
    const landmark = getLandmark2(
      landmarks,
      index
    );
    if (landmark === null) {
      return null;
    }
    sumX += landmark.x;
    sumY += landmark.y;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return {
    x: sumX / count,
    y: sumY / count
  };
}
function calculateBounds(landmarks, indices) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    const landmark = getLandmark2(
      landmarks,
      index
    );
    if (landmark === null) {
      return null;
    }
    left = Math.min(
      left,
      landmark.x
    );
    top = Math.min(
      top,
      landmark.y
    );
    right = Math.max(
      right,
      landmark.x
    );
    bottom = Math.max(
      bottom,
      landmark.y
    );
  }
  const width = right - left;
  const height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < FACE_GEOMETRY_RUNTIME.MIN_NORMALIZED_DIMENSION || height < FACE_GEOMETRY_RUNTIME.MIN_NORMALIZED_DIMENSION) {
    return null;
  }
  return {
    left,
    top,
    right,
    bottom,
    width,
    height
  };
}
function boundsToPixelRect(bounds, frameWidth, frameHeight) {
  return {
    left: bounds.left * frameWidth,
    top: bounds.top * frameHeight,
    width: bounds.width * frameWidth,
    height: bounds.height * frameHeight
  };
}
var FaceGeometryAnalyzer = class {
  analyze(result) {
    if (!result.faceDetected || result.landmarks.length === 0) {
      return this.createInvalidResult(
        result,
        false
      );
    }
    const geometry = this.calculateGeometry(
      result
    );
    return {
      frameSequence: result.frameSequence,
      timestampMs: result.timestampMs,
      frameWidth: result.frameWidth,
      frameHeight: result.frameHeight,
      faceDetected: true,
      geometryValid: geometry !== null,
      geometry
    };
  }
  calculateGeometry(result) {
    if (result.frameWidth <= 0 || result.frameHeight <= 0) {
      return null;
    }
    const bounds = calculateBounds(
      result.landmarks,
      FACE_LANDMARK_INDICES.FACE_OVAL
    );
    if (bounds === null) {
      return null;
    }
    const noseTip = getLandmark2(
      result.landmarks,
      FACE_LANDMARK_INDICES.NOSE_TIP
    );
    const foreheadTop = getLandmark2(
      result.landmarks,
      FACE_LANDMARK_INDICES.FOREHEAD_TOP
    );
    const chin = getLandmark2(
      result.landmarks,
      FACE_LANDMARK_INDICES.CHIN
    );
    const leftCheek = getLandmark2(
      result.landmarks,
      FACE_LANDMARK_INDICES.LEFT_CHEEK
    );
    const rightCheek = getLandmark2(
      result.landmarks,
      FACE_LANDMARK_INDICES.RIGHT_CHEEK
    );
    const leftEyeCenter = averageLandmarks2(
      result.landmarks,
      FACE_LANDMARK_INDICES.LEFT_EYE_CONTOUR
    );
    const rightEyeCenter = averageLandmarks2(
      result.landmarks,
      FACE_LANDMARK_INDICES.RIGHT_EYE_CONTOUR
    );
    if (noseTip === null || foreheadTop === null || chin === null || leftCheek === null || rightCheek === null || leftEyeCenter === null || rightEyeCenter === null) {
      return null;
    }
    const centerNormalized = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2
    };
    const centerPx = toPixelPoint2(
      centerNormalized,
      result.frameWidth,
      result.frameHeight
    );
    const leftEyePx = toPixelPoint2(
      leftEyeCenter,
      result.frameWidth,
      result.frameHeight
    );
    const rightEyePx = toPixelPoint2(
      rightEyeCenter,
      result.frameWidth,
      result.frameHeight
    );
    const eyeMidpointNormalized = midpoint2(
      leftEyeCenter,
      rightEyeCenter
    );
    const eyeMidpointPx = midpoint2(
      leftEyePx,
      rightEyePx
    );
    const interocularDistancePx = distance3(
      leftEyePx,
      rightEyePx
    );
    if (interocularDistancePx < FACE_GEOMETRY_RUNTIME.MIN_PIXEL_DISTANCE) {
      return null;
    }
    const areaRatio = bounds.width * bounds.height;
    const aspectRatio = bounds.width / bounds.height;
    return {
      boundsNormalized: bounds,
      boundsPx: boundsToPixelRect(
        bounds,
        result.frameWidth,
        result.frameHeight
      ),
      centerNormalized,
      centerPx,
      widthRatio: bounds.width,
      heightRatio: bounds.height,
      areaRatio,
      aspectRatio,
      proximityProxy: Math.sqrt(
        areaRatio
      ),
      eyeCenters: {
        leftNormalized: leftEyeCenter,
        rightNormalized: rightEyeCenter,
        midpointNormalized: eyeMidpointNormalized,
        leftPx: leftEyePx,
        rightPx: rightEyePx,
        midpointPx: eyeMidpointPx,
        interocularDistancePx,
        interocularDistanceRatio: interocularDistancePx / result.frameWidth
      },
      anchors: {
        noseTipNormalized: toPoint2D2(
          noseTip
        ),
        foreheadTopNormalized: toPoint2D2(
          foreheadTop
        ),
        chinNormalized: toPoint2D2(
          chin
        ),
        leftCheekNormalized: toPoint2D2(
          leftCheek
        ),
        rightCheekNormalized: toPoint2D2(
          rightCheek
        )
      }
    };
  }
  createInvalidResult(result, faceDetected) {
    return {
      frameSequence: result.frameSequence,
      timestampMs: result.timestampMs,
      frameWidth: result.frameWidth,
      frameHeight: result.frameHeight,
      faceDetected,
      geometryValid: false,
      geometry: null
    };
  }
};

// node_modules/@mediapipe/tasks-vision/vision_bundle.mjs
var t = "undefined" != typeof self ? self : {};
function e(e2, r2) {
  t: {
    for (var n2 = ["CLOSURE_FLAGS"], i2 = t, s2 = 0; s2 < n2.length; s2++) if (null == (i2 = i2[n2[s2]])) {
      n2 = null;
      break t;
    }
    n2 = i2;
  }
  return null != (e2 = n2 && n2[e2]) ? e2 : r2;
}
function r(e2, r2) {
  e2 = e2.split(".");
  for (var n2, i2 = t; e2.length && (n2 = e2.shift()); ) e2.length || void 0 === r2 ? i2 = i2[n2] && i2[n2] !== Object.prototype[n2] ? i2[n2] : i2[n2] = {} : i2[n2] = r2;
}
function n() {
  throw Error("Invalid UTF8");
}
function i(t2, e2) {
  return e2 = String.fromCharCode.apply(null, e2), null == t2 ? e2 : t2 + e2;
}
var s;
var o;
var a = void 0;
var h = "undefined" != typeof TextDecoder;
var u = "undefined" != typeof TextEncoder;
function c(t2) {
  if (u) t2 = (o ||= new TextEncoder()).encode(t2);
  else {
    let r2 = 0, n2 = new Uint8Array(3 * t2.length);
    for (let i2 = 0; i2 < t2.length; i2++) {
      var e2 = t2.charCodeAt(i2);
      if (e2 < 128) n2[r2++] = e2;
      else {
        if (e2 < 2048) n2[r2++] = e2 >> 6 | 192;
        else {
          if (e2 >= 55296 && e2 <= 57343) {
            if (e2 <= 56319 && i2 < t2.length) {
              let s2 = t2.charCodeAt(++i2);
              if (s2 >= 56320 && s2 <= 57343) {
                e2 = 1024 * (e2 - 55296) + s2 - 56320 + 65536, n2[r2++] = e2 >> 18 | 240, n2[r2++] = e2 >> 12 & 63 | 128, n2[r2++] = e2 >> 6 & 63 | 128, n2[r2++] = 63 & e2 | 128;
                continue;
              }
              i2--;
            }
            e2 = 65533;
          }
          n2[r2++] = e2 >> 12 | 224, n2[r2++] = e2 >> 6 & 63 | 128;
        }
        n2[r2++] = 63 & e2 | 128;
      }
    }
    t2 = r2 === n2.length ? n2 : n2.subarray(0, r2);
  }
  return t2;
}
function l(e2) {
  t.setTimeout(() => {
    throw e2;
  }, 0);
}
var d = e(610401301, false);
var f = e(748402147, true);
function p() {
  var e2 = t.navigator;
  return e2 && (e2 = e2.userAgent) ? e2 : "";
}
var g;
var m = t.navigator;
function v(t2) {
  return v[" "](t2), t2;
}
g = m && m.userAgentData || null, v[" "] = function() {
};
var _ = {};
var y = null;
function E(t2) {
  var e2 = t2.length, r2 = 3 * e2 / 4;
  r2 % 3 ? r2 = Math.floor(r2) : -1 != "=.".indexOf(t2[e2 - 1]) && (r2 = -1 != "=.".indexOf(t2[e2 - 2]) ? r2 - 2 : r2 - 1);
  var n2 = new Uint8Array(r2), i2 = 0;
  return (function(t3, e3) {
    function r3(e4) {
      for (; n3 < t3.length; ) {
        let e5 = t3.charAt(n3++), r4 = y[e5];
        if (null != r4) return r4;
        if (!/^[\s\xa0]*$/.test(e5)) throw Error("Unknown base64 encoding at char: " + e5);
      }
      return e4;
    }
    A();
    for (var n3 = 0; ; ) {
      let t4 = r3(-1), n4 = r3(0), i3 = r3(64), s2 = r3(64);
      if (64 === s2 && -1 === t4) break;
      e3(t4 << 2 | n4 >> 4), 64 != i3 && (e3(n4 << 4 & 240 | i3 >> 2), 64 != s2 && e3(i3 << 6 & 192 | s2));
    }
  })(t2, function(t3) {
    n2[i2++] = t3;
  }), i2 !== r2 ? n2.subarray(0, i2) : n2;
}
function A() {
  if (!y) {
    y = {};
    var t2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split(""), e2 = ["+/=", "+/", "-_=", "-_.", "-_"];
    for (let r2 = 0; r2 < 5; r2++) {
      let n2 = t2.concat(e2[r2].split(""));
      _[r2] = n2;
      for (let t3 = 0; t3 < n2.length; t3++) {
        let e3 = n2[t3];
        void 0 === y[e3] && (y[e3] = t3);
      }
    }
  }
}
var w = "undefined" != typeof Uint8Array;
var b = !(!(d && g && g.brands.length > 0) && (-1 != p().indexOf("Trident") || -1 != p().indexOf("MSIE"))) && "function" == typeof btoa;
var T = /[-_.]/g;
var k = { "-": "+", _: "/", ".": "=" };
function S(t2) {
  return k[t2] || "";
}
function L(t2) {
  if (!b) return E(t2);
  t2 = T.test(t2) ? t2.replace(T, S) : t2, t2 = atob(t2);
  var e2 = new Uint8Array(t2.length);
  for (let r2 = 0; r2 < t2.length; r2++) e2[r2] = t2.charCodeAt(r2);
  return e2;
}
function x(t2) {
  return w && null != t2 && t2 instanceof Uint8Array;
}
var R = {};
function I() {
  return C ||= new N(null, R);
}
function F(t2) {
  M(R);
  var e2 = t2.g;
  return null == (e2 = null == e2 || x(e2) ? e2 : "string" == typeof e2 ? L(e2) : null) ? e2 : t2.g = e2;
}
var C;
var N = class {
  h() {
    return new Uint8Array(F(this) || 0);
  }
  constructor(t2, e2) {
    if (M(e2), this.g = t2, null != t2 && 0 === t2.length) throw Error("ByteString should be constructed with non-empty values");
  }
};
function M(t2) {
  if (t2 !== R) throw Error("illegal external caller");
}
function O(t2, e2) {
  t2.__closure__error__context__984382 || (t2.__closure__error__context__984382 = {}), t2.__closure__error__context__984382.severity = e2;
}
var D = void 0;
function P(t2) {
  return O(t2 = Error(t2), "warning"), t2;
}
function $(t2, e2) {
  if (null != t2) {
    var r2 = D ??= {}, n2 = r2[t2] || 0;
    n2 >= e2 || (r2[t2] = n2 + 1, O(t2 = Error(), "incident"), l(t2));
  }
}
function U() {
  return "function" == typeof BigInt;
}
var B = "function" == typeof Symbol && "symbol" == typeof /* @__PURE__ */ Symbol();
function G(t2, e2, r2 = false) {
  return "function" == typeof Symbol && "symbol" == typeof /* @__PURE__ */ Symbol() ? r2 && Symbol.for && t2 ? Symbol.for(t2) : null != t2 ? Symbol(t2) : /* @__PURE__ */ Symbol() : e2;
}
var j;
var V = G("jas", void 0, true);
var H = G(void 0, "0di");
var K = G(void 0, "1oa");
var X = G(void 0, /* @__PURE__ */ Symbol());
var W = G(void 0, "0ub");
var z = G(void 0, "0ubs");
var Y = G(void 0, "0ubsb");
var q = G(void 0, "0actk");
var J = G("m_m", "kb", true);
var Z = G();
var Q = { Va: { value: 0, configurable: true, writable: true, enumerable: false } };
var tt = Object.defineProperties;
var et = B ? V : "Va";
var rt = [];
function nt(t2, e2) {
  B || et in t2 || tt(t2, Q), t2[et] |= e2;
}
function it(t2, e2) {
  B || et in t2 || tt(t2, Q), t2[et] = e2;
}
function st(t2) {
  return nt(t2, 34), t2;
}
function ot(t2) {
  return nt(t2, 8192), t2;
}
it(rt, 7), j = Object.freeze(rt);
var at = {};
function ht(t2, e2) {
  return void 0 === e2 ? t2.h !== ut && !!(2 & t2.A[et]) : !!(2 & e2) && t2.h !== ut;
}
var ut = {};
function ct(t2, e2) {
  if (null != t2) {
    if ("string" == typeof t2) t2 = t2 ? new N(t2, R) : I();
    else if (t2.constructor !== N) if (x(t2)) t2 = t2.length ? new N(new Uint8Array(t2), R) : I();
    else {
      if (!e2) throw Error();
      t2 = void 0;
    }
  }
  return t2;
}
var lt = class {
  constructor(t2, e2, r2) {
    this.g = t2, this.h = e2, this.j = r2;
  }
  next() {
    var t2 = this.g.next();
    return t2.done || (t2.value = this.h.call(this.j, t2.value)), t2;
  }
  [Symbol.iterator]() {
    return this;
  }
};
var dt = Object.freeze({});
function ft(t2, e2, r2) {
  var n2, i2 = 128 & e2 ? 0 : -1, s2 = t2.length;
  (n2 = !!s2) && (n2 = null != (n2 = t2[s2 - 1]) && "object" == typeof n2 && n2.constructor === Object);
  var o2 = s2 + (n2 ? -1 : 0);
  for (e2 = 128 & e2 ? 1 : 0; e2 < o2; e2++) r2(e2 - i2, t2[e2]);
  if (n2) {
    t2 = t2[s2 - 1];
    for (let e3 in t2) !isNaN(e3) && r2(+e3, t2[e3]);
  }
}
var pt = {};
function gt(t2) {
  return 128 & t2 ? pt : void 0;
}
function mt(t2) {
  return t2.ib = true, t2;
}
var vt = mt((t2) => "number" == typeof t2);
var _t = mt((t2) => "string" == typeof t2);
var yt = mt((t2) => "boolean" == typeof t2);
var Et = "function" == typeof t.BigInt && "bigint" == typeof t.BigInt(0);
function At(t2) {
  var e2 = t2;
  if (_t(e2)) {
    if (!/^\s*(?:-?[1-9]\d*|0)?\s*$/.test(e2)) throw Error(String(e2));
  } else if (vt(e2) && !Number.isSafeInteger(e2)) throw Error(String(e2));
  return Et ? BigInt(t2) : t2 = yt(t2) ? t2 ? "1" : "0" : _t(t2) ? t2.trim() || "0" : String(t2);
}
var wt = mt((t2) => Et ? t2 >= Tt && t2 <= St : "-" === t2[0] ? Lt(t2, bt) : Lt(t2, kt));
var bt = Number.MIN_SAFE_INTEGER.toString();
var Tt = Et ? BigInt(Number.MIN_SAFE_INTEGER) : void 0;
var kt = Number.MAX_SAFE_INTEGER.toString();
var St = Et ? BigInt(Number.MAX_SAFE_INTEGER) : void 0;
function Lt(t2, e2) {
  if (t2.length > e2.length) return false;
  if (t2.length < e2.length || t2 === e2) return true;
  for (let r2 = 0; r2 < t2.length; r2++) {
    let n2 = t2[r2], i2 = e2[r2];
    if (n2 > i2) return false;
    if (n2 < i2) return true;
  }
}
var xt;
var Rt = "function" == typeof Uint8Array.prototype.slice;
var It = 0;
var Ft = 0;
function Ct(t2) {
  var e2 = t2 >>> 0;
  It = e2, Ft = (t2 - e2) / 4294967296 >>> 0;
}
function Nt(t2) {
  if (t2 < 0) {
    Ct(-t2);
    let [e2, r2] = jt(It, Ft);
    It = e2 >>> 0, Ft = r2 >>> 0;
  } else Ct(t2);
}
function Mt(t2) {
  var e2 = xt ||= new DataView(new ArrayBuffer(8));
  e2.setFloat32(0, +t2, true), Ft = 0, It = e2.getUint32(0, true);
}
function Ot(t2, e2) {
  var r2 = 4294967296 * e2 + (t2 >>> 0);
  return Number.isSafeInteger(r2) ? r2 : $t(t2, e2);
}
function Dt(t2, e2) {
  return At(U() ? BigInt.asUintN(64, (BigInt(e2 >>> 0) << BigInt(32)) + BigInt(t2 >>> 0)) : $t(t2, e2));
}
function Pt(t2, e2) {
  return U() ? At(BigInt.asIntN(64, (BigInt.asUintN(32, BigInt(e2)) << BigInt(32)) + BigInt.asUintN(32, BigInt(t2)))) : At(Bt(t2, e2));
}
function $t(t2, e2) {
  if (t2 >>>= 0, (e2 >>>= 0) <= 2097151) var r2 = "" + (4294967296 * e2 + t2);
  else U() ? r2 = "" + (BigInt(e2) << BigInt(32) | BigInt(t2)) : (t2 = (16777215 & t2) + 6777216 * (r2 = 16777215 & (t2 >>> 24 | e2 << 8)) + 6710656 * (e2 = e2 >> 16 & 65535), r2 += 8147497 * e2, e2 *= 2, t2 >= 1e7 && (r2 += t2 / 1e7 >>> 0, t2 %= 1e7), r2 >= 1e7 && (e2 += r2 / 1e7 >>> 0, r2 %= 1e7), r2 = e2 + Ut(r2) + Ut(t2));
  return r2;
}
function Ut(t2) {
  return t2 = String(t2), "0000000".slice(t2.length) + t2;
}
function Bt(t2, e2) {
  if (2147483648 & e2) if (U()) t2 = "" + (BigInt(0 | e2) << BigInt(32) | BigInt(t2 >>> 0));
  else {
    let [r2, n2] = jt(t2, e2);
    t2 = "-" + $t(r2, n2);
  }
  else t2 = $t(t2, e2);
  return t2;
}
function Gt(t2) {
  if (t2.length < 16) Nt(Number(t2));
  else if (U()) t2 = BigInt(t2), It = Number(t2 & BigInt(4294967295)) >>> 0, Ft = Number(t2 >> BigInt(32) & BigInt(4294967295));
  else {
    let e2 = +("-" === t2[0]);
    Ft = It = 0;
    let r2 = t2.length;
    for (let n2 = e2, i2 = (r2 - e2) % 6 + e2; i2 <= r2; n2 = i2, i2 += 6) {
      let e3 = Number(t2.slice(n2, i2));
      Ft *= 1e6, (It = 1e6 * It + e3) >= 4294967296 && (Ft += Math.trunc(It / 4294967296), Ft >>>= 0, It >>>= 0);
    }
    if (e2) {
      let [t3, e3] = jt(It, Ft);
      It = t3, Ft = e3;
    }
  }
}
function jt(t2, e2) {
  return e2 = ~e2, t2 ? t2 = 1 + ~t2 : e2 += 1, [t2, e2];
}
function Vt(t2) {
  return Array.prototype.slice.call(t2);
}
var Ht = "function" == typeof BigInt ? BigInt.asIntN : void 0;
var Kt = "function" == typeof BigInt ? BigInt.asUintN : void 0;
var Xt = Number.isSafeInteger;
var Wt = Number.isFinite;
var zt = Math.trunc;
var Yt = At(0);
function qt(t2) {
  if ("number" != typeof t2) throw Error(`Value of float/double field must be a number, found ${typeof t2}: ${t2}`);
  return t2;
}
function Jt(t2) {
  return null == t2 || "number" == typeof t2 ? t2 : "NaN" === t2 || "Infinity" === t2 || "-Infinity" === t2 ? Number(t2) : void 0;
}
function Zt(t2) {
  if ("boolean" != typeof t2) {
    var e2 = typeof t2;
    throw Error(`Expected boolean but got ${"object" != e2 ? e2 : t2 ? Array.isArray(t2) ? "array" : e2 : "null"}: ${t2}`);
  }
  return t2;
}
var Qt = /^-?([1-9][0-9]*|0)(\.[0-9]+)?$/;
function te(t2) {
  switch (typeof t2) {
    case "bigint":
      return true;
    case "number":
      return Wt(t2);
    case "string":
      return Qt.test(t2);
    default:
      return false;
  }
}
function ee(t2) {
  if (null != t2) {
    if (!Wt(t2)) throw P("enum");
    t2 |= 0;
  }
  return t2;
}
function re(t2) {
  if (null == t2) return t2;
  if ("string" == typeof t2 && t2) t2 = +t2;
  else if ("number" != typeof t2) return;
  return Wt(t2) ? 0 | t2 : void 0;
}
function ne(t2) {
  if (null == t2) return t2;
  if ("string" == typeof t2 && t2) t2 = +t2;
  else if ("number" != typeof t2) return;
  return Wt(t2) ? t2 >>> 0 : void 0;
}
function ie(t2, e2) {
  if (e2 ??= 1024, !te(t2)) throw P("int64");
  var r2 = typeof t2;
  switch (e2) {
    case 512:
      switch (r2) {
        case "string":
          return ce(t2);
        case "bigint":
          return String(Ht(64, t2));
        default:
          return ue(t2);
      }
    case 1024:
      switch (r2) {
        case "string":
          return le(t2);
        case "bigint":
          return At(Ht(64, t2));
        default:
          return de(t2);
      }
    case 0:
      switch (r2) {
        case "string":
          return ce(t2);
        case "bigint":
          return At(Ht(64, t2));
        default:
          return ae(t2);
      }
    default:
      return (function(t3, e3 = `unexpected value ${t3}!`) {
        throw Error(e3);
      })(e2, "Unknown format requested type for int64");
  }
}
function se(t2) {
  var e2 = t2.length;
  return ("-" === t2[0] ? e2 < 20 || 20 === e2 && t2 <= "-9223372036854775808" : e2 < 19 || 19 === e2 && t2 <= "9223372036854775807") ? t2 : (Gt(t2), Bt(It, Ft));
}
function oe(t2) {
  if ("-" === t2[0]) var e2 = false;
  else e2 = (e2 = t2.length) < 20 || 20 === e2 && t2 <= "18446744073709551615";
  return e2 ? t2 : (Gt(t2), $t(It, Ft));
}
function ae(t2) {
  if (t2 = zt(t2), !Xt(t2)) {
    Nt(t2);
    var e2 = It, r2 = Ft;
    (t2 = 2147483648 & r2) && (r2 = ~r2 >>> 0, 0 == (e2 = 1 + ~e2 >>> 0) && (r2 = r2 + 1 >>> 0)), t2 = "number" == typeof (e2 = Ot(e2, r2)) ? t2 ? -e2 : e2 : t2 ? "-" + e2 : e2;
  }
  return t2;
}
function he(t2) {
  return (t2 = zt(t2)) >= 0 && Xt(t2) || (Nt(t2), t2 = Ot(It, Ft)), t2;
}
function ue(t2) {
  return t2 = zt(t2), Xt(t2) ? t2 = String(t2) : (Nt(t2), t2 = Bt(It, Ft)), t2;
}
function ce(t2) {
  var e2 = zt(Number(t2));
  return Xt(e2) ? String(e2) : (-1 !== (e2 = t2.indexOf(".")) && (t2 = t2.substring(0, e2)), se(t2));
}
function le(t2) {
  var e2 = zt(Number(t2));
  return Xt(e2) ? At(e2) : (-1 !== (e2 = t2.indexOf(".")) && (t2 = t2.substring(0, e2)), U() ? At(Ht(64, BigInt(t2))) : At(se(t2)));
}
function de(t2) {
  return Xt(t2) ? At(ae(t2)) : At(ue(t2));
}
function fe(t2) {
  var e2 = typeof t2;
  return null == t2 ? t2 : "bigint" === e2 ? At(Ht(64, t2)) : te(t2) ? "string" === e2 ? le(t2) : de(t2) : void 0;
}
function pe(t2) {
  if (null == t2) return t2;
  var e2 = typeof t2;
  if ("bigint" === e2) return String(Ht(64, t2));
  if (te(t2)) {
    if ("string" === e2) return ce(t2);
    if ("number" === e2) return ae(t2);
  }
}
function ge(t2) {
  if (null == t2 || "string" == typeof t2 || t2 instanceof N) return t2;
}
function me(t2) {
  if ("string" != typeof t2) throw Error();
  return t2;
}
function ve(t2) {
  if (null != t2 && "string" != typeof t2) throw Error();
  return t2;
}
function _e(t2) {
  return null == t2 || "string" == typeof t2 ? t2 : void 0;
}
function ye(t2, e2, r2, n2) {
  return null != t2 && t2[J] === at ? t2 : Array.isArray(t2) ? ((n2 = (r2 = 0 | t2[et]) | 32 & n2 | 2 & n2) !== r2 && it(t2, n2), new e2(t2)) : (r2 ? 2 & n2 ? ((t2 = e2[H]) || (st((t2 = new e2()).A), t2 = e2[H] = t2), e2 = t2) : e2 = new e2() : e2 = void 0, e2);
}
function Ee(t2, e2, r2) {
  return null == (t2 = e2 ? ie(t2, 1024) : fe(t2)) ? r2 ? Yt : void 0 : t2;
}
function Ae(t2) {
  return t2;
}
var we = {};
var be = (function() {
  try {
    return v(new class extends Map {
      constructor() {
        super();
      }
    }()), false;
  } catch {
    return true;
  }
})();
var Te = class {
  constructor() {
    this.g = /* @__PURE__ */ new Map();
  }
  get(t2) {
    return this.g.get(t2);
  }
  set(t2, e2) {
    return this.g.set(t2, e2), this.size = this.g.size, this;
  }
  delete(t2) {
    return t2 = this.g.delete(t2), this.size = this.g.size, t2;
  }
  clear() {
    this.g.clear(), this.size = this.g.size;
  }
  has(t2) {
    return this.g.has(t2);
  }
  entries() {
    return this.g.entries();
  }
  keys() {
    return this.g.keys();
  }
  values() {
    return this.g.values();
  }
  forEach(t2, e2) {
    return this.g.forEach(t2, e2);
  }
  [Symbol.iterator]() {
    return this.entries();
  }
};
var ke = be ? (Object.setPrototypeOf(Te.prototype, Map.prototype), Object.defineProperties(Te.prototype, { size: { value: 0, configurable: true, enumerable: true, writable: true } }), Te) : class extends Map {
  constructor() {
    super();
  }
};
function Se(t2) {
  return t2;
}
function Le(t2) {
  if (2 & t2.M) throw Error("Cannot mutate an immutable Map");
}
var xe;
var Re = class extends ke {
  constructor(t2, e2, r2 = Se, n2 = Se) {
    super(), this.M = 0 | t2[et], this.N = e2, this.ba = r2, this.na = this.N ? Ie : n2;
    for (let i2 = 0; i2 < t2.length; i2++) {
      let s2 = t2[i2], o2 = r2(s2[0], false, true), a2 = s2[1];
      e2 ? void 0 === a2 && (a2 = null) : a2 = n2(s2[1], false, true, void 0, void 0, this.M), super.set(o2, a2);
    }
  }
  ea(t2) {
    return ot(Array.from(super.entries(), t2));
  }
  clear() {
    Le(this), super.clear();
  }
  delete(t2) {
    return Le(this), super.delete(this.ba(t2, true, false));
  }
  entries() {
    if (this.N) {
      var t2 = super.keys();
      t2 = new lt(t2, Fe, this);
    } else t2 = super.entries();
    return t2;
  }
  values() {
    if (this.N) {
      var t2 = super.keys();
      t2 = new lt(t2, Re.prototype.get, this);
    } else t2 = super.values();
    return t2;
  }
  forEach(t2, e2) {
    this.N ? super.forEach((r2, n2, i2) => {
      t2.call(e2, i2.get(n2), n2, i2);
    }) : super.forEach(t2, e2);
  }
  set(t2, e2) {
    return Le(this), null == (t2 = this.ba(t2, true, false)) ? this : null == e2 ? (super.delete(t2), this) : super.set(t2, this.na(e2, true, true, this.N, false, this.M));
  }
  gb(t2) {
    var e2 = this.ba(t2[0], false, true);
    t2 = t2[1], t2 = this.N ? void 0 === t2 ? null : t2 : this.na(t2, false, true, void 0, false, this.M), super.set(e2, t2);
  }
  has(t2) {
    return super.has(this.ba(t2, false, false));
  }
  get(t2) {
    t2 = this.ba(t2, false, false);
    var e2 = super.get(t2);
    if (void 0 !== e2) {
      var r2 = this.N;
      return r2 ? ((r2 = this.na(e2, false, true, r2, this.Fa, this.M)) !== e2 && super.set(t2, r2), r2) : e2;
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
};
function Ie(t2, e2, r2, n2, i2, s2) {
  return t2 = ye(t2, n2, r2, s2), i2 && (t2 = Ze(t2)), t2;
}
function Fe(t2) {
  return [t2, this.get(t2)];
}
function Ce() {
  return xe ||= new Re(st([]), void 0, void 0, void 0, we);
}
function Ne(t2) {
  return X ? t2[X] : void 0;
}
function Me(t2, e2) {
  for (let r2 in t2) !isNaN(r2) && e2(t2, +r2, t2[r2]);
}
Re.prototype.toJSON = void 0;
var Oe;
var De;
var Pe;
var $e = class {
};
var Ue = { cb: true };
function Be(t2, e2) {
  e2 < 100 || $(z, 1);
}
function Ge(t2, e2, r2, n2) {
  var i2 = void 0 !== n2;
  n2 = !!n2;
  var s2, o2 = X;
  !i2 && B && o2 && (s2 = t2[o2]) && Me(s2, Be), o2 = [];
  var a2 = t2.length;
  s2 = 4294967295;
  var h2 = false, u2 = !!(64 & e2), c2 = u2 ? 128 & e2 ? 0 : -1 : void 0;
  if (!(1 & e2)) {
    var l2 = a2 && t2[a2 - 1];
    null != l2 && "object" == typeof l2 && l2.constructor === Object ? s2 = --a2 : l2 = void 0, !u2 || 128 & e2 || i2 || (h2 = true, s2 = (Oe ?? Ae)(s2 - c2, c2, t2, l2, void 0) + c2);
  }
  e2 = void 0;
  for (var d2 = 0; d2 < a2; d2++) {
    let i3 = t2[d2];
    if (null != i3 && null != (i3 = r2(i3, n2))) if (u2 && d2 >= s2) {
      let t3 = d2 - c2;
      (e2 ??= {})[t3] = i3;
    } else o2[d2] = i3;
  }
  if (l2) for (let t3 in l2) {
    if (null == (a2 = l2[t3]) || null == (a2 = r2(a2, n2))) continue;
    let i3;
    d2 = +t3, u2 && !Number.isNaN(d2) && (i3 = d2 + c2) < s2 ? o2[i3] = a2 : (e2 ??= {})[t3] = a2;
  }
  return e2 && (h2 ? o2.push(e2) : o2[s2] = e2), i2 && X && (t2 = Ne(t2)) && t2 instanceof $e && (o2[X] = (function(t3) {
    var e3 = new $e();
    return Me(t3, (t4, r3, n3) => {
      e3[r3] = Vt(n3);
    }), e3.ka = t3.ka, e3;
  })(t2)), o2;
}
function je(t2) {
  return t2[0] = Ve(t2[0]), t2[1] = Ve(t2[1]), t2;
}
function Ve(t2) {
  switch (typeof t2) {
    case "number":
      return Number.isFinite(t2) ? t2 : "" + t2;
    case "bigint":
      return wt(t2) ? Number(t2) : "" + t2;
    case "boolean":
      return t2 ? 1 : 0;
    case "object":
      if (Array.isArray(t2)) {
        var e2 = 0 | t2[et];
        return 0 === t2.length && 1 & e2 ? void 0 : Ge(t2, e2, Ve);
      }
      if (null != t2 && t2[J] === at) return He(t2);
      if (t2 instanceof N) {
        if (null == (e2 = t2.g)) t2 = "";
        else if ("string" == typeof e2) t2 = e2;
        else {
          if (b) {
            for (var r2 = "", n2 = 0, i2 = e2.length - 10240; n2 < i2; ) r2 += String.fromCharCode.apply(null, e2.subarray(n2, n2 += 10240));
            r2 += String.fromCharCode.apply(null, n2 ? e2.subarray(n2) : e2), e2 = btoa(r2);
          } else {
            void 0 === r2 && (r2 = 0), A(), r2 = _[r2], n2 = Array(Math.floor(e2.length / 3)), i2 = r2[64] || "";
            let t3 = 0, u2 = 0;
            for (; t3 < e2.length - 2; t3 += 3) {
              var s2 = e2[t3], o2 = e2[t3 + 1], a2 = e2[t3 + 2], h2 = r2[s2 >> 2];
              s2 = r2[(3 & s2) << 4 | o2 >> 4], o2 = r2[(15 & o2) << 2 | a2 >> 6], a2 = r2[63 & a2], n2[u2++] = h2 + s2 + o2 + a2;
            }
            switch (h2 = 0, a2 = i2, e2.length - t3) {
              case 2:
                a2 = r2[(15 & (h2 = e2[t3 + 1])) << 2] || i2;
              case 1:
                e2 = e2[t3], n2[u2] = r2[e2 >> 2] + r2[(3 & e2) << 4 | h2 >> 4] + a2 + i2;
            }
            e2 = n2.join("");
          }
          t2 = t2.g = e2;
        }
        return t2;
      }
      return t2 instanceof Re ? t2 = 0 !== t2.size ? t2.ea(je) : void 0 : void 0;
  }
  return t2;
}
function He(t2) {
  return Ge(t2 = t2.A, 0 | t2[et], Ve);
}
function Ke(t2, e2) {
  return Xe(t2, e2[0], e2[1]);
}
function Xe(t2, e2, r2, n2 = 0) {
  if (null == t2) {
    var i2 = 32;
    r2 ? (t2 = [r2], i2 |= 128) : t2 = [], e2 && (i2 = -16760833 & i2 | (1023 & e2) << 14);
  } else {
    if (!Array.isArray(t2)) throw Error("narr");
    if (i2 = 0 | t2[et], f && 1 & i2) throw Error("rfarr");
    if (2048 & i2 && !(2 & i2) && (function() {
      if (f) throw Error("carr");
      $(q, 5);
    })(), 256 & i2) throw Error("farr");
    if (64 & i2) return (i2 | n2) !== i2 && it(t2, i2 | n2), t2;
    if (r2 && (i2 |= 128, r2 !== t2[0])) throw Error("mid");
    t: {
      i2 |= 64;
      var s2 = (r2 = t2).length;
      if (s2) {
        var o2 = s2 - 1;
        let t3 = r2[o2];
        if (null != t3 && "object" == typeof t3 && t3.constructor === Object) {
          if ((o2 -= e2 = 128 & i2 ? 0 : -1) >= 1024) throw Error("pvtlmt");
          for (var a2 in t3) (s2 = +a2) < o2 && (r2[s2 + e2] = t3[a2], delete t3[a2]);
          i2 = -16760833 & i2 | (1023 & o2) << 14;
          break t;
        }
      }
      if (e2) {
        if ((a2 = Math.max(e2, s2 - (128 & i2 ? 0 : -1))) > 1024) throw Error("spvt");
        i2 = -16760833 & i2 | (1023 & a2) << 14;
      }
    }
  }
  return it(t2, 64 | i2 | n2), t2;
}
function We(t2, e2) {
  if ("object" != typeof t2) return t2;
  if (Array.isArray(t2)) {
    var r2 = 0 | t2[et];
    return 0 === t2.length && 1 & r2 ? void 0 : ze(t2, r2, e2);
  }
  if (null != t2 && t2[J] === at) return qe(t2);
  if (t2 instanceof Re) {
    if (2 & (e2 = t2.M)) return t2;
    if (!t2.size) return;
    if (r2 = st(t2.ea()), t2.N) for (t2 = 0; t2 < r2.length; t2++) {
      let n2 = r2[t2], i2 = n2[1];
      i2 = null == i2 || "object" != typeof i2 ? void 0 : null != i2 && i2[J] === at ? qe(i2) : Array.isArray(i2) ? ze(i2, 0 | i2[et], !!(32 & e2)) : void 0, n2[1] = i2;
    }
    return r2;
  }
  return t2 instanceof N ? t2 : void 0;
}
function ze(t2, e2, r2) {
  return 2 & e2 || (!r2 || 4096 & e2 || 16 & e2 ? t2 = Je(t2, e2, false, r2 && !(16 & e2)) : (nt(t2, 34), 4 & e2 && Object.freeze(t2))), t2;
}
function Ye(t2, e2, r2) {
  return t2 = new t2.constructor(e2), r2 && (t2.h = ut), t2.m = ut, t2;
}
function qe(t2) {
  var e2 = t2.A, r2 = 0 | e2[et];
  return ht(t2, r2) ? t2 : rr(t2, e2, r2) ? Ye(t2, e2) : Je(e2, r2);
}
function Je(t2, e2, r2, n2) {
  return n2 ??= !!(34 & e2), t2 = Ge(t2, e2, We, n2), n2 = 32, r2 && (n2 |= 2), it(t2, e2 = 16769217 & e2 | n2), t2;
}
function Ze(t2) {
  var e2 = t2.A, r2 = 0 | e2[et];
  return ht(t2, r2) ? rr(t2, e2, r2) ? Ye(t2, e2, true) : new t2.constructor(Je(e2, r2, false)) : t2;
}
function Qe(t2) {
  if (t2.h !== ut) return false;
  var e2 = t2.A;
  return nt(e2 = Je(e2, 0 | e2[et]), 2048), t2.A = e2, t2.h = void 0, t2.m = void 0, true;
}
function tr(t2) {
  if (!Qe(t2) && ht(t2, 0 | t2.A[et])) throw Error();
}
function er(t2, e2) {
  void 0 === e2 && (e2 = 0 | t2[et]), 32 & e2 && !(4096 & e2) && it(t2, 4096 | e2);
}
function rr(t2, e2, r2) {
  return !!(2 & r2) || !(!(32 & r2) || 4096 & r2) && (it(e2, 2 | r2), t2.h = ut, true);
}
var nr = At(0);
var ir = {};
function sr(t2, e2, r2, n2) {
  if (null !== (e2 = or(t2.A, e2, void 0, n2)) || r2 && t2.m !== ut) return e2;
}
function or(t2, e2, r2, n2) {
  if (-1 === e2) return null;
  var i2 = e2 + (r2 ? 0 : -1), s2 = t2.length - 1;
  if (!(s2 < 1 + (r2 ? 0 : -1))) {
    if (i2 >= s2) {
      var o2 = t2[s2];
      if (null != o2 && "object" == typeof o2 && o2.constructor === Object) {
        r2 = o2[e2];
        var a2 = true;
      } else {
        if (i2 !== s2) return;
        r2 = o2;
      }
    } else r2 = t2[i2];
    if (n2 && null != r2) {
      if (null == (n2 = n2(r2))) return n2;
      if (!Object.is(n2, r2)) return a2 ? o2[e2] = n2 : t2[i2] = n2, n2;
    }
    return r2;
  }
}
function ar(t2, e2, r2, n2) {
  tr(t2);
  var i2 = t2.A;
  return hr(i2, 0 | i2[et], e2, r2, n2), t2;
}
function hr(t2, e2, r2, n2, i2) {
  var s2 = r2 + (i2 ? 0 : -1), o2 = t2.length - 1;
  if (o2 >= 1 + (i2 ? 0 : -1) && s2 >= o2) {
    let i3 = t2[o2];
    if (null != i3 && "object" == typeof i3 && i3.constructor === Object) return i3[r2] = n2, e2;
  }
  return s2 <= o2 ? (t2[s2] = n2, e2) : (void 0 !== n2 && (r2 >= (o2 = (e2 ??= 0 | t2[et]) >> 14 & 1023 || 536870912) ? null != n2 && (t2[o2 + (i2 ? 0 : -1)] = { [r2]: n2 }) : t2[s2] = n2), e2);
}
function ur(t2, e2, r2, n2) {
  var i2 = t2.A;
  return void 0 !== kr(i2, 0 | i2[et], e2, t2 = Er(t2, n2) === r2 ? r2 : -1);
}
function cr() {
  return void 0 === dt ? 2 : 4;
}
function lr(t2, e2, r2, n2, i2) {
  var s2 = t2.A, o2 = 0 | s2[et];
  n2 = ht(t2, o2) ? 1 : n2, i2 = !!i2 || 3 === n2, 2 === n2 && Qe(t2) && (o2 = 0 | (s2 = t2.A)[et]);
  var a2 = (t2 = fr(s2, e2)) === j ? 7 : 0 | t2[et], h2 = pr(a2, o2), u2 = !(4 & h2);
  if (u2) {
    4 & h2 && (t2 = Vt(t2), a2 = 0, h2 = Nr(h2, o2), o2 = hr(s2, o2, e2, t2));
    let n3 = 0, i3 = 0;
    for (; n3 < t2.length; n3++) {
      let e3 = r2(t2[n3]);
      null != e3 && (t2[i3++] = e3);
    }
    i3 < n3 && (t2.length = i3), r2 = -513 & h2 | 4, h2 = r2 &= -1025, h2 &= -4097;
  }
  return h2 !== a2 && (it(t2, h2), 2 & h2 && Object.freeze(t2)), dr(t2, h2, s2, o2, e2, n2, u2, i2);
}
function dr(t2, e2, r2, n2, i2, s2, o2, a2) {
  var h2 = e2;
  return 1 === s2 || 4 === s2 && (2 & e2 || !(16 & e2) && 32 & n2) ? gr(e2) || ((e2 |= !t2.length || o2 && !(4096 & e2) || 32 & n2 && !(4096 & e2 || 16 & e2) ? 2 : 256) !== h2 && it(t2, e2), Object.freeze(t2)) : (2 === s2 && gr(e2) && (t2 = Vt(t2), h2 = 0, e2 = Nr(e2, n2), n2 = hr(r2, n2, i2, t2)), gr(e2) || (a2 || (e2 |= 16), e2 !== h2 && it(t2, e2))), 2 & e2 || !(4096 & e2 || 16 & e2) || er(r2, n2), t2;
}
function fr(t2, e2, r2) {
  return t2 = or(t2, e2, r2), Array.isArray(t2) ? t2 : j;
}
function pr(t2, e2) {
  return 2 & e2 && (t2 |= 2), 1 | t2;
}
function gr(t2) {
  return !!(2 & t2) && !!(4 & t2) || !!(256 & t2);
}
function mr(t2) {
  return ct(t2, true);
}
function vr(t2) {
  t2 = Vt(t2);
  for (let e2 = 0; e2 < t2.length; e2++) {
    let r2 = t2[e2] = Vt(t2[e2]);
    Array.isArray(r2[1]) && (r2[1] = st(r2[1]));
  }
  return ot(t2);
}
function _r(t2, e2, r2, n2) {
  tr(t2), hr(t2 = t2.A, 0 | t2[et], e2, ("0" === n2 ? 0 === Number(r2) : r2 === n2) ? void 0 : r2);
}
function yr(t2, e2, r2) {
  if (2 & e2) throw Error();
  var n2 = gt(e2), i2 = fr(t2, r2, n2), s2 = i2 === j ? 7 : 0 | i2[et], o2 = pr(s2, e2);
  return (2 & o2 || gr(o2) || 16 & o2) && (o2 === s2 || gr(o2) || it(i2, o2), i2 = Vt(i2), s2 = 0, o2 = Nr(o2, e2), hr(t2, e2, r2, i2, n2)), (o2 &= -13) !== s2 && it(i2, o2), i2;
}
function Er(t2, e2) {
  return br(Ar(t2 = t2.A), t2, void 0, e2);
}
function Ar(t2) {
  if (B) return t2[K] ?? (t2[K] = /* @__PURE__ */ new Map());
  if (K in t2) return t2[K];
  var e2 = /* @__PURE__ */ new Map();
  return Object.defineProperty(t2, K, { value: e2 }), e2;
}
function wr(t2, e2, r2, n2, i2) {
  var s2 = Ar(t2), o2 = br(s2, t2, e2, r2, i2);
  return o2 !== n2 && (o2 && (e2 = hr(t2, e2, o2, void 0, i2)), s2.set(r2, n2)), e2;
}
function br(t2, e2, r2, n2, i2) {
  var s2 = t2.get(n2);
  if (null != s2) return s2;
  s2 = 0;
  for (let t3 = 0; t3 < n2.length; t3++) {
    let o2 = n2[t3];
    null != or(e2, o2, i2) && (0 !== s2 && (r2 = hr(e2, r2, s2, void 0, i2)), s2 = o2);
  }
  return t2.set(n2, s2), s2;
}
function Tr(t2, e2, r2) {
  var n2 = 0 | t2[et], i2 = gt(n2), s2 = or(t2, r2, i2);
  if (null != s2 && s2[J] === at) {
    if (!ht(s2)) return Qe(s2), s2.A;
    var o2 = s2.A;
  } else Array.isArray(s2) && (o2 = s2);
  if (o2) {
    let t3 = 0 | o2[et];
    2 & t3 && (o2 = Je(o2, t3));
  }
  return (o2 = Ke(o2, e2)) !== s2 && hr(t2, n2, r2, o2, i2), o2;
}
function kr(t2, e2, r2, n2, i2) {
  var s2 = false;
  if (null != (n2 = or(t2, n2, i2, (t3) => {
    var n3 = ye(t3, r2, false, e2);
    return s2 = n3 !== t3 && null != n3, n3;
  }))) return s2 && !ht(n2) && er(t2, e2), n2;
}
function Sr(t2, e2, r2, n2) {
  var i2 = t2.A, s2 = 0 | i2[et];
  if (null == (e2 = kr(i2, s2, e2, r2, n2))) return e2;
  if (!ht(t2, s2 = 0 | i2[et])) {
    let o2 = Ze(e2);
    o2 !== e2 && (Qe(t2) && (s2 = 0 | (i2 = t2.A)[et]), er(i2, s2 = hr(i2, s2, r2, e2 = o2, n2)));
  }
  return e2;
}
function Lr(t2, e2, r2, n2, i2, s2, o2, a2) {
  var h2 = ht(t2, r2);
  s2 = h2 ? 1 : s2, o2 = !!o2 || 3 === s2, h2 = a2 && !h2, (2 === s2 || h2) && Qe(t2) && (r2 = 0 | (e2 = t2.A)[et]);
  var u2 = (t2 = fr(e2, i2)) === j ? 7 : 0 | t2[et], c2 = pr(u2, r2);
  if (a2 = !(4 & c2)) {
    var l2 = t2, d2 = r2;
    let e3 = !!(2 & c2);
    e3 && (d2 |= 2);
    let i3 = !e3, s3 = true, o3 = 0, a3 = 0;
    for (; o3 < l2.length; o3++) {
      let t3 = ye(l2[o3], n2, false, d2);
      if (t3 instanceof n2) {
        if (!e3) {
          let e4 = ht(t3);
          i3 &&= !e4, s3 &&= e4;
        }
        l2[a3++] = t3;
      }
    }
    a3 < o3 && (l2.length = a3), c2 |= 4, c2 = s3 ? -4097 & c2 : 4096 | c2, c2 = i3 ? 8 | c2 : -9 & c2;
  }
  if (c2 !== u2 && (it(t2, c2), 2 & c2 && Object.freeze(t2)), h2 && !(8 & c2 || !t2.length && (1 === s2 || 4 === s2 && (2 & c2 || !(16 & c2) && 32 & r2)))) {
    for (gr(c2) && (t2 = Vt(t2), c2 = Nr(c2, r2), r2 = hr(e2, r2, i2, t2)), n2 = t2, h2 = c2, u2 = 0; u2 < n2.length; u2++) (l2 = n2[u2]) !== (c2 = Ze(l2)) && (n2[u2] = c2);
    h2 |= 8, it(t2, c2 = h2 = n2.length ? 4096 | h2 : -4097 & h2);
  }
  return dr(t2, c2, e2, r2, i2, s2, a2, o2);
}
function xr(t2, e2, r2) {
  var n2 = t2.A;
  return Lr(t2, n2, 0 | n2[et], e2, r2, cr(), false, true);
}
function Rr(t2) {
  return null == t2 && (t2 = void 0), t2;
}
function Ir(t2, e2, r2, n2, i2) {
  return ar(t2, r2, n2 = Rr(n2), i2), n2 && !ht(n2) && er(t2.A), t2;
}
function Fr(t2, e2, r2, n2) {
  t: {
    var i2 = n2 = Rr(n2);
    tr(t2);
    let s2 = t2.A, o2 = 0 | s2[et];
    if (null == i2) {
      let t3 = Ar(s2);
      if (br(t3, s2, o2, r2) !== e2) break t;
      t3.set(r2, 0);
    } else o2 = wr(s2, o2, r2, e2);
    hr(s2, o2, e2, i2);
  }
  return n2 && !ht(n2) && er(t2.A), t2;
}
function Cr(t2, e2, r2) {
  tr(t2);
  var n2 = t2.A, i2 = 0 | n2[et];
  if (null == r2) return hr(n2, i2, e2), t2;
  var s2 = r2 === j ? 7 : 0 | r2[et], o2 = s2, a2 = gr(s2), h2 = a2 || Object.isFrozen(r2), u2 = true, c2 = true;
  for (let t3 = 0; t3 < r2.length; t3++) {
    var l2 = r2[t3];
    a2 || (l2 = ht(l2), u2 &&= !l2, c2 &&= l2);
  }
  return a2 || (s2 = u2 ? 13 : 5, s2 = c2 ? -4097 & s2 : 4096 | s2), h2 && s2 === o2 || (r2 = Vt(r2), o2 = 0, s2 = Nr(s2, i2)), s2 !== o2 && it(r2, s2), i2 = hr(n2, i2, e2, r2), 2 & s2 || !(4096 & s2 || 16 & s2) || er(n2, i2), t2;
}
function Nr(t2, e2) {
  return -273 & (2 & e2 ? 2 | t2 : -3 & t2);
}
function Mr(t2, e2, r2, n2) {
  var i2 = n2;
  tr(t2), t2 = Lr(t2, n2 = t2.A, 0 | n2[et], r2, e2, 2, true), i2 = null != i2 ? i2 : new r2(), t2.push(i2), e2 = r2 = t2 === j ? 7 : 0 | t2[et], (i2 = ht(i2)) ? (r2 &= -9, 1 === t2.length && (r2 &= -4097)) : r2 |= 4096, r2 !== e2 && it(t2, r2), i2 || er(n2);
}
function Or(t2, e2, r2) {
  return re(sr(t2, e2, r2));
}
function Dr(t2, e2) {
  return sr(t2, e2, void 0, Jt) ?? 0;
}
function Pr(t2, e2, r2) {
  return Sr(t2, e2, r2 = Er(t2, Uo) === r2 ? r2 : -1, void 0);
}
function $r(t2, e2) {
  _r(t2, 3, null == e2 ? e2 : Zt(e2), false);
}
function Ur(t2, e2, r2) {
  if (null != r2) {
    if ("number" != typeof r2) throw P("int32");
    if (!Wt(r2)) throw P("int32");
    r2 |= 0;
  }
  ar(t2, e2, r2);
}
function Br(t2, e2, r2) {
  return ar(t2, e2, null == r2 ? r2 : ie(r2));
}
function Gr(t2, e2, r2) {
  return ar(t2, e2, null == r2 ? r2 : (function(t3) {
    if (!te(t3)) throw P("uint64");
    switch (typeof t3) {
      case "string":
        var e3 = zt(Number(t3));
        return Xt(e3) && e3 >= 0 ? t3 = At(e3) : (-1 !== (e3 = t3.indexOf(".")) && (t3 = t3.substring(0, e3)), t3 = U() ? At(Kt(64, BigInt(t3))) : At(oe(t3))), t3;
      case "bigint":
        return At(Kt(64, t3));
      default:
        return Xt(t3) ? t3 = At(he(t3)) : ((t3 = zt(t3)) >= 0 && Xt(t3) ? t3 = String(t3) : (Nt(t3), t3 = $t(It, Ft)), t3 = At(t3)), t3;
    }
  })(r2));
}
function jr(t2, e2, r2) {
  ar(t2, e2, null == r2 ? r2 : qt(r2));
}
function Vr(t2, e2, r2) {
  _r(t2, e2, null == r2 ? r2 : qt(r2), 0);
}
function Hr(t2, e2, r2) {
  _r(t2, e2, ve(r2), "");
}
function Kr(t2, e2, r2) {
  {
    tr(t2);
    let o2 = t2.A, a2 = 0 | o2[et];
    if (null == r2) hr(o2, a2, e2);
    else {
      var n2 = t2 = r2 === j ? 7 : 0 | r2[et], i2 = gr(t2), s2 = i2 || Object.isFrozen(r2);
      for (i2 || (t2 = 0), s2 || (r2 = Vt(r2), n2 = 0, t2 = Nr(t2, a2), s2 = false), t2 |= 5, t2 |= (4 & t2 ? 512 & t2 ? 512 : 1024 & t2 ? 1024 : 0 : void 0) ?? 1024, i2 = 0; i2 < r2.length; i2++) {
        let e3 = r2[i2], o3 = me(e3);
        Object.is(e3, o3) || (s2 && (r2 = Vt(r2), n2 = 0, t2 = Nr(t2, a2), s2 = false), r2[i2] = o3);
      }
      t2 !== n2 && (s2 && (r2 = Vt(r2), t2 = Nr(t2, a2)), it(r2, t2)), hr(o2, a2, e2, r2);
    }
  }
}
function Xr(t2, e2, r2) {
  tr(t2), lr(t2, e2, _e, 2, true).push(me(r2));
}
var Wr = class {
  constructor(t2, e2, r2) {
    if (this.buffer = t2, r2 && !e2) throw Error();
    this.g = e2;
  }
};
function zr(t2, e2) {
  if ("string" == typeof t2) return new Wr(L(t2), e2);
  if (Array.isArray(t2)) return new Wr(new Uint8Array(t2), e2);
  if (t2.constructor === Uint8Array) return new Wr(t2, false);
  if (t2.constructor === ArrayBuffer) return t2 = new Uint8Array(t2), new Wr(t2, false);
  if (t2.constructor === N) return e2 = F(t2) || new Uint8Array(0), new Wr(e2, true, t2);
  if (t2 instanceof Uint8Array) return t2 = t2.constructor === Uint8Array ? t2 : new Uint8Array(t2.buffer, t2.byteOffset, t2.byteLength), new Wr(t2, false);
  throw Error();
}
function Yr(t2, e2) {
  var r2 = 0, n2 = 0, i2 = 0, s2 = t2.h, o2 = t2.g;
  do {
    var a2 = s2[o2++];
    r2 |= (127 & a2) << i2, i2 += 7;
  } while (i2 < 32 && 128 & a2);
  if (i2 > 32) for (n2 |= (127 & a2) >> 4, i2 = 3; i2 < 32 && 128 & a2; i2 += 7) n2 |= (127 & (a2 = s2[o2++])) << i2;
  if (nn(t2, o2), !(128 & a2)) return e2(r2 >>> 0, n2 >>> 0);
  throw Error();
}
function qr(t2) {
  for (var e2 = 0, r2 = t2.g, n2 = r2 + 10, i2 = t2.h; r2 < n2; ) {
    let n3 = i2[r2++];
    if (e2 |= n3, !(128 & n3)) return nn(t2, r2), !!(127 & e2);
  }
  throw Error();
}
function Jr(t2) {
  var e2 = t2.h, r2 = t2.g, n2 = e2[r2++], i2 = 127 & n2;
  if (128 & n2 && (i2 |= (127 & (n2 = e2[r2++])) << 7, 128 & n2 && (i2 |= (127 & (n2 = e2[r2++])) << 14, 128 & n2 && (i2 |= (127 & (n2 = e2[r2++])) << 21, 128 & n2 && (i2 |= (n2 = e2[r2++]) << 28, 128 & n2 && 128 & e2[r2++] && 128 & e2[r2++] && 128 & e2[r2++] && 128 & e2[r2++] && 128 & e2[r2++]))))) throw Error();
  return nn(t2, r2), i2;
}
function Zr(t2) {
  return Jr(t2) >>> 0;
}
function Qr(t2) {
  return Yr(t2, Pt);
}
function tn(t2) {
  var e2 = t2.h, r2 = t2.g, n2 = e2[r2], i2 = e2[r2 + 1], s2 = e2[r2 + 2];
  return e2 = e2[r2 + 3], nn(t2, t2.g + 4), (n2 | i2 << 8 | s2 << 16 | e2 << 24) >>> 0;
}
function en(t2) {
  var e2 = tn(t2);
  t2 = 2 * (e2 >> 31) + 1;
  var r2 = e2 >>> 23 & 255;
  return e2 &= 8388607, 255 == r2 ? e2 ? NaN : t2 * (1 / 0) : 0 == r2 ? 1401298464324817e-60 * t2 * e2 : t2 * Math.pow(2, r2 - 150) * (e2 + 8388608);
}
function rn(t2) {
  return Jr(t2);
}
function nn(t2, e2) {
  if (t2.g = e2, e2 > t2.j) throw Error();
}
function sn(t2, e2) {
  if (e2 < 0) throw Error();
  var r2 = t2.g;
  if ((e2 = r2 + e2) > t2.j) throw Error();
  return t2.g = e2, r2;
}
function on(t2, e2) {
  if (0 == e2) return I();
  var r2 = sn(t2, e2);
  return t2.fa && t2.o ? r2 = t2.h.subarray(r2, r2 + e2) : (t2 = t2.h, r2 = r2 === (e2 = r2 + e2) ? new Uint8Array(0) : Rt ? t2.slice(r2, e2) : new Uint8Array(t2.subarray(r2, e2))), 0 == r2.length ? I() : new N(r2, R);
}
var an = class {
  constructor(t2, e2, r2, n2) {
    this.h = null, this.o = false, this.g = this.j = this.m = 0, this.init(t2, e2, r2, n2);
  }
  init(t2, e2, r2, { fa: n2 = false, ma: i2 = false } = {}) {
    this.fa = n2, this.ma = i2, t2 && (t2 = zr(t2, this.ma), this.h = t2.buffer, this.o = t2.g, this.m = e2 || 0, this.j = void 0 !== r2 ? this.m + r2 : this.h.length, this.g = this.m);
  }
  clear() {
    this.h = null, this.o = false, this.g = this.j = this.m = 0, this.fa = false;
  }
};
var hn = [];
var un = 0;
function cn(t2, e2, r2, n2) {
  if (En.length) {
    let i2 = En.pop();
    return i2.v(n2), i2.g.init(t2, e2, r2, n2), i2;
  }
  return new yn(t2, e2, r2, n2);
}
function ln(t2) {
  t2.g.clear(), t2.j = -1, t2.h = -1, En.length < 100 && En.push(t2);
}
function dn(t2) {
  var e2 = t2.g;
  if (e2.g == e2.j) return false;
  t2.m = t2.g.g;
  var r2 = Zr(t2.g);
  if (e2 = r2 >>> 3, !((r2 &= 7) >= 0 && r2 <= 5)) throw Error();
  if (e2 < 1) throw Error();
  return t2.j = e2, t2.h = r2, true;
}
function fn(t2) {
  try {
    switch (t2.h) {
      case 0:
        0 != t2.h ? fn(t2) : qr(t2.g);
        break;
      case 1:
        var e2 = t2.g;
        nn(e2, e2.g + 8);
        break;
      case 2:
        if (2 != t2.h) fn(t2);
        else {
          var r2 = Zr(t2.g), n2 = t2.g;
          nn(n2, n2.g + r2);
        }
        break;
      case 5:
        var i2 = t2.g;
        nn(i2, i2.g + 4);
        break;
      case 3:
        pn();
        let s2 = t2.j;
        try {
          for (; ; ) {
            if (!dn(t2)) throw Error();
            if (4 == t2.h) {
              if (t2.j != s2) throw Error();
              break;
            }
            fn(t2);
          }
        } catch (t3) {
          if (t3 instanceof RangeError) throw new SyntaxError();
          throw t3;
        } finally {
          un > 0 && un--;
        }
        break;
      default:
        throw Error();
    }
  } catch (t3) {
    if (t3 instanceof RangeError) throw new SyntaxError();
    throw t3;
  }
}
function pn() {
  if (un >= 100) throw new SyntaxError();
  un++;
}
function gn(t2, e2, r2) {
  var n2 = t2.g.j, i2 = Zr(t2.g), s2 = (i2 = t2.g.g + i2) - n2;
  if (s2 <= 0 && (t2.g.j = i2, r2(e2, t2, void 0, void 0, void 0), s2 = i2 - t2.g.g), s2) throw Error();
  return t2.g.g = i2, t2.g.j = n2, e2;
}
function mn(t2) {
  var e2 = Zr(t2.g), r2 = sn(t2 = t2.g, e2);
  if (t2 = t2.h, h) {
    var o2, u2 = t2;
    (o2 = s) || (o2 = s = new TextDecoder("utf-8", { fatal: true })), e2 = r2 + e2, u2 = 0 === r2 && e2 === u2.length ? u2 : u2.subarray(r2, e2);
    try {
      var c2 = o2.decode(u2);
    } catch (t3) {
      if (void 0 === a) {
        try {
          o2.decode(new Uint8Array([128]));
        } catch (t4) {
        }
        try {
          o2.decode(new Uint8Array([97])), a = true;
        } catch (t4) {
          a = false;
        }
      }
      throw !a && (s = void 0), t3;
    }
  } else {
    e2 = (c2 = r2) + e2, r2 = [];
    let s2, a2 = null;
    for (; c2 < e2; ) {
      var l2 = t2[c2++];
      l2 < 128 ? r2.push(l2) : l2 < 224 ? c2 >= e2 ? n() : (s2 = t2[c2++], l2 < 194 || 128 != (192 & s2) ? (c2--, n()) : r2.push((31 & l2) << 6 | 63 & s2)) : l2 < 240 ? c2 >= e2 - 1 ? n() : (s2 = t2[c2++], 128 != (192 & s2) || 224 === l2 && s2 < 160 || 237 === l2 && s2 >= 160 || 128 != (192 & (o2 = t2[c2++])) ? (c2--, n()) : r2.push((15 & l2) << 12 | (63 & s2) << 6 | 63 & o2)) : l2 <= 244 ? c2 >= e2 - 2 ? n() : (s2 = t2[c2++], 128 != (192 & s2) || s2 - 144 + (l2 << 28) >> 30 || 128 != (192 & (o2 = t2[c2++])) || 128 != (192 & (u2 = t2[c2++])) ? (c2--, n()) : (l2 = (7 & l2) << 18 | (63 & s2) << 12 | (63 & o2) << 6 | 63 & u2, l2 -= 65536, r2.push(55296 + (l2 >> 10 & 1023), 56320 + (1023 & l2)))) : n(), r2.length >= 8192 && (a2 = i(a2, r2), r2.length = 0);
    }
    c2 = i(a2, r2);
  }
  return c2;
}
function vn(t2) {
  var e2 = Zr(t2.g);
  return on(t2.g, e2);
}
function _n(t2, e2, r2) {
  var n2 = Zr(t2.g);
  for (n2 = t2.g.g + n2; t2.g.g < n2; ) r2.push(e2(t2.g));
}
var yn = class {
  constructor(t2, e2, r2, n2) {
    if (hn.length) {
      let i2 = hn.pop();
      i2.init(t2, e2, r2, n2), t2 = i2;
    } else t2 = new an(t2, e2, r2, n2);
    this.g = t2, this.m = this.g.g, this.h = this.j = -1, this.v(n2);
  }
  v({ ra: t2 = false } = {}) {
    this.ra = t2;
  }
};
var En = [];
function An(t2) {
  return new Tn(4294967295 & t2, Math.floor(t2 / 4294967296));
}
function wn(t2) {
  return t2 ? /^\d+$/.test(t2) ? (Gt(t2), new Tn(It, Ft)) : null : bn ||= new Tn(0, 0);
}
var bn;
var Tn = class {
  constructor(t2, e2) {
    this.h = t2 >>> 0, this.g = e2 >>> 0;
  }
};
function kn(t2) {
  return new On(4294967295 & t2, Math.floor(t2 / 4294967296));
}
function Sn(t2) {
  return t2 ? /^-?\d+$/.test(t2) ? (Gt(t2), new On(It, Ft)) : null : Ln ||= new On(0, 0);
}
var Ln;
var xn;
var Rn;
var In;
var Fn;
var Cn;
var Nn;
var Mn;
var On = class {
  constructor(t2, e2) {
    this.h = t2 >>> 0, this.g = e2 >>> 0;
  }
};
function Dn(t2, e2, r2) {
  return "undefined" != typeof BigInt64Array ? (Nn || (Nn = new BigInt64Array(1), Mn = new Uint32Array(Nn.buffer), Nn[0] = BigInt(1), Cn = 1 === Mn[0]), Nn[0] = t2, new e2(Mn[t2 = Cn ? 0 : 1], Mn[1 - t2])) : (Fn || (xn = BigInt(Number.MIN_SAFE_INTEGER), Rn = BigInt(Number.MAX_SAFE_INTEGER), In = BigInt(4294967295), Fn = BigInt(32)), t2 >= xn && t2 <= Rn ? r2(Number(t2)) : (t2 = BigInt.asUintN(64, t2), new e2(Number(t2 & In), Number(t2 >> Fn))));
}
function Pn(t2, e2, r2) {
  for (; r2 > 0 || e2 > 127; ) t2.g.push(127 & e2 | 128), e2 = (e2 >>> 7 | r2 << 25) >>> 0, r2 >>>= 7;
  t2.g.push(e2);
}
function $n(t2, e2) {
  for (; e2 > 127; ) t2.g.push(127 & e2 | 128), e2 >>>= 7;
  t2.g.push(e2);
}
function Un(t2, e2) {
  if (e2 >= 0) $n(t2, e2);
  else {
    for (let r2 = 0; r2 < 9; r2++) t2.g.push(127 & e2 | 128), e2 >>= 7;
    t2.g.push(1);
  }
}
function Bn(t2, e2) {
  Gt(e2), (function(t3) {
    var e3 = Ft >> 31;
    t3(It << 1 ^ e3, (Ft << 1 | It >>> 31) ^ e3);
  })((e3, r2) => {
    Pn(t2, e3 >>> 0, r2 >>> 0);
  });
}
function Gn(t2, e2) {
  t2.g.push(e2 >>> 0 & 255), t2.g.push(e2 >>> 8 & 255), t2.g.push(e2 >>> 16 & 255), t2.g.push(e2 >>> 24 & 255);
}
var jn = class {
  constructor() {
    this.g = [];
  }
  length() {
    return this.g.length;
  }
  end() {
    var t2 = this.g;
    return this.g = [], t2;
  }
};
function Vn(t2, e2) {
  0 !== e2.length && (t2.j.push(e2), t2.h += e2.length);
}
function Hn(t2, e2, r2) {
  $n(t2.g, 8 * e2 + r2);
}
function Kn(t2, e2) {
  return Hn(t2, e2, 2), e2 = t2.g.end(), Vn(t2, e2), e2.push(t2.h), e2;
}
function Xn(t2, e2) {
  var r2 = e2.pop();
  for (r2 = t2.h + t2.g.length() - r2; r2 > 127; ) e2.push(127 & r2 | 128), r2 >>>= 7, t2.h++;
  e2.push(r2), t2.h++;
}
function Wn(t2, e2, r2) {
  if (null != r2) switch (Hn(t2, e2, 0), typeof r2) {
    case "number":
      t2 = t2.g, Nt(r2), Pn(t2, It, Ft);
      break;
    case "bigint":
      r2 = Dn(r2, On, kn), Pn(t2.g, r2.h, r2.g);
      break;
    default:
      r2 = Sn(r2), Pn(t2.g, r2.h, r2.g);
  }
}
function zn(t2, e2, r2) {
  Hn(t2, e2, 2), $n(t2.g, r2.length), Vn(t2, t2.g.end()), Vn(t2, r2);
}
function Yn(t2, e2, r2, n2) {
  null != r2 && (e2 = Kn(t2, e2), n2(r2, t2), Xn(t2, e2));
}
var qn = class {
  constructor() {
    this.j = [], this.h = 0, this.g = new jn();
  }
};
function Jn(t2) {
  if ("string" == typeof t2) Sn(t2);
}
function Zn() {
  var t2 = class {
    constructor() {
      throw Error();
    }
  };
  return Object.setPrototypeOf(t2, t2.prototype), t2;
}
var Qn = Zn();
var ti = Zn();
var ei = Zn();
var ri = Zn();
var ni = Zn();
var ii = Zn();
var si = Zn();
var oi = Zn();
var ai = Zn();
var hi = Zn();
var ui = Zn();
var ci = Zn();
function li(t2, e2, r2) {
  var n2 = t2.A;
  X && X in n2 && (n2 = n2[X]) && delete n2[e2.g], e2.h ? e2.o(t2, e2.h, e2.g, r2, e2.j) : e2.o(t2, e2.g, r2, e2.j);
}
var di = class {
  constructor(t2, e2) {
    this.A = Xe(t2, e2, void 0, 2048);
  }
  toJSON() {
    return He(this);
  }
  o() {
    var t2 = Ca, e2 = this.A, r2 = t2.g, n2 = X;
    if (B && n2 && null != e2[n2]?.[r2] && $(W, 3), e2 = t2.g, Z && X && void 0 === Z && (n2 = (r2 = this.A)[X]) && (n2 = n2.ka)) try {
      n2(r2, e2, Ue);
    } catch (t3) {
      l(t3);
    }
    return t2.h ? t2.m(this, t2.h, t2.g, t2.j) : t2.m(this, t2.g, t2.defaultValue, t2.j);
  }
  clone() {
    var t2 = this.A, e2 = 0 | t2[et];
    return rr(this, t2, e2) ? Ye(this, t2, true) : new this.constructor(Je(t2, e2, false));
  }
};
di.prototype[J] = at, di.prototype.toString = function() {
  return this.A.toString();
};
var fi = class {
  constructor(t2, e2, r2) {
    this.g = t2, this.h = e2, t2 = Qn, this.j = !!t2 && r2 === t2 || false;
  }
};
function pi(t2, e2) {
  return new fi(t2, e2, Qn);
}
function gi(t2, e2, r2, n2, i2) {
  Yn(t2, r2, Li(e2, n2), i2);
}
var mi;
var vi;
var _i = pi(function(t2, e2, r2, n2, i2) {
  return 2 === t2.h && (gn(t2, Tr(e2, n2, r2), i2), true);
}, gi);
var yi = pi(function(t2, e2, r2, n2, i2) {
  return 2 === t2.h && (gn(t2, Tr(e2, n2, r2), i2), true);
}, gi);
var Ei = /* @__PURE__ */ Symbol();
var Ai = /* @__PURE__ */ Symbol();
var wi = /* @__PURE__ */ Symbol();
var bi = /* @__PURE__ */ Symbol();
var Ti = /* @__PURE__ */ Symbol();
function ki(t2, e2, r2, n2) {
  var i2 = n2[t2];
  if (i2) return i2;
  (i2 = {}).Ea = n2, i2.ca = (function(t3) {
    switch (typeof t3) {
      case "boolean":
        return De ||= [0, void 0, true];
      case "number":
        return t3 > 0 ? void 0 : 0 === t3 ? Pe ||= [0, void 0] : [-t3, void 0];
      case "string":
        return [0, t3];
      case "object":
        return t3;
    }
  })(n2[0]);
  var s2 = n2[1], o2 = 1;
  s2 && s2.constructor === Object && (i2.ia = s2, "function" == typeof (s2 = n2[++o2]) && (i2.wa = true, mi ??= s2, vi ??= n2[o2 + 1], s2 = n2[o2 += 2]));
  for (var a2 = {}; s2 && Array.isArray(s2) && s2.length && "number" == typeof s2[0] && s2[0] > 0; ) {
    for (var h2 = 0; h2 < s2.length; h2++) a2[s2[h2]] = s2;
    s2 = n2[++o2];
  }
  for (h2 = 1; void 0 !== s2; ) {
    let t3;
    "number" == typeof s2 && (h2 += s2, s2 = n2[++o2]);
    var u2 = void 0;
    if (s2 instanceof fi ? t3 = s2 : (t3 = _i, o2--), t3?.j) {
      s2 = n2[++o2], u2 = n2;
      var c2 = o2;
      "function" == typeof s2 && (s2 = s2(), u2[c2] = s2), u2 = s2;
    }
    for (c2 = h2 + 1, "number" == typeof (s2 = n2[++o2]) && s2 < 0 && (c2 -= s2, s2 = n2[++o2]); h2 < c2; h2++) {
      let n3 = a2[h2];
      u2 ? r2(i2, h2, t3, u2, n3) : e2(i2, h2, t3, n3);
    }
  }
  return n2[t2] = i2;
}
function Si(t2) {
  return Array.isArray(t2) ? t2[0] instanceof fi ? t2 : [yi, t2] : [t2, void 0];
}
function Li(t2, e2) {
  return t2 instanceof di ? t2.A : Array.isArray(t2) ? Ke(t2, e2) : void 0;
}
function xi(t2, e2, r2, n2) {
  var i2 = r2.g;
  t2[e2] = n2 ? (t3, e3, r3) => i2(t3, e3, r3, n2) : i2;
}
function Ri(t2, e2, r2, n2, i2) {
  var s2, o2, a2 = r2.g;
  t2[e2] = (t3, e3, r3) => a2(t3, e3, r3, o2 ||= ki(Ai, xi, Ri, n2).ca, s2 ||= Ii(n2), i2);
}
function Ii(t2) {
  var e2 = t2[wi];
  if (null != e2) return e2;
  var r2 = ki(Ai, xi, Ri, t2);
  return e2 = r2.wa ? (t3, e3) => mi(t3, e3, r2) : (t3, e3) => {
    t: {
      pn();
      try {
        for (; dn(e3) && 4 != e3.h; ) {
          let h3 = e3.j, u3 = r2[h3];
          if (null == u3) {
            let t4 = r2.ia;
            if (t4) {
              let e4 = t4[h3];
              if (e4) {
                let t5 = Ci(e4);
                null != t5 && (u3 = r2[h3] = t5);
              }
            }
          }
          if (null == u3 || !u3(e3, t3, h3)) {
            var n2 = e3;
            let r3 = n2.m;
            if (fn(n2), n2.ra) var i2 = void 0;
            else {
              let t4 = n2.g.g - r3;
              n2.g.g = r3, i2 = on(n2.g, t4);
            }
            n2 = void 0;
            var s2 = t3, o2 = h3, a2 = i2;
            a2 && ((n2 = s2[X] ?? (s2[X] = new $e()))[o2] ?? (n2[o2] = [])).push(a2);
          }
        }
        let u2 = Ne(t3);
        u2 && (u2.ka = r2.Ea[Ti]);
        var h2 = true;
        break t;
      } catch (t4) {
        if (t4 instanceof RangeError) throw new SyntaxError();
        throw t4;
      } finally {
        un > 0 && un--;
      }
      h2 = void 0;
    }
    return h2;
  }, t2[wi] = e2, t2[Ti] = Fi.bind(t2), e2;
}
function Fi(t2, e2, r2, n2) {
  var i2 = this[Ai], s2 = this[wi], o2 = Ke(void 0, i2.ca), a2 = Ne(t2);
  if (a2) {
    var h2 = false, u2 = i2.ia;
    if (u2) {
      if (i2 = (e3, r3, i3) => {
        if (0 !== i3.length) if (u2[r3]) for (let t3 of i3) {
          e3 = cn(t3);
          try {
            h2 = true, s2(o2, e3);
          } finally {
            ln(e3);
          }
        }
        else n2?.(t2, r3, i3);
      }, null == e2) Me(a2, i2);
      else if (null != a2) {
        let t3 = a2[e2];
        t3 && i2(a2, e2, t3);
      }
      if (h2) {
        let n3 = 0 | t2[et];
        if (2 & n3 && 2048 & n3 && !r2?.cb) throw Error();
        let i3 = gt(n3), s3 = (e3, s4) => {
          if (null != or(t2, e3, i3)) {
            if (1 === r2?.lb) return;
            throw Error();
          }
          null != s4 && (n3 = hr(t2, n3, e3, s4, i3)), delete a2[e3];
        };
        null == e2 ? ft(o2, 0 | o2[et], (t3, e3) => {
          s3(t3, e3);
        }) : s3(e2, or(o2, e2, i3));
      }
    }
  }
}
function Ci(t2) {
  var e2 = (t2 = Si(t2))[0].g;
  if (t2 = t2[1]) {
    let r2 = Ii(t2), n2 = ki(Ai, xi, Ri, t2).ca;
    return (t3, i2, s2) => e2(t3, i2, s2, n2, r2);
  }
  return e2;
}
function Ni(t2, e2, r2) {
  t2[e2] = r2.h;
}
function Mi(t2, e2, r2, n2) {
  var i2, s2, o2 = r2.h;
  t2[e2] = (t3, e3, r3) => o2(t3, e3, r3, s2 ||= ki(Ei, Ni, Mi, n2).ca, i2 ||= Oi(n2));
}
function Oi(t2) {
  var e2 = t2[bi];
  if (!e2) {
    let r2 = ki(Ei, Ni, Mi, t2);
    e2 = (t3, e3) => Di(t3, e3, r2), t2[bi] = e2;
  }
  return e2;
}
function Di(t2, e2, r2) {
  ft(t2, 0 | t2[et], (t3, n2) => {
    if (null != n2) {
      var i2 = (function(t4, e3) {
        var r3 = t4[e3];
        if (r3) return r3;
        if ((r3 = t4.ia) && (r3 = r3[e3])) {
          var n3 = (r3 = Si(r3))[0].h;
          if (r3 = r3[1]) {
            let e4 = Oi(r3), i3 = ki(Ei, Ni, Mi, r3).ca;
            r3 = t4.wa ? vi(i3, e4) : (t5, r4, s2) => n3(t5, r4, s2, i3, e4);
          } else r3 = n3;
          return t4[e3] = r3;
        }
      })(r2, t3);
      i2 ? i2(e2, n2, t3) : t3 < 500 || $(Y, 3);
    }
  }), (t2 = Ne(t2)) && Me(t2, (t3, r3, n2) => {
    for (Vn(e2, e2.g.end()), t3 = 0; t3 < n2.length; t3++) Vn(e2, F(n2[t3]) || new Uint8Array(0));
  });
}
var Pi = At(0);
function $i(t2, e2, r2) {
  if (Array.isArray(e2)) {
    var n2 = 0 | e2[et];
    if (4 & n2) return e2;
    for (var i2 = 0, s2 = 0; i2 < e2.length; i2++) {
      let r3 = t2(e2[i2]);
      null != r3 && (e2[s2++] = r3);
    }
    return s2 < i2 && (e2.length = s2), t2 = 1 | n2, r2 && (t2 = -1537 & t2 | 4), t2 !== n2 && it(e2, t2), r2 && 2 & t2 && Object.freeze(e2), e2;
  }
}
var Ui = (t2, e2) => {
  var r2 = new qn();
  Di(t2.A, r2, ki(Ei, Ni, Mi, e2)), Vn(r2, r2.g.end()), t2 = new Uint8Array(r2.h);
  var n2 = (e2 = r2.j).length, i2 = 0;
  for (let r3 = 0; r3 < n2; r3++) {
    let n3 = e2[r3];
    t2.set(n3, i2), i2 += n3.length;
  }
  return r2.j = [t2], t2;
};
function Bi(t2, e2, r2) {
  return new fi(t2, e2, r2);
}
function Gi(t2, e2, r2) {
  return new fi(t2, e2, r2);
}
function ji(t2, e2, r2) {
  hr(t2, 0 | t2[et], e2, r2, gt(0 | t2[et]));
}
var Vi = pi(function(t2, e2, r2, n2, i2) {
  if (2 !== t2.h) return false;
  if (t2 = Vt(t2 = gn(t2, Ke([void 0, void 0], n2), i2)), i2 = gt(n2 = 0 | e2[et]), 2 & n2) throw Error();
  var s2 = or(e2, r2, i2);
  if (s2 instanceof Re) 2 & s2.M ? ((s2 = s2.ea()).push(t2), hr(e2, n2, r2, s2, i2)) : s2.gb(t2);
  else if (Array.isArray(s2)) {
    var o2 = 0 | s2[et];
    8192 & o2 || it(s2, o2 |= 8192), 2 & o2 && hr(e2, n2, r2, s2 = vr(s2), i2), s2.push(t2);
  } else hr(e2, n2, r2, ot([t2]), i2);
  return true;
}, function(t2, e2, r2, n2, i2) {
  if (e2 instanceof Re) e2.forEach((e3, s2) => {
    Yn(t2, r2, Ke([s2, e3], n2), i2);
  });
  else if (Array.isArray(e2)) {
    for (let s2 = 0; s2 < e2.length; s2++) {
      let o2 = e2[s2];
      Array.isArray(o2) && Yn(t2, r2, Ke(o2, n2), i2);
    }
    ot(e2);
  }
});
function Hi(t2, e2, r2) {
  null != (e2 = Jt(e2)) && (Hn(t2, r2, 5), t2 = t2.g, Mt(e2), Gn(t2, It));
}
function Ki(t2, e2, r2) {
  null != (e2 = pe(e2)) && (Jn(e2), Wn(t2, r2, e2));
}
function Xi(t2, e2, r2) {
  null != (e2 = re(e2)) && null != e2 && (Hn(t2, r2, 0), Un(t2.g, e2));
}
function Wi(t2, e2, r2) {
  null != (e2 = null == e2 || "boolean" == typeof e2 ? e2 : "number" == typeof e2 ? !!e2 : void 0) && (Hn(t2, r2, 0), t2.g.g.push(e2 ? 1 : 0));
}
function zi(t2, e2, r2) {
  null != (e2 = _e(e2)) && zn(t2, r2, c(e2));
}
function Yi(t2, e2, r2, n2, i2) {
  Yn(t2, r2, Li(e2, n2), i2);
}
function qi(t2, e2, r2) {
  null != (e2 = ge(e2)) && zn(t2, r2, zr(e2, true).buffer);
}
function Ji(t2, e2, r2) {
  null != (e2 = ne(e2)) && null != e2 && (Hn(t2, r2, 0), $n(t2.g, e2));
}
function Zi(t2, e2, r2) {
  null != (e2 = re(e2)) && (e2 = parseInt(e2, 10), Hn(t2, r2, 0), Un(t2.g, e2));
}
function Qi(t2, e2, r2) {
  return (5 === t2.h || 2 === t2.h) && (e2 = yr(e2, 0 | e2[et], r2), 2 == t2.h ? _n(t2, en, e2) : e2.push(en(t2.g)), true);
}
function ts(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, Qr(t2.g)), true);
}
function es(t2, e2, r2) {
  return (0 === t2.h || 2 === t2.h) && (e2 = yr(e2, 0 | e2[et], r2), 2 == t2.h ? _n(t2, Jr, e2) : e2.push(Jr(t2.g)), true);
}
function rs(t2, e2, r2) {
  return 2 === t2.h && (ji(e2, r2, (t2 = vn(t2)) === I() ? void 0 : t2), true);
}
var ns = Bi(function(t2, e2, r2) {
  if (1 !== t2.h) return false;
  var n2 = t2.g;
  t2 = tn(n2);
  var i2 = tn(n2);
  n2 = 2 * (i2 >> 31) + 1;
  var s2 = i2 >>> 20 & 2047;
  return t2 = 4294967296 * (1048575 & i2) + t2, ji(e2, r2, 2047 == s2 ? t2 ? NaN : n2 * (1 / 0) : 0 == s2 ? 5e-324 * n2 * t2 : n2 * Math.pow(2, s2 - 1075) * (t2 + 4503599627370496)), true;
}, function(t2, e2, r2) {
  null != (e2 = Jt(e2)) && (Hn(t2, r2, 1), t2 = t2.g, (r2 = xt ||= new DataView(new ArrayBuffer(8))).setFloat64(0, +e2, true), It = r2.getUint32(0, true), Ft = r2.getUint32(4, true), Gn(t2, It), Gn(t2, Ft));
}, hi);
var is = Bi(function(t2, e2, r2) {
  return 5 === t2.h && (ji(e2, r2, en(t2.g)), true);
}, Hi, ai);
var ss = Gi(Qi, function(t2, e2, r2) {
  if (null != (e2 = $i(Jt, e2, true))) for (let o2 = 0; o2 < e2.length; o2++) {
    var n2 = t2, i2 = r2, s2 = e2[o2];
    null != s2 && (Hn(n2, i2, 5), n2 = n2.g, Mt(s2), Gn(n2, It));
  }
}, ai);
var os = Gi(Qi, function(t2, e2, r2) {
  if (null != (e2 = $i(Jt, e2, true)) && e2.length) {
    Hn(t2, r2, 2), $n(t2.g, 4 * e2.length);
    for (let n2 = 0; n2 < e2.length; n2++) r2 = t2.g, Mt(e2[n2]), Gn(r2, It);
  }
}, ai);
var as = Bi(function(t2, e2, r2) {
  return 5 === t2.h && (ji(e2, r2, 0 === (t2 = en(t2.g)) ? void 0 : t2), true);
}, Hi, ai);
var hs = Bi(function(t2, e2, r2) {
  return ts(t2, e2, r2);
}, Ki, ii);
var us = Bi(function(t2, e2, r2) {
  return ts(t2, e2, r2);
}, Ki, ii);
var cs = Gi(function(t2, e2, r2) {
  return 0 !== t2.h && 2 !== t2.h ? t2 = false : (e2 = yr(e2, 0 | e2[et], r2), 2 == t2.h ? _n(t2, Qr, e2) : e2.push(Qr(t2.g)), t2 = true), t2;
}, function(t2, e2, r2) {
  if (null != (e2 = $i(pe, e2, false))) for (let n2 = 0; n2 < e2.length; n2++) Wn(t2, r2, e2[n2]);
}, ii);
var ls = Bi(function(t2, e2, r2) {
  return 0 !== t2.h ? e2 = false : (ji(e2, r2, (t2 = Qr(t2.g)) === Pi ? void 0 : t2), e2 = true), e2;
}, Ki, ii);
var ds = Bi(function(t2, e2, r2) {
  return 0 !== t2.h ? t2 = false : (ji(e2, r2, Yr(t2.g, Dt)), t2 = true), t2;
}, function(t2, e2, r2) {
  if (e2 = (function(t3) {
    if (null == t3) return t3;
    var e3 = typeof t3;
    if ("bigint" === e3) return String(Kt(64, t3));
    if (te(t3)) {
      if ("string" === e3) return e3 = zt(Number(t3)), Xt(e3) && e3 >= 0 ? t3 = String(e3) : (-1 !== (e3 = t3.indexOf(".")) && (t3 = t3.substring(0, e3)), t3 = oe(t3)), t3;
      if ("number" === e3) return he(t3);
    }
  })(e2), null != e2) {
    if ("string" == typeof e2) wn(e2);
    if (null != e2) switch (Hn(t2, r2, 0), typeof e2) {
      case "number":
        t2 = t2.g, Nt(e2), Pn(t2, It, Ft);
        break;
      case "bigint":
        r2 = Dn(e2, Tn, An), Pn(t2.g, r2.h, r2.g);
        break;
      default:
        r2 = wn(e2), Pn(t2.g, r2.h, r2.g);
    }
  }
}, si);
var fs = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, Jr(t2.g)), true);
}, Xi, ri);
var ps = Gi(es, function(t2, e2, r2) {
  if (null != (e2 = $i(re, e2, true))) for (let o2 = 0; o2 < e2.length; o2++) {
    var n2 = t2, i2 = r2, s2 = e2[o2];
    null != s2 && (Hn(n2, i2, 0), Un(n2.g, s2));
  }
}, ri);
var gs = Gi(es, function(t2, e2, r2) {
  if (null != (e2 = $i(re, e2, true)) && e2.length) {
    r2 = Kn(t2, r2);
    for (let r3 = 0; r3 < e2.length; r3++) Un(t2.g, e2[r3]);
    Xn(t2, r2);
  }
}, ri);
var ms = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, 0 === (t2 = Jr(t2.g)) ? void 0 : t2), true);
}, Xi, ri);
var vs = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, qr(t2.g)), true);
}, Wi, ti);
var _s = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, false === (t2 = qr(t2.g)) ? void 0 : t2), true);
}, Wi, ti);
var ys = Gi(function(t2, e2, r2) {
  return 2 === t2.h && (t2 = mn(t2), yr(e2, 0 | e2[et], r2).push(t2), true);
}, function(t2, e2, r2) {
  if (null != (e2 = $i(_e, e2, true))) for (let o2 = 0; o2 < e2.length; o2++) {
    var n2 = t2, i2 = r2, s2 = e2[o2];
    null != s2 && zn(n2, i2, c(s2));
  }
}, ei);
var Es = Bi(function(t2, e2, r2) {
  return 2 === t2.h && (ji(e2, r2, "" === (t2 = mn(t2)) ? void 0 : t2), true);
}, zi, ei);
var As = Bi(function(t2, e2, r2) {
  return 2 === t2.h && (ji(e2, r2, mn(t2)), true);
}, zi, ei);
var ws = (function(t2, e2, r2 = Qn) {
  return new fi(t2, e2, r2);
})(function(t2, e2, r2, n2, i2) {
  return 2 === t2.h && (n2 = Ke(void 0, n2), yr(e2, 0 | e2[et], r2).push(n2), gn(t2, n2, i2), true);
}, function(t2, e2, r2, n2, i2) {
  if (Array.isArray(e2)) {
    for (let s2 = 0; s2 < e2.length; s2++) Yi(t2, e2[s2], r2, n2, i2);
    1 & (t2 = 0 | e2[et]) || it(e2, 1 | t2);
  }
});
var bs = pi(function(t2, e2, r2, n2, i2, s2) {
  if (2 !== t2.h) return false;
  var o2 = 0 | e2[et];
  return wr(e2, o2, s2, r2, gt(o2)), gn(t2, e2 = Tr(e2, n2, r2), i2), true;
}, Yi);
var Ts = Bi(function(t2, e2, r2) {
  return 2 === t2.h && (ji(e2, r2, vn(t2)), true);
}, qi, ui);
var ks = Gi(function(t2, e2, r2) {
  return 2 === t2.h && (t2 = vn(t2), yr(e2, 0 | e2[et], r2).push(t2), true);
}, function(t2, e2, r2) {
  if (null != (e2 = $i(ge, e2, false))) for (let o2 = 0; o2 < e2.length; o2++) {
    var n2 = t2, i2 = r2, s2 = e2[o2];
    null != s2 && zn(n2, i2, zr(s2, true).buffer);
  }
}, ui);
var Ss = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, Zr(t2.g)), true);
}, Ji, ni);
var Ls = Gi(function(t2, e2, r2) {
  return (0 === t2.h || 2 === t2.h) && (e2 = yr(e2, 0 | e2[et], r2), 2 == t2.h ? _n(t2, Zr, e2) : e2.push(Zr(t2.g)), true);
}, function(t2, e2, r2) {
  if (null != (e2 = $i(ne, e2, true))) for (let o2 = 0; o2 < e2.length; o2++) {
    var n2 = t2, i2 = r2, s2 = e2[o2];
    null != s2 && (Hn(n2, i2, 0), $n(n2.g, s2));
  }
}, ni);
var xs = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, 0 === (t2 = Zr(t2.g)) ? void 0 : t2), true);
}, Ji, ni);
var Rs = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, Jr(t2.g)), true);
}, Zi, ci);
var Is = Bi(function(t2, e2, r2) {
  return 0 === t2.h && (ji(e2, r2, 0 === (t2 = Jr(t2.g)) ? void 0 : t2), true);
}, Zi, ci);
var Fs = Bi(function(t2, e2, r2) {
  return 0 !== t2.h ? t2 = false : (ji(e2, r2, (function(t3) {
    return Yr(t3, (t4, e3) => {
      var r3 = -(1 & t4);
      return Pt(t4 = (t4 >>> 1 | e3 << 31) ^ r3, e3 >>> 1 ^ r3);
    });
  })(t2.g)), t2 = true), t2;
}, function(t2, e2, r2) {
  if (null != (e2 = pe(e2)) && (Jn(e2), null != e2)) switch (Hn(t2, r2, 0), typeof e2) {
    case "number":
      t2 = t2.g, e2 = (r2 = e2) < 0, Ct(r2 = 2 * Math.abs(r2)), r2 = It;
      let n2 = Ft;
      e2 && (0 == r2 ? 0 == n2 ? n2 = r2 = 4294967295 : (n2--, r2 = 4294967295) : r2--), Pn(t2, It = r2, Ft = n2);
      break;
    case "bigint":
      t2 = t2.g, e2 = e2 << BigInt(1) ^ e2 >> BigInt(63), It = Number(BigInt.asUintN(32, e2)), Ft = Number(BigInt.asUintN(32, e2 >> BigInt(32))), Pn(t2, It, Ft);
      break;
    default:
      Bn(t2.g, e2);
  }
}, oi);
var Cs = class {
  constructor(t2, e2) {
    var r2 = no;
    this.g = t2, this.h = e2, this.m = Sr, this.o = Ir, this.defaultValue = void 0, this.j = null != r2.jb ? pt : void 0;
  }
  register() {
    v(this);
  }
};
function Ns(t2, e2) {
  return new Cs(t2, e2);
}
function Ms(t2, e2) {
  return (r2, n2) => {
    t: {
      let s2 = { ma: true };
      n2 && Object.assign(s2, n2), r2 = cn(r2, void 0, void 0, s2);
      try {
        let n3 = new t2(), s3 = n3.A;
        Ii(e2)(s3, r2);
        var i2 = n3;
        break t;
      } catch (t3) {
        if (t3 instanceof RangeError) throw new SyntaxError();
        throw t3;
      } finally {
        ln(r2);
      }
      i2 = void 0;
    }
    return i2;
  };
}
function Os(t2) {
  return (e2) => Ui(e2, t2);
}
function Ds(t2) {
  return function() {
    return Ui(this, t2);
  };
}
var Ps = [0, Ts, ks, vs, As];
var $s = [0, Es, [0, Is, [0, ls, ms], Is, -1, [0, Rs], Is, -1], Bi(rs, qi, ui)];
var Us;
var Bs = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Gs = [0, Es, Bi(rs, function(t2, e2, r2) {
  if (null != e2) {
    if (e2 instanceof di) {
      let n2 = e2.mb;
      return void (n2 ? (e2 = n2(e2), null != e2 && zn(t2, r2, zr(e2, true).buffer)) : $(Y, 3));
    }
    if (Array.isArray(e2)) return void $(Y, 3);
  }
  qi(t2, e2, r2);
}, ui)];
var js = [0, 1, [0, 12, fs, 10, vs], [0, 7, [0, fs, -1]]];
var Vs = globalThis.trustedTypes;
var Hs = class {
  constructor(t2) {
    this.g = t2;
  }
  toString() {
    return this.g + "";
  }
};
function Ks(t2) {
  var e2;
  return void 0 === Us && (Us = (function() {
    var t3 = null;
    if (!Vs) return t3;
    try {
      let e3 = (t4) => t4;
      t3 = Vs.createPolicy("goog#html", { createHTML: e3, createScript: e3, createScriptURL: e3 });
    } catch (t4) {
    }
    return t3;
  })()), t2 = (e2 = Us) ? e2.createScriptURL(t2) : t2, new Hs(t2);
}
function Xs(t2, ...e2) {
  if (0 === e2.length) return Ks(t2[0]);
  var r2 = t2[0];
  for (let n2 = 0; n2 < e2.length; n2++) r2 += encodeURIComponent(e2[n2]) + t2[n2 + 1];
  return Ks(r2);
}
var Ws = [0, fs, Rs, vs, -1, gs, Rs, -1, vs, -1];
var zs = [0, Rs, -1, vs];
var Ys = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var qs = [0, vs, As, vs, Rs, -1, Gi(function(t2, e2, r2) {
  return (0 === t2.h || 2 === t2.h) && (e2 = yr(e2, 0 | e2[et], r2), 2 == t2.h ? _n(t2, rn, e2) : e2.push(Jr(t2.g)), true);
}, function(t2, e2, r2) {
  if (null != (e2 = $i(re, e2, true)) && e2.length) {
    r2 = Kn(t2, r2);
    for (let r3 = 0; r3 < e2.length; r3++) Un(t2.g, e2[r3]);
    Xn(t2, r2);
  }
}, ci), As, -1, [0, vs, -1], Rs, vs, -1, zs];
var Js = [0, 3, vs, -1, 2, [0, [2], fs, bs, [0, Ss]], [0, Rs, vs, Rs, vs, Rs, 4, [0, vs, As, -1, vs]], [0, [3, 4], As, -1, bs, [0, fs], bs, [0, Rs, -1]], [0]];
var Zs = [0, As, -2];
var Qs = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var to = [0];
var eo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ro = [0, fs, vs, 1, vs, -4];
var no = class extends di {
  constructor(t2) {
    super(t2, 2);
  }
};
var io = {};
io[336783863] = [0, As, vs, -1, fs, [0, [1, 2, 3, 4, 5, 6, 7, 8, 9], bs, to, bs, qs, bs, Zs, bs, ro, bs, Ws, bs, [0, As, -2], bs, [0, As, Rs], bs, Js, bs, zs], [0, As], vs, [0, [1, 3], [2, 4], bs, [0, gs], -1, bs, [0, ys], -1, ws, [0, As, -1]], As];
var so = [0, ls, -1, _s, -3, ls, gs, Es, ms, ls, -1, _s, ms, _s, -2, Es];
function oo(t2, e2) {
  Xr(t2, 3, e2);
}
function ao(t2, e2) {
  Xr(t2, 4, e2);
}
var ho = class extends di {
  constructor(t2) {
    super(t2, 500);
  }
  v(t2) {
    return Ir(this, 0, 7, t2);
  }
};
var uo = [-1, {}];
var co = [0, As, 1, uo];
var lo = [0, As, ys, uo];
function fo(t2, e2) {
  Mr(t2, 1, ho, e2);
}
function po(t2, e2) {
  Xr(t2, 10, e2);
}
function go(t2, e2) {
  Xr(t2, 15, e2);
}
var mo = class extends di {
  constructor(t2) {
    super(t2, 500);
  }
  v(t2) {
    return Ir(this, 0, 1001, t2);
  }
};
var vo = [-500, ws, [-500, Es, -1, ys, -3, [-2, io, vs], ws, Gs, ms, -1, co, lo, ws, [0, Es, _s], Es, so, ms, ys, 987, ys], 4, ws, [-500, As, -1, [-1, {}], 998, As], ws, [-500, As, ys, -1, [-2, {}, vs], 997, ys, -1], ms, ws, [-500, As, ys, uo, 998, ys], ys, ms, co, lo, ws, [0, Es, -1, uo], ys, -2, so, Es, -1, _s, [0, _s, xs], 978, uo, ws, Gs];
mo.prototype.g = Ds(vo);
var _o = Ms(mo, vo);
var yo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Eo = class extends di {
  constructor(t2) {
    super(t2);
  }
  g() {
    return xr(this, yo, 1);
  }
};
var Ao = [0, ws, [0, fs, is, As, -1]];
var wo = Ms(Eo, Ao);
var bo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var To = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ko = class extends di {
  constructor(t2) {
    super(t2);
  }
  j() {
    return Sr(this, bo, 2);
  }
  g() {
    return xr(this, To, 5);
  }
};
var So = Ms(class extends di {
  constructor(t2) {
    super(t2);
  }
}, [0, ys, gs, os, [0, Rs, [0, fs, -3], [0, is, -3], [0, fs, -1, [0, ws, [0, fs, -2]]], ws, [0, is, -1, As, is]], As, -1, us, ws, [0, fs, is], ys, us]);
var Lo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var xo = Ms(class extends di {
  constructor(t2) {
    super(t2);
  }
}, [0, ws, [0, is, -4]]);
var Ro = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Io = Ms(class extends di {
  constructor(t2) {
    super(t2);
  }
}, [0, ws, [0, is, -4]]);
var Fo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Co = [0, fs, -1, os, Rs];
var No = class extends di {
  constructor(t2) {
    super(t2);
  }
};
No.prototype.g = Ds([0, is, -4, us]);
var Mo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Oo = Ms(class extends di {
  constructor(t2) {
    super(t2);
  }
}, [0, ws, [0, 1, fs, As, Ao], us]);
var Do = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Po = class extends di {
  constructor(t2) {
    super(t2);
  }
  g() {
    var t2 = sr(this, 1, void 0, mr);
    return null == t2 ? I() : t2;
  }
};
var $o = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Uo = [1, 2];
var Bo = Ms(class extends di {
  constructor(t2) {
    super(t2);
  }
}, [0, ws, [0, Uo, bs, [0, os], bs, [0, Ts], fs, As], us]);
var Go = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var jo = [0, As, fs, is, ys, -1];
var Vo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Ho = [0, vs, -1];
var Ko = class extends di {
  constructor(t2) {
    super(t2);
  }
  g() {
    return ur(this, Ys, 2, Xo);
  }
};
var Xo = [1, 2, 3, 4, 5, 6];
var Wo = class extends di {
  constructor(t2) {
    super(t2);
  }
  g() {
    return null != sr(this, 1, void 0, mr);
  }
  j() {
    return null != _e(sr(this, 2));
  }
};
var zo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Yo = [0, Ts, As, [0, fs, us, -1], [0, ds, us]];
var qo = [0, Yo, vs, [0, Xo, bs, ro, bs, qs, bs, Ws, bs, to, bs, Zs, bs, Js], Rs];
var Jo = Os(qo);
var Zo = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Qo = [0, qo, is, -1, fs];
var ta = Ns(502141897, Zo);
io[502141897] = Qo;
var ea = Ms(class extends di {
  constructor(t2) {
    super(t2);
  }
}, [0, [0, Rs, -1, ss, Ls], Co]);
var ra = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var na = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ia = [0, qo, is, [0, qo], vs];
var sa = Ns(508968150, na);
io[508968150] = [0, qo, Qo, ia, is, [0, [0, Yo]]], io[508968149] = ia;
var oa = class extends di {
  constructor(t2) {
    super(t2);
  }
  j() {
    return Sr(this, Go, 2);
  }
  g() {
    ar(this, 2);
  }
};
var aa = [0, qo, jo];
io[478825465] = aa;
var ha = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ua = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ca = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var la = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var da = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var fa = [0, qo, [0, qo], aa, -1];
var pa = [0, qo, is, fs];
var ga = [0, qo, is];
var ma = [0, qo, pa, ga, is];
var va = Ns(479097054, da);
io[479097054] = [0, qo, ma, fa], io[463370452] = fa, io[464864288] = pa;
var _a = Ns(462713202, la);
io[462713202] = ma, io[474472470] = ga;
var ya = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Ea = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Aa = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var wa = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ba = [0, qo, is, -1, fs];
var Ta = [0, qo, is, vs];
wa.prototype.g = Ds([0, qo, ga, [0, qo], Qo, ia, ba, Ta]);
var ka = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Sa = Ns(456383383, ka);
io[456383383] = [0, qo, jo];
var La = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var xa = Ns(476348187, La);
io[476348187] = [0, qo, Ho];
var Ra = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Ia = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Fa = [0, Rs, -1];
var Ca = Ns(458105876, class extends di {
  constructor(t2) {
    super(t2);
  }
  g() {
    var t2 = this.A, e2 = 0 | t2[et], r2 = ht(this, e2);
    return t2 = (function(t3, e3, r3, n2) {
      var i2 = Ia;
      !n2 && Qe(t3) && (r3 = 0 | (e3 = t3.A)[et]);
      var s2 = or(e3, 2);
      if (t3 = false, null == s2) {
        if (n2) return Ce();
        s2 = [];
      } else if (s2.constructor === Re) {
        if (!(2 & s2.M) || n2) return s2;
        s2 = s2.ea();
      } else Array.isArray(s2) ? t3 = !!(2 & s2[et]) : s2 = [];
      if (n2) {
        if (!s2.length) return Ce();
        t3 || (t3 = true, st(s2));
      } else t3 && (t3 = false, ot(s2), s2 = vr(s2));
      return !t3 && 32 & r3 && nt(s2, 32), r3 = hr(e3, r3, 2, n2 = new Re(s2, i2, Ee, void 0)), t3 || er(e3, r3), n2;
    })(this, t2, e2, r2), !r2 && Ia && (t2.Fa = true), t2;
  }
});
io[458105876] = [0, Fa, Vi, [true, us, [0, As, -1, ys]], [0, gs, vs, Rs], vs];
var Na = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Ma = Ns(458105758, Na);
io[458105758] = [0, qo, As, Fa];
var Oa = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Da = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Pa = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var $a = Os([0, ws, [0, Is, ws, [0, as, -1], _s]]);
var Ua = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Ba = [0, as, -1, _s];
var Ga = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ja = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Va = [1, 2];
ja.prototype.g = Ds([0, Va, bs, Ba, bs, [0, ws, Ba]]);
var Ha = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Ka = Ns(443442058, Ha);
io[443442058] = [0, qo, As, fs, is, ys, -1, vs, is], io[514774813] = ba;
var Xa = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var Wa = Ns(516587230, Xa);
function za(t2, e2) {
  return e2 = e2 ? e2.clone() : new Go(), void 0 !== t2.displayNamesLocale ? ar(e2, 1, ve(t2.displayNamesLocale)) : void 0 === t2.displayNamesLocale && ar(e2, 1), void 0 !== t2.maxResults ? Ur(e2, 2, t2.maxResults) : "maxResults" in t2 && ar(e2, 2), void 0 !== t2.scoreThreshold ? jr(e2, 3, t2.scoreThreshold) : "scoreThreshold" in t2 && ar(e2, 3), void 0 !== t2.categoryAllowlist ? Kr(e2, 4, t2.categoryAllowlist) : "categoryAllowlist" in t2 && ar(e2, 4), void 0 !== t2.categoryDenylist ? Kr(e2, 5, t2.categoryDenylist) : "categoryDenylist" in t2 && ar(e2, 5), e2;
}
function Ya(t2) {
  var e2 = Number(t2);
  return Number.isSafeInteger(e2) ? e2 : String(t2);
}
function qa(t2, e2 = -1, r2 = "") {
  return { categories: t2.map((t3) => ({ index: Or(t3, 1) ?? 0 ?? -1, score: Dr(t3, 2) ?? 0, categoryName: _e(sr(t3, 3)) ?? "" ?? "", displayName: _e(sr(t3, 4)) ?? "" ?? "" })), headIndex: e2, headName: r2 };
}
function Ja(t2) {
  var e2 = { classifications: xr(t2, Mo, 1).map((t3) => qa(Sr(t3, Eo, 4)?.g() ?? [], Or(t3, 2) ?? 0, _e(sr(t3, 3)) ?? "")) };
  return null != (function(t3) {
    return null == t3 ? t3 : "bigint" == typeof t3 ? (wt(t3) ? t3 = Number(t3) : (t3 = Ht(64, t3), t3 = wt(t3) ? Number(t3) : String(t3)), t3) : te(t3) ? "number" == typeof t3 ? ae(t3) : ce(t3) : void 0;
  })(sr(t2, 2, void 0, fe)) && (e2.timestampMs = Ya(sr(t2, 2, void 0, fe) ?? nr)), e2;
}
function Za(t2) {
  var e2 = lr(t2, 3, Jt, cr()), r2 = lr(t2, 2, re, cr()), n2 = lr(t2, 1, _e, cr()), i2 = lr(t2, 9, _e, cr()), s2 = { categories: [], keypoints: [] };
  for (let t3 = 0; t3 < e2.length; t3++) s2.categories.push({ score: e2[t3], index: r2[t3] ?? -1, categoryName: n2[t3] ?? "", displayName: i2[t3] ?? "" });
  if ((e2 = Sr(t2, ko, 4)?.j()) && (s2.boundingBox = { originX: Or(e2, 1, ir) ?? 0, originY: Or(e2, 2, ir) ?? 0, width: Or(e2, 3, ir) ?? 0, height: Or(e2, 4, ir) ?? 0, angle: 0 }), Sr(t2, ko, 4)?.g().length) for (let e3 of Sr(t2, ko, 4).g()) s2.keypoints.push({ x: sr(e3, 1, ir, Jt) ?? 0, y: sr(e3, 2, ir, Jt) ?? 0, score: sr(e3, 4, ir, Jt) ?? 0, label: _e(sr(e3, 3, ir)) ?? "" });
  return s2;
}
function Qa(t2) {
  var e2 = [];
  for (let r2 of xr(t2, Ro, 1)) e2.push({ x: Dr(r2, 1) ?? 0, y: Dr(r2, 2) ?? 0, z: Dr(r2, 3) ?? 0, visibility: Dr(r2, 4) ?? 0 });
  return e2;
}
function th(t2) {
  var e2 = [];
  for (let r2 of xr(t2, Lo, 1)) e2.push({ x: Dr(r2, 1) ?? 0, y: Dr(r2, 2) ?? 0, z: Dr(r2, 3) ?? 0, visibility: Dr(r2, 4) ?? 0 });
  return e2;
}
function eh(t2) {
  return Array.from(t2, (t3) => t3 > 127 ? t3 - 256 : t3);
}
function rh(t2, e2) {
  if (t2.length !== e2.length) throw Error(`Cannot compute cosine similarity between embeddings of different sizes (${t2.length} vs. ${e2.length}).`);
  var r2 = 0, n2 = 0, i2 = 0;
  for (let s2 = 0; s2 < t2.length; s2++) r2 += t2[s2] * e2[s2], n2 += t2[s2] * t2[s2], i2 += e2[s2] * e2[s2];
  if (n2 <= 0 || i2 <= 0) throw Error("Cannot compute cosine similarity on embedding with 0 norm.");
  return r2 / Math.sqrt(n2 * i2);
}
io[516587230] = [0, qo, ba, Ta, is], io[518928384] = Ta;
var nh;
var ih = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
async function sh(t2) {
  if (t2) return true;
  if (void 0 === nh) try {
    await WebAssembly.instantiate(ih), nh = true;
  } catch {
    nh = false;
  }
  return nh;
}
async function oh(t2, e2, r2) {
  return { wasmLoaderPath: `${e2}/${t2}_${r2 = `wasm${r2 ? "_module" : ""}${await sh(r2) ? "" : "_nosimd"}_internal`}.js`, wasmBinaryPath: `${e2}/${t2}_${r2}.wasm` };
}
var ah = class {
};
function hh(t2) {
  return ar(new uh(), 1, ee(t2));
}
ah.forVisionTasks = function(t2, e2 = false) {
  return oh("vision", t2 ?? Xs``, e2);
}, ah.forTextTasks = function(t2, e2 = false) {
  return oh("text", t2 ?? Xs``, e2);
}, ah.forGenAiTasks = function(t2, e2 = false) {
  return oh("genai", t2 ?? Xs``, e2);
}, ah.forAudioTasks = function(t2, e2 = false) {
  return oh("audio", t2 ?? Xs``, e2);
}, ah.isSimdSupported = function(t2 = false) {
  return sh(t2);
};
var uh = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var ch = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var lh = [0, Rs, 2, ds, -2, us, ws, [0, Rs, us]];
var dh = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var fh = class extends di {
  constructor(t2) {
    super(t2);
  }
};
function ph(t2, e2) {
  return ar(t2, 1, ee(e2));
}
function gh(t2, e2) {
  return ar(t2, 2, ee(e2));
}
var mh = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var vh = [3, 4, 5, 6, 7];
var _h = class extends di {
  constructor(t2) {
    super(t2);
  }
};
var yh = class extends di {
  constructor(t2) {
    super(t2);
  }
};
yh.prototype.g = Ds([0, [0, Rs, As, -3, Rs], [0, vh, Rs, -1, bs, [0, Rs, As, ds], bs, lh, bs, [0, 1, lh], bs, [0, Rs], bs, [0, Rs, As, ds]]]);
var Eh = class {
  constructor() {
    this.g = "undefined" != typeof AbortController;
  }
  async send(t2, e2, r2) {
    var n2 = this.g ? new AbortController() : void 0, i2 = n2 && t2.la > 0 ? setTimeout(() => {
      n2.abort();
    }, t2.la) : void 0;
    try {
      let i3 = await fetch(t2.url, { method: t2.bb, headers: { ...t2.ab }, ...t2.body && { body: t2.body }, ...t2.withCredentials && { credentials: "include" }, signal: t2.la && n2 ? n2.signal : null });
      200 === i3.status ? e2?.(await i3.text()) : r2?.(i3.status);
    } catch (t3) {
      if ("AbortError" === t3?.name) r2?.(408);
      else r2?.(400);
    } finally {
      clearTimeout(i2);
    }
  }
};
var Ah = class extends di {
  constructor(t2) {
    super(t2, 37);
  }
};
var wh = [-4, {}, js, Rs, $s];
var bh = [0, As, Rs, 1, As, -1, Rs, 1, Rs, 1, us];
var Th = [0, Rs, As, -2];
var kh = [0, As, Rs];
var Sh = [0, As, Rs];
var Lh = [0, vs, -3];
var xh = [0, Rs, As, -1, us, fs, -1, As, -5, ws, [0, As, -4], -1, vs, [0, vs, -3], Rs];
var Rh = class extends di {
  constructor(t2) {
    super(t2, 19);
  }
};
var Ih = Os([-19, {}, [0, Rs, 1, [0, As, -6, us, fs, As, -1, us], 1, [0, As, 1, As, -5], As, -1, [0, Rs, As, -8], [0, As, -3], [0, As, Rs, As, -2], [0, As, -1, Rs, As, -1, Rs, As, -1, [0, ws, [0, As, -1], vs, As, -5], [0, Rs, vs, fs, -2]], us, [0, As, -3, us, fs, As, -1], [0, Rs, As, -1], [0, As, -9], [0, As, -6, Rs, As, 1, As, vs, Rs, -1, vs, As, -2, Rs, As, Rs, As, fs, -1], 1, [0, Rs], 1, [0, As, -4], 1, bh, [0, [1, 2, 3, 4, 5, 6], bs, bh, bs, kh, bs, Sh, bs, [0, Rs], bs, xh, bs, Th], kh, Sh, xh, [0, [0, Rs, As, -1, us, fs, -1, As, -4, ws, [0, As, -4], -1, 1, Lh], [0, Rs, As, -1, us, fs, -1, As, -4, Lh]], Th, [0, As, [0, fs, -3, Rs], Rs, -2, [0, fs, -1], vs], 4, [0, As, Rs, As, -1, us, Rs, As, -1, Rs, fs, -1]], Rs, ws, [-37, {}, hs, As, ws, [0, As, -1], Ts, 1, Ts, [0, ys, -1, ps, cs, -1], As, [0, fs, As, -1], vs, fs, us, As, -1, Fs, Ps, hs, Ts, Rs, ps, us, -1, [0, Rs, -1], As, vs, As, gs, As, -1, ns, 1, ns, wh, vs, [0, Rs, [0, is, fs, -2], [0, is]], [0, Rs, us]], hs, ks, As, -1, hs, Rs, -1, [0, vs, -1, Rs, vs], [0, us, -1, As], [0, hs, vs, us], us, 1, Ss, 1, wh]);
var Fh = class {
  constructor(t2) {
    this.h = [], this.m = new Eh(), this.j = t2 ?? "", this.g = setInterval(() => {
      this.flush();
    }, 6e4);
  }
  close() {
    void 0 !== this.g && (clearInterval(this.g), this.g = void 0), this.flush();
  }
  flush(t2, e2) {
    if (this.error) e2?.("net-send-failed");
    else if (0 === this.h.length) t2?.();
    else {
      var r2 = this.h;
      this.h = [], r2 = (function(t3) {
        var e3 = new Rh();
        return Cr(e3 = ar(e3, 2, ee(1786)), 3, t3);
      })(r2), r2 = Ih(r2), this.m.send({ url: "https://odml.pa.googleapis.com/v1/log", bb: "POST", la: 1e4, body: r2, hb: 2, ab: { "Content-Type": "application/x-protobuf", "x-goog-api-key": this.j }, withCredentials: false }, () => {
        t2?.();
      }, (t3) => {
        this.error = Error(`Logging failed with HTTP error: ${t3}`), this.h = [], void 0 !== this.g && (clearInterval(this.g), this.g = void 0), e2?.("net-send-failed", t3);
      });
    }
  }
};
var Ch = class {
  constructor() {
    this.aa = this.U = this.X = this.R = this.V = this.T = this.P = 0;
  }
};
function Nh(t2, e2) {
  var r2 = new yh();
  r2 = Ir(r2, 0, 1, t2.B), r2 = Ir(r2, 0, 2, e2), e2 = ar(e2 = new Ah(), 6, ct(r2 = r2.g(), false)), (t2 = t2.l).error || t2.h.push(e2);
}
function Mh(t2, e2) {
  var r2 = { P: e2.P - t2.j.P, T: e2.T - t2.j.T, V: e2.V - t2.j.V, R: e2.R - t2.j.R, X: e2.X - t2.j.X, U: e2.U, aa: e2.aa }, n2 = gh(ph(new mh(), t2.C), 1);
  r2 = Oh(t2, r2), Nh(t2, n2 = Fr(n2, 4, vh, r2)), t2.j = e2;
}
function Oh(t2, e2) {
  var r2 = new ch();
  return t2 = Gr(t2 = Br(t2 = ar(r2, 1, ee(t2.D)), 7, e2.R), 5, e2.U), t2 = Gr(t2, 6, e2.aa), e2.V > 0 && Gr(t2, 4, e2.X / e2.V), 0 !== e2.P && (r2 = Br(r2 = hh(3), 2, e2.P), Mr(t2, 8, uh, r2)), 0 !== e2.T && (e2 = Br(r2 = hh(4), 2, e2.T), Mr(t2, 8, uh, e2)), t2;
}
var Dh = class {
  constructor(t2, e2, r2) {
    this.u = performance.now(), this.m = performance.now(), this.h = /* @__PURE__ */ new Map(), this.o = 0, this.g = new Ch(), this.j = new Ch(), this.l = new Fh(r2), this.C = (function(t3) {
      switch (t3) {
        case "AudioClassifier":
          return 4;
        case "AudioEmbedder":
          return 5;
        case "TextClassifier":
          return 6;
        case "TextEmbedder":
          return 7;
        case "GestureRecognizer":
          return 8;
        case "HandDetector":
          return 9;
        case "HandLandmarker":
          return 10;
        case "ImageClassifier":
          return 11;
        case "ImageEmbedder":
          return 12;
        case "ImageSegmenter":
          return 13;
        case "ObjectDetector":
          return 14;
        case "FaceDetector":
          return 15;
        case "FaceLandmarker":
          return 16;
        case "InteractiveSegmenter":
        case "InteractiveSegmenterLegacy":
          return 18;
        case "HolisticLandmarker":
          return 20;
        case "LlmInference":
          return 21;
        case "LanguageDetector":
          return 22;
        case "PoseLandmarker":
          return 23;
        default:
          return 0;
      }
    })(t2), this.D = (function(t3) {
      switch (t3) {
        case "IMAGE":
          return 11;
        case "VIDEO":
          return 12;
        case "LIVE_STREAM":
          return 13;
        case "AUDIO_CLIPS":
          return 14;
        case "AUDIO_STREAM":
          return 15;
        default:
          return 10;
      }
    })(e2), t2 = new _h(), "undefined" == typeof window ? e2 = 0 : (e2 = navigator.userAgent, e2 = /Android/i.test(e2) ? 1 : /iPhone|iPad|iPod/i.test(e2) ? 2 : /Windows/i.test(e2) ? 5 : /Macintosh/i.test(e2) ? 4 : /Linux/i.test(e2) ? 3 : 0), t2 = ar(t2, 1, ee(e2)), t2 = ar(t2, 2, ve("")), t2 = ar(t2, 3, ve("")), t2 = ar(t2, 4, ve("1.0.1")), t2 = ar(t2, 5, ve("")), this.B = ar(t2, 6, ee(4));
  }
  ya() {
    var t2 = new fh();
    t2 = Gr(t2 = ar(t2, 1, ee(this.D)), 3, performance.now() - this.u), Nh(this, t2 = Fr(gh(ph(new mh(), this.C), 0), 3, vh, t2)), this.m = performance.now();
  }
  za(t2) {
    var e2 = this.h.get(t2);
    if (void 0 !== e2 && (this.h.delete(t2), t2 = performance.now() - e2, ++this.g.V, this.g.X += t2, this.g.U = Math.max(this.g.U, t2), this.o = Math.max(this.o, t2), performance.now() > this.m + 3e4)) {
      for (let [r2, n2] of this.h.entries()) t2 = r2, n2 < e2 && (this.g.R++, this.h.delete(t2));
      e2 = { ...this.g, aa: performance.now() - this.m }, this.g.U = 0, this.m = performance.now(), Mh(this, e2);
    }
  }
  xa() {
    var t2 = { ...this.g, R: this.g.R + this.h.size, U: this.o, aa: performance.now() - this.u };
    Mh(this, t2);
    var e2 = new dh();
    e2 = Ir(e2, 0, 2, t2 = Oh(this, t2)), Nh(this, e2 = Fr(t2 = gh(ph(new mh(), this.C), 2), 5, vh, e2));
  }
  close() {
    var t2 = this.l;
    "function" == typeof t2.close ? t2.close() : t2.flush();
  }
};
function Ph() {
  var t2 = navigator;
  return "undefined" != typeof OffscreenCanvas && (!(function(t3 = navigator) {
    return (t3 = t3.userAgent).includes("Safari") && !t3.includes("Chrome");
  })(t2) || !!((t2 = t2.userAgent.match(/Version\/([\d]+).*Safari/)) && t2.length >= 1 && Number(t2[1]) >= 17));
}
async function $h(t2) {
  if ("function" != typeof importScripts) {
    let e2 = document.createElement("script");
    return e2.src = t2.toString(), e2.crossOrigin = "anonymous", new Promise((t3, r2) => {
      e2.addEventListener("load", () => {
        t3();
      }, false), e2.addEventListener("error", (t4) => {
        r2(t4);
      }, false), document.body.appendChild(e2);
    });
  }
  try {
    importScripts(t2.toString());
  } catch (e2) {
    if (!(e2 instanceof TypeError)) throw e2;
    {
      let e3 = self.import;
      e3 ? await e3(t2.toString()) : await import(t2.toString());
    }
  }
}
function Uh(t2) {
  return void 0 !== t2.videoWidth ? [t2.videoWidth, t2.videoHeight] : void 0 !== t2.naturalWidth ? [t2.naturalWidth, t2.naturalHeight] : void 0 !== t2.displayWidth ? [t2.displayWidth, t2.displayHeight] : [t2.width, t2.height];
}
function Bh(t2, e2, r2) {
  t2.m || console.error("No wasm multistream support detected: ensure dependency inclusion of :gl_graph_runner_internal_multi_input target"), r2(e2 = t2.i.stringToNewUTF8(e2)), t2.i._free(e2);
}
function Gh(t2, e2, r2) {
  if (!t2.i.canvas) throw Error("No OpenGL canvas configured.");
  if (r2 ? t2.i._bindTextureToStream(r2) : t2.i._bindTextureToCanvas(), !(r2 = t2.i.canvas.getContext("webgl2") || t2.i.canvas.getContext("webgl"))) throw Error("Failed to obtain WebGL context from the provided canvas. `getContext()` should only be invoked with `webgl` or `webgl2`.");
  t2.i.gpuOriginForWebTexturesIsBottomLeft && r2.pixelStorei(r2.UNPACK_FLIP_Y_WEBGL, true), r2.texImage2D(r2.TEXTURE_2D, 0, r2.RGBA, r2.RGBA, r2.UNSIGNED_BYTE, e2), t2.i.gpuOriginForWebTexturesIsBottomLeft && r2.pixelStorei(r2.UNPACK_FLIP_Y_WEBGL, false);
  var [n2, i2] = Uh(e2);
  return !t2.j || n2 === t2.i.canvas.width && i2 === t2.i.canvas.height || (t2.i.canvas.width = n2, t2.i.canvas.height = i2), [n2, i2];
}
function jh(t2, e2, r2) {
  t2.m || console.error("No wasm multistream support detected: ensure dependency inclusion of :gl_graph_runner_internal_multi_input target");
  var n2 = new Uint32Array(e2.length);
  for (let r3 = 0; r3 < e2.length; r3++) n2[r3] = t2.i.stringToNewUTF8(e2[r3]);
  e2 = t2.i._malloc(4 * n2.length), t2.i.HEAPU32.set(n2, e2 >> 2), r2(e2);
  for (let e3 of n2) t2.i._free(e3);
  t2.i._free(e2);
}
function Vh(t2, e2, r2) {
  t2.i.simpleListeners = t2.i.simpleListeners || {}, t2.i.simpleListeners[e2] = r2;
}
function Hh(t2, e2, r2) {
  var n2 = [];
  t2.i.simpleListeners = t2.i.simpleListeners || {}, t2.i.simpleListeners[e2] = (t3, e3, i2) => {
    e3 ? (r2(n2, i2), n2 = []) : n2.push(t3);
  };
}
var Kh = class {
  constructor(t2, e2) {
    this.j = true, this.i = t2, this.g = null, this.h = 0, this.m = "function" == typeof this.i._addIntToInputStream, void 0 !== e2 ? this.i.canvas = e2 : Ph() ? this.i.canvas = new OffscreenCanvas(1, 1) : (console.warn("OffscreenCanvas not supported and GraphRunner constructor glCanvas parameter is undefined. Creating backup canvas."), this.i.canvas = document.createElement("canvas"));
  }
  async initializeGraph(t2) {
    var e2 = await (await fetch(t2)).arrayBuffer();
    t2 = !(t2.endsWith(".pbtxt") || t2.endsWith(".textproto")), this.setGraph(new Uint8Array(e2), t2);
  }
  setGraphFromString(t2) {
    this.setGraph(new TextEncoder().encode(t2), false);
  }
  setGraph(t2, e2) {
    var r2 = t2.length, n2 = this.i._malloc(r2);
    this.i.HEAPU8.set(t2, n2), e2 ? this.i._changeBinaryGraph(r2, n2) : this.i._changeTextGraph(r2, n2), this.i._free(n2);
  }
  configureAudio(t2, e2, r2, n2, i2) {
    this.i._configureAudio || console.warn('Attempting to use configureAudio without support for input audio. Is build dep ":gl_graph_runner_audio" missing?'), Bh(this, n2 || "input_audio", (n3) => {
      Bh(this, i2 = i2 || "audio_header", (i3) => {
        this.i._configureAudio(n3, i3, t2, e2 ?? 0, r2);
      });
    });
  }
  setAutoResizeCanvas(t2) {
    this.j = t2;
  }
  setAutoRenderToScreen(t2) {
    this.i._setAutoRenderToScreen(t2);
  }
  setGpuBufferVerticalFlip(t2) {
    this.i.gpuOriginForWebTexturesIsBottomLeft = t2;
  }
  ja(t2) {
    Vh(this, "__graph_config__", (e2) => {
      t2(e2);
    }), Bh(this, "__graph_config__", (t3) => {
      this.i._getGraphConfig(t3, void 0);
    }), delete this.i.simpleListeners.__graph_config__;
  }
  attachErrorListener(t2) {
    this.i.errorListener = t2;
  }
  attachEmptyPacketListener(t2, e2) {
    this.i.emptyPacketListeners = this.i.emptyPacketListeners || {}, this.i.emptyPacketListeners[t2] = e2;
  }
  addAudioToStream(t2, e2, r2) {
    this.addAudioToStreamWithShape(t2, 0, 0, e2, r2);
  }
  addAudioToStreamWithShape(t2, e2, r2, n2, i2) {
    var s2 = 4 * t2.length;
    this.h !== s2 && (this.g && this.i._free(this.g), this.g = this.i._malloc(s2), this.h = s2), this.i.HEAPF32.set(t2, this.g / 4), Bh(this, n2, (t3) => {
      this.i._addAudioToInputStream(this.g, e2, r2, t3, i2);
    });
  }
  addGpuBufferToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var [n2, i2] = Gh(this, t2, e3);
      this.i._addBoundTextureToStream(e3, n2, i2, r2);
    });
  }
  addBoolToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      this.i._addBoolToInputStream(t2, e3, r2);
    });
  }
  addDoubleToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      this.i._addDoubleToInputStream(t2, e3, r2);
    });
  }
  addFloatToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      this.i._addFloatToInputStream(t2, e3, r2);
    });
  }
  addIntToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      this.i._addIntToInputStream(t2, e3, r2);
    });
  }
  addUintToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      this.i._addUintToInputStream(t2, e3, r2);
    });
  }
  addStringToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      Bh(this, t2, (t3) => {
        this.i._addStringToInputStream(t3, e3, r2);
      });
    });
  }
  addStringRecordToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      jh(this, Object.keys(t2), (n2) => {
        jh(this, Object.values(t2), (i2) => {
          this.i._addFlatHashMapToInputStream(n2, i2, Object.keys(t2).length, e3, r2);
        });
      });
    });
  }
  addProtoToStream(t2, e2, r2, n2) {
    Bh(this, r2, (r3) => {
      Bh(this, e2, (e3) => {
        var i2 = this.i._malloc(t2.length);
        this.i.HEAPU8.set(t2, i2), this.i._addProtoToInputStream(i2, t2.length, e3, r3, n2), this.i._free(i2);
      });
    });
  }
  addEmptyPacketToStream(t2, e2) {
    Bh(this, t2, (t3) => {
      this.i._addEmptyPacketToInputStream(t3, e2);
    });
  }
  addBoolVectorToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var n2 = this.i._allocateBoolVector(t2.length);
      if (!n2) throw Error("Unable to allocate new bool vector on heap.");
      for (let e4 of t2) this.i._addBoolVectorEntry(n2, e4);
      this.i._addBoolVectorToInputStream(n2, e3, r2);
    });
  }
  addDoubleVectorToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var n2 = this.i._allocateDoubleVector(t2.length);
      if (!n2) throw Error("Unable to allocate new double vector on heap.");
      for (let e4 of t2) this.i._addDoubleVectorEntry(n2, e4);
      this.i._addDoubleVectorToInputStream(n2, e3, r2);
    });
  }
  addFloatVectorToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var n2 = this.i._allocateFloatVector(t2.length);
      if (!n2) throw Error("Unable to allocate new float vector on heap.");
      for (let e4 of t2) this.i._addFloatVectorEntry(n2, e4);
      this.i._addFloatVectorToInputStream(n2, e3, r2);
    });
  }
  addIntVectorToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var n2 = this.i._allocateIntVector(t2.length);
      if (!n2) throw Error("Unable to allocate new int vector on heap.");
      for (let e4 of t2) this.i._addIntVectorEntry(n2, e4);
      this.i._addIntVectorToInputStream(n2, e3, r2);
    });
  }
  addUintVectorToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var n2 = this.i._allocateUintVector(t2.length);
      if (!n2) throw Error("Unable to allocate new unsigned int vector on heap.");
      for (let e4 of t2) this.i._addUintVectorEntry(n2, e4);
      this.i._addUintVectorToInputStream(n2, e3, r2);
    });
  }
  addStringVectorToStream(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var n2 = this.i._allocateStringVector(t2.length);
      if (!n2) throw Error("Unable to allocate new string vector on heap.");
      for (let e4 of t2) Bh(this, e4, (t3) => {
        this.i._addStringVectorEntry(n2, t3);
      });
      this.i._addStringVectorToInputStream(n2, e3, r2);
    });
  }
  addBoolToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      this.i._addBoolToInputSidePacket(t2, e3);
    });
  }
  addDoubleToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      this.i._addDoubleToInputSidePacket(t2, e3);
    });
  }
  addFloatToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      this.i._addFloatToInputSidePacket(t2, e3);
    });
  }
  addIntToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      this.i._addIntToInputSidePacket(t2, e3);
    });
  }
  addUintToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      this.i._addUintToInputSidePacket(t2, e3);
    });
  }
  addStringToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      Bh(this, t2, (t3) => {
        this.i._addStringToInputSidePacket(t3, e3);
      });
    });
  }
  addProtoToInputSidePacket(t2, e2, r2) {
    Bh(this, r2, (r3) => {
      Bh(this, e2, (e3) => {
        var n2 = this.i._malloc(t2.length);
        this.i.HEAPU8.set(t2, n2), this.i._addProtoToInputSidePacket(n2, t2.length, e3, r3), this.i._free(n2);
      });
    });
  }
  addBoolVectorToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      var r2 = this.i._allocateBoolVector(t2.length);
      if (!r2) throw Error("Unable to allocate new bool vector on heap.");
      for (let e4 of t2) this.i._addBoolVectorEntry(r2, e4);
      this.i._addBoolVectorToInputSidePacket(r2, e3);
    });
  }
  addDoubleVectorToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      var r2 = this.i._allocateDoubleVector(t2.length);
      if (!r2) throw Error("Unable to allocate new double vector on heap.");
      for (let e4 of t2) this.i._addDoubleVectorEntry(r2, e4);
      this.i._addDoubleVectorToInputSidePacket(r2, e3);
    });
  }
  addFloatVectorToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      var r2 = this.i._allocateFloatVector(t2.length);
      if (!r2) throw Error("Unable to allocate new float vector on heap.");
      for (let e4 of t2) this.i._addFloatVectorEntry(r2, e4);
      this.i._addFloatVectorToInputSidePacket(r2, e3);
    });
  }
  addIntVectorToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      var r2 = this.i._allocateIntVector(t2.length);
      if (!r2) throw Error("Unable to allocate new int vector on heap.");
      for (let e4 of t2) this.i._addIntVectorEntry(r2, e4);
      this.i._addIntVectorToInputSidePacket(r2, e3);
    });
  }
  addUintVectorToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      var r2 = this.i._allocateUintVector(t2.length);
      if (!r2) throw Error("Unable to allocate new unsigned int vector on heap.");
      for (let e4 of t2) this.i._addUintVectorEntry(r2, e4);
      this.i._addUintVectorToInputSidePacket(r2, e3);
    });
  }
  addStringVectorToInputSidePacket(t2, e2) {
    Bh(this, e2, (e3) => {
      var r2 = this.i._allocateStringVector(t2.length);
      if (!r2) throw Error("Unable to allocate new string vector on heap.");
      for (let e4 of t2) Bh(this, e4, (t3) => {
        this.i._addStringVectorEntry(r2, t3);
      });
      this.i._addStringVectorToInputSidePacket(r2, e3);
    });
  }
  attachBoolListener(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachBoolListener(t3);
    });
  }
  attachBoolVectorListener(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachBoolVectorListener(t3);
    });
  }
  attachIntListener(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachIntListener(t3);
    });
  }
  attachIntVectorListener(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachIntVectorListener(t3);
    });
  }
  attachUintListener(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachUintListener(t3);
    });
  }
  attachUintVectorListener(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachUintVectorListener(t3);
    });
  }
  attachDoubleListener(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachDoubleListener(t3);
    });
  }
  attachDoubleVectorListener(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachDoubleVectorListener(t3);
    });
  }
  attachFloatListener(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachFloatListener(t3);
    });
  }
  attachFloatVectorListener(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachFloatVectorListener(t3);
    });
  }
  attachStringListener(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachStringListener(t3);
    });
  }
  attachStringVectorListener(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachStringVectorListener(t3);
    });
  }
  attachProtoListener(t2, e2, r2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachProtoListener(t3, r2 || false);
    });
  }
  attachProtoVectorListener(t2, e2, r2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.i._attachProtoVectorListener(t3, r2 || false);
    });
  }
  attachAudioListener(t2, e2, r2) {
    this.i._attachAudioListener || console.warn('Attempting to use attachAudioListener without support for output audio. Is build dep ":gl_graph_runner_audio_out" missing?'), Vh(this, t2, (t3, r3) => {
      t3 = new Float32Array(t3.buffer, t3.byteOffset, t3.length / 4), e2(t3, r3);
    }), Bh(this, t2, (t3) => {
      this.i._attachAudioListener(t3, r2 || false);
    });
  }
  finishProcessing() {
    this.i._waitUntilIdle();
  }
  closeGraph() {
    this.i._closeGraph(), this.i.simpleListeners = void 0, this.i.emptyPacketListeners = void 0;
  }
};
function Xh(t2) {
  return class extends t2 {
    get pa() {
      return this.i;
    }
    Sa() {
      if ("function" == typeof this.pa._mediapipeLoggerGetEncodedApiKey) {
        let t3 = this.pa._mediapipeLoggerGetEncodedApiKey();
        return this.pa._decodeBase64(t3);
      }
    }
  };
}
function Wh(t2) {
  return class extends t2 {
    Za() {
      this.i._registerModelResourcesGraphService();
    }
  };
}
var zh = Xh(Wh(Kh));
var Yh = class extends zh {
};
async function qh(t2, e2, r2, n2) {
  return t2 = await (async (t3, e3, r3, n3, i2) => {
    if (e3 && await $h(e3), !self.ModuleFactory) throw Error("ModuleFactory not set.");
    if (r3 && (await $h(r3), !self.ModuleFactory)) throw Error("ModuleFactory not set.");
    return self.Module && i2 && ((e3 = self.Module).locateFile = i2.locateFile, i2.mainScriptUrlOrBlob && (e3.mainScriptUrlOrBlob = i2.mainScriptUrlOrBlob)), i2 = await self.ModuleFactory(self.Module || i2), self.ModuleFactory = self.Module = void 0, new t3(i2, n3);
  })(t2, r2.wasmLoaderPath, r2.assetLoaderPath, e2, { locateFile: (t3) => t3.endsWith(".wasm") ? r2.wasmBinaryPath.toString() : r2.assetBinaryPath && t3.endsWith(".data") ? r2.assetBinaryPath.toString() : t3 }), (function(t3, e3) {
    e3 = e3.runningMode ?? "";
    var r3 = t3.g.Sa();
    t3.m = new Dh(t3.C(), e3, r3);
  })(t2, n2), await t2.v(n2), t2;
}
async function Jh(t2, e2, r2, n2) {
  return qh(t2, e2, r2, n2);
}
function Zh(t2, e2) {
  var r2 = Sr(t2.baseOptions, Wo, 1) || new Wo();
  "string" == typeof e2 ? (ar(r2, 2, ve(e2)), ar(r2, 1)) : e2 instanceof Uint8Array && (ar(r2, 1, ct(e2, false)), ar(r2, 2)), Ir(t2.baseOptions, 0, 1, r2);
}
function Qh(t2) {
  try {
    let e2 = t2.K.length;
    if (1 === e2) throw Error(t2.K[0].message);
    if (e2 > 1) throw Error("Encountered multiple errors: " + t2.K.map((t3) => t3.message).join(", "));
  } finally {
    t2.K = [];
  }
}
function tu(t2, e2) {
  t2.I = Math.max(t2.I, e2);
}
function eu(t2, e2) {
  t2.D = new ho(), Hr(t2.D, 2, "PassThroughCalculator"), oo(t2.D, "free_memory"), ao(t2.D, "free_memory_unused_out"), po(e2, "free_memory"), fo(e2, t2.D);
}
function ru(t2, e2) {
  oo(t2.D, e2), ao(t2.D, e2 + "_unused_out");
}
function nu(t2) {
  t2.g.addBoolToStream(true, "free_memory", t2.I);
}
var iu = class {
  constructor(t2) {
    this.g = t2, this.K = [], this.I = 0, this.g.setAutoRenderToScreen(false);
  }
  j(t2, e2 = true) {
    if (e2) {
      let e3 = t2.baseOptions || {};
      if (t2.baseOptions?.modelAssetBuffer && t2.baseOptions?.modelAssetPath) throw Error("Cannot set both baseOptions.modelAssetPath and baseOptions.modelAssetBuffer");
      if (!(Sr(this.baseOptions, Wo, 1)?.g() || Sr(this.baseOptions, Wo, 1)?.j() || t2.baseOptions?.modelAssetBuffer || t2.baseOptions?.modelAssetPath)) throw Error("Either baseOptions.modelAssetPath or baseOptions.modelAssetBuffer must be set");
      if ((function(t3, e4) {
        var r2 = Sr(t3.baseOptions, Ko, 3);
        if (!r2) {
          var n2 = r2 = new Ko(), i2 = new Qs();
          Fr(n2, 4, Xo, i2);
        }
        "delegate" in e4 && ("GPU" === e4.delegate ? (e4 = r2, n2 = new Ys(), Fr(e4, 2, Xo, n2)) : (e4 = r2, n2 = new Qs(), Fr(e4, 4, Xo, n2))), Ir(t3.baseOptions, 0, 3, r2);
      })(this, e3), e3.modelAssetPath) return fetch(e3.modelAssetPath.toString()).then((t3) => {
        if (t3.ok) return t3.arrayBuffer();
        throw Error(`Failed to fetch model: ${e3.modelAssetPath} (${t3.status})`);
      }).then((t3) => {
        try {
          this.g.i.FS_unlink("/model.dat");
        } catch {
        }
        this.g.i.FS_createDataFile("/", "model.dat", new Uint8Array(t3), true, false, false), Zh(this, "/model.dat"), this.o(), this.L();
      });
      if (e3.modelAssetBuffer instanceof Uint8Array) Zh(this, e3.modelAssetBuffer);
      else if (e3.modelAssetBuffer) return (async function(t3) {
        for (var e4 = [], r2 = 0; ; ) {
          let { done: n2, value: i2 } = await t3.read();
          if (n2) break;
          e4.push(i2), r2 += i2.length;
        }
        if (0 === e4.length) return new Uint8Array(0);
        if (1 === e4.length) return e4[0];
        t3 = new Uint8Array(r2), r2 = 0;
        for (let n2 of e4) t3.set(n2, r2), r2 += n2.length;
        return t3;
      })(e3.modelAssetBuffer).then((t3) => {
        Zh(this, t3), this.o(), this.L();
      });
    }
    return this.o(), this.L(), Promise.resolve();
  }
  L() {
  }
  ja() {
    var t2;
    if (this.g.ja((e2) => {
      t2 = _o(e2);
    }), !t2) throw Error("Failed to retrieve CalculatorGraphConfig");
    return t2;
  }
  setGraph(t2, e2) {
    this.g.attachErrorListener((t3, e3) => {
      this.K.push(Error(e3));
    }), this.g.Za(), this.g.setGraph(t2, e2), this.m?.ya(), this.D = void 0, Qh(this);
  }
  finishProcessing(t2) {
    this.g.finishProcessing(), Qh(this), this.m && void 0 !== t2 && this.m.za(t2);
  }
  close() {
    this.D = void 0, this.m?.xa(), this.m?.close(), this.g.closeGraph();
  }
};
function su(t2, e2) {
  if (!t2) throw Error(`Unable to obtain required WebGL resource: ${e2}`);
  return t2;
}
iu.prototype.close = iu.prototype.close;
var ou = class {
  constructor(t2, e2, r2, n2) {
    this.g = t2, this.h = e2, this.m = r2, this.j = n2;
  }
  bind() {
    this.g.bindVertexArray(this.h);
  }
  close() {
    this.g.deleteVertexArray(this.h), this.g.deleteBuffer(this.m), this.g.deleteBuffer(this.j);
  }
};
function au(t2, e2, r2) {
  var n2 = t2.g;
  if (r2 = su(n2.createShader(r2), "Failed to create WebGL shader"), n2.shaderSource(r2, e2), n2.compileShader(r2), !n2.getShaderParameter(r2, n2.COMPILE_STATUS)) throw Error(`Could not compile WebGL shader: ${n2.getShaderInfoLog(r2)}`);
  return n2.attachShader(t2.h, r2), r2;
}
function hu(t2, e2) {
  var r2 = t2.g, n2 = su(r2.createVertexArray(), "Failed to create vertex array");
  r2.bindVertexArray(n2);
  var i2 = su(r2.createBuffer(), "Failed to create buffer");
  r2.bindBuffer(r2.ARRAY_BUFFER, i2), r2.enableVertexAttribArray(t2.F), r2.vertexAttribPointer(t2.F, 2, r2.FLOAT, false, 0, 0), r2.bufferData(r2.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), r2.STATIC_DRAW);
  var s2 = su(r2.createBuffer(), "Failed to create buffer");
  return r2.bindBuffer(r2.ARRAY_BUFFER, s2), r2.enableVertexAttribArray(t2.K), r2.vertexAttribPointer(t2.K, 2, r2.FLOAT, false, 0, 0), r2.bufferData(r2.ARRAY_BUFFER, new Float32Array(e2 ? [0, 1, 0, 0, 1, 0, 1, 1] : [0, 0, 0, 1, 1, 1, 1, 0]), r2.STATIC_DRAW), r2.bindBuffer(r2.ARRAY_BUFFER, null), r2.bindVertexArray(null), new ou(r2, n2, i2, s2);
}
function uu(t2, e2) {
  if (t2.g) {
    if (e2 !== t2.g) throw Error("Cannot change GL context once initialized");
  } else t2.g = e2;
}
function cu(t2, e2, r2, n2) {
  return uu(t2, e2), t2.h || (t2.m(), t2.I()), r2 ? (t2.l || (t2.l = hu(t2, true)), r2 = t2.l) : (t2.D || (t2.D = hu(t2, false)), r2 = t2.D), e2.useProgram(t2.h), r2.bind(), t2.j(), t2 = n2(), r2.g.bindVertexArray(null), t2;
}
function lu(t2, e2, r2) {
  return uu(t2, e2), t2 = su(e2.createTexture(), "Failed to create texture"), e2.bindTexture(e2.TEXTURE_2D, t2), e2.texParameteri(e2.TEXTURE_2D, e2.TEXTURE_WRAP_S, e2.CLAMP_TO_EDGE), e2.texParameteri(e2.TEXTURE_2D, e2.TEXTURE_WRAP_T, e2.CLAMP_TO_EDGE), e2.texParameteri(e2.TEXTURE_2D, e2.TEXTURE_MIN_FILTER, r2 ?? e2.LINEAR), e2.texParameteri(e2.TEXTURE_2D, e2.TEXTURE_MAG_FILTER, r2 ?? e2.LINEAR), e2.bindTexture(e2.TEXTURE_2D, null), t2;
}
function du(t2, e2, r2) {
  uu(t2, e2), t2.C || (t2.C = su(e2.createFramebuffer(), "Failed to create framebuffe.")), e2.bindFramebuffer(e2.FRAMEBUFFER, t2.C), e2.framebufferTexture2D(e2.FRAMEBUFFER, e2.COLOR_ATTACHMENT0, e2.TEXTURE_2D, r2, 0);
}
function fu(t2) {
  t2.g?.bindFramebuffer(t2.g.FRAMEBUFFER, null);
}
var pu = class {
  B() {
    return "\n  precision mediump float;\n  varying vec2 vTex;\n  uniform sampler2D inputTexture;\n  void main() {\n    gl_FragColor = texture2D(inputTexture, vTex);\n  }\n ";
  }
  m() {
    var t2 = this.g;
    if (this.h = su(t2.createProgram(), "Failed to create WebGL program"), this.da = au(this, "\n  attribute vec2 aVertex;\n  attribute vec2 aTex;\n  varying vec2 vTex;\n  void main(void) {\n    gl_Position = vec4(aVertex, 0.0, 1.0);\n    vTex = aTex;\n  }", t2.VERTEX_SHADER), this.Z = au(this, this.B(), t2.FRAGMENT_SHADER), t2.linkProgram(this.h), !t2.getProgramParameter(this.h, t2.LINK_STATUS)) throw Error(`Error during program linking: ${t2.getProgramInfoLog(this.h)}`);
    this.F = t2.getAttribLocation(this.h, "aVertex"), this.K = t2.getAttribLocation(this.h, "aTex");
  }
  I() {
  }
  j() {
  }
  close() {
    if (this.h) {
      let t2 = this.g;
      t2.deleteProgram(this.h), t2.deleteShader(this.da), t2.deleteShader(this.Z);
    }
    this.C && this.g.deleteFramebuffer(this.C), this.D && this.D.close(), this.l && this.l.close();
  }
};
var gu = class extends pu {
  B() {
    return "\n  precision mediump float;\n  uniform sampler2D backgroundTexture;\n  uniform sampler2D maskTexture;\n  uniform sampler2D colorMappingTexture;\n  varying vec2 vTex;\n  void main() {\n    vec4 backgroundColor = texture2D(backgroundTexture, vTex);\n    float category = texture2D(maskTexture, vTex).r;\n    vec4 categoryColor = texture2D(colorMappingTexture, vec2(category, 0.0));\n    gl_FragColor = mix(backgroundColor, categoryColor, categoryColor.a);\n  }\n ";
  }
  I() {
    var t2 = this.g;
    t2.activeTexture(t2.TEXTURE1), this.u = lu(this, t2, t2.LINEAR), t2.activeTexture(t2.TEXTURE2), this.o = lu(this, t2, t2.NEAREST);
  }
  m() {
    super.m();
    var t2 = this.g;
    this.O = su(t2.getUniformLocation(this.h, "backgroundTexture"), "Uniform location"), this.Y = su(t2.getUniformLocation(this.h, "colorMappingTexture"), "Uniform location"), this.L = su(t2.getUniformLocation(this.h, "maskTexture"), "Uniform location");
  }
  j() {
    super.j();
    var t2 = this.g;
    t2.uniform1i(this.L, 0), t2.uniform1i(this.O, 1), t2.uniform1i(this.Y, 2);
  }
  close() {
    this.u && this.g.deleteTexture(this.u), this.o && this.g.deleteTexture(this.o), super.close();
  }
};
var mu = class extends pu {
  B() {
    return "\n  precision mediump float;\n  uniform sampler2D maskTexture;\n  uniform sampler2D defaultTexture;\n  uniform sampler2D overlayTexture;\n  varying vec2 vTex;\n  void main() {\n    float confidence = texture2D(maskTexture, vTex).r;\n    vec4 defaultColor = texture2D(defaultTexture, vTex);\n    vec4 overlayColor = texture2D(overlayTexture, vTex);\n    // Apply the alpha from the overlay and merge in the default color\n    overlayColor = mix(defaultColor, overlayColor, overlayColor.a);\n    gl_FragColor = mix(defaultColor, overlayColor, confidence);\n  }\n ";
  }
  I() {
    var t2 = this.g;
    t2.activeTexture(t2.TEXTURE1), this.o = lu(this, t2), t2.activeTexture(t2.TEXTURE2), this.u = lu(this, t2);
  }
  m() {
    super.m();
    var t2 = this.g;
    this.L = su(t2.getUniformLocation(this.h, "defaultTexture"), "Uniform location"), this.O = su(t2.getUniformLocation(this.h, "overlayTexture"), "Uniform location"), this.J = su(t2.getUniformLocation(this.h, "maskTexture"), "Uniform location");
  }
  j() {
    super.j();
    var t2 = this.g;
    t2.uniform1i(this.J, 0), t2.uniform1i(this.L, 1), t2.uniform1i(this.O, 2);
  }
  close() {
    this.o && this.g.deleteTexture(this.o), this.u && this.g.deleteTexture(this.u), super.close();
  }
};
function vu(t2, e2) {
  switch (e2) {
    case 0:
      return t2.g.find((t3) => t3 instanceof Uint8Array);
    case 1:
      return t2.g.find((t3) => t3 instanceof Float32Array);
    case 2:
      return t2.g.find((t3) => "undefined" != typeof WebGLTexture && t3 instanceof WebGLTexture);
    default:
      throw Error(`Type is not supported: ${e2}`);
  }
}
function _u(t2) {
  var e2 = vu(t2, 1);
  if (!e2) {
    if (e2 = vu(t2, 0)) e2 = new Float32Array(e2).map((t3) => t3 / 255);
    else {
      e2 = new Float32Array(t2.width * t2.height);
      let n2 = Eu(t2);
      var r2 = wu(t2);
      if (du(r2, n2, yu(t2)), "iPad Simulator;iPhone Simulator;iPod Simulator;iPad;iPhone;iPod".split(";").includes(navigator.platform) || navigator.userAgent.includes("Mac") && "document" in self && "ontouchend" in self.document) {
        r2 = new Float32Array(t2.width * t2.height * 4), n2.readPixels(0, 0, t2.width, t2.height, n2.RGBA, n2.FLOAT, r2);
        for (let t3 = 0, n3 = 0; t3 < e2.length; ++t3, n3 += 4) e2[t3] = r2[n3];
      } else n2.readPixels(0, 0, t2.width, t2.height, n2.RED, n2.FLOAT, e2);
    }
    t2.g.push(e2);
  }
  return e2;
}
function yu(t2) {
  var e2 = vu(t2, 2);
  if (!e2) {
    let r2 = Eu(t2);
    e2 = bu(t2);
    let n2 = _u(t2), i2 = Au(t2);
    r2.texImage2D(r2.TEXTURE_2D, 0, i2, t2.width, t2.height, 0, r2.RED, r2.FLOAT, n2), Tu(t2);
  }
  return e2;
}
function Eu(t2) {
  if (!t2.canvas) throw Error("Conversion to different image formats require that a canvas is passed when initializing the image.");
  return t2.h || (t2.h = su(t2.canvas.getContext("webgl2"), "You cannot use a canvas that is already bound to a different type of rendering context.")), t2.h;
}
function Au(t2) {
  if (t2 = Eu(t2), !ku) if (t2.getExtension("EXT_color_buffer_float") && t2.getExtension("OES_texture_float_linear") && t2.getExtension("EXT_float_blend")) ku = t2.R32F;
  else {
    if (!t2.getExtension("EXT_color_buffer_half_float")) throw Error("GPU does not fully support 4-channel float32 or float16 formats");
    ku = t2.R16F;
  }
  return ku;
}
function wu(t2) {
  return t2.j || (t2.j = new pu()), t2.j;
}
function bu(t2) {
  var e2 = Eu(t2);
  e2.viewport(0, 0, t2.width, t2.height), e2.activeTexture(e2.TEXTURE0);
  var r2 = vu(t2, 2);
  return r2 || (r2 = lu(wu(t2), e2, t2.m ? e2.LINEAR : e2.NEAREST), t2.g.push(r2), t2.o = true), e2.bindTexture(e2.TEXTURE_2D, r2), r2;
}
function Tu(t2) {
  t2.h.bindTexture(t2.h.TEXTURE_2D, null);
}
var ku;
var Su = class {
  constructor(t2, e2, r2, n2, i2, s2, o2) {
    this.g = t2, this.m = e2, this.o = r2, this.canvas = n2, this.j = i2, this.width = s2, this.height = o2, this.o && (0 === --Lu && console.error("You seem to be creating MPMask instances without invoking .close(). This leaks resources."));
  }
  Ua() {
    return !!vu(this, 0);
  }
  ua() {
    return !!vu(this, 1);
  }
  W() {
    return !!vu(this, 2);
  }
  ta() {
    return (e2 = vu(t2 = this, 0)) || (e2 = _u(t2), e2 = new Uint8Array(e2.map((t3) => Math.round(255 * t3))), t2.g.push(e2)), e2;
    var t2, e2;
  }
  sa() {
    return _u(this);
  }
  S() {
    return yu(this);
  }
  clone() {
    var t2 = [];
    for (let e2 of this.g) {
      let r2;
      if (e2 instanceof Uint8Array) r2 = new Uint8Array(e2);
      else if (e2 instanceof Float32Array) r2 = new Float32Array(e2);
      else {
        if (!(e2 instanceof WebGLTexture)) throw Error(`Type is not supported: ${e2}`);
        {
          let t3 = Eu(this), e3 = wu(this);
          t3.activeTexture(t3.TEXTURE1), r2 = lu(e3, t3, this.m ? t3.LINEAR : t3.NEAREST), t3.bindTexture(t3.TEXTURE_2D, r2);
          let n2 = Au(this);
          t3.texImage2D(t3.TEXTURE_2D, 0, n2, this.width, this.height, 0, t3.RED, t3.FLOAT, null), t3.bindTexture(t3.TEXTURE_2D, null), du(e3, t3, r2), cu(e3, t3, false, () => {
            bu(this), t3.clearColor(0, 0, 0, 0), t3.clear(t3.COLOR_BUFFER_BIT), t3.drawArrays(t3.TRIANGLE_FAN, 0, 4), Tu(this);
          }), fu(e3), Tu(this);
        }
      }
      t2.push(r2);
    }
    return new Su(t2, this.m, this.W(), this.canvas, this.j, this.width, this.height);
  }
  close() {
    this.o && Eu(this).deleteTexture(vu(this, 2)), Lu = -1;
  }
};
Su.prototype.close = Su.prototype.close, Su.prototype.clone = Su.prototype.clone, Su.prototype.getAsWebGLTexture = Su.prototype.S, Su.prototype.getAsFloat32Array = Su.prototype.sa, Su.prototype.getAsUint8Array = Su.prototype.ta, Su.prototype.hasWebGLTexture = Su.prototype.W, Su.prototype.hasFloat32Array = Su.prototype.ua, Su.prototype.hasUint8Array = Su.prototype.Ua;
var Lu = 250;
var xu = { color: "white", lineWidth: 4, radius: 6 };
function Ru(t2) {
  return { ...xu, fillColor: (t2 = t2 || {}).color, ...t2 };
}
function Iu(t2, e2) {
  return t2 instanceof Function ? t2(e2) : t2;
}
function Fu(t2, e2, r2) {
  return Math.max(Math.min(e2, r2), Math.min(Math.max(e2, r2), t2));
}
function Cu(t2) {
  if (!t2.j) throw Error("CPU rendering requested but CanvasRenderingContext2D not provided.");
  return t2.j;
}
function Nu(t2) {
  if (!t2.o) throw Error("GPU rendering requested but WebGL2RenderingContext not provided.");
  return t2.o;
}
function Mu(t2, e2, r2) {
  if (e2.W()) r2(e2.S());
  else {
    let n2 = e2.ua() ? e2.sa() : e2.ta();
    t2.m = t2.m ?? new pu();
    let i2 = Nu(t2);
    r2((t2 = new Su([n2], e2.m, false, i2.canvas, t2.m, e2.width, e2.height)).S()), t2.close();
  }
}
function Ou(t2, e2, r2, n2) {
  var i2 = (function(t3) {
    return t3.g || (t3.g = new gu()), t3.g;
  })(t2), s2 = Nu(t2), o2 = Array.isArray(r2) ? new ImageData(new Uint8ClampedArray(r2), 1, 1) : r2;
  cu(i2, s2, true, () => {
    !(function(t4, e3, r3, n3) {
      var i3 = t4.g;
      if (i3.activeTexture(i3.TEXTURE0), i3.bindTexture(i3.TEXTURE_2D, e3), i3.activeTexture(i3.TEXTURE1), i3.bindTexture(i3.TEXTURE_2D, t4.u), i3.texImage2D(i3.TEXTURE_2D, 0, i3.RGBA, i3.RGBA, i3.UNSIGNED_BYTE, r3), t4.J && (function(t5, e4) {
        if (t5 !== e4) return false;
        t5 = t5.entries(), e4 = e4.entries();
        for (let [r4, n4] of t5) {
          t5 = r4;
          let i4 = n4, s3 = e4.next();
          if (s3.done) return false;
          let [o3, a2] = s3.value;
          if (t5 !== o3 || i4[0] !== a2[0] || i4[1] !== a2[1] || i4[2] !== a2[2] || i4[3] !== a2[3]) return false;
        }
        return !!e4.next().done;
      })(t4.J, n3)) i3.activeTexture(i3.TEXTURE2), i3.bindTexture(i3.TEXTURE_2D, t4.o);
      else {
        t4.J = n3;
        let e4 = Array(1024).fill(0);
        n3.forEach((t5, r4) => {
          if (4 !== t5.length) throw Error(`Color at index ${r4} is not a four-channel value.`);
          e4[4 * r4] = t5[0], e4[4 * r4 + 1] = t5[1], e4[4 * r4 + 2] = t5[2], e4[4 * r4 + 3] = t5[3];
        }), i3.activeTexture(i3.TEXTURE2), i3.bindTexture(i3.TEXTURE_2D, t4.o), i3.texImage2D(i3.TEXTURE_2D, 0, i3.RGBA, 256, 1, 0, i3.RGBA, i3.UNSIGNED_BYTE, new Uint8Array(e4));
      }
    })(i2, e2, o2, n2), s2.clearColor(0, 0, 0, 0), s2.clear(s2.COLOR_BUFFER_BIT), s2.drawArrays(s2.TRIANGLE_FAN, 0, 4);
    var t3 = i2.g;
    t3.activeTexture(t3.TEXTURE0), t3.bindTexture(t3.TEXTURE_2D, null), t3.activeTexture(t3.TEXTURE1), t3.bindTexture(t3.TEXTURE_2D, null), t3.activeTexture(t3.TEXTURE2), t3.bindTexture(t3.TEXTURE_2D, null);
  });
}
function Du(t2, e2, r2, n2) {
  var i2 = Nu(t2), s2 = (function(t3) {
    return t3.h || (t3.h = new mu()), t3.h;
  })(t2), o2 = Array.isArray(r2) ? new ImageData(new Uint8ClampedArray(r2), 1, 1) : r2, a2 = Array.isArray(n2) ? new ImageData(new Uint8ClampedArray(n2), 1, 1) : n2;
  cu(s2, i2, true, () => {
    var t3 = s2.g;
    t3.activeTexture(t3.TEXTURE0), t3.bindTexture(t3.TEXTURE_2D, e2), t3.activeTexture(t3.TEXTURE1), t3.bindTexture(t3.TEXTURE_2D, s2.o), t3.texImage2D(t3.TEXTURE_2D, 0, t3.RGBA, t3.RGBA, t3.UNSIGNED_BYTE, o2), t3.activeTexture(t3.TEXTURE2), t3.bindTexture(t3.TEXTURE_2D, s2.u), t3.texImage2D(t3.TEXTURE_2D, 0, t3.RGBA, t3.RGBA, t3.UNSIGNED_BYTE, a2), i2.clearColor(0, 0, 0, 0), i2.clear(i2.COLOR_BUFFER_BIT), i2.drawArrays(i2.TRIANGLE_FAN, 0, 4), i2.bindTexture(i2.TEXTURE_2D, null), (t3 = s2.g).activeTexture(t3.TEXTURE0), t3.bindTexture(t3.TEXTURE_2D, null), t3.activeTexture(t3.TEXTURE1), t3.bindTexture(t3.TEXTURE_2D, null), t3.activeTexture(t3.TEXTURE2), t3.bindTexture(t3.TEXTURE_2D, null);
  });
}
var Pu = class {
  constructor(t2, e2) {
    "undefined" != typeof CanvasRenderingContext2D && t2 instanceof CanvasRenderingContext2D || t2 instanceof OffscreenCanvasRenderingContext2D ? (this.j = t2, this.o = e2) : this.o = t2;
  }
  Ma(t2, e2) {
    if (t2) {
      var r2 = Cu(this);
      e2 = Ru(e2), r2.save();
      var n2 = r2.canvas, i2 = 0;
      for (let s2 of t2) r2.fillStyle = Iu(e2.fillColor, { index: i2, from: s2 }), r2.strokeStyle = Iu(e2.color, { index: i2, from: s2 }), r2.lineWidth = Iu(e2.lineWidth, { index: i2, from: s2 }), (t2 = new Path2D()).arc(s2.x * n2.width, s2.y * n2.height, Iu(e2.radius, { index: i2, from: s2 }), 0, 2 * Math.PI), r2.fill(t2), r2.stroke(t2), ++i2;
      r2.restore();
    }
  }
  La(t2, e2, r2) {
    if (t2 && e2) {
      var n2 = Cu(this);
      r2 = Ru(r2), n2.save();
      var i2 = n2.canvas, s2 = 0;
      for (let o2 of e2) {
        n2.beginPath(), e2 = t2[o2.start];
        let a2 = t2[o2.end];
        e2 && a2 && (n2.strokeStyle = Iu(r2.color, { index: s2, from: e2, to: a2 }), n2.lineWidth = Iu(r2.lineWidth, { index: s2, from: e2, to: a2 }), n2.moveTo(e2.x * i2.width, e2.y * i2.height), n2.lineTo(a2.x * i2.width, a2.y * i2.height)), ++s2, n2.stroke();
      }
      n2.restore();
    }
  }
  Ia(t2, e2) {
    var r2 = Cu(this);
    e2 = Ru(e2), r2.save(), r2.beginPath(), r2.lineWidth = Iu(e2.lineWidth, {}), r2.strokeStyle = Iu(e2.color, {}), r2.fillStyle = Iu(e2.fillColor, {}), r2.moveTo(t2.originX, t2.originY), r2.lineTo(t2.originX + t2.width, t2.originY), r2.lineTo(t2.originX + t2.width, t2.originY + t2.height), r2.lineTo(t2.originX, t2.originY + t2.height), r2.lineTo(t2.originX, t2.originY), r2.stroke(), r2.fill(), r2.restore();
  }
  Ja(t2, e2, r2 = [0, 0, 0, 255]) {
    this.j ? (function(t3, e3, r3, n2) {
      var i2 = Nu(t3);
      Mu(t3, e3, (e4) => {
        Ou(t3, e4, r3, n2), (e4 = Cu(t3)).drawImage(i2.canvas, 0, 0, e4.canvas.width, e4.canvas.height);
      });
    })(this, t2, r2, e2) : Ou(this, t2.S(), r2, e2);
  }
  Ka(t2, e2, r2) {
    this.j ? (function(t3, e3, r3, n2) {
      var i2 = Nu(t3);
      Mu(t3, e3, (e4) => {
        Du(t3, e4, r3, n2), (e4 = Cu(t3)).drawImage(i2.canvas, 0, 0, e4.canvas.width, e4.canvas.height);
      });
    })(this, t2, e2, r2) : Du(this, t2.S(), e2, r2);
  }
  close() {
    this.g?.close(), this.g = void 0, this.h?.close(), this.h = void 0, this.m?.close(), this.m = void 0;
  }
};
function $u(t2, e2) {
  switch (e2) {
    case 0:
      return t2.g.find((t3) => t3 instanceof ImageData);
    case 1:
      return t2.g.find((t3) => "undefined" != typeof ImageBitmap && t3 instanceof ImageBitmap);
    case 2:
      return t2.g.find((t3) => "undefined" != typeof WebGLTexture && t3 instanceof WebGLTexture);
    default:
      throw Error(`Type is not supported: ${e2}`);
  }
}
function Uu(t2) {
  var e2 = $u(t2, 0);
  if (!e2) {
    e2 = Gu(t2);
    let r2 = ju(t2), n2 = new Uint8Array(t2.width * t2.height * 4);
    du(r2, e2, Bu(t2)), e2.readPixels(0, 0, t2.width, t2.height, e2.RGBA, e2.UNSIGNED_BYTE, n2), fu(r2), e2 = new ImageData(new Uint8ClampedArray(n2.buffer), t2.width, t2.height), t2.g.push(e2);
  }
  return e2;
}
function Bu(t2) {
  var e2 = $u(t2, 2);
  if (!e2) {
    let r2 = Gu(t2);
    e2 = Vu(t2);
    let n2 = $u(t2, 1) || Uu(t2);
    r2.texImage2D(r2.TEXTURE_2D, 0, r2.RGBA, r2.RGBA, r2.UNSIGNED_BYTE, n2), Hu(t2);
  }
  return e2;
}
function Gu(t2) {
  if (!t2.canvas) throw Error("Conversion to different image formats require that a canvas is passed when initializing the image.");
  return t2.h || (t2.h = su(t2.canvas.getContext("webgl2"), "You cannot use a canvas that is already bound to a different type of rendering context.")), t2.h;
}
function ju(t2) {
  return t2.j || (t2.j = new pu()), t2.j;
}
function Vu(t2) {
  var e2 = Gu(t2);
  e2.viewport(0, 0, t2.width, t2.height), e2.activeTexture(e2.TEXTURE0);
  var r2 = $u(t2, 2);
  return r2 || (r2 = lu(ju(t2), e2), t2.g.push(r2), t2.m = true), e2.bindTexture(e2.TEXTURE_2D, r2), r2;
}
function Hu(t2) {
  t2.h.bindTexture(t2.h.TEXTURE_2D, null);
}
function Ku(t2) {
  var e2 = Gu(t2);
  return cu(ju(t2), e2, true, () => (function(t3, e3) {
    var r2 = t3.canvas;
    if (r2.width === t3.width && r2.height === t3.height) return e3();
    var n2 = r2.width, i2 = r2.height;
    return r2.width = t3.width, r2.height = t3.height, t3 = e3(), r2.width = n2, r2.height = i2, t3;
  })(t2, () => {
    if (e2.bindFramebuffer(e2.FRAMEBUFFER, null), e2.clearColor(0, 0, 0, 0), e2.clear(e2.COLOR_BUFFER_BIT), e2.drawArrays(e2.TRIANGLE_FAN, 0, 4), !(t2.canvas instanceof OffscreenCanvas)) throw Error("Conversion to ImageBitmap requires that the MediaPipe Tasks is initialized with an OffscreenCanvas");
    return t2.canvas.transferToImageBitmap();
  }));
}
Pu.prototype.close = Pu.prototype.close, Pu.prototype.drawConfidenceMask = Pu.prototype.Ka, Pu.prototype.drawCategoryMask = Pu.prototype.Ja, Pu.prototype.drawBoundingBox = Pu.prototype.Ia, Pu.prototype.drawConnectors = Pu.prototype.La, Pu.prototype.drawLandmarks = Pu.prototype.Ma, Pu.lerp = function(t2, e2, r2, n2, i2) {
  return Fu(n2 * (1 - (t2 - e2) / (r2 - e2)) + i2 * (1 - (r2 - t2) / (r2 - e2)), n2, i2);
}, Pu.clamp = Fu;
var Xu = class {
  constructor(t2, e2, r2, n2, i2, s2, o2) {
    this.g = t2, this.o = e2, this.m = r2, this.canvas = n2, this.j = i2, this.width = s2, this.height = o2, (this.o || this.m) && (0 === --Wu && console.error("You seem to be creating MPImage instances without invoking .close(). This leaks resources."));
  }
  Ta() {
    return !!$u(this, 0);
  }
  va() {
    return !!$u(this, 1);
  }
  W() {
    return !!$u(this, 2);
  }
  Qa() {
    return Uu(this);
  }
  Pa() {
    var t2 = $u(this, 1);
    return t2 || (Bu(this), Vu(this), t2 = Ku(this), Hu(this), this.g.push(t2), this.o = true), t2;
  }
  S() {
    return Bu(this);
  }
  clone() {
    var t2 = [];
    for (let e2 of this.g) {
      let r2;
      if (e2 instanceof ImageData) r2 = new ImageData(e2.data, this.width, this.height);
      else if (e2 instanceof WebGLTexture) {
        let t3 = Gu(this), e3 = ju(this);
        t3.activeTexture(t3.TEXTURE1), r2 = lu(e3, t3), t3.bindTexture(t3.TEXTURE_2D, r2), t3.texImage2D(t3.TEXTURE_2D, 0, t3.RGBA, this.width, this.height, 0, t3.RGBA, t3.UNSIGNED_BYTE, null), t3.bindTexture(t3.TEXTURE_2D, null), du(e3, t3, r2), cu(e3, t3, false, () => {
          Vu(this), t3.clearColor(0, 0, 0, 0), t3.clear(t3.COLOR_BUFFER_BIT), t3.drawArrays(t3.TRIANGLE_FAN, 0, 4), Hu(this);
        }), fu(e3), Hu(this);
      } else {
        if (!(e2 instanceof ImageBitmap)) throw Error(`Type is not supported: ${e2}`);
        Bu(this), Vu(this), r2 = Ku(this), Hu(this);
      }
      t2.push(r2);
    }
    return new Xu(t2, this.va(), this.W(), this.canvas, this.j, this.width, this.height);
  }
  close() {
    this.o && $u(this, 1).close(), this.m && Gu(this).deleteTexture($u(this, 2)), Wu = -1;
  }
};
Xu.prototype.close = Xu.prototype.close, Xu.prototype.clone = Xu.prototype.clone, Xu.prototype.getAsWebGLTexture = Xu.prototype.S, Xu.prototype.getAsImageBitmap = Xu.prototype.Pa, Xu.prototype.getAsImageData = Xu.prototype.Qa, Xu.prototype.hasWebGLTexture = Xu.prototype.W, Xu.prototype.hasImageBitmap = Xu.prototype.va, Xu.prototype.hasImageData = Xu.prototype.Ta;
var Wu = 250;
function zu(...t2) {
  return t2.map(([t3, e2]) => ({ start: t3, end: e2 }));
}
var Yu;
var qu = Wh((Yu = Xh(Kh), class extends Yu {
  get oa() {
    return this.i;
  }
  Da(t2, e2, r2) {
    Bh(this, e2, (e3) => {
      var [n2, i2] = Gh(this, t2, e3);
      this.oa._addBoundTextureAsImageToStream(e3, n2, i2, r2);
    });
  }
  ga(t2, e2) {
    Vh(this, t2, e2), Bh(this, t2, (t3) => {
      this.oa._attachImageListener(t3);
    });
  }
  ha(t2, e2) {
    Hh(this, t2, e2), Bh(this, t2, (t3) => {
      this.oa._attachImageVectorListener(t3);
    });
  }
}));
var Ju = class extends qu {
};
async function Zu(t2, e2, r2) {
  return Jh(t2, r2.canvas ?? (Ph() ? void 0 : document.createElement("canvas")), e2, r2);
}
function Qu(t2, e2, r2, n2) {
  if (t2.m && void 0 !== n2) if (Sr(t2.baseOptions, Ko, 3)?.g()) {
    var i2 = t2.m;
    ++i2.g.T, i2.h.set(n2, performance.now());
  } else ++(i2 = t2.m).g.P, i2.h.set(n2, performance.now());
  if (t2.qa) {
    if (i2 = new No(), r2?.regionOfInterest) {
      if (!t2.Ca) throw Error("This task doesn't support region-of-interest.");
      var s2 = r2.regionOfInterest;
      if (s2.left >= s2.right || s2.top >= s2.bottom) throw Error("Expected RectF with left < right and top < bottom.");
      if (s2.left < 0 || s2.top < 0 || s2.right > 1 || s2.bottom > 1) throw Error("Expected RectF values to be in [0,1].");
      jr(i2, 1, (s2.left + s2.right) / 2), jr(i2, 2, (s2.top + s2.bottom) / 2), jr(i2, 4, s2.right - s2.left), jr(i2, 3, s2.bottom - s2.top);
    } else jr(i2, 1, 0.5), jr(i2, 2, 0.5), jr(i2, 4, 1), jr(i2, 3, 1);
    if (r2?.rotationDegrees) {
      if (r2?.rotationDegrees % 90 != 0) throw Error("Expected rotation to be a multiple of 90\xB0.");
      if (jr(i2, 5, -Math.PI * r2.rotationDegrees / 180), r2?.rotationDegrees % 180 != 0) {
        let [t3, n3] = Uh(e2);
        r2 = Dr(i2, 3) * n3 / t3, s2 = Dr(i2, 4) * t3 / n3, jr(i2, 4, r2), jr(i2, 3, s2);
      }
    }
    t2.g.addProtoToStream(i2.g(), "mediapipe.NormalizedRect", t2.qa, n2);
  }
  t2.g.Da(e2, t2.Ba, n2 ?? performance.now()), t2.finishProcessing(n2);
}
function tc(t2, e2, r2) {
  if (t2.J) throw Error("Task is not initialized with image mode. 'runningMode' must be set to 'IMAGE'.");
  Qu(t2, e2, r2, t2.I + 1);
}
function ec(t2, e2, r2, n2) {
  if (!t2.J) throw Error("Task is not initialized with video mode. 'runningMode' must be set to 'VIDEO'.");
  Qu(t2, e2, r2, n2);
}
function rc(t2, e2, r2, n2) {
  var i2 = e2.data, s2 = e2.width, o2 = s2 * (e2 = e2.height);
  if ((i2 instanceof Uint8Array || i2 instanceof Float32Array) && i2.length !== o2) throw Error("Unsupported channel count: " + i2.length / o2);
  return t2 = new Su([i2], r2, false, t2.g.i.canvas, t2.da, s2, e2), n2 ? t2.clone() : t2;
}
var nc = class extends iu {
  constructor(t2, e2, r2, n2) {
    super(t2), this.g = t2, this.Ba = e2, this.qa = r2, this.Ca = n2, this.da = new pu(), this.J = false;
  }
  j(t2, e2 = true) {
    if ("runningMode" in t2) {
      var r2 = this.J = !!t2.runningMode && "IMAGE" !== t2.runningMode;
      ar(this.baseOptions, 2, null == r2 ? r2 : Zt(r2));
    }
    if (void 0 !== t2.canvas && this.g.i.canvas !== t2.canvas) throw Error("You must create a new task to reset the canvas.");
    return super.j(t2, e2);
  }
  close() {
    this.da.close(), super.close();
  }
};
nc.prototype.close = nc.prototype.close;
var ic = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect_in", false), this.l = { detections: [] }, Ir(t2 = this.h = new Zo(), 0, 1, e2 = new zo()), jr(this.h, 2, 0.5), jr(this.h, 3, 0.3);
  }
  C() {
    return "FaceDetector";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return "minDetectionConfidence" in t2 && jr(this.h, 2, t2.minDetectionConfidence ?? 0.5), "minSuppressionThreshold" in t2 && jr(this.h, 3, t2.minSuppressionThreshold ?? 0.3), this.j(t2);
  }
  G(t2, e2) {
    return this.l = { detections: [] }, tc(this, t2, e2), this.l;
  }
  H(t2, e2, r2) {
    return this.l = { detections: [] }, ec(this, t2, r2, e2), this.l;
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect_in"), go(t2, "detections");
    var e2 = new no();
    li(e2, ta, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.face_detector.FaceDetectorGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect_in"), ao(r2, "DETECTIONS:detections"), r2.v(e2), fo(t2, r2), this.g.attachProtoVectorListener("detections", (t3, e3) => {
      for (let e4 of t3) t3 = So(e4), this.l.detections.push(Za(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("detections", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
ic.prototype.detectForVideo = ic.prototype.H, ic.prototype.detect = ic.prototype.G, ic.prototype.setOptions = ic.prototype.v, ic.createFromModelPath = async function(t2, e2) {
  return Zu(ic, t2, { baseOptions: { modelAssetPath: e2 } });
}, ic.createFromModelBuffer = function(t2, e2) {
  return Zu(ic, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, ic.createFromOptions = function(t2, e2) {
  return Zu(ic, t2, e2);
};
var sc = zu([61, 146], [146, 91], [91, 181], [181, 84], [84, 17], [17, 314], [314, 405], [405, 321], [321, 375], [375, 291], [61, 185], [185, 40], [40, 39], [39, 37], [37, 0], [0, 267], [267, 269], [269, 270], [270, 409], [409, 291], [78, 95], [95, 88], [88, 178], [178, 87], [87, 14], [14, 317], [317, 402], [402, 318], [318, 324], [324, 308], [78, 191], [191, 80], [80, 81], [81, 82], [82, 13], [13, 312], [312, 311], [311, 310], [310, 415], [415, 308]);
var oc = zu([263, 249], [249, 390], [390, 373], [373, 374], [374, 380], [380, 381], [381, 382], [382, 362], [263, 466], [466, 388], [388, 387], [387, 386], [386, 385], [385, 384], [384, 398], [398, 362]);
var ac = zu([276, 283], [283, 282], [282, 295], [295, 285], [300, 293], [293, 334], [334, 296], [296, 336]);
var hc = zu([474, 475], [475, 476], [476, 477], [477, 474]);
var uc = zu([33, 7], [7, 163], [163, 144], [144, 145], [145, 153], [153, 154], [154, 155], [155, 133], [33, 246], [246, 161], [161, 160], [160, 159], [159, 158], [158, 157], [157, 173], [173, 133]);
var cc = zu([46, 53], [53, 52], [52, 65], [65, 55], [70, 63], [63, 105], [105, 66], [66, 107]);
var lc = zu([469, 470], [470, 471], [471, 472], [472, 469]);
var dc = zu([10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389], [389, 356], [356, 454], [454, 323], [323, 361], [361, 288], [288, 397], [397, 365], [365, 379], [379, 378], [378, 400], [400, 377], [377, 152], [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172], [172, 58], [58, 132], [132, 93], [93, 234], [234, 127], [127, 162], [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10]);
var fc = [...sc, ...oc, ...ac, ...uc, ...cc, ...dc];
var pc = zu([127, 34], [34, 139], [139, 127], [11, 0], [0, 37], [37, 11], [232, 231], [231, 120], [120, 232], [72, 37], [37, 39], [39, 72], [128, 121], [121, 47], [47, 128], [232, 121], [121, 128], [128, 232], [104, 69], [69, 67], [67, 104], [175, 171], [171, 148], [148, 175], [118, 50], [50, 101], [101, 118], [73, 39], [39, 40], [40, 73], [9, 151], [151, 108], [108, 9], [48, 115], [115, 131], [131, 48], [194, 204], [204, 211], [211, 194], [74, 40], [40, 185], [185, 74], [80, 42], [42, 183], [183, 80], [40, 92], [92, 186], [186, 40], [230, 229], [229, 118], [118, 230], [202, 212], [212, 214], [214, 202], [83, 18], [18, 17], [17, 83], [76, 61], [61, 146], [146, 76], [160, 29], [29, 30], [30, 160], [56, 157], [157, 173], [173, 56], [106, 204], [204, 194], [194, 106], [135, 214], [214, 192], [192, 135], [203, 165], [165, 98], [98, 203], [21, 71], [71, 68], [68, 21], [51, 45], [45, 4], [4, 51], [144, 24], [24, 23], [23, 144], [77, 146], [146, 91], [91, 77], [205, 50], [50, 187], [187, 205], [201, 200], [200, 18], [18, 201], [91, 106], [106, 182], [182, 91], [90, 91], [91, 181], [181, 90], [85, 84], [84, 17], [17, 85], [206, 203], [203, 36], [36, 206], [148, 171], [171, 140], [140, 148], [92, 40], [40, 39], [39, 92], [193, 189], [189, 244], [244, 193], [159, 158], [158, 28], [28, 159], [247, 246], [246, 161], [161, 247], [236, 3], [3, 196], [196, 236], [54, 68], [68, 104], [104, 54], [193, 168], [168, 8], [8, 193], [117, 228], [228, 31], [31, 117], [189, 193], [193, 55], [55, 189], [98, 97], [97, 99], [99, 98], [126, 47], [47, 100], [100, 126], [166, 79], [79, 218], [218, 166], [155, 154], [154, 26], [26, 155], [209, 49], [49, 131], [131, 209], [135, 136], [136, 150], [150, 135], [47, 126], [126, 217], [217, 47], [223, 52], [52, 53], [53, 223], [45, 51], [51, 134], [134, 45], [211, 170], [170, 140], [140, 211], [67, 69], [69, 108], [108, 67], [43, 106], [106, 91], [91, 43], [230, 119], [119, 120], [120, 230], [226, 130], [130, 247], [247, 226], [63, 53], [53, 52], [52, 63], [238, 20], [20, 242], [242, 238], [46, 70], [70, 156], [156, 46], [78, 62], [62, 96], [96, 78], [46, 53], [53, 63], [63, 46], [143, 34], [34, 227], [227, 143], [123, 117], [117, 111], [111, 123], [44, 125], [125, 19], [19, 44], [236, 134], [134, 51], [51, 236], [216, 206], [206, 205], [205, 216], [154, 153], [153, 22], [22, 154], [39, 37], [37, 167], [167, 39], [200, 201], [201, 208], [208, 200], [36, 142], [142, 100], [100, 36], [57, 212], [212, 202], [202, 57], [20, 60], [60, 99], [99, 20], [28, 158], [158, 157], [157, 28], [35, 226], [226, 113], [113, 35], [160, 159], [159, 27], [27, 160], [204, 202], [202, 210], [210, 204], [113, 225], [225, 46], [46, 113], [43, 202], [202, 204], [204, 43], [62, 76], [76, 77], [77, 62], [137, 123], [123, 116], [116, 137], [41, 38], [38, 72], [72, 41], [203, 129], [129, 142], [142, 203], [64, 98], [98, 240], [240, 64], [49, 102], [102, 64], [64, 49], [41, 73], [73, 74], [74, 41], [212, 216], [216, 207], [207, 212], [42, 74], [74, 184], [184, 42], [169, 170], [170, 211], [211, 169], [170, 149], [149, 176], [176, 170], [105, 66], [66, 69], [69, 105], [122, 6], [6, 168], [168, 122], [123, 147], [147, 187], [187, 123], [96, 77], [77, 90], [90, 96], [65, 55], [55, 107], [107, 65], [89, 90], [90, 180], [180, 89], [101, 100], [100, 120], [120, 101], [63, 105], [105, 104], [104, 63], [93, 137], [137, 227], [227, 93], [15, 86], [86, 85], [85, 15], [129, 102], [102, 49], [49, 129], [14, 87], [87, 86], [86, 14], [55, 8], [8, 9], [9, 55], [100, 47], [47, 121], [121, 100], [145, 23], [23, 22], [22, 145], [88, 89], [89, 179], [179, 88], [6, 122], [122, 196], [196, 6], [88, 95], [95, 96], [96, 88], [138, 172], [172, 136], [136, 138], [215, 58], [58, 172], [172, 215], [115, 48], [48, 219], [219, 115], [42, 80], [80, 81], [81, 42], [195, 3], [3, 51], [51, 195], [43, 146], [146, 61], [61, 43], [171, 175], [175, 199], [199, 171], [81, 82], [82, 38], [38, 81], [53, 46], [46, 225], [225, 53], [144, 163], [163, 110], [110, 144], [52, 65], [65, 66], [66, 52], [229, 228], [228, 117], [117, 229], [34, 127], [127, 234], [234, 34], [107, 108], [108, 69], [69, 107], [109, 108], [108, 151], [151, 109], [48, 64], [64, 235], [235, 48], [62, 78], [78, 191], [191, 62], [129, 209], [209, 126], [126, 129], [111, 35], [35, 143], [143, 111], [117, 123], [123, 50], [50, 117], [222, 65], [65, 52], [52, 222], [19, 125], [125, 141], [141, 19], [221, 55], [55, 65], [65, 221], [3, 195], [195, 197], [197, 3], [25, 7], [7, 33], [33, 25], [220, 237], [237, 44], [44, 220], [70, 71], [71, 139], [139, 70], [122, 193], [193, 245], [245, 122], [247, 130], [130, 33], [33, 247], [71, 21], [21, 162], [162, 71], [170, 169], [169, 150], [150, 170], [188, 174], [174, 196], [196, 188], [216, 186], [186, 92], [92, 216], [2, 97], [97, 167], [167, 2], [141, 125], [125, 241], [241, 141], [164, 167], [167, 37], [37, 164], [72, 38], [38, 12], [12, 72], [38, 82], [82, 13], [13, 38], [63, 68], [68, 71], [71, 63], [226, 35], [35, 111], [111, 226], [101, 50], [50, 205], [205, 101], [206, 92], [92, 165], [165, 206], [209, 198], [198, 217], [217, 209], [165, 167], [167, 97], [97, 165], [220, 115], [115, 218], [218, 220], [133, 112], [112, 243], [243, 133], [239, 238], [238, 241], [241, 239], [214, 135], [135, 169], [169, 214], [190, 173], [173, 133], [133, 190], [171, 208], [208, 32], [32, 171], [125, 44], [44, 237], [237, 125], [86, 87], [87, 178], [178, 86], [85, 86], [86, 179], [179, 85], [84, 85], [85, 180], [180, 84], [83, 84], [84, 181], [181, 83], [201, 83], [83, 182], [182, 201], [137, 93], [93, 132], [132, 137], [76, 62], [62, 183], [183, 76], [61, 76], [76, 184], [184, 61], [57, 61], [61, 185], [185, 57], [212, 57], [57, 186], [186, 212], [214, 207], [207, 187], [187, 214], [34, 143], [143, 156], [156, 34], [79, 239], [239, 237], [237, 79], [123, 137], [137, 177], [177, 123], [44, 1], [1, 4], [4, 44], [201, 194], [194, 32], [32, 201], [64, 102], [102, 129], [129, 64], [213, 215], [215, 138], [138, 213], [59, 166], [166, 219], [219, 59], [242, 99], [99, 97], [97, 242], [2, 94], [94, 141], [141, 2], [75, 59], [59, 235], [235, 75], [24, 110], [110, 228], [228, 24], [25, 130], [130, 226], [226, 25], [23, 24], [24, 229], [229, 23], [22, 23], [23, 230], [230, 22], [26, 22], [22, 231], [231, 26], [112, 26], [26, 232], [232, 112], [189, 190], [190, 243], [243, 189], [221, 56], [56, 190], [190, 221], [28, 56], [56, 221], [221, 28], [27, 28], [28, 222], [222, 27], [29, 27], [27, 223], [223, 29], [30, 29], [29, 224], [224, 30], [247, 30], [30, 225], [225, 247], [238, 79], [79, 20], [20, 238], [166, 59], [59, 75], [75, 166], [60, 75], [75, 240], [240, 60], [147, 177], [177, 215], [215, 147], [20, 79], [79, 166], [166, 20], [187, 147], [147, 213], [213, 187], [112, 233], [233, 244], [244, 112], [233, 128], [128, 245], [245, 233], [128, 114], [114, 188], [188, 128], [114, 217], [217, 174], [174, 114], [131, 115], [115, 220], [220, 131], [217, 198], [198, 236], [236, 217], [198, 131], [131, 134], [134, 198], [177, 132], [132, 58], [58, 177], [143, 35], [35, 124], [124, 143], [110, 163], [163, 7], [7, 110], [228, 110], [110, 25], [25, 228], [356, 389], [389, 368], [368, 356], [11, 302], [302, 267], [267, 11], [452, 350], [350, 349], [349, 452], [302, 303], [303, 269], [269, 302], [357, 343], [343, 277], [277, 357], [452, 453], [453, 357], [357, 452], [333, 332], [332, 297], [297, 333], [175, 152], [152, 377], [377, 175], [347, 348], [348, 330], [330, 347], [303, 304], [304, 270], [270, 303], [9, 336], [336, 337], [337, 9], [278, 279], [279, 360], [360, 278], [418, 262], [262, 431], [431, 418], [304, 408], [408, 409], [409, 304], [310, 415], [415, 407], [407, 310], [270, 409], [409, 410], [410, 270], [450, 348], [348, 347], [347, 450], [422, 430], [430, 434], [434, 422], [313, 314], [314, 17], [17, 313], [306, 307], [307, 375], [375, 306], [387, 388], [388, 260], [260, 387], [286, 414], [414, 398], [398, 286], [335, 406], [406, 418], [418, 335], [364, 367], [367, 416], [416, 364], [423, 358], [358, 327], [327, 423], [251, 284], [284, 298], [298, 251], [281, 5], [5, 4], [4, 281], [373, 374], [374, 253], [253, 373], [307, 320], [320, 321], [321, 307], [425, 427], [427, 411], [411, 425], [421, 313], [313, 18], [18, 421], [321, 405], [405, 406], [406, 321], [320, 404], [404, 405], [405, 320], [315, 16], [16, 17], [17, 315], [426, 425], [425, 266], [266, 426], [377, 400], [400, 369], [369, 377], [322, 391], [391, 269], [269, 322], [417, 465], [465, 464], [464, 417], [386, 257], [257, 258], [258, 386], [466, 260], [260, 388], [388, 466], [456, 399], [399, 419], [419, 456], [284, 332], [332, 333], [333, 284], [417, 285], [285, 8], [8, 417], [346, 340], [340, 261], [261, 346], [413, 441], [441, 285], [285, 413], [327, 460], [460, 328], [328, 327], [355, 371], [371, 329], [329, 355], [392, 439], [439, 438], [438, 392], [382, 341], [341, 256], [256, 382], [429, 420], [420, 360], [360, 429], [364, 394], [394, 379], [379, 364], [277, 343], [343, 437], [437, 277], [443, 444], [444, 283], [283, 443], [275, 440], [440, 363], [363, 275], [431, 262], [262, 369], [369, 431], [297, 338], [338, 337], [337, 297], [273, 375], [375, 321], [321, 273], [450, 451], [451, 349], [349, 450], [446, 342], [342, 467], [467, 446], [293, 334], [334, 282], [282, 293], [458, 461], [461, 462], [462, 458], [276, 353], [353, 383], [383, 276], [308, 324], [324, 325], [325, 308], [276, 300], [300, 293], [293, 276], [372, 345], [345, 447], [447, 372], [352, 345], [345, 340], [340, 352], [274, 1], [1, 19], [19, 274], [456, 248], [248, 281], [281, 456], [436, 427], [427, 425], [425, 436], [381, 256], [256, 252], [252, 381], [269, 391], [391, 393], [393, 269], [200, 199], [199, 428], [428, 200], [266, 330], [330, 329], [329, 266], [287, 273], [273, 422], [422, 287], [250, 462], [462, 328], [328, 250], [258, 286], [286, 384], [384, 258], [265, 353], [353, 342], [342, 265], [387, 259], [259, 257], [257, 387], [424, 431], [431, 430], [430, 424], [342, 353], [353, 276], [276, 342], [273, 335], [335, 424], [424, 273], [292, 325], [325, 307], [307, 292], [366, 447], [447, 345], [345, 366], [271, 303], [303, 302], [302, 271], [423, 266], [266, 371], [371, 423], [294, 455], [455, 460], [460, 294], [279, 278], [278, 294], [294, 279], [271, 272], [272, 304], [304, 271], [432, 434], [434, 427], [427, 432], [272, 407], [407, 408], [408, 272], [394, 430], [430, 431], [431, 394], [395, 369], [369, 400], [400, 395], [334, 333], [333, 299], [299, 334], [351, 417], [417, 168], [168, 351], [352, 280], [280, 411], [411, 352], [325, 319], [319, 320], [320, 325], [295, 296], [296, 336], [336, 295], [319, 403], [403, 404], [404, 319], [330, 348], [348, 349], [349, 330], [293, 298], [298, 333], [333, 293], [323, 454], [454, 447], [447, 323], [15, 16], [16, 315], [315, 15], [358, 429], [429, 279], [279, 358], [14, 15], [15, 316], [316, 14], [285, 336], [336, 9], [9, 285], [329, 349], [349, 350], [350, 329], [374, 380], [380, 252], [252, 374], [318, 402], [402, 403], [403, 318], [6, 197], [197, 419], [419, 6], [318, 319], [319, 325], [325, 318], [367, 364], [364, 365], [365, 367], [435, 367], [367, 397], [397, 435], [344, 438], [438, 439], [439, 344], [272, 271], [271, 311], [311, 272], [195, 5], [5, 281], [281, 195], [273, 287], [287, 291], [291, 273], [396, 428], [428, 199], [199, 396], [311, 271], [271, 268], [268, 311], [283, 444], [444, 445], [445, 283], [373, 254], [254, 339], [339, 373], [282, 334], [334, 296], [296, 282], [449, 347], [347, 346], [346, 449], [264, 447], [447, 454], [454, 264], [336, 296], [296, 299], [299, 336], [338, 10], [10, 151], [151, 338], [278, 439], [439, 455], [455, 278], [292, 407], [407, 415], [415, 292], [358, 371], [371, 355], [355, 358], [340, 345], [345, 372], [372, 340], [346, 347], [347, 280], [280, 346], [442, 443], [443, 282], [282, 442], [19, 94], [94, 370], [370, 19], [441, 442], [442, 295], [295, 441], [248, 419], [419, 197], [197, 248], [263, 255], [255, 359], [359, 263], [440, 275], [275, 274], [274, 440], [300, 383], [383, 368], [368, 300], [351, 412], [412, 465], [465, 351], [263, 467], [467, 466], [466, 263], [301, 368], [368, 389], [389, 301], [395, 378], [378, 379], [379, 395], [412, 351], [351, 419], [419, 412], [436, 426], [426, 322], [322, 436], [2, 164], [164, 393], [393, 2], [370, 462], [462, 461], [461, 370], [164, 0], [0, 267], [267, 164], [302, 11], [11, 12], [12, 302], [268, 12], [12, 13], [13, 268], [293, 300], [300, 301], [301, 293], [446, 261], [261, 340], [340, 446], [330, 266], [266, 425], [425, 330], [426, 423], [423, 391], [391, 426], [429, 355], [355, 437], [437, 429], [391, 327], [327, 326], [326, 391], [440, 457], [457, 438], [438, 440], [341, 382], [382, 362], [362, 341], [459, 457], [457, 461], [461, 459], [434, 430], [430, 394], [394, 434], [414, 463], [463, 362], [362, 414], [396, 369], [369, 262], [262, 396], [354, 461], [461, 457], [457, 354], [316, 403], [403, 402], [402, 316], [315, 404], [404, 403], [403, 315], [314, 405], [405, 404], [404, 314], [313, 406], [406, 405], [405, 313], [421, 418], [418, 406], [406, 421], [366, 401], [401, 361], [361, 366], [306, 408], [408, 407], [407, 306], [291, 409], [409, 408], [408, 291], [287, 410], [410, 409], [409, 287], [432, 436], [436, 410], [410, 432], [434, 416], [416, 411], [411, 434], [264, 368], [368, 383], [383, 264], [309, 438], [438, 457], [457, 309], [352, 376], [376, 401], [401, 352], [274, 275], [275, 4], [4, 274], [421, 428], [428, 262], [262, 421], [294, 327], [327, 358], [358, 294], [433, 416], [416, 367], [367, 433], [289, 455], [455, 439], [439, 289], [462, 370], [370, 326], [326, 462], [2, 326], [326, 370], [370, 2], [305, 460], [460, 455], [455, 305], [254, 449], [449, 448], [448, 254], [255, 261], [261, 446], [446, 255], [253, 450], [450, 449], [449, 253], [252, 451], [451, 450], [450, 252], [256, 452], [452, 451], [451, 256], [341, 453], [453, 452], [452, 341], [413, 464], [464, 463], [463, 413], [441, 413], [413, 414], [414, 441], [258, 442], [442, 441], [441, 258], [257, 443], [443, 442], [442, 257], [259, 444], [444, 443], [443, 259], [260, 445], [445, 444], [444, 260], [467, 342], [342, 445], [445, 467], [459, 458], [458, 250], [250, 459], [289, 392], [392, 290], [290, 289], [290, 328], [328, 460], [460, 290], [376, 433], [433, 435], [435, 376], [250, 290], [290, 392], [392, 250], [411, 416], [416, 433], [433, 411], [341, 463], [463, 464], [464, 341], [453, 464], [464, 465], [465, 453], [357, 465], [465, 412], [412, 357], [343, 412], [412, 399], [399, 343], [360, 363], [363, 440], [440, 360], [437, 399], [399, 456], [456, 437], [420, 456], [456, 363], [363, 420], [401, 435], [435, 288], [288, 401], [372, 383], [383, 353], [353, 372], [339, 255], [255, 249], [249, 339], [448, 261], [261, 255], [255, 448], [133, 243], [243, 190], [190, 133], [133, 155], [155, 112], [112, 133], [33, 246], [246, 247], [247, 33], [33, 130], [130, 25], [25, 33], [398, 384], [384, 286], [286, 398], [362, 398], [398, 414], [414, 362], [362, 463], [463, 341], [341, 362], [263, 359], [359, 467], [467, 263], [263, 249], [249, 255], [255, 263], [466, 467], [467, 260], [260, 466], [75, 60], [60, 166], [166, 75], [238, 239], [239, 79], [79, 238], [162, 127], [127, 139], [139, 162], [72, 11], [11, 37], [37, 72], [121, 232], [232, 120], [120, 121], [73, 72], [72, 39], [39, 73], [114, 128], [128, 47], [47, 114], [233, 232], [232, 128], [128, 233], [103, 104], [104, 67], [67, 103], [152, 175], [175, 148], [148, 152], [119, 118], [118, 101], [101, 119], [74, 73], [73, 40], [40, 74], [107, 9], [9, 108], [108, 107], [49, 48], [48, 131], [131, 49], [32, 194], [194, 211], [211, 32], [184, 74], [74, 185], [185, 184], [191, 80], [80, 183], [183, 191], [185, 40], [40, 186], [186, 185], [119, 230], [230, 118], [118, 119], [210, 202], [202, 214], [214, 210], [84, 83], [83, 17], [17, 84], [77, 76], [76, 146], [146, 77], [161, 160], [160, 30], [30, 161], [190, 56], [56, 173], [173, 190], [182, 106], [106, 194], [194, 182], [138, 135], [135, 192], [192, 138], [129, 203], [203, 98], [98, 129], [54, 21], [21, 68], [68, 54], [5, 51], [51, 4], [4, 5], [145, 144], [144, 23], [23, 145], [90, 77], [77, 91], [91, 90], [207, 205], [205, 187], [187, 207], [83, 201], [201, 18], [18, 83], [181, 91], [91, 182], [182, 181], [180, 90], [90, 181], [181, 180], [16, 85], [85, 17], [17, 16], [205, 206], [206, 36], [36, 205], [176, 148], [148, 140], [140, 176], [165, 92], [92, 39], [39, 165], [245, 193], [193, 244], [244, 245], [27, 159], [159, 28], [28, 27], [30, 247], [247, 161], [161, 30], [174, 236], [236, 196], [196, 174], [103, 54], [54, 104], [104, 103], [55, 193], [193, 8], [8, 55], [111, 117], [117, 31], [31, 111], [221, 189], [189, 55], [55, 221], [240, 98], [98, 99], [99, 240], [142, 126], [126, 100], [100, 142], [219, 166], [166, 218], [218, 219], [112, 155], [155, 26], [26, 112], [198, 209], [209, 131], [131, 198], [169, 135], [135, 150], [150, 169], [114, 47], [47, 217], [217, 114], [224, 223], [223, 53], [53, 224], [220, 45], [45, 134], [134, 220], [32, 211], [211, 140], [140, 32], [109, 67], [67, 108], [108, 109], [146, 43], [43, 91], [91, 146], [231, 230], [230, 120], [120, 231], [113, 226], [226, 247], [247, 113], [105, 63], [63, 52], [52, 105], [241, 238], [238, 242], [242, 241], [124, 46], [46, 156], [156, 124], [95, 78], [78, 96], [96, 95], [70, 46], [46, 63], [63, 70], [116, 143], [143, 227], [227, 116], [116, 123], [123, 111], [111, 116], [1, 44], [44, 19], [19, 1], [3, 236], [236, 51], [51, 3], [207, 216], [216, 205], [205, 207], [26, 154], [154, 22], [22, 26], [165, 39], [39, 167], [167, 165], [199, 200], [200, 208], [208, 199], [101, 36], [36, 100], [100, 101], [43, 57], [57, 202], [202, 43], [242, 20], [20, 99], [99, 242], [56, 28], [28, 157], [157, 56], [124, 35], [35, 113], [113, 124], [29, 160], [160, 27], [27, 29], [211, 204], [204, 210], [210, 211], [124, 113], [113, 46], [46, 124], [106, 43], [43, 204], [204, 106], [96, 62], [62, 77], [77, 96], [227, 137], [137, 116], [116, 227], [73, 41], [41, 72], [72, 73], [36, 203], [203, 142], [142, 36], [235, 64], [64, 240], [240, 235], [48, 49], [49, 64], [64, 48], [42, 41], [41, 74], [74, 42], [214, 212], [212, 207], [207, 214], [183, 42], [42, 184], [184, 183], [210, 169], [169, 211], [211, 210], [140, 170], [170, 176], [176, 140], [104, 105], [105, 69], [69, 104], [193, 122], [122, 168], [168, 193], [50, 123], [123, 187], [187, 50], [89, 96], [96, 90], [90, 89], [66, 65], [65, 107], [107, 66], [179, 89], [89, 180], [180, 179], [119, 101], [101, 120], [120, 119], [68, 63], [63, 104], [104, 68], [234, 93], [93, 227], [227, 234], [16, 15], [15, 85], [85, 16], [209, 129], [129, 49], [49, 209], [15, 14], [14, 86], [86, 15], [107, 55], [55, 9], [9, 107], [120, 100], [100, 121], [121, 120], [153, 145], [145, 22], [22, 153], [178, 88], [88, 179], [179, 178], [197, 6], [6, 196], [196, 197], [89, 88], [88, 96], [96, 89], [135, 138], [138, 136], [136, 135], [138, 215], [215, 172], [172, 138], [218, 115], [115, 219], [219, 218], [41, 42], [42, 81], [81, 41], [5, 195], [195, 51], [51, 5], [57, 43], [43, 61], [61, 57], [208, 171], [171, 199], [199, 208], [41, 81], [81, 38], [38, 41], [224, 53], [53, 225], [225, 224], [24, 144], [144, 110], [110, 24], [105, 52], [52, 66], [66, 105], [118, 229], [229, 117], [117, 118], [227, 34], [34, 234], [234, 227], [66, 107], [107, 69], [69, 66], [10, 109], [109, 151], [151, 10], [219, 48], [48, 235], [235, 219], [183, 62], [62, 191], [191, 183], [142, 129], [129, 126], [126, 142], [116, 111], [111, 143], [143, 116], [118, 117], [117, 50], [50, 118], [223, 222], [222, 52], [52, 223], [94, 19], [19, 141], [141, 94], [222, 221], [221, 65], [65, 222], [196, 3], [3, 197], [197, 196], [45, 220], [220, 44], [44, 45], [156, 70], [70, 139], [139, 156], [188, 122], [122, 245], [245, 188], [139, 71], [71, 162], [162, 139], [149, 170], [170, 150], [150, 149], [122, 188], [188, 196], [196, 122], [206, 216], [216, 92], [92, 206], [164, 2], [2, 167], [167, 164], [242, 141], [141, 241], [241, 242], [0, 164], [164, 37], [37, 0], [11, 72], [72, 12], [12, 11], [12, 38], [38, 13], [13, 12], [70, 63], [63, 71], [71, 70], [31, 226], [226, 111], [111, 31], [36, 101], [101, 205], [205, 36], [203, 206], [206, 165], [165, 203], [126, 209], [209, 217], [217, 126], [98, 165], [165, 97], [97, 98], [237, 220], [220, 218], [218, 237], [237, 239], [239, 241], [241, 237], [210, 214], [214, 169], [169, 210], [140, 171], [171, 32], [32, 140], [241, 125], [125, 237], [237, 241], [179, 86], [86, 178], [178, 179], [180, 85], [85, 179], [179, 180], [181, 84], [84, 180], [180, 181], [182, 83], [83, 181], [181, 182], [194, 201], [201, 182], [182, 194], [177, 137], [137, 132], [132, 177], [184, 76], [76, 183], [183, 184], [185, 61], [61, 184], [184, 185], [186, 57], [57, 185], [185, 186], [216, 212], [212, 186], [186, 216], [192, 214], [214, 187], [187, 192], [139, 34], [34, 156], [156, 139], [218, 79], [79, 237], [237, 218], [147, 123], [123, 177], [177, 147], [45, 44], [44, 4], [4, 45], [208, 201], [201, 32], [32, 208], [98, 64], [64, 129], [129, 98], [192, 213], [213, 138], [138, 192], [235, 59], [59, 219], [219, 235], [141, 242], [242, 97], [97, 141], [97, 2], [2, 141], [141, 97], [240, 75], [75, 235], [235, 240], [229, 24], [24, 228], [228, 229], [31, 25], [25, 226], [226, 31], [230, 23], [23, 229], [229, 230], [231, 22], [22, 230], [230, 231], [232, 26], [26, 231], [231, 232], [233, 112], [112, 232], [232, 233], [244, 189], [189, 243], [243, 244], [189, 221], [221, 190], [190, 189], [222, 28], [28, 221], [221, 222], [223, 27], [27, 222], [222, 223], [224, 29], [29, 223], [223, 224], [225, 30], [30, 224], [224, 225], [113, 247], [247, 225], [225, 113], [99, 60], [60, 240], [240, 99], [213, 147], [147, 215], [215, 213], [60, 20], [20, 166], [166, 60], [192, 187], [187, 213], [213, 192], [243, 112], [112, 244], [244, 243], [244, 233], [233, 245], [245, 244], [245, 128], [128, 188], [188, 245], [188, 114], [114, 174], [174, 188], [134, 131], [131, 220], [220, 134], [174, 217], [217, 236], [236, 174], [236, 198], [198, 134], [134, 236], [215, 177], [177, 58], [58, 215], [156, 143], [143, 124], [124, 156], [25, 110], [110, 7], [7, 25], [31, 228], [228, 25], [25, 31], [264, 356], [356, 368], [368, 264], [0, 11], [11, 267], [267, 0], [451, 452], [452, 349], [349, 451], [267, 302], [302, 269], [269, 267], [350, 357], [357, 277], [277, 350], [350, 452], [452, 357], [357, 350], [299, 333], [333, 297], [297, 299], [396, 175], [175, 377], [377, 396], [280, 347], [347, 330], [330, 280], [269, 303], [303, 270], [270, 269], [151, 9], [9, 337], [337, 151], [344, 278], [278, 360], [360, 344], [424, 418], [418, 431], [431, 424], [270, 304], [304, 409], [409, 270], [272, 310], [310, 407], [407, 272], [322, 270], [270, 410], [410, 322], [449, 450], [450, 347], [347, 449], [432, 422], [422, 434], [434, 432], [18, 313], [313, 17], [17, 18], [291, 306], [306, 375], [375, 291], [259, 387], [387, 260], [260, 259], [424, 335], [335, 418], [418, 424], [434, 364], [364, 416], [416, 434], [391, 423], [423, 327], [327, 391], [301, 251], [251, 298], [298, 301], [275, 281], [281, 4], [4, 275], [254, 373], [373, 253], [253, 254], [375, 307], [307, 321], [321, 375], [280, 425], [425, 411], [411, 280], [200, 421], [421, 18], [18, 200], [335, 321], [321, 406], [406, 335], [321, 320], [320, 405], [405, 321], [314, 315], [315, 17], [17, 314], [423, 426], [426, 266], [266, 423], [396, 377], [377, 369], [369, 396], [270, 322], [322, 269], [269, 270], [413, 417], [417, 464], [464, 413], [385, 386], [386, 258], [258, 385], [248, 456], [456, 419], [419, 248], [298, 284], [284, 333], [333, 298], [168, 417], [417, 8], [8, 168], [448, 346], [346, 261], [261, 448], [417, 413], [413, 285], [285, 417], [326, 327], [327, 328], [328, 326], [277, 355], [355, 329], [329, 277], [309, 392], [392, 438], [438, 309], [381, 382], [382, 256], [256, 381], [279, 429], [429, 360], [360, 279], [365, 364], [364, 379], [379, 365], [355, 277], [277, 437], [437, 355], [282, 443], [443, 283], [283, 282], [281, 275], [275, 363], [363, 281], [395, 431], [431, 369], [369, 395], [299, 297], [297, 337], [337, 299], [335, 273], [273, 321], [321, 335], [348, 450], [450, 349], [349, 348], [359, 446], [446, 467], [467, 359], [283, 293], [293, 282], [282, 283], [250, 458], [458, 462], [462, 250], [300, 276], [276, 383], [383, 300], [292, 308], [308, 325], [325, 292], [283, 276], [276, 293], [293, 283], [264, 372], [372, 447], [447, 264], [346, 352], [352, 340], [340, 346], [354, 274], [274, 19], [19, 354], [363, 456], [456, 281], [281, 363], [426, 436], [436, 425], [425, 426], [380, 381], [381, 252], [252, 380], [267, 269], [269, 393], [393, 267], [421, 200], [200, 428], [428, 421], [371, 266], [266, 329], [329, 371], [432, 287], [287, 422], [422, 432], [290, 250], [250, 328], [328, 290], [385, 258], [258, 384], [384, 385], [446, 265], [265, 342], [342, 446], [386, 387], [387, 257], [257, 386], [422, 424], [424, 430], [430, 422], [445, 342], [342, 276], [276, 445], [422, 273], [273, 424], [424, 422], [306, 292], [292, 307], [307, 306], [352, 366], [366, 345], [345, 352], [268, 271], [271, 302], [302, 268], [358, 423], [423, 371], [371, 358], [327, 294], [294, 460], [460, 327], [331, 279], [279, 294], [294, 331], [303, 271], [271, 304], [304, 303], [436, 432], [432, 427], [427, 436], [304, 272], [272, 408], [408, 304], [395, 394], [394, 431], [431, 395], [378, 395], [395, 400], [400, 378], [296, 334], [334, 299], [299, 296], [6, 351], [351, 168], [168, 6], [376, 352], [352, 411], [411, 376], [307, 325], [325, 320], [320, 307], [285, 295], [295, 336], [336, 285], [320, 319], [319, 404], [404, 320], [329, 330], [330, 349], [349, 329], [334, 293], [293, 333], [333, 334], [366, 323], [323, 447], [447, 366], [316, 15], [15, 315], [315, 316], [331, 358], [358, 279], [279, 331], [317, 14], [14, 316], [316, 317], [8, 285], [285, 9], [9, 8], [277, 329], [329, 350], [350, 277], [253, 374], [374, 252], [252, 253], [319, 318], [318, 403], [403, 319], [351, 6], [6, 419], [419, 351], [324, 318], [318, 325], [325, 324], [397, 367], [367, 365], [365, 397], [288, 435], [435, 397], [397, 288], [278, 344], [344, 439], [439, 278], [310, 272], [272, 311], [311, 310], [248, 195], [195, 281], [281, 248], [375, 273], [273, 291], [291, 375], [175, 396], [396, 199], [199, 175], [312, 311], [311, 268], [268, 312], [276, 283], [283, 445], [445, 276], [390, 373], [373, 339], [339, 390], [295, 282], [282, 296], [296, 295], [448, 449], [449, 346], [346, 448], [356, 264], [264, 454], [454, 356], [337, 336], [336, 299], [299, 337], [337, 338], [338, 151], [151, 337], [294, 278], [278, 455], [455, 294], [308, 292], [292, 415], [415, 308], [429, 358], [358, 355], [355, 429], [265, 340], [340, 372], [372, 265], [352, 346], [346, 280], [280, 352], [295, 442], [442, 282], [282, 295], [354, 19], [19, 370], [370, 354], [285, 441], [441, 295], [295, 285], [195, 248], [248, 197], [197, 195], [457, 440], [440, 274], [274, 457], [301, 300], [300, 368], [368, 301], [417, 351], [351, 465], [465, 417], [251, 301], [301, 389], [389, 251], [394, 395], [395, 379], [379, 394], [399, 412], [412, 419], [419, 399], [410, 436], [436, 322], [322, 410], [326, 2], [2, 393], [393, 326], [354, 370], [370, 461], [461, 354], [393, 164], [164, 267], [267, 393], [268, 302], [302, 12], [12, 268], [312, 268], [268, 13], [13, 312], [298, 293], [293, 301], [301, 298], [265, 446], [446, 340], [340, 265], [280, 330], [330, 425], [425, 280], [322, 426], [426, 391], [391, 322], [420, 429], [429, 437], [437, 420], [393, 391], [391, 326], [326, 393], [344, 440], [440, 438], [438, 344], [458, 459], [459, 461], [461, 458], [364, 434], [434, 394], [394, 364], [428, 396], [396, 262], [262, 428], [274, 354], [354, 457], [457, 274], [317, 316], [316, 402], [402, 317], [316, 315], [315, 403], [403, 316], [315, 314], [314, 404], [404, 315], [314, 313], [313, 405], [405, 314], [313, 421], [421, 406], [406, 313], [323, 366], [366, 361], [361, 323], [292, 306], [306, 407], [407, 292], [306, 291], [291, 408], [408, 306], [291, 287], [287, 409], [409, 291], [287, 432], [432, 410], [410, 287], [427, 434], [434, 411], [411, 427], [372, 264], [264, 383], [383, 372], [459, 309], [309, 457], [457, 459], [366, 352], [352, 401], [401, 366], [1, 274], [274, 4], [4, 1], [418, 421], [421, 262], [262, 418], [331, 294], [294, 358], [358, 331], [435, 433], [433, 367], [367, 435], [392, 289], [289, 439], [439, 392], [328, 462], [462, 326], [326, 328], [94, 2], [2, 370], [370, 94], [289, 305], [305, 455], [455, 289], [339, 254], [254, 448], [448, 339], [359, 255], [255, 446], [446, 359], [254, 253], [253, 449], [449, 254], [253, 252], [252, 450], [450, 253], [252, 256], [256, 451], [451, 252], [256, 341], [341, 452], [452, 256], [414, 413], [413, 463], [463, 414], [286, 441], [441, 414], [414, 286], [286, 258], [258, 441], [441, 286], [258, 257], [257, 442], [442, 258], [257, 259], [259, 443], [443, 257], [259, 260], [260, 444], [444, 259], [260, 467], [467, 445], [445, 260], [309, 459], [459, 250], [250, 309], [305, 289], [289, 290], [290, 305], [305, 290], [290, 460], [460, 305], [401, 376], [376, 435], [435, 401], [309, 250], [250, 392], [392, 309], [376, 411], [411, 433], [433, 376], [453, 341], [341, 464], [464, 453], [357, 453], [453, 465], [465, 357], [343, 357], [357, 412], [412, 343], [437, 343], [343, 399], [399, 437], [344, 360], [360, 440], [440, 344], [420, 437], [437, 456], [456, 420], [360, 420], [420, 363], [363, 360], [361, 401], [401, 288], [288, 361], [265, 372], [372, 353], [353, 265], [390, 339], [339, 249], [249, 390], [339, 448], [448, 255], [255, 339]);
function gc(t2) {
  t2.l = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };
}
var mc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect", false), this.l = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }, this.outputFacialTransformationMatrixes = this.outputFaceBlendshapes = false, Ir(t2 = this.h = new na(), 0, 1, e2 = new zo()), this.B = new ra(), Ir(this.h, 0, 3, this.B), this.u = new Zo(), Ir(this.h, 0, 2, this.u), Ur(this.u, 4, 1), jr(this.u, 2, 0.5), jr(this.B, 2, 0.5), jr(this.h, 4, 0.5);
  }
  C() {
    return "FaceLandmarker";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return "numFaces" in t2 && Ur(this.u, 4, t2.numFaces ?? 1), "minFaceDetectionConfidence" in t2 && jr(this.u, 2, t2.minFaceDetectionConfidence ?? 0.5), "minTrackingConfidence" in t2 && jr(this.h, 4, t2.minTrackingConfidence ?? 0.5), "minFacePresenceConfidence" in t2 && jr(this.B, 2, t2.minFacePresenceConfidence ?? 0.5), "outputFaceBlendshapes" in t2 && (this.outputFaceBlendshapes = !!t2.outputFaceBlendshapes), "outputFacialTransformationMatrixes" in t2 && (this.outputFacialTransformationMatrixes = !!t2.outputFacialTransformationMatrixes), this.j(t2);
  }
  G(t2, e2) {
    return gc(this), tc(this, t2, e2), this.l;
  }
  H(t2, e2, r2) {
    return gc(this), ec(this, t2, r2, e2), this.l;
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect"), go(t2, "face_landmarks");
    var e2 = new no();
    li(e2, sa, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.face_landmarker.FaceLandmarkerGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "NORM_LANDMARKS:face_landmarks"), r2.v(e2), fo(t2, r2), this.g.attachProtoVectorListener("face_landmarks", (t3, e3) => {
      for (let e4 of t3) t3 = Io(e4), this.l.faceLandmarks.push(Qa(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("face_landmarks", (t3) => {
      tu(this, t3);
    }), this.outputFaceBlendshapes && (go(t2, "blendshapes"), ao(r2, "BLENDSHAPES:blendshapes"), this.g.attachProtoVectorListener("blendshapes", (t3, e3) => {
      if (this.outputFaceBlendshapes) for (let e4 of t3) t3 = wo(e4), this.l.faceBlendshapes.push(qa(t3.g() ?? []));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("blendshapes", (t3) => {
      tu(this, t3);
    })), this.outputFacialTransformationMatrixes && (go(t2, "face_geometry"), ao(r2, "FACE_GEOMETRY:face_geometry"), this.g.attachProtoVectorListener("face_geometry", (t3, e3) => {
      if (this.outputFacialTransformationMatrixes) for (let e4 of t3) (t3 = Sr(t3 = ea(e4), Fo, 2)) && this.l.facialTransformationMatrixes.push({ rows: Or(t3, 1) ?? 0 ?? 0, columns: Or(t3, 2) ?? 0 ?? 0, data: lr(t3, 3, Jt, cr()).slice() ?? [] });
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("face_geometry", (t3) => {
      tu(this, t3);
    })), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
mc.prototype.detectForVideo = mc.prototype.H, mc.prototype.detect = mc.prototype.G, mc.prototype.setOptions = mc.prototype.v, mc.createFromModelPath = function(t2, e2) {
  return Zu(mc, t2, { baseOptions: { modelAssetPath: e2 } });
}, mc.createFromModelBuffer = function(t2, e2) {
  return Zu(mc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, mc.createFromOptions = function(t2, e2) {
  return Zu(mc, t2, e2);
}, mc.FACE_LANDMARKS_LIPS = sc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_LIPS", mc.FACE_LANDMARKS_LIPS), mc.FACE_LANDMARKS_LEFT_EYE = oc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE", mc.FACE_LANDMARKS_LEFT_EYE), mc.FACE_LANDMARKS_LEFT_EYEBROW = ac, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW", mc.FACE_LANDMARKS_LEFT_EYEBROW), mc.FACE_LANDMARKS_LEFT_IRIS = hc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS", mc.FACE_LANDMARKS_LEFT_IRIS), mc.FACE_LANDMARKS_RIGHT_EYE = uc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE", mc.FACE_LANDMARKS_RIGHT_EYE), mc.FACE_LANDMARKS_RIGHT_EYEBROW = cc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW", mc.FACE_LANDMARKS_RIGHT_EYEBROW), mc.FACE_LANDMARKS_RIGHT_IRIS = lc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS", mc.FACE_LANDMARKS_RIGHT_IRIS), mc.FACE_LANDMARKS_FACE_OVAL = dc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL", mc.FACE_LANDMARKS_FACE_OVAL), mc.FACE_LANDMARKS_CONTOURS = fc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_CONTOURS", mc.FACE_LANDMARKS_CONTOURS), mc.FACE_LANDMARKS_TESSELATION = pc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$face_landmarker$face_landmarker.FaceLandmarker.FACE_LANDMARKS_TESSELATION", mc.FACE_LANDMARKS_TESSELATION);
var vc = zu([0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]);
function _c(t2) {
  t2.gestures = [], t2.landmarks = [], t2.worldLandmarks = [], t2.handedness = [];
}
function yc(t2) {
  return 0 === t2.gestures.length ? { gestures: [], landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] } : { gestures: t2.gestures, landmarks: t2.landmarks, worldLandmarks: t2.worldLandmarks, handedness: t2.handedness, handednesses: t2.handedness };
}
function Ec(t2, e2 = true) {
  var r2 = [];
  for (let i2 of t2) {
    var n2 = wo(i2);
    t2 = [];
    for (let r3 of n2.g()) n2 = e2 && null != Or(r3, 1) ? Or(r3, 1) ?? 0 : -1, t2.push({ score: Dr(r3, 2) ?? 0, index: n2, categoryName: _e(sr(r3, 3)) ?? "" ?? "", displayName: _e(sr(r3, 4)) ?? "" ?? "" });
    r2.push(t2);
  }
  return r2;
}
var Ac = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect", false), this.gestures = [], this.landmarks = [], this.worldLandmarks = [], this.handedness = [], Ir(t2 = this.l = new da(), 0, 1, e2 = new zo()), this.u = new la(), Ir(this.l, 0, 2, this.u), this.F = new ca(), Ir(this.u, 0, 3, this.F), this.B = new ua(), Ir(this.u, 0, 2, this.B), this.h = new ha(), Ir(this.l, 0, 3, this.h), jr(this.B, 2, 0.5), jr(this.u, 4, 0.5), jr(this.F, 2, 0.5);
  }
  C() {
    return "GestureRecognizer";
  }
  get baseOptions() {
    return Sr(this.l, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.l, 0, 1, t2);
  }
  v(t2) {
    if (Ur(this.B, 3, t2.numHands ?? 1), "minHandDetectionConfidence" in t2 && jr(this.B, 2, t2.minHandDetectionConfidence ?? 0.5), "minTrackingConfidence" in t2 && jr(this.u, 4, t2.minTrackingConfidence ?? 0.5), "minHandPresenceConfidence" in t2 && jr(this.F, 2, t2.minHandPresenceConfidence ?? 0.5), t2.cannedGesturesClassifierOptions) {
      var e2 = new oa(), r2 = e2, n2 = za(t2.cannedGesturesClassifierOptions, Sr(this.h, oa, 3)?.j());
      Ir(r2, 0, 2, n2), Ir(this.h, 0, 3, e2);
    } else void 0 === t2.cannedGesturesClassifierOptions && Sr(this.h, oa, 3)?.g();
    return t2.customGesturesClassifierOptions ? (Ir(r2 = e2 = new oa(), 0, 2, n2 = za(t2.customGesturesClassifierOptions, Sr(this.h, oa, 4)?.j())), Ir(this.h, 0, 4, e2)) : void 0 === t2.customGesturesClassifierOptions && Sr(this.h, oa, 4)?.g(), this.j(t2);
  }
  Xa(t2, e2) {
    return _c(this), tc(this, t2, e2), yc(this);
  }
  Ya(t2, e2, r2) {
    return _c(this), ec(this, t2, r2, e2), yc(this);
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect"), go(t2, "hand_gestures"), go(t2, "hand_landmarks"), go(t2, "world_hand_landmarks"), go(t2, "handedness");
    var e2 = new no();
    li(e2, va, this.l);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.gesture_recognizer.GestureRecognizerGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "HAND_GESTURES:hand_gestures"), ao(r2, "LANDMARKS:hand_landmarks"), ao(r2, "WORLD_LANDMARKS:world_hand_landmarks"), ao(r2, "HANDEDNESS:handedness"), r2.v(e2), fo(t2, r2), this.g.attachProtoVectorListener("hand_landmarks", (t3, e3) => {
      for (let e4 of t3) {
        t3 = Io(e4);
        let r3 = [];
        for (let e5 of xr(t3, Ro, 1)) r3.push({ x: Dr(e5, 1) ?? 0, y: Dr(e5, 2) ?? 0, z: Dr(e5, 3) ?? 0, visibility: Dr(e5, 4) ?? 0 });
        this.landmarks.push(r3);
      }
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("hand_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoVectorListener("world_hand_landmarks", (t3, e3) => {
      for (let e4 of t3) {
        t3 = xo(e4);
        let r3 = [];
        for (let e5 of xr(t3, Lo, 1)) r3.push({ x: Dr(e5, 1) ?? 0, y: Dr(e5, 2) ?? 0, z: Dr(e5, 3) ?? 0, visibility: Dr(e5, 4) ?? 0 });
        this.worldLandmarks.push(r3);
      }
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("world_hand_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoVectorListener("hand_gestures", (t3, e3) => {
      this.gestures.push(...Ec(t3, false)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("hand_gestures", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoVectorListener("handedness", (t3, e3) => {
      this.handedness.push(...Ec(t3)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("handedness", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
function wc(t2) {
  return { landmarks: t2.landmarks, worldLandmarks: t2.worldLandmarks, handednesses: t2.handedness, handedness: t2.handedness };
}
Ac.prototype.recognizeForVideo = Ac.prototype.Ya, Ac.prototype.recognize = Ac.prototype.Xa, Ac.prototype.setOptions = Ac.prototype.v, Ac.createFromModelPath = function(t2, e2) {
  return Zu(Ac, t2, { baseOptions: { modelAssetPath: e2 } });
}, Ac.createFromModelBuffer = function(t2, e2) {
  return Zu(Ac, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Ac.createFromOptions = function(t2, e2) {
  return Zu(Ac, t2, e2);
}, Ac.HAND_CONNECTIONS = vc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$gesture_recognizer$gesture_recognizer.GestureRecognizer.HAND_CONNECTIONS", Ac.HAND_CONNECTIONS);
var bc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect", false), this.landmarks = [], this.worldLandmarks = [], this.handedness = [], Ir(t2 = this.h = new la(), 0, 1, e2 = new zo()), this.u = new ca(), Ir(this.h, 0, 3, this.u), this.l = new ua(), Ir(this.h, 0, 2, this.l), Ur(this.l, 3, 1), jr(this.l, 2, 0.5), jr(this.u, 2, 0.5), jr(this.h, 4, 0.5);
  }
  C() {
    return "HandLandmarker";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return "numHands" in t2 && Ur(this.l, 3, t2.numHands ?? 1), "minHandDetectionConfidence" in t2 && jr(this.l, 2, t2.minHandDetectionConfidence ?? 0.5), "minTrackingConfidence" in t2 && jr(this.h, 4, t2.minTrackingConfidence ?? 0.5), "minHandPresenceConfidence" in t2 && jr(this.u, 2, t2.minHandPresenceConfidence ?? 0.5), this.j(t2);
  }
  G(t2, e2) {
    return this.landmarks = [], this.worldLandmarks = [], this.handedness = [], tc(this, t2, e2), wc(this);
  }
  H(t2, e2, r2) {
    return this.landmarks = [], this.worldLandmarks = [], this.handedness = [], ec(this, t2, r2, e2), wc(this);
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect"), go(t2, "hand_landmarks"), go(t2, "world_hand_landmarks"), go(t2, "handedness");
    var e2 = new no();
    li(e2, _a, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.hand_landmarker.HandLandmarkerGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "LANDMARKS:hand_landmarks"), ao(r2, "WORLD_LANDMARKS:world_hand_landmarks"), ao(r2, "HANDEDNESS:handedness"), r2.v(e2), fo(t2, r2), this.g.attachProtoVectorListener("hand_landmarks", (t3, e3) => {
      for (let e4 of t3) t3 = Io(e4), this.landmarks.push(Qa(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("hand_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoVectorListener("world_hand_landmarks", (t3, e3) => {
      for (let e4 of t3) t3 = xo(e4), this.worldLandmarks.push(th(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("world_hand_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoVectorListener("handedness", (t3, e3) => {
      var r3 = this.handedness, n2 = r3.push, i2 = [];
      for (let e4 of t3) {
        t3 = wo(e4);
        let r4 = [];
        for (let e5 of t3.g()) r4.push({ score: Dr(e5, 2) ?? 0, index: Or(e5, 1) ?? 0 ?? -1, categoryName: _e(sr(e5, 3)) ?? "" ?? "", displayName: _e(sr(e5, 4)) ?? "" ?? "" });
        i2.push(r4);
      }
      n2.call(r3, ...i2), tu(this, e3);
    }), this.g.attachEmptyPacketListener("handedness", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
bc.prototype.detectForVideo = bc.prototype.H, bc.prototype.detect = bc.prototype.G, bc.prototype.setOptions = bc.prototype.v, bc.createFromModelPath = function(t2, e2) {
  return Zu(bc, t2, { baseOptions: { modelAssetPath: e2 } });
}, bc.createFromModelBuffer = function(t2, e2) {
  return Zu(bc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, bc.createFromOptions = function(t2, e2) {
  return Zu(bc, t2, e2);
}, bc.HAND_CONNECTIONS = vc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$hand_landmarker$hand_landmarker.HandLandmarker.HAND_CONNECTIONS", bc.HAND_CONNECTIONS);
var Tc = zu([0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]);
function kc(t2) {
  t2.h = { faceLandmarks: [], faceBlendshapes: [], poseLandmarks: [], poseWorldLandmarks: [], poseSegmentationMasks: [], leftHandLandmarks: [], leftHandWorldLandmarks: [], rightHandLandmarks: [], rightHandWorldLandmarks: [] };
}
function Sc(t2) {
  try {
    if (!t2.F) return t2.h;
    t2.F(t2.h);
  } finally {
    nu(t2);
  }
}
function Lc(t2, e2) {
  t2 = Io(t2), e2.push(Qa(t2));
}
var xc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "input_frames_image", null, false), this.h = { faceLandmarks: [], faceBlendshapes: [], poseLandmarks: [], poseWorldLandmarks: [], poseSegmentationMasks: [], leftHandLandmarks: [], leftHandWorldLandmarks: [], rightHandLandmarks: [], rightHandWorldLandmarks: [] }, this.outputPoseSegmentationMasks = this.outputFaceBlendshapes = false, Ir(t2 = this.l = new wa(), 0, 1, e2 = new zo()), this.Y = new ca(), Ir(this.l, 0, 2, this.Y), this.Aa = new ya(), Ir(this.l, 0, 3, this.Aa), this.u = new Zo(), Ir(this.l, 0, 4, this.u), this.O = new ra(), Ir(this.l, 0, 5, this.O), this.B = new Ea(), Ir(this.l, 0, 6, this.B), this.Z = new Aa(), Ir(this.l, 0, 7, this.Z), jr(this.u, 2, 0.5), jr(this.u, 3, 0.3), jr(this.O, 2, 0.5), jr(this.B, 2, 0.5), jr(this.B, 3, 0.3), jr(this.Z, 2, 0.5), jr(this.Y, 2, 0.5);
  }
  C() {
    return "HolisticLandmarker";
  }
  get baseOptions() {
    return Sr(this.l, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.l, 0, 1, t2);
  }
  v(t2) {
    return "minFaceDetectionConfidence" in t2 && jr(this.u, 2, t2.minFaceDetectionConfidence ?? 0.5), "minFaceSuppressionThreshold" in t2 && jr(this.u, 3, t2.minFaceSuppressionThreshold ?? 0.3), "minFacePresenceConfidence" in t2 && jr(this.O, 2, t2.minFacePresenceConfidence ?? 0.5), "outputFaceBlendshapes" in t2 && (this.outputFaceBlendshapes = !!t2.outputFaceBlendshapes), "minPoseDetectionConfidence" in t2 && jr(this.B, 2, t2.minPoseDetectionConfidence ?? 0.5), "minPoseSuppressionThreshold" in t2 && jr(this.B, 3, t2.minPoseSuppressionThreshold ?? 0.3), "minPosePresenceConfidence" in t2 && jr(this.Z, 2, t2.minPosePresenceConfidence ?? 0.5), "outputPoseSegmentationMasks" in t2 && (this.outputPoseSegmentationMasks = !!t2.outputPoseSegmentationMasks), "minHandLandmarksConfidence" in t2 && jr(this.Y, 2, t2.minHandLandmarksConfidence ?? 0.5), this.j(t2);
  }
  G(t2, e2, r2) {
    var n2 = "function" != typeof e2 ? e2 : {};
    return this.F = "function" == typeof e2 ? e2 : r2, kc(this), tc(this, t2, n2), Sc(this);
  }
  H(t2, e2, r2, n2) {
    var i2 = "function" != typeof r2 ? r2 : {};
    return this.F = "function" == typeof r2 ? r2 : n2, kc(this), ec(this, t2, i2, e2), Sc(this);
  }
  o() {
    var t2 = new mo();
    po(t2, "input_frames_image"), go(t2, "pose_landmarks"), go(t2, "pose_world_landmarks"), go(t2, "face_landmarks"), go(t2, "left_hand_landmarks"), go(t2, "left_hand_world_landmarks"), go(t2, "right_hand_landmarks"), go(t2, "right_hand_world_landmarks");
    var e2 = new no(), r2 = new Bs();
    Hr(r2, 1, "type.googleapis.com/mediapipe.tasks.vision.holistic_landmarker.proto.HolisticLandmarkerGraphOptions"), (function(t3, e3) {
      if (null != e3) if (Array.isArray(e3)) ar(t3, 2, Ge(e3, 0, Ve));
      else {
        if (!("string" == typeof e3 || e3 instanceof N || x(e3))) throw Error("invalid value in Any.value field: " + e3 + " expected a ByteString, a base64 encoded string, a Uint8Array or a jspb array");
        _r(t3, 2, ct(e3, false), I());
      }
    })(r2, this.l.g());
    var n2 = new ho();
    Hr(n2, 2, "mediapipe.tasks.vision.holistic_landmarker.HolisticLandmarkerGraph"), Mr(n2, 8, Bs, r2), oo(n2, "IMAGE:input_frames_image"), ao(n2, "POSE_LANDMARKS:pose_landmarks"), ao(n2, "POSE_WORLD_LANDMARKS:pose_world_landmarks"), ao(n2, "FACE_LANDMARKS:face_landmarks"), ao(n2, "LEFT_HAND_LANDMARKS:left_hand_landmarks"), ao(n2, "LEFT_HAND_WORLD_LANDMARKS:left_hand_world_landmarks"), ao(n2, "RIGHT_HAND_LANDMARKS:right_hand_landmarks"), ao(n2, "RIGHT_HAND_WORLD_LANDMARKS:right_hand_world_landmarks"), n2.v(e2), fo(t2, n2), eu(this, t2), this.g.attachProtoListener("pose_landmarks", (t3, e3) => {
      Lc(t3, this.h.poseLandmarks), tu(this, e3);
    }), this.g.attachEmptyPacketListener("pose_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoListener("pose_world_landmarks", (t3, e3) => {
      var r3 = this.h.poseWorldLandmarks;
      t3 = xo(t3), r3.push(th(t3)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("pose_world_landmarks", (t3) => {
      tu(this, t3);
    }), this.outputPoseSegmentationMasks && (ao(n2, "POSE_SEGMENTATION_MASK:pose_segmentation_mask"), ru(this, "pose_segmentation_mask"), this.g.ga("pose_segmentation_mask", (t3, e3) => {
      this.h.poseSegmentationMasks = [rc(this, t3, true, !this.F)], tu(this, e3);
    }), this.g.attachEmptyPacketListener("pose_segmentation_mask", (t3) => {
      this.h.poseSegmentationMasks = [], tu(this, t3);
    })), this.g.attachProtoListener("face_landmarks", (t3, e3) => {
      Lc(t3, this.h.faceLandmarks), tu(this, e3);
    }), this.g.attachEmptyPacketListener("face_landmarks", (t3) => {
      tu(this, t3);
    }), this.outputFaceBlendshapes && (go(t2, "extra_blendshapes"), ao(n2, "FACE_BLENDSHAPES:extra_blendshapes"), this.g.attachProtoListener("extra_blendshapes", (t3, e3) => {
      var r3 = this.h.faceBlendshapes;
      this.outputFaceBlendshapes && (t3 = wo(t3), r3.push(qa(t3.g() ?? []))), tu(this, e3);
    }), this.g.attachEmptyPacketListener("extra_blendshapes", (t3) => {
      tu(this, t3);
    })), this.g.attachProtoListener("left_hand_landmarks", (t3, e3) => {
      Lc(t3, this.h.leftHandLandmarks), tu(this, e3);
    }), this.g.attachEmptyPacketListener("left_hand_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoListener("left_hand_world_landmarks", (t3, e3) => {
      var r3 = this.h.leftHandWorldLandmarks;
      t3 = xo(t3), r3.push(th(t3)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("left_hand_world_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoListener("right_hand_landmarks", (t3, e3) => {
      Lc(t3, this.h.rightHandLandmarks), tu(this, e3);
    }), this.g.attachEmptyPacketListener("right_hand_landmarks", (t3) => {
      tu(this, t3);
    }), this.g.attachProtoListener("right_hand_world_landmarks", (t3, e3) => {
      var r3 = this.h.rightHandWorldLandmarks;
      t3 = xo(t3), r3.push(th(t3)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("right_hand_world_landmarks", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
xc.prototype.detectForVideo = xc.prototype.H, xc.prototype.detect = xc.prototype.G, xc.prototype.setOptions = xc.prototype.v, xc.createFromModelPath = function(t2, e2) {
  return Zu(xc, t2, { baseOptions: { modelAssetPath: e2 } });
}, xc.createFromModelBuffer = function(t2, e2) {
  return Zu(xc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, xc.createFromOptions = function(t2, e2) {
  return Zu(xc, t2, e2);
}, xc.HAND_CONNECTIONS = vc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.HAND_CONNECTIONS", xc.HAND_CONNECTIONS), xc.POSE_CONNECTIONS = Tc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.POSE_CONNECTIONS", xc.POSE_CONNECTIONS), xc.FACE_LANDMARKS_LIPS = sc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_LIPS", xc.FACE_LANDMARKS_LIPS), xc.FACE_LANDMARKS_LEFT_EYE = oc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_LEFT_EYE", xc.FACE_LANDMARKS_LEFT_EYE), xc.FACE_LANDMARKS_LEFT_EYEBROW = ac, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_LEFT_EYEBROW", xc.FACE_LANDMARKS_LEFT_EYEBROW), xc.FACE_LANDMARKS_LEFT_IRIS = hc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_LEFT_IRIS", xc.FACE_LANDMARKS_LEFT_IRIS), xc.FACE_LANDMARKS_RIGHT_EYE = uc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_RIGHT_EYE", xc.FACE_LANDMARKS_RIGHT_EYE), xc.FACE_LANDMARKS_RIGHT_EYEBROW = cc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW", xc.FACE_LANDMARKS_RIGHT_EYEBROW), xc.FACE_LANDMARKS_RIGHT_IRIS = lc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_RIGHT_IRIS", xc.FACE_LANDMARKS_RIGHT_IRIS), xc.FACE_LANDMARKS_FACE_OVAL = dc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_FACE_OVAL", xc.FACE_LANDMARKS_FACE_OVAL), xc.FACE_LANDMARKS_CONTOURS = fc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_CONTOURS", xc.FACE_LANDMARKS_CONTOURS), xc.FACE_LANDMARKS_TESSELATION = pc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$holistic_landmarker$holistic_landmarker.HolisticLandmarker.FACE_LANDMARKS_TESSELATION", xc.FACE_LANDMARKS_TESSELATION);
var Rc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "input_image", "norm_rect", true), this.l = { classifications: [] }, Ir(t2 = this.h = new ka(), 0, 1, e2 = new zo());
  }
  C() {
    return "ImageClassifier";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return Ir(this.h, 0, 2, za(t2, Sr(this.h, Go, 2))), this.j(t2);
  }
  Ga(t2, e2) {
    return this.l = { classifications: [] }, tc(this, t2, e2), this.l;
  }
  Ha(t2, e2, r2) {
    return this.l = { classifications: [] }, ec(this, t2, r2, e2), this.l;
  }
  o() {
    var t2 = new mo();
    po(t2, "input_image"), po(t2, "norm_rect"), go(t2, "classifications");
    var e2 = new no();
    li(e2, Sa, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.image_classifier.ImageClassifierGraph"), oo(r2, "IMAGE:input_image"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "CLASSIFICATIONS:classifications"), r2.v(e2), fo(t2, r2), this.g.attachProtoListener("classifications", (t3, e3) => {
      this.l = Ja(Oo(t3)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("classifications", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
Rc.prototype.classifyForVideo = Rc.prototype.Ha, Rc.prototype.classify = Rc.prototype.Ga, Rc.prototype.setOptions = Rc.prototype.v, Rc.createFromModelPath = function(t2, e2) {
  return Zu(Rc, t2, { baseOptions: { modelAssetPath: e2 } });
}, Rc.createFromModelBuffer = function(t2, e2) {
  return Zu(Rc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Rc.createFromOptions = function(t2, e2) {
  return Zu(Rc, t2, e2);
};
var Ic = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect", true), this.h = new La(), this.embeddings = { embeddings: [] }, Ir(t2 = this.h, 0, 1, e2 = new zo());
  }
  C() {
    return "ImageEmbedder";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    var e2 = this.h, r2 = Sr(this.h, Vo, 2);
    if (r2 = r2 ? r2.clone() : new Vo(), void 0 !== t2.l2Normalize) {
      var n2 = t2.l2Normalize;
      ar(r2, 1, null == n2 ? n2 : Zt(n2));
    } else "l2Normalize" in t2 && ar(r2, 1);
    return void 0 !== t2.quantize ? ar(r2, 2, null == (n2 = t2.quantize) ? n2 : Zt(n2)) : "quantize" in t2 && ar(r2, 2), Ir(e2, 0, 2, r2), this.j(t2);
  }
  Na(t2, e2) {
    return tc(this, t2, e2), this.embeddings;
  }
  Oa(t2, e2, r2) {
    return ec(this, t2, r2, e2), this.embeddings;
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect"), go(t2, "embeddings_out");
    var e2 = new no();
    li(e2, xa, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.image_embedder.ImageEmbedderGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "EMBEDDINGS:embeddings_out"), r2.v(e2), fo(t2, r2), this.g.attachProtoListener("embeddings_out", (t3, e3) => {
      t3 = Bo(t3), this.embeddings = (function(t4) {
        return { embeddings: xr(t4, $o, 1).map((t5) => {
          var e4 = { headIndex: Or(t5, 3) ?? 0 ?? -1, headName: _e(sr(t5, 4)) ?? "" ?? "" };
          if (ur(t5, Do, 1, Uo)) t5 = lr(t5 = Pr(t5, Do, 1), 1, Jt, cr()), e4.floatEmbedding = t5.slice();
          else {
            let r3 = new Uint8Array(0);
            e4.quantizedEmbedding = Pr(t5, Po, 2)?.g()?.h() ?? r3;
          }
          return e4;
        }), timestampMs: Ya(sr(t4, 2, void 0, fe) ?? nr) };
      })(t3), tu(this, e3);
    }), this.g.attachEmptyPacketListener("embeddings_out", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
Ic.cosineSimilarity = function(t2, e2) {
  if (t2.floatEmbedding && e2.floatEmbedding) t2 = rh(t2.floatEmbedding, e2.floatEmbedding);
  else {
    if (!t2.quantizedEmbedding || !e2.quantizedEmbedding) throw Error("Cannot compute cosine similarity between quantized and float embeddings.");
    t2 = rh(eh(t2.quantizedEmbedding), eh(e2.quantizedEmbedding));
  }
  return t2;
}, Ic.prototype.embedForVideo = Ic.prototype.Oa, Ic.prototype.embed = Ic.prototype.Na, Ic.prototype.setOptions = Ic.prototype.v, Ic.createFromModelPath = function(t2, e2) {
  return Zu(Ic, t2, { baseOptions: { modelAssetPath: e2 } });
}, Ic.createFromModelBuffer = function(t2, e2) {
  return Zu(Ic, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Ic.createFromOptions = function(t2, e2) {
  return Zu(Ic, t2, e2);
};
var Fc = class {
  constructor(t2, e2, r2) {
    this.confidenceMasks = t2, this.categoryMask = e2, this.qualityScores = r2;
  }
  close() {
    this.confidenceMasks?.forEach((t2) => {
      t2.close();
    }), this.categoryMask?.close();
  }
};
function Cc(t2) {
  var e2 = (function(t3) {
    return xr(t3, ho, 1);
  })(t2.ja()).filter((t3) => (_e(sr(t3, 1)) ?? "").includes("mediapipe.tasks.TensorsToSegmentationCalculator"));
  if (t2.u = [], e2.length > 1) throw Error("The graph has more than one mediapipe.tasks.TensorsToSegmentationCalculator.");
  1 === e2.length && (Sr(e2[0], no, 7)?.o()?.g() ?? /* @__PURE__ */ new Map()).forEach((e3, r2) => {
    t2.u[Number(r2)] = _e(sr(e3, 1)) ?? "";
  });
}
function Nc(t2) {
  t2.categoryMask = void 0, t2.confidenceMasks = void 0, t2.qualityScores = void 0;
}
function Mc(t2) {
  try {
    let e2 = new Fc(t2.confidenceMasks, t2.categoryMask, t2.qualityScores);
    if (!t2.l) return e2;
    t2.l(e2);
  } finally {
    nu(t2);
  }
}
Fc.prototype.close = Fc.prototype.close;
var Oc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect", false), this.u = [], this.outputCategoryMask = false, this.outputConfidenceMasks = true, this.h = new Na(), this.B = new Ra(), Ir(this.h, 0, 3, this.B), Ir(t2 = this.h, 0, 1, e2 = new zo());
  }
  C() {
    return "ImageSegmenter";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return void 0 !== t2.displayNamesLocale ? ar(this.h, 2, ve(t2.displayNamesLocale)) : "displayNamesLocale" in t2 && ar(this.h, 2), "outputCategoryMask" in t2 && (this.outputCategoryMask = t2.outputCategoryMask ?? false), "outputConfidenceMasks" in t2 && (this.outputConfidenceMasks = t2.outputConfidenceMasks ?? true), super.j(t2);
  }
  L() {
    Cc(this);
  }
  segment(t2, e2, r2) {
    var n2 = "function" != typeof e2 ? e2 : {};
    return this.l = "function" == typeof e2 ? e2 : r2, Nc(this), tc(this, t2, n2), Mc(this);
  }
  eb(t2, e2, r2, n2) {
    var i2 = "function" != typeof r2 ? r2 : {};
    return this.l = "function" == typeof r2 ? r2 : n2, Nc(this), ec(this, t2, i2, e2), Mc(this);
  }
  Ra() {
    return this.u;
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect");
    var e2 = new no();
    li(e2, Ma, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.image_segmenter.ImageSegmenterGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect"), r2.v(e2), fo(t2, r2), eu(this, t2), this.outputConfidenceMasks && (go(t2, "confidence_masks"), ao(r2, "CONFIDENCE_MASKS:confidence_masks"), ru(this, "confidence_masks"), this.g.ha("confidence_masks", (t3, e3) => {
      this.confidenceMasks = t3.map((t4) => rc(this, t4, true, !this.l)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("confidence_masks", (t3) => {
      this.confidenceMasks = [], tu(this, t3);
    })), this.outputCategoryMask && (go(t2, "category_mask"), ao(r2, "CATEGORY_MASK:category_mask"), ru(this, "category_mask"), this.g.ga("category_mask", (t3, e3) => {
      this.categoryMask = rc(this, t3, false, !this.l), tu(this, e3);
    }), this.g.attachEmptyPacketListener("category_mask", (t3) => {
      this.categoryMask = void 0, tu(this, t3);
    })), go(t2, "quality_scores"), ao(r2, "QUALITY_SCORES:quality_scores"), this.g.attachFloatVectorListener("quality_scores", (t3, e3) => {
      this.qualityScores = t3, tu(this, e3);
    }), this.g.attachEmptyPacketListener("quality_scores", (t3) => {
      this.categoryMask = void 0, tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
Oc.prototype.getLabels = Oc.prototype.Ra, Oc.prototype.segmentForVideo = Oc.prototype.eb, Oc.prototype.segment = Oc.prototype.segment, Oc.prototype.setOptions = Oc.prototype.v, Oc.createFromModelPath = function(t2, e2) {
  return Zu(Oc, t2, { baseOptions: { modelAssetPath: e2 } });
}, Oc.createFromModelBuffer = function(t2, e2) {
  return Zu(Oc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Oc.createFromOptions = function(t2, e2) {
  return Zu(Oc, t2, e2);
};
var Dc = { 0: 0, 1: 1, 2: 2, 3: 3 };
function Pc() {
  return Ph() ? void 0 : document.createElement("canvas");
}
var $c = class extends iu {
  constructor(t2, e2) {
    super(new Yh(t2, e2)), this.u = new pu(), this.delegate = "CPU", this.h = 0, this.baseOptions = new zo(), this.B = this.l = 0;
  }
  C() {
    return "InteractiveSegmenter";
  }
  get i() {
    return this.g.i;
  }
  v(t2) {
    return this.delegate = t2.baseOptions?.delegate ?? "CPU", super.j(t2);
  }
  fb(t2) {
    if (0 === this.h) throw Error("Segmenter is not initialized.");
    var e2;
    if (0 !== this.l && (this.i._free(this.l), this.l = 0), !(e2 = "undefined" != typeof ImageData && t2 instanceof ImageData)) if ("object" != typeof t2 || null === t2) e2 = false;
    else {
      e2 = t2.data;
      var r2 = t2.width, n2 = t2.height;
      e2 = Number.isInteger(r2) && r2 > 0 && Number.isInteger(n2) && n2 > 0 && (e2 instanceof Uint8ClampedArray || e2 instanceof Uint8Array);
    }
    if (e2) e2 = t2.width, r2 = t2.height, t2 = t2.data;
    else {
      if ([e2, r2] = Uh(t2), "undefined" != typeof OffscreenCanvas) n2 = new OffscreenCanvas(e2, r2);
      else {
        if ("undefined" == typeof document) throw Error("Canvas is not supported in this environment.");
        n2 = document.createElement("canvas");
      }
      if (n2.width = e2, n2.height = r2, !(n2 = n2.getContext("2d"))) throw Error("Canvas 2D context is not supported in this environment.");
      n2.drawImage(t2, 0, 0), t2 = n2.getImageData(0, 0, e2, r2).data;
    }
    if (!t2) throw Error("Unsupported image source or failed to extract image pixels.");
    n2 = (function({ Wa: t3, width: e3, height: r3 }) {
      if (e3 <= 0 || r3 <= 0) throw Error(`Invalid image dimensions: ${e3}x${r3}. Dimensions must be positive.`);
      if (t3 % (e3 * r3) !== 0) throw Error(`Invalid image dimensions or pixel data length. Pixel data length ${t3} is not a multiple of the number of pixels (${e3 * r3}).`);
      if (4 !== (t3 /= e3 * r3) && 3 !== t3 && 1 !== t3) throw Error(`Invalid image dimensions or pixel data length. Calculated channels: ${t3}. Expected 1, 3, or 4.`);
      return t3;
    })({ Wa: t2.length, width: e2, height: r2 });
    var i2 = this.i._malloc(t2.length);
    if (this.i.HEAPU8.set(t2, i2), this.l = i2, !this.i._interactive_segmenter_set_image(this.h, i2, e2, r2, n2)) throw Error("Failed to set image on native engine.");
  }
  segment(t2) {
    if (0 === this.h) throw Error("Segmenter is not initialized.");
    var e2 = (function(t3) {
      t3 = t3.map(({ isCompleted: t4, brushMode: e4, point: r3 }) => {
        e4 = Dc[e4] ?? 0, r3 = r3.map(({ x: t5, y: e5 }) => {
          var r4 = new Oa();
          return Vr(r4, 1, t5), Vr(r4, 2, e5), r4;
        });
        var n3 = new Da();
        return $r(n3, t4), _r(n3, 1, ee(e4), 0), Cr(n3, 2, r3), n3;
      });
      var e3 = new Pa();
      return Cr(e3, 1, t3), $a(e3);
    })(t2);
    t2 = this.i._malloc(e2.length), this.i.HEAPU8.set(e2, t2);
    var r2 = this.i._malloc(12), n2 = r2 + 4, i2 = r2 + 8, s2 = 0, o2 = this.B++;
    try {
      if (this.m) if ("GPU" === this.delegate) {
        var a2 = this.m;
        ++a2.g.T, a2.h.set(o2, performance.now());
      } else {
        var h2 = this.m;
        ++h2.g.P, h2.h.set(o2, performance.now());
      }
      if (0 === (s2 = this.i._interactive_segmenter_segment(this.h, t2, e2.length, r2, n2, i2))) throw Error("Segmentation failed.");
      this.m?.za(o2);
      let c2 = this.i.HEAPU32[r2 / 4], l2 = this.i.HEAPU32[n2 / 4], d2 = new Float32Array(this.i.HEAPU8.buffer, s2, this.i.HEAPU32[i2 / 4] / 4);
      var u2 = new Float32Array(d2);
      if (a2 = c2 * l2, (u2 instanceof Uint8Array || u2 instanceof Float32Array) && u2.length !== a2) throw Error("Unsupported channel count: " + u2.length / a2);
      return new Su([u2], true, false, this.g.i.canvas ?? void 0, this.u, c2, l2);
    } finally {
      0 !== t2 && this.i._free(t2), 0 !== r2 && this.i._free(r2), 0 !== s2 && this.i._free(s2);
    }
  }
  o() {
    0 !== this.h && (this.m?.xa(), this.i._interactive_segmenter_close(this.h), this.h = 0), 0 !== this.l && (this.i._free(this.l), this.l = 0);
    var t2 = new Ko();
    if ("GPU" === this.delegate) {
      var e2 = new Ys();
      Fr(t2, 2, Xo, e2);
    } else Ur(e2 = new eo(), 1, 4), Fr(t2, 1, Xo, e2);
    if (Ir(this.baseOptions, 0, 3, t2), t2 = Jo(this.baseOptions), e2 = this.i._malloc(t2.length), this.i.HEAPU8.set(t2, e2), this.h = this.i._interactive_segmenter_create(e2, t2.length), this.i._free(e2), 0 === this.h) throw Error("Failed to create native InteractiveSegmenter engine.");
    this.m?.ya();
  }
  close() {
    0 !== this.h && (this.i._interactive_segmenter_close(this.h), this.h = 0), 0 !== this.l && (this.i._free(this.l), this.l = 0), this.u.close(), super.close();
  }
};
$c.prototype.close = $c.prototype.close, $c.prototype.segment = $c.prototype.segment, $c.prototype.setImage = $c.prototype.fb, $c.prototype.setOptions = $c.prototype.v, $c.createFromModelPath = function(t2, e2) {
  return Jh($c, Pc(), t2, { baseOptions: { modelAssetPath: e2 } });
}, $c.createFromModelBuffer = function(t2, e2) {
  return Jh($c, Pc(), t2, { baseOptions: { modelAssetBuffer: e2 } });
}, $c.createFromOptions = function(t2, e2) {
  var r2 = e2.canvas ?? Pc();
  return Jh($c, r2, t2, e2);
};
var Uc = class {
  constructor(t2, e2, r2) {
    this.confidenceMasks = t2, this.categoryMask = e2, this.qualityScores = r2;
  }
  close() {
    this.confidenceMasks?.forEach((t2) => {
      t2.close();
    }), this.categoryMask?.close();
  }
};
Uc.prototype.close = Uc.prototype.close;
var Bc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect_in", false), this.outputCategoryMask = false, this.outputConfidenceMasks = true, this.h = new Na(), this.u = new Ra(), Ir(this.h, 0, 3, this.u), Ir(t2 = this.h, 0, 1, e2 = new zo());
  }
  C() {
    return "InteractiveSegmenterLegacy";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return "outputCategoryMask" in t2 && (this.outputCategoryMask = t2.outputCategoryMask ?? false), "outputConfidenceMasks" in t2 && (this.outputConfidenceMasks = t2.outputConfidenceMasks ?? true), super.j(t2);
  }
  segment(t2, e2, r2, n2) {
    var i2 = "function" != typeof r2 ? r2 : {};
    if (this.l = "function" == typeof r2 ? r2 : n2, this.qualityScores = this.categoryMask = this.confidenceMasks = void 0, r2 = this.I + 1, n2 = new ja(), e2.keypoint && e2.scribble) throw Error("Cannot provide both keypoint and scribble.");
    if (e2.keypoint) {
      var s2 = new Ua();
      $r(s2, true), Vr(s2, 1, e2.keypoint.x), Vr(s2, 2, e2.keypoint.y), Fr(n2, 1, Va, s2);
    } else {
      if (!e2.scribble) throw Error("Must provide either a keypoint or a scribble.");
      {
        let t3 = new Ga();
        for (s2 of e2.scribble) $r(e2 = new Ua(), true), Vr(e2, 1, s2.x), Vr(e2, 2, s2.y), Mr(t3, 1, Ua, e2);
        Fr(n2, 2, Va, t3);
      }
    }
    this.g.addProtoToStream(n2.g(), "mediapipe.tasks.vision.interactive_segmenter_legacy.proto.RegionOfInterest", "roi_in", r2), tc(this, t2, i2);
    t: {
      try {
        let t3 = new Uc(this.confidenceMasks, this.categoryMask, this.qualityScores);
        if (!this.l) {
          var o2 = t3;
          break t;
        }
        this.l(t3);
      } finally {
        nu(this);
      }
      o2 = void 0;
    }
    return o2;
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "roi_in"), po(t2, "norm_rect_in");
    var e2 = new no();
    li(e2, Ma, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.interactive_segmenter_legacy.InteractiveSegmenterGraphV2"), oo(r2, "IMAGE:image_in"), oo(r2, "ROI:roi_in"), oo(r2, "NORM_RECT:norm_rect_in"), r2.v(e2), fo(t2, r2), eu(this, t2), this.outputConfidenceMasks && (go(t2, "confidence_masks"), ao(r2, "CONFIDENCE_MASKS:confidence_masks"), ru(this, "confidence_masks"), this.g.ha("confidence_masks", (t3, e3) => {
      this.confidenceMasks = t3.map((t4) => rc(this, t4, true, !this.l)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("confidence_masks", (t3) => {
      this.confidenceMasks = [], tu(this, t3);
    })), this.outputCategoryMask && (go(t2, "category_mask"), ao(r2, "CATEGORY_MASK:category_mask"), ru(this, "category_mask"), this.g.ga("category_mask", (t3, e3) => {
      this.categoryMask = rc(this, t3, false, !this.l), tu(this, e3);
    }), this.g.attachEmptyPacketListener("category_mask", (t3) => {
      this.categoryMask = void 0, tu(this, t3);
    })), go(t2, "quality_scores"), ao(r2, "QUALITY_SCORES:quality_scores"), this.g.attachFloatVectorListener("quality_scores", (t3, e3) => {
      this.qualityScores = t3, tu(this, e3);
    }), this.g.attachEmptyPacketListener("quality_scores", (t3) => {
      this.categoryMask = void 0, tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
Bc.prototype.segment = Bc.prototype.segment, Bc.prototype.setOptions = Bc.prototype.v, Bc.createFromModelPath = function(t2, e2) {
  return Zu(Bc, t2, { baseOptions: { modelAssetPath: e2 } });
}, Bc.createFromModelBuffer = function(t2, e2) {
  return Zu(Bc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Bc.createFromOptions = function(t2, e2) {
  return Zu(Bc, t2, e2);
};
var Gc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "input_frame_gpu", "norm_rect", false), this.l = { detections: [] }, Ir(t2 = this.h = new Ha(), 0, 1, e2 = new zo());
  }
  C() {
    return "ObjectDetector";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return void 0 !== t2.displayNamesLocale ? ar(this.h, 2, ve(t2.displayNamesLocale)) : "displayNamesLocale" in t2 && ar(this.h, 2), void 0 !== t2.maxResults ? Ur(this.h, 3, t2.maxResults) : "maxResults" in t2 && ar(this.h, 3), void 0 !== t2.scoreThreshold ? jr(this.h, 4, t2.scoreThreshold) : "scoreThreshold" in t2 && ar(this.h, 4), void 0 !== t2.categoryAllowlist ? Kr(this.h, 5, t2.categoryAllowlist) : "categoryAllowlist" in t2 && ar(this.h, 5), void 0 !== t2.categoryDenylist ? Kr(this.h, 6, t2.categoryDenylist) : "categoryDenylist" in t2 && ar(this.h, 6), this.j(t2);
  }
  G(t2, e2) {
    return this.l = { detections: [] }, tc(this, t2, e2), this.l;
  }
  H(t2, e2, r2) {
    return this.l = { detections: [] }, ec(this, t2, r2, e2), this.l;
  }
  o() {
    var t2 = new mo();
    po(t2, "input_frame_gpu"), po(t2, "norm_rect"), go(t2, "detections");
    var e2 = new no();
    li(e2, Ka, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.ObjectDetectorGraph"), oo(r2, "IMAGE:input_frame_gpu"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "DETECTIONS:detections"), r2.v(e2), fo(t2, r2), this.g.attachProtoVectorListener("detections", (t3, e3) => {
      for (let e4 of t3) t3 = So(e4), this.l.detections.push(Za(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("detections", (t3) => {
      tu(this, t3);
    }), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
Gc.prototype.detectForVideo = Gc.prototype.H, Gc.prototype.detect = Gc.prototype.G, Gc.prototype.setOptions = Gc.prototype.v, Gc.createFromModelPath = async function(t2, e2) {
  return Zu(Gc, t2, { baseOptions: { modelAssetPath: e2 } });
}, Gc.createFromModelBuffer = function(t2, e2) {
  return Zu(Gc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Gc.createFromOptions = function(t2, e2) {
  return Zu(Gc, t2, e2);
};
var jc = class {
  constructor(t2, e2, r2) {
    this.landmarks = t2, this.worldLandmarks = e2, this.segmentationMasks = r2;
  }
  close() {
    this.segmentationMasks?.forEach((t2) => {
      t2.close();
    });
  }
};
function Vc(t2) {
  t2.landmarks = [], t2.worldLandmarks = [], t2.segmentationMasks = void 0;
}
function Hc(t2) {
  try {
    let e2 = new jc(t2.landmarks, t2.worldLandmarks, t2.segmentationMasks);
    if (!t2.u) return e2;
    t2.u(e2);
  } finally {
    nu(t2);
  }
}
jc.prototype.close = jc.prototype.close;
var Kc = class extends nc {
  constructor(t2, e2) {
    super(new Ju(t2, e2), "image_in", "norm_rect", false), this.landmarks = [], this.worldLandmarks = [], this.outputSegmentationMasks = false, Ir(t2 = this.h = new Xa(), 0, 1, e2 = new zo()), this.B = new Aa(), Ir(this.h, 0, 3, this.B), this.l = new Ea(), Ir(this.h, 0, 2, this.l), Ur(this.l, 4, 1), jr(this.l, 2, 0.5), jr(this.B, 2, 0.5), jr(this.h, 4, 0.5);
  }
  C() {
    return "PoseLandmarker";
  }
  get baseOptions() {
    return Sr(this.h, zo, 1);
  }
  set baseOptions(t2) {
    Ir(this.h, 0, 1, t2);
  }
  v(t2) {
    return "numPoses" in t2 && Ur(this.l, 4, t2.numPoses ?? 1), "minPoseDetectionConfidence" in t2 && jr(this.l, 2, t2.minPoseDetectionConfidence ?? 0.5), "minTrackingConfidence" in t2 && jr(this.h, 4, t2.minTrackingConfidence ?? 0.5), "minPosePresenceConfidence" in t2 && jr(this.B, 2, t2.minPosePresenceConfidence ?? 0.5), "outputSegmentationMasks" in t2 && (this.outputSegmentationMasks = t2.outputSegmentationMasks ?? false), this.j(t2);
  }
  G(t2, e2, r2) {
    var n2 = "function" != typeof e2 ? e2 : {};
    return this.u = "function" == typeof e2 ? e2 : r2, Vc(this), tc(this, t2, n2), Hc(this);
  }
  H(t2, e2, r2, n2) {
    var i2 = "function" != typeof r2 ? r2 : {};
    return this.u = "function" == typeof r2 ? r2 : n2, Vc(this), ec(this, t2, i2, e2), Hc(this);
  }
  o() {
    var t2 = new mo();
    po(t2, "image_in"), po(t2, "norm_rect"), go(t2, "normalized_landmarks"), go(t2, "world_landmarks"), go(t2, "segmentation_masks");
    var e2 = new no();
    li(e2, Wa, this.h);
    var r2 = new ho();
    Hr(r2, 2, "mediapipe.tasks.vision.pose_landmarker.PoseLandmarkerGraph"), oo(r2, "IMAGE:image_in"), oo(r2, "NORM_RECT:norm_rect"), ao(r2, "NORM_LANDMARKS:normalized_landmarks"), ao(r2, "WORLD_LANDMARKS:world_landmarks"), r2.v(e2), fo(t2, r2), eu(this, t2), this.g.attachProtoVectorListener("normalized_landmarks", (t3, e3) => {
      this.landmarks = [];
      for (let e4 of t3) t3 = Io(e4), this.landmarks.push(Qa(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("normalized_landmarks", (t3) => {
      this.landmarks = [], tu(this, t3);
    }), this.g.attachProtoVectorListener("world_landmarks", (t3, e3) => {
      this.worldLandmarks = [];
      for (let e4 of t3) t3 = xo(e4), this.worldLandmarks.push(th(t3));
      tu(this, e3);
    }), this.g.attachEmptyPacketListener("world_landmarks", (t3) => {
      this.worldLandmarks = [], tu(this, t3);
    }), this.outputSegmentationMasks && (ao(r2, "SEGMENTATION_MASK:segmentation_masks"), ru(this, "segmentation_masks"), this.g.ha("segmentation_masks", (t3, e3) => {
      this.segmentationMasks = t3.map((t4) => rc(this, t4, true, !this.u)), tu(this, e3);
    }), this.g.attachEmptyPacketListener("segmentation_masks", (t3) => {
      this.segmentationMasks = [], tu(this, t3);
    })), t2 = t2.g(), this.setGraph(new Uint8Array(t2), true);
  }
};
Kc.prototype.detectForVideo = Kc.prototype.H, Kc.prototype.detect = Kc.prototype.G, Kc.prototype.setOptions = Kc.prototype.v, Kc.createFromModelPath = function(t2, e2) {
  return Zu(Kc, t2, { baseOptions: { modelAssetPath: e2 } });
}, Kc.createFromModelBuffer = function(t2, e2) {
  return Zu(Kc, t2, { baseOptions: { modelAssetBuffer: e2 } });
}, Kc.createFromOptions = function(t2, e2) {
  return Zu(Kc, t2, e2);
}, Kc.POSE_CONNECTIONS = Tc, r("module$exports$google3$third_party$mediapipe$tasks$web$vision$pose_landmarker$pose_landmarker.PoseLandmarker.POSE_CONNECTIONS", Kc.POSE_CONNECTIONS);

// src/face/faceLandmarker.ts
var logger3 = createLogger("FACE");
var EMPTY_LANDMARKS = Object.freeze([]);
var FaceLandmarker = class {
  constructor(assetOverrides = {}) {
    this.assetOverrides = assetOverrides;
  }
  assetOverrides;
  lifecycle = "CREATED";
  mediaPipeLandmarker = null;
  initializationPromise = null;
  /**
   * Incremented whenever dispose() invalidates in-flight initialization work.
   */
  lifecycleGeneration = 0;
  lastInferenceTimestampMs = null;
  /* ========================================================================
   * Initialization
   * ====================================================================== */
  initialize() {
    if (this.lifecycle === "READY") {
      return Promise.resolve();
    }
    if (this.lifecycle === "DISPOSED") {
      return Promise.reject(
        new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "FACE",
          "Disposed FaceLandmarker cannot be initialized."
        )
      );
    }
    if (this.initializationPromise !== null) {
      return this.initializationPromise;
    }
    this.lifecycle = "INITIALIZING";
    const generation = this.lifecycleGeneration;
    const initialization = this.initializeInternal(
      generation
    ).catch(
      (error) => {
        if (this.lifecycle !== "DISPOSED") {
          this.lifecycle = "ERROR";
        }
        throw error;
      }
    ).finally(
      () => {
        if (this.initializationPromise === initialization) {
          this.initializationPromise = null;
        }
      }
    );
    this.initializationPromise = initialization;
    return initialization;
  }
  async initializeInternal(generation) {
    const wasmBaseUrl = this.resolveWasmBaseUrl();
    const modelAssetUrl = this.resolveModelAssetUrl();
    let wasmFileset;
    try {
      wasmFileset = await ah.forVisionTasks(
        wasmBaseUrl
      );
    } catch (error) {
      throw new TrackerError(
        ERROR_CODES.WASM_LOAD_FAILED,
        "FACE",
        "MediaPipe Vision WASM files could not be loaded.",
        {
          recoverable: false,
          cause: error,
          details: {
            wasmBaseUrl,
            originalMessage: getUnknownErrorMessage(
              error
            )
          }
        }
      );
    }
    this.assertInitializationCurrent(
      generation
    );
    const options = {
      baseOptions: {
        modelAssetPath: modelAssetUrl,
        delegate: FACE_LANDMARKER_RUNTIME.DELEGATE
      },
      runningMode: "VIDEO",
      numFaces: FACE_LANDMARKER_RUNTIME.NUM_FACES,
      minFaceDetectionConfidence: FACE_LANDMARKER_RUNTIME.MIN_FACE_DETECTION_CONFIDENCE,
      minFacePresenceConfidence: FACE_LANDMARKER_RUNTIME.MIN_FACE_PRESENCE_CONFIDENCE,
      minTrackingConfidence: FACE_LANDMARKER_RUNTIME.MIN_TRACKING_CONFIDENCE,
      outputFaceBlendshapes: FACE_LANDMARKER_RUNTIME.OUTPUT_FACE_BLENDSHAPES,
      outputFacialTransformationMatrixes: FACE_LANDMARKER_RUNTIME.OUTPUT_FACIAL_TRANSFORMATION_MATRIXES
    };
    let createdLandmarker;
    try {
      createdLandmarker = await mc.createFromOptions(
        wasmFileset,
        options
      );
    } catch (error) {
      throw new TrackerError(
        ERROR_CODES.FACE_MODEL_LOAD_FAILED,
        "FACE",
        "MediaPipe Face Landmarker model could not be initialized.",
        {
          recoverable: false,
          cause: error,
          details: {
            modelAssetUrl,
            originalMessage: getUnknownErrorMessage(
              error
            )
          }
        }
      );
    }
    try {
      this.assertInitializationCurrent(
        generation
      );
    } catch (error) {
      createdLandmarker.close();
      throw error;
    }
    this.mediaPipeLandmarker = createdLandmarker;
    this.lastInferenceTimestampMs = null;
    this.lifecycle = "READY";
    logger3.info(
      "MediaPipe Face Landmarker initialized.",
      {
        delegate: FACE_LANDMARKER_RUNTIME.DELEGATE,
        numFaces: FACE_LANDMARKER_RUNTIME.NUM_FACES,
        transformationMatrixEnabled: FACE_LANDMARKER_RUNTIME.OUTPUT_FACIAL_TRANSFORMATION_MATRIXES
      }
    );
  }
  /* ========================================================================
   * Inference
   * ====================================================================== */
  detect(frame) {
    const landmarker = this.getReadyLandmarkerOrThrow();
    const inferenceTimestampMs = this.createMonotonicTimestamp(
      frame.metadata.timestampMs
    );
    try {
      const result = landmarker.detectForVideo(
        frame.source,
        inferenceTimestampMs
      );
      this.lastInferenceTimestampMs = inferenceTimestampMs;
      const landmarks = result.faceLandmarks[0] ?? EMPTY_LANDMARKS;
      const transformationMatrix = result.facialTransformationMatrixes[0] ?? null;
      return {
        frameSequence: frame.metadata.frameSequence,
        timestampMs: frame.metadata.timestampMs,
        inferenceTimestampMs,
        frameWidth: frame.metadata.width,
        frameHeight: frame.metadata.height,
        faceDetected: landmarks.length > 0,
        landmarkCount: landmarks.length,
        landmarks,
        transformationMatrix
      };
    } catch (error) {
      this.lastInferenceTimestampMs = inferenceTimestampMs;
      throw normalizeTrackerError(
        error,
        ERROR_CODES.FACE_DETECTION_FAILED,
        "FACE",
        "MediaPipe face landmark detection failed.",
        {
          details: {
            frameSequence: frame.metadata.frameSequence,
            frameWidth: frame.metadata.width,
            frameHeight: frame.metadata.height
          }
        }
      );
    }
  }
  /* ========================================================================
   * State
   * ====================================================================== */
  isReady() {
    return this.lifecycle === "READY" && this.mediaPipeLandmarker !== null;
  }
  getSnapshot() {
    return {
      lifecycle: this.lifecycle,
      initialized: this.isReady(),
      lastInferenceTimestampMs: this.lastInferenceTimestampMs
    };
  }
  /* ========================================================================
   * Disposal
   * ====================================================================== */
  dispose() {
    if (this.lifecycle === "DISPOSED") {
      return;
    }
    this.lifecycleGeneration += 1;
    const landmarker = this.mediaPipeLandmarker;
    this.mediaPipeLandmarker = null;
    this.lastInferenceTimestampMs = null;
    this.lifecycle = "DISPOSED";
    if (landmarker !== null) {
      try {
        landmarker.close();
      } catch (error) {
        logger3.warn(
          "MediaPipe Face Landmarker cleanup failed.",
          {
            originalMessage: getUnknownErrorMessage(
              error
            )
          }
        );
      }
    }
  }
  /* ========================================================================
   * Helpers
   * ====================================================================== */
  resolveWasmBaseUrl() {
    if (this.assetOverrides.wasmBaseUrl !== void 0) {
      return this.assetOverrides.wasmBaseUrl;
    }
    try {
      return chrome.runtime.getURL(
        FACE_LANDMARKER_RUNTIME.WASM_ASSET_DIRECTORY
      );
    } catch (error) {
      throw new TrackerError(
        ERROR_CODES.MEDIAPIPE_INIT_FAILED,
        "FACE",
        "MediaPipe WASM asset URL could not be resolved.",
        {
          recoverable: false,
          cause: error
        }
      );
    }
  }
  resolveModelAssetUrl() {
    if (this.assetOverrides.modelAssetUrl !== void 0) {
      return this.assetOverrides.modelAssetUrl;
    }
    try {
      return chrome.runtime.getURL(
        FACE_LANDMARKER_RUNTIME.MODEL_ASSET_PATH
      );
    } catch (error) {
      throw new TrackerError(
        ERROR_CODES.FACE_MODEL_LOAD_FAILED,
        "FACE",
        "Face Landmarker model asset URL could not be resolved.",
        {
          recoverable: false,
          cause: error
        }
      );
    }
  }
  assertInitializationCurrent(generation) {
    if (this.lifecycleGeneration === generation && this.lifecycle !== "DISPOSED") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face Landmarker initialization was cancelled because the runtime was disposed."
    );
  }
  getReadyLandmarkerOrThrow() {
    if (this.lifecycle === "READY" && this.mediaPipeLandmarker !== null) {
      return this.mediaPipeLandmarker;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face landmark inference requires an initialized FaceLandmarker.",
      {
        details: {
          lifecycle: this.lifecycle
        }
      }
    );
  }
  createMonotonicTimestamp(timestampMs) {
    if (!Number.isFinite(timestampMs)) {
      throw new TrackerError(
        ERROR_CODES.FACE_DETECTION_FAILED,
        "FACE",
        "Face landmark inference received an invalid frame timestamp.",
        {
          details: {
            timestampMs
          }
        }
      );
    }
    const previousTimestamp = this.lastInferenceTimestampMs;
    if (previousTimestamp === null || timestampMs > previousTimestamp) {
      return timestampMs;
    }
    return previousTimestamp + FACE_LANDMARKER_RUNTIME.MIN_TIMESTAMP_INCREMENT_MS;
  }
};

// src/face/faceQuality.ts
var ZERO_HEAD_POSE = {
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0
};
function classifyQualityLevel(score, structurallyValid) {
  if (!structurallyValid || !Number.isFinite(score) || score < FACE_QUALITY_THRESHOLDS.POOR_QUALITY_SCORE) {
    return "INVALID";
  }
  if (score >= FACE_QUALITY_THRESHOLDS.GOOD_QUALITY_SCORE) {
    return "GOOD";
  }
  if (score >= FACE_QUALITY_THRESHOLDS.FAIR_QUALITY_SCORE) {
    return "FAIR";
  }
  return "POOR";
}
function calculateFaceConfidence(landmarker, geometry, headPose) {
  if (!landmarker.faceDetected) {
    return 0;
  }
  let score = 0;
  if (geometry.geometryValid) {
    score += FACE_QUALITY_RUNTIME.FACE_CONFIDENCE_GEOMETRY_WEIGHT;
  }
  if (headPose.poseValid) {
    score += FACE_QUALITY_RUNTIME.FACE_CONFIDENCE_POSE_WEIGHT;
  }
  if (headPose.source === "TRANSFORMATION_MATRIX") {
    score += FACE_QUALITY_RUNTIME.FACE_CONFIDENCE_MATRIX_BONUS;
  }
  if (landmarker.landmarkCount < FACE_QUALITY_RUNTIME.EXPECTED_LANDMARK_COUNT) {
    const completeness = clamp01(
      landmarker.landmarkCount / FACE_QUALITY_RUNTIME.EXPECTED_LANDMARK_COUNT
    );
    score *= completeness;
  }
  return clamp01(score);
}
function isEyeGeometryPlausible(eye) {
  if (eye === null) {
    return false;
  }
  if (!Number.isFinite(
    eye.irisHorizontalPositionRatio
  ) || !Number.isFinite(
    eye.irisVerticalOffsetRatio
  ) || !Number.isFinite(
    eye.irisDiameterPx
  ) || !Number.isFinite(
    eye.eyeWidthPx
  ) || eye.eyeWidthPx <= 0) {
    return false;
  }
  const irisToEyeWidthRatio = eye.irisDiameterPx / eye.eyeWidthPx;
  return eye.irisHorizontalPositionRatio >= FACE_QUALITY_RUNTIME.EYE_HORIZONTAL_POSITION_MIN && eye.irisHorizontalPositionRatio <= FACE_QUALITY_RUNTIME.EYE_HORIZONTAL_POSITION_MAX && Math.abs(
    eye.irisVerticalOffsetRatio
  ) <= FACE_QUALITY_RUNTIME.EYE_MAX_ABS_VERTICAL_OFFSET_RATIO && irisToEyeWidthRatio >= FACE_QUALITY_RUNTIME.EYE_MIN_IRIS_TO_EYE_WIDTH_RATIO && irisToEyeWidthRatio <= FACE_QUALITY_RUNTIME.EYE_MAX_IRIS_TO_EYE_WIDTH_RATIO;
}
function calculateEyeConfidence(eyes) {
  let score = 0;
  if (eyes.leftEyeValid) {
    score += FACE_QUALITY_RUNTIME.SINGLE_EYE_GEOMETRY_WEIGHT;
  }
  if (eyes.rightEyeValid) {
    score += FACE_QUALITY_RUNTIME.SINGLE_EYE_GEOMETRY_WEIGHT;
  }
  if (score > 0 && (!isEyeGeometryPlausible(
    eyes.leftEye
  ) || !isEyeGeometryPlausible(
    eyes.rightEye
  ))) {
    score *= FACE_QUALITY_RUNTIME.IMPLAUSIBLE_EYE_SCORE_MULTIPLIER;
  }
  return clamp01(score);
}
function calculateHeadPoseScore(result) {
  const pose = result.headPose;
  if (!result.poseValid || pose === null) {
    return 0;
  }
  const yawScore = clamp01(
    1 - Math.abs(pose.yawDeg) / FACE_POSITION_THRESHOLDS.MAX_ABS_YAW_DEG
  );
  const pitchScore = clamp01(
    1 - Math.abs(pose.pitchDeg) / FACE_POSITION_THRESHOLDS.MAX_ABS_PITCH_DEG
  );
  const rollScore = clamp01(
    1 - Math.abs(pose.rollDeg) / FACE_POSITION_THRESHOLDS.MAX_ABS_ROLL_DEG
  );
  let score = (yawScore + pitchScore + rollScore) / 3;
  if (result.source === "LANDMARK_FALLBACK") {
    score *= FACE_QUALITY_RUNTIME.FALLBACK_POSE_SCORE_MULTIPLIER;
  }
  return clamp01(score);
}
function isHeadPoseAcceptable(pose) {
  if (pose === null) {
    return false;
  }
  return Math.abs(pose.yawDeg) <= FACE_POSITION_THRESHOLDS.MAX_ABS_YAW_DEG && Math.abs(pose.pitchDeg) <= FACE_POSITION_THRESHOLDS.MAX_ABS_PITCH_DEG && Math.abs(pose.rollDeg) <= FACE_POSITION_THRESHOLDS.MAX_ABS_ROLL_DEG;
}
function calculateFaceDistanceRatio(geometry, baseline) {
  const current = geometry.geometry;
  if (current === null) {
    return 0;
  }
  if (baseline === null || baseline.width <= 0 || baseline.height <= 0) {
    return 1;
  }
  const widthRatio = current.widthRatio / baseline.width;
  const heightRatio = current.heightRatio / baseline.height;
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return 0;
  }
  return Math.sqrt(
    widthRatio * heightRatio
  );
}
function isDistanceAcceptable(geometry, faceDistanceRatio, baseline) {
  const current = geometry.geometry;
  if (current === null) {
    return false;
  }
  if (baseline !== null) {
    return faceDistanceRatio >= FACE_POSITION_THRESHOLDS.MIN_FACE_DISTANCE_RATIO && faceDistanceRatio <= FACE_POSITION_THRESHOLDS.MAX_FACE_DISTANCE_RATIO;
  }
  return current.widthRatio >= FACE_QUALITY_RUNTIME.MIN_PRECALIBRATION_FACE_WIDTH_RATIO && current.widthRatio <= FACE_QUALITY_RUNTIME.MAX_PRECALIBRATION_FACE_WIDTH_RATIO && current.heightRatio >= FACE_QUALITY_RUNTIME.MIN_PRECALIBRATION_FACE_HEIGHT_RATIO && current.heightRatio <= FACE_QUALITY_RUNTIME.MAX_PRECALIBRATION_FACE_HEIGHT_RATIO;
}
function calculatePositionStatus(geometry, headPose, eyes, cameraQuality, faceDistanceRatio, baseline, stable) {
  const faceGeometry = geometry.geometry;
  const horizontallyCentered = faceGeometry !== null && Math.abs(
    faceGeometry.centerNormalized.x - NORMALIZED_COORDINATE.CENTER
  ) <= FACE_POSITION_THRESHOLDS.MAX_CENTER_OFFSET_X_RATIO;
  const verticallyCentered = faceGeometry !== null && Math.abs(
    faceGeometry.centerNormalized.y - NORMALIZED_COORDINATE.CENTER
  ) <= FACE_POSITION_THRESHOLDS.MAX_CENTER_OFFSET_Y_RATIO;
  const brightnessAcceptable = cameraQuality !== null && Number.isFinite(
    cameraQuality.brightness
  ) && cameraQuality.brightness >= CAMERA_QUALITY_THRESHOLDS.MIN_BRIGHTNESS && cameraQuality.brightness <= CAMERA_QUALITY_THRESHOLDS.MAX_BRIGHTNESS;
  return {
    faceDetected: geometry.faceDetected,
    bothEyesVisible: eyes.bothEyesValid,
    horizontallyCentered,
    verticallyCentered,
    distanceAcceptable: isDistanceAcceptable(
      geometry,
      faceDistanceRatio,
      baseline
    ),
    headPoseAcceptable: isHeadPoseAcceptable(
      headPose.headPose
    ),
    brightnessAcceptable,
    stable
  };
}
function calculatePositionScore(status) {
  const checks = [
    status.horizontallyCentered,
    status.verticallyCentered,
    status.distanceAcceptable,
    status.headPoseAcceptable
  ];
  let passed = 0;
  for (const check of checks) {
    if (check) {
      passed += 1;
    }
  }
  return passed / checks.length;
}
function cameraQualityToScore(quality) {
  if (quality === null) {
    return FACE_QUALITY_RUNTIME.CAMERA_INVALID_SCORE;
  }
  switch (quality.quality) {
    case "GOOD":
      return FACE_QUALITY_RUNTIME.CAMERA_GOOD_SCORE;
    case "FAIR":
      return FACE_QUALITY_RUNTIME.CAMERA_FAIR_SCORE;
    case "POOR":
      return FACE_QUALITY_RUNTIME.CAMERA_POOR_SCORE;
    case "INVALID":
      return FACE_QUALITY_RUNTIME.CAMERA_INVALID_SCORE;
  }
}
function framesMatch(input) {
  const sequence = input.landmarker.frameSequence;
  const timestamp = input.landmarker.timestampMs;
  return input.geometry.frameSequence === sequence && input.headPose.frameSequence === sequence && input.eyes.frameSequence === sequence && input.blink.frameSequence === sequence && input.geometry.timestampMs === timestamp && input.headPose.timestampMs === timestamp && input.eyes.timestampMs === timestamp && input.blink.timestampMs === timestamp;
}
var FaceQualityEvaluator = class {
  stableCandidateStartedAtMs = null;
  lastTimestampMs = null;
  evaluate(input) {
    const baseline = input.baseline ?? null;
    if (!framesMatch(input)) {
      this.resetStability();
      return this.createFrameMismatchResult(
        input.landmarker
      );
    }
    if (this.lastTimestampMs !== null && input.landmarker.timestampMs < this.lastTimestampMs) {
      this.resetStability();
    }
    this.lastTimestampMs = input.landmarker.timestampMs;
    const faceConfidence = calculateFaceConfidence(
      input.landmarker,
      input.geometry,
      input.headPose
    );
    const eyeConfidence = calculateEyeConfidence(
      input.eyes
    );
    const currentBlink = input.blink.bothEyesClosed || input.blink.blinkInProgress;
    const leftEyeVisible = input.eyes.leftEyeValid;
    const rightEyeVisible = input.eyes.rightEyeValid;
    const eyeGeometryPlausible = isEyeGeometryPlausible(
      input.eyes.leftEye
    ) && isEyeGeometryPlausible(
      input.eyes.rightEye
    );
    const faceValid = input.landmarker.faceDetected && input.geometry.geometryValid && input.headPose.poseValid && faceConfidence >= FACE_QUALITY_THRESHOLDS.MIN_FACE_CONFIDENCE;
    const eyesValid = input.eyes.bothEyesValid && eyeGeometryPlausible && eyeConfidence >= FACE_QUALITY_THRESHOLDS.MIN_EYE_CONFIDENCE && !currentBlink && !input.blink.asymmetricClosure;
    const faceDistanceRatio = calculateFaceDistanceRatio(
      input.geometry,
      baseline
    );
    const provisionalPosition = calculatePositionStatus(
      input.geometry,
      input.headPose,
      input.eyes,
      input.cameraQuality,
      faceDistanceRatio,
      baseline,
      false
    );
    const stableCandidate = faceValid && eyesValid && provisionalPosition.horizontallyCentered && provisionalPosition.verticallyCentered && provisionalPosition.distanceAcceptable && provisionalPosition.headPoseAcceptable && provisionalPosition.brightnessAcceptable;
    const stable = this.updateStability(
      input.landmarker.timestampMs,
      stableCandidate
    );
    const positionStatus = calculatePositionStatus(
      input.geometry,
      input.headPose,
      input.eyes,
      input.cameraQuality,
      faceDistanceRatio,
      baseline,
      stable
    );
    const headPoseScore = calculateHeadPoseScore(
      input.headPose
    );
    const positionScore = calculatePositionScore(
      positionStatus
    );
    const cameraScore = cameraQualityToScore(
      input.cameraQuality
    );
    let qualityScore = faceConfidence * FACE_QUALITY_RUNTIME.FACE_SCORE_WEIGHT + eyeConfidence * FACE_QUALITY_RUNTIME.EYE_SCORE_WEIGHT + headPoseScore * FACE_QUALITY_RUNTIME.HEAD_POSE_SCORE_WEIGHT + positionScore * FACE_QUALITY_RUNTIME.POSITION_SCORE_WEIGHT + cameraScore * FACE_QUALITY_RUNTIME.CAMERA_SCORE_WEIGHT;
    if (currentBlink) {
      qualityScore *= FACE_QUALITY_RUNTIME.BLINK_SCORE_MULTIPLIER;
    } else if (input.blink.asymmetricClosure) {
      qualityScore *= FACE_QUALITY_RUNTIME.ASYMMETRIC_CLOSURE_SCORE_MULTIPLIER;
    }
    qualityScore = clamp01(qualityScore);
    const structurallyValid = faceValid && eyesValid;
    const qualityLevel = classifyQualityLevel(
      qualityScore,
      structurallyValid
    );
    const headPose = input.headPose.headPose ?? ZERO_HEAD_POSE;
    const trackingQuality = {
      faceValid,
      eyesValid,
      leftEyeVisible,
      rightEyeVisible,
      blink: currentBlink,
      faceConfidence,
      eyeConfidence,
      faceDistanceRatio,
      headPose,
      qualityScore,
      qualityLevel
    };
    const issues = this.collectIssues(
      input,
      positionStatus,
      eyeGeometryPlausible
    );
    return {
      frameSequence: input.landmarker.frameSequence,
      timestampMs: input.landmarker.timestampMs,
      trackingQuality,
      positionStatus,
      usableForGaze: structurallyValid && qualityLevel !== "INVALID",
      issues
    };
  }
  reset() {
    this.resetStability();
    this.lastTimestampMs = null;
  }
  updateStability(timestampMs, validCandidate) {
    if (!validCandidate) {
      this.stableCandidateStartedAtMs = null;
      return false;
    }
    if (this.stableCandidateStartedAtMs === null) {
      this.stableCandidateStartedAtMs = timestampMs;
      return false;
    }
    return timestampMs - this.stableCandidateStartedAtMs >= FACE_POSITION_THRESHOLDS.REQUIRED_STABLE_DURATION_MS;
  }
  resetStability() {
    this.stableCandidateStartedAtMs = null;
  }
  collectIssues(input, status, eyeGeometryPlausible) {
    const issues = [];
    if (!input.landmarker.faceDetected) {
      issues.push("NO_FACE");
    }
    if (!input.geometry.geometryValid) {
      issues.push(
        "FACE_GEOMETRY_INVALID"
      );
    }
    if (!input.headPose.poseValid) {
      issues.push("HEAD_POSE_INVALID");
    } else if (!status.headPoseAcceptable) {
      issues.push("HEAD_POSE_EXCESSIVE");
    }
    if (!input.eyes.leftEyeValid) {
      issues.push("LEFT_EYE_INVALID");
    }
    if (!input.eyes.rightEyeValid) {
      issues.push("RIGHT_EYE_INVALID");
    }
    if (input.eyes.bothEyesValid && !eyeGeometryPlausible) {
      issues.push(
        "EYE_GEOMETRY_IMPLAUSIBLE"
      );
    }
    if (input.blink.bothEyesClosed || input.blink.blinkInProgress) {
      issues.push("BLINK_IN_PROGRESS");
    }
    if (input.blink.asymmetricClosure) {
      issues.push(
        "ASYMMETRIC_EYE_CLOSURE"
      );
    }
    if (!status.horizontallyCentered || !status.verticallyCentered) {
      issues.push("FACE_NOT_CENTERED");
    }
    if (!status.distanceAcceptable) {
      issues.push(
        "FACE_DISTANCE_INVALID"
      );
    }
    if (!status.brightnessAcceptable) {
      issues.push("LIGHTING_INVALID");
    }
    if (input.cameraQuality === null || input.cameraQuality.quality === "INVALID") {
      issues.push(
        "CAMERA_QUALITY_INVALID"
      );
    }
    return issues;
  }
  createFrameMismatchResult(landmarker) {
    const trackingQuality = {
      faceValid: false,
      eyesValid: false,
      leftEyeVisible: false,
      rightEyeVisible: false,
      blink: false,
      faceConfidence: 0,
      eyeConfidence: 0,
      faceDistanceRatio: 0,
      headPose: ZERO_HEAD_POSE,
      qualityScore: 0,
      qualityLevel: "INVALID"
    };
    const positionStatus = {
      faceDetected: landmarker.faceDetected,
      bothEyesVisible: false,
      horizontallyCentered: false,
      verticallyCentered: false,
      distanceAcceptable: false,
      headPoseAcceptable: false,
      brightnessAcceptable: false,
      stable: false
    };
    return {
      frameSequence: landmarker.frameSequence,
      timestampMs: landmarker.timestampMs,
      trackingQuality,
      positionStatus,
      usableForGaze: false,
      issues: ["FRAME_MISMATCH"]
    };
  }
};

// src/face/headPose.ts
function clamp2(value, minimum, maximum) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}
function vectorLength2(vector) {
  return Math.hypot(
    vector.x,
    vector.y,
    vector.z
  );
}
function subtract2(first, second) {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z
  };
}
function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar
  };
}
function dot3(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
function cross(first, second) {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  };
}
function normalize2(vector, minimumLength) {
  const length = vectorLength2(
    vector
  );
  if (!Number.isFinite(length) || length < minimumLength) {
    return null;
  }
  return scaleVector(
    vector,
    1 / length
  );
}
function isFiniteVector(vector) {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}
function radiansToDegrees(radians) {
  return radians * HEAD_POSE_RUNTIME.RADIANS_TO_DEGREES;
}
function getColumnMajorValue(matrix, row, column) {
  const index = column * matrix.rows + row;
  const value = matrix.data[index];
  return value !== void 0 && Number.isFinite(value) ? value : null;
}
function getMatrixAxis(matrix, column) {
  const x2 = getColumnMajorValue(
    matrix,
    0,
    column
  );
  const y2 = getColumnMajorValue(
    matrix,
    1,
    column
  );
  const z2 = getColumnMajorValue(
    matrix,
    2,
    column
  );
  if (x2 === null || y2 === null || z2 === null) {
    return null;
  }
  return {
    x: x2,
    y: y2,
    z: z2
  };
}
function createRotationMatrix(xAxis, yAxis, zAxis) {
  return {
    r00: xAxis.x,
    r01: yAxis.x,
    r02: zAxis.x,
    r10: xAxis.y,
    r11: yAxis.y,
    r12: zAxis.y,
    r20: xAxis.z,
    r21: yAxis.z,
    r22: zAxis.z
  };
}
function rotationMatrixToHeadPose(rotation) {
  const yawRad = Math.asin(
    clamp2(
      -rotation.r20,
      -1,
      1
    )
  );
  const cosYaw = Math.cos(
    yawRad
  );
  let pitchRad;
  let rollRad;
  if (Math.abs(cosYaw) > HEAD_POSE_RUNTIME.GIMBAL_LOCK_COS_THRESHOLD) {
    pitchRad = Math.atan2(
      rotation.r21,
      rotation.r22
    );
    rollRad = Math.atan2(
      rotation.r10,
      rotation.r00
    );
  } else {
    pitchRad = Math.atan2(
      -rotation.r12,
      rotation.r11
    );
    rollRad = 0;
  }
  const headPose = {
    yawDeg: radiansToDegrees(
      yawRad
    ),
    pitchDeg: radiansToDegrees(
      pitchRad
    ),
    rollDeg: radiansToDegrees(
      rollRad
    )
  };
  return Number.isFinite(headPose.yawDeg) && Number.isFinite(headPose.pitchDeg) && Number.isFinite(headPose.rollDeg) ? headPose : null;
}
function extractMatrixPose(matrix) {
  if (matrix.rows !== HEAD_POSE_RUNTIME.MATRIX_ROWS || matrix.columns !== HEAD_POSE_RUNTIME.MATRIX_COLUMNS || matrix.data.length < HEAD_POSE_RUNTIME.MATRIX_ELEMENT_COUNT) {
    return null;
  }
  const xAxisRaw = getMatrixAxis(
    matrix,
    0
  );
  const yAxisRaw = getMatrixAxis(
    matrix,
    1
  );
  const zAxisRaw = getMatrixAxis(
    matrix,
    2
  );
  if (xAxisRaw === null || yAxisRaw === null || zAxisRaw === null) {
    return null;
  }
  const xScale = vectorLength2(
    xAxisRaw
  );
  const yScale = vectorLength2(
    yAxisRaw
  );
  const zScale = vectorLength2(
    zAxisRaw
  );
  if (!Number.isFinite(xScale) || !Number.isFinite(yScale) || !Number.isFinite(zScale) || xScale < HEAD_POSE_RUNTIME.MIN_AXIS_SCALE || yScale < HEAD_POSE_RUNTIME.MIN_AXIS_SCALE || zScale < HEAD_POSE_RUNTIME.MIN_AXIS_SCALE) {
    return null;
  }
  const matrixScale = (xScale + yScale + zScale) / 3;
  const scaleSpread = (Math.max(
    xScale,
    yScale,
    zScale
  ) - Math.min(
    xScale,
    yScale,
    zScale
  )) / matrixScale;
  if (scaleSpread > HEAD_POSE_RUNTIME.MAX_RELATIVE_SCALE_SPREAD) {
    return null;
  }
  const xAxis = normalize2(
    xAxisRaw,
    HEAD_POSE_RUNTIME.MIN_AXIS_SCALE
  );
  const yAxisInitial = normalize2(
    yAxisRaw,
    HEAD_POSE_RUNTIME.MIN_AXIS_SCALE
  );
  const zAxisInitial = normalize2(
    zAxisRaw,
    HEAD_POSE_RUNTIME.MIN_AXIS_SCALE
  );
  if (xAxis === null || yAxisInitial === null || zAxisInitial === null) {
    return null;
  }
  const orthogonalityError = Math.max(
    Math.abs(
      dot3(
        xAxis,
        yAxisInitial
      )
    ),
    Math.abs(
      dot3(
        xAxis,
        zAxisInitial
      )
    ),
    Math.abs(
      dot3(
        yAxisInitial,
        zAxisInitial
      )
    )
  );
  if (orthogonalityError > HEAD_POSE_RUNTIME.MAX_ORTHOGONALITY_ERROR) {
    return null;
  }
  const yWithoutX = subtract2(
    yAxisInitial,
    scaleVector(
      xAxis,
      dot3(
        yAxisInitial,
        xAxis
      )
    )
  );
  const yAxis = normalize2(
    yWithoutX,
    HEAD_POSE_RUNTIME.MIN_AXIS_SCALE
  );
  if (yAxis === null) {
    return null;
  }
  const zAxis = normalize2(
    cross(
      xAxis,
      yAxis
    ),
    HEAD_POSE_RUNTIME.MIN_AXIS_SCALE
  );
  if (zAxis === null || dot3(
    zAxis,
    zAxisInitial
  ) < HEAD_POSE_RUNTIME.MIN_THIRD_AXIS_ALIGNMENT) {
    return null;
  }
  const correctedYAxis = normalize2(
    cross(
      zAxis,
      xAxis
    ),
    HEAD_POSE_RUNTIME.MIN_AXIS_SCALE
  );
  if (correctedYAxis === null) {
    return null;
  }
  const rotation = createRotationMatrix(
    xAxis,
    correctedYAxis,
    zAxis
  );
  const headPose = rotationMatrixToHeadPose(
    rotation
  );
  if (headPose === null) {
    return null;
  }
  return {
    headPose,
    matrixScale,
    orthogonalityError,
    scaleSpread
  };
}
function getLandmark3(landmarks, index) {
  const landmark = landmarks[index];
  if (landmark === void 0 || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) || !Number.isFinite(landmark.z)) {
    return null;
  }
  return landmark;
}
function toFallbackVector(landmark, frameWidth, frameHeight) {
  const verticalScale = frameHeight / frameWidth;
  return {
    x: landmark.x,
    y: -landmark.y * verticalScale,
    z: -landmark.z
  };
}
function estimateFallbackPose(result, geometryResult) {
  if (!geometryResult.geometryValid || geometryResult.geometry === null || result.frameWidth <= 0 || result.frameHeight <= 0) {
    return null;
  }
  const rightCheekLandmark = getLandmark3(
    result.landmarks,
    FACE_LANDMARK_INDICES.RIGHT_CHEEK
  );
  const leftCheekLandmark = getLandmark3(
    result.landmarks,
    FACE_LANDMARK_INDICES.LEFT_CHEEK
  );
  const foreheadLandmark = getLandmark3(
    result.landmarks,
    FACE_LANDMARK_INDICES.FOREHEAD_TOP
  );
  const chinLandmark = getLandmark3(
    result.landmarks,
    FACE_LANDMARK_INDICES.CHIN
  );
  if (rightCheekLandmark === null || leftCheekLandmark === null || foreheadLandmark === null || chinLandmark === null) {
    return null;
  }
  const rightCheek = toFallbackVector(
    rightCheekLandmark,
    result.frameWidth,
    result.frameHeight
  );
  const leftCheek = toFallbackVector(
    leftCheekLandmark,
    result.frameWidth,
    result.frameHeight
  );
  const forehead = toFallbackVector(
    foreheadLandmark,
    result.frameWidth,
    result.frameHeight
  );
  const chin = toFallbackVector(
    chinLandmark,
    result.frameWidth,
    result.frameHeight
  );
  const xAxis = normalize2(
    subtract2(
      leftCheek,
      rightCheek
    ),
    HEAD_POSE_RUNTIME.MIN_FALLBACK_AXIS_LENGTH
  );
  const yGuide = normalize2(
    subtract2(
      forehead,
      chin
    ),
    HEAD_POSE_RUNTIME.MIN_FALLBACK_AXIS_LENGTH
  );
  if (xAxis === null || yGuide === null) {
    return null;
  }
  const zAxis = normalize2(
    cross(
      xAxis,
      yGuide
    ),
    HEAD_POSE_RUNTIME.MIN_FALLBACK_AXIS_LENGTH
  );
  if (zAxis === null) {
    return null;
  }
  const yAxis = normalize2(
    cross(
      zAxis,
      xAxis
    ),
    HEAD_POSE_RUNTIME.MIN_FALLBACK_AXIS_LENGTH
  );
  if (yAxis === null || !isFiniteVector(xAxis) || !isFiniteVector(yAxis) || !isFiniteVector(zAxis)) {
    return null;
  }
  return rotationMatrixToHeadPose(
    createRotationMatrix(
      xAxis,
      yAxis,
      zAxis
    )
  );
}
var HeadPoseEstimator = class {
  analyze(result, geometryResult) {
    if (!result.faceDetected || result.landmarks.length === 0) {
      return this.createInvalidResult(
        result,
        false
      );
    }
    const matrixResult = result.transformationMatrix === null ? null : extractMatrixPose(
      result.transformationMatrix
    );
    if (matrixResult !== null) {
      return {
        frameSequence: result.frameSequence,
        timestampMs: result.timestampMs,
        faceDetected: true,
        poseValid: true,
        headPose: matrixResult.headPose,
        source: "TRANSFORMATION_MATRIX",
        diagnostics: {
          matrixScale: matrixResult.matrixScale,
          orthogonalityError: matrixResult.orthogonalityError,
          scaleSpread: matrixResult.scaleSpread
        }
      };
    }
    const fallbackPose = estimateFallbackPose(
      result,
      geometryResult
    );
    if (fallbackPose !== null) {
      return {
        frameSequence: result.frameSequence,
        timestampMs: result.timestampMs,
        faceDetected: true,
        poseValid: true,
        headPose: fallbackPose,
        source: "LANDMARK_FALLBACK",
        diagnostics: {
          matrixScale: null,
          orthogonalityError: null,
          scaleSpread: null
        }
      };
    }
    return this.createInvalidResult(
      result,
      true
    );
  }
  createInvalidResult(result, faceDetected) {
    return {
      frameSequence: result.frameSequence,
      timestampMs: result.timestampMs,
      faceDetected,
      poseValid: false,
      headPose: null,
      source: null,
      diagnostics: {
        matrixScale: null,
        orthogonalityError: null,
        scaleSpread: null
      }
    };
  }
};

// src/gaze/GazeEngine.ts
function isGazeFeatureProvider(engine) {
  return "getLatestFeatureSnapshot" in engine && typeof engine.getLatestFeatureSnapshot === "function";
}

// src/gaze/ridgeGazeEngine.ts
var logger4 = createLogger("GAZE");
var RIDGE_MODEL_VERSION = 1;
var DEFAULT_RIDGE_LAMBDA = 1;
var MIN_FEATURE_SCALE = 1e-6;
var MIN_PIVOT_ABS = 1e-10;
var MIN_TRAINING_SAMPLE_MULTIPLIER = 2;
var RIDGE_GAZE_FEATURE_NAMES = [
  "LEFT_IRIS_HORIZONTAL_OFFSET",
  "LEFT_IRIS_VERTICAL_OFFSET",
  "RIGHT_IRIS_HORIZONTAL_OFFSET",
  "RIGHT_IRIS_VERTICAL_OFFSET",
  "MEAN_IRIS_HORIZONTAL_OFFSET",
  "MEAN_IRIS_VERTICAL_OFFSET",
  "IRIS_HORIZONTAL_DISPARITY",
  "IRIS_VERTICAL_DISPARITY",
  "FACE_CENTER_X",
  "FACE_CENTER_Y",
  "FACE_WIDTH_RATIO",
  "FACE_HEIGHT_RATIO",
  "FACE_DISTANCE_RATIO",
  "HEAD_YAW_DEG",
  "HEAD_PITCH_DEG",
  "HEAD_ROLL_DEG"
];
var RIDGE_FEATURE_COUNT = RIDGE_GAZE_FEATURE_NAMES.length;
var RIDGE_COEFFICIENT_COUNT = RIDGE_FEATURE_COUNT + 1;
var MIN_TRAINING_SAMPLE_COUNT = RIDGE_COEFFICIENT_COUNT * MIN_TRAINING_SAMPLE_MULTIPLIER;
function clamp012(value) {
  return Math.min(
    1,
    Math.max(
      0,
      value
    )
  );
}
function isFinitePoint2(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function isNormalizedTarget(point) {
  return isFinitePoint2(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}
function allFinite(values) {
  return values.every(
    (value) => Number.isFinite(value)
  );
}
function arraysEqual(first, second) {
  if (first.length !== second.length) {
    return false;
  }
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }
  return true;
}
function assertSynchronizedInput(input) {
  const expectedFrameSequence = input.frame.metadata.frameSequence;
  const expectedTimestampMs = input.frame.metadata.timestampMs;
  const frameResults = [
    input.landmarker,
    input.faceGeometry,
    input.headPose,
    input.eyeGeometry,
    input.blink,
    input.faceQuality
  ];
  for (const result of frameResults) {
    if (result.frameSequence !== expectedFrameSequence || result.timestampMs !== expectedTimestampMs) {
      throw new TrackerError(
        ERROR_CODES.GAZE_INVALID_SAMPLE,
        "GAZE",
        "Ridge gaze engine received unsynchronized frame analysis results.",
        {
          details: {
            expectedFrameSequence,
            expectedTimestampMs,
            receivedFrameSequence: result.frameSequence,
            receivedTimestampMs: result.timestampMs
          }
        }
      );
    }
  }
}
function isInputUsableForPrediction(input) {
  const trackingQuality = input.faceQuality.trackingQuality;
  return input.faceQuality.usableForGaze && trackingQuality.faceValid && trackingQuality.eyesValid && input.faceGeometry.faceDetected && input.faceGeometry.geometryValid && input.faceGeometry.geometry !== null && input.headPose.faceDetected && input.headPose.poseValid && input.headPose.headPose !== null && input.eyeGeometry.faceDetected && input.eyeGeometry.geometryValid && input.eyeGeometry.bothEyesValid && input.eyeGeometry.leftEye !== null && input.eyeGeometry.rightEye !== null && input.blink.valid && input.blink.bothEyesOpen && !input.blink.bothEyesClosed && !input.blink.blinkInProgress && !input.blink.prolongedClosureDetected;
}
function extractFeatures(input) {
  const faceGeometry = input.faceGeometry.geometry;
  const headPose = input.headPose.headPose;
  const leftEye = input.eyeGeometry.leftEye;
  const rightEye = input.eyeGeometry.rightEye;
  if (faceGeometry === null || headPose === null || leftEye === null || rightEye === null) {
    return null;
  }
  const meanHorizontalOffset = (leftEye.irisHorizontalOffsetRatio + rightEye.irisHorizontalOffsetRatio) / 2;
  const meanVerticalOffset = (leftEye.irisVerticalOffsetRatio + rightEye.irisVerticalOffsetRatio) / 2;
  const features = [
    leftEye.irisHorizontalOffsetRatio,
    leftEye.irisVerticalOffsetRatio,
    rightEye.irisHorizontalOffsetRatio,
    rightEye.irisVerticalOffsetRatio,
    meanHorizontalOffset,
    meanVerticalOffset,
    leftEye.irisHorizontalOffsetRatio - rightEye.irisHorizontalOffsetRatio,
    leftEye.irisVerticalOffsetRatio - rightEye.irisVerticalOffsetRatio,
    faceGeometry.centerNormalized.x,
    faceGeometry.centerNormalized.y,
    faceGeometry.widthRatio,
    faceGeometry.heightRatio,
    input.faceQuality.trackingQuality.faceDistanceRatio,
    headPose.yawDeg,
    headPose.pitchDeg,
    headPose.rollDeg
  ];
  if (features.length !== RIDGE_FEATURE_COUNT || !allFinite(features)) {
    return null;
  }
  return features;
}
function calculateFeatureMean(samples) {
  const mean15 = new Array(
    RIDGE_FEATURE_COUNT
  ).fill(0);
  for (const sample of samples) {
    for (let featureIndex = 0; featureIndex < RIDGE_FEATURE_COUNT; featureIndex += 1) {
      mean15[featureIndex] = (mean15[featureIndex] ?? 0) + (sample.features[featureIndex] ?? 0);
    }
  }
  return mean15.map(
    (sum) => sum / samples.length
  );
}
function calculateFeatureScale(samples, mean15) {
  const varianceSum = new Array(
    RIDGE_FEATURE_COUNT
  ).fill(0);
  for (const sample of samples) {
    for (let featureIndex = 0; featureIndex < RIDGE_FEATURE_COUNT; featureIndex += 1) {
      const value = sample.features[featureIndex] ?? 0;
      const featureMean = mean15[featureIndex] ?? 0;
      const difference = value - featureMean;
      varianceSum[featureIndex] = (varianceSum[featureIndex] ?? 0) + difference * difference;
    }
  }
  return varianceSum.map(
    (sum) => {
      const standardDeviation = Math.sqrt(
        sum / samples.length
      );
      return Math.max(
        standardDeviation,
        MIN_FEATURE_SCALE
      );
    }
  );
}
function standardizeFeatures(features, mean15, scale) {
  if (features.length !== RIDGE_FEATURE_COUNT || mean15.length !== RIDGE_FEATURE_COUNT || scale.length !== RIDGE_FEATURE_COUNT) {
    return null;
  }
  const standardized = new Array(
    RIDGE_COEFFICIENT_COUNT
  );
  standardized[0] = 1;
  for (let featureIndex = 0; featureIndex < RIDGE_FEATURE_COUNT; featureIndex += 1) {
    const value = features[featureIndex];
    const featureMean = mean15[featureIndex];
    const featureScale = scale[featureIndex];
    if (value === void 0 || featureMean === void 0 || featureScale === void 0 || !Number.isFinite(value) || !Number.isFinite(featureMean) || !Number.isFinite(featureScale) || featureScale < MIN_FEATURE_SCALE) {
      return null;
    }
    standardized[featureIndex + 1] = (value - featureMean) / featureScale;
  }
  return allFinite(standardized) ? standardized : null;
}
function buildNormalEquation(designRows, targetValues, ridgeLambda) {
  const matrix = Array.from(
    {
      length: RIDGE_COEFFICIENT_COUNT
    },
    () => new Array(
      RIDGE_COEFFICIENT_COUNT
    ).fill(0)
  );
  const vector = new Array(
    RIDGE_COEFFICIENT_COUNT
  ).fill(0);
  for (let sampleIndex = 0; sampleIndex < designRows.length; sampleIndex += 1) {
    const row = designRows[sampleIndex];
    const target = targetValues[sampleIndex];
    if (row === void 0 || target === void 0) {
      continue;
    }
    for (let column = 0; column < RIDGE_COEFFICIENT_COUNT; column += 1) {
      const columnValue = row[column] ?? 0;
      vector[column] = (vector[column] ?? 0) + columnValue * target;
      const matrixRow = matrix[column];
      if (matrixRow === void 0) {
        continue;
      }
      for (let innerColumn = 0; innerColumn < RIDGE_COEFFICIENT_COUNT; innerColumn += 1) {
        const innerValue = row[innerColumn] ?? 0;
        matrixRow[innerColumn] = (matrixRow[innerColumn] ?? 0) + columnValue * innerValue;
      }
    }
  }
  for (let diagonal = 1; diagonal < RIDGE_COEFFICIENT_COUNT; diagonal += 1) {
    const row = matrix[diagonal];
    if (row !== void 0) {
      row[diagonal] = (row[diagonal] ?? 0) + ridgeLambda;
    }
  }
  return {
    matrix,
    vector
  };
}
function solveLinearSystem2(matrix, vector) {
  const size = vector.length;
  if (size === 0 || matrix.length !== size) {
    return null;
  }
  const augmented = matrix.map(
    (row, rowIndex) => {
      if (row.length !== size) {
        return [];
      }
      const target = vector[rowIndex];
      if (target === void 0) {
        return [];
      }
      return [
        ...row,
        target
      ];
    }
  );
  if (augmented.some(
    (row) => row.length !== size + 1
  )) {
    return null;
  }
  for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    let pivotAbs = Math.abs(
      augmented[pivotRow]?.[pivotColumn] ?? 0
    );
    for (let candidateRow = pivotColumn + 1; candidateRow < size; candidateRow += 1) {
      const candidateAbs = Math.abs(
        augmented[candidateRow]?.[pivotColumn] ?? 0
      );
      if (candidateAbs > pivotAbs) {
        pivotAbs = candidateAbs;
        pivotRow = candidateRow;
      }
    }
    if (!Number.isFinite(pivotAbs) || pivotAbs < MIN_PIVOT_ABS) {
      return null;
    }
    if (pivotRow !== pivotColumn) {
      const temporary = augmented[pivotColumn];
      const replacement = augmented[pivotRow];
      if (temporary === void 0 || replacement === void 0) {
        return null;
      }
      augmented[pivotColumn] = replacement;
      augmented[pivotRow] = temporary;
    }
    const normalizedPivotRow = augmented[pivotColumn];
    const pivotValue = normalizedPivotRow?.[pivotColumn];
    if (normalizedPivotRow === void 0 || pivotValue === void 0 || !Number.isFinite(pivotValue) || Math.abs(pivotValue) < MIN_PIVOT_ABS) {
      return null;
    }
    for (let column = pivotColumn; column <= size; column += 1) {
      const value = normalizedPivotRow[column];
      if (value === void 0) {
        return null;
      }
      normalizedPivotRow[column] = value / pivotValue;
    }
    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotColumn) {
        continue;
      }
      const row = augmented[rowIndex];
      const factor = row?.[pivotColumn];
      if (row === void 0 || factor === void 0 || !Number.isFinite(factor)) {
        return null;
      }
      if (Math.abs(factor) < MIN_PIVOT_ABS) {
        continue;
      }
      for (let column = pivotColumn; column <= size; column += 1) {
        const rowValue = row[column];
        const pivotRowValue = normalizedPivotRow[column];
        if (rowValue === void 0 || pivotRowValue === void 0) {
          return null;
        }
        row[column] = rowValue - factor * pivotRowValue;
      }
    }
  }
  const solution = new Array(size);
  for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
    const value = augmented[rowIndex]?.[size];
    if (value === void 0 || !Number.isFinite(value)) {
      return null;
    }
    solution[rowIndex] = value;
  }
  return solution;
}
function fitAxis(designRows, targetValues, ridgeLambda) {
  const equation = buildNormalEquation(
    designRows,
    targetValues,
    ridgeLambda
  );
  const coefficients = solveLinearSystem2(
    equation.matrix,
    equation.vector
  );
  if (coefficients === null || coefficients.length !== RIDGE_COEFFICIENT_COUNT || !allFinite(coefficients)) {
    return null;
  }
  return {
    coefficients
  };
}
function dotProduct(coefficients, designRow) {
  if (coefficients.length !== RIDGE_COEFFICIENT_COUNT || designRow.length !== RIDGE_COEFFICIENT_COUNT) {
    return null;
  }
  let sum = 0;
  for (let index = 0; index < RIDGE_COEFFICIENT_COUNT; index += 1) {
    const coefficient = coefficients[index];
    const value = designRow[index];
    if (coefficient === void 0 || value === void 0) {
      return null;
    }
    sum += coefficient * value;
  }
  return Number.isFinite(sum) ? sum : null;
}
function calculateTrainingRmse2(designRows, targets, coefficientX, coefficientY) {
  let squaredDistanceSum = 0;
  for (let index = 0; index < designRows.length; index += 1) {
    const row = designRows[index];
    const target = targets[index];
    if (row === void 0 || target === void 0) {
      return null;
    }
    const predictionX = dotProduct(
      coefficientX,
      row
    );
    const predictionY = dotProduct(
      coefficientY,
      row
    );
    if (predictionX === null || predictionY === null) {
      return null;
    }
    const errorX = predictionX - target.x;
    const errorY = predictionY - target.y;
    squaredDistanceSum += errorX * errorX + errorY * errorY;
  }
  const rmse5 = Math.sqrt(
    squaredDistanceSum / designRows.length
  );
  return Number.isFinite(rmse5) ? rmse5 : null;
}
function assertValidModel(model) {
  if (model.version !== RIDGE_MODEL_VERSION) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Unsupported Ridge gaze model version.",
      {
        details: {
          expectedVersion: RIDGE_MODEL_VERSION,
          receivedVersion: model.version
        }
      }
    );
  }
  if (!arraysEqual(
    model.featureNames,
    RIDGE_GAZE_FEATURE_NAMES
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Ridge gaze model feature schema does not match this build."
    );
  }
  if (model.featureMean.length !== RIDGE_FEATURE_COUNT || model.featureScale.length !== RIDGE_FEATURE_COUNT || model.coefficientX.length !== RIDGE_COEFFICIENT_COUNT || model.coefficientY.length !== RIDGE_COEFFICIENT_COUNT) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Ridge gaze model has invalid vector dimensions."
    );
  }
  if (!allFinite(model.featureMean) || !allFinite(model.featureScale) || !allFinite(model.coefficientX) || !allFinite(model.coefficientY) || model.featureScale.some(
    (value) => value < MIN_FEATURE_SCALE
  ) || !Number.isFinite(model.ridgeLambda) || model.ridgeLambda < 0 || !Number.isInteger(
    model.trainingSampleCount
  ) || model.trainingSampleCount < 1 || !Number.isFinite(model.trainingRmse) || model.trainingRmse < 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Ridge gaze model contains invalid numeric values."
    );
  }
}
function cloneModel(model) {
  return {
    version: model.version,
    featureNames: [...model.featureNames],
    featureMean: [...model.featureMean],
    featureScale: [...model.featureScale],
    coefficientX: [...model.coefficientX],
    coefficientY: [...model.coefficientY],
    ridgeLambda: model.ridgeLambda,
    trainingSampleCount: model.trainingSampleCount,
    trainingRmse: model.trainingRmse
  };
}
var RidgeGazeEngine = class {
  source = "RIDGE";
  lifecycle = "CREATED";
  lastPredictionTimestampMs = null;
  model = null;
  constructor(initialModel) {
    if (initialModel !== void 0) {
      this.setModel(initialModel);
    }
  }
  initialize() {
    if (this.lifecycle === "READY") {
      return Promise.resolve();
    }
    if (this.lifecycle === "INITIALIZING") {
      return Promise.reject(
        new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "GAZE",
          "Ridge gaze engine is already initializing."
        )
      );
    }
    if (this.lifecycle === "DISPOSED") {
      return Promise.reject(
        new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "GAZE",
          "Disposed Ridge gaze engine cannot be initialized."
        )
      );
    }
    this.lifecycle = "INITIALIZING";
    this.lastPredictionTimestampMs = null;
    this.lifecycle = "READY";
    logger4.info(
      "Ridge gaze engine initialized.",
      {
        modelReady: this.model !== null
      }
    );
    return Promise.resolve();
  }
  predict(input) {
    try {
      this.assertReady();
      assertSynchronizedInput(input);
      if (this.model === null || !isInputUsableForPrediction(input)) {
        return Promise.resolve(null);
      }
      const features = extractFeatures(input);
      if (features === null) {
        return Promise.resolve(null);
      }
      const designRow = standardizeFeatures(
        features,
        this.model.featureMean,
        this.model.featureScale
      );
      if (designRow === null) {
        return Promise.resolve(null);
      }
      const x2 = dotProduct(
        this.model.coefficientX,
        designRow
      );
      const y2 = dotProduct(
        this.model.coefficientY,
        designRow
      );
      const headPose = input.headPose.headPose;
      if (x2 === null || y2 === null || headPose === null) {
        return Promise.resolve(null);
      }
      const faceQuality = clamp012(
        input.faceQuality.trackingQuality.qualityScore
      );
      const calibrationConfidence = 1 / (1 + this.model.trainingRmse);
      const confidence = clamp012(
        faceQuality * calibrationConfidence
      );
      this.lastPredictionTimestampMs = input.frame.metadata.timestampMs;
      return Promise.resolve({
        timestampMs: input.frame.metadata.timestampMs,
        rawPoint: {
          x: x2,
          y: y2
        },
        rawSpace: "NORMALIZED",
        confidence,
        faceValid: input.faceQuality.trackingQuality.faceValid,
        eyesValid: input.faceQuality.trackingQuality.eyesValid,
        headPose,
        source: this.source
      });
    } catch (error) {
      return Promise.reject(
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_PREDICTION_FAILED,
          "GAZE",
          "Ridge gaze prediction failed.",
          {
            details: {
              frameSequence: input.frame.metadata.frameSequence,
              timestampMs: input.frame.metadata.timestampMs
            }
          }
        )
      );
    }
  }
  /**
   * Fits a participant-specific model from labeled calibration frames.
   *
   * Invalid/blink/unsynchronized frames are not silently converted into
   * training rows. Unsynchronized data raises an error; ordinary unusable
   * gaze frames are rejected from the fit and the remaining count must still
   * satisfy `MIN_TRAINING_SAMPLE_COUNT`.
   */
  fit(samples, ridgeLambda = DEFAULT_RIDGE_LAMBDA) {
    this.assertNotDisposed();
    if (!Number.isFinite(ridgeLambda) || ridgeLambda < 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "GAZE",
        "Ridge lambda must be a finite non-negative number.",
        {
          details: {
            ridgeLambda
          }
        }
      );
    }
    const prepared = [];
    for (const sample of samples) {
      if (!isNormalizedTarget(
        sample.targetNormalizedPoint
      )) {
        throw new TrackerError(
          ERROR_CODES.GAZE_INVALID_SAMPLE,
          "GAZE",
          "Ridge training target must be a normalized 0..1 viewport point.",
          {
            details: {
              target: sample.targetNormalizedPoint
            }
          }
        );
      }
      assertSynchronizedInput(
        sample.input
      );
      if (!isInputUsableForPrediction(
        sample.input
      )) {
        continue;
      }
      const features = extractFeatures(
        sample.input
      );
      if (features === null) {
        continue;
      }
      prepared.push({
        features,
        target: {
          x: sample.targetNormalizedPoint.x,
          y: sample.targetNormalizedPoint.y
        }
      });
    }
    if (prepared.length < MIN_TRAINING_SAMPLE_COUNT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "GAZE",
        "Not enough valid calibration frames to fit the Ridge gaze model.",
        {
          details: {
            required: MIN_TRAINING_SAMPLE_COUNT,
            received: prepared.length,
            submitted: samples.length
          }
        }
      );
    }
    const featureMean = calculateFeatureMean(
      prepared
    );
    const featureScale = calculateFeatureScale(
      prepared,
      featureMean
    );
    const designRows = prepared.map(
      (sample) => {
        const row = standardizeFeatures(
          sample.features,
          featureMean,
          featureScale
        );
        if (row === null) {
          throw new TrackerError(
            ERROR_CODES.CALIBRATION_MODEL_FAILED,
            "GAZE",
            "Failed to standardize Ridge gaze training features."
          );
        }
        return row;
      }
    );
    const targets = prepared.map(
      (sample) => sample.target
    );
    const targetX = targets.map(
      (target) => target.x
    );
    const targetY = targets.map(
      (target) => target.y
    );
    const xFit = fitAxis(
      designRows,
      targetX,
      ridgeLambda
    );
    const yFit = fitAxis(
      designRows,
      targetY,
      ridgeLambda
    );
    if (xFit === null || yFit === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "GAZE",
        "Ridge gaze model fitting failed because the regression system is singular or invalid."
      );
    }
    const trainingRmse = calculateTrainingRmse2(
      designRows,
      targets,
      xFit.coefficients,
      yFit.coefficients
    );
    if (trainingRmse === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "GAZE",
        "Ridge gaze model produced an invalid training RMSE."
      );
    }
    const model = {
      version: RIDGE_MODEL_VERSION,
      featureNames: [...RIDGE_GAZE_FEATURE_NAMES],
      featureMean: [...featureMean],
      featureScale: [...featureScale],
      coefficientX: [...xFit.coefficients],
      coefficientY: [...yFit.coefficients],
      ridgeLambda,
      trainingSampleCount: prepared.length,
      trainingRmse
    };
    assertValidModel(model);
    this.model = cloneModel(model);
    logger4.info(
      "Ridge gaze model fitted.",
      {
        trainingSampleCount: model.trainingSampleCount,
        trainingRmse: model.trainingRmse,
        ridgeLambda: model.ridgeLambda
      }
    );
    return cloneModel(model);
  }
  setModel(model) {
    this.assertNotDisposed();
    assertValidModel(model);
    this.model = cloneModel(model);
    this.lastPredictionTimestampMs = null;
  }
  getModel() {
    return this.model === null ? null : cloneModel(this.model);
  }
  clearModel() {
    this.assertNotDisposed();
    this.model = null;
    this.lastPredictionTimestampMs = null;
  }
  getSnapshot() {
    return {
      source: this.source,
      lifecycle: this.lifecycle,
      initialized: this.lifecycle === "READY",
      lastPredictionTimestampMs: this.lastPredictionTimestampMs,
      modelReady: this.model !== null,
      trainingSampleCount: this.model?.trainingSampleCount ?? 0,
      trainingRmse: this.model?.trainingRmse ?? null
    };
  }
  dispose() {
    if (this.lifecycle === "DISPOSED") {
      return Promise.resolve();
    }
    this.lifecycle = "DISPOSED";
    this.lastPredictionTimestampMs = null;
    this.model = null;
    return Promise.resolve();
  }
  assertReady() {
    if (this.lifecycle === "READY") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "Ridge gaze engine is not ready for prediction.",
      {
        details: {
          lifecycle: this.lifecycle
        }
      }
    );
  }
  assertNotDisposed() {
    if (this.lifecycle !== "DISPOSED") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "Disposed Ridge gaze engine cannot be modified."
    );
  }
};

// src/gaze/webEyeTrackBackend.ts
var logger5 = createLogger("GAZE");
function clamp013(value) {
  return Math.min(
    NORMALIZED_COORDINATE.MAX,
    Math.max(
      NORMALIZED_COORDINATE.MIN,
      value
    )
  );
}
function readFinitePoint(values) {
  const x2 = values[0];
  const y2 = values[1];
  if (typeof x2 !== "number" || typeof y2 !== "number" || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return null;
  }
  return {
    x: x2,
    y: y2
  };
}
function isObject(value) {
  return typeof value === "object" && value !== null;
}
function resolveVendorModule(moduleValue) {
  if (!isObject(moduleValue)) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "WebEyeTrack vendor module did not evaluate to an object."
    );
  }
  const namedConstructor = moduleValue["WebEyeTrack"];
  if (typeof namedConstructor === "function") {
    return {
      WebEyeTrack: namedConstructor,
      vendorStub: moduleValue["__WEBEYETRACK_VENDOR_STUB__"] === true,
      exportShape: "NAMED"
    };
  }
  const defaultExport = moduleValue["default"];
  if (isObject(defaultExport)) {
    const defaultConstructor = defaultExport["WebEyeTrack"];
    if (typeof defaultConstructor === "function") {
      return {
        WebEyeTrack: defaultConstructor,
        vendorStub: defaultExport["__WEBEYETRACK_VENDOR_STUB__"] === true || moduleValue["__WEBEYETRACK_VENDOR_STUB__"] === true,
        exportShape: "DEFAULT_OBJECT"
      };
    }
  }
  if (typeof defaultExport === "function") {
    return {
      WebEyeTrack: defaultExport,
      vendorStub: moduleValue["__WEBEYETRACK_VENDOR_STUB__"] === true,
      exportShape: "DEFAULT_CONSTRUCTOR"
    };
  }
  throw new TrackerError(
    ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
    "GAZE",
    "Unable to resolve the WebEyeTrack constructor from the local vendor runtime.",
    {
      details: {
        moduleKeys: Object.keys(moduleValue),
        defaultExportType: typeof defaultExport,
        defaultExportKeys: isObject(defaultExport) ? Object.keys(defaultExport) : []
      }
    }
  );
}
function assertPinnedRuntimeShape(runtime) {
  const candidate = runtime;
  const faceLandmarkerClient = candidate["faceLandmarkerClient"];
  const blazeGaze = candidate["blazeGaze"];
  const kalmanFilter = candidate["kalmanFilter"];
  if (!isObject(faceLandmarkerClient) || typeof faceLandmarkerClient["processFrame"] !== "function" || !isObject(blazeGaze) || typeof blazeGaze["loadModel"] !== "function" || !isObject(kalmanFilter) || typeof kalmanFilter["step"] !== "function" || !("affineMatrix" in candidate)) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Pinned WebEyeTrack runtime structure does not match the local backend bridge.",
      {
        details: {
          expectedPackageVersion: WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION,
          expectedUpstreamCommit: WEB_EYE_TRACK_RUNTIME.UPSTREAM_COMMIT
        }
      }
    );
  }
}
function toVendorFaceResult(result) {
  const transformationMatrix = result.transformationMatrix;
  if (!result.faceDetected || result.landmarks.length === 0 || transformationMatrix === null) {
    return null;
  }
  return {
    faceLandmarks: [
      result.landmarks
    ],
    facialTransformationMatrixes: [
      {
        rows: transformationMatrix.rows,
        columns: transformationMatrix.columns,
        data: transformationMatrix.data
      }
    ],
    faceBlendshapes: []
  };
}
var LocalWebEyeTrackBackend = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  runtime = null;
  currentFaceResult = null;
  capturedRawCenteredPoint = null;
  originalModelWeights = [];
  personalizationCaptureActive = false;
  personalizationResetPending = false;
  personalizationAdaptationInFlight = false;
  latestPersonalizationCandidate = null;
  personalizationCandidates = /* @__PURE__ */ new Map();
  stagedPersonalizationPoints = [];
  canvas = null;
  context = null;
  initialized = false;
  disposed = false;
  predictionInFlight = false;
  async initialize() {
    if (this.initialized) {
      return;
    }
    if (this.disposed) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed WebEyeTrack backend cannot be initialized."
      );
    }
    const modelBaseUrl = this.resolveModelBaseUrl();
    let stage = "VERIFY_MODEL_MANIFEST";
    try {
      logger5.info(
        "WebEyeTrack initialization started.",
        {
          packageVersion: WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION,
          stage
        }
      );
      if (this.options.verifyModelAsset !== false) {
        await this.verifyLocalModelManifest(
          modelBaseUrl
        );
      }
      logger5.info(
        "WebEyeTrack local model manifest verified.",
        { stage }
      );
      stage = "IMPORT_VENDOR_RUNTIME";
      const importedVendorModule = await import("../chunks/runtime-ERKEKGXU.js");
      stage = "RESOLVE_VENDOR_EXPORT";
      const vendorModule = resolveVendorModule(
        importedVendorModule
      );
      logger5.info(
        "WebEyeTrack vendor runtime imported.",
        {
          stage,
          exportShape: vendorModule.exportShape
        }
      );
      if (vendorModule.vendorStub) {
        throw new TrackerError(
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          "WebEyeTrack local vendor runtime has not been provisioned.",
          {
            details: {
              command: "npm run vendor:webeyetrack",
              packageVersion: WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION
            }
          }
        );
      }
      stage = "CONSTRUCT_VENDOR_RUNTIME";
      const runtime = new vendorModule.WebEyeTrack();
      stage = "VERIFY_RUNTIME_SHAPE";
      assertPinnedRuntimeShape(runtime);
      logger5.info(
        "WebEyeTrack runtime structure verified.",
        { stage }
      );
      stage = "INSTALL_FACE_BRIDGE";
      this.installFaceLandmarkerBridge(
        runtime
      );
      stage = "INSTALL_RAW_OUTPUT_BRIDGE";
      this.installRawOutputBridge(
        runtime
      );
      runtime.affineMatrix = null;
      stage = "LOAD_BLAZEGAZE_MODEL";
      logger5.info(
        "Loading extension-local BlazeGaze model.",
        { stage }
      );
      await runtime.blazeGaze.loadModel(
        modelBaseUrl
      );
      this.captureOriginalModelWeights(
        runtime
      );
      runtime.loaded = true;
      this.runtime = runtime;
      this.initialized = true;
      stage = "READY";
      logger5.info(
        "Local WebEyeTrack backend initialized.",
        {
          packageVersion: WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION,
          modelSource: "extension-local",
          stage
        }
      );
    } catch (error) {
      const originalMessage = getUnknownErrorMessage(error);
      logger5.error(
        "Local WebEyeTrack backend initialization failed.",
        {
          stage,
          originalMessage,
          trackerError: error instanceof TrackerError ? error.toSerializable() : null
        }
      );
      if (error instanceof TrackerError) {
        throw new TrackerError(
          error.code,
          error.component,
          error.message,
          {
            recoverable: error.recoverable,
            cause: error,
            details: {
              ...error.details ?? {},
              initializationStage: stage,
              originalMessage
            }
          }
        );
      }
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "WebEyeTrack backend initialization failed.",
        {
          cause: error,
          details: {
            initializationStage: stage,
            originalMessage
          }
        }
      );
    }
  }
  async predict(input) {
    const runtime = this.assertReady();
    if (this.personalizationAdaptationInFlight) {
      return null;
    }
    if (this.personalizationResetPending) {
      this.activatePendingPersonalizationSession(
        runtime
      );
    }
    if (this.predictionInFlight) {
      throw new TrackerError(
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "Concurrent WebEyeTrack prediction is not allowed."
      );
    }
    const faceResult = toVendorFaceResult(
      input.landmarker
    );
    if (faceResult === null) {
      return null;
    }
    this.predictionInFlight = true;
    this.currentFaceResult = faceResult;
    this.capturedRawCenteredPoint = null;
    try {
      const frame = this.captureFrame(input);
      const gazeResult = await runtime.step(
        frame,
        input.frame.metadata.timestampMs
      );
      if (this.personalizationCaptureActive) {
        this.latestPersonalizationCandidate = this.readPersonalizationCandidate(
          runtime,
          input.frame.metadata.timestampMs
        );
      } else {
        this.latestPersonalizationCandidate = null;
      }
      runtime.latestGazeResult = null;
      if (gazeResult.gazeState !== "open") {
        return null;
      }
      const rawCenteredPoint = this.getCapturedRawCenteredPoint();
      if (rawCenteredPoint === null) {
        throw new TrackerError(
          ERROR_CODES.GAZE_INVALID_SAMPLE,
          "GAZE",
          "WebEyeTrack did not expose a finite pre-filter BlazeGaze prediction."
        );
      }
      return {
        rawPoint: {
          // Upstream BlazeGaze uses screen-centered normalized coordinates
          // where (0, 0) is the center. The project NORMALIZED convention is
          // 0..1 with 0.5 at the center. Do not clamp raw model output.
          x: rawCenteredPoint.x + NORMALIZED_COORDINATE.CENTER,
          y: rawCenteredPoint.y + NORMALIZED_COORDINATE.CENTER
        },
        rawSpace: "NORMALIZED",
        // WebEyeTrack 0.0.2 does not expose a native prediction confidence.
        // Use the already-computed face/eye tracking quality as a transparent
        // input-quality proxy; gazeQuality.ts can refine it downstream.
        confidence: clamp013(
          input.faceQuality.trackingQuality.qualityScore
        )
      };
    } finally {
      this.currentFaceResult = null;
      this.capturedRawCenteredPoint = null;
      this.predictionInFlight = false;
      this.clearCanvas();
      runtime.latestGazeResult = null;
    }
  }
  beginPersonalizationSession() {
    const runtime = this.assertReadyWithInternals();
    this.clearPersonalizationBuffers();
    this.personalizationCaptureActive = false;
    this.personalizationResetPending = false;
    if (!CALIBRATION.WEBEYETRACK_PERSONALIZATION_ENABLED || typeof runtime.adapt !== "function" || this.originalModelWeights.length === 0) {
      logger5.warn(
        "WebEyeTrack native personalization is unavailable; project residual calibration will be used.",
        {
          adaptationAvailable: typeof runtime.adapt === "function",
          genericWeightSnapshotAvailable: this.originalModelWeights.length > 0
        }
      );
      return;
    }
    if (this.predictionInFlight) {
      this.personalizationResetPending = true;
      return;
    }
    this.activatePersonalizationSession(runtime);
  }
  recordLatestPersonalizationCandidate(pointIndex, expectedTimestampMs) {
    if (!this.personalizationCaptureActive) {
      return false;
    }
    const candidate = this.latestPersonalizationCandidate;
    if (candidate === null || !Number.isInteger(pointIndex) || pointIndex < 0 || !Number.isFinite(expectedTimestampMs) || Math.abs(
      candidate.timestampMs - expectedTimestampMs
    ) > CALIBRATION.WEBEYETRACK_PERSONALIZATION_TIMESTAMP_TOLERANCE_MS) {
      return false;
    }
    const candidates = this.personalizationCandidates.get(pointIndex) ?? [];
    candidates.push({
      timestampMs: candidate.timestampMs,
      eyePatch: this.cloneImageData(
        candidate.eyePatch
      ),
      headVector: [...candidate.headVector],
      faceOrigin3D: [...candidate.faceOrigin3D]
    });
    const maximum = CALIBRATION.WEBEYETRACK_PERSONALIZATION_MAX_CANDIDATES_PER_POINT;
    if (candidates.length > maximum) {
      candidates.splice(
        0,
        candidates.length - maximum
      );
    }
    this.personalizationCandidates.set(pointIndex, candidates);
    return true;
  }
  stagePersonalizationPoint(pointIndex, targetNormalizedPoint, stableWindowStartTimestampMs, stableWindowEndTimestampMs) {
    if (!this.personalizationCaptureActive || !Number.isInteger(pointIndex) || pointIndex < 0 || !Number.isFinite(targetNormalizedPoint.x) || !Number.isFinite(targetNormalizedPoint.y) || targetNormalizedPoint.x < 0 || targetNormalizedPoint.x > 1 || targetNormalizedPoint.y < 0 || targetNormalizedPoint.y > 1 || !Number.isFinite(stableWindowStartTimestampMs) || !Number.isFinite(stableWindowEndTimestampMs) || stableWindowEndTimestampMs < stableWindowStartTimestampMs) {
      return false;
    }
    const candidates = this.personalizationCandidates.get(pointIndex) ?? [];
    const inWindow = candidates.filter(
      (candidate) => candidate.timestampMs >= stableWindowStartTimestampMs && candidate.timestampMs <= stableWindowEndTimestampMs
    );
    if (inWindow.length === 0) {
      return false;
    }
    const windowMidpoint = (stableWindowStartTimestampMs + stableWindowEndTimestampMs) / 2;
    let selected = inWindow[0];
    if (selected === void 0) {
      return false;
    }
    for (const candidate of inWindow.slice(1)) {
      if (Math.abs(
        candidate.timestampMs - windowMidpoint
      ) < Math.abs(
        selected.timestampMs - windowMidpoint
      )) {
        selected = candidate;
      }
    }
    this.stagedPersonalizationPoints = this.stagedPersonalizationPoints.filter(
      (point) => point.pointIndex !== pointIndex
    );
    this.stagedPersonalizationPoints.push({
      pointIndex,
      timestampMs: selected.timestampMs,
      eyePatch: selected.eyePatch,
      headVector: [...selected.headVector],
      faceOrigin3D: [...selected.faceOrigin3D],
      targetCentered: {
        x: targetNormalizedPoint.x - NORMALIZED_COORDINATE.CENTER,
        y: targetNormalizedPoint.y - NORMALIZED_COORDINATE.CENTER
      }
    });
    this.stagedPersonalizationPoints.sort(
      (left, right) => left.pointIndex - right.pointIndex
    );
    this.personalizationCandidates.delete(pointIndex);
    return true;
  }
  async applyPersonalization() {
    const runtime = this.assertReadyWithInternals();
    const staged = [...this.stagedPersonalizationPoints];
    const support = staged.slice(
      0,
      CALIBRATION.WEBEYETRACK_PERSONALIZATION_MAX_SUPPORT_POINTS
    );
    if (this.predictionInFlight) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "WebEyeTrack personalization cannot run concurrently with prediction.",
        { recoverable: true }
      );
    }
    if (!CALIBRATION.WEBEYETRACK_PERSONALIZATION_ENABLED || typeof runtime.adapt !== "function" || support.length < CALIBRATION.WEBEYETRACK_PERSONALIZATION_MIN_POINT_COUNT) {
      return {
        applied: false,
        stagedPointCount: staged.length,
        supportPointCount: support.length
      };
    }
    this.personalizationAdaptationInFlight = true;
    try {
      await runtime.adapt(
        support.map(
          (point) => point.eyePatch
        ),
        support.map(
          (point) => [...point.headVector]
        ),
        support.map(
          (point) => [...point.faceOrigin3D]
        ),
        support.map(
          (point) => [
            point.targetCentered.x,
            point.targetCentered.y
          ]
        ),
        CALIBRATION.WEBEYETRACK_PERSONALIZATION_STEPS,
        CALIBRATION.WEBEYETRACK_PERSONALIZATION_INNER_LR,
        "calib"
      );
    } finally {
      this.personalizationAdaptationInFlight = false;
    }
    this.personalizationCaptureActive = false;
    this.latestPersonalizationCandidate = null;
    this.personalizationCandidates.clear();
    this.stagedPersonalizationPoints = [];
    logger5.info(
      "WebEyeTrack native personalization applied.",
      {
        stagedPointCount: staged.length,
        appliedSupportPointCount: support.length,
        stepsInner: CALIBRATION.WEBEYETRACK_PERSONALIZATION_STEPS,
        innerLearningRate: CALIBRATION.WEBEYETRACK_PERSONALIZATION_INNER_LR
      }
    );
    return {
      applied: true,
      stagedPointCount: staged.length,
      supportPointCount: support.length
    };
  }
  dispose() {
    if (this.disposed) {
      return Promise.resolve();
    }
    this.disposed = true;
    this.initialized = false;
    this.predictionInFlight = false;
    this.currentFaceResult = null;
    this.capturedRawCenteredPoint = null;
    this.latestPersonalizationCandidate = null;
    this.personalizationCaptureActive = false;
    this.personalizationResetPending = false;
    this.personalizationAdaptationInFlight = false;
    this.clearPersonalizationBuffers();
    for (const weight of this.originalModelWeights) {
      weight.dispose();
    }
    this.originalModelWeights = [];
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime !== null) {
      const internals = runtime;
      try {
        internals.blazeGaze?.model?.dispose();
      } catch (error) {
        logger5.warn(
          "Failed to dispose WebEyeTrack model resources.",
          {
            error
          }
        );
      }
      runtime.latestGazeResult = null;
    }
    this.clearCanvas();
    this.context = null;
    this.canvas = null;
    return Promise.resolve();
  }
  activatePendingPersonalizationSession(runtime) {
    const internals = runtime;
    this.activatePersonalizationSession(
      internals
    );
  }
  activatePersonalizationSession(runtime) {
    this.restoreOriginalModelWeights(runtime);
    this.clearVendorCalibrationState(runtime);
    this.clearPersonalizationBuffers();
    this.personalizationResetPending = false;
    this.personalizationCaptureActive = true;
    logger5.info(
      "WebEyeTrack personalization session started.",
      {
        nativeAdaptationAvailable: typeof runtime.adapt === "function"
      }
    );
  }
  captureOriginalModelWeights(runtime) {
    const model = runtime.blazeGaze.model;
    if (model === null || model === void 0 || typeof model.getWeights !== "function" || typeof model.setWeights !== "function") {
      logger5.warn(
        "WebEyeTrack model does not expose weight snapshot APIs; native personalization reset will be unavailable."
      );
      return;
    }
    for (const weight of this.originalModelWeights) {
      weight.dispose();
    }
    this.originalModelWeights = model.getWeights().map(
      (weight) => weight.clone()
    );
  }
  restoreOriginalModelWeights(runtime) {
    if (this.originalModelWeights.length === 0) {
      return;
    }
    const model = runtime.blazeGaze.model;
    if (model === null || model === void 0 || typeof model.setWeights !== "function") {
      return;
    }
    model.setWeights(
      this.originalModelWeights
    );
  }
  clearVendorCalibrationState(runtime) {
    runtime.affineMatrix?.dispose();
    runtime.affineMatrix = null;
    const data = runtime.calibData;
    if (data === void 0) {
      return;
    }
    for (const support of data.supportX) {
      support.eyePatches.dispose();
      support.headVectors.dispose();
      support.faceOrigins3D.dispose();
    }
    for (const supportY of data.supportY) {
      supportY.dispose();
    }
    data.supportX = [];
    data.supportY = [];
    data.timestamps = [];
    data.ptType = [];
  }
  clearPersonalizationBuffers() {
    this.latestPersonalizationCandidate = null;
    this.personalizationCandidates.clear();
    this.stagedPersonalizationPoints = [];
  }
  readPersonalizationCandidate(runtime, expectedTimestampMs) {
    const gazeResult = runtime.latestGazeResult;
    const eyePatch = gazeResult?.eyePatch;
    const headVector = gazeResult?.headVector;
    const faceOrigin3D = gazeResult?.faceOrigin3D;
    if (gazeResult === null || gazeResult.gazeState !== "open" || eyePatch === void 0 || headVector === void 0 || faceOrigin3D === void 0 || headVector.length < 3 || faceOrigin3D.length < 3 || headVector.some(
      (value) => !Number.isFinite(value)
    ) || faceOrigin3D.some(
      (value) => !Number.isFinite(value)
    )) {
      return null;
    }
    return {
      timestampMs: expectedTimestampMs,
      eyePatch,
      headVector: [...headVector],
      faceOrigin3D: [...faceOrigin3D]
    };
  }
  cloneImageData(source) {
    return new ImageData(
      new Uint8ClampedArray(source.data),
      source.width,
      source.height
    );
  }
  assertReadyWithInternals() {
    const runtime = this.assertReady();
    assertPinnedRuntimeShape(runtime);
    return runtime;
  }
  resolveModelBaseUrl() {
    const override = this.options.modelBaseUrl;
    if (typeof override === "string" && override.length > 0) {
      return override.replace(
        /\/$/u,
        ""
      );
    }
    return chrome.runtime.getURL(
      WEB_EYE_TRACK_RUNTIME.MODEL_BASE_ASSET_PATH
    ).replace(
      /\/$/u,
      ""
    );
  }
  async verifyLocalModelManifest(modelBaseUrl) {
    const manifestUrl = `${modelBaseUrl}/web/model.json`;
    let response;
    try {
      response = await fetch(
        manifestUrl,
        {
          cache: "no-store"
        }
      );
    } catch (error) {
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Unable to read the extension-local WebEyeTrack model manifest.",
        {
          cause: error,
          details: {
            modelAssetPath: WEB_EYE_TRACK_RUNTIME.MODEL_JSON_ASSET_PATH
          }
        }
      );
    }
    if (!response.ok) {
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Extension-local WebEyeTrack model manifest is missing.",
        {
          details: {
            status: response.status,
            modelAssetPath: WEB_EYE_TRACK_RUNTIME.MODEL_JSON_ASSET_PATH,
            provisioningCommand: "npm run vendor:webeyetrack"
          }
        }
      );
    }
  }
  getCapturedRawCenteredPoint() {
    return this.capturedRawCenteredPoint;
  }
  installFaceLandmarkerBridge(runtime) {
    runtime.faceLandmarkerClient = {
      processFrame: (_frame) => Promise.resolve(
        this.currentFaceResult
      )
    };
  }
  installRawOutputBridge(runtime) {
    runtime.kalmanFilter = {
      step: (measurement) => {
        const point = readFinitePoint(measurement);
        if (point === null) {
          this.capturedRawCenteredPoint = null;
          return measurement;
        }
        this.capturedRawCenteredPoint = point;
        return [
          point.x,
          point.y
        ];
      }
    };
  }
  captureFrame(input) {
    const width = input.frame.metadata.width;
    const height = input.frame.metadata.height;
    const context = this.ensureCanvas(
      width,
      height
    );
    context.drawImage(
      input.frame.source,
      0,
      0,
      width,
      height
    );
    return context.getImageData(
      0,
      0,
      width,
      height
    );
  }
  ensureCanvas(width, height) {
    if (this.canvas === null) {
      this.canvas = document.createElement("canvas");
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.context = null;
    }
    if (this.context === null) {
      this.context = this.canvas.getContext(
        "2d",
        {
          alpha: false,
          willReadFrequently: true
        }
      );
    }
    if (this.context === null) {
      throw new TrackerError(
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "Unable to create the transient WebEyeTrack canvas context."
      );
    }
    return this.context;
  }
  clearCanvas() {
    if (this.canvas === null || this.context === null) {
      return;
    }
    this.context.clearRect(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
  }
  assertReady() {
    if (this.initialized && !this.disposed && this.runtime !== null) {
      return this.runtime;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "WebEyeTrack backend is not ready for prediction."
    );
  }
};

// src/gaze/webEyeTrackEngine.ts
var logger6 = createLogger("GAZE");
function isFinitePoint3(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function isValidConfidence(confidence) {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}
function assertSynchronizedInput2(input) {
  const expectedFrameSequence = input.frame.metadata.frameSequence;
  const expectedTimestampMs = input.frame.metadata.timestampMs;
  const frameResults = [
    input.landmarker,
    input.faceGeometry,
    input.headPose,
    input.eyeGeometry,
    input.blink,
    input.faceQuality
  ];
  for (const result of frameResults) {
    if (result.frameSequence !== expectedFrameSequence || result.timestampMs !== expectedTimestampMs) {
      throw new TrackerError(
        ERROR_CODES.GAZE_INVALID_SAMPLE,
        "GAZE",
        "Gaze engine received unsynchronized frame analysis results.",
        {
          details: {
            expectedFrameSequence,
            expectedTimestampMs,
            receivedFrameSequence: result.frameSequence,
            receivedTimestampMs: result.timestampMs
          }
        }
      );
    }
  }
}
function isInputUsableForPrediction2(input) {
  const trackingQuality = input.faceQuality.trackingQuality;
  return input.faceQuality.usableForGaze && trackingQuality.faceValid && trackingQuality.eyesValid && input.faceGeometry.faceDetected && input.faceGeometry.geometryValid && input.faceGeometry.geometry !== null && input.headPose.faceDetected && input.headPose.poseValid && input.headPose.headPose !== null && input.eyeGeometry.faceDetected && input.eyeGeometry.geometryValid && input.eyeGeometry.bothEyesValid && input.eyeGeometry.leftEye !== null && input.eyeGeometry.rightEye !== null && input.blink.valid && input.blink.bothEyesOpen && !input.blink.bothEyesClosed && !input.blink.blinkInProgress && !input.blink.prolongedClosureDetected;
}
function assertValidBackendPrediction(prediction) {
  if (!isFinitePoint3(prediction.rawPoint)) {
    throw new TrackerError(
      ERROR_CODES.GAZE_INVALID_SAMPLE,
      "GAZE",
      "WebEyeTrack backend returned a non-finite gaze point."
    );
  }
  if (!isValidConfidence(prediction.confidence)) {
    throw new TrackerError(
      ERROR_CODES.GAZE_INVALID_SAMPLE,
      "GAZE",
      "WebEyeTrack backend returned an invalid confidence value.",
      {
        details: {
          confidence: prediction.confidence
        }
      }
    );
  }
}
var WebEyeTrackEngine = class {
  constructor(backend = new LocalWebEyeTrackBackend()) {
    this.backend = backend;
  }
  backend;
  source = "WEB_EYE_TRACK";
  lifecycle = "CREATED";
  lastPredictionTimestampMs = null;
  async initialize() {
    if (this.lifecycle === "READY") {
      return;
    }
    if (this.lifecycle === "INITIALIZING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "WebEyeTrack engine is already initializing."
      );
    }
    if (this.lifecycle === "DISPOSED") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed WebEyeTrack engine cannot be initialized."
      );
    }
    this.lifecycle = "INITIALIZING";
    try {
      await this.backend.initialize();
      this.lastPredictionTimestampMs = null;
      this.lifecycle = "READY";
      logger6.info(
        "WebEyeTrack engine initialized."
      );
    } catch (error) {
      this.lifecycle = "ERROR";
      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "WebEyeTrack engine initialization failed."
      );
    }
  }
  async predict(input) {
    this.assertReady();
    assertSynchronizedInput2(input);
    if (!isInputUsableForPrediction2(input)) {
      return null;
    }
    const headPose = input.headPose.headPose;
    if (headPose === null) {
      return null;
    }
    try {
      const backendPrediction = await this.backend.predict(input);
      if (backendPrediction === null) {
        return null;
      }
      assertValidBackendPrediction(
        backendPrediction
      );
      this.lastPredictionTimestampMs = input.frame.metadata.timestampMs;
      return {
        timestampMs: input.frame.metadata.timestampMs,
        rawPoint: backendPrediction.rawPoint,
        rawSpace: backendPrediction.rawSpace,
        confidence: backendPrediction.confidence,
        faceValid: input.faceQuality.trackingQuality.faceValid,
        eyesValid: input.faceQuality.trackingQuality.eyesValid,
        headPose,
        source: this.source
      };
    } catch (error) {
      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "WebEyeTrack gaze prediction failed.",
        {
          details: {
            frameSequence: input.frame.metadata.frameSequence,
            timestampMs: input.frame.metadata.timestampMs
          }
        }
      );
    }
  }
  supportsPersonalization() {
    return typeof this.backend.beginPersonalizationSession === "function" && typeof this.backend.recordLatestPersonalizationCandidate === "function" && typeof this.backend.stagePersonalizationPoint === "function" && typeof this.backend.applyPersonalization === "function";
  }
  beginPersonalizationSession() {
    if (!this.supportsPersonalization()) {
      return false;
    }
    this.backend.beginPersonalizationSession?.();
    return true;
  }
  recordLatestPersonalizationCandidate(pointIndex, expectedTimestampMs) {
    if (!this.supportsPersonalization()) {
      return false;
    }
    return this.backend.recordLatestPersonalizationCandidate?.(
      pointIndex,
      expectedTimestampMs
    ) ?? false;
  }
  stagePersonalizationPoint(pointIndex, targetNormalizedPoint, stableWindowStartTimestampMs, stableWindowEndTimestampMs) {
    if (!this.supportsPersonalization()) {
      return false;
    }
    return this.backend.stagePersonalizationPoint?.(
      pointIndex,
      targetNormalizedPoint,
      stableWindowStartTimestampMs,
      stableWindowEndTimestampMs
    ) ?? false;
  }
  async applyPersonalization() {
    if (!this.supportsPersonalization()) {
      return {
        applied: false,
        stagedPointCount: 0,
        supportPointCount: 0
      };
    }
    return this.backend.applyPersonalization?.() ?? {
      applied: false,
      stagedPointCount: 0,
      supportPointCount: 0
    };
  }
  getSnapshot() {
    return {
      source: this.source,
      lifecycle: this.lifecycle,
      initialized: this.lifecycle === "READY",
      lastPredictionTimestampMs: this.lastPredictionTimestampMs
    };
  }
  dispose() {
    if (this.lifecycle === "DISPOSED") {
      return Promise.resolve();
    }
    this.lifecycle = "DISPOSED";
    this.lastPredictionTimestampMs = null;
    return this.backend.dispose().catch(
      (error) => {
        logger6.warn(
          "WebEyeTrack backend disposal failed.",
          {
            error
          }
        );
      }
    );
  }
  assertReady() {
    if (this.lifecycle === "READY") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "WebEyeTrack engine is not ready for prediction.",
      {
        details: {
          lifecycle: this.lifecycle
        }
      }
    );
  }
};

// src/gaze/gazeImageNormalizer.ts
function clamp3(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}
function sanitizeCrop(crop, frameWidth, frameHeight) {
  if (!Number.isFinite(crop.left) || !Number.isFinite(crop.top) || !Number.isFinite(crop.width) || !Number.isFinite(crop.height) || crop.width <= 1 || crop.height <= 1 || frameWidth <= 1 || frameHeight <= 1) {
    throw new TrackerError(
      ERROR_CODES.GAZE_INVALID_SAMPLE,
      "GAZE",
      "L2CS preprocessing received an invalid face crop.",
      {
        details: {
          crop,
          frameWidth,
          frameHeight
        }
      }
    );
  }
  const left = clamp3(
    crop.left,
    0,
    frameWidth - 1
  );
  const top = clamp3(
    crop.top,
    0,
    frameHeight - 1
  );
  const right = clamp3(
    crop.left + crop.width,
    left + 1,
    frameWidth
  );
  const bottom = clamp3(
    crop.top + crop.height,
    top + 1,
    frameHeight
  );
  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}
function createCanvas(width, height) {
  if (typeof document === "undefined" || document.createElement === void 0) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "L2CS image preprocessing requires the extension Offscreen document."
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function getContext(canvas) {
  const context = canvas.getContext(
    "2d",
    {
      alpha: false,
      willReadFrequently: true
    }
  );
  if (context === null) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Unable to create the 2D canvas context required for L2CS preprocessing."
    );
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}
var L2csImageNormalizer = class {
  faceCanvas;
  modelCanvas;
  faceContext;
  modelContext;
  constructor() {
    this.faceCanvas = createCanvas(
      L2CS_GAZE_MODEL.FACE_CROP_WIDTH,
      L2CS_GAZE_MODEL.FACE_CROP_HEIGHT
    );
    this.modelCanvas = createCanvas(
      L2CS_GAZE_MODEL.INPUT_WIDTH,
      L2CS_GAZE_MODEL.INPUT_HEIGHT
    );
    this.faceContext = getContext(
      this.faceCanvas
    );
    this.modelContext = getContext(
      this.modelCanvas
    );
  }
  normalize(frame, faceCropPx) {
    const crop = sanitizeCrop(
      faceCropPx,
      frame.metadata.width,
      frame.metadata.height
    );
    this.faceContext.clearRect(
      0,
      0,
      this.faceCanvas.width,
      this.faceCanvas.height
    );
    this.faceContext.drawImage(
      frame.source,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      0,
      0,
      this.faceCanvas.width,
      this.faceCanvas.height
    );
    this.modelContext.clearRect(
      0,
      0,
      this.modelCanvas.width,
      this.modelCanvas.height
    );
    this.modelContext.drawImage(
      this.faceCanvas,
      0,
      0,
      this.faceCanvas.width,
      this.faceCanvas.height,
      0,
      0,
      this.modelCanvas.width,
      this.modelCanvas.height
    );
    const imageData = this.modelContext.getImageData(
      0,
      0,
      this.modelCanvas.width,
      this.modelCanvas.height
    );
    const pixelCount = L2CS_GAZE_MODEL.INPUT_WIDTH * L2CS_GAZE_MODEL.INPUT_HEIGHT;
    const tensorData = new Float32Array(
      pixelCount * L2CS_GAZE_MODEL.CHANNEL_COUNT
    );
    const rgba = imageData.data;
    const mean15 = L2CS_GAZE_MODEL.IMAGE_NET_MEAN;
    const std = L2CS_GAZE_MODEL.IMAGE_NET_STD;
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const rgbaIndex = pixelIndex * 4;
      const red = (rgba[rgbaIndex] ?? 0) / 255;
      const green = (rgba[rgbaIndex + 1] ?? 0) / 255;
      const blue = (rgba[rgbaIndex + 2] ?? 0) / 255;
      tensorData[pixelIndex] = (red - mean15[0]) / std[0];
      tensorData[pixelCount + pixelIndex] = (green - mean15[1]) / std[1];
      tensorData[pixelCount * 2 + pixelIndex] = (blue - mean15[2]) / std[2];
    }
    return {
      data: tensorData,
      dimensions: [
        1,
        3,
        448,
        448
      ],
      sourceCropPx: crop
    };
  }
};

// src/gaze/onnxRuntime.ts
var logger7 = createLogger("GAZE");
var runtimeModulePromise = null;
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function isOnnxEnvironment(value) {
  if (!isRecord2(value)) {
    return false;
  }
  return isRecord2(value.wasm);
}
function isOnnxRuntimeModule(value) {
  if (!isRecord2(value)) {
    return false;
  }
  return isOnnxEnvironment(value.env) && "InferenceSession" in value && "Tensor" in value;
}
function resolveImportedRuntimeModule(value) {
  if (isOnnxRuntimeModule(value)) {
    return value;
  }
  if (isRecord2(value) && isOnnxRuntimeModule(value.default)) {
    return value.default;
  }
  return null;
}
function listRecordKeys(value) {
  if (!isRecord2(value)) {
    return [];
  }
  return Object.keys(value).slice(0, 32);
}
function getRuntimeAssetUrl(relativePath) {
  if (typeof chrome === "undefined" || chrome.runtime?.getURL === void 0) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "ONNX Runtime can only be loaded inside the Chrome extension runtime.",
      {
        details: {
          relativePath
        }
      }
    );
  }
  return chrome.runtime.getURL(
    relativePath
  );
}
async function importLocalRuntimeModule(moduleUrl) {
  return import(moduleUrl);
}
function configureRuntime(runtime) {
  runtime.env.logLevel = "warning";
  runtime.env.wasm.wasmPaths = getRuntimeAssetUrl(
    ONNX_RUNTIME_WEB.WASM_BASE_ASSET_PATH
  );
  runtime.env.wasm.numThreads = ONNX_RUNTIME_WEB.DEFAULT_WASM_THREADS;
  runtime.env.wasm.proxy = false;
}
async function loadRuntimeModuleOnce() {
  const moduleUrl = getRuntimeAssetUrl(
    ONNX_RUNTIME_WEB.MODULE_ASSET_PATH
  );
  let importedModule;
  try {
    importedModule = await importLocalRuntimeModule(
      moduleUrl
    );
  } catch (error) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Failed to load the local ONNX Runtime Web module.",
      {
        cause: error,
        details: {
          moduleAssetPath: ONNX_RUNTIME_WEB.MODULE_ASSET_PATH,
          runtimeVersion: ONNX_RUNTIME_WEB.PACKAGE_VERSION
        }
      }
    );
  }
  const runtime = resolveImportedRuntimeModule(
    importedModule
  );
  if (runtime === null) {
    const defaultExport = isRecord2(importedModule) ? importedModule.default : void 0;
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "The local ONNX Runtime module does not expose the expected runtime API.",
      {
        details: {
          runtimeVersion: ONNX_RUNTIME_WEB.PACKAGE_VERSION,
          moduleNamespaceKeys: listRecordKeys(importedModule),
          defaultExportKeys: listRecordKeys(defaultExport)
        }
      }
    );
  }
  configureRuntime(
    runtime
  );
  logger7.info(
    "Local ONNX Runtime Web module loaded.",
    {
      runtimeVersion: ONNX_RUNTIME_WEB.PACKAGE_VERSION,
      webGpuApiAvailable: "gpu" in navigator,
      wasmThreads: runtime.env.wasm.numThreads
    }
  );
  return runtime;
}
async function loadOnnxRuntimeWeb() {
  if (runtimeModulePromise === null) {
    runtimeModulePromise = loadRuntimeModuleOnce();
  }
  try {
    return await runtimeModulePromise;
  } catch (error) {
    runtimeModulePromise = null;
    throw error;
  }
}
function getOnnxRuntimeCapability() {
  return {
    runtimeVersion: ONNX_RUNTIME_WEB.PACKAGE_VERSION,
    webGpuApiAvailable: "gpu" in navigator,
    preferredExecutionProviders: ONNX_RUNTIME_WEB.PREFERRED_EXECUTION_PROVIDERS
  };
}

// src/gaze/l2csOnnxSession.ts
var logger8 = createLogger("GAZE");
function canHaveProperties(value) {
  return typeof value === "object" && value !== null || typeof value === "function";
}
function hasCallableCreate(value) {
  if (!canHaveProperties(value)) {
    return false;
  }
  return "create" in value && typeof Reflect.get(
    value,
    "create"
  ) === "function";
}
function resolveOrtRuntime(runtime) {
  const tensor = runtime.Tensor;
  const inferenceSession = runtime.InferenceSession;
  if (typeof tensor !== "function" || !hasCallableCreate(
    inferenceSession
  )) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "ONNX Runtime does not expose the session/tensor API required by L2CS.",
      {
        details: {
          tensorType: typeof tensor,
          inferenceSessionType: typeof inferenceSession,
          inferenceSessionHasCreate: hasCallableCreate(
            inferenceSession
          )
        }
      }
    );
  }
  return {
    Tensor: tensor,
    InferenceSession: inferenceSession
  };
}
function getExtensionAssetUrl(path) {
  if (typeof chrome === "undefined" || chrome.runtime?.getURL === void 0) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "L2CS model loading requires the Chrome extension runtime.",
      {
        details: {
          path
        }
      }
    );
  }
  return chrome.runtime.getURL(path);
}
async function loadModelBytes() {
  const modelUrl = getExtensionAssetUrl(
    L2CS_GAZE_MODEL.MODEL_ASSET_PATH
  );
  let response;
  try {
    response = await fetch(modelUrl);
  } catch (error) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Failed to read the extension-local L2CS ONNX model.",
      {
        cause: error,
        details: {
          modelAssetPath: L2CS_GAZE_MODEL.MODEL_ASSET_PATH
        }
      }
    );
  }
  if (!response.ok) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "The extension-local L2CS ONNX model is not provisioned.",
      {
        details: {
          modelAssetPath: L2CS_GAZE_MODEL.MODEL_ASSET_PATH,
          status: response.status
        }
      }
    );
  }
  return new Uint8Array(
    await response.arrayBuffer()
  );
}
function includesName(names, expected) {
  return names.includes(expected);
}
function assertSessionContract(session) {
  if (!includesName(
    session.inputNames,
    L2CS_GAZE_MODEL.INPUT_NAME
  ) || !includesName(
    session.outputNames,
    L2CS_GAZE_MODEL.YAW_OUTPUT_NAME
  ) || !includesName(
    session.outputNames,
    L2CS_GAZE_MODEL.PITCH_OUTPUT_NAME
  ) || !includesName(
    session.outputNames,
    L2CS_GAZE_MODEL.FEATURE_OUTPUT_NAME
  )) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "The provisioned L2CS ONNX model does not match the project-owned tensor contract.",
      {
        details: {
          expectedInput: L2CS_GAZE_MODEL.INPUT_NAME,
          expectedOutputs: [
            L2CS_GAZE_MODEL.YAW_OUTPUT_NAME,
            L2CS_GAZE_MODEL.PITCH_OUTPUT_NAME,
            L2CS_GAZE_MODEL.FEATURE_OUTPUT_NAME
          ],
          actualInputs: session.inputNames,
          actualOutputs: session.outputNames
        }
      }
    );
  }
}
async function tryCreateSession(factory, modelBytes, provider) {
  const session = await factory.create(
    modelBytes,
    {
      executionProviders: [
        provider
      ],
      graphOptimizationLevel: "all"
    }
  );
  assertSessionContract(session);
  return session;
}
var BrowserL2csInferenceSession = class {
  constructor(session, Tensor, executionProvider) {
    this.session = session;
    this.Tensor = Tensor;
    this.executionProvider = executionProvider;
  }
  session;
  Tensor;
  executionProvider;
  createInputTensor(data) {
    return new this.Tensor(
      "float32",
      data,
      [
        1,
        L2CS_GAZE_MODEL.CHANNEL_COUNT,
        L2CS_GAZE_MODEL.INPUT_HEIGHT,
        L2CS_GAZE_MODEL.INPUT_WIDTH
      ]
    );
  }
  async run(input) {
    return this.session.run({
      [L2CS_GAZE_MODEL.INPUT_NAME]: input
    });
  }
  async release() {
    if (this.session.release === void 0) {
      return;
    }
    await this.session.release();
  }
};
async function createL2csInferenceSession() {
  const runtime = resolveOrtRuntime(
    await loadOnnxRuntimeWeb()
  );
  const capability = getOnnxRuntimeCapability();
  const modelBytes = await loadModelBytes();
  const providers = capability.webGpuApiAvailable ? ["webgpu", "wasm"] : ["wasm"];
  let lastError = null;
  for (const provider of providers) {
    try {
      const session = await tryCreateSession(
        runtime.InferenceSession,
        modelBytes,
        provider
      );
      logger8.info(
        "L2CS ONNX inference session ready.",
        {
          executionProvider: provider,
          modelAssetPath: L2CS_GAZE_MODEL.MODEL_ASSET_PATH,
          modelBytes: modelBytes.byteLength
        }
      );
      return new BrowserL2csInferenceSession(
        session,
        runtime.Tensor,
        provider
      );
    } catch (error) {
      lastError = normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        `L2CS session initialization failed for ${provider}.`
      );
      logger8.warn(
        "L2CS execution provider unavailable for the current browser/model combination.",
        {
          executionProvider: provider,
          error: {
            code: lastError.code,
            message: lastError.message
          }
        }
      );
    }
  }
  throw lastError ?? new TrackerError(
    ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
    "GAZE",
    "No ONNX Runtime execution provider could initialize the L2CS model."
  );
}

// src/gaze/universalDeepEngine.ts
var logger9 = createLogger("GAZE");
function assertSynchronizedInput3(input) {
  const frameSequence = input.frame.metadata.frameSequence;
  const timestampMs = input.frame.metadata.timestampMs;
  const results = [
    input.landmarker,
    input.faceGeometry,
    input.headPose,
    input.eyeGeometry,
    input.blink,
    input.faceQuality
  ];
  for (const result of results) {
    if (result.frameSequence !== frameSequence || result.timestampMs !== timestampMs) {
      throw new TrackerError(
        ERROR_CODES.GAZE_INVALID_SAMPLE,
        "GAZE",
        "Universal deep gaze engine received unsynchronized frame analysis results.",
        {
          details: {
            expectedFrameSequence: frameSequence,
            expectedTimestampMs: timestampMs,
            receivedFrameSequence: result.frameSequence,
            receivedTimestampMs: result.timestampMs
          }
        }
      );
    }
  }
}
function isInputUsable(input) {
  const trackingQuality = input.faceQuality.trackingQuality;
  return input.faceQuality.usableForGaze && trackingQuality.faceValid && trackingQuality.eyesValid && input.faceGeometry.faceDetected && input.faceGeometry.geometryValid && input.faceGeometry.geometry !== null && input.headPose.faceDetected && input.headPose.poseValid && input.headPose.headPose !== null && input.eyeGeometry.faceDetected && input.eyeGeometry.geometryValid && input.eyeGeometry.bothEyesValid && input.blink.valid && input.blink.bothEyesOpen && !input.blink.bothEyesClosed && !input.blink.blinkInProgress && !input.blink.prolongedClosureDetected;
}
function getFloat32Output(outputs, name, expectedLength) {
  const output = outputs[name];
  if (output === void 0 || output.type !== "float32" || !(output.data instanceof Float32Array) || output.data.length !== expectedLength) {
    throw new TrackerError(
      ERROR_CODES.GAZE_PREDICTION_FAILED,
      "GAZE",
      "L2CS ONNX output does not match the expected float32 tensor contract.",
      {
        details: {
          outputName: name,
          expectedLength,
          actualType: output?.type ?? null,
          actualLength: output?.data.byteLength ?? null,
          actualDimensions: output?.dims ?? null
        }
      }
    );
  }
  return output.data;
}
function decodeBinnedAngle(logits) {
  let maxLogit = Number.NEGATIVE_INFINITY;
  for (const logit of logits) {
    if (!Number.isFinite(logit)) {
      throw new TrackerError(
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "L2CS produced a non-finite gaze logit."
      );
    }
    maxLogit = Math.max(
      maxLogit,
      logit
    );
  }
  let probabilitySum = 0;
  let weightedBinSum = 0;
  let entropyNumerator = 0;
  const exponentials = new Float64Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    const logit = logits[index];
    if (logit === void 0) {
      continue;
    }
    const exponent = Math.exp(
      logit - maxLogit
    );
    exponentials[index] = exponent;
    probabilitySum += exponent;
  }
  if (!Number.isFinite(probabilitySum) || probabilitySum <= 0) {
    throw new TrackerError(
      ERROR_CODES.GAZE_PREDICTION_FAILED,
      "GAZE",
      "L2CS softmax normalization failed."
    );
  }
  for (let index = 0; index < exponentials.length; index += 1) {
    const probability = (exponentials[index] ?? 0) / probabilitySum;
    weightedBinSum += probability * index;
    if (probability > 0) {
      entropyNumerator -= probability * Math.log(probability);
    }
  }
  const degrees = weightedBinSum * L2CS_GAZE_MODEL.BIN_SIZE_DEGREES + L2CS_GAZE_MODEL.MIN_ANGLE_DEGREES;
  const normalizedEntropy = entropyNumerator / Math.log(
    L2CS_GAZE_MODEL.BIN_COUNT
  );
  const entropyConfidence = Math.min(
    1,
    Math.max(
      0,
      1 - normalizedEntropy
    )
  );
  return {
    radians: degrees * Math.PI / 180,
    entropyConfidence
  };
}
function cloneFeature(feature) {
  return new Float32Array(feature);
}
var UniversalDeepEngine = class {
  source = "ONNX";
  lifecycle = "CREATED";
  session = null;
  normalizer = null;
  lastPredictionTimestampMs = null;
  latestFeature = null;
  async initialize() {
    if (this.lifecycle === "READY") {
      return;
    }
    if (this.lifecycle === "INITIALIZING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Universal deep gaze engine is already initializing."
      );
    }
    if (this.lifecycle === "DISPOSED") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed universal deep gaze engine cannot be initialized."
      );
    }
    this.lifecycle = "INITIALIZING";
    try {
      this.normalizer = new L2csImageNormalizer();
      this.session = await createL2csInferenceSession();
      this.latestFeature = null;
      this.lastPredictionTimestampMs = null;
      this.lifecycle = "READY";
    } catch (error) {
      this.session = null;
      this.normalizer = null;
      this.latestFeature = null;
      this.lifecycle = "ERROR";
      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Failed to initialize the universal L2CS deep gaze engine."
      );
    }
  }
  async predict(input) {
    if (this.lifecycle !== "READY" || this.session === null || this.normalizer === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Universal deep gaze prediction requires a ready engine."
      );
    }
    assertSynchronizedInput3(input);
    if (!isInputUsable(input)) {
      this.latestFeature = null;
      return null;
    }
    const geometry = input.faceGeometry.geometry;
    const headPose = input.headPose.headPose;
    if (geometry === null || headPose === null) {
      this.latestFeature = null;
      return null;
    }
    try {
      const normalizedInput = this.normalizer.normalize(
        input.frame,
        geometry.boundsPx
      );
      const tensor = this.session.createInputTensor(
        normalizedInput.data
      );
      const outputs = await this.session.run(tensor);
      const yawLogits = getFloat32Output(
        outputs,
        L2CS_GAZE_MODEL.YAW_OUTPUT_NAME,
        L2CS_GAZE_MODEL.BIN_COUNT
      );
      const pitchLogits = getFloat32Output(
        outputs,
        L2CS_GAZE_MODEL.PITCH_OUTPUT_NAME,
        L2CS_GAZE_MODEL.BIN_COUNT
      );
      const feature = getFloat32Output(
        outputs,
        L2CS_GAZE_MODEL.FEATURE_OUTPUT_NAME,
        L2CS_GAZE_MODEL.BACKBONE_FEATURE_DIMENSION
      );
      const yaw = decodeBinnedAngle(yawLogits);
      const pitch = decodeBinnedAngle(pitchLogits);
      const confidence = (yaw.entropyConfidence + pitch.entropyConfidence) / 2;
      this.latestFeature = {
        frameSequence: input.frame.metadata.frameSequence,
        timestampMs: input.frame.metadata.timestampMs,
        values: cloneFeature(feature)
      };
      this.lastPredictionTimestampMs = input.frame.metadata.timestampMs;
      return {
        timestampMs: input.frame.metadata.timestampMs,
        rawPoint: {
          x: yaw.radians,
          y: pitch.radians
        },
        rawSpace: "MODEL",
        confidence,
        faceValid: true,
        eyesValid: true,
        headPose,
        source: this.source
      };
    } catch (error) {
      this.latestFeature = null;
      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "L2CS ONNX gaze inference failed."
      );
    }
  }
  getLatestFeatureSnapshot() {
    if (this.latestFeature === null) {
      return null;
    }
    return {
      frameSequence: this.latestFeature.frameSequence,
      timestampMs: this.latestFeature.timestampMs,
      values: cloneFeature(
        this.latestFeature.values
      )
    };
  }
  getExecutionProvider() {
    return this.session?.executionProvider ?? null;
  }
  getSnapshot() {
    return {
      source: this.source,
      lifecycle: this.lifecycle,
      initialized: this.lifecycle === "READY",
      lastPredictionTimestampMs: this.lastPredictionTimestampMs
    };
  }
  async dispose() {
    if (this.lifecycle === "DISPOSED") {
      return;
    }
    this.lifecycle = "DISPOSED";
    const session = this.session;
    this.session = null;
    this.normalizer = null;
    this.latestFeature = null;
    this.lastPredictionTimestampMs = null;
    if (session !== null) {
      try {
        await session.release();
      } catch (error) {
        logger9.warn(
          "L2CS ONNX session release failed.",
          {
            error
          }
        );
      }
    }
  }
};

// src/gaze/gazePredictor.ts
var logger10 = createLogger("GAZE");
function resolveOptions(options) {
  const targetSampleRateHz = options.targetSampleRateHz ?? GAZE_RUNTIME_DEFAULTS.TARGET_SAMPLE_RATE_HZ;
  if (!Number.isFinite(targetSampleRateHz) || targetSampleRateHz <= 0) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Gaze predictor sample rate must be a finite positive number.",
      {
        details: {
          targetSampleRateHz
        }
      }
    );
  }
  const observerSampleRateHz = options.observerSampleRateHz ?? GAZE_RUNTIME_DEFAULTS.DEEP_OBSERVER_SAMPLE_RATE_HZ;
  if (!Number.isFinite(observerSampleRateHz) || observerSampleRateHz <= 0) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Gaze observer sample rate must be a finite positive number.",
      {
        details: {
          observerSampleRateHz
        }
      }
    );
  }
  return {
    targetSampleRateHz,
    fallbackOnNullPrediction: options.fallbackOnNullPrediction ?? true,
    observerSampleRateHz
  };
}
function isSameFrame(input, frameSequence, timestampMs) {
  return frameSequence !== null && timestampMs !== null && input.frame.metadata.frameSequence === frameSequence && input.frame.metadata.timestampMs === timestampMs;
}
function getErrorSummary(error) {
  return {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    details: error.details
  };
}
var GazePredictor = class {
  constructor(primaryEngine = new WebEyeTrackEngine(), fallbackEngine = new RidgeGazeEngine(), options = {}, observerEngine = new UniversalDeepEngine()) {
    this.primaryEngine = primaryEngine;
    this.fallbackEngine = fallbackEngine;
    this.observerEngine = observerEngine;
    this.options = resolveOptions(options);
    this.minAttemptIntervalMs = 1e3 / this.options.targetSampleRateHz;
    this.observerMinAttemptIntervalMs = 1e3 / this.options.observerSampleRateHz;
  }
  primaryEngine;
  fallbackEngine;
  observerEngine;
  lifecycle = "CREATED";
  options;
  minAttemptIntervalMs;
  observerMinAttemptIntervalMs;
  primaryAvailable = false;
  fallbackAvailable = false;
  activeSource = null;
  lastAttemptTimestampMs = null;
  lastPredictionTimestampMs = null;
  lastProcessedFrameSequence = null;
  lastProcessedFrameTimestampMs = null;
  primaryPredictionFailureCount = 0;
  fallbackPredictionUseCount = 0;
  rateLimitedFrameCount = 0;
  duplicateFrameCount = 0;
  observerAvailable = false;
  observerGeneration = 0;
  observerPredictionInFlight = false;
  observerSuspended = false;
  observerSuspensionReason = null;
  observerLastAttemptTimestampMs = null;
  observerLastPrediction = null;
  observerAttemptCount = 0;
  observerSuccessCount = 0;
  observerNullPredictionCount = 0;
  observerFailureCount = 0;
  observerRateLimitedFrameCount = 0;
  observerInFlightSkippedFrameCount = 0;
  observerSampleListener = null;
  /* ========================================================================
   * Initialization
   * ====================================================================== */
  async initialize() {
    if (this.lifecycle === "READY") {
      return;
    }
    if (this.lifecycle === "INITIALIZING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Gaze predictor is already initializing."
      );
    }
    if (this.lifecycle === "DISPOSED") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed gaze predictor cannot be initialized."
      );
    }
    this.lifecycle = "INITIALIZING";
    this.resetRuntimeCounters();
    let primaryInitializationError = null;
    let fallbackInitializationError = null;
    let observerInitializationError = null;
    try {
      await this.primaryEngine.initialize();
      this.primaryAvailable = this.primaryEngine.getSnapshot().initialized;
    } catch (error) {
      primaryInitializationError = normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Primary gaze engine initialization failed."
      );
      this.primaryAvailable = false;
      logger10.warn(
        "Primary gaze engine unavailable; fallback initialization will continue.",
        {
          source: this.primaryEngine.source,
          error: getErrorSummary(
            primaryInitializationError
          )
        }
      );
    }
    if (this.fallbackEngine !== null) {
      try {
        await this.fallbackEngine.initialize();
        this.fallbackAvailable = this.fallbackEngine.getSnapshot().initialized;
      } catch (error) {
        fallbackInitializationError = normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          "Fallback gaze engine initialization failed."
        );
        this.fallbackAvailable = false;
        logger10.warn(
          "Fallback gaze engine is unavailable.",
          {
            source: this.fallbackEngine.source,
            error: getErrorSummary(
              fallbackInitializationError
            )
          }
        );
      }
    } else {
      this.fallbackAvailable = false;
    }
    if (this.observerEngine !== null) {
      try {
        await this.observerEngine.initialize();
        this.observerAvailable = this.observerEngine.getSnapshot().initialized;
      } catch (error) {
        observerInitializationError = normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          "Observer gaze engine initialization failed."
        );
        this.observerAvailable = false;
        logger10.warn(
          "Observer gaze engine is unavailable; baseline tracking will continue.",
          {
            source: this.observerEngine.source,
            error: getErrorSummary(
              observerInitializationError
            )
          }
        );
      }
    } else {
      this.observerAvailable = false;
    }
    if (!this.primaryAvailable && !this.fallbackAvailable) {
      this.lifecycle = "ERROR";
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "No gaze engine could be initialized.",
        {
          details: {
            primarySource: this.primaryEngine.source,
            primaryError: primaryInitializationError === null ? null : getErrorSummary(
              primaryInitializationError
            ),
            fallbackSource: this.fallbackEngine?.source ?? null,
            fallbackError: fallbackInitializationError === null ? null : getErrorSummary(
              fallbackInitializationError
            )
          },
          cause: fallbackInitializationError ?? primaryInitializationError ?? void 0
        }
      );
    }
    this.lifecycle = "READY";
    logger10.info(
      "Gaze predictor initialized.",
      {
        primarySource: this.primaryEngine.source,
        primaryAvailable: this.primaryAvailable,
        fallbackSource: this.fallbackEngine?.source ?? null,
        fallbackAvailable: this.fallbackAvailable,
        observerSource: this.observerEngine?.source ?? null,
        observerAvailable: this.observerAvailable,
        observerSampleRateHz: this.options.observerSampleRateHz,
        targetSampleRateHz: this.options.targetSampleRateHz
      }
    );
    if (observerInitializationError === null && this.observerAvailable && this.observerEngine !== null) {
      logger10.info(
        "Deep gaze observer is active in shadow mode; WebEyeTrack remains the calibration output until a personal screen mapper is available.",
        {
          observerSource: this.observerEngine.source,
          observerSampleRateHz: this.options.observerSampleRateHz
        }
      );
    }
  }
  /* ========================================================================
   * Prediction
   * ====================================================================== */
  async predict(input) {
    this.assertReady();
    if (isSameFrame(
      input,
      this.lastProcessedFrameSequence,
      this.lastProcessedFrameTimestampMs
    )) {
      this.duplicateFrameCount += 1;
      return null;
    }
    const timestampMs = input.frame.metadata.timestampMs;
    if (this.lastAttemptTimestampMs !== null && timestampMs >= this.lastAttemptTimestampMs && timestampMs - this.lastAttemptTimestampMs < this.minAttemptIntervalMs) {
      this.rateLimitedFrameCount += 1;
      this.rememberProcessedFrame(input);
      return null;
    }
    this.lastAttemptTimestampMs = timestampMs;
    this.rememberProcessedFrame(input);
    this.maybeStartObserverPrediction(
      input
    );
    let primaryError = null;
    if (this.primaryAvailable) {
      try {
        const primaryPrediction = await this.primaryEngine.predict(
          input
        );
        if (primaryPrediction !== null) {
          this.rememberPrediction(
            primaryPrediction
          );
          return primaryPrediction;
        }
        if (!this.options.fallbackOnNullPrediction) {
          return null;
        }
      } catch (error) {
        primaryError = normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_PREDICTION_FAILED,
          "GAZE",
          "Primary gaze prediction failed.",
          {
            details: {
              source: this.primaryEngine.source,
              frameSequence: input.frame.metadata.frameSequence,
              timestampMs
            }
          }
        );
        this.primaryPredictionFailureCount += 1;
        logger10.warn(
          "Primary gaze prediction failed; attempting fallback.",
          {
            source: this.primaryEngine.source,
            frameSequence: input.frame.metadata.frameSequence,
            error: getErrorSummary(
              primaryError
            )
          }
        );
      }
    }
    if (this.fallbackEngine !== null && this.fallbackAvailable) {
      try {
        const fallbackPrediction = await this.fallbackEngine.predict(
          input
        );
        if (fallbackPrediction !== null) {
          this.fallbackPredictionUseCount += 1;
          this.rememberPrediction(
            fallbackPrediction
          );
          return fallbackPrediction;
        }
      } catch (error) {
        const fallbackError = normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_PREDICTION_FAILED,
          "GAZE",
          "Fallback gaze prediction failed.",
          {
            details: {
              source: this.fallbackEngine.source,
              frameSequence: input.frame.metadata.frameSequence,
              timestampMs
            }
          }
        );
        if (primaryError !== null) {
          throw new TrackerError(
            ERROR_CODES.GAZE_PREDICTION_FAILED,
            "GAZE",
            "Both primary and fallback gaze predictions failed.",
            {
              recoverable: true,
              details: {
                frameSequence: input.frame.metadata.frameSequence,
                timestampMs,
                primarySource: this.primaryEngine.source,
                primaryError: getErrorSummary(
                  primaryError
                ),
                fallbackSource: this.fallbackEngine.source,
                fallbackError: getErrorSummary(
                  fallbackError
                )
              },
              cause: fallbackError
            }
          );
        }
        throw fallbackError;
      }
    }
    if (primaryError !== null) {
      throw primaryError;
    }
    return null;
  }
  /* ========================================================================
   * Observer sample bridge
   * ====================================================================== */
  /**
   * Registers one synchronous runtime-only consumer for completed deep
   * observations. The callback receives copied numeric data only; no webcam
   * frame or landmark object crosses this boundary.
   */
  setObserverSampleListener(listener) {
    this.observerSampleListener = listener;
  }
  /**
   * Temporarily pauses only the non-authoritative deep observer. The primary
   * WebEyeTrack and Ridge fallback remain untouched. An in-flight observer
   * prediction is allowed to finish but its result is discarded. No new observer
   * inference starts while suspended.
   */
  setObserverSuspended(suspended, reason = null) {
    const nextReason = suspended ? reason : null;
    if (this.observerSuspended === suspended && this.observerSuspensionReason === nextReason) {
      return;
    }
    this.invalidateObserverSamples();
    this.observerSuspended = suspended;
    this.observerSuspensionReason = nextReason;
    logger10.info(
      suspended ? "Deep gaze observer suspended; authoritative baseline tracking continues." : "Deep gaze observer resumed.",
      {
        reason: this.observerSuspensionReason,
        observerSource: this.observerEngine?.source ?? null,
        lastInferenceLatencyMs: this.observerLastPrediction?.inferenceLatencyMs ?? null
      }
    );
  }
  /** Discard late results without starting overlapping inference or changing fitted models. */
  invalidateObserverSamples() {
    this.observerGeneration += 1;
    this.observerLastPrediction = null;
    this.observerLastAttemptTimestampMs = null;
  }
  isObserverSuspended() {
    return this.observerSuspended;
  }
  /* ========================================================================
   * Snapshot
   * ====================================================================== */
  /**
   * Starts a calibration-only WebEyeTrack few-shot personalization session.
   * The concrete backend restores the pinned generic BlazeGaze weights first,
   * so recalibration never compounds a prior participant adaptation.
   */
  beginPrimaryPersonalizationSession() {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return false;
    }
    return this.primaryEngine.beginPersonalizationSession();
  }
  /**
   * Copies the vendor features associated with the just-accepted gaze frame
   * into a bounded calibration-only candidate buffer.
   */
  recordPrimaryPersonalizationCandidate(pointIndex, expectedTimestampMs) {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return false;
    }
    return this.primaryEngine.recordLatestPersonalizationCandidate(
      pointIndex,
      expectedTimestampMs
    );
  }
  /**
   * Selects one native support sample from the stable window chosen by the
   * project calibration collector. The target remains project normalized 0..1;
   * the WebEyeTrack bridge converts it to the upstream centered convention.
   */
  stagePrimaryPersonalizationPoint(pointIndex, targetNormalizedPoint, stableWindowStartTimestampMs, stableWindowEndTimestampMs) {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return false;
    }
    return this.primaryEngine.stagePersonalizationPoint(
      pointIndex,
      targetNormalizedPoint,
      stableWindowStartTimestampMs,
      stableWindowEndTimestampMs
    );
  }
  async applyPrimaryPersonalization() {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return {
        applied: false,
        stagedPointCount: 0,
        supportPointCount: 0
      };
    }
    return this.primaryEngine.applyPersonalization();
  }
  getSnapshot() {
    return {
      lifecycle: this.lifecycle,
      targetSampleRateHz: this.options.targetSampleRateHz,
      primary: this.primaryEngine.getSnapshot(),
      fallback: this.fallbackEngine?.getSnapshot() ?? null,
      primaryAvailable: this.primaryAvailable,
      fallbackAvailable: this.fallbackAvailable,
      activeSource: this.activeSource,
      lastAttemptTimestampMs: this.lastAttemptTimestampMs,
      lastPredictionTimestampMs: this.lastPredictionTimestampMs,
      lastProcessedFrameSequence: this.lastProcessedFrameSequence,
      primaryPredictionFailureCount: this.primaryPredictionFailureCount,
      fallbackPredictionUseCount: this.fallbackPredictionUseCount,
      rateLimitedFrameCount: this.rateLimitedFrameCount,
      duplicateFrameCount: this.duplicateFrameCount,
      observer: this.createObserverSnapshot()
    };
  }
  /**
   * Returns the latest transient feature generated by the observer engine.
   *
   * The array is cloned by the provider before it leaves the engine. The
   * predictor never persists it. A later calibration mapper can consume this
   * method without becoming coupled to UniversalDeepEngine itself.
   */
  getLatestObserverFeatureSnapshot() {
    if (this.observerEngine === null || !isGazeFeatureProvider(
      this.observerEngine
    )) {
      return null;
    }
    return this.observerEngine.getLatestFeatureSnapshot();
  }
  /* ========================================================================
   * Disposal
   * ====================================================================== */
  async dispose() {
    if (this.lifecycle === "DISPOSED") {
      return;
    }
    this.lifecycle = "DISPOSED";
    this.invalidateObserverSamples();
    this.observerSampleListener = null;
    const engines = [
      this.primaryEngine
    ];
    if (this.fallbackEngine !== null && this.fallbackEngine !== this.primaryEngine) {
      engines.push(
        this.fallbackEngine
      );
    }
    if (this.observerEngine !== null && this.observerEngine !== this.primaryEngine && this.observerEngine !== this.fallbackEngine) {
      engines.push(
        this.observerEngine
      );
    }
    for (const engine of engines) {
      try {
        await engine.dispose();
      } catch (error) {
        logger10.warn(
          "Gaze engine disposal failed.",
          {
            source: engine.source,
            error
          }
        );
      }
    }
    this.primaryAvailable = false;
    this.fallbackAvailable = false;
    this.observerAvailable = false;
    this.observerPredictionInFlight = false;
    this.observerSuspended = false;
    this.observerSuspensionReason = null;
    this.activeSource = null;
    this.lastAttemptTimestampMs = null;
    this.lastPredictionTimestampMs = null;
    this.lastProcessedFrameSequence = null;
    this.lastProcessedFrameTimestampMs = null;
    this.observerLastAttemptTimestampMs = null;
    this.observerLastPrediction = null;
  }
  /* ========================================================================
   * Internal state helpers
   * ====================================================================== */
  assertReady() {
    if (this.lifecycle === "READY") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "Gaze predictor is not ready for prediction.",
      {
        details: {
          lifecycle: this.lifecycle
        }
      }
    );
  }
  rememberProcessedFrame(input) {
    this.lastProcessedFrameSequence = input.frame.metadata.frameSequence;
    this.lastProcessedFrameTimestampMs = input.frame.metadata.timestampMs;
  }
  rememberPrediction(prediction) {
    this.activeSource = prediction.source;
    this.lastPredictionTimestampMs = prediction.timestampMs;
  }
  maybeStartObserverPrediction(input) {
    if (this.observerEngine === null || !this.observerAvailable || this.observerSuspended) {
      return;
    }
    if (this.observerPredictionInFlight) {
      this.observerInFlightSkippedFrameCount += 1;
      return;
    }
    const timestampMs = input.frame.metadata.timestampMs;
    const adaptiveObserverIntervalMs = Math.max(
      this.observerMinAttemptIntervalMs,
      (this.observerLastPrediction?.inferenceLatencyMs ?? 0) * 1.25
    );
    if (this.observerLastAttemptTimestampMs !== null && timestampMs >= this.observerLastAttemptTimestampMs && timestampMs - this.observerLastAttemptTimestampMs < adaptiveObserverIntervalMs) {
      this.observerRateLimitedFrameCount += 1;
      return;
    }
    this.observerLastAttemptTimestampMs = timestampMs;
    this.observerPredictionInFlight = true;
    this.observerAttemptCount += 1;
    void this.runObserverPrediction(
      input
    );
  }
  async runObserverPrediction(input) {
    const observerEngine = this.observerEngine;
    if (observerEngine === null) {
      this.observerPredictionInFlight = false;
      return;
    }
    const generation = this.observerGeneration;
    const startedAtMs = performance.now();
    try {
      const prediction = await observerEngine.predict(input);
      if (generation !== this.observerGeneration || this.lifecycle !== "READY" || this.observerSuspended) {
        return;
      }
      const inferenceLatencyMs = performance.now() - startedAtMs;
      if (prediction === null) {
        this.observerNullPredictionCount += 1;
        return;
      }
      this.observerSuccessCount += 1;
      const predictionSnapshot = {
        frameSequence: input.frame.metadata.frameSequence,
        timestampMs: prediction.timestampMs,
        source: prediction.source,
        rawPoint: {
          ...prediction.rawPoint
        },
        rawSpace: prediction.rawSpace,
        confidence: prediction.confidence,
        inferenceLatencyMs
      };
      this.observerLastPrediction = predictionSnapshot;
      this.emitObserverRuntimeSample(
        observerEngine,
        input,
        predictionSnapshot
      );
      if (this.observerSuccessCount === 1 || this.observerSuccessCount % 25 === 0) {
        logger10.info(
          "Deep gaze observer prediction received.",
          {
            successCount: this.observerSuccessCount,
            frameSequence: input.frame.metadata.frameSequence,
            source: prediction.source,
            rawSpace: prediction.rawSpace,
            yawRad: prediction.rawPoint.x,
            pitchRad: prediction.rawPoint.y,
            confidence: prediction.confidence,
            inferenceLatencyMs
          }
        );
      }
    } catch (error) {
      this.observerFailureCount += 1;
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "Observer gaze prediction failed.",
        {
          details: {
            source: observerEngine.source,
            frameSequence: input.frame.metadata.frameSequence,
            timestampMs: input.frame.metadata.timestampMs
          }
        }
      );
      if (this.observerFailureCount <= 3 || this.observerFailureCount % 10 === 0) {
        logger10.warn(
          "Deep gaze observer prediction failed; baseline tracking continues.",
          {
            failureCount: this.observerFailureCount,
            error: getErrorSummary(normalized)
          }
        );
      }
    } finally {
      this.observerPredictionInFlight = false;
    }
  }
  emitObserverRuntimeSample(observerEngine, input, prediction) {
    const listener = this.observerSampleListener;
    if (listener === null || !isGazeFeatureProvider(observerEngine)) {
      return;
    }
    const feature = observerEngine.getLatestFeatureSnapshot();
    const faceGeometry = input.faceGeometry.geometry;
    const headPose = input.headPose.headPose;
    const leftEye = input.eyeGeometry.leftEye;
    const rightEye = input.eyeGeometry.rightEye;
    if (feature === null || feature.frameSequence !== prediction.frameSequence || feature.timestampMs !== prediction.timestampMs || faceGeometry === null || headPose === null || leftEye === null || rightEye === null) {
      return;
    }
    const sample = {
      prediction: {
        ...prediction,
        rawPoint: {
          ...prediction.rawPoint
        }
      },
      feature: {
        frameSequence: feature.frameSequence,
        timestampMs: feature.timestampMs,
        values: new Float32Array(
          feature.values
        )
      },
      geometry: {
        headPose: {
          ...headPose
        },
        faceCenterNormalized: {
          ...faceGeometry.centerNormalized
        },
        faceWidthRatio: faceGeometry.widthRatio,
        faceHeightRatio: faceGeometry.heightRatio,
        faceDistanceRatio: input.faceQuality.trackingQuality.faceDistanceRatio,
        leftIrisHorizontalOffsetRatio: leftEye.irisHorizontalOffsetRatio,
        leftIrisVerticalOffsetRatio: leftEye.irisVerticalOffsetRatio,
        rightIrisHorizontalOffsetRatio: rightEye.irisHorizontalOffsetRatio,
        rightIrisVerticalOffsetRatio: rightEye.irisVerticalOffsetRatio
      },
      quality: {
        usableForGaze: input.faceQuality.usableForGaze,
        faceValid: input.faceQuality.trackingQuality.faceValid,
        eyesValid: input.faceQuality.trackingQuality.eyesValid,
        blink: input.faceQuality.trackingQuality.blink || input.blink.blinkInProgress || input.blink.bothEyesClosed,
        qualityScore: input.faceQuality.trackingQuality.qualityScore,
        qualityLevel: input.faceQuality.trackingQuality.qualityLevel
      }
    };
    try {
      listener(sample);
    } catch (error) {
      logger10.warn(
        "Deep observer sample listener failed; baseline and observer inference continue.",
        {
          error: error instanceof Error ? error.message : "Unknown observer listener error"
        }
      );
    }
  }
  createObserverSnapshot() {
    return {
      engine: this.observerEngine?.getSnapshot() ?? null,
      available: this.observerAvailable,
      inFlight: this.observerPredictionInFlight,
      suspended: this.observerSuspended,
      suspensionReason: this.observerSuspensionReason,
      targetSampleRateHz: this.options.observerSampleRateHz,
      lastAttemptTimestampMs: this.observerLastAttemptTimestampMs,
      lastPrediction: this.observerLastPrediction === null ? null : {
        ...this.observerLastPrediction,
        rawPoint: {
          ...this.observerLastPrediction.rawPoint
        }
      },
      attemptCount: this.observerAttemptCount,
      successCount: this.observerSuccessCount,
      nullPredictionCount: this.observerNullPredictionCount,
      failureCount: this.observerFailureCount,
      rateLimitedFrameCount: this.observerRateLimitedFrameCount,
      inFlightSkippedFrameCount: this.observerInFlightSkippedFrameCount
    };
  }
  resetRuntimeCounters() {
    this.primaryAvailable = false;
    this.fallbackAvailable = false;
    this.observerAvailable = false;
    this.observerPredictionInFlight = false;
    this.observerSuspended = false;
    this.observerSuspensionReason = null;
    this.activeSource = null;
    this.lastAttemptTimestampMs = null;
    this.lastPredictionTimestampMs = null;
    this.lastProcessedFrameSequence = null;
    this.lastProcessedFrameTimestampMs = null;
    this.primaryPredictionFailureCount = 0;
    this.fallbackPredictionUseCount = 0;
    this.rateLimitedFrameCount = 0;
    this.duplicateFrameCount = 0;
    this.observerLastAttemptTimestampMs = null;
    this.observerLastPrediction = null;
    this.observerAttemptCount = 0;
    this.observerSuccessCount = 0;
    this.observerNullPredictionCount = 0;
    this.observerFailureCount = 0;
    this.observerRateLimitedFrameCount = 0;
    this.observerInFlightSkippedFrameCount = 0;
  }
};

// src/gaze/deepPersonalMapper.ts
function mean5(values) {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}
function percentile4(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper received an invalid percentile request."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function dot4(first, second) {
  if (first.length !== second.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper vector dimensions do not match."
    );
  }
  let total = 0;
  for (let index = 0; index < first.length; index += 1) {
    total += (first[index] ?? 0) * (second[index] ?? 0);
  }
  return total;
}
function squaredDistance2(first, second) {
  if (first.length !== second.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper vector dimensions do not match."
    );
  }
  let total = 0;
  for (let index = 0; index < first.length; index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    total += difference * difference;
  }
  return total;
}
function normalizeVectorInPlace(vector) {
  const magnitude = Math.sqrt(dot4(vector, vector));
  if (!Number.isFinite(magnitude) || magnitude <= NUMERIC_EPSILON) {
    return false;
  }
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / magnitude;
  }
  return true;
}
function l2NormalizeFeature(values) {
  const normalized = new Float64Array(values.length);
  let squaredMagnitude = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    if (!Number.isFinite(value)) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep feature contains a non-finite value."
      );
    }
    normalized[index] = value;
    squaredMagnitude += value * value;
  }
  const magnitude = Math.sqrt(squaredMagnitude);
  if (magnitude <= NUMERIC_EPSILON) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep feature has zero magnitude."
    );
  }
  for (let index = 0; index < normalized.length; index += 1) {
    normalized[index] = (normalized[index] ?? 0) / magnitude;
  }
  return normalized;
}
function multiplyMatrixVector(matrix, vector) {
  const output = new Float64Array(matrix.length);
  for (let row = 0; row < matrix.length; row += 1) {
    const matrixRow = matrix[row];
    if (matrixRow === void 0) {
      continue;
    }
    output[row] = dot4(matrixRow, vector);
  }
  return output;
}
function orthogonalizeInPlace(vector, basis) {
  for (const basisVector of basis) {
    const coefficient = dot4(vector, basisVector);
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] = (vector[index] ?? 0) - coefficient * (basisVector[index] ?? 0);
    }
  }
}
function solveLinearSystem3(matrix, vector) {
  const dimension = matrix.length;
  if (dimension === 0 || vector.length !== dimension || matrix.some(
    (row) => row.length !== dimension
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper linear system has invalid dimensions."
    );
  }
  const augmented = Array.from(
    { length: dimension },
    (_2, rowIndex) => {
      const row = new Float64Array(
        dimension + 1
      );
      const source = matrix[rowIndex];
      if (source === void 0) {
        return row;
      }
      row.set(source, 0);
      row[dimension] = vector[rowIndex] ?? 0;
      return row;
    }
  );
  for (let pivotColumn = 0; pivotColumn < dimension; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    let pivotMagnitude = Math.abs(
      augmented[pivotRow]?.[pivotColumn] ?? 0
    );
    for (let candidate = pivotColumn + 1; candidate < dimension; candidate += 1) {
      const candidateMagnitude = Math.abs(
        augmented[candidate]?.[pivotColumn] ?? 0
      );
      if (candidateMagnitude > pivotMagnitude) {
        pivotRow = candidate;
        pivotMagnitude = candidateMagnitude;
      }
    }
    if (!Number.isFinite(pivotMagnitude) || pivotMagnitude <= NUMERIC_EPSILON) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep personal mapper kernel matrix is singular."
      );
    }
    if (pivotRow !== pivotColumn) {
      const temporary = augmented[pivotColumn];
      augmented[pivotColumn] = augmented[pivotRow] ?? new Float64Array();
      augmented[pivotRow] = temporary ?? new Float64Array();
    }
    const pivotValues = augmented[pivotColumn];
    if (pivotValues === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep personal mapper lost a pivot row."
      );
    }
    const pivot = pivotValues[pivotColumn] ?? 0;
    for (let column = pivotColumn; column <= dimension; column += 1) {
      pivotValues[column] = (pivotValues[column] ?? 0) / pivot;
    }
    for (let row = 0; row < dimension; row += 1) {
      if (row === pivotColumn) {
        continue;
      }
      const rowValues = augmented[row];
      if (rowValues === void 0) {
        continue;
      }
      const factor = rowValues[pivotColumn] ?? 0;
      for (let column = pivotColumn; column <= dimension; column += 1) {
        rowValues[column] = (rowValues[column] ?? 0) - factor * (pivotValues[column] ?? 0);
      }
    }
  }
  const solution = new Float64Array(dimension);
  for (let row = 0; row < dimension; row += 1) {
    const value = augmented[row]?.[dimension];
    if (value === void 0 || !Number.isFinite(value)) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep personal mapper solved a non-finite coefficient."
      );
    }
    solution[row] = value;
  }
  return solution;
}
function fitProjection(features) {
  if (features.length < 2) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Deep feature projection requires at least two calibration points."
    );
  }
  const rawDimension = features[0]?.length ?? 0;
  if (rawDimension === 0 || features.some(
    (feature) => feature.length !== rawDimension
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep calibration features have inconsistent dimensions."
    );
  }
  const normalized = features.map(l2NormalizeFeature);
  const center = new Float64Array(rawDimension);
  for (const feature of normalized) {
    for (let index = 0; index < rawDimension; index += 1) {
      center[index] = (center[index] ?? 0) + (feature[index] ?? 0);
    }
  }
  for (let index = 0; index < rawDimension; index += 1) {
    center[index] = (center[index] ?? 0) / normalized.length;
  }
  const centered = normalized.map(
    (feature) => {
      const output = new Float64Array(rawDimension);
      for (let index = 0; index < rawDimension; index += 1) {
        output[index] = (feature[index] ?? 0) - (center[index] ?? 0);
      }
      return output;
    }
  );
  const sampleCount = centered.length;
  const gram = Array.from(
    { length: sampleCount },
    () => new Float64Array(sampleCount)
  );
  for (let row = 0; row < sampleCount; row += 1) {
    const rowFeature = centered[row];
    if (rowFeature === void 0) {
      continue;
    }
    for (let column = row; column < sampleCount; column += 1) {
      const columnFeature = centered[column];
      if (columnFeature === void 0) {
        continue;
      }
      const value = dot4(rowFeature, columnFeature);
      const rowValues = gram[row];
      const columnValues = gram[column];
      if (rowValues === void 0 || columnValues === void 0) {
        continue;
      }
      rowValues[column] = value;
      columnValues[row] = value;
    }
  }
  const maximumComponents = Math.min(
    DEEP_PERSONALIZATION.PCA_COMPONENT_COUNT,
    sampleCount - 1,
    rawDimension
  );
  const sampleEigenvectors = [];
  const components = [];
  for (let componentIndex = 0; componentIndex < maximumComponents; componentIndex += 1) {
    let vector = new Float64Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      vector[index] = Math.sin(
        (index + 1) * (componentIndex + 1) * 1.618033988749895
      ) + Math.cos(
        (index + 1) * (componentIndex + 2) * 0.7071067811865476
      );
    }
    orthogonalizeInPlace(
      vector,
      sampleEigenvectors
    );
    if (!normalizeVectorInPlace(vector)) {
      break;
    }
    for (let iteration = 0; iteration < DEEP_PERSONALIZATION.PCA_POWER_ITERATIONS; iteration += 1) {
      const next = multiplyMatrixVector(
        gram,
        vector
      );
      orthogonalizeInPlace(
        next,
        sampleEigenvectors
      );
      if (!normalizeVectorInPlace(next)) {
        break;
      }
      vector = next;
    }
    const gramVector = multiplyMatrixVector(
      gram,
      vector
    );
    const eigenvalue = dot4(vector, gramVector);
    if (!Number.isFinite(eigenvalue) || eigenvalue <= DEEP_PERSONALIZATION.PCA_MIN_EIGENVALUE) {
      break;
    }
    const component = new Float64Array(rawDimension);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const coefficient = vector[sampleIndex] ?? 0;
      const sample = centered[sampleIndex];
      if (sample === void 0) {
        continue;
      }
      for (let featureIndex = 0; featureIndex < rawDimension; featureIndex += 1) {
        component[featureIndex] = (component[featureIndex] ?? 0) + coefficient * (sample[featureIndex] ?? 0);
      }
    }
    const scale = Math.sqrt(eigenvalue);
    for (let index = 0; index < rawDimension; index += 1) {
      component[index] = (component[index] ?? 0) / scale;
    }
    if (!normalizeVectorInPlace(component)) {
      break;
    }
    sampleEigenvectors.push(vector);
    components.push(component);
  }
  if (components.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep feature projection could not resolve a principal component."
    );
  }
  return {
    rawDimension,
    mean: center,
    components
  };
}
function projectFeature(feature, projection) {
  if (feature.length !== projection.rawDimension) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep feature dimension changed after calibration."
    );
  }
  const normalized = l2NormalizeFeature(feature);
  const centered = new Float64Array(
    projection.rawDimension
  );
  for (let index = 0; index < centered.length; index += 1) {
    centered[index] = (normalized[index] ?? 0) - (projection.mean[index] ?? 0);
  }
  const projected = new Float64Array(
    projection.components.length
  );
  for (let index = 0; index < projection.components.length; index += 1) {
    const component = projection.components[index];
    if (component !== void 0) {
      projected[index] = dot4(centered, component);
    }
  }
  return projected;
}
function finiteMean(samples, selector) {
  const values = samples.map(selector);
  if (values.some(
    (value) => !Number.isFinite(value)
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep calibration observation contains a non-finite scalar feature."
    );
  }
  return mean5(values);
}
function summarizePoint(input, baseline, minimumSampleCount = DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT) {
  if (!Number.isInteger(input.pointIndex) || input.pointIndex < 0 || input.samples.length < minimumSampleCount) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Too few synchronized deep observations are available for this calibration point.",
      {
        details: {
          pointIndex: input.pointIndex,
          sampleCount: input.samples.length,
          requiredSampleCount: DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
        }
      }
    );
  }
  const featureDimension = input.samples[0]?.feature.values.length ?? 0;
  if (featureDimension === 0 || input.samples.some(
    (sample) => sample.feature.values.length !== featureDimension
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep calibration samples have inconsistent feature dimensions."
    );
  }
  const meanFeature = new Float32Array(featureDimension);
  for (const sample of input.samples) {
    for (let index = 0; index < featureDimension; index += 1) {
      const value = sample.feature.values[index] ?? 0;
      if (!Number.isFinite(value)) {
        throw new TrackerError(
          ERROR_CODES.CALIBRATION_MODEL_FAILED,
          "CALIBRATION",
          "Deep calibration feature contains a non-finite value."
        );
      }
      meanFeature[index] = (meanFeature[index] ?? 0) + value;
    }
  }
  for (let index = 0; index < featureDimension; index += 1) {
    meanFeature[index] = (meanFeature[index] ?? 0) / input.samples.length;
  }
  const widthScale = finiteMean(
    input.samples,
    (sample) => sample.geometry.faceWidthRatio
  ) / Math.max(
    baseline.width,
    NUMERIC_EPSILON
  );
  const heightScale = finiteMean(
    input.samples,
    (sample) => sample.geometry.faceHeightRatio
  ) / Math.max(
    baseline.height,
    NUMERIC_EPSILON
  );
  return {
    pointIndex: input.pointIndex,
    targetNormalizedPoint: {
      ...input.targetNormalizedPoint
    },
    targetViewportPoint: {
      ...input.targetViewportPoint
    },
    sampleCount: input.samples.length,
    meanConfidence: finiteMean(
      input.samples,
      (sample) => sample.prediction.confidence
    ),
    meanYawRad: finiteMean(
      input.samples,
      (sample) => sample.prediction.rawPoint.x
    ),
    meanPitchRad: finiteMean(
      input.samples,
      (sample) => sample.prediction.rawPoint.y
    ),
    meanFeature,
    meanDeltaHeadYawDeg: finiteMean(
      input.samples,
      (sample) => sample.geometry.headPose.yawDeg
    ) - baseline.headPose.yawDeg,
    meanDeltaHeadPitchDeg: finiteMean(
      input.samples,
      (sample) => sample.geometry.headPose.pitchDeg
    ) - baseline.headPose.pitchDeg,
    meanDeltaHeadRollDeg: finiteMean(
      input.samples,
      (sample) => sample.geometry.headPose.rollDeg
    ) - baseline.headPose.rollDeg,
    meanDeltaFaceCenterX: finiteMean(
      input.samples,
      (sample) => sample.geometry.faceCenterNormalized.x
    ) - baseline.centerX,
    meanDeltaFaceCenterY: finiteMean(
      input.samples,
      (sample) => sample.geometry.faceCenterNormalized.y
    ) - baseline.centerY,
    meanFaceWidthScale: widthScale - 1,
    meanFaceHeightScale: heightScale - 1,
    meanFaceDistanceDelta: finiteMean(
      input.samples,
      (sample) => sample.geometry.faceDistanceRatio
    ) - baseline.distanceRatio,
    meanLeftIrisHorizontalOffsetRatio: finiteMean(
      input.samples,
      (sample) => sample.geometry.leftIrisHorizontalOffsetRatio
    ),
    meanLeftIrisVerticalOffsetRatio: finiteMean(
      input.samples,
      (sample) => sample.geometry.leftIrisVerticalOffsetRatio
    ),
    meanRightIrisHorizontalOffsetRatio: finiteMean(
      input.samples,
      (sample) => sample.geometry.rightIrisHorizontalOffsetRatio
    ),
    meanRightIrisVerticalOffsetRatio: finiteMean(
      input.samples,
      (sample) => sample.geometry.rightIrisVerticalOffsetRatio
    )
  };
}
function createCombinedFeature(summary, projection) {
  const latent = projectFeature(
    summary.meanFeature,
    projection
  );
  const geometry = [
    summary.meanYawRad,
    summary.meanPitchRad,
    summary.meanDeltaHeadYawDeg,
    summary.meanDeltaHeadPitchDeg,
    summary.meanDeltaHeadRollDeg,
    summary.meanDeltaFaceCenterX,
    summary.meanDeltaFaceCenterY,
    summary.meanFaceWidthScale,
    summary.meanFaceHeightScale,
    summary.meanFaceDistanceDelta,
    summary.meanLeftIrisHorizontalOffsetRatio,
    summary.meanLeftIrisVerticalOffsetRatio,
    summary.meanRightIrisHorizontalOffsetRatio,
    summary.meanRightIrisVerticalOffsetRatio
  ];
  const combined = new Float64Array(
    latent.length + geometry.length
  );
  combined.set(latent, 0);
  for (let index = 0; index < geometry.length; index += 1) {
    combined[latent.length + index] = geometry[index] ?? 0;
  }
  return combined;
}
function createLiveSummary(samples, baseline) {
  return summarizePoint(
    {
      pointIndex: 0,
      targetNormalizedPoint: {
        x: 0.5,
        y: 0.5
      },
      targetViewportPoint: {
        x: 1,
        y: 1
      },
      samples
    },
    baseline,
    1
  );
}
function isQualityAcceptedMapperSample(sample) {
  return sample.quality.usableForGaze && sample.quality.faceValid && sample.quality.eyesValid && !sample.quality.blink && Number.isFinite(sample.quality.qualityScore) && sample.quality.qualityScore >= CALIBRATION.MIN_SAMPLE_QUALITY && Number.isFinite(sample.prediction.confidence) && sample.prediction.confidence >= 0 && sample.prediction.confidence <= 1;
}
function calibrationPoseDistance(first, second) {
  const head = Math.hypot(
    (first.geometry.headPose.yawDeg - second.geometry.headPose.yawDeg) / 5,
    (first.geometry.headPose.pitchDeg - second.geometry.headPose.pitchDeg) / 5,
    (first.geometry.headPose.rollDeg - second.geometry.headPose.rollDeg) / 7
  );
  const face = Math.hypot(
    (first.geometry.faceCenterNormalized.x - second.geometry.faceCenterNormalized.x) / 0.02,
    (first.geometry.faceCenterNormalized.y - second.geometry.faceCenterNormalized.y) / 0.02
  );
  const distance5 = Math.abs(
    first.geometry.faceDistanceRatio - second.geometry.faceDistanceRatio
  ) / 0.05;
  return Math.hypot(head, face, distance5);
}
function clusterCalibrationSamplesByPose(samples, clusterCount, minimumClusterSize) {
  if (clusterCount <= 1) {
    return [samples];
  }
  const sorted = [...samples].sort(
    (first, second) => first.prediction.timestampMs - second.prediction.timestampMs
  );
  const centerIndex = Math.floor((sorted.length - 1) / 2);
  const firstSeed = sorted[centerIndex];
  if (firstSeed === void 0) {
    return null;
  }
  const seeds = [firstSeed];
  while (seeds.length < clusterCount) {
    let best = null;
    let bestDistance = -1;
    for (const sample of sorted) {
      if (seeds.includes(sample)) {
        continue;
      }
      const nearestSeedDistance = Math.min(
        ...seeds.map((seed) => calibrationPoseDistance(sample, seed))
      );
      if (nearestSeedDistance > bestDistance) {
        best = sample;
        bestDistance = nearestSeedDistance;
      }
    }
    if (best === null) {
      return null;
    }
    seeds.push(best);
  }
  const clusters = seeds.map(
    () => []
  );
  for (const sample of sorted) {
    let selectedIndex = 0;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index];
      if (seed === void 0) {
        continue;
      }
      const distance5 = calibrationPoseDistance(sample, seed);
      if (distance5 < selectedDistance) {
        selectedDistance = distance5;
        selectedIndex = index;
      }
    }
    clusters[selectedIndex]?.push(sample);
  }
  if (clusters.some((cluster) => cluster.length < minimumClusterSize)) {
    return null;
  }
  return clusters.map(
    (cluster) => [...cluster].sort(
      (first, second) => first.prediction.timestampMs - second.prediction.timestampMs
    )
  );
}
function createCalibrationExemplars(input, baseline) {
  const ordered = [...input.samples].sort(
    (first, second) => first.prediction.timestampMs - second.prediction.timestampMs
  );
  const minSamples = DEEP_PERSONALIZATION.MIN_SAMPLES_PER_EXEMPLAR;
  const maxExemplars = DEEP_PERSONALIZATION.MAX_EXEMPLARS_PER_CALIBRATION_POINT;
  const exemplarCount = Math.max(
    1,
    Math.min(
      maxExemplars,
      Math.floor(ordered.length / minSamples)
    )
  );
  if (exemplarCount === 1) {
    return [summarizePoint(input, baseline)];
  }
  const poseClusters = clusterCalibrationSamplesByPose(
    ordered,
    exemplarCount,
    minSamples
  );
  const sampleGroups = poseClusters ?? Array.from(
    { length: exemplarCount },
    (_2, exemplarIndex) => {
      const start = Math.floor(
        exemplarIndex * ordered.length / exemplarCount
      );
      const end = Math.floor(
        (exemplarIndex + 1) * ordered.length / exemplarCount
      );
      return ordered.slice(start, end);
    }
  );
  const exemplars = sampleGroups.filter((samples) => samples.length >= minSamples).map(
    (samples) => summarizePoint(
      {
        ...input,
        samples
      },
      baseline
    )
  );
  return exemplars.length > 0 ? exemplars : [summarizePoint(input, baseline)];
}
function fitStandardizer(features) {
  const dimension = features[0]?.length ?? 0;
  if (dimension === 0 || features.some(
    (feature) => feature.length !== dimension
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper features have inconsistent dimensions."
    );
  }
  const featureMean = new Float64Array(dimension);
  for (const feature of features) {
    for (let index = 0; index < dimension; index += 1) {
      featureMean[index] = (featureMean[index] ?? 0) + (feature[index] ?? 0);
    }
  }
  for (let index = 0; index < dimension; index += 1) {
    featureMean[index] = (featureMean[index] ?? 0) / features.length;
  }
  const scale = new Float64Array(dimension);
  for (const feature of features) {
    for (let index = 0; index < dimension; index += 1) {
      const difference = (feature[index] ?? 0) - (featureMean[index] ?? 0);
      scale[index] = (scale[index] ?? 0) + difference * difference;
    }
  }
  for (let index = 0; index < dimension; index += 1) {
    const variance = (scale[index] ?? 0) / Math.max(1, features.length - 1);
    const standardDeviation = Math.sqrt(variance);
    scale[index] = standardDeviation >= DEEP_PERSONALIZATION.MIN_FEATURE_STANDARD_DEVIATION ? standardDeviation : 1;
  }
  return {
    mean: featureMean,
    scale
  };
}
function standardizeFeature(feature, standardizer) {
  if (feature.length !== standardizer.mean.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper feature dimension changed after standardization."
    );
  }
  const output = new Float64Array(feature.length);
  for (let index = 0; index < feature.length; index += 1) {
    output[index] = ((feature[index] ?? 0) - (standardizer.mean[index] ?? 0)) / (standardizer.scale[index] ?? 1);
  }
  return output;
}
function getCandidateConfigurations() {
  const candidates = [];
  for (const ridgeLambda of DEEP_PERSONALIZATION.LINEAR_RIDGE_LAMBDAS) {
    candidates.push({
      kind: "LINEAR_RIDGE",
      ridgeLambda,
      rbfGammaScale: null
    });
  }
  for (const ridgeLambda of DEEP_PERSONALIZATION.RBF_RIDGE_LAMBDAS) {
    for (const rbfGammaScale of DEEP_PERSONALIZATION.RBF_GAMMA_SCALES) {
      candidates.push({
        kind: "RBF_KERNEL_RIDGE",
        ridgeLambda,
        rbfGammaScale
      });
    }
  }
  for (const ridgeLambda of DEEP_PERSONALIZATION.RFF_RIDGE_LAMBDAS) {
    for (const rbfGammaScale of DEEP_PERSONALIZATION.RFF_GAMMA_SCALES) {
      candidates.push({
        kind: "RFF_RIDGE",
        ridgeLambda,
        rbfGammaScale
      });
    }
  }
  return candidates;
}
function calculateRbfGamma(features, gammaScale) {
  const distances = [];
  for (let first = 0; first < features.length; first += 1) {
    for (let second = first + 1; second < features.length; second += 1) {
      const firstFeature = features[first];
      const secondFeature = features[second];
      if (firstFeature === void 0 || secondFeature === void 0) {
        continue;
      }
      const distance5 = squaredDistance2(
        firstFeature,
        secondFeature
      );
      if (Number.isFinite(distance5) && distance5 > NUMERIC_EPSILON) {
        distances.push(distance5);
      }
    }
  }
  const medianDistance = distances.length === 0 ? 1 : percentile4(distances, 0.5);
  return gammaScale * 0.5 / Math.max(
    medianDistance,
    NUMERIC_EPSILON
  );
}
function createDeterministicRandomFourierProjection(inputDimension, outputDimension, gamma) {
  if (inputDimension <= 0 || outputDimension <= 0 || !Number.isFinite(gamma) || gamma <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Random Fourier projection received invalid dimensions or gamma."
    );
  }
  let state = 1831565813;
  const nextUniform = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 1) / 4294967297;
  };
  const nextGaussian = () => {
    const first = Math.max(Number.EPSILON, nextUniform());
    const second = nextUniform();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  };
  const standardDeviation = Math.sqrt(2 * gamma);
  const weights = [];
  const phases = new Float64Array(outputDimension);
  for (let row = 0; row < outputDimension; row += 1) {
    const weight = new Float64Array(inputDimension);
    for (let column = 0; column < inputDimension; column += 1) {
      weight[column] = nextGaussian() * standardDeviation;
    }
    weights.push(weight);
    phases[row] = 2 * Math.PI * nextUniform();
  }
  return {
    inputDimension,
    outputDimension,
    gamma,
    weights,
    phases
  };
}
function applyRandomFourierProjection(feature, projection) {
  if (feature.length !== projection.inputDimension) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Random Fourier projection feature dimension mismatch."
    );
  }
  const output = new Float64Array(projection.outputDimension);
  const scale = Math.sqrt(2 / projection.outputDimension);
  for (let index = 0; index < projection.outputDimension; index += 1) {
    const weight = projection.weights[index];
    if (weight === void 0) {
      continue;
    }
    output[index] = scale * Math.cos(
      dot4(feature, weight) + (projection.phases[index] ?? 0)
    );
  }
  return output;
}
function kernelValue(kind, first, second, rbfGamma) {
  if (kind === "LINEAR_RIDGE") {
    return dot4(first, second) / Math.max(1, first.length);
  }
  if (kind === "RFF_RIDGE") {
    return dot4(first, second);
  }
  if (rbfGamma === null) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "RBF deep mapper is missing its gamma parameter."
    );
  }
  return Math.exp(
    -rbfGamma * squaredDistance2(first, second)
  );
}
function fitKernelModel(features, targets, configuration) {
  if (features.length === 0 || features.length !== targets.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper training arrays are inconsistent."
    );
  }
  const standardizer = fitStandardizer(features);
  const standardized = features.map(
    (feature) => standardizeFeature(
      feature,
      standardizer
    )
  );
  const rbfGamma = configuration.kind === "RBF_KERNEL_RIDGE" || configuration.kind === "RFF_RIDGE" ? calculateRbfGamma(
    standardized,
    configuration.rbfGammaScale ?? 1
  ) : null;
  const randomFourierProjection = configuration.kind === "RFF_RIDGE" ? createDeterministicRandomFourierProjection(
    standardized[0]?.length ?? 0,
    DEEP_PERSONALIZATION.RFF_FEATURE_COUNT,
    rbfGamma ?? 1
  ) : null;
  const modelFeatures = randomFourierProjection === null ? standardized : standardized.map(
    (feature) => applyRandomFourierProjection(
      feature,
      randomFourierProjection
    )
  );
  const targetMeanX = mean5(targets.map((target) => target.x));
  const targetMeanY = mean5(targets.map((target) => target.y));
  const centeredX = new Float64Array(
    targets.map(
      (target) => target.x - targetMeanX
    )
  );
  const centeredY = new Float64Array(
    targets.map(
      (target) => target.y - targetMeanY
    )
  );
  const kernelMatrix = Array.from(
    { length: modelFeatures.length },
    () => new Float64Array(modelFeatures.length)
  );
  for (let row = 0; row < modelFeatures.length; row += 1) {
    const rowFeature = modelFeatures[row];
    const rowValues = kernelMatrix[row];
    if (rowFeature === void 0 || rowValues === void 0) {
      continue;
    }
    for (let column = 0; column < modelFeatures.length; column += 1) {
      const columnFeature = modelFeatures[column];
      if (columnFeature === void 0) {
        continue;
      }
      rowValues[column] = kernelValue(
        configuration.kind,
        rowFeature,
        columnFeature,
        rbfGamma
      );
    }
    rowValues[row] = (rowValues[row] ?? 0) + configuration.ridgeLambda;
  }
  return {
    kind: configuration.kind,
    ridgeLambda: configuration.ridgeLambda,
    rbfGamma,
    randomFourierProjection,
    standardizer,
    trainingFeatures: modelFeatures,
    targetMeanX,
    targetMeanY,
    alphaX: solveLinearSystem3(
      kernelMatrix,
      centeredX
    ),
    alphaY: solveLinearSystem3(
      kernelMatrix,
      centeredY
    )
  };
}
function predictKernelModel(model, feature) {
  const standardized = standardizeFeature(
    feature,
    model.standardizer
  );
  const modelFeature = model.randomFourierProjection === null ? standardized : applyRandomFourierProjection(
    standardized,
    model.randomFourierProjection
  );
  let predictedX = model.targetMeanX;
  let predictedY = model.targetMeanY;
  for (let index = 0; index < model.trainingFeatures.length; index += 1) {
    const trainingFeature = model.trainingFeatures[index];
    if (trainingFeature === void 0) {
      continue;
    }
    const value = kernelValue(
      model.kind,
      modelFeature,
      trainingFeature,
      model.rbfGamma
    );
    predictedX += value * (model.alphaX[index] ?? 0);
    predictedY += value * (model.alphaY[index] ?? 0);
  }
  if (!Number.isFinite(predictedX) || !Number.isFinite(predictedY)) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper produced a non-finite screen prediction."
    );
  }
  return {
    x: predictedX,
    y: predictedY
  };
}
function classifyGroupedCvSpatialBucket2(point) {
  const horizontalOuter = point.x <= 0.33 || point.x >= 0.67;
  const verticalOuter = point.y <= 0.33 || point.y >= 0.67;
  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }
  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }
  return "CENTER";
}
function getViewportSize(point) {
  const normalized = point.targetNormalizedPoint;
  const viewport = point.targetViewportPoint;
  const width = Math.abs(normalized.x) > NUMERIC_EPSILON ? viewport.x / normalized.x : Number.NaN;
  const height = Math.abs(normalized.y) > NUMERIC_EPSILON ? viewport.y / normalized.y : Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper could not infer the calibration viewport size."
    );
  }
  return { width, height };
}
function errorPx(prediction, point) {
  const viewport = getViewportSize(point);
  return Math.hypot(
    (prediction.x - point.targetNormalizedPoint.x) * viewport.width,
    (prediction.y - point.targetNormalizedPoint.y) * viewport.height
  );
}
function predictionDispersionPx(predictions, center, point) {
  if (predictions.length <= 1) {
    return 0;
  }
  const viewport = getViewportSize(point);
  const squaredDistances = predictions.map((prediction) => {
    const dx = (prediction.x - center.x) * viewport.width;
    const dy = (prediction.y - center.y) * viewport.height;
    return dx * dx + dy * dy;
  });
  return Math.sqrt(mean5(squaredDistances));
}
function groupCalibrationExemplars(points) {
  const grouped = /* @__PURE__ */ new Map();
  for (const point of points) {
    const existing = grouped.get(point.pointIndex);
    if (existing === void 0) {
      grouped.set(point.pointIndex, [point]);
    } else {
      existing.push(point);
    }
  }
  return [...grouped.values()].sort(
    (first, second) => (first[0]?.pointIndex ?? 0) - (second[0]?.pointIndex ?? 0)
  );
}
function meanPrediction(predictions) {
  return {
    x: mean5(predictions.map((prediction) => prediction.x)),
    y: mean5(predictions.map((prediction) => prediction.y))
  };
}
function evaluateCandidates(points) {
  const configurations = getCandidateConfigurations();
  const groups = groupCalibrationExemplars(points);
  const errorsByCandidate = configurations.map(
    () => []
  );
  for (const heldOutGroup of groups) {
    const heldOut = heldOutGroup[0];
    if (heldOut === void 0) {
      continue;
    }
    const training = points.filter(
      (point) => !sameCalibrationTarget(
        point.targetNormalizedPoint,
        heldOut.targetNormalizedPoint
      )
    );
    const projection = fitProjection(
      training.map((point) => point.meanFeature)
    );
    const preparedTraining = training.map(
      (summary) => ({
        summary,
        combined: createCombinedFeature(summary, projection)
      })
    );
    const heldOutCombined = heldOutGroup.map(
      (summary) => createCombinedFeature(summary, projection)
    );
    for (let candidateIndex = 0; candidateIndex < configurations.length; candidateIndex += 1) {
      const configuration = configurations[candidateIndex];
      const candidateErrors = errorsByCandidate[candidateIndex];
      if (configuration === void 0 || candidateErrors === void 0) {
        continue;
      }
      const model = fitKernelModel(
        preparedTraining.map((item) => item.combined),
        preparedTraining.map(
          (item) => item.summary.targetNormalizedPoint
        ),
        configuration
      );
      const predictions = heldOutCombined.map(
        (combined) => predictKernelModel(model, combined)
      );
      const prediction = meanPrediction(predictions);
      candidateErrors.push({
        errorPx: errorPx(prediction, heldOut),
        bucket: classifyGroupedCvSpatialBucket2(
          heldOut.targetNormalizedPoint
        ),
        withinPointPrecisionPx: predictionDispersionPx(
          predictions,
          prediction,
          heldOut
        )
      });
    }
  }
  return configurations.map((configuration, index) => {
    const entries = errorsByCandidate[index] ?? [];
    const errors = entries.map((entry) => entry.errorPx);
    const bucketMean = (bucket) => {
      const values = entries.filter((entry) => entry.bucket === bucket).map((entry) => entry.errorPx);
      return values.length === 0 ? mean5(errors) : mean5(values);
    };
    const meanErrorPx = mean5(errors);
    const p95ErrorPx = percentile4(errors, 0.95);
    const rmsePx = Math.sqrt(
      mean5(errors.map((error) => error * error))
    );
    const centerMean = bucketMean("CENTER");
    const edgeMean = bucketMean("EDGE");
    const cornerMean = bucketMean("CORNER");
    const meanWithinPointPrecisionPx = mean5(
      entries.map((entry) => entry.withinPointPrecisionPx)
    );
    const selectionScore = meanErrorPx + 0.3 * p95ErrorPx + 0.15 * rmsePx + 0.1 * edgeMean + 0.15 * cornerMean + 0.1 * meanWithinPointPrecisionPx;
    return {
      kind: configuration.kind,
      ridgeLambda: configuration.ridgeLambda,
      rbfGammaScale: configuration.rbfGammaScale,
      evaluatedPointCount: errors.length,
      meanErrorPx,
      p95ErrorPx,
      rmsePx,
      centerMeanErrorPx: centerMean,
      edgeMeanErrorPx: edgeMean,
      cornerMeanErrorPx: cornerMean,
      meanWithinPointPrecisionPx,
      selectionScore
    };
  });
}
function evaluateConfigurationPointwise(points, configuration) {
  const results = [];
  const groups = groupCalibrationExemplars(points);
  for (const heldOutGroup of groups) {
    const heldOut = heldOutGroup[0];
    if (heldOut === void 0) {
      continue;
    }
    const training = points.filter(
      (point) => !sameCalibrationTarget(
        point.targetNormalizedPoint,
        heldOut.targetNormalizedPoint
      )
    );
    const projection = fitProjection(
      training.map((point) => point.meanFeature)
    );
    const preparedTraining = training.map(
      (summary) => ({
        summary,
        combined: createCombinedFeature(summary, projection)
      })
    );
    const model = fitKernelModel(
      preparedTraining.map((item) => item.combined),
      preparedTraining.map(
        (item) => item.summary.targetNormalizedPoint
      ),
      configuration
    );
    const predictedNormalizedPoint = meanPrediction(
      heldOutGroup.map(
        (summary) => predictKernelModel(
          model,
          createCombinedFeature(summary, projection)
        )
      )
    );
    const viewport = getViewportSize(heldOut);
    const predictedViewportPoint = {
      x: predictedNormalizedPoint.x * viewport.width,
      y: predictedNormalizedPoint.y * viewport.height
    };
    results.push({
      pointIndex: heldOut.pointIndex,
      targetNormalizedPoint: { ...heldOut.targetNormalizedPoint },
      targetViewportPoint: { ...heldOut.targetViewportPoint },
      predictedNormalizedPoint,
      predictedViewportPoint,
      errorPx: errorPx(predictedNormalizedPoint, heldOut),
      spatialBucket: classifyGroupedCvSpatialBucket2(
        heldOut.targetNormalizedPoint
      )
    });
  }
  return results;
}
function selectCandidate(candidates) {
  const candidateScore = (candidate) => {
    return candidate.selectionScore ?? candidate.meanErrorPx + 0.3 * candidate.p95ErrorPx + 0.15 * candidate.rmsePx;
  };
  const sorted = [...candidates].sort(
    (first, second) => {
      const scoreDelta = candidateScore(first) - candidateScore(second);
      if (Math.abs(scoreDelta) > NUMERIC_EPSILON) {
        return scoreDelta;
      }
      if (first.p95ErrorPx !== second.p95ErrorPx) {
        return first.p95ErrorPx - second.p95ErrorPx;
      }
      if (first.kind !== second.kind) {
        const rank = (kind) => {
          switch (kind) {
            case "LINEAR_RIDGE":
              return 0;
            case "RFF_RIDGE":
              return 1;
            case "RBF_KERNEL_RIDGE":
              return 2;
          }
        };
        return rank(first.kind) - rank(second.kind);
      }
      return first.ridgeLambda - second.ridgeLambda;
    }
  );
  const selected = sorted[0];
  if (selected === void 0 || !Number.isFinite(
    selected.meanErrorPx
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Grouped cross-validation could not select a deep personal mapper."
    );
  }
  return selected;
}
var DeepPersonalMapper = class _DeepPersonalMapper {
  calibrationId = null;
  expectedPointCount = 0;
  points = /* @__PURE__ */ new Map();
  fitted = null;
  start(calibrationId, expectedPointCount) {
    if (calibrationId.trim().length === 0 || !Number.isInteger(expectedPointCount) || expectedPointCount <= 0) {
      throw new RangeError(
        "DeepPersonalMapper.start() received invalid calibration metadata."
      );
    }
    this.calibrationId = calibrationId;
    this.expectedPointCount = expectedPointCount;
    this.points.clear();
    this.fitted = null;
  }
  /** Preserve the installed mapper while a detached candidate is re-fitted. */
  forkForQuickRecalibration() {
    if (this.calibrationId === null) {
      throw new RangeError("Cannot fork an uninitialized deep personal mapper.");
    }
    const candidate = new _DeepPersonalMapper();
    candidate.calibrationId = this.calibrationId;
    candidate.expectedPointCount = this.expectedPointCount;
    for (const [index, summaries] of this.points) {
      candidate.points.set(index, [...summaries]);
    }
    candidate.fitted = this.fitted;
    return candidate;
  }
  extendExpectedPointCount(nextExpectedPointCount) {
    if (this.calibrationId === null || !Number.isInteger(nextExpectedPointCount) || nextExpectedPointCount <= this.expectedPointCount) {
      throw new RangeError(
        "DeepPersonalMapper.extendExpectedPointCount() received invalid calibration metadata."
      );
    }
    this.expectedPointCount = nextExpectedPointCount;
    this.fitted = null;
  }
  addCalibrationPoint(input, baseline) {
    if (this.calibrationId === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Deep calibration point cannot be added before the mapper session starts."
      );
    }
    const qualityAcceptedSamples = input.samples.filter(isQualityAcceptedMapperSample);
    if (qualityAcceptedSamples.length < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few quality-accepted synchronized deep observations are available for this calibration point.",
        {
          details: {
            pointIndex: input.pointIndex,
            rawSampleCount: input.samples.length,
            acceptedSampleCount: qualityAcceptedSamples.length,
            requiredSampleCount: DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
          }
        }
      );
    }
    const acceptedInput = {
      ...input,
      samples: qualityAcceptedSamples
    };
    const exemplars = createCalibrationExemplars(acceptedInput, baseline);
    this.points.set(
      input.pointIndex,
      exemplars
    );
    this.fitted = null;
    return summarizePoint(acceptedInput, baseline);
  }
  fit() {
    const pointGroups = [...this.points.entries()].sort(
      ([firstIndex], [secondIndex]) => firstIndex - secondIndex
    );
    const points = pointGroups.flatMap(
      ([, exemplars]) => exemplars
    );
    if (pointGroups.length < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few calibration targets contain synchronized deep observations to fit the personal screen mapper.",
        {
          details: {
            pointCount: pointGroups.length,
            requiredPointCount: DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT,
            expectedPointCount: this.expectedPointCount
          }
        }
      );
    }
    const candidates = evaluateCandidates(points);
    const selected = selectCandidate(candidates);
    const selectedPointResults = evaluateConfigurationPointwise(
      points,
      {
        kind: selected.kind,
        ridgeLambda: selected.ridgeLambda,
        rbfGammaScale: selected.rbfGammaScale
      }
    );
    const projection = fitProjection(
      points.map(
        (point) => point.meanFeature
      )
    );
    const combined = points.map(
      (point) => createCombinedFeature(
        point,
        projection
      )
    );
    const kernel = fitKernelModel(
      combined,
      points.map(
        (point) => point.targetNormalizedPoint
      ),
      {
        kind: selected.kind,
        ridgeLambda: selected.ridgeLambda,
        rbfGammaScale: selected.rbfGammaScale
      }
    );
    const fitResult = {
      modelReady: true,
      calibrationPointCount: pointGroups.length,
      projectedFeatureDimension: projection.components.length,
      combinedFeatureDimension: combined[0]?.length ?? 0,
      selectedCandidate: selected,
      candidates,
      selectedPointResults,
      calibrationMeanConfidence: mean5(
        points.map(
          (point) => point.meanConfidence
        )
      )
    };
    this.fitted = {
      projection,
      kernel,
      fitResult
    };
    return fitResult;
  }
  predictSamples(samples, baseline) {
    const fitted = this.fitted;
    if (fitted === null || samples.length < DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MIN_SAMPLE_COUNT) {
      return null;
    }
    const summary = createLiveSummary(samples, baseline);
    const combined = createCombinedFeature(
      summary,
      fitted.projection
    );
    return predictKernelModel(
      fitted.kernel,
      combined
    );
  }
  /**
   * Single-sample inference remains available for independent validation,
   * where each accepted observation must be predicted separately before the
   * validator performs target-free robust aggregation. The live tracking path
   * intentionally uses `predictSamples()` through RuntimeDeepFeatureAggregator.
   */
  predict(sample, baseline) {
    const fitted = this.fitted;
    if (fitted === null || !isQualityAcceptedMapperSample(sample)) {
      return null;
    }
    const summary = createLiveSummary([sample], baseline);
    const combined = createCombinedFeature(
      summary,
      fitted.projection
    );
    return predictKernelModel(
      fitted.kernel,
      combined
    );
  }
  getFitResult() {
    return this.fitted?.fitResult ?? null;
  }
  getSnapshot() {
    return {
      calibrationId: this.calibrationId,
      expectedPointCount: this.expectedPointCount,
      collectedPointCount: this.points.size,
      modelReady: this.fitted !== null,
      selectedKind: this.fitted?.fitResult.selectedCandidate.kind ?? null,
      projectedFeatureDimension: this.fitted?.fitResult.projectedFeatureDimension ?? 0,
      combinedFeatureDimension: this.fitted?.fitResult.combinedFeatureDimension ?? 0
    };
  }
  reset() {
    this.calibrationId = null;
    this.expectedPointCount = 0;
    this.points.clear();
    this.fitted = null;
  }
};

// src/gaze/runtimeDeepFeatureAggregator.ts
function finiteSample(sample) {
  return Number.isFinite(sample.prediction.timestampMs) && Number.isFinite(sample.prediction.rawPoint.x) && Number.isFinite(sample.prediction.rawPoint.y) && Number.isFinite(sample.geometry.headPose.yawDeg) && Number.isFinite(sample.geometry.headPose.pitchDeg) && Number.isFinite(sample.geometry.headPose.rollDeg) && Number.isFinite(sample.geometry.faceCenterNormalized.x) && Number.isFinite(sample.geometry.faceCenterNormalized.y) && Number.isFinite(sample.geometry.faceDistanceRatio);
}
function shouldStartNewWindow(previous, current) {
  const gazeAngleDelta = Math.hypot(
    current.prediction.rawPoint.x - previous.prediction.rawPoint.x,
    current.prediction.rawPoint.y - previous.prediction.rawPoint.y
  );
  const headDelta = Math.max(
    Math.abs(
      current.geometry.headPose.yawDeg - previous.geometry.headPose.yawDeg
    ),
    Math.abs(
      current.geometry.headPose.pitchDeg - previous.geometry.headPose.pitchDeg
    ),
    Math.abs(
      current.geometry.headPose.rollDeg - previous.geometry.headPose.rollDeg
    )
  );
  const faceCenterDelta = Math.hypot(
    current.geometry.faceCenterNormalized.x - previous.geometry.faceCenterNormalized.x,
    current.geometry.faceCenterNormalized.y - previous.geometry.faceCenterNormalized.y
  );
  const distanceDelta = Math.abs(
    current.geometry.faceDistanceRatio - previous.geometry.faceDistanceRatio
  );
  return gazeAngleDelta > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_GAZE_ANGLE_DELTA_RAD || headDelta > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_HEAD_DELTA_DEG || faceCenterDelta > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_FACE_CENTER_DELTA || distanceDelta > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_DISTANCE_DELTA;
}
var RuntimeDeepFeatureAggregator = class {
  samples = [];
  lastTimestampMs = null;
  update(sample) {
    if (!finiteSample(sample) || !sample.quality.usableForGaze || !sample.quality.faceValid || !sample.quality.eyesValid || sample.quality.blink || !Number.isFinite(sample.quality.qualityScore) || sample.quality.qualityScore < CALIBRATION.MIN_SAMPLE_QUALITY || !Number.isFinite(sample.prediction.confidence) || sample.prediction.confidence < 0 || sample.prediction.confidence > 1) {
      this.reset();
      return null;
    }
    const timestampMs = sample.prediction.timestampMs;
    if (this.lastTimestampMs !== null && timestampMs <= this.lastTimestampMs) {
      this.reset();
    }
    const previous = this.samples.at(-1);
    if (previous !== void 0 && shouldStartNewWindow(previous, sample)) {
      this.samples.length = 0;
    }
    this.lastTimestampMs = timestampMs;
    this.samples.push(sample);
    const oldestAllowed = timestampMs - DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_AGE_MS;
    while (this.samples.length > 0 && (this.samples[0]?.prediction.timestampMs ?? timestampMs) < oldestAllowed) {
      this.samples.shift();
    }
    while (this.samples.length > DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MAX_SAMPLE_COUNT) {
      this.samples.shift();
    }
    if (this.samples.length < DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MIN_SAMPLE_COUNT) {
      return null;
    }
    return [...this.samples];
  }
  reset() {
    this.samples.length = 0;
    this.lastTimestampMs = null;
  }
};

// src/gaze/runtimeDeepSourceAlignment.ts
function meanSynchronizedSourceBaseline(deepFrames, baselineHistory) {
  if (deepFrames.length === 0) return null;
  let totalX = 0;
  let totalY = 0;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  const observedSequences = /* @__PURE__ */ new Set();
  for (const frame of deepFrames) {
    const { frameSequence, timestampMs } = frame.prediction;
    if (!Number.isSafeInteger(frameSequence) || frameSequence < 0 || !Number.isFinite(timestampMs) || timestampMs <= previousTimestamp || observedSequences.has(frameSequence)) return null;
    const baseline = baselineHistory.get(frameSequence);
    if (baseline === void 0 || baseline.timestampMs !== timestampMs || !Number.isFinite(baseline.normalizedPoint.x) || !Number.isFinite(baseline.normalizedPoint.y)) return null;
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

// src/gaze/runtimeGazePrecisionEstimator.ts
function finitePoint(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function finiteViewport(viewport) {
  return viewport !== null && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;
}
var RuntimeGazePrecisionEstimator = class {
  samples = [];
  config;
  constructor(config) {
    if (!Number.isFinite(config.windowMs) || config.windowMs <= 0 || !Number.isInteger(config.minSamples) || config.minSamples < 2 || !Number.isFinite(config.maxFixationSpeedPxPerSecond) || config.maxFixationSpeedPxPerSecond <= 0) {
      throw new RangeError("Invalid runtime gaze precision estimator config.");
    }
    this.config = { ...config };
  }
  update(timestampMs, normalizedPoint, viewport) {
    if (!Number.isFinite(timestampMs) || !finitePoint(normalizedPoint) || !finiteViewport(viewport)) {
      this.reset();
      return null;
    }
    const pointPx = {
      x: normalizedPoint.x * viewport.width,
      y: normalizedPoint.y * viewport.height
    };
    const previous = this.samples.at(-1);
    if (previous !== void 0) {
      const dtMs = timestampMs - previous.timestampMs;
      if (dtMs <= 0) {
        this.reset();
      } else {
        const speed = Math.hypot(
          pointPx.x - previous.pointPx.x,
          pointPx.y - previous.pointPx.y
        ) / (dtMs / 1e3);
        if (speed > this.config.maxFixationSpeedPxPerSecond) {
          this.samples.length = 0;
        }
      }
    }
    this.samples.push({ timestampMs, pointPx });
    const oldestAllowed = timestampMs - this.config.windowMs;
    while (this.samples.length > 0 && (this.samples[0]?.timestampMs ?? timestampMs) < oldestAllowed) {
      this.samples.shift();
    }
    if (this.samples.length < this.config.minSamples) {
      return null;
    }
    let meanX = 0;
    let meanY = 0;
    for (const sample of this.samples) {
      meanX += sample.pointPx.x;
      meanY += sample.pointPx.y;
    }
    meanX /= this.samples.length;
    meanY /= this.samples.length;
    let squared = 0;
    for (const sample of this.samples) {
      const dx = sample.pointPx.x - meanX;
      const dy = sample.pointPx.y - meanY;
      squared += dx * dx + dy * dy;
    }
    return Math.sqrt(squared / this.samples.length);
  }
  reset() {
    this.samples.length = 0;
  }
};

// src/gaze/runtimeGazeDriftMonitor.ts
function severityRank(severity) {
  switch (severity) {
    case "NONE":
      return 0;
    case "LOW":
      return 1;
    case "MEDIUM":
      return 2;
    case "HIGH":
      return 3;
  }
}
function maximumSeverity(first, second) {
  return severityRank(first) >= severityRank(second) ? first : second;
}
function thresholdSeverity(value, low, medium, high) {
  if (value >= high) return "HIGH";
  if (value >= medium) return "MEDIUM";
  if (value >= low) return "LOW";
  return "NONE";
}
function median5(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === void 0) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === void 0 ? upper : (lower + upper) / 2;
}
var RuntimeGazeDriftMonitor = class {
  highStartedAtMs = null;
  mediumStartedAtMs = null;
  precisionHighStartedAtMs = null;
  precisionMediumStartedAtMs = null;
  monitoringStartedAtMs = null;
  precisionReferenceSamples = [];
  // Store dispersion in viewport-width units so CSS zoom/resizing cannot
  // appear to improve or degrade the participant's precision by itself.
  precisionReferenceWidthRatio = null;
  lastObservationTimestampMs = null;
  update(timestampMs, drift, viewport, gazeVariancePx, qualityScore) {
    if (drift === null || viewport === null || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(timestampMs) || timestampMs < 0 || !Object.values(drift).every(Number.isFinite)) {
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
    const qualityUsable = Number.isFinite(qualityScore) && qualityScore >= RUNTIME_MAINTENANCE.AUTO_QUICK_RECALIBRATION_MIN_QUALITY;
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
    let rawPoseSeverity = "NONE";
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
    const highDurationMs = this.highStartedAtMs === null ? 0 : timestampMs - this.highStartedAtMs;
    const mediumDurationMs = this.mediumStartedAtMs === null ? 0 : timestampMs - this.mediumStartedAtMs;
    const poseSeverity = rawPoseSeverity === "HIGH" && highDurationMs < DRIFT_THRESHOLDS.HIGH_PERSIST_MS ? "MEDIUM" : rawPoseSeverity;
    const poseRecalibrationRecommended = highDurationMs >= DRIFT_THRESHOLDS.QUICK_RECALIBRATION_HIGH_PERSIST_MS || rawPoseSeverity === "MEDIUM" && mediumDurationMs >= DRIFT_THRESHOLDS.QUICK_RECALIBRATION_MEDIUM_PERSIST_MS;
    const finitePrecision = gazeVariancePx !== null && Number.isFinite(gazeVariancePx) && gazeVariancePx > 0 ? gazeVariancePx : null;
    this.updatePrecisionReference(
      monitoringElapsedMs,
      finitePrecision === null ? null : finitePrecision / viewport.width,
      qualityScore
    );
    const precisionReferencePx = this.precisionReferenceWidthRatio === null ? null : this.precisionReferenceWidthRatio * viewport.width;
    const precisionRatio = finitePrecision !== null && precisionReferencePx !== null && precisionReferencePx > 0 ? finitePrecision / precisionReferencePx : null;
    let rawPrecisionSeverity = "NONE";
    if (qualityUsable && monitoringElapsedMs >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_CAPTURE_MS && finitePrecision !== null) {
      const viewportWidthRatio = finitePrecision / viewport.width;
      if (viewportWidthRatio >= RUNTIME_MAINTENANCE.PRECISION_HIGH_VIEWPORT_WIDTH_RATIO || precisionRatio !== null && precisionRatio >= RUNTIME_MAINTENANCE.PRECISION_HIGH_RATIO) {
        rawPrecisionSeverity = "HIGH";
      } else if (viewportWidthRatio >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_VIEWPORT_WIDTH_RATIO || precisionRatio !== null && precisionRatio >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_RATIO) {
        rawPrecisionSeverity = "MEDIUM";
      } else if (precisionRatio !== null && precisionRatio >= RUNTIME_MAINTENANCE.PRECISION_LOW_RATIO) {
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
    const precisionHighDurationMs = this.precisionHighStartedAtMs === null ? 0 : timestampMs - this.precisionHighStartedAtMs;
    const precisionMediumDurationMs = this.precisionMediumStartedAtMs === null ? 0 : timestampMs - this.precisionMediumStartedAtMs;
    let precisionSeverity = "NONE";
    if (rawPrecisionSeverity === "HIGH" && precisionHighDurationMs >= RUNTIME_MAINTENANCE.PRECISION_HIGH_PERSIST_MS) {
      precisionSeverity = "HIGH";
    } else if ((rawPrecisionSeverity === "HIGH" || rawPrecisionSeverity === "MEDIUM") && precisionMediumDurationMs >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_PERSIST_MS) {
      precisionSeverity = "MEDIUM";
    } else if (rawPrecisionSeverity !== "NONE") {
      precisionSeverity = "LOW";
    }
    const precisionRecalibrationRecommended = precisionHighDurationMs >= RUNTIME_MAINTENANCE.PRECISION_HIGH_PERSIST_MS || precisionMediumDurationMs >= RUNTIME_MAINTENANCE.PRECISION_MEDIUM_PERSIST_MS;
    const periodicMaintenanceDue = monitoringElapsedMs >= RUNTIME_MAINTENANCE.PERIODIC_MAINTENANCE_INTERVAL_MS;
    const automaticActionEligible = monitoringElapsedMs >= RUNTIME_MAINTENANCE.AUTO_QUICK_RECALIBRATION_MIN_MONITORING_MS && Number.isFinite(qualityScore) && qualityScore >= RUNTIME_MAINTENANCE.AUTO_QUICK_RECALIBRATION_MIN_QUALITY;
    const quickRecalibrationRecommended = automaticActionEligible && (poseRecalibrationRecommended || precisionRecalibrationRecommended || periodicMaintenanceDue);
    const maintenanceReason = quickRecalibrationRecommended ? poseRecalibrationRecommended ? "POSE" : precisionRecalibrationRecommended ? "PRECISION" : periodicMaintenanceDue ? "PERIODIC" : null : null;
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
  captureState() {
    return {
      monitoringStartedAtMs: this.monitoringStartedAtMs,
      precisionReferenceSamples: [...this.precisionReferenceSamples],
      precisionReferenceWidthRatio: this.precisionReferenceWidthRatio
    };
  }
  restoreState(state) {
    this.interrupt();
    this.monitoringStartedAtMs = state.monitoringStartedAtMs;
    this.precisionReferenceSamples.length = 0;
    this.precisionReferenceSamples.push(...state.precisionReferenceSamples);
    this.precisionReferenceWidthRatio = state.precisionReferenceWidthRatio;
  }
  /** Break continuous evidence at page changes/gaps, preserving the session baseline. */
  interrupt() {
    this.lastObservationTimestampMs = null;
    this.highStartedAtMs = null;
    this.mediumStartedAtMs = null;
    this.precisionHighStartedAtMs = null;
    this.precisionMediumStartedAtMs = null;
  }
  /** A new calibration/session invalidates both evidence and the reference. */
  reset() {
    this.interrupt();
    this.monitoringStartedAtMs = null;
    this.precisionReferenceSamples.length = 0;
    this.precisionReferenceWidthRatio = null;
  }
  updatePrecisionReference(monitoringElapsedMs, precisionWidthRatio, qualityScore) {
    if (this.precisionReferenceWidthRatio !== null) return;
    if (precisionWidthRatio !== null && Number.isFinite(qualityScore) && qualityScore >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_QUALITY && monitoringElapsedMs <= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MAX_CAPTURE_MS) {
      this.precisionReferenceSamples.push(precisionWidthRatio);
    }
    const targetReached = monitoringElapsedMs >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_CAPTURE_MS && this.precisionReferenceSamples.length >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_TARGET_SAMPLES;
    const captureExpired = monitoringElapsedMs >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MAX_CAPTURE_MS && this.precisionReferenceSamples.length >= RUNTIME_MAINTENANCE.PRECISION_REFERENCE_MIN_SAMPLES;
    if (targetReached || captureExpired) {
      this.precisionReferenceWidthRatio = median5(this.precisionReferenceSamples);
    }
  }
};

// src/gaze/robustGazeAggregation.ts
function assertFinitePoint(point) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(
      "Robust gaze aggregation requires finite points."
    );
  }
}
function assertViewport3(viewport) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new RangeError(
      "Robust gaze aggregation requires a positive finite viewport."
    );
  }
}
function mean6(values) {
  if (values.length === 0) {
    throw new RangeError(
      "mean() requires at least one value."
    );
  }
  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}
function percentile5(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new RangeError(
      "percentile() received invalid input."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new RangeError(
      "percentile() could not resolve a value."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function median6(values) {
  return percentile5(values, 0.5);
}
function meanPoint3(points) {
  return {
    x: mean6(points.map((point) => point.x)),
    y: mean6(points.map((point) => point.y))
  };
}
function medianPoint(points) {
  return {
    x: median6(points.map((point) => point.x)),
    y: median6(points.map((point) => point.y))
  };
}
function normalizedDistance(first, second) {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y
  );
}
function viewportDistance(first, second, viewport) {
  return Math.hypot(
    (first.x - second.x) * viewport.width,
    (first.y - second.y) * viewport.height
  );
}
function meanPrecisionPx(points, center, viewport) {
  return mean6(
    points.map(
      (point) => viewportDistance(point, center, viewport)
    )
  );
}
function dispersionRmsNormalized(points, center) {
  return Math.sqrt(
    mean6(
      points.map((point) => {
        const distance5 = normalizedDistance(point, center);
        return distance5 * distance5;
      })
    )
  );
}
function aggregateRobustGazePoints(points, viewport) {
  assertViewport3(viewport);
  if (points.length === 0) {
    throw new RangeError(
      "Robust gaze aggregation requires at least one point."
    );
  }
  for (const point of points) {
    assertFinitePoint(point);
  }
  const rawCenter = meanPoint3(points);
  const medianCenter = medianPoint(points);
  const radialDistances = points.map(
    (point) => normalizedDistance(point, medianCenter)
  );
  const medianRadiusNormalized = median6(radialDistances);
  const absoluteDeviations = radialDistances.map(
    (radius) => Math.abs(radius - medianRadiusNormalized)
  );
  const madRadiusNormalized = median6(absoluteDeviations);
  const robustSigma = 1.4826 * madRadiusNormalized;
  const allowedRadiusNormalized = medianRadiusNormalized + Math.max(
    CALIBRATION.OUTLIER_MIN_RADIUS_NORMALIZED,
    CALIBRATION.OUTLIER_MAD_SCALE * robustSigma
  );
  const acceptedIndices = [];
  const acceptedPoints = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const radius = radialDistances[index];
    if (point !== void 0 && radius !== void 0 && radius <= allowedRadiusNormalized) {
      acceptedIndices.push(index);
      acceptedPoints.push(point);
    }
  }
  const robustPoints = acceptedPoints.length > 0 ? acceptedPoints : points;
  const robustCenter = meanPoint3(robustPoints);
  return {
    rawSampleCount: points.length,
    acceptedSampleCount: robustPoints.length,
    spatialOutlierRejectedSampleCount: points.length - robustPoints.length,
    rawCenter,
    robustCenter,
    rawPrecisionPx: meanPrecisionPx(points, rawCenter, viewport),
    robustPrecisionPx: meanPrecisionPx(robustPoints, robustCenter, viewport),
    rawDispersionRmsNormalized: dispersionRmsNormalized(points, rawCenter),
    robustDispersionRmsNormalized: dispersionRmsNormalized(robustPoints, robustCenter),
    medianCenter,
    medianRadiusNormalized,
    madRadiusNormalized,
    allowedRadiusNormalized,
    acceptedIndices
  };
}

// src/gaze/deepIndependentValidator.ts
function assertViewport4(viewport) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validation requires a positive finite viewport."
    );
  }
}
function mean7(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validation metric has no values."
    );
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}
function percentile6(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validation percentile request is invalid."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validation percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function median7(values) {
  return percentile6(values, 0.5);
}
function toViewportPoint2(point, viewport) {
  return {
    x: point.x * viewport.width,
    y: point.y * viewport.height
  };
}
function classifySpatialBucket2(point) {
  const horizontalOuter = point.x <= 0.33 || point.x >= 0.67;
  const verticalOuter = point.y <= 0.33 || point.y >= 0.67;
  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }
  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }
  return "CENTER";
}
function meanBucketError2(points, bucket) {
  const values = points.filter(
    (point) => point.spatialBucket === bucket
  ).map((point) => point.errorPx);
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Deep validation pattern does not contain a ${bucket.toLowerCase()} point.`
    );
  }
  return mean7(values);
}
function assertFinitePrediction(point) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep personal mapper produced a non-finite independent-validation prediction."
    );
  }
}
function isQualityAcceptedDeepSample(sample) {
  return sample.quality.usableForGaze && sample.quality.faceValid && sample.quality.eyesValid && !sample.quality.blink && Number.isFinite(sample.quality.qualityScore) && sample.quality.qualityScore >= CALIBRATION.MIN_SAMPLE_QUALITY && Number.isFinite(sample.prediction.confidence) && sample.prediction.confidence >= 0 && sample.prediction.confidence <= 1;
}
function prepareDeepPredictions(samples, mapper, baseline) {
  const qualityAccepted = samples.filter(
    isQualityAcceptedDeepSample
  );
  const predicted = qualityAccepted.map((sample) => ({
    sample,
    point: mapper.predict(sample, baseline)
  })).filter(
    (entry) => entry.point !== null && Number.isFinite(entry.point.x) && Number.isFinite(entry.point.y)
  );
  return {
    rawSampleCount: samples.length,
    qualityRejectedSampleCount: samples.length - predicted.length,
    predicted
  };
}
var DeepIndependentValidator = class {
  calibrationId = null;
  viewport = null;
  expectedPointCount = 0;
  points = /* @__PURE__ */ new Map();
  report = null;
  start(calibrationId, viewport, expectedPointCount) {
    if (calibrationId.trim().length === 0 || !Number.isInteger(expectedPointCount) || expectedPointCount < CALIBRATION.MIN_VALIDATION_POINT_COUNT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Deep independent validation startup metadata is invalid."
      );
    }
    assertViewport4(viewport);
    this.calibrationId = calibrationId;
    this.viewport = { ...viewport };
    this.expectedPointCount = expectedPointCount;
    this.points.clear();
    this.report = null;
  }
  assessDwell(samples, mapper, baseline) {
    if (this.viewport === null) {
      return {
        rawSampleCount: samples.length,
        qualityRejectedSampleCount: samples.length,
        spatialOutlierRejectedSampleCount: 0,
        acceptedSampleCount: 0,
        robustPrecisionPx: null,
        robustDispersionRmsNormalized: null,
        stable: false
      };
    }
    const prepared = prepareDeepPredictions(
      samples,
      mapper,
      baseline
    );
    if (prepared.predicted.length === 0) {
      return {
        rawSampleCount: prepared.rawSampleCount,
        qualityRejectedSampleCount: prepared.qualityRejectedSampleCount,
        spatialOutlierRejectedSampleCount: 0,
        acceptedSampleCount: 0,
        robustPrecisionPx: null,
        robustDispersionRmsNormalized: null,
        stable: false
      };
    }
    const aggregation = aggregateRobustGazePoints(
      prepared.predicted.map((entry) => entry.point),
      this.viewport
    );
    return {
      rawSampleCount: prepared.rawSampleCount,
      qualityRejectedSampleCount: prepared.qualityRejectedSampleCount,
      spatialOutlierRejectedSampleCount: aggregation.spatialOutlierRejectedSampleCount,
      acceptedSampleCount: aggregation.acceptedSampleCount,
      robustPrecisionPx: aggregation.robustPrecisionPx,
      robustDispersionRmsNormalized: aggregation.robustDispersionRmsNormalized,
      stable: aggregation.robustDispersionRmsNormalized <= CALIBRATION.STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED
    };
  }
  addPoint(input, mapper, baseline) {
    if (this.calibrationId === null || this.viewport === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Deep independent validation has not been started."
      );
    }
    if (!Number.isInteger(input.pointIndex) || input.pointIndex < 0 || input.pointIndex >= this.expectedPointCount || input.samples.length < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few synchronized deep observations are available for this independent validation point.",
        {
          details: {
            pointIndex: input.pointIndex,
            sampleCount: input.samples.length,
            requiredSampleCount: DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
          }
        }
      );
    }
    const prepared = prepareDeepPredictions(
      input.samples,
      mapper,
      baseline
    );
    if (prepared.predicted.length < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Deep personal mapper produced too few quality-accepted independent-validation predictions.",
        {
          details: {
            pointIndex: input.pointIndex,
            rawSampleCount: prepared.rawSampleCount,
            qualityRejectedSampleCount: prepared.qualityRejectedSampleCount,
            predictionCount: prepared.predicted.length
          }
        }
      );
    }
    for (const entry of prepared.predicted) {
      assertFinitePrediction(entry.point);
    }
    const aggregation = aggregateRobustGazePoints(
      prepared.predicted.map((entry) => entry.point),
      this.viewport
    );
    if (aggregation.acceptedSampleCount < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few deep predictions remain after target-free spatial outlier rejection.",
        {
          details: {
            pointIndex: input.pointIndex,
            rawSampleCount: prepared.rawSampleCount,
            qualityRejectedSampleCount: prepared.qualityRejectedSampleCount,
            spatialOutlierRejectedSampleCount: aggregation.spatialOutlierRejectedSampleCount,
            acceptedSampleCount: aggregation.acceptedSampleCount
          }
        }
      );
    }
    const acceptedPredicted = aggregation.acceptedIndices.map((index) => prepared.predicted[index]).filter(
      (entry) => entry !== void 0
    );
    const representativeNormalizedPoint = {
      ...aggregation.robustCenter
    };
    const representativeViewportPoint = toViewportPoint2(
      representativeNormalizedPoint,
      this.viewport
    );
    const rawDeepCenterViewportPoint = toViewportPoint2(
      aggregation.rawCenter,
      this.viewport
    );
    const rawDeepErrorPx = Math.hypot(
      rawDeepCenterViewportPoint.x - input.targetViewportPoint.x,
      rawDeepCenterViewportPoint.y - input.targetViewportPoint.y
    );
    const errorXPx = representativeViewportPoint.x - input.targetViewportPoint.x;
    const errorYPx = representativeViewportPoint.y - input.targetViewportPoint.y;
    const errorPx2 = Math.hypot(errorXPx, errorYPx);
    const sampleViewportPoints = acceptedPredicted.map(
      (entry) => toViewportPoint2(entry.point, this.viewport)
    );
    const precisionDistances = sampleViewportPoints.map(
      (point) => Math.hypot(
        point.x - representativeViewportPoint.x,
        point.y - representativeViewportPoint.y
      )
    );
    const result = {
      pointIndex: input.pointIndex,
      targetNormalizedPoint: { ...input.targetNormalizedPoint },
      targetViewportPoint: { ...input.targetViewportPoint },
      sampleCount: aggregation.acceptedSampleCount,
      rawDeepSampleCount: prepared.rawSampleCount,
      qualityRejectedDeepSampleCount: prepared.qualityRejectedSampleCount,
      spatialOutlierRejectedDeepSampleCount: aggregation.spatialOutlierRejectedSampleCount,
      acceptedDeepSampleCount: aggregation.acceptedSampleCount,
      rawDeepCenterNormalizedPoint: { ...aggregation.rawCenter },
      rawDeepCenterViewportPoint,
      robustDeepCenterNormalizedPoint: { ...aggregation.robustCenter },
      robustDeepCenterViewportPoint: { ...representativeViewportPoint },
      rawDeepPrecisionPx: aggregation.rawPrecisionPx,
      robustDeepPrecisionPx: aggregation.robustPrecisionPx,
      robustDispersionRmsNormalized: aggregation.robustDispersionRmsNormalized,
      rawDeepErrorPx,
      meanConfidence: mean7(
        acceptedPredicted.map((entry) => entry.sample.prediction.confidence)
      ),
      meanDeltaHeadYawDeg: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.headPose.yawDeg - baseline.headPose.yawDeg
        )
      ),
      meanDeltaHeadPitchDeg: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.headPose.pitchDeg - baseline.headPose.pitchDeg
        )
      ),
      meanDeltaHeadRollDeg: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.headPose.rollDeg - baseline.headPose.rollDeg
        )
      ),
      meanDeltaFaceCenterX: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceCenterNormalized.x - baseline.centerX
        )
      ),
      meanDeltaFaceCenterY: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceCenterNormalized.y - baseline.centerY
        )
      ),
      meanFaceWidthScaleDelta: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceWidthRatio / Math.max(baseline.width, 1e-6) - 1
        )
      ),
      meanFaceHeightScaleDelta: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceHeightRatio / Math.max(baseline.height, 1e-6) - 1
        )
      ),
      meanFaceDistanceDelta: mean7(
        acceptedPredicted.map(
          (entry) => entry.sample.geometry.faceDistanceRatio - baseline.distanceRatio
        )
      ),
      representativeNormalizedPoint,
      representativeViewportPoint,
      errorXPx,
      errorYPx,
      errorPx: errorPx2,
      meanPrecisionPx: aggregation.robustPrecisionPx,
      p95PrecisionPx: percentile6(precisionDistances, 0.95),
      precisionDistancesPx: precisionDistances,
      spatialBucket: classifySpatialBucket2(input.targetNormalizedPoint)
    };
    this.points.set(input.pointIndex, result);
    this.report = null;
    return result;
  }
  finish() {
    if (this.calibrationId === null || this.viewport === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Deep independent validation has not been started."
      );
    }
    const pointResults = [...this.points.values()].sort(
      (first, second) => first.pointIndex - second.pointIndex
    );
    if (pointResults.length !== this.expectedPointCount) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Deep independent validation does not contain every expected target.",
        {
          details: {
            completedPointCount: pointResults.length,
            expectedPointCount: this.expectedPointCount
          }
        }
      );
    }
    const rawErrors = pointResults.map((point) => point.rawDeepErrorPx);
    const errors = pointResults.map((point) => point.errorPx);
    const precisionDistances = pointResults.flatMap(
      (point) => point.precisionDistancesPx
    );
    const squaredErrors = errors.map((error) => error * error);
    const totalSampleCount = pointResults.reduce(
      (total, point) => total + point.sampleCount,
      0
    );
    const meanErrorPx = mean7(errors);
    const p95ErrorPx = percentile6(errors, 0.95);
    const meanPrecisionPx2 = mean7(precisionDistances);
    const p95PrecisionPx = percentile6(precisionDistances, 0.95);
    const metrics = {
      viewportWidthPx: this.viewport.width,
      viewportHeightPx: this.viewport.height,
      pointCount: pointResults.length,
      totalSampleCount,
      meanSampleCountPerPoint: totalSampleCount / pointResults.length,
      meanConfidence: mean7(
        pointResults.map(
          (point) => point.meanConfidence
        )
      ),
      rawMeanErrorPx: mean7(rawErrors),
      rawP95ErrorPx: percentile6(rawErrors, 0.95),
      meanErrorPx,
      medianErrorPx: median7(errors),
      rmsePx: Math.sqrt(mean7(squaredErrors)),
      p90ErrorPx: percentile6(errors, 0.9),
      p95ErrorPx,
      maxErrorPx: Math.max(...errors),
      horizontalErrorPx: mean7(
        pointResults.map(
          (point) => Math.abs(point.errorXPx)
        )
      ),
      verticalErrorPx: mean7(
        pointResults.map(
          (point) => Math.abs(point.errorYPx)
        )
      ),
      centerErrorPx: meanBucketError2(
        pointResults,
        "CENTER"
      ),
      edgeErrorPx: meanBucketError2(
        pointResults,
        "EDGE"
      ),
      cornerErrorPx: meanBucketError2(
        pointResults,
        "CORNER"
      ),
      meanErrorViewportWidthRatio: meanErrorPx / this.viewport.width,
      p95ErrorViewportWidthRatio: p95ErrorPx / this.viewport.width,
      meanPrecisionPx: meanPrecisionPx2,
      p95PrecisionPx,
      meanPrecisionViewportWidthRatio: meanPrecisionPx2 / this.viewport.width,
      p95PrecisionViewportWidthRatio: p95PrecisionPx / this.viewport.width
    };
    this.report = {
      calibrationId: this.calibrationId,
      expectedPointCount: this.expectedPointCount,
      metrics,
      pointResults
    };
    return this.report;
  }
  getSnapshot() {
    return {
      calibrationId: this.calibrationId,
      expectedPointCount: this.expectedPointCount,
      completedPointCount: this.points.size,
      reportReady: this.report !== null
    };
  }
  reset() {
    this.calibrationId = null;
    this.viewport = null;
    this.expectedPointCount = 0;
    this.points.clear();
    this.report = null;
  }
};

// src/gaze/gazeRegionEstimator.ts
var LOW_BOUNDARY = 1 / 3;
var HIGH_BOUNDARY = 2 / 3;
function clamp014(value) {
  return Math.min(1, Math.max(0, value));
}
function horizontalBand(x2) {
  if (x2 < LOW_BOUNDARY) {
    return "LEFT";
  }
  if (x2 > HIGH_BOUNDARY) {
    return "RIGHT";
  }
  return "CENTER";
}
function verticalBand(y2) {
  if (y2 < LOW_BOUNDARY) {
    return "TOP";
  }
  if (y2 > HIGH_BOUNDARY) {
    return "BOTTOM";
  }
  return "CENTER";
}
function regionFromBands(horizontal, vertical) {
  if (vertical === "TOP") {
    if (horizontal === "LEFT") {
      return "TOP_LEFT";
    }
    if (horizontal === "RIGHT") {
      return "TOP_RIGHT";
    }
    return "TOP";
  }
  if (vertical === "BOTTOM") {
    if (horizontal === "LEFT") {
      return "BOTTOM_LEFT";
    }
    if (horizontal === "RIGHT") {
      return "BOTTOM_RIGHT";
    }
    return "BOTTOM";
  }
  if (horizontal === "LEFT") {
    return "LEFT";
  }
  if (horizontal === "RIGHT") {
    return "RIGHT";
  }
  return "CENTER";
}
function distanceToNearestInternalBoundary(value) {
  return Math.min(
    Math.abs(value - LOW_BOUNDARY),
    Math.abs(value - HIGH_BOUNDARY)
  );
}
function classifyGazeScreenRegion(point) {
  const x2 = clamp014(point.x);
  const y2 = clamp014(point.y);
  return regionFromBands(
    horizontalBand(x2),
    verticalBand(y2)
  );
}
function estimateGazeScreenRegion(point, uncertaintyRadiusNormalized = 0) {
  const x2 = clamp014(point.x);
  const y2 = clamp014(point.y);
  const horizontal = horizontalBand(x2);
  const vertical = verticalBand(y2);
  const boundaryMarginNormalized = Math.min(
    distanceToNearestInternalBoundary(x2),
    distanceToNearestInternalBoundary(y2)
  );
  const safeUncertainty = Number.isFinite(
    uncertaintyRadiusNormalized
  ) ? Math.max(0, uncertaintyRadiusNormalized) : 0;
  return {
    region: regionFromBands(horizontal, vertical),
    horizontalBand: horizontal,
    verticalBand: vertical,
    boundaryMarginNormalized,
    ambiguous: safeUncertainty > 0 && boundaryMarginNormalized <= safeUncertainty
  };
}
function isDiagonalGazeRegion(region) {
  return region === "TOP_LEFT" || region === "TOP_RIGHT" || region === "BOTTOM_LEFT" || region === "BOTTOM_RIGHT";
}
function isCardinalGazeRegion(region) {
  return region === "TOP" || region === "RIGHT" || region === "BOTTOM" || region === "LEFT";
}

// src/gaze/calibrationResidualBiasModel.ts
var DIRECTIONAL_BUCKETS = [
  "TOP_LEFT",
  "TOP",
  "TOP_RIGHT",
  "LEFT",
  "CENTER",
  "RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM",
  "BOTTOM_RIGHT"
];
function clamp4(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function mean8(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}
function median8(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === void 0) {
    return 0;
  }
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[middle - 1];
  return lower === void 0 ? upper : (lower + upper) / 2;
}
function medianAbsoluteDeviation(values, center) {
  return median8(
    values.map((value) => Math.abs(value - center))
  );
}
function percentile7(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias diagnostics received an invalid percentile request."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function inferViewportDimension(targetViewportValue, targetNormalizedValue, predictedViewportValue, predictedNormalizedValue) {
  if (Math.abs(targetNormalizedValue) > NUMERIC_EPSILON) {
    const fromTarget = targetViewportValue / targetNormalizedValue;
    if (Number.isFinite(fromTarget) && fromTarget > 0) {
      return fromTarget;
    }
  }
  if (Math.abs(predictedNormalizedValue) > NUMERIC_EPSILON) {
    const fromPrediction = predictedViewportValue / predictedNormalizedValue;
    if (Number.isFinite(fromPrediction) && fromPrediction > 0) {
      return fromPrediction;
    }
  }
  throw new TrackerError(
    ERROR_CODES.CALIBRATION_MODEL_FAILED,
    "CALIBRATION",
    "Residual-bias model could not infer the calibration viewport size."
  );
}
function toObservation(point) {
  const viewportWidthPx = inferViewportDimension(
    point.targetViewportPoint.x,
    point.targetNormalizedPoint.x,
    point.predictedViewportPoint.x,
    point.predictedNormalizedPoint.x
  );
  const viewportHeightPx = inferViewportDimension(
    point.targetViewportPoint.y,
    point.targetNormalizedPoint.y,
    point.predictedViewportPoint.y,
    point.predictedNormalizedPoint.y
  );
  const residualNormalized = {
    x: point.targetNormalizedPoint.x - point.predictedNormalizedPoint.x,
    y: point.targetNormalizedPoint.y - point.predictedNormalizedPoint.y
  };
  const residualViewportPx = {
    x: point.targetViewportPoint.x - point.predictedViewportPoint.x,
    y: point.targetViewportPoint.y - point.predictedViewportPoint.y
  };
  const rawErrorPx = Math.hypot(
    residualViewportPx.x,
    residualViewportPx.y
  );
  return {
    source: point,
    targetBucket: classifyGazeScreenRegion(point.targetNormalizedPoint),
    residualNormalized,
    residualViewportPx,
    rawErrorPx,
    viewportWidthPx,
    viewportHeightPx
  };
}
function covarianceStatistics(observations) {
  if (observations.length === 0) {
    return {
      varianceXPx2: 0,
      varianceYPx2: 0,
      covarianceXYPx2: 0,
      residualRmsPx: 0
    };
  }
  const meanX = mean8(
    observations.map(
      (item) => item.residualViewportPx.x
    )
  );
  const meanY = mean8(
    observations.map(
      (item) => item.residualViewportPx.y
    )
  );
  const denominator = Math.max(
    1,
    observations.length - 1
  );
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumSquaredMagnitude = 0;
  for (const observation of observations) {
    const centeredX = observation.residualViewportPx.x - meanX;
    const centeredY = observation.residualViewportPx.y - meanY;
    sumX2 += centeredX * centeredX;
    sumY2 += centeredY * centeredY;
    sumXY += centeredX * centeredY;
    sumSquaredMagnitude += observation.residualViewportPx.x * observation.residualViewportPx.x + observation.residualViewportPx.y * observation.residualViewportPx.y;
  }
  return {
    varianceXPx2: sumX2 / denominator,
    varianceYPx2: sumY2 / denominator,
    covarianceXYPx2: sumXY / denominator,
    residualRmsPx: Math.sqrt(
      sumSquaredMagnitude / observations.length
    )
  };
}
function meanResidualNormalized(observations) {
  return {
    x: mean8(
      observations.map(
        (item) => item.residualNormalized.x
      )
    ),
    y: mean8(
      observations.map(
        (item) => item.residualNormalized.y
      )
    )
  };
}
function meanResidualViewportPx(observations) {
  return {
    x: mean8(
      observations.map(
        (item) => item.residualViewportPx.x
      )
    ),
    y: mean8(
      observations.map(
        (item) => item.residualViewportPx.y
      )
    )
  };
}
function buildPrior(bucket, allObservations, pseudoCount) {
  if (allObservations.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Residual-bias model requires calibration observations."
    );
  }
  const globalNormalized = meanResidualNormalized(allObservations);
  const globalViewport = meanResidualViewportPx(allObservations);
  const globalCovariance = covarianceStatistics(allObservations);
  if (bucket === "GLOBAL") {
    return {
      bucket,
      calibrationPointCount: allObservations.length,
      meanResidualNormalized: globalNormalized,
      meanResidualViewportPx: globalViewport,
      ...globalCovariance
    };
  }
  const local = allObservations.filter(
    (item) => item.targetBucket === bucket
  );
  if (local.length === 0) {
    return {
      bucket,
      calibrationPointCount: 0,
      meanResidualNormalized: globalNormalized,
      meanResidualViewportPx: globalViewport,
      ...globalCovariance
    };
  }
  const localNormalized = meanResidualNormalized(local);
  const localViewport = meanResidualViewportPx(local);
  const localCovariance = covarianceStatistics(local);
  const localWeight = local.length / (local.length + pseudoCount);
  const globalWeight = 1 - localWeight;
  return {
    bucket,
    calibrationPointCount: local.length,
    meanResidualNormalized: {
      x: localWeight * localNormalized.x + globalWeight * globalNormalized.x,
      y: localWeight * localNormalized.y + globalWeight * globalNormalized.y
    },
    meanResidualViewportPx: {
      x: localWeight * localViewport.x + globalWeight * globalViewport.x,
      y: localWeight * localViewport.y + globalWeight * globalViewport.y
    },
    varianceXPx2: localWeight * localCovariance.varianceXPx2 + globalWeight * globalCovariance.varianceXPx2,
    varianceYPx2: localWeight * localCovariance.varianceYPx2 + globalWeight * globalCovariance.varianceYPx2,
    covarianceXYPx2: localWeight * localCovariance.covarianceXYPx2 + globalWeight * globalCovariance.covarianceXYPx2,
    residualRmsPx: localWeight * localCovariance.residualRmsPx + globalWeight * globalCovariance.residualRmsPx
  };
}
function buildDirectionalPriors(observations) {
  return Object.fromEntries(
    DIRECTIONAL_BUCKETS.map(
      (bucket) => [
        bucket,
        buildPrior(
          bucket,
          observations,
          DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT
        )
      ]
    )
  );
}
function correctedPoint(observation, correctionNormalized) {
  const normalized = {
    x: clamp4(
      observation.source.predictedNormalizedPoint.x + correctionNormalized.x,
      0,
      1
    ),
    y: clamp4(
      observation.source.predictedNormalizedPoint.y + correctionNormalized.y,
      0,
      1
    )
  };
  return {
    normalized,
    viewport: {
      x: normalized.x * observation.viewportWidthPx,
      y: normalized.y * observation.viewportHeightPx
    }
  };
}
function optimalCorrectionStrength(observation, correctionNormalized) {
  const correctionViewportPx = {
    x: correctionNormalized.x * observation.viewportWidthPx,
    y: correctionNormalized.y * observation.viewportHeightPx
  };
  const denominator = correctionViewportPx.x * correctionViewportPx.x + correctionViewportPx.y * correctionViewportPx.y;
  if (denominator <= NUMERIC_EPSILON) {
    return 0;
  }
  const numerator = observation.residualViewportPx.x * correctionViewportPx.x + observation.residualViewportPx.y * correctionViewportPx.y;
  return clamp4(numerator / denominator, 0, 1);
}
function estimateCorrectionStrength(observations) {
  if (observations.length < 2) {
    return {
      diagnostics: {
        pointCount: observations.length,
        medianOptimalStrength: 0,
        fullCorrectionImprovedPointFraction: 0,
        medianFullCorrectionImprovementPx: 0,
        fullCorrectionImprovementMadPx: 0,
        selectedCorrectionStrength: 0
      }
    };
  }
  const optimalStrengths = [];
  const fullCorrectionImprovementsPx = [];
  for (const heldOut of observations) {
    const training = observations.filter(
      (item) => item.source.pointIndex !== heldOut.source.pointIndex
    );
    if (training.length === 0) {
      continue;
    }
    const priors = buildDirectionalPriors(training);
    const routingBucket = classifyGazeScreenRegion(
      heldOut.source.predictedNormalizedPoint
    );
    const correctionNormalized = priors[routingBucket].meanResidualNormalized;
    const fullStrength = correctedPoint(
      heldOut,
      correctionNormalized
    );
    const fullStrengthErrorPx = Math.hypot(
      fullStrength.viewport.x - heldOut.source.targetViewportPoint.x,
      fullStrength.viewport.y - heldOut.source.targetViewportPoint.y
    );
    optimalStrengths.push(
      optimalCorrectionStrength(
        heldOut,
        correctionNormalized
      )
    );
    fullCorrectionImprovementsPx.push(
      heldOut.rawErrorPx - fullStrengthErrorPx
    );
  }
  const medianOptimalStrength = median8(optimalStrengths);
  const medianFullCorrectionImprovementPx = median8(
    fullCorrectionImprovementsPx
  );
  const fullCorrectionImprovementMadPx = medianAbsoluteDeviation(
    fullCorrectionImprovementsPx,
    medianFullCorrectionImprovementPx
  );
  const fullCorrectionImprovedPointFraction = mean8(
    fullCorrectionImprovementsPx.map(
      (improvement) => improvement > 0 ? 1 : 0
    )
  );
  const positiveMedianImprovementPx = Math.max(
    0,
    medianFullCorrectionImprovementPx
  );
  const improvementConsistency = positiveMedianImprovementPx <= NUMERIC_EPSILON ? 0 : fullCorrectionImprovedPointFraction * positiveMedianImprovementPx / (positiveMedianImprovementPx + fullCorrectionImprovementMadPx + NUMERIC_EPSILON);
  const selectedCorrectionStrength = clamp4(
    medianOptimalStrength * improvementConsistency,
    0,
    1
  );
  return {
    diagnostics: {
      pointCount: optimalStrengths.length,
      medianOptimalStrength,
      fullCorrectionImprovedPointFraction,
      medianFullCorrectionImprovementPx,
      fullCorrectionImprovementMadPx,
      selectedCorrectionStrength
    }
  };
}
function fitEngine(sourcePoints) {
  if (sourcePoints.length < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Residual-bias model requires enough grouped calibration points.",
      {
        details: {
          pointCount: sourcePoints.length,
          requiredPointCount: DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT
        }
      }
    );
  }
  const observations = sourcePoints.map(toObservation);
  const cvPointResults = [];
  for (const heldOut of observations) {
    const training = observations.filter(
      (item) => item.source.pointIndex !== heldOut.source.pointIndex
    );
    if (training.length === 0) {
      continue;
    }
    const directionalPriors = buildDirectionalPriors(training);
    const strengthEstimate = estimateCorrectionStrength(training);
    const correctionStrength2 = strengthEstimate.diagnostics.selectedCorrectionStrength;
    const routingBucket = classifyGazeScreenRegion(
      heldOut.source.predictedNormalizedPoint
    );
    const prior = directionalPriors[routingBucket];
    const fullStrengthCorrectionNormalized = {
      ...prior.meanResidualNormalized
    };
    const fullStrengthCorrected = correctedPoint(
      heldOut,
      fullStrengthCorrectionNormalized
    );
    const fullStrengthCorrectedErrorPx = Math.hypot(
      fullStrengthCorrected.viewport.x - heldOut.source.targetViewportPoint.x,
      fullStrengthCorrected.viewport.y - heldOut.source.targetViewportPoint.y
    );
    const correctionNormalized = {
      x: correctionStrength2 * fullStrengthCorrectionNormalized.x,
      y: correctionStrength2 * fullStrengthCorrectionNormalized.y
    };
    const corrected = correctedPoint(
      heldOut,
      correctionNormalized
    );
    const correctedErrorPx = Math.hypot(
      corrected.viewport.x - heldOut.source.targetViewportPoint.x,
      corrected.viewport.y - heldOut.source.targetViewportPoint.y
    );
    cvPointResults.push({
      pointIndex: heldOut.source.pointIndex,
      routingBucket,
      rawErrorPx: heldOut.rawErrorPx,
      fullStrengthCorrectedErrorPx,
      correctedErrorPx,
      correctionStrength: correctionStrength2,
      correctionNormalized,
      correctionViewportPx: {
        x: correctionNormalized.x * heldOut.viewportWidthPx,
        y: correctionNormalized.y * heldOut.viewportHeightPx
      },
      correctedNormalizedPoint: corrected.normalized,
      correctedViewportPoint: corrected.viewport,
      improved: correctedErrorPx < heldOut.rawErrorPx
    });
  }
  if (cvPointResults.length !== observations.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias grouped diagnostics are incomplete."
    );
  }
  const rawErrors = cvPointResults.map(
    (item) => item.rawErrorPx
  );
  const fullStrengthCorrectedErrors = cvPointResults.map(
    (item) => item.fullStrengthCorrectedErrorPx
  );
  const correctedErrors = cvPointResults.map(
    (item) => item.correctedErrorPx
  );
  const rawMeanErrorPx = mean8(rawErrors);
  const fullStrengthCorrectedMeanErrorPx = mean8(
    fullStrengthCorrectedErrors
  );
  const correctedMeanErrorPx = mean8(correctedErrors);
  const rawP95ErrorPx = percentile7(rawErrors, 0.95);
  const fullStrengthCorrectedP95ErrorPx = percentile7(
    fullStrengthCorrectedErrors,
    0.95
  );
  const correctedP95ErrorPx = percentile7(
    correctedErrors,
    0.95
  );
  const rawRmsePx = Math.sqrt(
    mean8(rawErrors.map((value) => value * value))
  );
  const fullStrengthCorrectedRmsePx = Math.sqrt(
    mean8(
      fullStrengthCorrectedErrors.map(
        (value) => value * value
      )
    )
  );
  const correctedRmsePx = Math.sqrt(
    mean8(correctedErrors.map((value) => value * value))
  );
  const finalStrengthEstimate = estimateCorrectionStrength(observations);
  const correctionStrength = finalStrengthEstimate.diagnostics.selectedCorrectionStrength;
  const correctionEnabled = correctionStrength > NUMERIC_EPSILON && correctedMeanErrorPx < rawMeanErrorPx && correctedP95ErrorPx <= rawP95ErrorPx;
  const crossValidation = {
    pointCount: cvPointResults.length,
    rawMeanErrorPx,
    fullStrengthCorrectedMeanErrorPx,
    correctedMeanErrorPx,
    rawP95ErrorPx,
    fullStrengthCorrectedP95ErrorPx,
    correctedP95ErrorPx,
    rawRmsePx,
    fullStrengthCorrectedRmsePx,
    correctedRmsePx,
    meanCorrectionStrength: mean8(
      cvPointResults.map((item) => item.correctionStrength)
    ),
    improvedPointFraction: mean8(
      cvPointResults.map((item) => item.improved ? 1 : 0)
    ),
    meanImprovementPx: rawMeanErrorPx - correctedMeanErrorPx,
    p95ImprovementPx: rawP95ErrorPx - correctedP95ErrorPx,
    correctionEnabled,
    pointResults: cvPointResults
  };
  return {
    correctionEnabled,
    correctionStrength,
    strengthDiagnostics: finalStrengthEstimate.diagnostics,
    globalPrior: buildPrior(
      "GLOBAL",
      observations,
      0
    ),
    directionalPriors: buildDirectionalPriors(observations),
    crossValidation
  };
}
function fitCalibrationResidualBiasModel(baselinePoints, deepPoints) {
  if (baselinePoints.length !== deepPoints.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias model requires matched baseline and deep grouped-CV points."
    );
  }
  const baselineIndices = new Set(
    baselinePoints.map((point) => point.pointIndex)
  );
  if (deepPoints.some(
    (point) => !baselineIndices.has(point.pointIndex)
  )) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Residual-bias baseline/deep calibration point indices do not match."
    );
  }
  return {
    baseline: fitEngine(baselinePoints),
    deep: fitEngine(deepPoints)
  };
}
function applyCalibrationResidualBias(point, fit, directionalBucket, directionalPriorReliability) {
  if (!fit.correctionEnabled) {
    return {
      applied: false,
      directionalBucket,
      correctionStrength: 0,
      correctionNormalized: { x: 0, y: 0 },
      correctedNormalizedPoint: { ...point }
    };
  }
  const localPrior = fit.directionalPriors[directionalBucket];
  const globalPrior = fit.globalPrior;
  const reliability = clamp4(
    directionalPriorReliability,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY,
    1
  );
  const blendedCorrectionNormalized = {
    x: reliability * localPrior.meanResidualNormalized.x + (1 - reliability) * globalPrior.meanResidualNormalized.x,
    y: reliability * localPrior.meanResidualNormalized.y + (1 - reliability) * globalPrior.meanResidualNormalized.y
  };
  const correctionStrength = fit.correctionStrength;
  const correctionNormalized = {
    x: correctionStrength * blendedCorrectionNormalized.x,
    y: correctionStrength * blendedCorrectionNormalized.y
  };
  return {
    applied: true,
    directionalBucket,
    correctionStrength,
    correctionNormalized,
    correctedNormalizedPoint: {
      x: clamp4(point.x + correctionNormalized.x, 0, 1),
      y: clamp4(point.y + correctionNormalized.y, 0, 1)
    }
  };
}

// src/gaze/calibrationEngineReliability.ts
var DIRECTIONAL_BUCKETS2 = [
  "TOP_LEFT",
  "TOP",
  "TOP_RIGHT",
  "LEFT",
  "CENTER",
  "RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM",
  "BOTTOM_RIGHT"
];
function clamp5(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function mean9(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability model cannot average an empty set."
    );
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function percentile8(values, probability) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability model cannot compute an empty percentile."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function rmse(values) {
  return Math.sqrt(mean9(values.map((value) => value * value)));
}
function deepWeightFromExpectedErrors(baselineExpectedErrorPx, deepExpectedErrorPx) {
  const baseline = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    baselineExpectedErrorPx
  );
  const deep = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    deepExpectedErrorPx
  );
  const rawWeight = baseline * baseline / (baseline * baseline + deep * deep);
  return clamp5(
    rawWeight,
    DEEP_PERSONALIZATION.HYBRID_MIN_DEEP_WEIGHT,
    DEEP_PERSONALIZATION.HYBRID_MAX_DEEP_WEIGHT
  );
}
function optimalDeepWeight(target, baseline, deep) {
  const dx = deep.x - baseline.x;
  const dy = deep.y - baseline.y;
  const denominator = dx * dx + dy * dy;
  if (denominator <= NUMERIC_EPSILON) {
    return 0.5;
  }
  const tx = target.x - baseline.x;
  const ty = target.y - baseline.y;
  return clamp5(
    (tx * dx + ty * dy) / denominator,
    0,
    1
  );
}
function blendPoint(baseline, deep, deepWeight) {
  const baselineWeight = 1 - deepWeight;
  return {
    x: baselineWeight * baseline.x + deepWeight * deep.x,
    y: baselineWeight * baseline.y + deepWeight * deep.y
  };
}
function pointErrorPx(point, target) {
  return Math.hypot(
    point.x - target.x,
    point.y - target.y
  );
}
function createObservations(baselinePoints, deepPoints) {
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point])
  );
  const observations = baselinePoints.map((baseline) => {
    const deep = deepByIndex.get(baseline.pointIndex);
    if (deep === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Engine reliability model requires matched Baseline and Deep grouped-CV points.",
        { details: { pointIndex: baseline.pointIndex } }
      );
    }
    return {
      pointIndex: baseline.pointIndex,
      targetNormalizedPoint: baseline.targetNormalizedPoint,
      targetViewportPoint: baseline.targetViewportPoint,
      baselineNormalizedPoint: baseline.predictedNormalizedPoint,
      baselineViewportPoint: baseline.predictedViewportPoint,
      baselineErrorPx: baseline.errorPx,
      deepNormalizedPoint: deep.predictedNormalizedPoint,
      deepViewportPoint: deep.predictedViewportPoint,
      deepErrorPx: deep.errorPx,
      targetBucket: classifyGazeScreenRegion(
        baseline.targetNormalizedPoint
      ),
      optimalDeepWeight: optimalDeepWeight(
        baseline.targetViewportPoint,
        baseline.predictedViewportPoint,
        deep.predictedViewportPoint
      )
    };
  });
  if (observations.length < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Engine reliability routing requires the complete grouped calibration set."
    );
  }
  return observations;
}
function buildGlobalPrior(observations) {
  if (observations.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Engine reliability global prior requires calibration observations."
    );
  }
  const optimalWeights = observations.map(
    (point) => point.optimalDeepWeight
  );
  const optimalDeepWeightMean = mean9(optimalWeights);
  const globalEvidenceWeight = observations.length / (observations.length + DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT);
  return {
    bucket: "GLOBAL",
    calibrationPointCount: observations.length,
    deepWinFraction: mean9(
      observations.map(
        (point) => point.deepErrorPx < point.baselineErrorPx ? 1 : 0
      )
    ),
    meanDeepAdvantagePx: mean9(
      observations.map(
        (point) => point.baselineErrorPx - point.deepErrorPx
      )
    ),
    optimalDeepWeightMean,
    deepWeight: globalEvidenceWeight * optimalDeepWeightMean + (1 - globalEvidenceWeight) * 0.5
  };
}
function buildDirectionalPrior(bucket, observations, globalPrior) {
  const local = observations.filter(
    (point) => point.targetBucket === bucket
  );
  if (local.length === 0) {
    return {
      bucket,
      calibrationPointCount: 0,
      deepWinFraction: globalPrior.deepWinFraction,
      meanDeepAdvantagePx: globalPrior.meanDeepAdvantagePx,
      optimalDeepWeightMean: globalPrior.optimalDeepWeightMean,
      deepWeight: globalPrior.deepWeight
    };
  }
  const localWeight = local.length / (local.length + DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT);
  const localOptimalWeight = mean9(
    local.map((point) => point.optimalDeepWeight)
  );
  const localDeepWinFraction = mean9(
    local.map(
      (point) => point.deepErrorPx < point.baselineErrorPx ? 1 : 0
    )
  );
  const localMeanAdvantage = mean9(
    local.map(
      (point) => point.baselineErrorPx - point.deepErrorPx
    )
  );
  return {
    bucket,
    calibrationPointCount: local.length,
    deepWinFraction: localWeight * localDeepWinFraction + (1 - localWeight) * globalPrior.deepWinFraction,
    meanDeepAdvantagePx: localWeight * localMeanAdvantage + (1 - localWeight) * globalPrior.meanDeepAdvantagePx,
    optimalDeepWeightMean: localOptimalWeight,
    deepWeight: localWeight * localOptimalWeight + (1 - localWeight) * globalPrior.deepWeight
  };
}
function buildDirectionalPriors2(observations, globalPrior) {
  return Object.fromEntries(
    DIRECTIONAL_BUCKETS2.map(
      (bucket) => [
        bucket,
        buildDirectionalPrior(
          bucket,
          observations,
          globalPrior
        )
      ]
    )
  );
}
function errorPriorForBucket(observations, bucket, globalBaselineErrorPx, globalDeepErrorPx) {
  const local = observations.filter(
    (point) => point.targetBucket === bucket
  );
  if (local.length === 0) {
    return {
      baselineExpectedErrorPx: globalBaselineErrorPx,
      deepExpectedErrorPx: globalDeepErrorPx
    };
  }
  const localWeight = local.length / (local.length + DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT);
  return {
    baselineExpectedErrorPx: localWeight * mean9(local.map((point) => point.baselineErrorPx)) + (1 - localWeight) * globalBaselineErrorPx,
    deepExpectedErrorPx: localWeight * mean9(local.map((point) => point.deepErrorPx)) + (1 - localWeight) * globalDeepErrorPx
  };
}
function nestedCrossValidation(observations) {
  const pointResults = [];
  for (const heldOut of observations) {
    const training = observations.filter(
      (point) => point.pointIndex !== heldOut.pointIndex
    );
    const globalBaselineErrorPx = mean9(
      training.map((point) => point.baselineErrorPx)
    );
    const globalDeepErrorPx = mean9(
      training.map((point) => point.deepErrorPx)
    );
    const currentGlobalDeepWeight = deepWeightFromExpectedErrors(
      globalBaselineErrorPx,
      globalDeepErrorPx
    );
    const routingPoint = blendPoint(
      heldOut.baselineNormalizedPoint,
      heldOut.deepNormalizedPoint,
      currentGlobalDeepWeight
    );
    const routingBucket = classifyGazeScreenRegion(routingPoint);
    const currentErrorPrior = errorPriorForBucket(
      training,
      routingBucket,
      globalBaselineErrorPx,
      globalDeepErrorPx
    );
    const currentDeepWeight = deepWeightFromExpectedErrors(
      currentErrorPrior.baselineExpectedErrorPx,
      currentErrorPrior.deepExpectedErrorPx
    );
    const reliabilityGlobal = buildGlobalPrior(training);
    const reliabilityDirectional = buildDirectionalPrior(
      routingBucket,
      training,
      reliabilityGlobal
    );
    const reliabilityDeepWeight = reliabilityDirectional.deepWeight;
    const currentHybrid = blendPoint(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      currentDeepWeight
    );
    const reliabilityHybrid = blendPoint(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      reliabilityDeepWeight
    );
    const currentHybridErrorPx = pointErrorPx(
      currentHybrid,
      heldOut.targetViewportPoint
    );
    const reliabilityHybridErrorPx = pointErrorPx(
      reliabilityHybrid,
      heldOut.targetViewportPoint
    );
    pointResults.push({
      pointIndex: heldOut.pointIndex,
      routingBucket,
      currentDeepWeight,
      reliabilityDeepWeight,
      currentHybridErrorPx,
      reliabilityHybridErrorPx,
      improved: reliabilityHybridErrorPx < currentHybridErrorPx
    });
  }
  const currentErrors = pointResults.map(
    (point) => point.currentHybridErrorPx
  );
  const reliabilityErrors = pointResults.map(
    (point) => point.reliabilityHybridErrorPx
  );
  const currentMeanErrorPx = mean9(currentErrors);
  const reliabilityMeanErrorPx = mean9(reliabilityErrors);
  const currentP95ErrorPx = percentile8(currentErrors, 0.95);
  const reliabilityP95ErrorPx = percentile8(reliabilityErrors, 0.95);
  const routingEnabled = reliabilityMeanErrorPx < currentMeanErrorPx && reliabilityP95ErrorPx <= currentP95ErrorPx;
  return {
    pointCount: pointResults.length,
    currentMeanErrorPx,
    reliabilityMeanErrorPx,
    currentP95ErrorPx,
    reliabilityP95ErrorPx,
    currentRmsePx: rmse(currentErrors),
    reliabilityRmsePx: rmse(reliabilityErrors),
    improvedPointFraction: mean9(
      pointResults.map((point) => point.improved ? 1 : 0)
    ),
    meanImprovementPx: currentMeanErrorPx - reliabilityMeanErrorPx,
    p95ImprovementPx: currentP95ErrorPx - reliabilityP95ErrorPx,
    routingEnabled,
    pointResults
  };
}
function fitCalibrationEngineReliabilityModel(baselinePoints, deepPoints) {
  const observations = createObservations(
    baselinePoints,
    deepPoints
  );
  const globalPrior = buildGlobalPrior(observations);
  const directionalPriors = buildDirectionalPriors2(
    observations,
    globalPrior
  );
  const crossValidation = nestedCrossValidation(observations);
  return {
    routingEnabled: crossValidation.routingEnabled,
    globalPrior,
    directionalPriors,
    crossValidation
  };
}
function adjustCalibrationReliabilityDeepWeight(calibrationDeepWeight, baselinePenaltyMultiplier, deepPenaltyMultiplier) {
  const base = clamp5(calibrationDeepWeight, 0, 1);
  if (base <= NUMERIC_EPSILON) {
    return 0;
  }
  if (base >= 1 - NUMERIC_EPSILON) {
    return 1;
  }
  const baselinePenalty = Math.max(
    NUMERIC_EPSILON,
    baselinePenaltyMultiplier
  );
  const deepPenalty = Math.max(
    NUMERIC_EPSILON,
    deepPenaltyMultiplier
  );
  const odds = base / (1 - base);
  const adjustedOdds = odds * (baselinePenalty * baselinePenalty / (deepPenalty * deepPenalty));
  return adjustedOdds / (1 + adjustedOdds);
}

// src/gaze/calibrationCoarseEngineReliability.ts
var SPATIAL_BUCKETS = [
  "CENTER",
  "EDGE",
  "CORNER"
];
function clamp6(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function mean10(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability model cannot average an empty set."
    );
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function median9(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability model cannot compute an empty median."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[middle];
    if (value === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Coarse engine reliability median could not resolve its value."
      );
    }
    return value;
  }
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability median could not resolve its values."
    );
  }
  return (lower + upper) / 2;
}
function medianAbsoluteDeviation2(values, center) {
  return median9(
    values.map((value) => Math.abs(value - center))
  );
}
function percentile9(values, probability) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability model cannot compute an empty percentile."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function rmse2(values) {
  return Math.sqrt(mean10(values.map((value) => value * value)));
}
function deepWeightFromExpectedErrors2(baselineExpectedErrorPx, deepExpectedErrorPx) {
  const baseline = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    baselineExpectedErrorPx
  );
  const deep = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    deepExpectedErrorPx
  );
  const rawWeight = baseline * baseline / (baseline * baseline + deep * deep);
  return clamp6(
    rawWeight,
    DEEP_PERSONALIZATION.HYBRID_MIN_DEEP_WEIGHT,
    DEEP_PERSONALIZATION.HYBRID_MAX_DEEP_WEIGHT
  );
}
function pairedDeepWeight(baselineErrorPx, deepErrorPx) {
  const baseline = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    baselineErrorPx
  );
  const deep = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    deepErrorPx
  );
  const denominator = baseline * baseline + deep * deep;
  if (denominator <= NUMERIC_EPSILON) {
    return 0.5;
  }
  return clamp6(
    baseline * baseline / denominator,
    0,
    1
  );
}
function blendPoint2(baseline, deep, deepWeight) {
  const baselineWeight = 1 - deepWeight;
  return {
    x: baselineWeight * baseline.x + deepWeight * deep.x,
    y: baselineWeight * baseline.y + deepWeight * deep.y
  };
}
function pointErrorPx2(point, target) {
  return Math.hypot(
    point.x - target.x,
    point.y - target.y
  );
}
function coarseBucketFromRegion(region) {
  if (region === "CENTER") {
    return "CENTER";
  }
  if (isDiagonalGazeRegion(region)) {
    return "CORNER";
  }
  if (isCardinalGazeRegion(region)) {
    return "EDGE";
  }
  return "CENTER";
}
function createObservations2(baselinePoints, deepPoints) {
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point])
  );
  const observations = baselinePoints.map((baseline) => {
    const deep = deepByIndex.get(baseline.pointIndex);
    if (deep === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Coarse engine reliability requires matched Baseline and Deep grouped-CV points.",
        { details: { pointIndex: baseline.pointIndex } }
      );
    }
    return {
      pointIndex: baseline.pointIndex,
      targetViewportPoint: baseline.targetViewportPoint,
      baselineNormalizedPoint: baseline.predictedNormalizedPoint,
      baselineViewportPoint: baseline.predictedViewportPoint,
      baselineErrorPx: baseline.errorPx,
      deepNormalizedPoint: deep.predictedNormalizedPoint,
      deepViewportPoint: deep.predictedViewportPoint,
      deepErrorPx: deep.errorPx,
      targetSpatialBucket: baseline.spatialBucket,
      targetDirectionalBucket: classifyGazeScreenRegion(
        baseline.targetNormalizedPoint
      ),
      deepAdvantagePx: baseline.errorPx - deep.errorPx,
      pairedDeepWeight: pairedDeepWeight(
        baseline.errorPx,
        deep.errorPx
      )
    };
  });
  if (observations.length < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Coarse engine reliability routing requires the complete grouped calibration set."
    );
  }
  return observations;
}
function rawPriorStatistics(bucket, observations) {
  if (observations.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Coarse engine reliability prior requires calibration observations."
    );
  }
  const advantages = observations.map(
    (point) => point.deepAdvantagePx
  );
  const medianDeepAdvantagePx = median9(advantages);
  const robustDeepWeightMedian = median9(
    observations.map((point) => point.pairedDeepWeight)
  );
  return {
    bucket,
    calibrationPointCount: observations.length,
    deepWinFraction: mean10(
      observations.map(
        (point) => point.deepErrorPx < point.baselineErrorPx ? 1 : 0
      )
    ),
    medianDeepAdvantagePx,
    deepAdvantageMadPx: medianAbsoluteDeviation2(
      advantages,
      medianDeepAdvantagePx
    ),
    robustDeepWeightMedian,
    deepWeight: robustDeepWeightMedian
  };
}
function buildGlobalPrior2(observations) {
  const raw = rawPriorStatistics("GLOBAL", observations);
  const evidenceWeight = observations.length / (observations.length + DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT);
  return {
    ...raw,
    deepWeight: evidenceWeight * raw.robustDeepWeightMedian + (1 - evidenceWeight) * 0.5
  };
}
function buildBucketPrior(bucket, observations, globalPrior) {
  const local = observations.filter(
    (point) => point.targetSpatialBucket === bucket
  );
  if (local.length === 0) {
    return {
      ...globalPrior,
      bucket,
      calibrationPointCount: 0
    };
  }
  const raw = rawPriorStatistics(bucket, local);
  const localWeight = local.length / (local.length + DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT);
  return {
    ...raw,
    deepWeight: localWeight * raw.robustDeepWeightMedian + (1 - localWeight) * globalPrior.deepWeight
  };
}
function buildBucketPriors(observations, globalPrior) {
  return Object.fromEntries(
    SPATIAL_BUCKETS.map(
      (bucket) => [
        bucket,
        buildBucketPrior(bucket, observations, globalPrior)
      ]
    )
  );
}
function directionalErrorPrior(observations, bucket, globalBaselineErrorPx, globalDeepErrorPx) {
  const local = observations.filter(
    (point) => point.targetDirectionalBucket === bucket
  );
  if (local.length === 0) {
    return {
      baselineExpectedErrorPx: globalBaselineErrorPx,
      deepExpectedErrorPx: globalDeepErrorPx
    };
  }
  const localWeight = local.length / (local.length + DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT);
  return {
    baselineExpectedErrorPx: localWeight * mean10(local.map((point) => point.baselineErrorPx)) + (1 - localWeight) * globalBaselineErrorPx,
    deepExpectedErrorPx: localWeight * mean10(local.map((point) => point.deepErrorPx)) + (1 - localWeight) * globalDeepErrorPx
  };
}
function nestedCrossValidation2(observations) {
  const pointResults = [];
  for (const heldOut of observations) {
    const training = observations.filter(
      (point) => point.pointIndex !== heldOut.pointIndex
    );
    const globalBaselineErrorPx = mean10(
      training.map((point) => point.baselineErrorPx)
    );
    const globalDeepErrorPx = mean10(
      training.map((point) => point.deepErrorPx)
    );
    const currentGlobalDeepWeight = deepWeightFromExpectedErrors2(
      globalBaselineErrorPx,
      globalDeepErrorPx
    );
    const routingPoint = blendPoint2(
      heldOut.baselineNormalizedPoint,
      heldOut.deepNormalizedPoint,
      currentGlobalDeepWeight
    );
    const directionalBucket = classifyGazeScreenRegion(routingPoint);
    const routingBucket = coarseBucketFromRegion(directionalBucket);
    const currentErrorPrior = directionalErrorPrior(
      training,
      directionalBucket,
      globalBaselineErrorPx,
      globalDeepErrorPx
    );
    const currentDeepWeight = deepWeightFromExpectedErrors2(
      currentErrorPrior.baselineExpectedErrorPx,
      currentErrorPrior.deepExpectedErrorPx
    );
    const globalPrior = buildGlobalPrior2(training);
    const bucketPrior = buildBucketPrior(
      routingBucket,
      training,
      globalPrior
    );
    const coarseReliabilityDeepWeight = bucketPrior.deepWeight;
    const currentHybrid = blendPoint2(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      currentDeepWeight
    );
    const coarseReliabilityHybrid = blendPoint2(
      heldOut.baselineViewportPoint,
      heldOut.deepViewportPoint,
      coarseReliabilityDeepWeight
    );
    const currentHybridErrorPx = pointErrorPx2(
      currentHybrid,
      heldOut.targetViewportPoint
    );
    const coarseReliabilityHybridErrorPx = pointErrorPx2(
      coarseReliabilityHybrid,
      heldOut.targetViewportPoint
    );
    pointResults.push({
      pointIndex: heldOut.pointIndex,
      routingBucket,
      currentDeepWeight,
      coarseReliabilityDeepWeight,
      currentHybridErrorPx,
      coarseReliabilityHybridErrorPx,
      improved: coarseReliabilityHybridErrorPx < currentHybridErrorPx
    });
  }
  const currentErrors = pointResults.map(
    (point) => point.currentHybridErrorPx
  );
  const coarseErrors = pointResults.map(
    (point) => point.coarseReliabilityHybridErrorPx
  );
  const currentMeanErrorPx = mean10(currentErrors);
  const coarseReliabilityMeanErrorPx = mean10(coarseErrors);
  const currentP95ErrorPx = percentile9(currentErrors, 0.95);
  const coarseReliabilityP95ErrorPx = percentile9(coarseErrors, 0.95);
  const routingEnabled = coarseReliabilityMeanErrorPx < currentMeanErrorPx && coarseReliabilityP95ErrorPx <= currentP95ErrorPx;
  return {
    pointCount: pointResults.length,
    currentMeanErrorPx,
    coarseReliabilityMeanErrorPx,
    currentP95ErrorPx,
    coarseReliabilityP95ErrorPx,
    currentRmsePx: rmse2(currentErrors),
    coarseReliabilityRmsePx: rmse2(coarseErrors),
    improvedPointFraction: mean10(
      pointResults.map((point) => point.improved ? 1 : 0)
    ),
    meanImprovementPx: currentMeanErrorPx - coarseReliabilityMeanErrorPx,
    p95ImprovementPx: currentP95ErrorPx - coarseReliabilityP95ErrorPx,
    routingEnabled,
    pointResults
  };
}
function fitCalibrationCoarseEngineReliabilityModel(baselinePoints, deepPoints) {
  const observations = createObservations2(
    baselinePoints,
    deepPoints
  );
  const globalPrior = buildGlobalPrior2(observations);
  const bucketPriors = buildBucketPriors(
    observations,
    globalPrior
  );
  const crossValidation = nestedCrossValidation2(observations);
  return {
    routingEnabled: crossValidation.routingEnabled,
    globalPrior,
    bucketPriors,
    crossValidation
  };
}

// src/gaze/calibrationSessionStrategySelector.ts
function mean11(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Session strategy selector cannot average an empty set."
    );
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function percentile10(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Session strategy selector received an invalid percentile request."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Session strategy selector percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function rmse3(values) {
  return Math.sqrt(mean11(values.map((value) => value * value)));
}
function clamp7(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function blendPoint3(baseline, deep, deepWeight) {
  const baselineWeight = 1 - deepWeight;
  return {
    x: baselineWeight * baseline.x + deepWeight * deep.x,
    y: baselineWeight * baseline.y + deepWeight * deep.y
  };
}
function pointErrorPx3(point, target) {
  return Math.hypot(
    point.x - target.x,
    point.y - target.y
  );
}
function regionHit(predicted, target) {
  const targetRegion = classifyGazeScreenRegion(target);
  const predictedRegion = classifyGazeScreenRegion(predicted);
  return predictedRegion === targetRegion;
}
function candidateMetrics(strategy, points) {
  const errors = points.map((point) => point.errorPx);
  return {
    strategy,
    pointCount: points.length,
    meanErrorPx: mean11(errors),
    p95ErrorPx: percentile10(errors, 0.95),
    rmsePx: rmse3(errors),
    maxErrorPx: Math.max(...errors),
    regionHitRate: mean11(
      points.map((point) => point.regionHit ? 1 : 0)
    )
  };
}
function liveCalibrationRoutingInfluence(engineReliability, coarseReliability) {
  if (coarseReliability.routingEnabled) {
    return {
      mode: "COARSE",
      influence: clamp7(
        coarseReliability.crossValidation.improvedPointFraction,
        0,
        1
      )
    };
  }
  if (engineReliability.routingEnabled) {
    return {
      mode: "DIRECTIONAL",
      influence: clamp7(
        engineReliability.crossValidation.improvedPointFraction,
        0,
        1
      )
    };
  }
  return {
    mode: "ERROR_DERIVED",
    influence: 0
  };
}
function directionalRoutingEnabledWithoutPoint(pointIndex, engineReliability) {
  const remaining = engineReliability.crossValidation.pointResults.filter(
    (point) => point.pointIndex !== pointIndex
  );
  if (remaining.length === 0) {
    return false;
  }
  const currentErrors = remaining.map(
    (point) => point.currentHybridErrorPx
  );
  const reliabilityErrors = remaining.map(
    (point) => point.reliabilityHybridErrorPx
  );
  return mean11(reliabilityErrors) < mean11(currentErrors) && percentile10(reliabilityErrors, 0.95) <= percentile10(currentErrors, 0.95);
}
function coarseRoutingEnabledWithoutPoint(pointIndex, coarseReliability) {
  const remaining = coarseReliability.crossValidation.pointResults.filter(
    (point) => point.pointIndex !== pointIndex
  );
  if (remaining.length === 0) {
    return false;
  }
  const currentErrors = remaining.map(
    (point) => point.currentHybridErrorPx
  );
  const reliabilityErrors = remaining.map(
    (point) => point.coarseReliabilityHybridErrorPx
  );
  return mean11(reliabilityErrors) < mean11(currentErrors) && percentile10(reliabilityErrors, 0.95) <= percentile10(currentErrors, 0.95);
}
function leaveOneOutRouting(pointIndex, engineReliability, coarseReliability) {
  if (coarseRoutingEnabledWithoutPoint(
    pointIndex,
    coarseReliability
  )) {
    const remaining = coarseReliability.crossValidation.pointResults.filter(
      (point) => point.pointIndex !== pointIndex
    );
    return {
      mode: "COARSE",
      influence: clamp7(
        mean11(remaining.map((point) => point.improved ? 1 : 0)),
        0,
        1
      )
    };
  }
  if (directionalRoutingEnabledWithoutPoint(
    pointIndex,
    engineReliability
  )) {
    const remaining = engineReliability.crossValidation.pointResults.filter(
      (point) => point.pointIndex !== pointIndex
    );
    return {
      mode: "DIRECTIONAL",
      influence: clamp7(
        mean11(remaining.map((point) => point.improved ? 1 : 0)),
        0,
        1
      )
    };
  }
  return {
    mode: "ERROR_DERIVED",
    influence: 0
  };
}
function safeHybridPointResults(baselinePoints, deepPoints, engineReliability, coarseReliability) {
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point])
  );
  const directionalCvByIndex = new Map(
    engineReliability.crossValidation.pointResults.map(
      (point) => [point.pointIndex, point]
    )
  );
  const coarseCvByIndex = new Map(
    coarseReliability.crossValidation.pointResults.map(
      (point) => [point.pointIndex, point]
    )
  );
  return baselinePoints.map((baseline) => {
    const deep = deepByIndex.get(baseline.pointIndex);
    const directionalCv = directionalCvByIndex.get(baseline.pointIndex);
    const coarseCv = coarseCvByIndex.get(baseline.pointIndex);
    if (deep === void 0 || directionalCv === void 0 || coarseCv === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Session strategy selector could not align grouped-CV point diagnostics.",
        { details: { pointIndex: baseline.pointIndex } }
      );
    }
    const currentDeepWeight = directionalCv.currentDeepWeight;
    const heldOutRouting = leaveOneOutRouting(
      baseline.pointIndex,
      engineReliability,
      coarseReliability
    );
    const reliabilityDeepWeight = heldOutRouting.mode === "COARSE" ? coarseCv.coarseReliabilityDeepWeight : heldOutRouting.mode === "DIRECTIONAL" ? directionalCv.reliabilityDeepWeight : currentDeepWeight;
    const routingInfluence = heldOutRouting.influence;
    const safeHybridDeepWeight = clamp7(
      currentDeepWeight + routingInfluence * (reliabilityDeepWeight - currentDeepWeight),
      0,
      1
    );
    const safeHybridViewportPoint = blendPoint3(
      baseline.predictedViewportPoint,
      deep.predictedViewportPoint,
      safeHybridDeepWeight
    );
    return {
      pointIndex: baseline.pointIndex,
      targetViewportPoint: baseline.targetViewportPoint,
      baselineErrorPx: baseline.errorPx,
      deepErrorPx: deep.errorPx,
      safeHybridErrorPx: pointErrorPx3(
        safeHybridViewportPoint,
        baseline.targetViewportPoint
      ),
      safeHybridDeepWeight,
      routingInfluence,
      baselineRegionHit: regionHit(
        baseline.predictedNormalizedPoint,
        baseline.targetNormalizedPoint
      ),
      deepRegionHit: regionHit(
        deep.predictedNormalizedPoint,
        deep.targetNormalizedPoint
      ),
      safeHybridRegionHit: regionHit(
        blendPoint3(
          baseline.predictedNormalizedPoint,
          deep.predictedNormalizedPoint,
          safeHybridDeepWeight
        ),
        baseline.targetNormalizedPoint
      )
    };
  });
}
function binomialCoefficient(n2, k2) {
  if (k2 < 0 || k2 > n2) {
    return 0;
  }
  const effectiveK = Math.min(k2, n2 - k2);
  let result = 1;
  for (let index = 1; index <= effectiveK; index += 1) {
    result *= (n2 - effectiveK + index) / index;
  }
  return result;
}
function exactOneSidedSignTestPValue(winCount, nonTiedPointCount) {
  if (nonTiedPointCount <= 0) {
    return 1;
  }
  let upperTail = 0;
  for (let wins = winCount; wins <= nonTiedPointCount; wins += 1) {
    upperTail += binomialCoefficient(
      nonTiedPointCount,
      wins
    );
  }
  return upperTail / 2 ** nonTiedPointCount;
}
function standaloneSelectionEvidence(standalone, hybrid, standaloneErrors, hybridErrors) {
  if (standaloneErrors.length !== hybridErrors.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Standalone strategy evidence requires paired calibration errors."
    );
  }
  let standaloneWinCount = 0;
  let hybridWinCount = 0;
  for (let index = 0; index < standaloneErrors.length; index += 1) {
    const standaloneError = standaloneErrors[index];
    const hybridError = hybridErrors[index];
    if (standaloneError === void 0 || hybridError === void 0) {
      continue;
    }
    if (standaloneError < hybridError) {
      standaloneWinCount += 1;
    } else if (hybridError < standaloneError) {
      hybridWinCount += 1;
    }
  }
  const nonTiedPointCount = standaloneWinCount + hybridWinCount;
  const oneSidedSignTestPValue = exactOneSidedSignTestPValue(
    standaloneWinCount,
    nonTiedPointCount
  );
  const aggregateNonInferiorToHybrid = standalone.meanErrorPx <= hybrid.meanErrorPx && standalone.p95ErrorPx <= hybrid.p95ErrorPx && standalone.rmsePx <= hybrid.rmsePx && standalone.regionHitRate >= hybrid.regionHitRate;
  const pairedConsistencySupported = oneSidedSignTestPValue <= 0.05;
  return {
    strategy: standalone.strategy === "BASELINE_ONLY" ? "BASELINE_ONLY" : "DEEP_ONLY",
    nonTiedPointCount,
    standaloneWinCount,
    hybridWinCount,
    oneSidedSignTestPValue,
    aggregateNonInferiorToHybrid,
    pairedConsistencySupported,
    eligibleForStandaloneSelection: aggregateNonInferiorToHybrid && pairedConsistencySupported
  };
}
function scoreCandidates(baseline, deep, hybrid) {
  const raw = [baseline, deep, hybrid];
  const bestMean = Math.min(...raw.map((candidate) => candidate.meanErrorPx));
  const bestP95 = Math.min(...raw.map((candidate) => candidate.p95ErrorPx));
  const bestRmse = Math.min(...raw.map((candidate) => candidate.rmsePx));
  const withScores = raw.map((candidate) => ({
    ...candidate,
    selectionScore: Math.max(
      candidate.meanErrorPx / Math.max(1e-9, bestMean),
      candidate.p95ErrorPx / Math.max(1e-9, bestP95),
      candidate.rmsePx / Math.max(1e-9, bestRmse)
    )
  }));
  return Object.fromEntries(
    withScores.map((candidate) => [candidate.strategy, candidate])
  );
}
function selectCandidate2(baseline, deep, hybrid, baselineErrors, deepErrors, hybridErrors) {
  const candidates = scoreCandidates(
    baseline,
    deep,
    hybrid
  );
  const baselineEvidence = standaloneSelectionEvidence(
    baseline,
    hybrid,
    baselineErrors,
    hybridErrors
  );
  const deepEvidence = standaloneSelectionEvidence(
    deep,
    hybrid,
    deepErrors,
    hybridErrors
  );
  const eligibleStandalone = [
    baselineEvidence.eligibleForStandaloneSelection ? candidates.BASELINE_ONLY : null,
    deepEvidence.eligibleForStandaloneSelection ? candidates.DEEP_ONLY : null
  ].filter(
    (candidate) => candidate !== null
  );
  const selected = eligibleStandalone.length === 0 ? candidates.SAFE_ADAPTIVE_HYBRID : [...eligibleStandalone].sort((a2, b2) => {
    const scoreDelta = a2.selectionScore - b2.selectionScore;
    if (Math.abs(scoreDelta) > 1e-12) {
      return scoreDelta;
    }
    const regionDelta = b2.regionHitRate - a2.regionHitRate;
    if (Math.abs(regionDelta) > 1e-12) {
      return regionDelta;
    }
    return a2.strategy === "BASELINE_ONLY" ? -1 : 1;
  })[0];
  if (selected === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Session strategy selector could not choose a calibration candidate."
    );
  }
  return {
    selected,
    candidates,
    standaloneEvidence: {
      BASELINE_ONLY: baselineEvidence,
      DEEP_ONLY: deepEvidence
    }
  };
}
function fitCalibrationSessionStrategy(baselinePoints, deepPoints, engineReliability, coarseReliability) {
  if (baselinePoints.length === 0 || baselinePoints.length !== deepPoints.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Session strategy selection requires matching grouped-CV calibration points."
    );
  }
  const pointResults = safeHybridPointResults(
    baselinePoints,
    deepPoints,
    engineReliability,
    coarseReliability
  );
  const baselineCandidatePoints = baselinePoints.map((point) => ({
    pointIndex: point.pointIndex,
    targetViewportPoint: point.targetViewportPoint,
    predictedViewportPoint: point.predictedViewportPoint,
    errorPx: point.errorPx,
    regionHit: regionHit(
      point.predictedNormalizedPoint,
      point.targetNormalizedPoint
    )
  }));
  const deepCandidatePoints = deepPoints.map((point) => ({
    pointIndex: point.pointIndex,
    targetViewportPoint: point.targetViewportPoint,
    predictedViewportPoint: point.predictedViewportPoint,
    errorPx: point.errorPx,
    regionHit: regionHit(
      point.predictedNormalizedPoint,
      point.targetNormalizedPoint
    )
  }));
  const baselineCandidate = candidateMetrics(
    "BASELINE_ONLY",
    baselineCandidatePoints
  );
  const deepCandidate = candidateMetrics(
    "DEEP_ONLY",
    deepCandidatePoints
  );
  const baselineByIndex = new Map(
    baselinePoints.map((point) => [point.pointIndex, point])
  );
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point])
  );
  const safeHybridCandidatePoints = pointResults.map((point) => {
    const baseline = baselineByIndex.get(point.pointIndex);
    const deep = deepByIndex.get(point.pointIndex);
    if (baseline === void 0 || deep === void 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Session strategy selector lost an aligned hybrid calibration point.",
        { details: { pointIndex: point.pointIndex } }
      );
    }
    const predictedViewportPoint = blendPoint3(
      baseline.predictedViewportPoint,
      deep.predictedViewportPoint,
      point.safeHybridDeepWeight
    );
    return {
      pointIndex: point.pointIndex,
      targetViewportPoint: point.targetViewportPoint,
      predictedViewportPoint,
      errorPx: point.safeHybridErrorPx,
      regionHit: point.safeHybridRegionHit
    };
  });
  const safeHybridCandidate = candidateMetrics(
    "SAFE_ADAPTIVE_HYBRID",
    safeHybridCandidatePoints
  );
  const selection = selectCandidate2(
    baselineCandidate,
    deepCandidate,
    safeHybridCandidate,
    baselineCandidatePoints.map((point) => point.errorPx),
    deepCandidatePoints.map((point) => point.errorPx),
    safeHybridCandidatePoints.map((point) => point.errorPx)
  );
  const activeRouting = liveCalibrationRoutingInfluence(
    engineReliability,
    coarseReliability
  );
  return {
    selectedStrategy: selection.selected.strategy,
    selectedCandidate: selection.selected,
    candidates: selection.candidates,
    activeCalibrationRoutingMode: activeRouting.mode,
    calibrationRoutingInfluence: activeRouting.influence,
    standaloneEvidence: selection.standaloneEvidence,
    pointResults
  };
}

// src/gaze/calibrationHybridSelector.ts
function mean12(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Hybrid selector cannot average an empty calibration-error set."
    );
  }
  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}
function clamp8(value, minimum, maximum) {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}
function coarseBucketFromRegion2(region) {
  if (region === "CENTER") {
    return "CENTER";
  }
  if (isDiagonalGazeRegion(region)) {
    return "CORNER";
  }
  if (isCardinalGazeRegion(region)) {
    return "EDGE";
  }
  return "CENTER";
}
function deepWeightFromExpectedErrors3(baselineExpectedErrorPx, deepExpectedErrorPx) {
  const baseline = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    baselineExpectedErrorPx
  );
  const deep = Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    deepExpectedErrorPx
  );
  const rawWeight = baseline * baseline / (baseline * baseline + deep * deep);
  return clamp8(
    rawWeight,
    DEEP_PERSONALIZATION.HYBRID_MIN_DEEP_WEIGHT,
    DEEP_PERSONALIZATION.HYBRID_MAX_DEEP_WEIGHT
  );
}
function expectedHybridError(baselineExpectedErrorPx, deepExpectedErrorPx, deepWeight) {
  const baselineWeight = 1 - deepWeight;
  return Math.sqrt(
    baselineWeight * baselineWeight * baselineExpectedErrorPx * baselineExpectedErrorPx + deepWeight * deepWeight * deepExpectedErrorPx * deepExpectedErrorPx
  );
}
function normalizedExcess(magnitude, soft, hard) {
  if (!Number.isFinite(magnitude)) {
    return 1;
  }
  if (magnitude <= soft) {
    return 0;
  }
  if (hard <= soft) {
    return 1;
  }
  return clamp8(
    (magnitude - soft) / (hard - soft),
    0,
    1
  );
}
function computeDriftSeverity(drift) {
  if (drift === null) {
    return 0;
  }
  const yaw = normalizedExcess(
    Math.abs(drift.deltaHeadYawDeg),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_SOFT_DEG,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_HARD_DEG
  );
  const pitch = normalizedExcess(
    Math.abs(drift.deltaHeadPitchDeg),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_SOFT_DEG,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_HARD_DEG
  );
  const roll = normalizedExcess(
    Math.abs(drift.deltaHeadRollDeg),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_SOFT_DEG,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_HEAD_HARD_DEG
  );
  const faceCenterMagnitude = Math.hypot(
    drift.deltaFaceCenterX,
    drift.deltaFaceCenterY
  );
  const faceCenter = normalizedExcess(
    faceCenterMagnitude,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_FACE_CENTER_SOFT,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_FACE_CENTER_HARD
  );
  const scaleMagnitude = Math.max(
    Math.abs(drift.faceWidthScaleDelta),
    Math.abs(drift.faceHeightScaleDelta)
  );
  const scale = normalizedExcess(
    scaleMagnitude,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_SCALE_SOFT,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_SCALE_HARD
  );
  const distance5 = normalizedExcess(
    Math.abs(drift.faceDistanceDelta),
    DEEP_PERSONALIZATION.HYBRID_DRIFT_DISTANCE_SOFT,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_DISTANCE_HARD
  );
  return clamp8(
    0.22 * yaw + 0.28 * pitch + 0.1 * roll + 0.18 * faceCenter + 0.12 * scale + 0.1 * distance5,
    0,
    1
  );
}
function temporalStabilityPenaltyMultiplier(precisionPx, expectedErrorPx, driftSeverity) {
  if (precisionPx === null || precisionPx === void 0 || !Number.isFinite(precisionPx) || precisionPx < 0) {
    return 1;
  }
  const ratio = precisionPx / Math.max(
    DEEP_PERSONALIZATION.HYBRID_MIN_EXPECTED_ERROR_PX,
    expectedErrorPx
  );
  const jitterSeverity = normalizedExcess(
    ratio,
    DEEP_PERSONALIZATION.HYBRID_STABILITY_SOFT_RATIO,
    DEEP_PERSONALIZATION.HYBRID_STABILITY_HARD_RATIO
  );
  const evidenceStrength = clamp8(
    DEEP_PERSONALIZATION.HYBRID_STABILITY_BASE_STRENGTH + driftSeverity * DEEP_PERSONALIZATION.HYBRID_STABILITY_DRIFT_STRENGTH,
    0,
    1
  );
  return 1 + jitterSeverity * evidenceStrength * (DEEP_PERSONALIZATION.HYBRID_MAX_STABILITY_ERROR_MULTIPLIER - 1);
}
function deepConfidencePenaltyMultiplier(confidence) {
  if (confidence === null || !Number.isFinite(confidence)) {
    return DEEP_PERSONALIZATION.HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER;
  }
  const reference = DEEP_PERSONALIZATION.HYBRID_DEEP_CONFIDENCE_REFERENCE;
  if (confidence >= reference) {
    return 1;
  }
  const floor = DEEP_PERSONALIZATION.HYBRID_DEEP_CONFIDENCE_FLOOR;
  const fraction = clamp8(
    (reference - confidence) / Math.max(1e-6, reference - floor),
    0,
    1
  );
  return 1 + fraction * (DEEP_PERSONALIZATION.HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER - 1);
}
function buildPrior2(bucket, baselinePoints, deepPoints, globalBaselineErrorPx, globalDeepErrorPx, pseudoCount) {
  const baselineErrors = baselinePoints.map(
    (point) => point.errorPx
  );
  const deepErrors = deepPoints.map(
    (point) => point.errorPx
  );
  if (baselineErrors.length !== deepErrors.length || baselineErrors.length === 0) {
    if (bucket === "GLOBAL") {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Hybrid selector calibration diagnostics are incomplete."
      );
    }
    return {
      bucket,
      calibrationPointCount: 0,
      baselineExpectedErrorPx: globalBaselineErrorPx,
      deepExpectedErrorPx: globalDeepErrorPx,
      deepWeight: deepWeightFromExpectedErrors3(
        globalBaselineErrorPx,
        globalDeepErrorPx
      )
    };
  }
  const localBaseline = mean12(baselineErrors);
  const localDeep = mean12(deepErrors);
  if (bucket === "GLOBAL") {
    return {
      bucket,
      calibrationPointCount: baselineErrors.length,
      baselineExpectedErrorPx: localBaseline,
      deepExpectedErrorPx: localDeep,
      deepWeight: deepWeightFromExpectedErrors3(
        localBaseline,
        localDeep
      )
    };
  }
  const localWeight = baselineErrors.length / (baselineErrors.length + pseudoCount);
  const baselineExpectedErrorPx = localWeight * localBaseline + (1 - localWeight) * globalBaselineErrorPx;
  const deepExpectedErrorPx = localWeight * localDeep + (1 - localWeight) * globalDeepErrorPx;
  return {
    bucket,
    calibrationPointCount: baselineErrors.length,
    baselineExpectedErrorPx,
    deepExpectedErrorPx,
    deepWeight: deepWeightFromExpectedErrors3(
      baselineExpectedErrorPx,
      deepExpectedErrorPx
    )
  };
}
var DIRECTIONAL_BUCKETS3 = [
  "TOP_LEFT",
  "TOP",
  "TOP_RIGHT",
  "LEFT",
  "CENTER",
  "RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM",
  "BOTTOM_RIGHT"
];
var CalibrationHybridSelector = class {
  fitResult = null;
  fit(baselineCv, deepFit) {
    const deepByIndex = new Map(
      deepFit.selectedPointResults.map(
        (point) => [point.pointIndex, point]
      )
    );
    const matchedBaseline = baselineCv.pointResults.filter(
      (point) => deepByIndex.has(point.pointIndex)
    );
    const matchedDeep = matchedBaseline.map(
      (point) => deepByIndex.get(point.pointIndex)
    ).filter(
      (point) => point !== void 0
    );
    if (matchedBaseline.length < DEEP_PERSONALIZATION.MIN_CALIBRATION_POINT_COUNT || matchedBaseline.length !== matchedDeep.length) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Hybrid selector requires matching grouped-CV results from both gaze paths."
      );
    }
    const residualBias = fitCalibrationResidualBiasModel(
      matchedBaseline,
      matchedDeep
    );
    const baselineBiasCvByIndex = new Map(
      residualBias.baseline.crossValidation.pointResults.map(
        (point) => [point.pointIndex, point]
      )
    );
    const deepBiasCvByIndex = new Map(
      residualBias.deep.crossValidation.pointResults.map(
        (point) => [point.pointIndex, point]
      )
    );
    const priorBaseline = matchedBaseline.map(
      (point) => {
        if (!residualBias.baseline.correctionEnabled) {
          return point;
        }
        const corrected = baselineBiasCvByIndex.get(
          point.pointIndex
        );
        if (corrected === void 0) {
          return point;
        }
        return {
          ...point,
          predictedNormalizedPoint: corrected.correctedNormalizedPoint,
          predictedViewportPoint: corrected.correctedViewportPoint,
          errorPx: corrected.correctedErrorPx
        };
      }
    );
    const priorDeep = matchedDeep.map(
      (point) => {
        if (!residualBias.deep.correctionEnabled) {
          return point;
        }
        const corrected = deepBiasCvByIndex.get(
          point.pointIndex
        );
        if (corrected === void 0) {
          return point;
        }
        return {
          ...point,
          predictedNormalizedPoint: corrected.correctedNormalizedPoint,
          predictedViewportPoint: corrected.correctedViewportPoint,
          errorPx: corrected.correctedErrorPx
        };
      }
    );
    const engineReliability = fitCalibrationEngineReliabilityModel(
      priorBaseline,
      priorDeep
    );
    const coarseEngineReliability = fitCalibrationCoarseEngineReliabilityModel(
      priorBaseline,
      priorDeep
    );
    const sessionStrategy = fitCalibrationSessionStrategy(
      priorBaseline,
      priorDeep,
      engineReliability,
      coarseEngineReliability
    );
    const globalBaselineErrorPx = mean12(
      priorBaseline.map((point) => point.errorPx)
    );
    const globalDeepErrorPx = mean12(
      priorDeep.map((point) => point.errorPx)
    );
    const globalPrior = buildPrior2(
      "GLOBAL",
      priorBaseline,
      priorDeep,
      globalBaselineErrorPx,
      globalDeepErrorPx,
      0
    );
    const makeCoarseBucket = (bucket) => {
      const baselineBucket = priorBaseline.filter(
        (point) => point.spatialBucket === bucket
      );
      const indices = new Set(
        baselineBucket.map((point) => point.pointIndex)
      );
      const deepBucket = priorDeep.filter(
        (point) => indices.has(point.pointIndex)
      );
      return buildPrior2(
        bucket,
        baselineBucket,
        deepBucket,
        globalBaselineErrorPx,
        globalDeepErrorPx,
        DEEP_PERSONALIZATION.HYBRID_BUCKET_PSEUDOCOUNT
      );
    };
    const makeDirectionalBucket = (bucket) => {
      const baselineBucket = priorBaseline.filter(
        (point) => classifyGazeScreenRegion(
          point.targetNormalizedPoint
        ) === bucket
      );
      const indices = new Set(
        baselineBucket.map((point) => point.pointIndex)
      );
      const deepBucket = priorDeep.filter(
        (point) => indices.has(point.pointIndex)
      );
      return buildPrior2(
        bucket,
        baselineBucket,
        deepBucket,
        globalBaselineErrorPx,
        globalDeepErrorPx,
        DEEP_PERSONALIZATION.HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT
      );
    };
    const directionalPriors = Object.fromEntries(
      DIRECTIONAL_BUCKETS3.map(
        (bucket) => [
          bucket,
          makeDirectionalBucket(bucket)
        ]
      )
    );
    this.fitResult = {
      calibrationPointCount: matchedBaseline.length,
      globalPrior,
      bucketPriors: {
        CENTER: makeCoarseBucket("CENTER"),
        EDGE: makeCoarseBucket("EDGE"),
        CORNER: makeCoarseBucket("CORNER")
      },
      directionalPriors,
      residualBias,
      engineReliability,
      coarseEngineReliability,
      sessionStrategy
    };
    return this.fitResult;
  }
  predict(baselineNormalizedPoint, deepNormalizedPoint, context = {
    deepConfidence: null,
    drift: null,
    baselinePrecisionPx: null,
    deepPrecisionPx: null
  }) {
    const fit = this.fitResult;
    if (fit === null) {
      return null;
    }
    const globalDeepWeight = fit.globalPrior.deepWeight;
    const routingPoint = {
      x: clamp8(
        (1 - globalDeepWeight) * baselineNormalizedPoint.x + globalDeepWeight * deepNormalizedPoint.x,
        0,
        1
      ),
      y: clamp8(
        (1 - globalDeepWeight) * baselineNormalizedPoint.y + globalDeepWeight * deepNormalizedPoint.y,
        0,
        1
      )
    };
    const directionalBucket = classifyGazeScreenRegion(routingPoint);
    const spatialBucket = coarseBucketFromRegion2(directionalBucket);
    const directionalPrior = fit.directionalPriors[directionalBucket];
    const driftSeverity = computeDriftSeverity(context.drift);
    const directionalPriorReliability = clamp8(
      1 - driftSeverity * (1 - DEEP_PERSONALIZATION.HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY),
      DEEP_PERSONALIZATION.HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY,
      1
    );
    const baselineBias = applyCalibrationResidualBias(
      baselineNormalizedPoint,
      fit.residualBias.baseline,
      directionalBucket,
      directionalPriorReliability
    );
    const deepBias = applyCalibrationResidualBias(
      deepNormalizedPoint,
      fit.residualBias.deep,
      directionalBucket,
      directionalPriorReliability
    );
    const baselinePriorExpectedErrorPx = directionalPriorReliability * directionalPrior.baselineExpectedErrorPx + (1 - directionalPriorReliability) * fit.globalPrior.baselineExpectedErrorPx;
    const confidencePenalty = deepConfidencePenaltyMultiplier(
      context.deepConfidence
    );
    const deepPriorExpectedErrorPx = (directionalPriorReliability * directionalPrior.deepExpectedErrorPx + (1 - directionalPriorReliability) * fit.globalPrior.deepExpectedErrorPx) * confidencePenalty;
    const baselineStabilityPenalty = temporalStabilityPenaltyMultiplier(
      context.baselinePrecisionPx,
      baselinePriorExpectedErrorPx,
      driftSeverity
    );
    const deepStabilityPenalty = temporalStabilityPenaltyMultiplier(
      context.deepPrecisionPx,
      deepPriorExpectedErrorPx,
      driftSeverity
    );
    const baselineExpectedErrorPx = baselinePriorExpectedErrorPx * baselineStabilityPenalty;
    const deepExpectedErrorPx = deepPriorExpectedErrorPx * deepStabilityPenalty;
    const errorDerivedDeepWeight = deepWeightFromExpectedErrors3(
      baselineExpectedErrorPx,
      deepExpectedErrorPx
    );
    const reliabilityDirectionalPrior = fit.engineReliability.directionalPriors[directionalBucket];
    const calibrationReliabilityDeepWeight = directionalPriorReliability * reliabilityDirectionalPrior.deepWeight + (1 - directionalPriorReliability) * fit.engineReliability.globalPrior.deepWeight;
    const reliabilityAdjustedDeepWeight = adjustCalibrationReliabilityDeepWeight(
      calibrationReliabilityDeepWeight,
      baselineStabilityPenalty,
      confidencePenalty * deepStabilityPenalty
    );
    const directionalCalibrationReliabilityRoutingEnabled = fit.engineReliability.routingEnabled;
    const coarseReliabilityPrior = fit.coarseEngineReliability.bucketPriors[spatialBucket];
    const coarseCalibrationReliabilityDeepWeight = directionalPriorReliability * coarseReliabilityPrior.deepWeight + (1 - directionalPriorReliability) * fit.coarseEngineReliability.globalPrior.deepWeight;
    const coarseReliabilityAdjustedDeepWeight = adjustCalibrationReliabilityDeepWeight(
      coarseCalibrationReliabilityDeepWeight,
      baselineStabilityPenalty,
      confidencePenalty * deepStabilityPenalty
    );
    const coarseCalibrationReliabilityRoutingApplied = fit.coarseEngineReliability.routingEnabled;
    const calibrationReliabilityRoutingApplied = !coarseCalibrationReliabilityRoutingApplied && directionalCalibrationReliabilityRoutingEnabled;
    const activeReliabilityRoutingMode = coarseCalibrationReliabilityRoutingApplied ? "COARSE" : calibrationReliabilityRoutingApplied ? "DIRECTIONAL" : "ERROR_DERIVED";
    const reliabilityCandidateDeepWeight = coarseCalibrationReliabilityRoutingApplied ? coarseReliabilityAdjustedDeepWeight : calibrationReliabilityRoutingApplied ? reliabilityAdjustedDeepWeight : errorDerivedDeepWeight;
    const rawModelDisagreementNormalized = Math.hypot(
      baselineNormalizedPoint.x - deepNormalizedPoint.x,
      baselineNormalizedPoint.y - deepNormalizedPoint.y
    );
    const disagreementSeverity = normalizedExcess(
      rawModelDisagreementNormalized,
      DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_SOFT_NORMALIZED,
      DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_HARD_NORMALIZED
    );
    const baselineInstabilitySeverity = clamp8(
      (baselineStabilityPenalty - 1) / Math.max(
        1e-6,
        DEEP_PERSONALIZATION.HYBRID_MAX_STABILITY_ERROR_MULTIPLIER - 1
      ),
      0,
      1
    );
    const deepInstabilitySeverity = clamp8(
      Math.max(
        (deepStabilityPenalty - 1) / Math.max(
          1e-6,
          DEEP_PERSONALIZATION.HYBRID_MAX_STABILITY_ERROR_MULTIPLIER - 1
        ),
        (confidencePenalty - 1) / Math.max(
          1e-6,
          DEEP_PERSONALIZATION.HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER - 1
        )
      ),
      0,
      1
    );
    const liveRoutingAttenuation = clamp8(
      1 - disagreementSeverity * Math.max(
        baselineInstabilitySeverity,
        deepInstabilitySeverity
      ),
      0,
      1
    );
    const calibrationRoutingInfluence = activeReliabilityRoutingMode === "ERROR_DERIVED" ? 0 : fit.sessionStrategy.calibrationRoutingInfluence;
    const effectiveRoutingInfluence = clamp8(
      calibrationRoutingInfluence * liveRoutingAttenuation,
      0,
      1
    );
    const adaptiveHybridDeepWeight = clamp8(
      errorDerivedDeepWeight + effectiveRoutingInfluence * (reliabilityCandidateDeepWeight - errorDerivedDeepWeight),
      0,
      1
    );
    const adaptiveHybridBaselineWeight = 1 - adaptiveHybridDeepWeight;
    const modelDisagreementNormalized = Math.hypot(
      baselineBias.correctedNormalizedPoint.x - deepBias.correctedNormalizedPoint.x,
      baselineBias.correctedNormalizedPoint.y - deepBias.correctedNormalizedPoint.y
    );
    const adaptiveHybridNormalizedPoint = {
      x: adaptiveHybridBaselineWeight * baselineBias.correctedNormalizedPoint.x + adaptiveHybridDeepWeight * deepBias.correctedNormalizedPoint.x,
      y: adaptiveHybridBaselineWeight * baselineBias.correctedNormalizedPoint.y + adaptiveHybridDeepWeight * deepBias.correctedNormalizedPoint.y
    };
    const selectedSessionStrategy = fit.sessionStrategy.selectedStrategy;
    const selectedStrategyDeepWeight = selectedSessionStrategy === "BASELINE_ONLY" ? 0 : selectedSessionStrategy === "DEEP_ONLY" ? 1 : adaptiveHybridDeepWeight;
    const normalizedPoint = selectedSessionStrategy === "BASELINE_ONLY" ? baselineBias.correctedNormalizedPoint : selectedSessionStrategy === "DEEP_ONLY" ? deepBias.correctedNormalizedPoint : adaptiveHybridNormalizedPoint;
    const deepWeight = adaptiveHybridDeepWeight;
    const baselineWeight = adaptiveHybridBaselineWeight;
    return {
      normalizedPoint,
      adaptiveHybridNormalizedPoint,
      selectedSessionStrategy,
      selectedStrategyDeepWeight,
      adaptiveHybridDeepWeight,
      calibrationRoutingInfluence,
      liveRoutingAttenuation,
      effectiveRoutingInfluence,
      spatialBucket,
      directionalBucket,
      deepWeight,
      baselineWeight,
      errorDerivedDeepWeight,
      calibrationReliabilityDeepWeight,
      calibrationReliabilityRoutingApplied,
      coarseCalibrationReliabilityDeepWeight,
      coarseCalibrationReliabilityRoutingApplied,
      activeReliabilityRoutingMode,
      baselineExpectedErrorPx,
      deepExpectedErrorPx,
      expectedHybridErrorPx: expectedHybridError(
        baselineExpectedErrorPx,
        deepExpectedErrorPx,
        deepWeight
      ),
      directionalPriorReliability,
      driftSeverity,
      deepConfidencePenaltyMultiplier: confidencePenalty,
      baselineStabilityPenaltyMultiplier: baselineStabilityPenalty,
      deepStabilityPenaltyMultiplier: deepStabilityPenalty,
      rawModelDisagreementNormalized,
      modelDisagreementNormalized,
      baselineBiasCorrectionApplied: baselineBias.applied,
      deepBiasCorrectionApplied: deepBias.applied,
      baselineBiasCorrectionStrength: baselineBias.correctionStrength,
      deepBiasCorrectionStrength: deepBias.correctionStrength,
      baselineBiasCorrectionNormalized: baselineBias.correctionNormalized,
      deepBiasCorrectionNormalized: deepBias.correctionNormalized,
      baselineBiasCorrectedNormalizedPoint: baselineBias.correctedNormalizedPoint,
      deepBiasCorrectedNormalizedPoint: deepBias.correctedNormalizedPoint
    };
  }
  getFitResult() {
    return this.fitResult;
  }
  reset() {
    this.fitResult = null;
  }
};

// src/gaze/hybridUncertainty.ts
function clamp9(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function assertFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Hybrid uncertainty requires finite non-negative ${name}.`,
      { details: { [name]: value } }
    );
  }
}
function retentionRatio(acceptedSampleCount, rawSampleCount) {
  if (rawSampleCount <= 0) {
    return 1;
  }
  return clamp9(
    acceptedSampleCount / rawSampleCount,
    Number.EPSILON,
    1
  );
}
function centroidNoiseNormalized(precisionPx, acceptedSampleCount, retention, minimumViewportDimensionPx) {
  if (precisionPx === null || !Number.isFinite(precisionPx) || precisionPx < 0 || acceptedSampleCount <= 0) {
    return 0;
  }
  const effectiveSampleCount = acceptedSampleCount * retention;
  return precisionPx / minimumViewportDimensionPx / Math.sqrt(
    Math.max(effectiveSampleCount, Number.EPSILON)
  );
}
function estimateHybridUncertainty(input) {
  assertFiniteNonNegative(
    input.minimumViewportDimensionPx,
    "minimumViewportDimensionPx"
  );
  assertFiniteNonNegative(
    input.expectedHybridErrorPx,
    "expectedHybridErrorPx"
  );
  assertFiniteNonNegative(
    input.modelDisagreementNormalized,
    "modelDisagreementNormalized"
  );
  if (input.minimumViewportDimensionPx <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid uncertainty requires a positive viewport dimension."
    );
  }
  const baselineWeight = clamp9(
    input.baselineWeight,
    0,
    1
  );
  const deepWeight = clamp9(
    input.deepWeight,
    0,
    1
  );
  const directionalReliability = clamp9(
    input.directionalPriorReliability,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY,
    1
  );
  const calibrationPriorRadiusNormalized = input.expectedHybridErrorPx / input.minimumViewportDimensionPx / Math.sqrt(directionalReliability);
  const baselineRawSampleCount = Math.max(
    0,
    input.baselineAcceptedSampleCount + input.baselineRejectedSampleCount
  );
  const baselineRetentionRatio = retentionRatio(
    input.baselineAcceptedSampleCount,
    baselineRawSampleCount
  );
  const deepRetentionRatio = retentionRatio(
    input.deepAcceptedSampleCount,
    input.deepRawSampleCount
  );
  const baselineCentroidNoise = centroidNoiseNormalized(
    input.baselinePrecisionPx,
    input.baselineAcceptedSampleCount,
    baselineRetentionRatio,
    input.minimumViewportDimensionPx
  );
  const deepCentroidNoise = centroidNoiseNormalized(
    input.deepPrecisionPx,
    input.deepAcceptedSampleCount,
    deepRetentionRatio,
    input.minimumViewportDimensionPx
  );
  const temporalNoiseRadiusNormalized = Math.hypot(
    baselineWeight * baselineCentroidNoise,
    deepWeight * deepCentroidNoise
  );
  const disagreementSoft = DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_SOFT_NORMALIZED;
  const disagreementHard = Math.max(
    disagreementSoft,
    DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_HARD_NORMALIZED
  );
  const disagreementExcess = clamp9(
    input.modelDisagreementNormalized - disagreementSoft,
    0,
    disagreementHard - disagreementSoft
  );
  const disagreementRadiusNormalized = Math.sqrt(baselineWeight * deepWeight) * disagreementExcess;
  const unclampedRadiusNormalized = Math.hypot(
    calibrationPriorRadiusNormalized,
    temporalNoiseRadiusNormalized,
    disagreementRadiusNormalized
  );
  const maximumRadius = DEEP_PERSONALIZATION.GAZE_REGION_MAX_UNCERTAINTY_RADIUS_NORMALIZED;
  const radiusNormalized = Math.min(
    maximumRadius,
    unclampedRadiusNormalized
  );
  return {
    radiusNormalized,
    unclampedRadiusNormalized,
    calibrationPriorRadiusNormalized,
    temporalNoiseRadiusNormalized,
    disagreementRadiusNormalized,
    baselineRetentionRatio,
    deepRetentionRatio,
    clamped: unclampedRadiusNormalized > maximumRadius
  };
}

// src/gaze/hybridIndependentEvaluator.ts
function mean13(values) {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation has no values to average."
    );
  }
  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}
function percentile11(values, probability) {
  if (values.length === 0 || probability < 0 || probability > 1) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation percentile request is invalid."
    );
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === void 0 || upper === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation percentile could not resolve its values."
    );
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function meanBucketError3(points, bucket) {
  const values = points.filter((point) => point.targetSpatialBucket === bucket).map((point) => point.hybridErrorPx);
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Hybrid validation pattern does not contain a ${bucket.toLowerCase()} point.`
    );
  }
  return mean13(values);
}
function toNormalized(point, viewportWidth, viewportHeight) {
  return {
    x: point.x / viewportWidth,
    y: point.y / viewportHeight
  };
}
function resolveDeepPoint(points, pointIndex) {
  const point = points.find(
    (candidate) => candidate.pointIndex === pointIndex
  );
  if (point === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid independent validation could not match a deep validation point.",
      { details: { pointIndex } }
    );
  }
  return point;
}
function hitRate(values) {
  return mean13(values.map((value) => value ? 1 : 0));
}
function evaluateHybridIndependentValidation(calibrationId, baseline, deep, selector) {
  const viewportWidth = deep.metrics.viewportWidthPx;
  const viewportHeight = deep.metrics.viewportHeightPx;
  const pointResults = [];
  for (const baselinePoint of baseline.pointResults) {
    const deepPoint = resolveDeepPoint(
      deep.pointResults,
      baselinePoint.pointIndex
    );
    const baselineNormalized = toNormalized(
      baselinePoint.correctedViewportPoint,
      viewportWidth,
      viewportHeight
    );
    const hybrid = selector.predict(
      baselineNormalized,
      deepPoint.representativeNormalizedPoint,
      {
        deepConfidence: deepPoint.meanConfidence,
        baselinePrecisionPx: baselinePoint.meanPrecisionPx ?? null,
        deepPrecisionPx: deepPoint.meanPrecisionPx,
        drift: {
          deltaHeadYawDeg: deepPoint.meanDeltaHeadYawDeg,
          deltaHeadPitchDeg: deepPoint.meanDeltaHeadPitchDeg,
          deltaHeadRollDeg: deepPoint.meanDeltaHeadRollDeg,
          deltaFaceCenterX: deepPoint.meanDeltaFaceCenterX,
          deltaFaceCenterY: deepPoint.meanDeltaFaceCenterY,
          faceWidthScaleDelta: deepPoint.meanFaceWidthScaleDelta,
          faceHeightScaleDelta: deepPoint.meanFaceHeightScaleDelta,
          faceDistanceDelta: deepPoint.meanFaceDistanceDelta
        }
      }
    );
    if (hybrid === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Hybrid selector is not fitted before independent validation."
      );
    }
    const baselineBiasCorrectedViewportPoint = {
      x: hybrid.baselineBiasCorrectedNormalizedPoint.x * viewportWidth,
      y: hybrid.baselineBiasCorrectedNormalizedPoint.y * viewportHeight
    };
    const deepBiasCorrectedViewportPoint = {
      x: hybrid.deepBiasCorrectedNormalizedPoint.x * viewportWidth,
      y: hybrid.deepBiasCorrectedNormalizedPoint.y * viewportHeight
    };
    const baselineBiasCorrectedErrorPx = Math.hypot(
      baselineBiasCorrectedViewportPoint.x - baselinePoint.targetViewportPoint.x,
      baselineBiasCorrectedViewportPoint.y - baselinePoint.targetViewportPoint.y
    );
    const deepBiasCorrectedErrorPx = Math.hypot(
      deepBiasCorrectedViewportPoint.x - baselinePoint.targetViewportPoint.x,
      deepBiasCorrectedViewportPoint.y - baselinePoint.targetViewportPoint.y
    );
    const hybridViewportPoint = {
      x: hybrid.adaptiveHybridNormalizedPoint.x * viewportWidth,
      y: hybrid.adaptiveHybridNormalizedPoint.y * viewportHeight
    };
    const selectedStrategyViewportPoint = {
      x: hybrid.normalizedPoint.x * viewportWidth,
      y: hybrid.normalizedPoint.y * viewportHeight
    };
    const hybridErrorPx = Math.hypot(
      hybridViewportPoint.x - baselinePoint.targetViewportPoint.x,
      hybridViewportPoint.y - baselinePoint.targetViewportPoint.y
    );
    const selectedStrategyErrorPx = Math.hypot(
      selectedStrategyViewportPoint.x - baselinePoint.targetViewportPoint.x,
      selectedStrategyViewportPoint.y - baselinePoint.targetViewportPoint.y
    );
    const targetRegion = estimateGazeScreenRegion(
      deepPoint.targetNormalizedPoint
    );
    const baselineRegion = estimateGazeScreenRegion(
      baselineNormalized
    );
    const deepRegion = estimateGazeScreenRegion(
      deepPoint.representativeNormalizedPoint
    );
    const minimumViewportDimension = Math.min(
      viewportWidth,
      viewportHeight
    );
    const selectedStrategyExpectedErrorPx = hybrid.selectedSessionStrategy === "BASELINE_ONLY" ? hybrid.baselineExpectedErrorPx : hybrid.selectedSessionStrategy === "DEEP_ONLY" ? hybrid.deepExpectedErrorPx : hybrid.expectedHybridErrorPx;
    const uncertainty = estimateHybridUncertainty({
      minimumViewportDimensionPx: minimumViewportDimension,
      expectedHybridErrorPx: selectedStrategyExpectedErrorPx,
      directionalPriorReliability: hybrid.directionalPriorReliability,
      baselineWeight: 1 - hybrid.selectedStrategyDeepWeight,
      deepWeight: hybrid.selectedStrategyDeepWeight,
      baselinePrecisionPx: baselinePoint.meanPrecisionPx ?? null,
      baselineAcceptedSampleCount: baselinePoint.sampleCount,
      baselineRejectedSampleCount: baselinePoint.rejectedCount,
      deepPrecisionPx: deepPoint.robustDeepPrecisionPx,
      deepAcceptedSampleCount: deepPoint.acceptedDeepSampleCount,
      deepRawSampleCount: deepPoint.rawDeepSampleCount,
      modelDisagreementNormalized: hybrid.modelDisagreementNormalized
    });
    const uncertaintyRadiusNormalized = uncertainty.radiusNormalized;
    const hybridRegion = estimateGazeScreenRegion(
      hybrid.adaptiveHybridNormalizedPoint,
      uncertaintyRadiusNormalized
    );
    const selectedStrategyRegion = estimateGazeScreenRegion(
      hybrid.normalizedPoint,
      uncertaintyRadiusNormalized
    );
    pointResults.push({
      pointIndex: baselinePoint.pointIndex,
      targetViewportPoint: {
        ...baselinePoint.targetViewportPoint
      },
      baselineViewportPoint: {
        ...baselinePoint.correctedViewportPoint
      },
      deepViewportPoint: {
        ...deepPoint.representativeViewportPoint
      },
      baselineBiasCorrectedViewportPoint,
      deepBiasCorrectedViewportPoint,
      hybridViewportPoint,
      selectedStrategyViewportPoint,
      baselineErrorPx: baselinePoint.errorPx,
      deepErrorPx: deepPoint.errorPx,
      baselineBiasCorrectedErrorPx,
      deepBiasCorrectedErrorPx,
      hybridErrorPx,
      selectedStrategyErrorPx,
      selectedSessionStrategy: hybrid.selectedSessionStrategy,
      selectedStrategyDeepWeight: hybrid.selectedStrategyDeepWeight,
      calibrationRoutingInfluence: hybrid.calibrationRoutingInfluence,
      liveRoutingAttenuation: hybrid.liveRoutingAttenuation,
      effectiveRoutingInfluence: hybrid.effectiveRoutingInfluence,
      routingBucket: hybrid.spatialBucket,
      directionalRoutingBucket: hybrid.directionalBucket,
      targetSpatialBucket: deepPoint.spatialBucket,
      deepWeight: hybrid.deepWeight,
      baselineWeight: hybrid.baselineWeight,
      errorDerivedDeepWeight: hybrid.errorDerivedDeepWeight,
      calibrationReliabilityDeepWeight: hybrid.calibrationReliabilityDeepWeight,
      calibrationReliabilityRoutingApplied: hybrid.calibrationReliabilityRoutingApplied,
      coarseCalibrationReliabilityDeepWeight: hybrid.coarseCalibrationReliabilityDeepWeight,
      coarseCalibrationReliabilityRoutingApplied: hybrid.coarseCalibrationReliabilityRoutingApplied,
      activeReliabilityRoutingMode: hybrid.activeReliabilityRoutingMode,
      baselineExpectedErrorPx: hybrid.baselineExpectedErrorPx,
      deepExpectedErrorPx: hybrid.deepExpectedErrorPx,
      expectedHybridErrorPx: hybrid.expectedHybridErrorPx,
      directionalPriorReliability: hybrid.directionalPriorReliability,
      driftSeverity: hybrid.driftSeverity,
      deepConfidencePenaltyMultiplier: hybrid.deepConfidencePenaltyMultiplier,
      baselineStabilityPenaltyMultiplier: hybrid.baselineStabilityPenaltyMultiplier,
      deepStabilityPenaltyMultiplier: hybrid.deepStabilityPenaltyMultiplier,
      rawModelDisagreementNormalized: hybrid.rawModelDisagreementNormalized,
      modelDisagreementNormalized: hybrid.modelDisagreementNormalized,
      baselineBiasCorrectionApplied: hybrid.baselineBiasCorrectionApplied,
      deepBiasCorrectionApplied: hybrid.deepBiasCorrectionApplied,
      baselineBiasCorrectionStrength: hybrid.baselineBiasCorrectionStrength,
      deepBiasCorrectionStrength: hybrid.deepBiasCorrectionStrength,
      baselineBiasCorrectionNormalized: hybrid.baselineBiasCorrectionNormalized,
      deepBiasCorrectionNormalized: hybrid.deepBiasCorrectionNormalized,
      baselineBiasCorrectionViewportPx: {
        x: hybrid.baselineBiasCorrectionNormalized.x * viewportWidth,
        y: hybrid.baselineBiasCorrectionNormalized.y * viewportHeight
      },
      deepBiasCorrectionViewportPx: {
        x: hybrid.deepBiasCorrectionNormalized.x * viewportWidth,
        y: hybrid.deepBiasCorrectionNormalized.y * viewportHeight
      },
      adaptiveUncertaintyRadiusNormalized: uncertaintyRadiusNormalized,
      uncertaintyUnclampedRadiusNormalized: uncertainty.unclampedRadiusNormalized,
      uncertaintyCalibrationPriorRadiusNormalized: uncertainty.calibrationPriorRadiusNormalized,
      uncertaintyTemporalNoiseRadiusNormalized: uncertainty.temporalNoiseRadiusNormalized,
      uncertaintyDisagreementRadiusNormalized: uncertainty.disagreementRadiusNormalized,
      uncertaintyBaselineRetentionRatio: uncertainty.baselineRetentionRatio,
      uncertaintyDeepRetentionRatio: uncertainty.deepRetentionRatio,
      uncertaintyClamped: uncertainty.clamped,
      baselineMeanPrecisionPx: baselinePoint.meanPrecisionPx ?? 0,
      deepMeanPrecisionPx: deepPoint.meanPrecisionPx,
      deepMeanConfidence: deepPoint.meanConfidence,
      deepSampleCount: deepPoint.sampleCount,
      targetGazeRegion: targetRegion.region,
      baselineGazeRegion: baselineRegion.region,
      deepGazeRegion: deepRegion.region,
      hybridGazeRegion: hybridRegion.region,
      selectedStrategyGazeRegion: selectedStrategyRegion.region,
      baselineRegionHit: baselineRegion.region === targetRegion.region,
      deepRegionHit: deepRegion.region === targetRegion.region,
      hybridRegionHit: hybridRegion.region === targetRegion.region,
      selectedStrategyRegionHit: selectedStrategyRegion.region === targetRegion.region,
      hybridRegionAmbiguous: hybridRegion.ambiguous,
      hybridRegionBoundaryMarginNormalized: hybridRegion.boundaryMarginNormalized,
      meanDeltaHeadYawDeg: deepPoint.meanDeltaHeadYawDeg,
      meanDeltaHeadPitchDeg: deepPoint.meanDeltaHeadPitchDeg,
      meanDeltaHeadRollDeg: deepPoint.meanDeltaHeadRollDeg,
      meanDeltaFaceCenterX: deepPoint.meanDeltaFaceCenterX,
      meanDeltaFaceCenterY: deepPoint.meanDeltaFaceCenterY,
      meanFaceWidthScaleDelta: deepPoint.meanFaceWidthScaleDelta,
      meanFaceHeightScaleDelta: deepPoint.meanFaceHeightScaleDelta,
      meanFaceDistanceDelta: deepPoint.meanFaceDistanceDelta
    });
  }
  const errors = pointResults.map(
    (point) => point.hybridErrorPx
  );
  const selectedStrategyErrors = pointResults.map(
    (point) => point.selectedStrategyErrorPx
  );
  const selectedSessionStrategy = pointResults[0]?.selectedSessionStrategy;
  if (selectedSessionStrategy === void 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Selected session strategy is unavailable during independent validation."
    );
  }
  const baselineBiasCorrectedErrors = pointResults.map(
    (point) => point.baselineBiasCorrectedErrorPx
  );
  const deepBiasCorrectedErrors = pointResults.map(
    (point) => point.deepBiasCorrectedErrorPx
  );
  const baselineHorizontalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.baselineViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.horizontalBand === predicted.horizontalBand;
  });
  const deepHorizontalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.deepViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.horizontalBand === predicted.horizontalBand;
  });
  const hybridHorizontalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.hybridViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.horizontalBand === predicted.horizontalBand;
  });
  const baselineVerticalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.baselineViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.verticalBand === predicted.verticalBand;
  });
  const deepVerticalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.deepViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.verticalBand === predicted.verticalBand;
  });
  const hybridVerticalHits = pointResults.map((point) => {
    const target = estimateGazeScreenRegion(
      toNormalized(
        point.targetViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    const predicted = estimateGazeScreenRegion(
      toNormalized(
        point.hybridViewportPoint,
        viewportWidth,
        viewportHeight
      )
    );
    return target.verticalBand === predicted.verticalBand;
  });
  return {
    calibrationId,
    metrics: {
      pointCount: pointResults.length,
      meanErrorPx: mean13(errors),
      medianErrorPx: percentile11(errors, 0.5),
      rmsePx: Math.sqrt(
        mean13(errors.map((error) => error * error))
      ),
      p90ErrorPx: percentile11(errors, 0.9),
      p95ErrorPx: percentile11(errors, 0.95),
      maxErrorPx: Math.max(...errors),
      selectedSessionStrategy,
      selectedStrategyMeanErrorPx: mean13(selectedStrategyErrors),
      selectedStrategyMedianErrorPx: percentile11(selectedStrategyErrors, 0.5),
      selectedStrategyRmsePx: Math.sqrt(
        mean13(
          selectedStrategyErrors.map(
            (error) => error * error
          )
        )
      ),
      selectedStrategyP95ErrorPx: percentile11(selectedStrategyErrors, 0.95),
      selectedStrategyMaxErrorPx: Math.max(...selectedStrategyErrors),
      selectedStrategyRegionHitRate: hitRate(
        pointResults.map(
          (point) => point.selectedStrategyRegionHit
        )
      ),
      centerErrorPx: meanBucketError3(pointResults, "CENTER"),
      edgeErrorPx: meanBucketError3(pointResults, "EDGE"),
      cornerErrorPx: meanBucketError3(pointResults, "CORNER"),
      baselineBiasCorrectedMeanErrorPx: mean13(baselineBiasCorrectedErrors),
      baselineBiasCorrectedP95ErrorPx: percentile11(baselineBiasCorrectedErrors, 0.95),
      deepBiasCorrectedMeanErrorPx: mean13(deepBiasCorrectedErrors),
      deepBiasCorrectedP95ErrorPx: percentile11(deepBiasCorrectedErrors, 0.95),
      baselineRegionHitRate: hitRate(
        pointResults.map((point) => point.baselineRegionHit)
      ),
      deepRegionHitRate: hitRate(
        pointResults.map((point) => point.deepRegionHit)
      ),
      hybridRegionHitRate: hitRate(
        pointResults.map((point) => point.hybridRegionHit)
      ),
      hybridAmbiguousRegionRate: hitRate(
        pointResults.map((point) => point.hybridRegionAmbiguous)
      ),
      meanAdaptiveUncertaintyRadiusNormalized: mean13(
        pointResults.map(
          (point) => point.adaptiveUncertaintyRadiusNormalized
        )
      ),
      p95AdaptiveUncertaintyRadiusNormalized: percentile11(
        pointResults.map(
          (point) => point.adaptiveUncertaintyRadiusNormalized
        ),
        0.95
      ),
      uncertaintyClampRate: hitRate(
        pointResults.map((point) => point.uncertaintyClamped)
      ),
      baselineHorizontalBandHitRate: hitRate(baselineHorizontalHits),
      deepHorizontalBandHitRate: hitRate(deepHorizontalHits),
      hybridHorizontalBandHitRate: hitRate(hybridHorizontalHits),
      baselineVerticalBandHitRate: hitRate(baselineVerticalHits),
      deepVerticalBandHitRate: hitRate(deepVerticalHits),
      hybridVerticalBandHitRate: hitRate(hybridVerticalHits)
    },
    pointResults
  };
}

// src/gaze/sessionGazeRuntimeRouter.ts
function finitePoint2(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function clamp015(value) {
  return Math.min(1, Math.max(0, value));
}
function copyPoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}
function baselineFallback(baselinePoint, configuredStrategy, validationReady, collectionAllowed, fallbackReason, sourceAgeMs = null, availabilityAgeMs = null, freshnessBudgetMs = null) {
  return {
    strategy: "BASELINE_FALLBACK",
    configuredStrategy,
    normalizedPoint: copyPoint(baselinePoint),
    deepWeight: 0,
    deepCandidateAgeMs: sourceAgeMs,
    deepCandidateSourceAgeMs: sourceAgeMs,
    deepCandidateAvailabilityAgeMs: availabilityAgeMs,
    deepCandidateFreshnessBudgetMs: freshnessBudgetMs,
    deepTemporalAlignmentApplied: false,
    validationReady,
    collectionAllowed,
    degradedCollection: collectionAllowed && !validationReady,
    usedFreshDeepCandidate: false,
    fallbackReason,
    hybridPrediction: null
  };
}
function resolveFreshnessBudgetMs(candidate) {
  const observerAttemptIntervalMs = 1e3 / GAZE_RUNTIME_DEFAULTS.DEEP_OBSERVER_SAMPLE_RATE_HZ;
  return Math.max(
    GAZE_RUNTIME_DEFAULTS.MAX_VISUAL_HOLD_MS,
    observerAttemptIntervalMs,
    candidate.inferenceLatencyMs
  );
}
function temporallyAlignDeepPoint(currentBaselinePoint, candidate) {
  return {
    x: clamp015(
      currentBaselinePoint.x + candidate.normalizedPoint.x - candidate.sourceBaselinePoint.x
    ),
    y: clamp015(
      currentBaselinePoint.y + candidate.normalizedPoint.y - candidate.sourceBaselinePoint.y
    )
  };
}
function createDeepRuntimeCandidate(sample, normalizedPoint, baseline, sourceBaselinePoint, availableAtTimestampMs = nowTimelineMs()) {
  if (!Number.isFinite(sample.prediction.timestampMs) || !finitePoint2(normalizedPoint) || !finitePoint2(sourceBaselinePoint) || !Number.isFinite(availableAtTimestampMs) || !Number.isFinite(
    sample.prediction.inferenceLatencyMs
  )) {
    return null;
  }
  const geometry = sample.geometry;
  const baselineWidth = Math.max(
    Number.EPSILON,
    baseline.width
  );
  const baselineHeight = Math.max(
    Number.EPSILON,
    baseline.height
  );
  const baselineDistance = Math.max(
    Number.EPSILON,
    baseline.distanceRatio
  );
  return {
    sourceTimestampMs: sample.prediction.timestampMs,
    availableAtTimestampMs,
    inferenceLatencyMs: Math.max(
      0,
      sample.prediction.inferenceLatencyMs
    ),
    sourceBaselinePoint: copyPoint(sourceBaselinePoint),
    normalizedPoint: {
      x: clamp015(normalizedPoint.x),
      y: clamp015(normalizedPoint.y)
    },
    confidence: clamp015(
      sample.prediction.confidence
    ),
    drift: {
      deltaHeadYawDeg: geometry.headPose.yawDeg - baseline.headPose.yawDeg,
      deltaHeadPitchDeg: geometry.headPose.pitchDeg - baseline.headPose.pitchDeg,
      deltaHeadRollDeg: geometry.headPose.rollDeg - baseline.headPose.rollDeg,
      deltaFaceCenterX: geometry.faceCenterNormalized.x - baseline.centerX,
      deltaFaceCenterY: geometry.faceCenterNormalized.y - baseline.centerY,
      faceWidthScaleDelta: geometry.faceWidthRatio / baselineWidth - 1,
      faceHeightScaleDelta: geometry.faceHeightRatio / baselineHeight - 1,
      faceDistanceDelta: geometry.faceDistanceRatio / baselineDistance - 1
    }
  };
}
function selectSessionRuntimeGaze(baselinePrediction, deepCandidate, selector, context = {
  validationReady: false,
  allowDegradedCollection: false
}) {
  const baselinePoint = baselinePrediction.rawPoint;
  const activeSelector = selector;
  const fit = activeSelector?.getFitResult() ?? null;
  if (!Number.isFinite(baselinePrediction.timestampMs) || baselinePrediction.rawSpace !== "NORMALIZED" || !finitePoint2(baselinePoint)) {
    return baselineFallback(
      baselinePoint,
      null,
      context.validationReady,
      false,
      "STRATEGY_NOT_READY"
    );
  }
  const configuredStrategy = fit?.sessionStrategy.selectedStrategy ?? null;
  const collectionAllowed = context.validationReady || context.allowDegradedCollection === true;
  if (!collectionAllowed) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      false,
      false,
      "VALIDATION_NOT_READY"
    );
  }
  if (context.suspendCollectionForDrift === true) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      false,
      "DRIFT_RECALIBRATION_REQUIRED"
    );
  }
  if (context.forceBaselineStrategy === true) {
    return {
      strategy: "BASELINE_ONLY",
      configuredStrategy,
      normalizedPoint: copyPoint(baselinePoint),
      deepWeight: 0,
      deepCandidateAgeMs: null,
      deepCandidateSourceAgeMs: null,
      deepCandidateAvailabilityAgeMs: null,
      deepCandidateFreshnessBudgetMs: null,
      deepTemporalAlignmentApplied: false,
      validationReady: context.validationReady,
      collectionAllowed: true,
      degradedCollection: !context.validationReady,
      usedFreshDeepCandidate: false,
      fallbackReason: "BASELINE_SAFETY_OVERRIDE",
      hybridPrediction: null
    };
  }
  if (fit === null || activeSelector === null || configuredStrategy === null) {
    return baselineFallback(
      baselinePoint,
      null,
      context.validationReady,
      false,
      "STRATEGY_NOT_READY"
    );
  }
  if (configuredStrategy === "BASELINE_ONLY") {
    return {
      strategy: "BASELINE_ONLY",
      configuredStrategy,
      normalizedPoint: copyPoint(baselinePoint),
      deepWeight: 0,
      deepCandidateAgeMs: null,
      deepCandidateSourceAgeMs: null,
      deepCandidateAvailabilityAgeMs: null,
      deepCandidateFreshnessBudgetMs: null,
      deepTemporalAlignmentApplied: false,
      validationReady: context.validationReady,
      collectionAllowed: true,
      degradedCollection: !context.validationReady,
      usedFreshDeepCandidate: false,
      fallbackReason: "BASELINE_SELECTED",
      hybridPrediction: null
    };
  }
  if (deepCandidate === null || !Number.isFinite(deepCandidate.sourceTimestampMs) || !Number.isFinite(deepCandidate.availableAtTimestampMs) || !Number.isFinite(deepCandidate.inferenceLatencyMs) || deepCandidate.inferenceLatencyMs < 0 || !finitePoint2(deepCandidate.normalizedPoint) || !finitePoint2(deepCandidate.sourceBaselinePoint) || !Number.isFinite(deepCandidate.confidence)) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_UNAVAILABLE"
    );
  }
  const sourceAgeMs = baselinePrediction.timestampMs - deepCandidate.sourceTimestampMs;
  if (sourceAgeMs < 0) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_SOURCE_FROM_FUTURE",
      sourceAgeMs
    );
  }
  if (sourceAgeMs > DEEP_PERSONALIZATION.LIVE_DEEP_MAX_SOURCE_AGE_MS) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_SOURCE_TOO_OLD",
      sourceAgeMs
    );
  }
  const availabilityAgeMs = Math.max(
    0,
    baselinePrediction.timestampMs - deepCandidate.availableAtTimestampMs
  );
  const freshnessBudgetMs = resolveFreshnessBudgetMs(deepCandidate);
  if (availabilityAgeMs > freshnessBudgetMs) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DEEP_STALE",
      sourceAgeMs,
      availabilityAgeMs,
      freshnessBudgetMs
    );
  }
  if (context.forceBaselineForDrift === true) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "DRIFT_RECALIBRATION_REQUIRED",
      sourceAgeMs,
      availabilityAgeMs,
      freshnessBudgetMs
    );
  }
  const alignedDeepPoint = temporallyAlignDeepPoint(
    baselinePoint,
    deepCandidate
  );
  if (configuredStrategy === "DEEP_ONLY") {
    return {
      strategy: "DEEP_ONLY",
      configuredStrategy,
      normalizedPoint: alignedDeepPoint,
      deepWeight: 1,
      deepCandidateAgeMs: sourceAgeMs,
      deepCandidateSourceAgeMs: sourceAgeMs,
      deepCandidateAvailabilityAgeMs: availabilityAgeMs,
      deepCandidateFreshnessBudgetMs: freshnessBudgetMs,
      deepTemporalAlignmentApplied: true,
      validationReady: context.validationReady,
      collectionAllowed: true,
      degradedCollection: !context.validationReady,
      usedFreshDeepCandidate: true,
      fallbackReason: null,
      hybridPrediction: null
    };
  }
  const hybridPrediction = activeSelector.predict(
    baselinePoint,
    alignedDeepPoint,
    {
      deepConfidence: deepCandidate.confidence,
      drift: context.currentDrift ?? deepCandidate.drift,
      baselinePrecisionPx: context.baselinePrecisionPx ?? null,
      deepPrecisionPx: context.deepPrecisionPx ?? null
    }
  );
  if (hybridPrediction === null) {
    return baselineFallback(
      baselinePoint,
      configuredStrategy,
      context.validationReady,
      true,
      "HYBRID_PREDICTION_UNAVAILABLE",
      sourceAgeMs,
      availabilityAgeMs,
      freshnessBudgetMs
    );
  }
  return {
    strategy: "SAFE_ADAPTIVE_HYBRID",
    configuredStrategy,
    normalizedPoint: {
      ...hybridPrediction.normalizedPoint
    },
    deepWeight: hybridPrediction.selectedStrategyDeepWeight,
    deepCandidateAgeMs: sourceAgeMs,
    deepCandidateSourceAgeMs: sourceAgeMs,
    deepCandidateAvailabilityAgeMs: availabilityAgeMs,
    deepCandidateFreshnessBudgetMs: freshnessBudgetMs,
    deepTemporalAlignmentApplied: true,
    validationReady: context.validationReady,
    collectionAllowed: true,
    degradedCollection: !context.validationReady,
    usedFreshDeepCandidate: true,
    fallbackReason: null,
    hybridPrediction
  };
}

// src/calibration/calibrationPattern.ts
var PRECISION_SEQUENCE = [
  [2, 2],
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [2, 0],
  [4, 2],
  [2, 4],
  [0, 2],
  [1, 1],
  [3, 1],
  [3, 3],
  [1, 3],
  [2, 1],
  [3, 2],
  [2, 3],
  [1, 2],
  [1, 0],
  [3, 0],
  [4, 1],
  [4, 3],
  [3, 4],
  [1, 4],
  [0, 3],
  [0, 1]
];
function assertViewportSize(viewport) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new RangeError(
      "Calibration viewport dimensions must be finite and greater than zero."
    );
  }
}
function createFiveAxisValues() {
  const outerLow = CALIBRATION.TARGET_MARGIN_RATIO;
  const outerHigh = 1 - outerLow;
  const center = 0.5;
  const innerLow = (outerLow + center) / 2;
  const innerHigh = (center + outerHigh) / 2;
  return [
    outerLow,
    innerLow,
    center,
    innerHigh,
    outerHigh
  ];
}
function normalizedToViewport(normalizedPoint, viewport) {
  return {
    x: normalizedPoint.x * viewport.width,
    y: normalizedPoint.y * viewport.height
  };
}
function createTargetsFromSequence(sequence, viewport) {
  assertViewportSize(viewport);
  const axis = createFiveAxisValues();
  return sequence.map(
    ([column, row], pointIndex) => {
      const x2 = axis[column];
      const y2 = axis[row];
      if (x2 === void 0 || y2 === void 0) {
        throw new RangeError(
          "Calibration pattern contains an invalid grid index."
        );
      }
      const normalizedPoint = {
        x: x2,
        y: y2
      };
      return {
        pointIndex,
        normalizedPoint,
        viewportPoint: normalizedToViewport(
          normalizedPoint,
          viewport
        )
      };
    }
  );
}
function createCalibrationExpansionCandidates(viewport) {
  return createTargetsFromSequence(
    PRECISION_SEQUENCE,
    viewport
  ).slice(CALIBRATION.STANDARD_POINT_COUNT);
}

// src/gaze/calibrationAdaptiveExpansion.ts
function squaredDistance3(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}
function findStrategyPoint(points, pointIndex) {
  return points.find((point) => point.pointIndex === pointIndex) ?? null;
}
function createWeakPoints(baselinePoints, sessionStrategy, thresholdPx) {
  const weakPoints = [];
  for (const baselinePoint of baselinePoints) {
    const strategyPoint = findStrategyPoint(
      sessionStrategy.pointResults,
      baselinePoint.pointIndex
    );
    if (strategyPoint === null) {
      continue;
    }
    const coverageFloorErrorPx = Math.min(
      strategyPoint.baselineErrorPx,
      strategyPoint.deepErrorPx,
      strategyPoint.safeHybridErrorPx
    );
    if (coverageFloorErrorPx <= thresholdPx) {
      continue;
    }
    weakPoints.push({
      pointIndex: baselinePoint.pointIndex,
      targetNormalizedPoint: {
        ...baselinePoint.targetNormalizedPoint
      },
      targetViewportPoint: {
        ...baselinePoint.targetViewportPoint
      },
      coverageFloorErrorPx,
      baselineErrorPx: strategyPoint.baselineErrorPx,
      deepErrorPx: strategyPoint.deepErrorPx,
      safeHybridErrorPx: strategyPoint.safeHybridErrorPx,
      allStrategiesRegionMiss: !strategyPoint.baselineRegionHit && !strategyPoint.deepRegionHit && !strategyPoint.safeHybridRegionHit
    });
  }
  return weakPoints.sort((first, second) => {
    if (first.allStrategiesRegionMiss !== second.allStrategiesRegionMiss) {
      return first.allStrategiesRegionMiss ? -1 : 1;
    }
    const errorDifference = second.coverageFloorErrorPx - first.coverageFloorErrorPx;
    if (Math.abs(errorDifference) > Number.EPSILON) {
      return errorDifference;
    }
    return first.pointIndex - second.pointIndex;
  });
}
function findSymmetryPartnerIndex(candidates, sourceIndex) {
  const source = candidates[sourceIndex];
  if (source === void 0) {
    return null;
  }
  const mirrored = {
    x: 1 - source.normalizedPoint.x,
    y: 1 - source.normalizedPoint.y
  };
  let bestIndex = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === void 0) {
      continue;
    }
    const distance5 = squaredDistance3(
      candidate.normalizedPoint,
      mirrored
    );
    if (distance5 < bestDistance || distance5 === bestDistance && bestIndex !== null && candidate.pointIndex < (candidates[bestIndex]?.pointIndex ?? Number.POSITIVE_INFINITY)) {
      bestDistance = distance5;
      bestIndex = index;
    }
  }
  return bestIndex;
}
function nearestUnusedCandidateIndex(candidates, used, target) {
  let bestIndex = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    if (used.has(index)) {
      continue;
    }
    const candidate = candidates[index];
    if (candidate === void 0) {
      continue;
    }
    const distance5 = squaredDistance3(
      candidate.normalizedPoint,
      target
    );
    if (distance5 < bestDistance || distance5 === bestDistance && bestIndex !== null && candidate.pointIndex < (candidates[bestIndex]?.pointIndex ?? Number.POSITIVE_INFINITY)) {
      bestDistance = distance5;
      bestIndex = index;
    }
  }
  return bestIndex;
}
function selectBalancedExpansionTargets(weakPoints, viewport) {
  const candidates = createCalibrationExpansionCandidates(viewport);
  const used = /* @__PURE__ */ new Set();
  const selected = [];
  for (const weakPoint of weakPoints) {
    if (used.size >= candidates.length) {
      break;
    }
    const nearestIndex = nearestUnusedCandidateIndex(
      candidates,
      used,
      weakPoint.targetNormalizedPoint
    );
    if (nearestIndex === null) {
      break;
    }
    const nearest = candidates[nearestIndex];
    if (nearest === void 0) {
      continue;
    }
    used.add(nearestIndex);
    selected.push({
      sourcePrecisionPointIndex: nearest.pointIndex,
      sourceTarget: nearest,
      selectedForWeakPointIndex: weakPoint.pointIndex,
      symmetryPartner: false
    });
    if (used.size >= candidates.length) {
      break;
    }
    const partnerIndex = findSymmetryPartnerIndex(
      candidates,
      nearestIndex
    );
    if (partnerIndex !== null && !used.has(partnerIndex)) {
      const partner = candidates[partnerIndex];
      if (partner !== void 0) {
        used.add(partnerIndex);
        selected.push({
          sourcePrecisionPointIndex: partner.pointIndex,
          sourceTarget: partner,
          selectedForWeakPointIndex: weakPoint.pointIndex,
          symmetryPartner: true
        });
      }
    }
  }
  return selected.slice(
    0,
    CALIBRATION.PRECISION_POINT_COUNT - CALIBRATION.STANDARD_POINT_COUNT
  ).map((selection, selectionIndex) => ({
    sourcePrecisionPointIndex: selection.sourcePrecisionPointIndex,
    target: {
      pointIndex: CALIBRATION.STANDARD_POINT_COUNT + selectionIndex,
      normalizedPoint: {
        ...selection.sourceTarget.normalizedPoint
      },
      viewportPoint: {
        ...selection.sourceTarget.viewportPoint
      }
    },
    selectedForWeakPointIndex: selection.selectedForWeakPointIndex,
    symmetryPartner: selection.symmetryPartner
  }));
}
function planAdaptiveCalibrationExpansion(baselinePoints, sessionStrategy, viewport) {
  const selected = sessionStrategy.selectedCandidate;
  const acceptableMeanErrorPx = viewport.width * CALIBRATION_VALIDATION_THRESHOLDS.ACCEPTABLE_MAX_MEAN_ERROR_WIDTH_RATIO;
  const acceptableP95ErrorPx = Math.min(
    viewport.width * CALIBRATION_VALIDATION_THRESHOLDS.ACCEPTABLE_MAX_P95_ERROR_WIDTH_RATIO,
    CALIBRATION_VALIDATION_THRESHOLDS.ABSOLUTE_MAX_P95_ERROR_PX
  );
  const meanFailed = selected.meanErrorPx > acceptableMeanErrorPx;
  const p95Failed = selected.p95ErrorPx > acceptableP95ErrorPx;
  if (!meanFailed && !p95Failed) {
    return {
      expansionRequired: false,
      trigger: "NONE",
      provisionalSelectedStrategy: sessionStrategy.selectedStrategy,
      provisionalMeanErrorPx: selected.meanErrorPx,
      provisionalP95ErrorPx: selected.p95ErrorPx,
      acceptableMeanErrorPx,
      acceptableP95ErrorPx,
      weakPointThresholdPx: null,
      weakPoints: [],
      selectedTargets: [],
      additionalPointCount: 0,
      finalExpectedPointCount: CALIBRATION.STANDARD_POINT_COUNT
    };
  }
  let trigger = p95Failed ? "P95_ERROR" : "MEAN_ERROR";
  let weakPointThresholdPx = p95Failed ? acceptableP95ErrorPx : acceptableMeanErrorPx;
  let weakPoints = createWeakPoints(
    baselinePoints,
    sessionStrategy,
    weakPointThresholdPx
  );
  if (weakPoints.length === 0 && p95Failed && meanFailed) {
    trigger = "MEAN_ERROR";
    weakPointThresholdPx = acceptableMeanErrorPx;
    weakPoints = createWeakPoints(
      baselinePoints,
      sessionStrategy,
      weakPointThresholdPx
    );
  }
  if (weakPoints.length === 0) {
    return {
      expansionRequired: false,
      trigger,
      provisionalSelectedStrategy: sessionStrategy.selectedStrategy,
      provisionalMeanErrorPx: selected.meanErrorPx,
      provisionalP95ErrorPx: selected.p95ErrorPx,
      acceptableMeanErrorPx,
      acceptableP95ErrorPx,
      weakPointThresholdPx,
      weakPoints: [],
      selectedTargets: [],
      additionalPointCount: 0,
      finalExpectedPointCount: CALIBRATION.STANDARD_POINT_COUNT
    };
  }
  const selectedTargets = selectBalancedExpansionTargets(
    weakPoints,
    viewport
  );
  return {
    expansionRequired: selectedTargets.length > 0,
    trigger,
    provisionalSelectedStrategy: sessionStrategy.selectedStrategy,
    provisionalMeanErrorPx: selected.meanErrorPx,
    provisionalP95ErrorPx: selected.p95ErrorPx,
    acceptableMeanErrorPx,
    acceptableP95ErrorPx,
    weakPointThresholdPx,
    weakPoints,
    selectedTargets,
    additionalPointCount: selectedTargets.length,
    finalExpectedPointCount: CALIBRATION.STANDARD_POINT_COUNT + selectedTargets.length
  };
}

// src/gaze/sessionStrategyValidationGate.ts
function mean14(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function percentile12(values, probability) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a2, b2) => a2 - b2);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? sorted[0] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}
function rmse4(values) {
  return Math.sqrt(
    mean14(values.map((value) => value * value))
  );
}
function pointDelta(predicted, target) {
  return {
    x: predicted.x - target.x,
    y: predicted.y - target.y
  };
}
function deepValidSampleRatio(report) {
  const raw = report.pointResults.reduce(
    (total, point) => total + point.rawDeepSampleCount,
    0
  );
  const accepted = report.pointResults.reduce(
    (total, point) => total + point.acceptedDeepSampleCount,
    0
  );
  return raw > 0 ? accepted / raw : 0;
}
function deepMetrics(report) {
  const metrics = report.metrics;
  const rawErrors = report.pointResults.map(
    (point) => point.rawDeepErrorPx
  );
  const improvements = report.pointResults.map(
    (point) => point.rawDeepErrorPx - point.errorPx
  );
  return {
    viewportWidthPx: metrics.viewportWidthPx,
    viewportHeightPx: metrics.viewportHeightPx,
    rawMeanErrorPx: metrics.rawMeanErrorPx,
    rawP95ErrorPx: metrics.rawP95ErrorPx,
    rawRmsePx: rmse4(rawErrors),
    meanErrorPx: metrics.meanErrorPx,
    medianErrorPx: metrics.medianErrorPx,
    rmsePx: metrics.rmsePx,
    p90ErrorPx: metrics.p90ErrorPx,
    p95ErrorPx: metrics.p95ErrorPx,
    maxErrorPx: metrics.maxErrorPx,
    horizontalErrorPx: metrics.horizontalErrorPx,
    verticalErrorPx: metrics.verticalErrorPx,
    centerErrorPx: metrics.centerErrorPx,
    edgeErrorPx: metrics.edgeErrorPx,
    cornerErrorPx: metrics.cornerErrorPx,
    meanErrorViewportWidthRatio: metrics.meanErrorViewportWidthRatio,
    p95ErrorViewportWidthRatio: metrics.p95ErrorViewportWidthRatio,
    meanPrecisionPx: metrics.meanPrecisionPx,
    p95PrecisionPx: metrics.p95PrecisionPx,
    meanPrecisionViewportWidthRatio: metrics.meanPrecisionViewportWidthRatio,
    p95PrecisionViewportWidthRatio: metrics.p95PrecisionViewportWidthRatio,
    meanCorrectionImprovementPx: mean14(improvements),
    improvedPointCount: improvements.filter((value) => value > 0).length,
    degradedPointCount: improvements.filter((value) => value < 0).length,
    validSampleRatio: deepValidSampleRatio(report)
  };
}
function hybridMetrics(baseline, deep, hybrid) {
  const viewportWidth = baseline.metrics.viewportWidthPx;
  const viewportHeight = baseline.metrics.viewportHeightPx;
  const errors = hybrid.pointResults.map(
    (point) => point.selectedStrategyErrorPx
  );
  const deltas = hybrid.pointResults.map(
    (point) => pointDelta(
      point.selectedStrategyViewportPoint,
      point.targetViewportPoint
    )
  );
  const baselineByIndex = new Map(
    baseline.pointResults.map((point) => [point.pointIndex, point])
  );
  const deepByIndex = new Map(
    deep.pointResults.map((point) => [point.pointIndex, point])
  );
  const meanPrecisionProxies = [];
  const p95PrecisionProxies = [];
  for (const point of hybrid.pointResults) {
    const baselinePoint = baselineByIndex.get(point.pointIndex);
    const deepPoint = deepByIndex.get(point.pointIndex);
    if (baselinePoint === void 0 || deepPoint === void 0) {
      continue;
    }
    const baselineWeight = 1 - point.selectedStrategyDeepWeight;
    const baselineMeanPrecision = baselinePoint.meanPrecisionPx ?? 0;
    const baselineP95Precision = baselinePoint.p95PrecisionPx ?? baselineMeanPrecision;
    meanPrecisionProxies.push(
      baselineWeight * baselineMeanPrecision + point.selectedStrategyDeepWeight * deepPoint.meanPrecisionPx
    );
    p95PrecisionProxies.push(
      baselineWeight * baselineP95Precision + point.selectedStrategyDeepWeight * deepPoint.p95PrecisionPx
    );
  }
  const meanErrorPx = mean14(errors);
  const p95ErrorPx = percentile12(errors, 0.95);
  const meanPrecisionPx2 = mean14(meanPrecisionProxies);
  const p95PrecisionPx = percentile12(p95PrecisionProxies, 0.95);
  const deepValidRatio = deepValidSampleRatio(deep);
  return {
    viewportWidthPx: viewportWidth,
    viewportHeightPx: viewportHeight,
    rawMeanErrorPx: meanErrorPx,
    rawP95ErrorPx: p95ErrorPx,
    rawRmsePx: rmse4(errors),
    meanErrorPx,
    medianErrorPx: percentile12(errors, 0.5),
    rmsePx: rmse4(errors),
    p90ErrorPx: percentile12(errors, 0.9),
    p95ErrorPx,
    maxErrorPx: Math.max(...errors),
    horizontalErrorPx: mean14(
      deltas.map((delta) => Math.abs(delta.x))
    ),
    verticalErrorPx: mean14(
      deltas.map((delta) => Math.abs(delta.y))
    ),
    centerErrorPx: hybrid.metrics.centerErrorPx,
    edgeErrorPx: hybrid.metrics.edgeErrorPx,
    cornerErrorPx: hybrid.metrics.cornerErrorPx,
    meanErrorViewportWidthRatio: meanErrorPx / viewportWidth,
    p95ErrorViewportWidthRatio: p95ErrorPx / viewportWidth,
    meanPrecisionPx: meanPrecisionPx2,
    p95PrecisionPx,
    meanPrecisionViewportWidthRatio: meanPrecisionPx2 / viewportWidth,
    p95PrecisionViewportWidthRatio: p95PrecisionPx / viewportWidth,
    meanCorrectionImprovementPx: 0,
    improvedPointCount: 0,
    degradedPointCount: 0,
    validSampleRatio: Math.min(
      baseline.metrics.validSampleRatio,
      deepValidRatio
    )
  };
}
function makeResult(strategy, metrics) {
  return {
    strategy,
    metrics,
    quality: classifyCalibrationValidationQuality(metrics)
  };
}
function evaluateBaselineSessionStrategyValidation(baseline) {
  return makeResult(
    "BASELINE_ONLY",
    baseline.metrics
  );
}
function evaluateDeepSessionStrategyValidation(deep) {
  return makeResult(
    "DEEP_ONLY",
    deepMetrics(deep)
  );
}
function evaluateHybridSessionStrategyValidation(baseline, deep, hybrid) {
  return makeResult(
    "SAFE_ADAPTIVE_HYBRID",
    hybridMetrics(baseline, deep, hybrid)
  );
}
function evaluateSelectedSessionStrategyValidation(baseline, deep, hybrid) {
  const strategy = hybrid.metrics.selectedSessionStrategy;
  if (strategy === "BASELINE_ONLY") {
    return evaluateBaselineSessionStrategyValidation(baseline);
  }
  if (strategy === "DEEP_ONLY") {
    return evaluateDeepSessionStrategyValidation(deep);
  }
  return evaluateHybridSessionStrategyValidation(
    baseline,
    deep,
    hybrid
  );
}

// src/gaze/gazeFilter.ts
var DEFAULT_GAZE_FILTER_CONFIG = {
  minCutoffHz: GAZE_FILTER_DEFAULTS.ONE_EURO_MIN_CUTOFF_HZ,
  beta: GAZE_FILTER_DEFAULTS.ONE_EURO_BETA,
  derivativeCutoffHz: GAZE_FILTER_DEFAULTS.ONE_EURO_DERIVATIVE_CUTOFF_HZ,
  maxVisualHoldMs: GAZE_RUNTIME_DEFAULTS.MAX_VISUAL_HOLD_MS
};
function validateConfig2(config) {
  if (!Number.isFinite(config.minCutoffHz) || config.minCutoffHz <= 0 || !Number.isFinite(config.beta) || config.beta < 0 || !Number.isFinite(config.derivativeCutoffHz) || config.derivativeCutoffHz <= 0 || !Number.isFinite(config.maxVisualHoldMs) || config.maxVisualHoldMs < 0) {
    throw new RangeError(
      "GazeFilter received an invalid One-Euro configuration."
    );
  }
}
function isFinitePoint4(point) {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
}
function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}
function lowPassAlpha(cutoffHz, deltaSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 1;
  }
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / deltaSeconds);
}
function lowPass(previous, current, alpha) {
  return previous + alpha * (current - previous);
}
var GazeFilter = class {
  config;
  lastFilteredPoint = null;
  lastRawPoint = null;
  filteredDerivative = {
    x: 0,
    y: 0
  };
  lastValidTimestampMs = null;
  lastInputTimestampMs = null;
  constructor(config = DEFAULT_GAZE_FILTER_CONFIG) {
    validateConfig2(config);
    this.config = { ...config };
  }
  update(input) {
    if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
      this.reset();
      return this.createHiddenResult(input.timestampMs);
    }
    if (this.lastInputTimestampMs !== null && input.timestampMs < this.lastInputTimestampMs) {
      this.reset();
    }
    this.lastInputTimestampMs = input.timestampMs;
    if (input.gazeValid && isFinitePoint4(input.correctedViewportPoint)) {
      return this.handleValidPoint(
        input.timestampMs,
        input.correctedViewportPoint,
        input.smoothingMultiplier ?? 1
      );
    }
    return this.handleInvalidPoint(input.timestampMs);
  }
  reset() {
    this.lastFilteredPoint = null;
    this.lastRawPoint = null;
    this.filteredDerivative = {
      x: 0,
      y: 0
    };
    this.lastValidTimestampMs = null;
    this.lastInputTimestampMs = null;
  }
  getSnapshot() {
    return {
      initialized: this.lastFilteredPoint !== null,
      lastInputTimestampMs: this.lastInputTimestampMs,
      lastValidTimestampMs: this.lastValidTimestampMs,
      filteredViewportPoint: this.lastFilteredPoint === null ? null : clonePoint(this.lastFilteredPoint)
    };
  }
  handleValidPoint(timestampMs, correctedPoint2, smoothingMultiplier) {
    if (this.lastFilteredPoint === null || this.lastRawPoint === null || this.lastValidTimestampMs === null) {
      const initial = clonePoint(correctedPoint2);
      this.lastFilteredPoint = initial;
      this.lastRawPoint = clonePoint(correctedPoint2);
      this.lastValidTimestampMs = timestampMs;
      return this.createFilteredResult(
        timestampMs,
        initial
      );
    }
    const deltaSeconds = Math.max(
      1e-6,
      (timestampMs - this.lastValidTimestampMs) / 1e3
    );
    const rawDerivative = {
      x: (correctedPoint2.x - this.lastRawPoint.x) / deltaSeconds,
      y: (correctedPoint2.y - this.lastRawPoint.y) / deltaSeconds
    };
    const derivativeAlpha = lowPassAlpha(
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
    const speed = Math.hypot(
      this.filteredDerivative.x,
      this.filteredDerivative.y
    );
    const safeSmoothingMultiplier = Number.isFinite(smoothingMultiplier) && smoothingMultiplier >= 1 ? smoothingMultiplier : 1;
    const adaptiveCutoffHz = this.config.minCutoffHz / safeSmoothingMultiplier + this.config.beta * speed;
    const pointAlpha = lowPassAlpha(
      adaptiveCutoffHz,
      deltaSeconds
    );
    const filteredPoint = {
      x: lowPass(
        this.lastFilteredPoint.x,
        correctedPoint2.x,
        pointAlpha
      ),
      y: lowPass(
        this.lastFilteredPoint.y,
        correctedPoint2.y,
        pointAlpha
      )
    };
    this.lastRawPoint = clonePoint(correctedPoint2);
    this.lastFilteredPoint = filteredPoint;
    this.lastValidTimestampMs = timestampMs;
    return this.createFilteredResult(
      timestampMs,
      filteredPoint
    );
  }
  handleInvalidPoint(timestampMs) {
    if (this.lastFilteredPoint === null || this.lastValidTimestampMs === null) {
      return this.createHiddenResult(timestampMs);
    }
    const visualAgeMs = timestampMs - this.lastValidTimestampMs;
    if (visualAgeMs >= 0 && visualAgeMs <= this.config.maxVisualHoldMs) {
      return {
        timestampMs,
        filteredViewportPoint: clonePoint(this.lastFilteredPoint),
        mode: "HELD",
        currentSampleValid: false,
        sourceTimestampMs: this.lastValidTimestampMs,
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
  createFilteredResult(timestampMs, point) {
    return {
      timestampMs,
      filteredViewportPoint: clonePoint(point),
      mode: "FILTERED",
      currentSampleValid: true,
      sourceTimestampMs: timestampMs,
      visualAgeMs: 0
    };
  }
  createHiddenResult(timestampMs) {
    return {
      timestampMs,
      filteredViewportPoint: null,
      mode: "HIDDEN",
      currentSampleValid: false,
      sourceTimestampMs: null,
      visualAgeMs: null
    };
  }
};

// src/gaze/gazeOutlierRejector.ts
function distance4(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
var GazeOutlierRejector = class {
  lastAccepted = null;
  pending = null;
  lastTimestampMs = null;
  update(timestampMs, point, valid) {
    if (!valid || point === null || !Number.isFinite(timestampMs) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      this.pending = null;
      return {
        point: null,
        accepted: false,
        heldForConfirmation: false,
        isolatedSpikeRejected: false
      };
    }
    if (this.lastTimestampMs !== null && timestampMs <= this.lastTimestampMs) {
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
      const confirmsJump = pendingAgeMs <= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_MAX_CONFIRM_MS && distance4(point, pending.point) <= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_CONFIRM_RADIUS_PX;
      const returnedToPrevious = distance4(point, this.lastAccepted) <= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_RETURN_RADIUS_PX;
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
    if (distance4(point, this.lastAccepted) >= GAZE_FILTER_DEFAULTS.RUNTIME_OUTLIER_JUMP_PX) {
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
  reset() {
    this.lastAccepted = null;
    this.pending = null;
    this.lastTimestampMs = null;
  }
};

// src/gaze/authoritativeGazeStabilizer.ts
function isFinitePositiveViewport(viewport) {
  return viewport !== null && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;
}
function isFinitePoint5(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function copyPoint2(point) {
  return {
    x: point.x,
    y: point.y
  };
}
function toViewportPoint3(normalizedPoint, viewport) {
  return {
    x: normalizedPoint.x * viewport.width,
    y: normalizedPoint.y * viewport.height
  };
}
function toNormalizedPoint(viewportPoint, viewport) {
  return {
    x: viewportPoint.x / viewport.width,
    y: viewportPoint.y / viewport.height
  };
}
function speedPxPerSecond(previous, current, deltaTimeMs) {
  if (!Number.isFinite(deltaTimeMs) || deltaTimeMs <= 0) {
    return null;
  }
  return Math.hypot(
    current.x - previous.x,
    current.y - previous.y
  ) / (deltaTimeMs / 1e3);
}
var AuthoritativeGazeStabilizer = class {
  filter = new GazeFilter();
  outlierRejector = new GazeOutlierRejector();
  previousValidSample = null;
  lastInputTimestampMs = null;
  lastViewport = null;
  update(input) {
    const rawNormalizedPoint = copyPoint2(input.normalizedPoint);
    if (!isFinitePositiveViewport(input.viewport) || !isFinitePoint5(input.normalizedPoint) || !Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
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
    const gapMs = this.lastInputTimestampMs === null ? null : input.timestampMs - this.lastInputTimestampMs;
    if (gapMs !== null && (gapMs <= 0 || gapMs > GAZE_RUNTIME_DEFAULTS.MAX_VISUAL_HOLD_MS) || this.lastViewport !== null && (viewport.width !== this.lastViewport.width || viewport.height !== this.lastViewport.height)) {
      this.reset();
    }
    this.lastInputTimestampMs = input.timestampMs;
    this.lastViewport = { ...viewport };
    const rawViewportPoint = toViewportPoint3(
      input.normalizedPoint,
      viewport
    );
    const outlierDecision = this.outlierRejector.update(
      input.timestampMs,
      rawViewportPoint,
      input.gazeValid
    );
    const filtered = this.filter.update({
      timestampMs: input.timestampMs,
      correctedViewportPoint: outlierDecision.point,
      gazeValid: input.gazeValid && outlierDecision.accepted,
      smoothingMultiplier: input.smoothingMultiplier ?? 1
    });
    const stabilizedViewportPoint = filtered.filteredViewportPoint === null ? null : copyPoint2(
      filtered.filteredViewportPoint
    );
    const stabilizedNormalizedPoint = stabilizedViewportPoint === null ? null : toNormalizedPoint(
      stabilizedViewportPoint,
      viewport
    );
    let deltaTimeMs = null;
    let rawSpeed = null;
    let stabilizedSpeed = null;
    if (filtered.currentSampleValid && stabilizedViewportPoint !== null) {
      const previous = this.previousValidSample;
      if (previous !== null) {
        deltaTimeMs = input.timestampMs - previous.timestampMs;
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
        rawViewportPoint: copyPoint2(rawViewportPoint),
        stabilizedViewportPoint: copyPoint2(stabilizedViewportPoint)
      };
    } else if (filtered.mode === "HIDDEN") {
      this.outlierRejector.reset();
      this.previousValidSample = null;
    }
    return {
      timestampMs: input.timestampMs,
      mode: filtered.mode,
      rawNormalizedPoint,
      rawViewportPoint: copyPoint2(rawViewportPoint),
      stabilizedNormalizedPoint,
      stabilizedViewportPoint,
      viewportSize: { ...viewport },
      currentSampleValid: filtered.currentSampleValid,
      sourceTimestampMs: filtered.sourceTimestampMs,
      visualAgeMs: filtered.visualAgeMs,
      deltaTimeMs,
      rawSpeedPxPerSecond: rawSpeed,
      stabilizedSpeedPxPerSecond: stabilizedSpeed
    };
  }
  reset() {
    this.lastInputTimestampMs = null;
    this.lastViewport = null;
    this.filter.reset();
    this.outlierRejector.reset();
    this.previousValidSample = null;
  }
};

// src/gaze/fixationDetector.ts
var VELOCITY_THRESHOLD_PX_PER_SECOND = FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX / (FIXATION_DEFAULTS.MIN_DURATION_MS / 1e3);
function isFinitePoint6(point) {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
}
function clamp016(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
function copyPoint3(point) {
  return {
    x: point.x,
    y: point.y
  };
}
function resolveSpeed(suppliedSpeedPxPerSecond, previousSample, timestampMs, point) {
  if (suppliedSpeedPxPerSecond !== null && Number.isFinite(suppliedSpeedPxPerSecond) && suppliedSpeedPxPerSecond >= 0) {
    return suppliedSpeedPxPerSecond;
  }
  if (previousSample === null) {
    return 0;
  }
  const deltaTimeMs = timestampMs - previousSample.timestampMs;
  if (!Number.isFinite(deltaTimeMs) || deltaTimeMs <= 0) {
    return 0;
  }
  return Math.hypot(
    point.x - previousSample.viewportPoint.x,
    point.y - previousSample.viewportPoint.y
  ) / (deltaTimeMs / 1e3);
}
function calculateMetrics(samples) {
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
    dispersionPx: Math.hypot(dispersionX, dispersionY),
    qualityMean: qualitySum / samples.length,
    peakSpeedPxPerSecond: peakSpeed
  };
}
var FixationDetector = class {
  samples = [];
  activeFixationId = null;
  lastValidTimestampMs = null;
  lastInputTimestampMs = null;
  lastStrategy = null;
  update(input) {
    if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
      this.reset();
      return this.createResult(
        input.timestampMs,
        "IDLE",
        null,
        false
      );
    }
    if (this.lastInputTimestampMs !== null && input.timestampMs < this.lastInputTimestampMs) {
      this.reset();
    }
    this.lastInputTimestampMs = input.timestampMs;
    if (!input.currentSampleValid || !isFinitePoint6(input.stabilizedViewportPoint)) {
      return this.handleInvalidSample(input.timestampMs);
    }
    const strategyTransition = this.lastStrategy !== null && input.authoritativeStrategy !== this.lastStrategy;
    this.lastStrategy = input.authoritativeStrategy;
    if (strategyTransition) {
      const completed = this.closeIfGapExceeded(input.timestampMs);
      return this.createResult(
        input.timestampMs,
        completed === null ? "TRANSITION_GUARD" : "IDLE",
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
  flush() {
    const completed = this.finalizeConfirmedFixation();
    this.clearCandidate();
    return completed;
  }
  reset() {
    this.samples = [];
    this.activeFixationId = null;
    this.lastValidTimestampMs = null;
    this.lastInputTimestampMs = null;
    this.lastStrategy = null;
  }
  handleValidSample(input) {
    const point = input.stabilizedViewportPoint;
    if (!isFinitePoint6(point)) {
      return this.handleInvalidSample(input.timestampMs);
    }
    let completedFixation = null;
    if (this.lastValidTimestampMs !== null && input.timestampMs - this.lastValidTimestampMs > FIXATION_DEFAULTS.MAX_SAMPLE_GAP_MS) {
      completedFixation = this.finalizeConfirmedFixation();
      this.clearCandidate();
    }
    const previousSample = this.samples.length === 0 ? null : this.samples[this.samples.length - 1] ?? null;
    const speedPxPerSecond2 = resolveSpeed(
      input.stabilizedSpeedPxPerSecond,
      previousSample,
      input.timestampMs,
      point
    );
    const currentSample = {
      timestampMs: input.timestampMs,
      viewportPoint: copyPoint3(point),
      qualityScore: clamp016(input.qualityScore),
      speedPxPerSecond: speedPxPerSecond2
    };
    if (previousSample !== null && speedPxPerSecond2 > VELOCITY_THRESHOLD_PX_PER_SECOND) {
      const velocityCompleted = this.finalizeConfirmedFixation();
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
      const metrics = calculateMetrics(this.samples);
      if (metrics !== null && metrics.dispersionPx > FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX) {
        this.samples.pop();
        const dispersionCompleted = this.finalizeConfirmedFixation();
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
      this.activeFixationId === null ? "CANDIDATE" : "FIXATING",
      completedFixation,
      false
    );
  }
  handleInvalidSample(timestampMs) {
    const completed = this.closeIfGapExceeded(timestampMs);
    return this.createResult(
      timestampMs,
      completed !== null ? "IDLE" : this.samples.length > 0 ? "GAP_HOLD" : "IDLE",
      completed,
      false
    );
  }
  closeIfGapExceeded(timestampMs) {
    if (this.lastValidTimestampMs === null || timestampMs - this.lastValidTimestampMs <= FIXATION_DEFAULTS.MAX_SAMPLE_GAP_MS) {
      return null;
    }
    const completed = this.finalizeConfirmedFixation();
    this.clearCandidate();
    return completed;
  }
  trimCandidateToDispersion() {
    let metrics = calculateMetrics(this.samples);
    while (this.samples.length > 1 && metrics !== null && metrics.dispersionPx > FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX) {
      this.samples.shift();
      metrics = calculateMetrics(this.samples);
    }
  }
  promoteCandidateIfReady() {
    if (this.activeFixationId !== null || this.samples.length < FIXATION_DEFAULTS.MIN_SAMPLE_COUNT) {
      return;
    }
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const metrics = calculateMetrics(this.samples);
    if (first === void 0 || last === void 0 || metrics === null) {
      return;
    }
    const durationMs = last.timestampMs - first.timestampMs;
    if (durationMs >= FIXATION_DEFAULTS.MIN_DURATION_MS && metrics.dispersionPx <= FIXATION_DEFAULTS.DISPERSION_THRESHOLD_PX) {
      this.activeFixationId = createFixationId();
    }
  }
  finalizeConfirmedFixation() {
    if (this.activeFixationId === null) {
      return null;
    }
    const snapshot = this.buildFixation(this.activeFixationId);
    return snapshot;
  }
  buildActiveFixation() {
    if (this.activeFixationId === null) {
      return null;
    }
    return this.buildFixation(this.activeFixationId);
  }
  buildFixation(fixationId) {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const metrics = calculateMetrics(this.samples);
    if (first === void 0 || last === void 0 || metrics === null) {
      return null;
    }
    return {
      fixationId,
      startTimeMs: first.timestampMs,
      endTimeMs: last.timestampMs,
      durationMs: last.timestampMs - first.timestampMs,
      centroidViewportPoint: copyPoint3(metrics.centroid),
      dispersionX: metrics.dispersionX,
      dispersionY: metrics.dispersionY,
      dispersionPx: metrics.dispersionPx,
      sampleCount: this.samples.length,
      qualityMean: metrics.qualityMean,
      peakSpeedPxPerSecond: metrics.peakSpeedPxPerSecond
    };
  }
  candidateDurationMs() {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (first === void 0 || last === void 0) {
      return 0;
    }
    return Math.max(
      0,
      last.timestampMs - first.timestampMs
    );
  }
  createResult(timestampMs, state, completedFixation, strategyTransitionGuardApplied) {
    return {
      timestampMs,
      state,
      activeFixation: this.buildActiveFixation(),
      completedFixation,
      candidateDurationMs: this.candidateDurationMs(),
      candidateSampleCount: this.samples.length,
      strategyTransitionGuardApplied,
      velocityThresholdPxPerSecond: VELOCITY_THRESHOLD_PX_PER_SECOND
    };
  }
  clearCandidate() {
    this.samples = [];
    this.activeFixationId = null;
    this.lastValidTimestampMs = null;
  }
};

// src/gaze/residualCorrector.ts
var ResidualCorrector = class {
  model = new CalibrationModel();
  setModel(model) {
    this.model.setModel(model);
  }
  clear() {
    this.model.clear();
  }
  hasModel() {
    return this.model.getModel() !== null;
  }
  correct(rawPoint, rawSpace, viewport) {
    if (rawSpace !== "NORMALIZED") {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Residual correction currently requires NORMALIZED raw gaze input.",
        {
          details: {
            rawSpace
          }
        }
      );
    }
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Residual correction requires positive finite viewport dimensions."
      );
    }
    const correctedNormalizedPoint = this.model.predict(rawPoint);
    const rawViewportPoint = {
      x: rawPoint.x * viewport.width,
      y: rawPoint.y * viewport.height
    };
    const correctedViewportPoint = {
      x: correctedNormalizedPoint.x * viewport.width,
      y: correctedNormalizedPoint.y * viewport.height
    };
    return {
      rawPoint,
      rawSpace: "NORMALIZED",
      correctedNormalizedPoint,
      correctedViewportPoint,
      correction: {
        viewportOffsetXPx: correctedViewportPoint.x - rawViewportPoint.x,
        viewportOffsetYPx: correctedViewportPoint.y - rawViewportPoint.y
      },
      insideViewport: correctedViewportPoint.x >= 0 && correctedViewportPoint.x <= viewport.width && correctedViewportPoint.y >= 0 && correctedViewportPoint.y <= viewport.height
    };
  }
};

// src/gaze/gazeQuality.ts
function timestampsMatch(predictionTimestampMs, faceTimestampMs) {
  return Number.isFinite(predictionTimestampMs) && Number.isFinite(faceTimestampMs) && Math.abs(
    predictionTimestampMs - faceTimestampMs
  ) <= GAZE_VALIDATION_DEFAULTS.TIMESTAMP_TOLERANCE_MS;
}
function classifyQualityLevel2(score, structurallyValid) {
  if (!structurallyValid || !Number.isFinite(score) || score < GAZE_QUALITY_THRESHOLDS.MIN_VALID) {
    return "INVALID";
  }
  if (score >= GAZE_QUALITY_THRESHOLDS.GOOD) {
    return "GOOD";
  }
  if (score >= GAZE_QUALITY_THRESHOLDS.FAIR) {
    return "FAIR";
  }
  if (score >= GAZE_QUALITY_THRESHOLDS.POOR) {
    return "POOR";
  }
  return "INVALID";
}
function calculateWeightedScore(engineConfidence, facePipelineQuality) {
  if (!Number.isFinite(engineConfidence) || !Number.isFinite(facePipelineQuality)) {
    return 0;
  }
  const score = clamp01(engineConfidence) * GAZE_QUALITY_RUNTIME.ENGINE_CONFIDENCE_WEIGHT + clamp01(facePipelineQuality) * GAZE_QUALITY_RUNTIME.FACE_PIPELINE_WEIGHT;
  return clamp01(score);
}
function evaluateGazeQuality(input) {
  const {
    prediction,
    validation,
    faceQuality
  } = input;
  const trackingQuality = faceQuality.trackingQuality;
  const issues = [];
  if (!validation.valid) {
    issues.push({
      code: "VALIDATION_INVALID",
      fatal: true
    });
  }
  if (!faceQuality.usableForGaze) {
    issues.push({
      code: "FACE_PIPELINE_UNUSABLE",
      fatal: true
    });
  }
  if (trackingQuality.qualityLevel === "INVALID") {
    issues.push({
      code: "FACE_PIPELINE_INVALID",
      fatal: true
    });
  }
  if (trackingQuality.blink) {
    issues.push({
      code: "BLINK_IN_PROGRESS",
      fatal: true
    });
  }
  if (!timestampsMatch(
    prediction.timestampMs,
    faceQuality.timestampMs
  )) {
    issues.push({
      code: "FRAME_TIMESTAMP_MISMATCH",
      fatal: true
    });
  }
  if (prediction.faceValid !== trackingQuality.faceValid) {
    issues.push({
      code: "FACE_VALIDITY_MISMATCH",
      fatal: true
    });
  }
  if (prediction.eyesValid !== trackingQuality.eyesValid) {
    issues.push({
      code: "EYE_VALIDITY_MISMATCH",
      fatal: true
    });
  }
  if (!Number.isFinite(prediction.confidence)) {
    issues.push({
      code: "ENGINE_CONFIDENCE_NON_FINITE",
      fatal: true
    });
  }
  if (!Number.isFinite(
    trackingQuality.qualityScore
  )) {
    issues.push({
      code: "FACE_QUALITY_NON_FINITE",
      fatal: true
    });
  }
  const score = calculateWeightedScore(
    prediction.confidence,
    trackingQuality.qualityScore
  );
  if (!Number.isFinite(score)) {
    issues.push({
      code: "QUALITY_SCORE_NON_FINITE",
      fatal: true
    });
  }
  if (score < GAZE_QUALITY_THRESHOLDS.MIN_VALID) {
    issues.push({
      code: "QUALITY_SCORE_TOO_LOW",
      fatal: true
    });
  }
  const structurallyValid = !issues.some(
    (issue) => issue.fatal
  );
  const level = classifyQualityLevel2(
    score,
    structurallyValid
  );
  return {
    timestampMs: prediction.timestampMs,
    valid: structurallyValid && level !== "INVALID",
    score,
    level,
    components: {
      engineConfidence: Number.isFinite(
        prediction.confidence
      ) ? clamp01(prediction.confidence) : 0,
      facePipelineQuality: Number.isFinite(
        trackingQuality.qualityScore
      ) ? clamp01(
        trackingQuality.qualityScore
      ) : 0,
      faceConfidence: Number.isFinite(
        trackingQuality.faceConfidence
      ) ? clamp01(
        trackingQuality.faceConfidence
      ) : 0,
      eyeConfidence: Number.isFinite(
        trackingQuality.eyeConfidence
      ) ? clamp01(
        trackingQuality.eyeConfidence
      ) : 0
    },
    issues
  };
}

// src/gaze/gazeValidator.ts
var SUPPORTED_COORDINATE_SPACES = /* @__PURE__ */ new Set([
  "MODEL",
  "NORMALIZED",
  "VIEWPORT",
  "DOCUMENT",
  "SCREEN"
]);
function isFinitePoint7(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function isFiniteHeadPose(prediction) {
  return Number.isFinite(prediction.headPose.yawDeg) && Number.isFinite(prediction.headPose.pitchDeg) && Number.isFinite(prediction.headPose.rollDeg);
}
function isRuntimeCoordinateSpace(value) {
  return typeof value === "string" && SUPPORTED_COORDINATE_SPACES.has(
    value
  );
}
function normalizedPointInsideViewport(point) {
  return point.x >= NORMALIZED_COORDINATE.MIN && point.x <= NORMALIZED_COORDINATE.MAX && point.y >= NORMALIZED_COORDINATE.MIN && point.y <= NORMALIZED_COORDINATE.MAX;
}
function normalizedPointPlausible(point) {
  const minimum = NORMALIZED_COORDINATE.MIN - GAZE_VALIDATION_DEFAULTS.NORMALIZED_OVERSCAN_MARGIN;
  const maximum = NORMALIZED_COORDINATE.MAX + GAZE_VALIDATION_DEFAULTS.NORMALIZED_OVERSCAN_MARGIN;
  return point.x >= minimum && point.x <= maximum && point.y >= minimum && point.y <= maximum;
}
function timestampsMatch2(actual, expected) {
  return Math.abs(actual - expected) <= GAZE_VALIDATION_DEFAULTS.TIMESTAMP_TOLERANCE_MS;
}
function validateGazePrediction(prediction, context = {}) {
  const issues = [];
  if (!Number.isFinite(prediction.timestampMs)) {
    issues.push({
      code: "TIMESTAMP_NON_FINITE",
      fatal: true
    });
  } else {
    if (prediction.timestampMs < 0) {
      issues.push({
        code: "TIMESTAMP_NEGATIVE",
        fatal: true
      });
    }
    if (context.expectedTimestampMs !== void 0 && Number.isFinite(
      context.expectedTimestampMs
    ) && !timestampsMatch2(
      prediction.timestampMs,
      context.expectedTimestampMs
    )) {
      issues.push({
        code: "TIMESTAMP_MISMATCH",
        fatal: true
      });
    }
  }
  const finiteRawPoint = isFinitePoint7(prediction.rawPoint);
  if (!finiteRawPoint) {
    issues.push({
      code: "RAW_POINT_NON_FINITE",
      fatal: true
    });
  }
  const rawSpaceValid = isRuntimeCoordinateSpace(
    prediction.rawSpace
  );
  if (!rawSpaceValid) {
    issues.push({
      code: "RAW_SPACE_UNSUPPORTED",
      fatal: true
    });
  }
  let insideNormalizedViewport = null;
  if (finiteRawPoint && rawSpaceValid && prediction.rawSpace === "NORMALIZED") {
    insideNormalizedViewport = normalizedPointInsideViewport(
      prediction.rawPoint
    );
    if (!insideNormalizedViewport) {
      issues.push({
        code: "NORMALIZED_OUTSIDE_VIEWPORT",
        fatal: false
      });
    }
    if (!normalizedPointPlausible(
      prediction.rawPoint
    )) {
      issues.push({
        code: "NORMALIZED_IMPLAUSIBLE",
        fatal: true
      });
    }
  }
  if (!Number.isFinite(prediction.confidence)) {
    issues.push({
      code: "CONFIDENCE_NON_FINITE",
      fatal: true
    });
  } else if (prediction.confidence < 0 || prediction.confidence > 1) {
    issues.push({
      code: "CONFIDENCE_OUT_OF_RANGE",
      fatal: true
    });
  } else if (prediction.confidence < GAZE_QUALITY_THRESHOLDS.MIN_VALID) {
    issues.push({
      code: "CONFIDENCE_TOO_LOW",
      fatal: true
    });
  }
  if (!prediction.faceValid) {
    issues.push({
      code: "FACE_INVALID",
      fatal: true
    });
  }
  if (!prediction.eyesValid) {
    issues.push({
      code: "EYES_INVALID",
      fatal: true
    });
  }
  if (!isFiniteHeadPose(prediction)) {
    issues.push({
      code: "HEAD_POSE_NON_FINITE",
      fatal: true
    });
  }
  return {
    valid: !issues.some(
      (issue) => issue.fatal
    ),
    insideNormalizedViewport,
    issues
  };
}

// src/offscreen/trackerRuntime.ts
var logger11 = createLogger("OFFSCREEN");
var TrackerRuntime = class {
  constructor(videoElement, onRuntimeError = null, onFaceQualityFrame = null, onGazeRuntimeFrame = null) {
    this.videoElement = videoElement;
    this.onRuntimeError = onRuntimeError;
    this.onFaceQualityFrame = onFaceQualityFrame;
    this.onGazeRuntimeFrame = onGazeRuntimeFrame;
  }
  videoElement;
  onRuntimeError;
  onFaceQualityFrame;
  onGazeRuntimeFrame;
  lifecycle = "CREATED";
  initializedAtEpochMs = null;
  disposedAtEpochMs = null;
  cameraManager = null;
  frameCapture = null;
  cameraQualityEstimator = null;
  faceLandmarker = null;
  faceGeometryAnalyzer = null;
  headPoseEstimator = null;
  eyeGeometryAnalyzer = null;
  blinkDetector = null;
  faceQualityEvaluator = null;
  preCalibrationMonitor = null;
  calibrationManager = null;
  residualCorrector = null;
  validationManager = null;
  deepPersonalMapper = null;
  deepIndependentValidator = null;
  calibrationHybridSelector = null;
  activeDeepCalibrationSamples = [];
  activeDeepValidationSamples = [];
  deepPersonalPredictionCount = 0;
  latestPersonalizedDeepRuntimeCandidate = null;
  runtimeBaselineHistory = /* @__PURE__ */ new Map();
  authoritativeSessionValidationReady = false;
  /**
   * POOR validation may continue in explicitly degraded collection mode after
   * the UI warns that recalibration is recommended. This flag never changes
   * the validation quality itself and is reset on every new calibration.
   */
  authoritativeSessionDegradedCollectionAllowed = false;
  selectedStrategyValidationResult = null;
  /**
   * V6: Deep/Hybrid may remain available for shadow diagnostics while being
   * ineligible for authoritative session routing on slow/sparse devices.
   */
  deepSessionStrategyEligible = false;
  /**
   * Safety-only demotion. Independent validation may force an already-fitted
   * Deep/Hybrid strategy back to Baseline, but never promotes or retunes it.
   */
  forceBaselineSessionStrategy = false;
  /** Validation targets must never feed the runtime drift maintenance gate. */
  independentValidationActive = false;
  driftMonitorResumeAfterTimestampMs = 0;
  adaptiveCalibrationExpansionEvaluated = false;
  authoritativeGazeStabilizer = new AuthoritativeGazeStabilizer();
  runtimeDeepFeatureAggregator = new RuntimeDeepFeatureAggregator();
  baselinePrecisionEstimator = new RuntimeGazePrecisionEstimator({
    windowMs: DEEP_PERSONALIZATION.BASELINE_PRECISION_WINDOW_MS,
    minSamples: DEEP_PERSONALIZATION.BASELINE_PRECISION_MIN_SAMPLES,
    maxFixationSpeedPxPerSecond: DEEP_PERSONALIZATION.PRECISION_MAX_FIXATION_SPEED_PX_PER_SECOND
  });
  deepPrecisionEstimator = new RuntimeGazePrecisionEstimator({
    windowMs: DEEP_PERSONALIZATION.DEEP_PRECISION_WINDOW_MS,
    minSamples: DEEP_PERSONALIZATION.DEEP_PRECISION_MIN_SAMPLES,
    maxFixationSpeedPxPerSecond: DEEP_PERSONALIZATION.PRECISION_MAX_FIXATION_SPEED_PX_PER_SECOND
  });
  runtimeGazeDriftMonitor = new RuntimeGazeDriftMonitor();
  latestBaselinePrecisionPx = null;
  latestDeepPrecisionPx = null;
  lastLoggedRuntimeDriftSeverity = null;
  quickRecalibrationActive = false;
  quickRecalibrationCheckpoint = null;
  quickRecalibrationRunSequence = 0;
  quickRecalibrationRunId = null;
  completedQuickValidationResult = null;
  quickRecalibrationTimeoutId = null;
  /**
   * User preference. Drift/precision diagnostics keep running when disabled,
   * but automatic maintenance must not interrupt or suspend collection.
   */
  automaticQuickRecalibrationEnabled = QUICK_RECALIBRATION.DEFAULT_ENABLED;
  fixationDetector = new FixationDetector();
  /**
   * Current research-page CSS viewport. Validation initializes this value and
   * Content keeps it synchronized afterwards because browser zoom/DPR may
   * change between hosts or tabs.
   */
  trackingViewportSize = null;
  activeCalibrationPointRequest = null;
  activeValidationPointRequest = null;
  latestPreCalibrationFeedback = null;
  faceBaseline = null;
  gazePredictor = null;
  gazeContextGeneration = 0;
  gazePredictionInFlight = false;
  latestGazeFrame = null;
  faceAnalysisRunning = false;
  faceFrameTimerId = null;
  faceFrameIntervalMs = 1e3 / FACE_PIPELINE_RUNTIME.TARGET_ANALYSIS_RATE_HZ;
  faceAnalysisGeneration = 0;
  startFacePositioningPromise = null;
  latestCameraQuality = null;
  latestFaceQuality = null;
  lastReportedFaceErrorAtMs = null;
  lastReportedFaceErrorCode = null;
  /* ========================================================================
   * Initialization
   * ====================================================================== */
  /**
   * Initializes the Offscreen runtime shell.
   *
   * Camera permission is NOT requested here. The camera starts only after an
   * explicit START_CAMERA command routed through the background context.
   * MediaPipe assets are also loaded lazily when face positioning starts.
   */
  initialize() {
    if (this.lifecycle === "READY") {
      return;
    }
    if (this.lifecycle === "INITIALIZING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "OFFSCREEN",
        "Tracker runtime is already initializing."
      );
    }
    if (this.lifecycle === "DISPOSING" || this.lifecycle === "DISPOSED") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "OFFSCREEN",
        "Disposed tracker runtime cannot be initialized."
      );
    }
    this.lifecycle = "INITIALIZING";
    try {
      this.configureVideoElement();
      this.cameraManager = new CameraManager(
        this.videoElement,
        (error) => {
          this.handleRuntimeError(
            error
          );
        }
      );
      this.frameCapture = new FrameCapture(
        this.videoElement
      );
      this.cameraQualityEstimator = null;
      this.faceLandmarker = new FaceLandmarker();
      this.faceGeometryAnalyzer = new FaceGeometryAnalyzer();
      this.headPoseEstimator = new HeadPoseEstimator();
      this.eyeGeometryAnalyzer = new EyeGeometryAnalyzer();
      this.blinkDetector = new BlinkDetector();
      this.faceQualityEvaluator = new FaceQualityEvaluator();
      this.preCalibrationMonitor = new PreCalibrationMonitor();
      this.calibrationManager = new CalibrationManager();
      this.residualCorrector = new ResidualCorrector();
      this.validationManager = new ValidationManager();
      this.deepPersonalMapper = new DeepPersonalMapper();
      this.deepIndependentValidator = new DeepIndependentValidator();
      this.calibrationHybridSelector = new CalibrationHybridSelector();
      this.gazePredictor = new GazePredictor();
      this.gazePredictor.setObserverSampleListener(
        (sample) => {
          this.observeDeepObserverSample(
            sample
          );
        }
      );
      this.initializedAtEpochMs = nowEpochMs();
      this.disposedAtEpochMs = null;
      this.lifecycle = "READY";
      logger11.info(
        "Offscreen tracker runtime initialized."
      );
    } catch (error) {
      this.disposeModulesAfterFailedInitialization();
      this.lifecycle = "ERROR";
      if (error instanceof TrackerError) {
        throw error;
      }
      throw new TrackerError(
        ERROR_CODES.UNKNOWN,
        "OFFSCREEN",
        "Offscreen tracker runtime initialization failed.",
        {
          cause: error
        }
      );
    }
  }
  /* ========================================================================
   * Camera
   * ====================================================================== */
  async startCamera(request) {
    this.assertUsable();
    const cameraManager = this.getCameraManagerOrThrow();
    this.stopFaceAnalysis();
    try {
      const settings = await cameraManager.start(
        request
      );
      this.frameCapture?.reset();
      this.cameraQualityEstimator?.reset();
      return settings;
    } catch (error) {
      throw normalizeTrackerError(
        error,
        ERROR_CODES.CAMERA_START_FAILED,
        "CAMERA",
        "Offscreen camera startup failed."
      );
    }
  }
  stopCamera() {
    this.assertUsable();
    this.stopFaceAnalysis();
    this.getCameraManagerOrThrow().stop();
    this.frameCapture?.reset();
    this.cameraQualityEstimator?.reset();
  }
  /**
   * Future Face/Gaze stages consume this scheduler instead of creating their
   * own camera frame source.
   */
  getFrameCapture() {
    this.assertUsable();
    if (this.frameCapture === null) {
      throw new TrackerError(
        ERROR_CODES.CAMERA_FRAME_UNAVAILABLE,
        "CAMERA",
        "Camera frame capture is unavailable."
      );
    }
    return this.frameCapture;
  }
  /**
   * Future pre-calibration logic can evaluate lighting/blur/FPS through this
   * single estimator.
   */
  getCameraQualityEstimator() {
    this.assertUsable();
    if (this.cameraQualityEstimator === null) {
      try {
        this.cameraQualityEstimator = new CameraQualityEstimator();
      } catch (error) {
        throw normalizeTrackerError(
          error,
          ERROR_CODES.CAMERA_QUALITY_FAILED,
          "CAMERA",
          "Camera quality estimator could not be initialized lazily.",
          { recoverable: true }
        );
      }
    }
    return this.cameraQualityEstimator;
  }
  /* ========================================================================
   * Face pipeline
   * ====================================================================== */
  /**
   * Lazily loads the local MediaPipe model, processes one current frame, and
   * then starts the continuous face-analysis loop.
   *
   * Returning the first quality result gives the Offscreen message layer a
   * typed FACE_POSITION_STATUS acknowledgement without inventing a second
   * model-ready message type.
   */
  startFacePositioning() {
    this.assertUsable();
    this.assertCameraRunning();
    if (this.faceAnalysisRunning && this.latestFaceQuality !== null) {
      return Promise.resolve(
        this.latestFaceQuality
      );
    }
    if (this.startFacePositioningPromise !== null) {
      return this.startFacePositioningPromise;
    }
    const generation = this.beginFaceAnalysisGeneration();
    const startup = this.startFacePositioningInternal(
      generation
    ).finally(
      () => {
        if (this.startFacePositioningPromise === startup) {
          this.startFacePositioningPromise = null;
        }
      }
    );
    this.startFacePositioningPromise = startup;
    return startup;
  }
  getLatestFaceQuality() {
    return this.latestFaceQuality;
  }
  getLatestPreCalibrationFeedback() {
    const feedback = this.latestPreCalibrationFeedback;
    if (feedback === null) {
      return null;
    }
    return {
      ...feedback,
      status: {
        ...feedback.status
      },
      cameraFaceBoxNormalized: feedback.cameraFaceBoxNormalized === null ? null : {
        ...feedback.cameraFaceBoxNormalized
      },
      metrics: {
        ...feedback.metrics
      }
    };
  }
  getFaceBaseline() {
    const baseline = this.faceBaseline;
    if (baseline === null) {
      return null;
    }
    return {
      ...baseline,
      headPose: {
        ...baseline.headPose
      }
    };
  }
  /* ========================================================================
   * Calibration runtime
   * ====================================================================== */
  startCalibration(calibrationId, mode) {
    this.assertUsable();
    this.assertCameraRunning();
    if (!this.faceAnalysisRunning || this.faceBaseline === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration requires a completed pre-calibration face baseline."
      );
    }
    if (this.gazePredictor === null || this.gazePredictor.getSnapshot().lifecycle !== "READY") {
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "CALIBRATION",
        "Calibration requires a ready gaze predictor."
      );
    }
    this.quickRecalibrationCheckpoint = null;
    this.quickRecalibrationRunId = null;
    this.quickRecalibrationActive = false;
    if (this.quickRecalibrationTimeoutId !== null) {
      window.clearTimeout(this.quickRecalibrationTimeoutId);
      this.quickRecalibrationTimeoutId = null;
    }
    this.completedQuickValidationResult = null;
    this.cancelActiveCalibrationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A newer calibration run replaced the previous point request."
      )
    );
    this.invalidatePendingGaze();
    const manager = this.getCalibrationManagerOrThrow();
    manager.start(
      calibrationId,
      mode,
      this.faceBaseline
    );
    this.getDeepPersonalMapperOrThrow().start(
      calibrationId,
      manager.getSnapshot().expectedPointCount
    );
    this.gazePredictor.setObserverSuspended(false);
    this.quickRecalibrationActive = false;
    this.activeDeepCalibrationSamples = [];
    this.deepPersonalPredictionCount = 0;
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
    this.authoritativeSessionValidationReady = false;
    this.authoritativeSessionDegradedCollectionAllowed = false;
    this.selectedStrategyValidationResult = null;
    this.deepSessionStrategyEligible = false;
    this.forceBaselineSessionStrategy = false;
    this.independentValidationActive = false;
    this.driftMonitorResumeAfterTimestampMs = 0;
    this.adaptiveCalibrationExpansionEvaluated = false;
    this.trackingViewportSize = null;
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();
    const nativePersonalizationSessionStarted = this.gazePredictor.beginPrimaryPersonalizationSession();
    this.getResidualCorrectorOrThrow().clear();
    logger11.info(
      "Calibration runtime started.",
      {
        calibrationId,
        mode,
        expectedPointCount: manager.getSnapshot().expectedPointCount,
        correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
        nativePersonalizationSessionStarted,
        deepObserver: this.gazePredictor.getSnapshot().observer
      }
    );
  }
  setAutomaticQuickRecalibrationEnabled(enabled) {
    if (this.automaticQuickRecalibrationEnabled === enabled) {
      return;
    }
    this.automaticQuickRecalibrationEnabled = enabled;
    this.runtimeGazeDriftMonitor.reset();
    this.lastLoggedRuntimeDriftSeverity = null;
    logger11.info(
      "Automatic quick recalibration preference changed.",
      { enabled }
    );
  }
  /**
   * Starts a short maintenance calibration without discarding the original
   * calibration set. The extra targets are appended to the existing cleaned
   * points so they capture the participant's current drifted pose.
   */
  startQuickRecalibration(calibrationId, pointCount) {
    this.assertUsable();
    this.assertCameraRunning();
    if (!Number.isInteger(pointCount) || pointCount <= 0 || this.quickRecalibrationActive) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration cannot start in the current runtime state."
      );
    }
    const manager = this.getCalibrationManagerOrThrow();
    const snapshot = manager.getSnapshot();
    if (snapshot.calibrationId !== calibrationId || !snapshot.modelReady || snapshot.activePointIndex !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration requires the active fitted calibration model."
      );
    }
    if (CALIBRATION.CORRECTION_STRATEGY !== "PROJECT_RESIDUAL_ONLY") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Native WebEyeTrack quick recalibration needs a native-weight rollback; use full calibration."
      );
    }
    const candidateManager = manager.forkForQuickRecalibration();
    const candidateDeepMapper = this.getDeepPersonalMapperOrThrow().forkForQuickRecalibration();
    const extension = candidateManager.beginIncrementalCalibration(pointCount);
    candidateDeepMapper.extendExpectedPointCount(extension.expectedPointCount);
    const oldCorrector = this.getResidualCorrectorOrThrow();
    const oldModel = manager.getModel();
    if (oldModel === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Cannot start maintenance without a fitted previous model."
      );
    }
    const candidateCorrector = new ResidualCorrector();
    candidateCorrector.setModel(oldModel);
    this.cancelActiveValidationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration replaced an older validation request."
      )
    );
    this.quickRecalibrationCheckpoint = {
      calibrationManager: manager,
      deepPersonalMapper: this.getDeepPersonalMapperOrThrow(),
      calibrationHybridSelector: this.getCalibrationHybridSelectorOrThrow(),
      residualCorrector: oldCorrector,
      validationManager: this.getValidationManagerOrThrow(),
      deepIndependentValidator: this.getDeepIndependentValidatorOrThrow(),
      authoritativeSessionValidationReady: this.authoritativeSessionValidationReady,
      authoritativeSessionDegradedCollectionAllowed: this.authoritativeSessionDegradedCollectionAllowed,
      selectedStrategyValidationResult: this.selectedStrategyValidationResult,
      deepSessionStrategyEligible: this.deepSessionStrategyEligible,
      forceBaselineSessionStrategy: this.forceBaselineSessionStrategy,
      independentValidationActive: this.independentValidationActive,
      driftMonitorResumeAfterTimestampMs: this.driftMonitorResumeAfterTimestampMs,
      faceBaseline: this.getFaceBaseline(),
      driftMonitorState: this.runtimeGazeDriftMonitor.captureState()
    };
    this.calibrationManager = candidateManager;
    this.deepPersonalMapper = candidateDeepMapper;
    this.calibrationHybridSelector = new CalibrationHybridSelector();
    this.residualCorrector = candidateCorrector;
    this.validationManager = new ValidationManager();
    this.deepIndependentValidator = new DeepIndependentValidator();
    this.completedQuickValidationResult = null;
    const runId = `${calibrationId}:${++this.quickRecalibrationRunSequence}`;
    this.quickRecalibrationRunId = runId;
    this.quickRecalibrationTimeoutId = window.setTimeout(() => {
      this.abortQuickRecalibration(calibrationId, runId);
    }, QUICK_RECALIBRATION.MAX_RUN_DURATION_MS);
    this.invalidatePendingGaze();
    this.quickRecalibrationActive = true;
    this.authoritativeSessionValidationReady = false;
    this.authoritativeSessionDegradedCollectionAllowed = false;
    this.selectedStrategyValidationResult = null;
    this.activeDeepCalibrationSamples = [];
    this.activeDeepValidationSamples = [];
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.authoritativeGazeStabilizer.reset();
    this.fixationDetector.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    logger11.info(
      "Quick recalibration started from persistent runtime drift.",
      {
        calibrationId,
        startingPointIndex: extension.startingPointIndex,
        pointCount,
        expectedPointCount: extension.expectedPointCount
      }
    );
    return { ...extension, runId };
  }
  /** Reject stale UI messages from an earlier attempt with the same calibration ID. */
  assertQuickRecalibrationRun(calibrationId, runId) {
    if (!this.quickRecalibrationActive || this.quickRecalibrationRunId !== runId || this.calibrationManager?.getSnapshot().calibrationId !== calibrationId) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "The quick recalibration request is expired or belongs to a different run."
      );
    }
  }
  /** Restore the original fitted models AND readiness flags, never candidate fits. */
  abortQuickRecalibration(calibrationId, runId) {
    if (!this.quickRecalibrationActive || this.quickRecalibrationRunId !== runId || this.calibrationManager?.getSnapshot().calibrationId !== calibrationId) return false;
    const saved = this.quickRecalibrationCheckpoint;
    if (saved === null) return false;
    this.quickRecalibrationActive = false;
    this.quickRecalibrationRunId = null;
    this.quickRecalibrationCheckpoint = null;
    if (this.quickRecalibrationTimeoutId !== null) {
      window.clearTimeout(this.quickRecalibrationTimeoutId);
      this.quickRecalibrationTimeoutId = null;
    }
    this.cancelActiveCalibrationPoint(new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CALIBRATION",
      "Quick recalibration was aborted; previous model restored."
    ));
    this.cancelActiveValidationPoint(new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CALIBRATION",
      "Quick validation was aborted; previous model restored."
    ));
    this.invalidatePendingGaze();
    this.calibrationManager = saved.calibrationManager;
    this.deepPersonalMapper = saved.deepPersonalMapper;
    this.calibrationHybridSelector = saved.calibrationHybridSelector;
    this.residualCorrector = saved.residualCorrector;
    this.validationManager = saved.validationManager;
    this.deepIndependentValidator = saved.deepIndependentValidator;
    this.authoritativeSessionValidationReady = saved.authoritativeSessionValidationReady;
    this.authoritativeSessionDegradedCollectionAllowed = saved.authoritativeSessionDegradedCollectionAllowed;
    this.selectedStrategyValidationResult = saved.selectedStrategyValidationResult;
    this.deepSessionStrategyEligible = saved.deepSessionStrategyEligible;
    this.forceBaselineSessionStrategy = saved.forceBaselineSessionStrategy;
    this.independentValidationActive = saved.independentValidationActive;
    this.driftMonitorResumeAfterTimestampMs = saved.driftMonitorResumeAfterTimestampMs;
    this.faceBaseline = saved.faceBaseline;
    this.activeDeepCalibrationSamples = [];
    this.activeDeepValidationSamples = [];
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.restoreState(saved.driftMonitorState);
    this.authoritativeGazeStabilizer.reset();
    this.fixationDetector.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    logger11.warn("Quick recalibration rolled back to the previous validated model.", {
      calibrationId,
      runId
    });
    return true;
  }
  getCompletedQuickValidationResult() {
    return this.completedQuickValidationResult;
  }
  startQuickValidation(calibrationId, viewportWidth, viewportHeight, expectedPointCount) {
    if (!this.quickRecalibrationActive) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick validation requires an active quick recalibration run."
      );
    }
    this.startValidation(
      calibrationId,
      viewportWidth,
      viewportHeight,
      expectedPointCount
    );
  }
  collectCalibrationPoint(calibrationId, target, targetShownAtMs) {
    this.assertUsable();
    if (this.activeCalibrationPointRequest !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A calibration target is already awaiting gaze samples.",
        {
          details: {
            activePointIndex: this.activeCalibrationPointRequest.pointIndex,
            requestedPointIndex: target.pointIndex
          }
        }
      );
    }
    const manager = this.getCalibrationManagerOrThrow();
    manager.beginPoint(
      calibrationId,
      target,
      targetShownAtMs
    );
    this.activeDeepCalibrationSamples = [];
    return new Promise(
      (resolve, reject) => {
        const deadlineMs = targetShownAtMs + CALIBRATION.POINT_TIMEOUT_LOW_FPS_MS;
        const timeoutDelayMs = Math.max(
          0,
          deadlineMs - nowTimelineMs()
        ) + 50;
        const timeoutId = window.setTimeout(
          () => {
            void this.finishActiveCalibrationPoint();
          },
          timeoutDelayMs
        );
        this.activeCalibrationPointRequest = {
          calibrationId,
          pointIndex: target.pointIndex,
          targetNormalizedPoint: {
            ...target.normalizedPoint
          },
          targetViewportPoint: {
            ...target.viewportPoint
          },
          targetShownAtMs,
          resolve,
          reject,
          timeoutId,
          deepGraceTimeoutId: null,
          baselineReadyAtMs: null
        };
      }
    );
  }
  observeCalibrationFrame(result, faceQuality, faceGeometry) {
    if (this.activeCalibrationPointRequest === null) {
      return;
    }
    const manager = this.getCalibrationManagerOrThrow();
    const decision = manager.observe({
      prediction: result.prediction,
      gazeValid: result.validation.valid,
      gazeQuality: result.quality.score,
      face: faceQuality.trackingQuality,
      faceCenterNormalized: faceGeometry.geometry?.centerNormalized ?? null
    });
    if (decision.accepted && CALIBRATION.CORRECTION_STRATEGY === "WEBEYETRACK_NATIVE_ONLY") {
      this.gazePredictor?.recordPrimaryPersonalizationCandidate(
        this.activeCalibrationPointRequest.pointIndex,
        result.prediction.timestampMs
      );
    }
    if (decision.phase === "TIMED_OUT") {
      void this.finishActiveCalibrationPoint();
      return;
    }
    if (decision.phase === "READY") {
      this.maybeFinishCalibrationAfterDeepDwell();
    }
  }
  getPostSettleDeepSamples() {
    const request = this.activeCalibrationPointRequest;
    if (request === null) {
      return [];
    }
    const minimumTimestampMs = request.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS;
    return this.activeDeepCalibrationSamples.filter(
      (sample) => sample.prediction.timestampMs >= minimumTimestampMs
    );
  }
  maybeFinishCalibrationAfterDeepDwell() {
    const request = this.activeCalibrationPointRequest;
    if (request === null) {
      return;
    }
    const postSettleDeepSampleCount = this.getPostSettleDeepSamples().length;
    if (postSettleDeepSampleCount >= DEEP_PERSONALIZATION.CALIBRATION_DEEP_TARGET_SAMPLE_COUNT) {
      if (request.deepGraceTimeoutId !== null) {
        window.clearTimeout(
          request.deepGraceTimeoutId
        );
        request.deepGraceTimeoutId = null;
      }
      logger11.info(
        "Deep calibration dwell requirement satisfied; completing target.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          postSettleDeepSampleCount,
          targetSampleCount: DEEP_PERSONALIZATION.CALIBRATION_DEEP_TARGET_SAMPLE_COUNT
        }
      );
      void this.finishActiveCalibrationPoint();
      return;
    }
    if (request.baselineReadyAtMs !== null) {
      return;
    }
    request.baselineReadyAtMs = nowTimelineMs();
    if (this.gazePredictor?.getSnapshot().observer.suspended === true) {
      logger11.info(
        "Baseline calibration point is ready; slow deep observer is suspended so the target can complete immediately.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          postSettleDeepSampleCount,
          observerSnapshot: this.gazePredictor.getSnapshot().observer
        }
      );
      void this.finishActiveCalibrationPoint();
      return;
    }
    const observerLatencyMs = this.gazePredictor?.getSnapshot().observer.lastPrediction?.inferenceLatencyMs ?? null;
    const adaptiveDeepGraceMs = observerLatencyMs === null ? DEEP_PERSONALIZATION.CALIBRATION_DEEP_GRACE_MS : Math.min(
      2500,
      Math.max(
        DEEP_PERSONALIZATION.CALIBRATION_DEEP_GRACE_MS,
        Math.ceil(observerLatencyMs * 1.5)
      )
    );
    request.deepGraceTimeoutId = window.setTimeout(
      () => {
        const activeRequest = this.activeCalibrationPointRequest;
        if (activeRequest === null || activeRequest.calibrationId !== request.calibrationId || activeRequest.pointIndex !== request.pointIndex) {
          return;
        }
        activeRequest.deepGraceTimeoutId = null;
        logger11.info(
          "Deep calibration dwell grace elapsed; completing target with available deep observations.",
          {
            calibrationId: activeRequest.calibrationId,
            pointIndex: activeRequest.pointIndex,
            graceMs: adaptiveDeepGraceMs,
            postSettleDeepSampleCount: this.getPostSettleDeepSamples().length,
            observerSnapshot: this.gazePredictor?.getSnapshot().observer ?? null
          }
        );
        void this.finishActiveCalibrationPoint();
      },
      adaptiveDeepGraceMs
    );
    logger11.info(
      "Baseline calibration point is ready; extending target briefly for deep observations.",
      {
        calibrationId: request.calibrationId,
        pointIndex: request.pointIndex,
        graceMs: adaptiveDeepGraceMs,
        postSettleDeepSampleCount,
        targetSampleCount: DEEP_PERSONALIZATION.CALIBRATION_DEEP_TARGET_SAMPLE_COUNT,
        observerSnapshot: this.gazePredictor?.getSnapshot().observer ?? null
      }
    );
  }
  async finishActiveCalibrationPoint() {
    const request = this.activeCalibrationPointRequest;
    if (request === null) {
      return;
    }
    this.activeCalibrationPointRequest = null;
    const deepSamples = this.activeDeepCalibrationSamples;
    this.activeDeepCalibrationSamples = [];
    window.clearTimeout(
      request.timeoutId
    );
    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }
    try {
      const manager = this.getCalibrationManagerOrThrow();
      const result = manager.finishActivePoint(
        nowTimelineMs()
      );
      let responseResult = result;
      if (result.sufficient && result.stableWindowStartTimestampMs !== null && result.stableWindowEndTimestampMs !== null && this.faceBaseline !== null) {
        const stableWindowStartTimestampMs = result.stableWindowStartTimestampMs;
        const stableWindowEndTimestampMs = result.stableWindowEndTimestampMs;
        const exactStableDeepSamples = deepSamples.filter(
          (sample) => sample.prediction.timestampMs >= stableWindowStartTimestampMs && sample.prediction.timestampMs <= stableWindowEndTimestampMs
        );
        const expandedWindowStartTimestampMs = Math.max(
          request.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS,
          stableWindowStartTimestampMs - DEEP_PERSONALIZATION.CALIBRATION_WINDOW_PADDING_MS
        );
        const expandedWindowEndTimestampMs = stableWindowEndTimestampMs + DEEP_PERSONALIZATION.CALIBRATION_WINDOW_PADDING_MS;
        const paddedStableDeepSamples = deepSamples.filter(
          (sample) => sample.prediction.timestampMs >= expandedWindowStartTimestampMs && sample.prediction.timestampMs <= expandedWindowEndTimestampMs
        );
        const postSettleDeepSamples = deepSamples.filter(
          (sample) => sample.prediction.timestampMs >= request.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS
        );
        const candidateSelection = exactStableDeepSamples.length >= DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT ? {
          mode: "STABLE_WINDOW",
          samples: exactStableDeepSamples
        } : paddedStableDeepSamples.length >= DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT ? {
          mode: "PADDED_STABLE_WINDOW",
          samples: paddedStableDeepSamples
        } : {
          mode: "TARGET_DWELL_FALLBACK",
          samples: postSettleDeepSamples
        };
        const stableWindowMidpointMs = (stableWindowStartTimestampMs + stableWindowEndTimestampMs) / 2;
        const selectedDeepSamples = [...candidateSelection.samples].sort(
          (first, second) => Math.abs(
            first.prediction.timestampMs - stableWindowMidpointMs
          ) - Math.abs(
            second.prediction.timestampMs - stableWindowMidpointMs
          )
        ).slice(
          0,
          DEEP_PERSONALIZATION.MAX_DEEP_SAMPLES_PER_POINT
        ).sort(
          (first, second) => first.prediction.timestampMs - second.prediction.timestampMs
        );
        try {
          const deepPoint = this.getDeepPersonalMapperOrThrow().addCalibrationPoint(
            {
              pointIndex: result.pointIndex,
              targetNormalizedPoint: request.targetNormalizedPoint,
              targetViewportPoint: request.targetViewportPoint,
              samples: selectedDeepSamples
            },
            this.faceBaseline
          );
          logger11.info(
            "Deep calibration point staged for grouped personal mapping.",
            {
              calibrationId: result.calibrationId,
              pointIndex: result.pointIndex,
              bufferedDeepSampleCount: deepSamples.length,
              exactStableDeepSampleCount: exactStableDeepSamples.length,
              paddedStableDeepSampleCount: paddedStableDeepSamples.length,
              postSettleDeepSampleCount: postSettleDeepSamples.length,
              deepSampleSelectionMode: candidateSelection.mode,
              deepSampleCount: deepPoint.sampleCount,
              meanDeepConfidence: deepPoint.meanConfidence
            }
          );
        } catch (error) {
          logger11.warn(
            "Deep calibration point could not be staged; baseline calibration continues.",
            {
              calibrationId: result.calibrationId,
              pointIndex: result.pointIndex,
              bufferedDeepSampleCount: deepSamples.length,
              exactStableDeepSampleCount: exactStableDeepSamples.length,
              paddedStableDeepSampleCount: paddedStableDeepSamples.length,
              postSettleDeepSampleCount: postSettleDeepSamples.length,
              deepSampleSelectionMode: candidateSelection.mode,
              selectedDeepSampleCount: selectedDeepSamples.length,
              observerSnapshot: this.gazePredictor?.getSnapshot().observer ?? null,
              error: error instanceof Error ? error.message : "Unknown deep calibration staging error"
            }
          );
        }
      }
      if (result.sufficient && result.stableWindowStartTimestampMs !== null && result.stableWindowEndTimestampMs !== null && CALIBRATION.CORRECTION_STRATEGY === "WEBEYETRACK_NATIVE_ONLY") {
        const staged = this.gazePredictor?.stagePrimaryPersonalizationPoint(
          result.pointIndex,
          request.targetNormalizedPoint,
          result.stableWindowStartTimestampMs,
          result.stableWindowEndTimestampMs
        ) ?? false;
        if (!staged) {
          logger11.warn(
            "No WebEyeTrack native support sample was staged for the completed calibration point.",
            {
              calibrationId: result.calibrationId,
              pointIndex: result.pointIndex
            }
          );
        }
      }
      if (result.modelReady && result.model !== null) {
        this.invalidatePendingGaze();
        this.getResidualCorrectorOrThrow().setModel(result.model);
        logger11.info(
          "Calibration residual model fitted.",
          {
            calibrationId: result.calibrationId,
            trainingPointCount: result.completedPointCount,
            trainingRmseNormalized: result.trainingRmseNormalized
          }
        );
        try {
          const deepFit = this.getDeepPersonalMapperOrThrow().fit();
          logger11.info(
            "Deep personal screen mapper fitted in shadow mode with grouped leave-one-point-out selection.",
            {
              calibrationId: result.calibrationId,
              calibrationPointCount: deepFit.calibrationPointCount,
              projectedFeatureDimension: deepFit.projectedFeatureDimension,
              combinedFeatureDimension: deepFit.combinedFeatureDimension,
              selectedKind: deepFit.selectedCandidate.kind,
              selectedRidgeLambda: deepFit.selectedCandidate.ridgeLambda,
              selectedRbfGammaScale: deepFit.selectedCandidate.rbfGammaScale,
              groupedCvMeanErrorPx: deepFit.selectedCandidate.meanErrorPx,
              groupedCvP95ErrorPx: deepFit.selectedCandidate.p95ErrorPx,
              groupedCvRmsePx: deepFit.selectedCandidate.rmsePx
            }
          );
          const deepMapperSnapshot = this.getDeepPersonalMapperOrThrow().getSnapshot();
          const observerSnapshot = this.gazePredictor?.getSnapshot().observer ?? null;
          const expectedDeepPointCount = Math.max(
            1,
            deepMapperSnapshot.expectedPointCount
          );
          const deepCoverageRatio = deepMapperSnapshot.collectedPointCount / expectedDeepPointCount;
          const lastDeepInferenceLatencyMs = observerSnapshot?.lastPrediction?.inferenceLatencyMs ?? null;
          this.deepSessionStrategyEligible = deepCoverageRatio >= DEEP_PERSONALIZATION.SESSION_STRATEGY_MIN_DEEP_COVERAGE_RATIO && observerSnapshot?.suspended !== true && lastDeepInferenceLatencyMs !== null && lastDeepInferenceLatencyMs < DEEP_PERSONALIZATION.CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS;
          this.forceBaselineSessionStrategy = !this.deepSessionStrategyEligible;
          const eligibilityDetails = {
            calibrationId: result.calibrationId,
            deepCollectedPointCount: deepMapperSnapshot.collectedPointCount,
            expectedDeepPointCount,
            deepCoverageRatio,
            requiredCoverageRatio: DEEP_PERSONALIZATION.SESSION_STRATEGY_MIN_DEEP_COVERAGE_RATIO,
            lastDeepInferenceLatencyMs,
            maximumEligibleInferenceLatencyMs: DEEP_PERSONALIZATION.CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS,
            observerSuspended: observerSnapshot?.suspended ?? true,
            observerSuspensionReason: observerSnapshot?.suspensionReason ?? null,
            deepSessionStrategyEligible: this.deepSessionStrategyEligible
          };
          if (this.deepSessionStrategyEligible) {
            logger11.info(
              "Deep session strategy passed calibration coverage/performance eligibility gate.",
              eligibilityDetails
            );
          } else {
            logger11.warn(
              "Deep session strategy is shadow-only because calibration coverage/performance is insufficient; Baseline will remain authoritative unless a future calibration qualifies Deep.",
              eligibilityDetails
            );
          }
          try {
            const baselineCv = this.getCalibrationManagerOrThrow().getGroupedCrossValidationDiagnostics();
            const hybridFit = this.getCalibrationHybridSelectorOrThrow().fit(baselineCv, deepFit);
            logger11.info(
              "Calibration-only residual bias model fitted from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                baselineCorrectionEnabled: hybridFit.residualBias.baseline.correctionEnabled,
                baselineCorrectionStrength: hybridFit.residualBias.baseline.correctionStrength,
                baselineStrengthDiagnostics: hybridFit.residualBias.baseline.strengthDiagnostics,
                baselineCrossValidation: hybridFit.residualBias.baseline.crossValidation,
                baselineGlobalBiasPrior: hybridFit.residualBias.baseline.globalPrior,
                baselineDirectionalBiasPriors: hybridFit.residualBias.baseline.directionalPriors,
                deepCorrectionEnabled: hybridFit.residualBias.deep.correctionEnabled,
                deepCorrectionStrength: hybridFit.residualBias.deep.correctionStrength,
                deepStrengthDiagnostics: hybridFit.residualBias.deep.strengthDiagnostics,
                deepCrossValidation: hybridFit.residualBias.deep.crossValidation,
                deepGlobalBiasPrior: hybridFit.residualBias.deep.globalPrior,
                deepDirectionalBiasPriors: hybridFit.residualBias.deep.directionalPriors
              }
            );
            logger11.info(
              "Calibration-only residual bias shrinkage selected from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                baselineCorrectionEnabled: hybridFit.residualBias.baseline.correctionEnabled,
                baselineCorrectionStrength: hybridFit.residualBias.baseline.correctionStrength,
                baselineStrengthDiagnostics: hybridFit.residualBias.baseline.strengthDiagnostics,
                deepCorrectionEnabled: hybridFit.residualBias.deep.correctionEnabled,
                deepCorrectionStrength: hybridFit.residualBias.deep.correctionStrength,
                deepStrengthDiagnostics: hybridFit.residualBias.deep.strengthDiagnostics
              }
            );
            logger11.info(
              "Calibration-only hybrid selector fitted from grouped cross-validation; independent validation remains untouched.",
              {
                calibrationId: result.calibrationId,
                calibrationPointCount: hybridFit.calibrationPointCount,
                baselineGroupedCvMeanErrorPx: baselineCv.meanErrorPx,
                baselineGroupedCvP95ErrorPx: baselineCv.p95ErrorPx,
                deepGroupedCvMeanErrorPx: deepFit.selectedCandidate.meanErrorPx,
                deepGroupedCvP95ErrorPx: deepFit.selectedCandidate.p95ErrorPx,
                baselineBiasCorrectionEnabled: hybridFit.residualBias.baseline.correctionEnabled,
                deepBiasCorrectionEnabled: hybridFit.residualBias.deep.correctionEnabled,
                globalPrior: hybridFit.globalPrior,
                bucketPriors: hybridFit.bucketPriors,
                directionalPriors: hybridFit.directionalPriors,
                engineReliabilityRoutingEnabled: hybridFit.engineReliability.routingEnabled,
                engineReliabilityCrossValidation: hybridFit.engineReliability.crossValidation,
                engineReliabilityGlobalPrior: hybridFit.engineReliability.globalPrior,
                engineReliabilityDirectionalPriors: hybridFit.engineReliability.directionalPriors,
                coarseEngineReliabilityRoutingEnabled: hybridFit.coarseEngineReliability.routingEnabled,
                coarseEngineReliabilityCrossValidation: hybridFit.coarseEngineReliability.crossValidation,
                coarseEngineReliabilityGlobalPrior: hybridFit.coarseEngineReliability.globalPrior,
                coarseEngineReliabilityBucketPriors: hybridFit.coarseEngineReliability.bucketPriors
              }
            );
            logger11.info(
              "Calibration-only paired engine reliability routing fitted from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                routingEnabled: hybridFit.engineReliability.routingEnabled,
                crossValidation: hybridFit.engineReliability.crossValidation,
                globalPrior: hybridFit.engineReliability.globalPrior,
                directionalPriors: hybridFit.engineReliability.directionalPriors
              }
            );
            logger11.info(
              "Calibration-only coarse spatial engine reliability routing fitted from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                routingEnabled: hybridFit.coarseEngineReliability.routingEnabled,
                crossValidation: hybridFit.coarseEngineReliability.crossValidation,
                globalPrior: hybridFit.coarseEngineReliability.globalPrior,
                bucketPriors: hybridFit.coarseEngineReliability.bucketPriors
              }
            );
            logger11.info(
              "Calibration-only session gaze strategy selected from grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                selectedStrategy: hybridFit.sessionStrategy.selectedStrategy,
                selectedCandidate: hybridFit.sessionStrategy.selectedCandidate,
                candidates: hybridFit.sessionStrategy.candidates,
                activeCalibrationRoutingMode: hybridFit.sessionStrategy.activeCalibrationRoutingMode,
                calibrationRoutingInfluence: hybridFit.sessionStrategy.calibrationRoutingInfluence,
                standaloneEvidence: hybridFit.sessionStrategy.standaloneEvidence,
                pointResults: hybridFit.sessionStrategy.pointResults
              }
            );
            if (!this.adaptiveCalibrationExpansionEvaluated && manager.getSnapshot().mode === "STANDARD_17" && result.completedPointCount === CALIBRATION.STANDARD_POINT_COUNT) {
              this.adaptiveCalibrationExpansionEvaluated = true;
              const viewport = this.inferCalibrationViewportSize(
                request.targetNormalizedPoint,
                request.targetViewportPoint
              );
              const expansionPlan = planAdaptiveCalibrationExpansion(
                baselineCv.pointResults,
                hybridFit.sessionStrategy,
                viewport
              );
              logger11.info(
                "Calibration-only adaptive spatial expansion evaluated after STANDARD_17.",
                {
                  calibrationId: result.calibrationId,
                  ...expansionPlan
                }
              );
              if (expansionPlan.expansionRequired) {
                manager.extendExpectedPointCount(
                  expansionPlan.finalExpectedPointCount
                );
                this.getDeepPersonalMapperOrThrow().extendExpectedPointCount(
                  expansionPlan.finalExpectedPointCount
                );
                this.getResidualCorrectorOrThrow().clear();
                this.calibrationHybridSelector?.reset();
                responseResult = {
                  ...result,
                  expectedPointCount: expansionPlan.finalExpectedPointCount,
                  modelReady: false,
                  trainingRmseNormalized: null,
                  trainingDiagnostics: null,
                  model: null,
                  adaptiveExpansionTargets: expansionPlan.selectedTargets.map(
                    (selection) => selection.target
                  )
                };
              }
            }
          } catch (hybridError) {
            this.calibrationHybridSelector?.reset();
            this.deepSessionStrategyEligible = false;
            this.forceBaselineSessionStrategy = true;
            logger11.warn(
              "Calibration-only hybrid selector could not be fitted; baseline and deep shadow paths remain available independently.",
              {
                calibrationId: result.calibrationId,
                error: hybridError instanceof Error ? hybridError.message : "Unknown hybrid selector fitting error"
              }
            );
          }
        } catch (error) {
          this.deepSessionStrategyEligible = false;
          this.forceBaselineSessionStrategy = true;
          this.calibrationHybridSelector?.reset();
          logger11.warn(
            "Deep personal screen mapper could not be fitted; established WebEyeTrack calibration remains active.",
            {
              calibrationId: result.calibrationId,
              deepMapperSnapshot: this.getDeepPersonalMapperOrThrow().getSnapshot(),
              deepObserverSnapshot: this.gazePredictor?.getSnapshot().observer ?? null,
              error: error instanceof Error ? error.message : "Unknown deep personal mapper fitting error"
            }
          );
        }
        if (responseResult.modelReady && CALIBRATION.CORRECTION_STRATEGY === "WEBEYETRACK_NATIVE_ONLY") {
          try {
            const personalization = await this.gazePredictor?.applyPrimaryPersonalization() ?? {
              applied: false,
              stagedPointCount: 0,
              supportPointCount: 0
            };
            if (personalization.applied) {
              const identityModel = createIdentityCalibrationResidualModel(
                result.completedPointCount,
                result.trainingRmseNormalized ?? 0
              );
              manager.setModel(identityModel);
              this.getResidualCorrectorOrThrow().setModel(identityModel);
              logger11.info(
                "WebEyeTrack native personalization applied; project residual correction set to identity for the native-only validation run.",
                {
                  calibrationId: result.calibrationId,
                  correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
                  stagedPointCount: personalization.stagedPointCount,
                  supportPointCount: personalization.supportPointCount
                }
              );
            } else {
              logger11.warn(
                "Native-only calibration strategy could not apply WebEyeTrack personalization; project residual correction remains active as a safety fallback.",
                {
                  calibrationId: result.calibrationId,
                  correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
                  stagedPointCount: personalization.stagedPointCount,
                  supportPointCount: personalization.supportPointCount
                }
              );
            }
          } catch (error) {
            logger11.warn(
              "WebEyeTrack native personalization failed; project residual correction remains active as a safety fallback.",
              {
                calibrationId: result.calibrationId,
                correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
                error
              }
            );
          }
        } else if (responseResult.modelReady) {
          logger11.info(
            "Project residual calibration retained for independent validation; native personalization was intentionally not applied.",
            {
              calibrationId: result.calibrationId,
              correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
              trainingPointCount: result.completedPointCount,
              trainingRmseNormalized: result.trainingRmseNormalized
            }
          );
        }
      }
      logger11.info(
        "Calibration point collection finished.",
        {
          calibrationId: responseResult.calibrationId,
          pointIndex: responseResult.pointIndex,
          sufficient: responseResult.sufficient,
          acceptedSampleCount: responseResult.acceptedSampleCount,
          rejectedSampleCount: responseResult.rejectedSampleCount,
          completedPointCount: responseResult.completedPointCount,
          expectedPointCount: responseResult.expectedPointCount,
          adaptiveExpansionTargetCount: responseResult.adaptiveExpansionTargets.length,
          stableWindowStartTimestampMs: responseResult.stableWindowStartTimestampMs,
          stableWindowEndTimestampMs: responseResult.stableWindowEndTimestampMs,
          stability: responseResult.stability
        }
      );
      request.resolve(responseResult);
    } catch (error) {
      request.reject(error);
    }
  }
  inferCalibrationViewportSize(normalizedPoint, viewportPoint) {
    const width = normalizedPoint.x > 0 ? viewportPoint.x / normalizedPoint.x : Number.NaN;
    const height = normalizedPoint.y > 0 ? viewportPoint.y / normalizedPoint.y : Number.NaN;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Adaptive calibration expansion could not infer the active viewport size."
      );
    }
    return { width, height };
  }
  cancelActiveCalibrationPoint(error) {
    const request = this.activeCalibrationPointRequest;
    if (request === null) {
      return;
    }
    this.activeCalibrationPointRequest = null;
    this.activeDeepCalibrationSamples = [];
    window.clearTimeout(
      request.timeoutId
    );
    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }
    request.reject(error);
  }
  /* ========================================================================
   * Deep observer personalization bridge
   * ====================================================================== */
  observeDeepObserverSample(sample) {
    const calibrationRequest = this.activeCalibrationPointRequest;
    if (calibrationRequest !== null) {
      if (sample.prediction.inferenceLatencyMs >= DEEP_PERSONALIZATION.CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS) {
        this.gazePredictor?.setObserverSuspended(
          true,
          `CALIBRATION_OBSERVER_LATENCY_${Math.round(sample.prediction.inferenceLatencyMs)}MS`
        );
        logger11.warn(
          "Deep observer exceeded the calibration latency budget and was suspended to protect baseline calibration throughput.",
          {
            calibrationId: calibrationRequest.calibrationId,
            pointIndex: calibrationRequest.pointIndex,
            inferenceLatencyMs: sample.prediction.inferenceLatencyMs,
            suspendThresholdMs: DEEP_PERSONALIZATION.CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS,
            baselineReady: calibrationRequest.baselineReadyAtMs !== null
          }
        );
        if (calibrationRequest.baselineReadyAtMs !== null) {
          this.maybeFinishCalibrationAfterDeepDwell();
        }
        return;
      }
      const timestampMs = sample.prediction.timestampMs;
      if (timestampMs >= calibrationRequest.targetShownAtMs && timestampMs <= calibrationRequest.targetShownAtMs + CALIBRATION.POINT_TIMEOUT_MS) {
        this.activeDeepCalibrationSamples.push(sample);
        if (calibrationRequest.baselineReadyAtMs !== null) {
          this.maybeFinishCalibrationAfterDeepDwell();
        }
      }
    }
    const validationRequest = this.activeValidationPointRequest;
    if (validationRequest !== null) {
      const timestampMs = sample.prediction.timestampMs;
      if (timestampMs >= validationRequest.targetShownAtMs && timestampMs <= validationRequest.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS + DEEP_PERSONALIZATION.VALIDATION_DEEP_MAX_DWELL_MS) {
        this.activeDeepValidationSamples.push(sample);
        if (validationRequest.baselineReadyAtMs !== null) {
          this.maybeFinishValidationAfterDeepDwell();
        }
      }
    }
    const mapper = this.deepPersonalMapper;
    const baseline = this.faceBaseline;
    if (mapper === null || baseline === null || !mapper.getSnapshot().modelReady) {
      return;
    }
    try {
      const aggregatedSamples = this.runtimeDeepFeatureAggregator.update(sample);
      if (aggregatedSamples === null) {
        return;
      }
      const anchorSample = aggregatedSamples.at(-1);
      if (anchorSample === void 0) {
        return;
      }
      const personalized = mapper.predictSamples(
        aggregatedSamples,
        baseline
      );
      if (personalized === null) {
        return;
      }
      const synchronizedSourceBaseline = meanSynchronizedSourceBaseline(
        aggregatedSamples,
        this.runtimeBaselineHistory
      );
      const runtimeCandidate = synchronizedSourceBaseline === null ? null : createDeepRuntimeCandidate(
        anchorSample,
        personalized,
        baseline,
        synchronizedSourceBaseline,
        nowTimelineMs()
      );
      if (runtimeCandidate !== null) {
        this.latestPersonalizedDeepRuntimeCandidate = runtimeCandidate;
        this.latestDeepPrecisionPx = this.deepPrecisionEstimator.update(
          runtimeCandidate.sourceTimestampMs,
          runtimeCandidate.normalizedPoint,
          this.trackingViewportSize
        );
      }
      this.deepPersonalPredictionCount += 1;
      if (this.deepPersonalPredictionCount === 1 || this.deepPersonalPredictionCount % 25 === 0) {
        logger11.info(
          "Deep personalized screen prediction available in shadow mode.",
          {
            predictionCount: this.deepPersonalPredictionCount,
            timestampMs: sample.prediction.timestampMs,
            normalizedX: personalized.x,
            normalizedY: personalized.y,
            source: sample.prediction.source,
            mapper: mapper.getSnapshot()
          }
        );
      }
    } catch (error) {
      logger11.warn(
        "Deep personalized shadow prediction failed; baseline tracking continues.",
        {
          error: error instanceof Error ? error.message : "Unknown deep personalized prediction error"
        }
      );
    }
  }
  /**
   * D24 page/tab transition boundary.
   *
   * Calibration/personalization remain valid for the participant, but
   * temporal gaze state must not leak across visually unrelated pages.
   */
  handlePageContextTransition() {
    if (this.quickRecalibrationRunId !== null) {
      const calibrationId = this.calibrationManager?.getSnapshot().calibrationId;
      if (calibrationId !== null && calibrationId !== void 0) {
        this.abortQuickRecalibration(calibrationId, this.quickRecalibrationRunId);
      }
    }
    this.invalidatePendingGaze();
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.interrupt();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();
  }
  /**
   * Synchronizes the live CSS viewport owned by the active research page.
   * Normalized calibration/personalization state is intentionally preserved;
   * only pixel-derived temporal state is reset when the CSS coordinate frame
   * changes.
   */
  updateTrackingViewportContext(viewportWidth, viewportHeight, devicePixelRatio) {
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
      return false;
    }
    const previous = this.trackingViewportSize;
    const changed = previous === null || Math.abs(previous.width - viewportWidth) > 0.5 || Math.abs(previous.height - viewportHeight) > 0.5;
    this.trackingViewportSize = {
      width: viewportWidth,
      height: viewportHeight
    };
    if (changed) {
      this.handlePageContextTransition();
    }
    return changed;
  }
  /* ========================================================================
   * Independent validation runtime
   * ====================================================================== */
  startValidation(calibrationId, viewportWidth, viewportHeight, expectedPointCount) {
    this.assertUsable();
    this.assertCameraRunning();
    const calibrationModel = this.getCalibrationManagerOrThrow().getModel();
    if (calibrationModel === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Independent validation requires a fitted calibration model."
      );
    }
    this.cancelActiveValidationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A newer validation run replaced the previous point request."
      )
    );
    const manager = this.getValidationManagerOrThrow();
    const viewport = {
      width: viewportWidth,
      height: viewportHeight
    };
    this.trackingViewportSize = {
      ...viewport
    };
    this.invalidatePendingGaze();
    this.independentValidationActive = true;
    this.driftMonitorResumeAfterTimestampMs = 0;
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();
    manager.start(
      calibrationId,
      calibrationModel,
      viewport,
      expectedPointCount,
      this.faceBaseline
    );
    const deepMapperReady = this.deepPersonalMapper?.getSnapshot().modelReady ?? false;
    const observerSuspended = this.gazePredictor?.getSnapshot().observer.suspended ?? false;
    const deepDualValidationEnabled = this.deepSessionStrategyEligible && deepMapperReady && this.faceBaseline !== null && !observerSuspended;
    if (deepDualValidationEnabled) {
      this.getDeepIndependentValidatorOrThrow().start(
        calibrationId,
        viewport,
        expectedPointCount
      );
    } else {
      this.deepIndependentValidator?.reset();
    }
    this.activeDeepValidationSamples = [];
    logger11.info(
      "Independent calibration validation started.",
      {
        calibrationId,
        expectedPointCount,
        viewportWidth,
        viewportHeight,
        deepDualValidationEnabled,
        deepSessionStrategyEligible: this.deepSessionStrategyEligible,
        forceBaselineSessionStrategy: this.forceBaselineSessionStrategy,
        observerSuspended,
        deepMapperSnapshot: this.deepPersonalMapper?.getSnapshot() ?? null
      }
    );
  }
  getSelectedStrategyValidationResult() {
    const result = this.selectedStrategyValidationResult;
    if (result === null) {
      return null;
    }
    return {
      strategy: result.strategy,
      quality: result.quality,
      metrics: {
        ...result.metrics
      }
    };
  }
  collectValidationPoint(calibrationId, target, targetShownAtMs) {
    this.assertUsable();
    if (this.activeValidationPointRequest !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A validation target is already awaiting gaze samples."
      );
    }
    const manager = this.getValidationManagerOrThrow();
    manager.beginPoint(
      calibrationId,
      target,
      targetShownAtMs
    );
    this.activeDeepValidationSamples = [];
    return new Promise(
      (resolve, reject) => {
        const deadlineMs = targetShownAtMs + CALIBRATION.POINT_TIMEOUT_MS;
        const timeoutDelayMs = Math.max(
          0,
          deadlineMs - nowTimelineMs()
        ) + 50;
        const timeoutId = window.setTimeout(
          () => {
            this.finishActiveValidationPoint();
          },
          timeoutDelayMs
        );
        this.activeValidationPointRequest = {
          calibrationId,
          pointIndex: target.pointIndex,
          targetNormalizedPoint: {
            ...target.normalizedPoint
          },
          targetViewportPoint: {
            ...target.viewportPoint
          },
          targetShownAtMs,
          resolve,
          reject,
          timeoutId,
          deepGraceTimeoutId: null,
          baselineReadyAtMs: null,
          baselineResult: null
        };
      }
    );
  }
  observeValidationFrame(result, faceQuality, faceGeometry) {
    const request = this.activeValidationPointRequest;
    if (request === null) {
      return;
    }
    if (request.baselineResult !== null) {
      return;
    }
    const manager = this.getValidationManagerOrThrow();
    const decision = manager.observe({
      prediction: result.prediction,
      gazeValid: result.validation.valid,
      gazeQuality: result.quality.score,
      face: faceQuality.trackingQuality,
      faceCenterNormalized: faceGeometry.geometry?.centerNormalized ?? null
    });
    if (decision.phase === "TIMED_OUT") {
      this.finishActiveValidationPoint();
      return;
    }
    if (decision.phase === "READY") {
      try {
        request.baselineResult = manager.finishActivePoint(
          nowTimelineMs()
        );
      } catch (error) {
        this.activeValidationPointRequest = null;
        this.activeDeepValidationSamples = [];
        window.clearTimeout(
          request.timeoutId
        );
        request.reject(error);
        return;
      }
      this.maybeFinishValidationAfterDeepDwell();
    }
  }
  getPostSettleDeepValidationSamples() {
    const request = this.activeValidationPointRequest;
    if (request === null) {
      return [];
    }
    const minimumTimestampMs = request.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS;
    return this.activeDeepValidationSamples.filter(
      (sample) => sample.prediction.timestampMs >= minimumTimestampMs
    );
  }
  maybeFinishValidationAfterDeepDwell() {
    const request = this.activeValidationPointRequest;
    if (request === null) {
      return;
    }
    const mapper = this.deepPersonalMapper;
    const baseline = this.faceBaseline;
    const validator = this.deepIndependentValidator;
    const deepValidationActive = mapper?.getSnapshot().modelReady === true && baseline !== null && validator?.getSnapshot().calibrationId === request.calibrationId;
    if (!deepValidationActive || mapper === null || baseline === null || validator === null) {
      this.finishActiveValidationPoint();
      return;
    }
    const selectedSamples = this.getPostSettleDeepValidationSamples().slice(
      -DEEP_PERSONALIZATION.MAX_DEEP_VALIDATION_SAMPLES_PER_POINT
    );
    const dwell = validator.assessDwell(
      selectedSamples,
      mapper,
      baseline
    );
    const nowMs = nowTimelineMs();
    const elapsedMs = Math.max(
      0,
      nowMs - request.targetShownAtMs
    );
    const postSettleElapsedMs = Math.max(
      0,
      nowMs - request.targetShownAtMs - CALIBRATION.TARGET_SETTLE_MS
    );
    const preferredReady = dwell.acceptedSampleCount >= DEEP_PERSONALIZATION.VALIDATION_DEEP_PREFERRED_SAMPLE_COUNT;
    const stableMinimumReady = dwell.acceptedSampleCount >= DEEP_PERSONALIZATION.VALIDATION_DEEP_MIN_ACCEPTED_SAMPLE_COUNT && dwell.stable;
    if (preferredReady || stableMinimumReady) {
      if (request.deepGraceTimeoutId !== null) {
        window.clearTimeout(
          request.deepGraceTimeoutId
        );
        request.deepGraceTimeoutId = null;
      }
      logger11.info(
        "Robust deep validation dwell requirement satisfied; completing independent target.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          elapsedMs,
          postSettleElapsedMs,
          preferredReady,
          stableMinimumReady,
          dwell
        }
      );
      this.finishActiveValidationPoint();
      return;
    }
    if (request.baselineReadyAtMs !== null) {
      return;
    }
    request.baselineReadyAtMs = nowTimelineMs();
    const remainingDwellMs = Math.max(
      0,
      request.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS + DEEP_PERSONALIZATION.VALIDATION_DEEP_MAX_DWELL_MS - nowTimelineMs()
    );
    if (remainingDwellMs === 0) {
      logger11.info(
        "Robust deep validation maximum dwell already reached; completing with available observations.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          elapsedMs,
          postSettleElapsedMs,
          dwell
        }
      );
      this.finishActiveValidationPoint();
      return;
    }
    request.deepGraceTimeoutId = window.setTimeout(
      () => {
        const activeRequest = this.activeValidationPointRequest;
        if (activeRequest === null || activeRequest.calibrationId !== request.calibrationId || activeRequest.pointIndex !== request.pointIndex) {
          return;
        }
        activeRequest.deepGraceTimeoutId = null;
        const activeMapper = this.deepPersonalMapper;
        const activeBaseline = this.faceBaseline;
        const activeValidator = this.deepIndependentValidator;
        const finalSamples = this.getPostSettleDeepValidationSamples().slice(
          -DEEP_PERSONALIZATION.MAX_DEEP_VALIDATION_SAMPLES_PER_POINT
        );
        const finalDwell = activeMapper !== null && activeBaseline !== null && activeValidator !== null ? activeValidator.assessDwell(
          finalSamples,
          activeMapper,
          activeBaseline
        ) : null;
        logger11.info(
          "Robust deep validation maximum dwell elapsed; completing independent target with available observations.",
          {
            calibrationId: activeRequest.calibrationId,
            pointIndex: activeRequest.pointIndex,
            maximumPostSettleDwellMs: DEEP_PERSONALIZATION.VALIDATION_DEEP_MAX_DWELL_MS,
            postSettleElapsedMs: Math.max(
              0,
              nowTimelineMs() - activeRequest.targetShownAtMs - CALIBRATION.TARGET_SETTLE_MS
            ),
            dwell: finalDwell,
            observerSnapshot: this.gazePredictor?.getSnapshot().observer ?? null
          }
        );
        this.finishActiveValidationPoint();
      },
      remainingDwellMs
    );
    logger11.info(
      "Baseline validation point is ready; adaptively extending target for robust deep observations.",
      {
        calibrationId: request.calibrationId,
        pointIndex: request.pointIndex,
        remainingDwellMs,
        maximumPostSettleDwellMs: DEEP_PERSONALIZATION.VALIDATION_DEEP_MAX_DWELL_MS,
        minimumAcceptedSampleCount: DEEP_PERSONALIZATION.VALIDATION_DEEP_MIN_ACCEPTED_SAMPLE_COUNT,
        preferredSampleCount: DEEP_PERSONALIZATION.VALIDATION_DEEP_PREFERRED_SAMPLE_COUNT,
        dwell,
        observerSnapshot: this.gazePredictor?.getSnapshot().observer ?? null
      }
    );
  }
  finishActiveValidationPoint() {
    const request = this.activeValidationPointRequest;
    if (request === null) {
      return;
    }
    this.activeValidationPointRequest = null;
    const deepSamples = this.activeDeepValidationSamples;
    this.activeDeepValidationSamples = [];
    window.clearTimeout(
      request.timeoutId
    );
    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }
    try {
      const result = request.baselineResult ?? this.getValidationManagerOrThrow().finishActivePoint(
        nowTimelineMs()
      );
      if (result.sufficient && this.faceBaseline !== null && this.deepPersonalMapper?.getSnapshot().modelReady && this.deepIndependentValidator?.getSnapshot().calibrationId === request.calibrationId) {
        const selectedDeepSamples = deepSamples.filter(
          (sample) => sample.prediction.timestampMs >= request.targetShownAtMs + CALIBRATION.TARGET_SETTLE_MS
        ).slice(
          -DEEP_PERSONALIZATION.MAX_DEEP_VALIDATION_SAMPLES_PER_POINT
        );
        try {
          const deepPoint = this.getDeepIndependentValidatorOrThrow().addPoint(
            {
              pointIndex: request.pointIndex,
              targetNormalizedPoint: request.targetNormalizedPoint,
              targetViewportPoint: request.targetViewportPoint,
              samples: selectedDeepSamples
            },
            this.getDeepPersonalMapperOrThrow(),
            this.faceBaseline
          );
          logger11.info(
            "Robust independent validation point diagnostic",
            {
              calibrationId: request.calibrationId,
              pointIndex: request.pointIndex,
              bufferedDeepSampleCount: deepSamples.length,
              selectedDeepSampleCount: selectedDeepSamples.length,
              rawDeepSampleCount: deepPoint.rawDeepSampleCount,
              qualityRejectedDeepSampleCount: deepPoint.qualityRejectedDeepSampleCount,
              spatialOutlierRejectedDeepSampleCount: deepPoint.spatialOutlierRejectedDeepSampleCount,
              acceptedDeepSampleCount: deepPoint.acceptedDeepSampleCount,
              rawDeepCenterX: deepPoint.rawDeepCenterViewportPoint.x,
              rawDeepCenterY: deepPoint.rawDeepCenterViewportPoint.y,
              robustDeepCenterX: deepPoint.robustDeepCenterViewportPoint.x,
              robustDeepCenterY: deepPoint.robustDeepCenterViewportPoint.y,
              rawDeepPrecisionPx: deepPoint.rawDeepPrecisionPx,
              robustDeepPrecisionPx: deepPoint.robustDeepPrecisionPx,
              rawDeepErrorPx: deepPoint.rawDeepErrorPx,
              robustDeepErrorPx: deepPoint.errorPx,
              meanDeepConfidence: deepPoint.meanConfidence,
              deepErrorPx: deepPoint.errorPx,
              deepMeanPrecisionPx: deepPoint.meanPrecisionPx
            }
          );
        } catch (error) {
          logger11.warn(
            "Deep independent validation point could not be scored; authoritative baseline validation continues.",
            {
              calibrationId: request.calibrationId,
              pointIndex: request.pointIndex,
              bufferedDeepSampleCount: deepSamples.length,
              selectedDeepSampleCount: selectedDeepSamples.length,
              deepValidationSnapshot: this.deepIndependentValidator?.getSnapshot() ?? null,
              error: error instanceof Error ? error.message : "Unknown deep independent-validation error"
            }
          );
        }
      }
      logger11.info(
        "Validation point collection finished.",
        {
          calibrationId: result.calibrationId,
          pointIndex: result.pointIndex,
          sufficient: result.sufficient,
          acceptedSampleCount: result.acceptedSampleCount,
          rejectedSampleCount: result.rejectedSampleCount,
          completedPointCount: result.completedPointCount,
          expectedPointCount: result.expectedPointCount,
          validationComplete: result.validationComplete,
          quality: result.validation?.quality ?? null,
          meanErrorPx: result.validation?.metrics.meanErrorPx ?? null,
          p95ErrorPx: result.validation?.metrics.p95ErrorPx ?? null,
          meanErrorViewportWidthRatio: result.validation?.metrics.meanErrorViewportWidthRatio ?? null,
          meanPrecisionPx: result.validation?.metrics.meanPrecisionPx ?? null,
          validSampleRatio: result.validation?.metrics.validSampleRatio ?? null
        }
      );
      if (result.validationComplete && result.validation !== null) {
        const baselineValidation = evaluateBaselineSessionStrategyValidation(
          result.validation
        );
        this.selectedStrategyValidationResult = baselineValidation;
        this.authoritativeSessionValidationReady = baselineValidation.quality === "GOOD" || baselineValidation.quality === "ACCEPTABLE";
        this.authoritativeSessionDegradedCollectionAllowed = baselineValidation.quality === "POOR";
        if (!this.deepSessionStrategyEligible) {
          this.forceBaselineSessionStrategy = true;
        }
        this.independentValidationActive = false;
        this.runtimeGazeDriftMonitor.reset();
        this.lastLoggedRuntimeDriftSeverity = null;
        this.driftMonitorResumeAfterTimestampMs = nowTimelineMs() + DEEP_PERSONALIZATION.DRIFT_MONITOR_POST_VALIDATION_WARMUP_MS;
        logger11.info(
          `[ValidationSafetySummary] strategy=BASELINE_ONLY quality=${baselineValidation.quality} meanErrorPx=${baselineValidation.metrics.meanErrorPx.toFixed(1)} p95ErrorPx=${baselineValidation.metrics.p95ErrorPx.toFixed(1)} meanPrecisionPx=${baselineValidation.metrics.meanPrecisionPx.toFixed(1)} p95PrecisionPx=${baselineValidation.metrics.p95PrecisionPx.toFixed(1)} validRatio=${baselineValidation.metrics.validSampleRatio.toFixed(3)}`
        );
        logger11.info(
          "Baseline independent validation established the default session safety gate.",
          {
            calibrationId: request.calibrationId,
            quality: baselineValidation.quality,
            meanErrorPx: baselineValidation.metrics.meanErrorPx,
            p95ErrorPx: baselineValidation.metrics.p95ErrorPx,
            validationReady: this.authoritativeSessionValidationReady,
            degradedCollectionAllowed: this.authoritativeSessionDegradedCollectionAllowed,
            deepSessionStrategyEligible: this.deepSessionStrategyEligible,
            forceBaselineSessionStrategy: this.forceBaselineSessionStrategy
          }
        );
      }
      if (result.validationComplete && result.validation !== null && this.deepIndependentValidator?.getSnapshot().calibrationId === request.calibrationId) {
        try {
          const deepReport = this.getDeepIndependentValidatorOrThrow().finish();
          const baselineMetrics = result.validation.metrics;
          const deepMetrics2 = deepReport.metrics;
          const meanImprovementPx = baselineMetrics.meanErrorPx - deepMetrics2.meanErrorPx;
          const p95ImprovementPx = baselineMetrics.p95ErrorPx - deepMetrics2.p95ErrorPx;
          const precisionImprovementPx = baselineMetrics.meanPrecisionPx - deepMetrics2.meanPrecisionPx;
          logger11.info(
            "Robust aggregation summary",
            {
              calibrationId: request.calibrationId,
              baseline: {
                quality: result.validation.quality,
                meanErrorPx: baselineMetrics.meanErrorPx,
                medianErrorPx: baselineMetrics.medianErrorPx,
                rmsePx: baselineMetrics.rmsePx,
                p90ErrorPx: baselineMetrics.p90ErrorPx,
                p95ErrorPx: baselineMetrics.p95ErrorPx,
                centerErrorPx: baselineMetrics.centerErrorPx,
                edgeErrorPx: baselineMetrics.edgeErrorPx,
                cornerErrorPx: baselineMetrics.cornerErrorPx,
                meanPrecisionPx: baselineMetrics.meanPrecisionPx,
                p95PrecisionPx: baselineMetrics.p95PrecisionPx,
                validSampleRatio: baselineMetrics.validSampleRatio
              },
              deep: {
                pointCount: deepMetrics2.pointCount,
                totalSampleCount: deepMetrics2.totalSampleCount,
                meanSampleCountPerPoint: deepMetrics2.meanSampleCountPerPoint,
                meanConfidence: deepMetrics2.meanConfidence,
                rawMeanErrorPx: deepMetrics2.rawMeanErrorPx,
                rawP95ErrorPx: deepMetrics2.rawP95ErrorPx,
                meanErrorPx: deepMetrics2.meanErrorPx,
                medianErrorPx: deepMetrics2.medianErrorPx,
                rmsePx: deepMetrics2.rmsePx,
                p90ErrorPx: deepMetrics2.p90ErrorPx,
                p95ErrorPx: deepMetrics2.p95ErrorPx,
                centerErrorPx: deepMetrics2.centerErrorPx,
                edgeErrorPx: deepMetrics2.edgeErrorPx,
                cornerErrorPx: deepMetrics2.cornerErrorPx,
                meanPrecisionPx: deepMetrics2.meanPrecisionPx,
                p95PrecisionPx: deepMetrics2.p95PrecisionPx
              },
              improvement: {
                meanErrorPx: meanImprovementPx,
                meanErrorPercent: baselineMetrics.meanErrorPx > 0 ? meanImprovementPx / baselineMetrics.meanErrorPx * 100 : 0,
                p95ErrorPx: p95ImprovementPx,
                p95ErrorPercent: baselineMetrics.p95ErrorPx > 0 ? p95ImprovementPx / baselineMetrics.p95ErrorPx * 100 : 0,
                meanPrecisionPx: precisionImprovementPx,
                deepMeanErrorLower: deepMetrics2.meanErrorPx < baselineMetrics.meanErrorPx,
                deepP95ErrorLower: deepMetrics2.p95ErrorPx < baselineMetrics.p95ErrorPx
              }
            }
          );
          const baselinePointByIndex = new Map(
            result.validation.pointResults.map(
              (point) => [
                point.pointIndex,
                point
              ]
            )
          );
          for (const deepPoint of deepReport.pointResults) {
            const baselinePoint = baselinePointByIndex.get(
              deepPoint.pointIndex
            );
            if (baselinePoint === void 0) {
              continue;
            }
            logger11.info(
              "Dual independent validation point comparison.",
              {
                calibrationId: request.calibrationId,
                pointIndex: deepPoint.pointIndex,
                targetViewportPoint: deepPoint.targetViewportPoint,
                baselineErrorPx: baselinePoint.errorPx,
                deepErrorPx: deepPoint.errorPx,
                deepImprovementPx: baselinePoint.errorPx - deepPoint.errorPx,
                deepSampleCount: deepPoint.sampleCount,
                deepMeanConfidence: deepPoint.meanConfidence
              }
            );
          }
          const hybridSelector = this.calibrationHybridSelector;
          if (hybridSelector !== null && hybridSelector.getFitResult() !== null) {
            const hybridReport = evaluateHybridIndependentValidation(
              request.calibrationId,
              result.validation,
              deepReport,
              hybridSelector
            );
            const hybridMetrics2 = hybridReport.metrics;
            const calibrationSelectedValidation = evaluateSelectedSessionStrategyValidation(
              result.validation,
              deepReport,
              hybridReport
            );
            const baselineStrategyValidation = evaluateBaselineSessionStrategyValidation(
              result.validation
            );
            const calibrationSelectedPassed = calibrationSelectedValidation.quality === "GOOD" || calibrationSelectedValidation.quality === "ACCEPTABLE";
            const baselinePassed = baselineStrategyValidation.quality === "GOOD" || baselineStrategyValidation.quality === "ACCEPTABLE";
            const safetyDowngradeToBaseline = calibrationSelectedValidation.strategy !== "BASELINE_ONLY" && !calibrationSelectedPassed && baselinePassed;
            const selectedStrategyValidation = safetyDowngradeToBaseline ? baselineStrategyValidation : calibrationSelectedValidation;
            this.forceBaselineSessionStrategy = safetyDowngradeToBaseline;
            this.selectedStrategyValidationResult = selectedStrategyValidation;
            this.authoritativeSessionValidationReady = selectedStrategyValidation.quality === "GOOD" || selectedStrategyValidation.quality === "ACCEPTABLE";
            this.authoritativeSessionDegradedCollectionAllowed = selectedStrategyValidation.quality === "POOR";
            logger11.info(
              safetyDowngradeToBaseline ? "Calibration-selected Deep/Hybrid strategy did not pass the independent safety gate; session was demoted to the independently validated Baseline." : "Calibration-selected session strategy independent readiness evaluated.",
              {
                calibrationId: request.calibrationId,
                calibrationSelectedSessionStrategy: calibrationSelectedValidation.strategy,
                calibrationSelectedQuality: calibrationSelectedValidation.quality,
                selectedSessionStrategy: selectedStrategyValidation.strategy,
                quality: selectedStrategyValidation.quality,
                safetyDowngradeToBaseline,
                meanErrorPx: selectedStrategyValidation.metrics.meanErrorPx,
                p95ErrorPx: selectedStrategyValidation.metrics.p95ErrorPx,
                meanErrorViewportWidthRatio: selectedStrategyValidation.metrics.meanErrorViewportWidthRatio,
                p95ErrorViewportWidthRatio: selectedStrategyValidation.metrics.p95ErrorViewportWidthRatio,
                meanPrecisionPx: selectedStrategyValidation.metrics.meanPrecisionPx,
                p95PrecisionPx: selectedStrategyValidation.metrics.p95PrecisionPx,
                validSampleRatio: selectedStrategyValidation.metrics.validSampleRatio,
                authoritativeValidationReady: this.authoritativeSessionValidationReady,
                degradedCollectionAllowed: this.authoritativeSessionDegradedCollectionAllowed,
                recalibrationRecommended: !this.authoritativeSessionValidationReady
              }
            );
            logger11.info(
              "Calibration-only hybrid independent validation completed in shadow mode.",
              {
                calibrationId: request.calibrationId,
                baselineMeanErrorPx: baselineMetrics.meanErrorPx,
                deepMeanErrorPx: deepMetrics2.meanErrorPx,
                hybridMeanErrorPx: hybridMetrics2.meanErrorPx,
                selectedSessionStrategy: hybridMetrics2.selectedSessionStrategy,
                selectedStrategyMeanErrorPx: hybridMetrics2.selectedStrategyMeanErrorPx,
                selectedStrategyP95ErrorPx: hybridMetrics2.selectedStrategyP95ErrorPx,
                selectedStrategyRmsePx: hybridMetrics2.selectedStrategyRmsePx,
                selectedStrategyRegionHitRate: hybridMetrics2.selectedStrategyRegionHitRate,
                baselineP95ErrorPx: baselineMetrics.p95ErrorPx,
                deepP95ErrorPx: deepMetrics2.p95ErrorPx,
                hybridP95ErrorPx: hybridMetrics2.p95ErrorPx,
                baselineBiasCorrectedMeanErrorPx: hybridMetrics2.baselineBiasCorrectedMeanErrorPx,
                baselineBiasCorrectedP95ErrorPx: hybridMetrics2.baselineBiasCorrectedP95ErrorPx,
                deepBiasCorrectedMeanErrorPx: hybridMetrics2.deepBiasCorrectedMeanErrorPx,
                deepBiasCorrectedP95ErrorPx: hybridMetrics2.deepBiasCorrectedP95ErrorPx,
                hybridMedianErrorPx: hybridMetrics2.medianErrorPx,
                hybridRmsePx: hybridMetrics2.rmsePx,
                hybridCenterErrorPx: hybridMetrics2.centerErrorPx,
                hybridEdgeErrorPx: hybridMetrics2.edgeErrorPx,
                hybridCornerErrorPx: hybridMetrics2.cornerErrorPx,
                baselineRegionHitRate: hybridMetrics2.baselineRegionHitRate,
                deepRegionHitRate: hybridMetrics2.deepRegionHitRate,
                hybridRegionHitRate: hybridMetrics2.hybridRegionHitRate,
                hybridAmbiguousRegionRate: hybridMetrics2.hybridAmbiguousRegionRate,
                meanAdaptiveUncertaintyRadiusNormalized: hybridMetrics2.meanAdaptiveUncertaintyRadiusNormalized,
                p95AdaptiveUncertaintyRadiusNormalized: hybridMetrics2.p95AdaptiveUncertaintyRadiusNormalized,
                uncertaintyClampRate: hybridMetrics2.uncertaintyClampRate,
                baselineHorizontalBandHitRate: hybridMetrics2.baselineHorizontalBandHitRate,
                deepHorizontalBandHitRate: hybridMetrics2.deepHorizontalBandHitRate,
                hybridHorizontalBandHitRate: hybridMetrics2.hybridHorizontalBandHitRate,
                baselineVerticalBandHitRate: hybridMetrics2.baselineVerticalBandHitRate,
                deepVerticalBandHitRate: hybridMetrics2.deepVerticalBandHitRate,
                hybridVerticalBandHitRate: hybridMetrics2.hybridVerticalBandHitRate,
                hybridVsBaselineMeanImprovementPercent: baselineMetrics.meanErrorPx > 0 ? (baselineMetrics.meanErrorPx - hybridMetrics2.meanErrorPx) / baselineMetrics.meanErrorPx * 100 : 0,
                hybridVsDeepMeanImprovementPercent: deepMetrics2.meanErrorPx > 0 ? (deepMetrics2.meanErrorPx - hybridMetrics2.meanErrorPx) / deepMetrics2.meanErrorPx * 100 : 0,
                selectedStrategyVsBaselineMeanImprovementPercent: baselineMetrics.meanErrorPx > 0 ? (baselineMetrics.meanErrorPx - hybridMetrics2.selectedStrategyMeanErrorPx) / baselineMetrics.meanErrorPx * 100 : 0,
                selectedStrategyVsDeepMeanImprovementPercent: deepMetrics2.meanErrorPx > 0 ? (deepMetrics2.meanErrorPx - hybridMetrics2.selectedStrategyMeanErrorPx) / deepMetrics2.meanErrorPx * 100 : 0
              }
            );
            for (const hybridPoint of hybridReport.pointResults) {
              logger11.info(
                "Calibration-only hybrid independent validation point diagnostic.",
                {
                  calibrationId: request.calibrationId,
                  pointIndex: hybridPoint.pointIndex,
                  targetViewportPoint: hybridPoint.targetViewportPoint,
                  targetSpatialBucket: hybridPoint.targetSpatialBucket,
                  routingBucket: hybridPoint.routingBucket,
                  directionalRoutingBucket: hybridPoint.directionalRoutingBucket,
                  targetGazeRegion: hybridPoint.targetGazeRegion,
                  baselineGazeRegion: hybridPoint.baselineGazeRegion,
                  deepGazeRegion: hybridPoint.deepGazeRegion,
                  hybridGazeRegion: hybridPoint.hybridGazeRegion,
                  baselineRegionHit: hybridPoint.baselineRegionHit,
                  deepRegionHit: hybridPoint.deepRegionHit,
                  hybridRegionHit: hybridPoint.hybridRegionHit,
                  hybridRegionAmbiguous: hybridPoint.hybridRegionAmbiguous,
                  hybridRegionBoundaryMarginNormalized: hybridPoint.hybridRegionBoundaryMarginNormalized,
                  baselineErrorPx: hybridPoint.baselineErrorPx,
                  deepErrorPx: hybridPoint.deepErrorPx,
                  baselineBiasCorrectedErrorPx: hybridPoint.baselineBiasCorrectedErrorPx,
                  deepBiasCorrectedErrorPx: hybridPoint.deepBiasCorrectedErrorPx,
                  baselineBiasCorrectionApplied: hybridPoint.baselineBiasCorrectionApplied,
                  deepBiasCorrectionApplied: hybridPoint.deepBiasCorrectionApplied,
                  baselineBiasCorrectionStrength: hybridPoint.baselineBiasCorrectionStrength,
                  deepBiasCorrectionStrength: hybridPoint.deepBiasCorrectionStrength,
                  baselineBiasCorrectionViewportPx: hybridPoint.baselineBiasCorrectionViewportPx,
                  deepBiasCorrectionViewportPx: hybridPoint.deepBiasCorrectionViewportPx,
                  hybridErrorPx: hybridPoint.hybridErrorPx,
                  selectedSessionStrategy: hybridPoint.selectedSessionStrategy,
                  selectedStrategyErrorPx: hybridPoint.selectedStrategyErrorPx,
                  selectedStrategyGazeRegion: hybridPoint.selectedStrategyGazeRegion,
                  selectedStrategyRegionHit: hybridPoint.selectedStrategyRegionHit,
                  selectedStrategyDeepWeight: hybridPoint.selectedStrategyDeepWeight,
                  calibrationRoutingInfluence: hybridPoint.calibrationRoutingInfluence,
                  liveRoutingAttenuation: hybridPoint.liveRoutingAttenuation,
                  effectiveRoutingInfluence: hybridPoint.effectiveRoutingInfluence,
                  baselineExpectedErrorPx: hybridPoint.baselineExpectedErrorPx,
                  deepExpectedErrorPx: hybridPoint.deepExpectedErrorPx,
                  expectedHybridErrorPx: hybridPoint.expectedHybridErrorPx,
                  directionalPriorReliability: hybridPoint.directionalPriorReliability,
                  driftSeverity: hybridPoint.driftSeverity,
                  deepConfidencePenaltyMultiplier: hybridPoint.deepConfidencePenaltyMultiplier,
                  baselineStabilityPenaltyMultiplier: hybridPoint.baselineStabilityPenaltyMultiplier,
                  deepStabilityPenaltyMultiplier: hybridPoint.deepStabilityPenaltyMultiplier,
                  baselineMeanPrecisionPx: hybridPoint.baselineMeanPrecisionPx,
                  deepMeanPrecisionPx: hybridPoint.deepMeanPrecisionPx,
                  rawModelDisagreementNormalized: hybridPoint.rawModelDisagreementNormalized,
                  modelDisagreementNormalized: hybridPoint.modelDisagreementNormalized,
                  adaptiveUncertaintyRadiusNormalized: hybridPoint.adaptiveUncertaintyRadiusNormalized,
                  uncertaintyUnclampedRadiusNormalized: hybridPoint.uncertaintyUnclampedRadiusNormalized,
                  uncertaintyCalibrationPriorRadiusNormalized: hybridPoint.uncertaintyCalibrationPriorRadiusNormalized,
                  uncertaintyTemporalNoiseRadiusNormalized: hybridPoint.uncertaintyTemporalNoiseRadiusNormalized,
                  uncertaintyDisagreementRadiusNormalized: hybridPoint.uncertaintyDisagreementRadiusNormalized,
                  uncertaintyBaselineRetentionRatio: hybridPoint.uncertaintyBaselineRetentionRatio,
                  uncertaintyDeepRetentionRatio: hybridPoint.uncertaintyDeepRetentionRatio,
                  uncertaintyClamped: hybridPoint.uncertaintyClamped,
                  baselineWeight: hybridPoint.baselineWeight,
                  deepWeight: hybridPoint.deepWeight,
                  errorDerivedDeepWeight: hybridPoint.errorDerivedDeepWeight,
                  calibrationReliabilityDeepWeight: hybridPoint.calibrationReliabilityDeepWeight,
                  calibrationReliabilityRoutingApplied: hybridPoint.calibrationReliabilityRoutingApplied,
                  coarseCalibrationReliabilityDeepWeight: hybridPoint.coarseCalibrationReliabilityDeepWeight,
                  coarseCalibrationReliabilityRoutingApplied: hybridPoint.coarseCalibrationReliabilityRoutingApplied,
                  activeReliabilityRoutingMode: hybridPoint.activeReliabilityRoutingMode,
                  deepMeanConfidence: hybridPoint.deepMeanConfidence,
                  deepSampleCount: hybridPoint.deepSampleCount,
                  drift: {
                    deltaHeadYawDeg: hybridPoint.meanDeltaHeadYawDeg,
                    deltaHeadPitchDeg: hybridPoint.meanDeltaHeadPitchDeg,
                    deltaHeadRollDeg: hybridPoint.meanDeltaHeadRollDeg,
                    deltaFaceCenterX: hybridPoint.meanDeltaFaceCenterX,
                    deltaFaceCenterY: hybridPoint.meanDeltaFaceCenterY,
                    faceWidthScaleDelta: hybridPoint.meanFaceWidthScaleDelta,
                    faceHeightScaleDelta: hybridPoint.meanFaceHeightScaleDelta,
                    faceDistanceDelta: hybridPoint.meanFaceDistanceDelta
                  }
                }
              );
            }
          }
        } catch (error) {
          this.forceBaselineSessionStrategy = true;
          logger11.warn(
            "Deep independent validation comparison could not be completed; independently validated Baseline is authoritative for this session.",
            {
              calibrationId: request.calibrationId,
              deepValidationSnapshot: this.deepIndependentValidator?.getSnapshot() ?? null,
              error: error instanceof Error ? error.message : "Unknown deep independent-validation completion error"
            }
          );
        }
      }
      if (result.validationComplete && this.quickRecalibrationActive) {
        this.completedQuickValidationResult = this.selectedStrategyValidationResult;
        const passed = this.authoritativeSessionValidationReady && (this.completedQuickValidationResult?.quality === "GOOD" || this.completedQuickValidationResult?.quality === "ACCEPTABLE");
        if (!passed && this.quickRecalibrationRunId !== null) {
          this.abortQuickRecalibration(request.calibrationId, this.quickRecalibrationRunId);
        } else {
          this.quickRecalibrationCheckpoint = null;
          this.quickRecalibrationRunId = null;
          if (this.quickRecalibrationTimeoutId !== null) {
            window.clearTimeout(this.quickRecalibrationTimeoutId);
            this.quickRecalibrationTimeoutId = null;
          }
        }
        this.quickRecalibrationActive = false;
        if (passed) {
          this.runtimeGazeDriftMonitor.reset();
          this.runtimeDeepFeatureAggregator.reset();
          this.baselinePrecisionEstimator.reset();
          this.deepPrecisionEstimator.reset();
          this.authoritativeGazeStabilizer.reset();
          this.fixationDetector.reset();
          this.latestBaselinePrecisionPx = null;
          this.latestDeepPrecisionPx = null;
          this.lastLoggedRuntimeDriftSeverity = null;
        }
        logger11.info(
          passed ? "Quick recalibration candidate committed after independent validation." : "Quick recalibration candidate rejected; previous model restored.",
          {
            calibrationId: request.calibrationId,
            candidateValidationQuality: this.completedQuickValidationResult?.quality ?? result.validation?.quality ?? null,
            candidateValidationPassed: passed,
            previousModelRestored: !passed
          }
        );
      }
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    }
  }
  cancelActiveValidationPoint(error) {
    const request = this.activeValidationPointRequest;
    if (request === null) {
      return;
    }
    this.activeValidationPointRequest = null;
    this.activeDeepValidationSamples = [];
    window.clearTimeout(
      request.timeoutId
    );
    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }
    request.reject(error);
  }
  async startFacePositioningInternal(generation) {
    const landmarker = this.getFaceLandmarkerOrThrow();
    try {
      await landmarker.initialize();
      await this.initializeGazePredictorForFacePipeline();
      this.assertFaceAnalysisGeneration(
        generation
      );
      this.assertCameraRunning();
      this.resetFaceTemporalState();
      this.faceAnalysisRunning = true;
      const firstFrame = this.processCurrentFaceFrame(
        generation
      );
      this.startGazePrediction(
        firstFrame,
        generation
      );
      this.scheduleNextFaceFrame(
        generation
      );
      logger11.info(
        "Face positioning pipeline started.",
        {
          frameSequence: firstFrame.quality.frameSequence,
          usableForGaze: firstFrame.quality.usableForGaze,
          scheduler: "OFFSCREEN_TIMER",
          targetAnalysisRateHz: FACE_PIPELINE_RUNTIME.TARGET_ANALYSIS_RATE_HZ
        }
      );
      return firstFrame.quality;
    } catch (error) {
      this.stopFaceAnalysis();
      throw normalizeTrackerError(
        error,
        ERROR_CODES.FACE_DETECTION_FAILED,
        "FACE",
        "Face positioning pipeline could not start."
      );
    }
  }
  processCurrentFaceFrame(generation) {
    this.assertFaceAnalysisGeneration(
      generation
    );
    const frame = this.getFrameCapture().captureCurrentFrame();
    const cameraQuality = this.evaluateCameraQuality(
      frame
    );
    const landmarkerResult = this.getFaceLandmarkerOrThrow().detect(frame);
    const geometryResult = this.getFaceGeometryAnalyzerOrThrow().analyze(
      landmarkerResult
    );
    const headPoseResult = this.getHeadPoseEstimatorOrThrow().analyze(
      landmarkerResult,
      geometryResult
    );
    const eyeGeometryResult = this.getEyeGeometryAnalyzerOrThrow().analyze(
      landmarkerResult
    );
    const blinkResult = this.getBlinkDetectorOrThrow().analyze(
      eyeGeometryResult
    );
    const qualityResult = this.getFaceQualityEvaluatorOrThrow().evaluate({
      landmarker: landmarkerResult,
      geometry: geometryResult,
      headPose: headPoseResult,
      eyes: eyeGeometryResult,
      blink: blinkResult,
      cameraQuality
    });
    const preCalibration = this.getPreCalibrationMonitorOrThrow().evaluate({
      geometry: geometryResult,
      headPose: headPoseResult,
      quality: qualityResult,
      cameraQuality
    });
    this.latestFaceQuality = qualityResult;
    this.latestPreCalibrationFeedback = preCalibration.feedback;
    if (preCalibration.baselineCaptured && preCalibration.baseline !== null) {
      this.faceBaseline = preCalibration.baseline;
      logger11.info(
        "Pre-calibration face baseline captured.",
        {
          frameSequence: qualityResult.frameSequence,
          sampleStableDurationMs: preCalibration.feedback.metrics.stableDurationMs,
          width: preCalibration.baseline.width,
          height: preCalibration.baseline.height
        }
      );
    }
    this.emitFaceQualityFrame(
      qualityResult,
      preCalibration.feedback
    );
    return {
      frame,
      landmarker: landmarkerResult,
      faceGeometry: geometryResult,
      headPose: headPoseResult,
      eyeGeometry: eyeGeometryResult,
      blink: blinkResult,
      quality: qualityResult
    };
  }
  evaluateCameraQuality(frame) {
    try {
      const quality = this.getCameraQualityEstimator().evaluate(frame);
      this.latestCameraQuality = quality;
      return quality;
    } catch (error) {
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.CAMERA_QUALITY_FAILED,
        "CAMERA",
        "Camera quality evaluation failed during face analysis."
      );
      this.latestCameraQuality = null;
      this.reportFacePipelineError(
        normalized
      );
      return null;
    }
  }
  /**
   * Schedules the next face-analysis cycle independently of page/video
   * compositing. Offscreen Documents can stop receiving
   * requestVideoFrameCallback() callbacks even while their MediaStream keeps
   * producing frames, which previously left the pipeline permanently stuck
   * after the startup frame.
   */
  scheduleNextFaceFrame(generation, delayMs = this.faceFrameIntervalMs) {
    if (!this.faceAnalysisRunning || generation !== this.faceAnalysisGeneration || this.faceFrameTimerId !== null) {
      return;
    }
    this.faceFrameTimerId = window.setTimeout(
      () => {
        this.faceFrameTimerId = null;
        this.handleScheduledFaceFrame(
          generation
        );
      },
      Math.max(
        0,
        delayMs
      )
    );
  }
  handleScheduledFaceFrame(generation) {
    if (!this.faceAnalysisRunning || generation !== this.faceAnalysisGeneration) {
      return;
    }
    const cycleStartedAtMs = performance.now();
    try {
      const frame = this.processCurrentFaceFrame(
        generation
      );
      this.startGazePrediction(
        frame,
        generation
      );
    } catch (error) {
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.FACE_DETECTION_FAILED,
        "FACE",
        "Face analysis failed for the current camera frame."
      );
      if (!normalized.recoverable) {
        this.stopFaceAnalysis();
        this.handleRuntimeError(
          normalized
        );
        return;
      }
      this.reportFacePipelineError(
        normalized
      );
    }
    const processingDurationMs = performance.now() - cycleStartedAtMs;
    const nextDelayMs = Math.max(
      0,
      this.faceFrameIntervalMs - processingDurationMs
    );
    this.scheduleNextFaceFrame(
      generation,
      nextDelayMs
    );
  }
  async initializeGazePredictorForFacePipeline() {
    const predictor = this.getGazePredictorOrThrow();
    if (predictor.getSnapshot().lifecycle === "READY") {
      return;
    }
    try {
      await predictor.initialize();
    } catch (error) {
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Gaze predictor initialization failed during face pipeline startup."
      );
      this.handleRuntimeError(normalized);
    }
  }
  startGazePrediction(frame, generation) {
    const predictor = this.gazePredictor;
    if (predictor === null || predictor.getSnapshot().lifecycle !== "READY" || this.gazePredictionInFlight) {
      return;
    }
    this.gazePredictionInFlight = true;
    void this.processGazePrediction(
      predictor,
      frame,
      generation
    ).finally(
      () => {
        this.gazePredictionInFlight = false;
      }
    );
  }
  invalidatePendingGaze() {
    this.gazeContextGeneration += 1;
    this.gazePredictor?.invalidateObserverSamples();
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
  }
  async processGazePrediction(predictor, frame, generation) {
    const contextGeneration = this.gazeContextGeneration;
    const input = {
      frame: frame.frame,
      landmarker: frame.landmarker,
      faceGeometry: frame.faceGeometry,
      headPose: frame.headPose,
      eyeGeometry: frame.eyeGeometry,
      blink: frame.blink,
      faceQuality: frame.quality
    };
    try {
      const prediction = await predictor.predict(input);
      if (prediction === null || !this.faceAnalysisRunning || contextGeneration !== this.gazeContextGeneration || generation !== this.faceAnalysisGeneration) {
        return;
      }
      const validation = validateGazePrediction(
        prediction,
        {
          expectedTimestampMs: frame.frame.metadata.timestampMs
        }
      );
      const quality = evaluateGazeQuality({
        prediction,
        validation,
        faceQuality: frame.quality
      });
      const routedBaselinePrediction = this.createCalibratedRuntimeBaselinePrediction(
        prediction
      );
      if (validation.valid && quality.valid) {
        this.rememberRuntimeBaselinePrediction(
          frame.frame.metadata.frameSequence,
          routedBaselinePrediction
        );
      } else {
        this.baselinePrecisionEstimator.reset();
        this.deepPrecisionEstimator.reset();
        this.runtimeDeepFeatureAggregator.reset();
        this.latestDeepPrecisionPx = null;
        this.latestPersonalizedDeepRuntimeCandidate = null;
      }
      this.latestBaselinePrecisionPx = validation.valid && quality.valid && routedBaselinePrediction.rawSpace === "NORMALIZED" ? this.baselinePrecisionEstimator.update(
        routedBaselinePrediction.timestampMs,
        routedBaselinePrediction.rawPoint,
        this.trackingViewportSize
      ) : null;
      const currentDrift = this.createCurrentRuntimeDrift(frame);
      const driftMonitoringAllowed = !this.independentValidationActive && prediction.timestampMs >= this.driftMonitorResumeAfterTimestampMs && (this.authoritativeSessionValidationReady || this.authoritativeSessionDegradedCollectionAllowed);
      const rawDriftStatus = driftMonitoringAllowed ? this.runtimeGazeDriftMonitor.update(
        prediction.timestampMs,
        validation.valid && quality.valid ? currentDrift : null,
        this.trackingViewportSize,
        this.latestBaselinePrecisionPx,
        quality.score
      ) : null;
      const driftStatus = rawDriftStatus === null ? null : this.automaticQuickRecalibrationEnabled ? rawDriftStatus : {
        ...rawDriftStatus,
        quickRecalibrationRecommended: false
      };
      if (driftStatus !== null && (driftStatus.severity !== this.lastLoggedRuntimeDriftSeverity || driftStatus.quickRecalibrationRecommended)) {
        logger11.info(
          "Runtime calibration drift state changed.",
          {
            severity: driftStatus.severity,
            faceCenterDeltaPx: driftStatus.faceCenterDeltaPx,
            faceDistanceDeltaRatio: driftStatus.faceDistanceDeltaRatio,
            yawDeltaDeg: driftStatus.yawDeltaDeg,
            pitchDeltaDeg: driftStatus.pitchDeltaDeg,
            rollDeltaDeg: driftStatus.rollDeltaDeg,
            baselinePrecisionPx: this.latestBaselinePrecisionPx,
            deepPrecisionPx: this.latestDeepPrecisionPx,
            precisionReferencePx: driftStatus.precisionReferencePx ?? null,
            precisionRatio: driftStatus.precisionRatio ?? null,
            monitoringElapsedMs: driftStatus.monitoringElapsedMs ?? null,
            periodicMaintenanceDue: driftStatus.periodicMaintenanceDue ?? false,
            maintenanceReason: driftStatus.maintenanceReason ?? null,
            quickRecalibrationRecommended: driftStatus.quickRecalibrationRecommended
          }
        );
        this.lastLoggedRuntimeDriftSeverity = driftStatus.severity;
      }
      const driftQualityMultiplier = driftStatus?.severity === "HIGH" ? RUNTIME_MAINTENANCE.HIGH_DRIFT_QUALITY_MULTIPLIER : driftStatus?.severity === "MEDIUM" ? RUNTIME_MAINTENANCE.MEDIUM_DRIFT_QUALITY_MULTIPLIER : 1;
      const effectiveQualityScore = Math.min(
        1,
        Math.max(0, quality.score * driftQualityMultiplier)
      );
      const collectionSuspendedForDrift = RUNTIME_MAINTENANCE.SUSPEND_COLLECTION_ON_RECALIBRATION_RECOMMENDATION && driftStatus?.quickRecalibrationRecommended === true;
      const authoritativeGaze = selectSessionRuntimeGaze(
        routedBaselinePrediction,
        this.latestPersonalizedDeepRuntimeCandidate,
        this.calibrationHybridSelector,
        {
          validationReady: this.authoritativeSessionValidationReady,
          allowDegradedCollection: this.authoritativeSessionDegradedCollectionAllowed,
          currentDrift,
          baselinePrecisionPx: this.latestBaselinePrecisionPx,
          deepPrecisionPx: this.latestDeepPrecisionPx,
          forceBaselineStrategy: this.forceBaselineSessionStrategy,
          forceBaselineForDrift: rawDriftStatus?.quickRecalibrationRecommended === true,
          suspendCollectionForDrift: collectionSuspendedForDrift
        }
      );
      const precisionRatio = driftStatus?.precisionRatio ?? null;
      const adaptiveSmoothingMultiplier = precisionRatio !== null && Number.isFinite(precisionRatio) && precisionRatio > RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_START_RATIO ? Math.min(
        RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_MAX_MULTIPLIER,
        1 + (precisionRatio - RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_START_RATIO) * RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_GAIN
      ) : 1;
      const stabilizedGaze = this.authoritativeGazeStabilizer.update({
        timestampMs: prediction.timestampMs,
        normalizedPoint: authoritativeGaze.normalizedPoint,
        viewport: this.trackingViewportSize,
        gazeValid: authoritativeGaze.collectionAllowed && validation.valid && quality.valid,
        smoothingMultiplier: adaptiveSmoothingMultiplier
      });
      const fixation = this.fixationDetector.update({
        timestampMs: prediction.timestampMs,
        stabilizedViewportPoint: stabilizedGaze.stabilizedViewportPoint,
        currentSampleValid: stabilizedGaze.currentSampleValid,
        stabilizedSpeedPxPerSecond: stabilizedGaze.stabilizedSpeedPxPerSecond,
        qualityScore: effectiveQualityScore,
        authoritativeStrategy: authoritativeGaze.strategy
      });
      const result = {
        frameSequence: frame.frame.metadata.frameSequence,
        prediction,
        validation,
        quality,
        observer: predictor.getSnapshot().observer,
        authoritativeGaze,
        driftStatus,
        effectiveQualityScore,
        baselinePrecisionPx: this.latestBaselinePrecisionPx,
        deepPrecisionPx: this.latestDeepPrecisionPx,
        collectionSuspendedForDrift,
        maintenanceCalibrationActive: this.quickRecalibrationActive,
        stabilizedGaze,
        fixation
      };
      this.latestGazeFrame = result;
      this.observeCalibrationFrame(
        result,
        frame.quality,
        frame.faceGeometry
      );
      this.observeValidationFrame(
        result,
        frame.quality,
        frame.faceGeometry
      );
      this.emitGazeRuntimeFrame(result);
    } catch (error) {
      const normalized = normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "Gaze prediction failed for the current camera frame."
      );
      this.handleRuntimeError(normalized);
    }
  }
  /**
   * Runtime authoritative routing must use the same participant-specific
   * screen correction that independent validation evaluated. The original
   * prediction remains in GazeRuntimeFrameResult so raw research data is
   * preserved and no validation/calibration target leaks into runtime.
   */
  createCalibratedRuntimeBaselinePrediction(prediction) {
    const corrector = this.residualCorrector;
    const viewport = this.trackingViewportSize;
    if (prediction.rawSpace !== "NORMALIZED" || corrector === null || !corrector.hasModel() || viewport === null) {
      return prediction;
    }
    try {
      const corrected = corrector.correct(
        prediction.rawPoint,
        prediction.rawSpace,
        viewport
      );
      return {
        ...prediction,
        rawPoint: {
          ...corrected.correctedNormalizedPoint
        }
      };
    } catch {
      return prediction;
    }
  }
  rememberRuntimeBaselinePrediction(frameSequence, prediction) {
    if (prediction.rawSpace !== "NORMALIZED" || !Number.isFinite(prediction.rawPoint.x) || !Number.isFinite(prediction.rawPoint.y)) {
      return;
    }
    this.runtimeBaselineHistory.set(
      frameSequence,
      {
        frameSequence,
        timestampMs: prediction.timestampMs,
        normalizedPoint: {
          x: prediction.rawPoint.x,
          y: prediction.rawPoint.y
        }
      }
    );
    const oldestAllowedTimestampMs = prediction.timestampMs - DEEP_PERSONALIZATION.LIVE_DEEP_MAX_SOURCE_AGE_MS;
    for (const [
      key,
      sample
    ] of this.runtimeBaselineHistory) {
      if (sample.timestampMs < oldestAllowedTimestampMs) {
        this.runtimeBaselineHistory.delete(key);
      }
    }
  }
  createCurrentRuntimeDrift(frame) {
    const baseline = this.faceBaseline;
    const geometry = frame.faceGeometry.geometry;
    const headPose = frame.headPose.headPose;
    if (baseline === null || geometry === null || headPose === null) {
      return null;
    }
    const baselineWidth = Math.max(
      Number.EPSILON,
      baseline.width
    );
    const baselineHeight = Math.max(
      Number.EPSILON,
      baseline.height
    );
    const baselineDistance = Math.max(
      Number.EPSILON,
      baseline.distanceRatio
    );
    return {
      deltaHeadYawDeg: headPose.yawDeg - baseline.headPose.yawDeg,
      deltaHeadPitchDeg: headPose.pitchDeg - baseline.headPose.pitchDeg,
      deltaHeadRollDeg: headPose.rollDeg - baseline.headPose.rollDeg,
      deltaFaceCenterX: geometry.centerNormalized.x - baseline.centerX,
      deltaFaceCenterY: geometry.centerNormalized.y - baseline.centerY,
      faceWidthScaleDelta: geometry.widthRatio / baselineWidth - 1,
      faceHeightScaleDelta: geometry.heightRatio / baselineHeight - 1,
      faceDistanceDelta: frame.quality.trackingQuality.faceDistanceRatio / baselineDistance - 1
    };
  }
  emitGazeRuntimeFrame(result) {
    if (this.onGazeRuntimeFrame === null) {
      return;
    }
    try {
      this.onGazeRuntimeFrame(result);
    } catch (error) {
      logger11.warn(
        "Gaze runtime frame callback failed.",
        {
          error: error instanceof Error ? error.message : "Unknown gaze callback error"
        }
      );
    }
  }
  stopFaceAnalysis() {
    this.invalidatePendingGaze();
    this.faceAnalysisGeneration += 1;
    this.faceAnalysisRunning = false;
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
    this.authoritativeSessionValidationReady = false;
    this.authoritativeSessionDegradedCollectionAllowed = false;
    this.selectedStrategyValidationResult = null;
    this.deepSessionStrategyEligible = false;
    this.forceBaselineSessionStrategy = false;
    this.independentValidationActive = false;
    this.driftMonitorResumeAfterTimestampMs = 0;
    this.trackingViewportSize = null;
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();
    this.cancelActiveCalibrationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration point collection stopped with the face-analysis pipeline."
      )
    );
    this.cancelActiveValidationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation point collection stopped with the face-analysis pipeline."
      )
    );
    this.quickRecalibrationActive = false;
    this.quickRecalibrationCheckpoint = null;
    this.quickRecalibrationRunId = null;
    this.completedQuickValidationResult = null;
    if (this.quickRecalibrationTimeoutId !== null) {
      window.clearTimeout(this.quickRecalibrationTimeoutId);
      this.quickRecalibrationTimeoutId = null;
    }
    this.calibrationManager?.reset();
    this.validationManager?.reset();
    this.residualCorrector?.clear();
    this.deepPersonalMapper?.reset();
    this.deepIndependentValidator?.reset();
    this.calibrationHybridSelector?.reset();
    this.activeDeepCalibrationSamples = [];
    this.activeDeepValidationSamples = [];
    this.deepPersonalPredictionCount = 0;
    if (this.faceFrameTimerId !== null) {
      window.clearTimeout(
        this.faceFrameTimerId
      );
      this.faceFrameTimerId = null;
    }
    this.resetFaceTemporalState();
    this.latestCameraQuality = null;
    this.latestFaceQuality = null;
    this.latestGazeFrame = null;
    this.lastReportedFaceErrorAtMs = null;
    this.lastReportedFaceErrorCode = null;
  }
  beginFaceAnalysisGeneration() {
    this.stopFaceAnalysis();
    return this.faceAnalysisGeneration;
  }
  resetFaceTemporalState() {
    this.blinkDetector?.reset();
    this.faceQualityEvaluator?.reset();
    this.preCalibrationMonitor?.reset();
    this.cameraQualityEstimator?.reset();
    this.frameCapture?.reset();
    this.latestPreCalibrationFeedback = null;
    this.faceBaseline = null;
  }
  assertFaceAnalysisGeneration(generation) {
    this.assertUsable();
    if (generation === this.faceAnalysisGeneration) {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face analysis startup was cancelled by a newer runtime operation."
    );
  }
  assertCameraRunning() {
    const snapshot = this.getCameraManagerOrThrow().getSnapshot();
    if (snapshot.running) {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face analysis requires an active camera stream."
    );
  }
  reportFacePipelineError(error) {
    const now = nowEpochMs();
    const duplicateWithinWindow = this.lastReportedFaceErrorCode === error.code && this.lastReportedFaceErrorAtMs !== null && now - this.lastReportedFaceErrorAtMs < FACE_PIPELINE_RUNTIME.ERROR_REPORT_THROTTLE_MS;
    if (duplicateWithinWindow) {
      return;
    }
    this.lastReportedFaceErrorCode = error.code;
    this.lastReportedFaceErrorAtMs = now;
    this.handleRuntimeError(error);
  }
  emitFaceQualityFrame(result, feedback) {
    if (this.onFaceQualityFrame === null) {
      return;
    }
    try {
      this.onFaceQualityFrame(
        result,
        feedback
      );
    } catch (error) {
      logger11.error(
        "Face-quality frame bridge failed.",
        {
          bridgeMessage: error instanceof Error ? error.message : "Unknown face-quality bridge failure"
        }
      );
    }
  }
  /* ========================================================================
   * Runtime state
   * ====================================================================== */
  isReady() {
    return this.lifecycle === "READY";
  }
  isDisposed() {
    return this.lifecycle === "DISPOSED";
  }
  getSnapshot() {
    const cameraSnapshot = this.cameraManager?.getSnapshot() ?? null;
    return {
      lifecycle: this.lifecycle,
      initializedAtEpochMs: this.initializedAtEpochMs,
      disposedAtEpochMs: this.disposedAtEpochMs,
      hasVideoElement: true,
      hasAttachedMediaStream: this.videoElement.srcObject !== null,
      cameraRunning: cameraSnapshot?.running ?? false,
      cameraSettings: cameraSnapshot?.settings ?? null,
      faceLandmarkerReady: this.faceLandmarker?.isReady() ?? false,
      faceAnalysisRunning: this.faceAnalysisRunning,
      lastFaceAnalysisTimestampMs: this.latestFaceQuality?.timestampMs ?? null,
      gazePredictorReady: this.gazePredictor?.getSnapshot().lifecycle === "READY",
      gazePredictionInFlight: this.gazePredictionInFlight,
      lastGazePredictionTimestampMs: this.latestGazeFrame?.prediction.timestampMs ?? null,
      lastGazeSource: this.latestGazeFrame?.prediction.source ?? null,
      faceBaselineReady: this.faceBaseline !== null,
      calibrationActive: this.calibrationManager?.getSnapshot().active ?? false,
      calibrationModelReady: this.calibrationManager?.getSnapshot().modelReady ?? false
    };
  }
  /**
   * Provides the dedicated runtime video element to later local-only modules
   * when direct video input is required by a browser ML API.
   */
  getVideoElement() {
    this.assertUsable();
    return this.videoElement;
  }
  /* ========================================================================
   * Disposal
   * ====================================================================== */
  /**
   * Releases the camera, local ML model, and Offscreen runtime shell.
   */
  dispose() {
    if (this.lifecycle === "DISPOSED" || this.lifecycle === "DISPOSING") {
      return;
    }
    this.lifecycle = "DISPOSING";
    try {
      this.stopFaceAnalysis();
      this.faceLandmarker?.dispose();
      this.disposeGazePredictorBestEffort();
      this.cameraManager?.dispose();
      this.frameCapture?.dispose();
      this.cameraQualityEstimator?.dispose();
      this.cameraManager = null;
      this.frameCapture = null;
      this.cameraQualityEstimator = null;
      this.faceLandmarker = null;
      this.faceGeometryAnalyzer = null;
      this.headPoseEstimator = null;
      this.eyeGeometryAnalyzer = null;
      this.blinkDetector = null;
      this.faceQualityEvaluator = null;
      this.preCalibrationMonitor = null;
      this.calibrationManager = null;
      this.validationManager = null;
      this.deepPersonalMapper = null;
      this.deepIndependentValidator = null;
      this.calibrationHybridSelector = null;
      this.residualCorrector = null;
      this.activeCalibrationPointRequest = null;
      this.activeValidationPointRequest = null;
      this.latestPreCalibrationFeedback = null;
      this.faceBaseline = null;
      this.gazePredictor = null;
      this.latestGazeFrame = null;
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.disposedAtEpochMs = nowEpochMs();
      this.lifecycle = "DISPOSED";
      logger11.info(
        "Offscreen tracker runtime disposed."
      );
    } catch (error) {
      this.lifecycle = "ERROR";
      throw new TrackerError(
        ERROR_CODES.UNKNOWN,
        "OFFSCREEN",
        "Offscreen tracker runtime disposal failed.",
        {
          cause: error
        }
      );
    }
  }
  /* ========================================================================
   * Internal video configuration
   * ====================================================================== */
  configureVideoElement() {
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.setAttribute(
      "aria-hidden",
      "true"
    );
  }
  /* ========================================================================
   * Runtime error bridge
   * ====================================================================== */
  handleRuntimeError(error) {
    if (this.onRuntimeError === null) {
      logger11.warn(
        "Tracker runtime reported an error without a registered bridge.",
        {
          code: error.code
        }
      );
      return;
    }
    try {
      this.onRuntimeError(error);
    } catch (bridgeError) {
      logger11.error(
        "Tracker runtime error bridge failed.",
        {
          code: error.code,
          bridgeMessage: bridgeError instanceof Error ? bridgeError.message : "Unknown runtime-error bridge failure"
        }
      );
    }
  }
  /* ========================================================================
   * Internal cleanup / guards
   * ====================================================================== */
  disposeModulesAfterFailedInitialization() {
    try {
      this.stopFaceAnalysis();
      this.faceLandmarker?.dispose();
      this.disposeGazePredictorBestEffort();
      this.cameraManager?.dispose();
      this.frameCapture?.dispose();
      this.cameraQualityEstimator?.dispose();
    } catch {
    }
    this.cameraManager = null;
    this.frameCapture = null;
    this.cameraQualityEstimator = null;
    this.faceLandmarker = null;
    this.faceGeometryAnalyzer = null;
    this.headPoseEstimator = null;
    this.eyeGeometryAnalyzer = null;
    this.blinkDetector = null;
    this.faceQualityEvaluator = null;
    this.preCalibrationMonitor = null;
    this.calibrationManager = null;
    this.validationManager = null;
    this.deepPersonalMapper = null;
    this.deepIndependentValidator = null;
    this.calibrationHybridSelector = null;
    this.residualCorrector = null;
    this.activeCalibrationPointRequest = null;
    this.activeValidationPointRequest = null;
    this.latestPreCalibrationFeedback = null;
    this.faceBaseline = null;
    this.gazePredictor = null;
    this.latestGazeFrame = null;
    this.videoElement.srcObject = null;
  }
  disposeGazePredictorBestEffort() {
    const predictor = this.gazePredictor;
    if (predictor === null) {
      return;
    }
    void predictor.dispose().catch(
      (error) => {
        logger11.warn(
          "Gaze predictor disposal failed.",
          {
            error: error instanceof Error ? error.message : "Unknown gaze disposal error"
          }
        );
      }
    );
  }
  getDeepIndependentValidatorOrThrow() {
    if (this.deepIndependentValidator !== null) {
      return this.deepIndependentValidator;
    }
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validator is unavailable."
    );
  }
  getDeepPersonalMapperOrThrow() {
    if (this.deepPersonalMapper !== null) {
      return this.deepPersonalMapper;
    }
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper is unavailable."
    );
  }
  getCalibrationHybridSelectorOrThrow() {
    if (this.calibrationHybridSelector !== null) {
      return this.calibrationHybridSelector;
    }
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration-only hybrid selector is unavailable."
    );
  }
  getGazePredictorOrThrow() {
    if (this.gazePredictor !== null) {
      return this.gazePredictor;
    }
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "GazePredictor is unavailable in the Offscreen runtime.",
      {
        recoverable: false
      }
    );
  }
  getCameraManagerOrThrow() {
    if (this.cameraManager !== null) {
      return this.cameraManager;
    }
    throw new TrackerError(
      ERROR_CODES.CAMERA_START_FAILED,
      "CAMERA",
      "CameraManager is unavailable in the Offscreen runtime."
    );
  }
  getFaceLandmarkerOrThrow() {
    if (this.faceLandmarker !== null) {
      return this.faceLandmarker;
    }
    throw new TrackerError(
      ERROR_CODES.MEDIAPIPE_INIT_FAILED,
      "FACE",
      "FaceLandmarker is unavailable in the Offscreen runtime.",
      {
        recoverable: false
      }
    );
  }
  getFaceGeometryAnalyzerOrThrow() {
    if (this.faceGeometryAnalyzer !== null) {
      return this.faceGeometryAnalyzer;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "FaceGeometryAnalyzer is unavailable in the Offscreen runtime."
    );
  }
  getHeadPoseEstimatorOrThrow() {
    if (this.headPoseEstimator !== null) {
      return this.headPoseEstimator;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "HeadPoseEstimator is unavailable in the Offscreen runtime."
    );
  }
  getEyeGeometryAnalyzerOrThrow() {
    if (this.eyeGeometryAnalyzer !== null) {
      return this.eyeGeometryAnalyzer;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "EyeGeometryAnalyzer is unavailable in the Offscreen runtime."
    );
  }
  getBlinkDetectorOrThrow() {
    if (this.blinkDetector !== null) {
      return this.blinkDetector;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "BlinkDetector is unavailable in the Offscreen runtime."
    );
  }
  getFaceQualityEvaluatorOrThrow() {
    if (this.faceQualityEvaluator !== null) {
      return this.faceQualityEvaluator;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "FaceQualityEvaluator is unavailable in the Offscreen runtime."
    );
  }
  getPreCalibrationMonitorOrThrow() {
    if (this.preCalibrationMonitor !== null) {
      return this.preCalibrationMonitor;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "CALIBRATION",
      "PreCalibrationMonitor is unavailable in the Offscreen runtime."
    );
  }
  getCalibrationManagerOrThrow() {
    if (this.calibrationManager !== null) {
      return this.calibrationManager;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "CALIBRATION",
      "CalibrationManager is unavailable in the Offscreen runtime."
    );
  }
  getValidationManagerOrThrow() {
    if (this.validationManager !== null) {
      return this.validationManager;
    }
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "ValidationManager is unavailable in the Offscreen runtime."
    );
  }
  getResidualCorrectorOrThrow() {
    if (this.residualCorrector !== null) {
      return this.residualCorrector;
    }
    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "CALIBRATION",
      "ResidualCorrector is unavailable in the Offscreen runtime."
    );
  }
  assertUsable() {
    if (this.lifecycle === "READY") {
      return;
    }
    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "OFFSCREEN",
      "Tracker runtime is not ready.",
      {
        details: {
          lifecycle: this.lifecycle
        }
      }
    );
  }
};

// src/offscreen/offscreen.ts
var logger12 = createLogger("OFFSCREEN");
var CAMERA_VIDEO_ELEMENT_ID = "tracker-camera";
var GAZE_SMOKE_LOG_INTERVAL_MS = 500;
var trackerRuntime = null;
var runtimeMessageListenerRegistered = false;
var pageLifecycleCleanupRegistered = false;
var quickPreferenceListenerRegistered = false;
var lastRuntimeInitializationError = null;
function getErrorDiagnostic(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null
    };
  }
  return {
    message: typeof error === "string" ? error : "Unknown bootstrap error",
    name: null,
    stack: null
  };
}
var handleQuickRecalibrationPreferenceChanged = (changes, areaName) => {
  if (areaName !== "local" || !(QUICK_RECALIBRATION.STORAGE_KEY in changes) || trackerRuntime === null) {
    return;
  }
  const value = changes[QUICK_RECALIBRATION.STORAGE_KEY]?.newValue;
  trackerRuntime.setAutomaticQuickRecalibrationEnabled(
    typeof value === "boolean" ? value : QUICK_RECALIBRATION.DEFAULT_ENABLED
  );
  lastQuickRecalibrationDriftNoticeAtMs = null;
};
async function loadQuickRecalibrationPreference(runtime) {
  try {
    const stored = await chrome.storage.local.get(
      QUICK_RECALIBRATION.STORAGE_KEY
    );
    const value = stored[QUICK_RECALIBRATION.STORAGE_KEY];
    runtime.setAutomaticQuickRecalibrationEnabled(
      typeof value === "boolean" ? value : QUICK_RECALIBRATION.DEFAULT_ENABLED
    );
  } catch {
    runtime.setAutomaticQuickRecalibrationEnabled(
      QUICK_RECALIBRATION.DEFAULT_ENABLED
    );
  }
}
function registerQuickRecalibrationPreferenceListenerSafely() {
  if (quickPreferenceListenerRegistered) {
    return;
  }
  try {
    chrome.storage.onChanged.addListener(
      handleQuickRecalibrationPreferenceChanged
    );
    quickPreferenceListenerRegistered = true;
  } catch (error) {
    logger12.warn(
      "Quick recalibration preference listener is unavailable; using the default setting for this Offscreen lifetime.",
      getErrorDiagnostic(error)
    );
  }
}
var faceStatusMessageContext = null;
var lastFacePositionBroadcastAtMs = null;
var lastBroadcastStable = null;
var lastGazeSmokeLogAtMs = null;
var lastAoiProbeAtMs = null;
var longitudinalDiagnosticStartedAtMs = null;
var longitudinalDiagnosticSessionId = null;
var emittedLongitudinalMilestones = /* @__PURE__ */ new Set();
var RUNTIME_CONTEXT_VALUES = /* @__PURE__ */ new Set([
  "BACKGROUND",
  "OFFSCREEN",
  "CONTENT",
  "POPUP",
  "CAMERA_PERMISSION_UI",
  "CALIBRATION_UI",
  "BROADCAST"
]);
function isRuntimeContext(value) {
  return typeof value === "string" && RUNTIME_CONTEXT_VALUES.has(value);
}
function isMessageMeta(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isNonEmptyString(
    value.messageId
  ) && isFiniteNumber(
    value.sentAtEpochMs
  ) && isRuntimeContext(
    value.source
  ) && isRuntimeContext(
    value.target
  ) && isNullableString(
    value.sessionId
  ) && isNullableString(
    value.pageId
  ) && isNullableFiniteNumber(
    value.tabId
  ) && isNullableFiniteNumber(
    value.browserFrameId
  );
}
function isMessageForOffscreen(rawMessage) {
  if (!isRecord(rawMessage)) {
    return false;
  }
  const meta = rawMessage.meta;
  if (!isRecord(meta)) {
    return false;
  }
  return meta.target === "OFFSCREEN";
}
function isEmptyPayload(value) {
  return isRecord(value) && Object.keys(value).length === 0;
}
function isTrackingContextChangedPayload(value) {
  return isRecord(value) && (value.reason === "FULL_NAVIGATION" || value.reason === "SPA_NAVIGATION" || value.reason === "TAB_ACTIVATED" || value.reason === "TAB_ASSOCIATED") && isNullableString(value.url);
}
function isViewportContextChangedPayload(value) {
  return isRecord(value) && isFiniteNumber(value.viewportWidth) && value.viewportWidth > 0 && isFiniteNumber(value.viewportHeight) && value.viewportHeight > 0 && isFiniteNumber(value.devicePixelRatio) && value.devicePixelRatio > 0;
}
function isPingPayload(value) {
  return isRecord(value) && isNonEmptyString(
    value.nonce
  );
}
function isCalibrationMode(value) {
  return value === "STANDARD_17" || value === "PRECISION_25";
}
function isCalibrationTarget(value) {
  if (!isRecord(value) || !Number.isInteger(
    value.pointIndex
  ) || !isRecord(
    value.normalizedPoint
  ) || !isRecord(
    value.viewportPoint
  )) {
    return false;
  }
  return isFiniteNumber(
    value.normalizedPoint.x
  ) && isFiniteNumber(
    value.normalizedPoint.y
  ) && isFiniteNumber(
    value.viewportPoint.x
  ) && isFiniteNumber(
    value.viewportPoint.y
  );
}
function isStartCalibrationPayload(value) {
  return isRecord(value) && isNonEmptyString(
    value.calibrationId
  ) && isCalibrationMode(
    value.mode
  );
}
function isCalibrationPointPayload(value) {
  return isRecord(value) && isNonEmptyString(
    value.calibrationId
  ) && isCalibrationTarget(
    value.target
  ) && isFiniteNumber(
    value.targetShownAtMs
  ) && isFiniteNumber(
    value.attempt
  ) && Number.isInteger(
    value.attempt
  ) && value.attempt >= 1;
}
function isStartValidationPayload(value) {
  return isRecord(value) && isNonEmptyString(
    value.calibrationId
  ) && isFiniteNumber(
    value.viewportWidth
  ) && value.viewportWidth > 0 && isFiniteNumber(
    value.viewportHeight
  ) && value.viewportHeight > 0 && isFiniteNumber(
    value.expectedPointCount
  ) && Number.isInteger(
    value.expectedPointCount
  ) && value.expectedPointCount >= CALIBRATION.MIN_VALIDATION_POINT_COUNT;
}
function isStartQuickRecalibrationPayload(value) {
  return isRecord(value) && isNonEmptyString(value.calibrationId) && isFiniteNumber(value.viewportWidth) && value.viewportWidth > 0 && isFiniteNumber(value.viewportHeight) && value.viewportHeight > 0 && isFiniteNumber(value.pointCount) && Number.isInteger(value.pointCount) && value.pointCount === DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT;
}
function isStartQuickValidationPayload(value) {
  return isRecord(value) && isNonEmptyString(value.calibrationId) && isFiniteNumber(value.viewportWidth) && value.viewportWidth > 0 && isFiniteNumber(value.viewportHeight) && value.viewportHeight > 0 && isFiniteNumber(value.expectedPointCount) && Number.isInteger(value.expectedPointCount) && value.expectedPointCount === DRIFT_THRESHOLDS.QUICK_REVALIDATION_POINT_COUNT;
}
function isValidationPointPayload(value) {
  return isRecord(value) && isNonEmptyString(
    value.calibrationId
  ) && isCalibrationTarget(
    value.target
  ) && isFiniteNumber(
    value.targetShownAtMs
  ) && isFiniteNumber(
    value.attempt
  ) && Number.isInteger(
    value.attempt
  ) && value.attempt >= 1;
}
function getCameraVideoElement() {
  const element = document.getElementById(
    CAMERA_VIDEO_ELEMENT_ID
  );
  if (!(element instanceof HTMLVideoElement)) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "The Offscreen camera video element could not be found.",
      {
        recoverable: false,
        details: {
          expectedElementId: CAMERA_VIDEO_ELEMENT_ID
        }
      }
    );
  }
  return element;
}
function createResponseMeta(requestMeta) {
  return {
    messageId: createMessageId(),
    sentAtEpochMs: nowEpochMs(),
    source: "OFFSCREEN",
    target: requestMeta.source,
    sessionId: requestMeta.sessionId,
    pageId: requestMeta.pageId,
    tabId: requestMeta.tabId,
    browserFrameId: requestMeta.browserFrameId
  };
}
function handlePing(rawMessage) {
  if (!isCompatibleMessageProtocol(
    rawMessage.protocolVersion
  )) {
    throw new TrackerError(
      ERROR_CODES.INCOMPATIBLE_MESSAGE_PROTOCOL,
      "OFFSCREEN",
      "Offscreen message protocol version is incompatible.",
      {
        details: {
          receivedProtocolVersion: rawMessage.protocolVersion,
          expectedProtocolVersion: MESSAGE_PROTOCOL_VERSION
        }
      }
    );
  }
  if (rawMessage.type !== MESSAGE_TYPES.PING) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen PING handler received an unexpected message type.",
      {
        details: {
          receivedType: rawMessage.type
        }
      }
    );
  }
  if (!isMessageMeta(
    rawMessage.meta
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen PING message contains invalid metadata."
    );
  }
  if (!isPingPayload(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen PING message contains an invalid payload."
    );
  }
  return createRuntimeMessage(
    MESSAGE_TYPES.PONG,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      nonce: rawMessage.payload.nonce
    }
  );
}
async function handleStartCamera(rawMessage) {
  if (!isMessageMeta(
    rawMessage.meta
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_CAMERA message contains invalid metadata."
    );
  }
  if (rawMessage.meta.source !== "BACKGROUND") {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "START_CAMERA must be routed through the Background context.",
      {
        details: {
          source: rawMessage.meta.source
        }
      }
    );
  }
  if (!isCameraRequest(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_CAMERA message contains invalid camera constraints."
    );
  }
  const runtime = await ensureTrackerRuntimeReady();
  const settings = await runtime.startCamera(
    rawMessage.payload
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.CAMERA_READY,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      settings
    }
  );
}
async function handleStartFacePositioning(rawMessage) {
  if (!isMessageMeta(
    rawMessage.meta
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_FACE_POSITIONING message contains invalid metadata."
    );
  }
  if (rawMessage.meta.source !== "BACKGROUND") {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "START_FACE_POSITIONING must be routed through the Background context.",
      {
        details: {
          source: rawMessage.meta.source
        }
      }
    );
  }
  if (!isEmptyPayload(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_FACE_POSITIONING message contains a non-empty payload."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for face positioning."
    );
  }
  faceStatusMessageContext = {
    sessionId: rawMessage.meta.sessionId,
    pageId: rawMessage.meta.pageId,
    tabId: rawMessage.meta.tabId,
    browserFrameId: rawMessage.meta.browserFrameId
  };
  lastFacePositionBroadcastAtMs = null;
  lastBroadcastStable = null;
  try {
    await trackerRuntime.startFacePositioning();
    const feedback = trackerRuntime.getLatestPreCalibrationFeedback();
    if (feedback === null) {
      throw new TrackerError(
        ERROR_CODES.FACE_DETECTION_FAILED,
        "OFFSCREEN",
        "Pre-calibration feedback was unavailable after face positioning startup."
      );
    }
    return createRuntimeMessage(
      MESSAGE_TYPES.FACE_POSITION_STATUS,
      createResponseMeta(
        rawMessage.meta
      ),
      {
        status: feedback.status,
        feedback
      }
    );
  } catch (error) {
    faceStatusMessageContext = null;
    throw error;
  }
}
function handleTrackingContextChanged(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || rawMessage.meta.sessionId === null || rawMessage.meta.pageId === null || rawMessage.meta.tabId === null || rawMessage.meta.browserFrameId === null || !isTrackingContextChangedPayload(rawMessage.payload)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen TRACKING_CONTEXT_CHANGED message is invalid."
    );
  }
  const previous = faceStatusMessageContext;
  const pageOrTabChanged = previous === null || previous.sessionId !== rawMessage.meta.sessionId || previous.pageId !== rawMessage.meta.pageId || previous.tabId !== rawMessage.meta.tabId || previous.browserFrameId !== rawMessage.meta.browserFrameId;
  faceStatusMessageContext = {
    sessionId: rawMessage.meta.sessionId,
    pageId: rawMessage.meta.pageId,
    tabId: rawMessage.meta.tabId,
    browserFrameId: rawMessage.meta.browserFrameId
  };
  if (pageOrTabChanged) {
    trackerRuntime?.handlePageContextTransition();
    lastAoiProbeAtMs = null;
    lastGazeSmokeLogAtMs = null;
  }
  logger12.info(
    "Authoritative research-page context synchronized.",
    {
      sessionId: rawMessage.meta.sessionId,
      pageId: rawMessage.meta.pageId,
      tabId: rawMessage.meta.tabId,
      reason: rawMessage.payload.reason,
      url: rawMessage.payload.url,
      derivedRuntimeReset: pageOrTabChanged
    }
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED,
    createResponseMeta(rawMessage.meta),
    {
      ...rawMessage.payload
    }
  );
}
function handleViewportContextChanged(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || rawMessage.meta.sessionId === null || rawMessage.meta.pageId === null || rawMessage.meta.tabId === null || !isViewportContextChangedPayload(rawMessage.payload)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen VIEWPORT_CONTEXT_CHANGED message is invalid."
    );
  }
  const changed = trackerRuntime?.updateTrackingViewportContext(
    rawMessage.payload.viewportWidth,
    rawMessage.payload.viewportHeight,
    rawMessage.payload.devicePixelRatio
  ) ?? false;
  if (changed) {
    lastAoiProbeAtMs = null;
  }
  logger12.info(
    "Live research viewport synchronized.",
    {
      pageId: rawMessage.meta.pageId,
      tabId: rawMessage.meta.tabId,
      viewportWidth: rawMessage.payload.viewportWidth,
      viewportHeight: rawMessage.payload.viewportHeight,
      devicePixelRatio: rawMessage.payload.devicePixelRatio,
      derivedPixelRuntimeReset: changed
    }
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED,
    createResponseMeta(rawMessage.meta),
    { ...rawMessage.payload }
  );
}
function handleStartCalibration(rawMessage) {
  if (!isMessageMeta(
    rawMessage.meta
  ) || rawMessage.meta.source !== "BACKGROUND" || !isStartCalibrationPayload(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_CALIBRATION message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for calibration startup."
    );
  }
  trackerRuntime.startCalibration(
    rawMessage.payload.calibrationId,
    rawMessage.payload.mode
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.START_CALIBRATION,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      calibrationId: rawMessage.payload.calibrationId,
      mode: rawMessage.payload.mode
    }
  );
}
async function handleCalibrationPoint(rawMessage) {
  if (!isMessageMeta(
    rawMessage.meta
  ) || rawMessage.meta.source !== "BACKGROUND" || !isCalibrationPointPayload(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen CALIBRATION_POINT message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for calibration point collection."
    );
  }
  const result = await trackerRuntime.collectCalibrationPoint(
    rawMessage.payload.calibrationId,
    rawMessage.payload.target,
    rawMessage.payload.targetShownAtMs
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.CALIBRATION_POINT_RESULT,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      calibrationId: result.calibrationId,
      pointIndex: result.pointIndex,
      sufficient: result.sufficient,
      acceptedSampleCount: result.acceptedSampleCount,
      rejectedSampleCount: result.rejectedSampleCount,
      rejectionRatio: result.rejectionRatio,
      completedPointCount: result.completedPointCount,
      expectedPointCount: result.expectedPointCount,
      failureReason: result.failureReason,
      modelReady: result.modelReady,
      trainingRmseNormalized: result.trainingRmseNormalized,
      trainingDiagnostics: result.trainingDiagnostics,
      adaptiveExpansionTargets: result.adaptiveExpansionTargets
    }
  );
}
function handleAbortQuickRecalibration(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isRecord(rawMessage.payload) || !isNonEmptyString(rawMessage.payload.calibrationId) || !isNonEmptyString(rawMessage.payload.runId)) {
    throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "OFFSCREEN", "Invalid quick abort request.");
  }
  const { calibrationId, runId } = rawMessage.payload;
  if (typeof calibrationId !== "string" || typeof runId !== "string") {
    throw new TrackerError(ERROR_CODES.INVALID_MESSAGE, "OFFSCREEN", "Invalid quick abort identity.");
  }
  const rolledBack = trackerRuntime?.abortQuickRecalibration(
    calibrationId,
    runId
  ) ?? false;
  return createRuntimeMessage(
    MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
    createResponseMeta(rawMessage.meta),
    { calibrationId, runId, rolledBack }
  );
}
function handleStartQuickRecalibration(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isStartQuickRecalibrationPayload(rawMessage.payload)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_QUICK_RECALIBRATION message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick recalibration startup."
    );
  }
  const started = trackerRuntime.startQuickRecalibration(
    rawMessage.payload.calibrationId,
    rawMessage.payload.pointCount
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED,
    createResponseMeta(rawMessage.meta),
    {
      calibrationId: rawMessage.payload.calibrationId,
      startingPointIndex: started.startingPointIndex,
      expectedPointCount: started.expectedPointCount,
      pointCount: rawMessage.payload.pointCount,
      runId: started.runId
    }
  );
}
async function handleQuickRecalibrationPoint(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isCalibrationPointPayload(rawMessage.payload) || !isRecord(rawMessage.payload) || !isNonEmptyString(rawMessage.payload.runId)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen QUICK_RECALIBRATION_POINT message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick recalibration collection."
    );
  }
  trackerRuntime.assertQuickRecalibrationRun(
    rawMessage.payload.calibrationId,
    typeof rawMessage.payload.runId === "string" ? rawMessage.payload.runId : ""
  );
  const result = await trackerRuntime.collectCalibrationPoint(
    rawMessage.payload.calibrationId,
    rawMessage.payload.target,
    rawMessage.payload.targetShownAtMs
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT,
    createResponseMeta(rawMessage.meta),
    {
      calibrationId: result.calibrationId,
      pointIndex: result.pointIndex,
      sufficient: result.sufficient,
      acceptedSampleCount: result.acceptedSampleCount,
      rejectedSampleCount: result.rejectedSampleCount,
      rejectionRatio: result.rejectionRatio,
      completedPointCount: result.completedPointCount,
      expectedPointCount: result.expectedPointCount,
      failureReason: result.failureReason,
      modelReady: result.modelReady,
      trainingRmseNormalized: result.trainingRmseNormalized,
      trainingDiagnostics: result.trainingDiagnostics,
      adaptiveExpansionTargets: []
    }
  );
}
function handleStartQuickValidation(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isStartQuickValidationPayload(rawMessage.payload) || !isNonEmptyString(rawMessage.payload.runId)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_QUICK_VALIDATION message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick validation startup."
    );
  }
  trackerRuntime.assertQuickRecalibrationRun(
    rawMessage.payload.calibrationId,
    rawMessage.payload.runId
  );
  trackerRuntime.startQuickValidation(
    rawMessage.payload.calibrationId,
    rawMessage.payload.viewportWidth,
    rawMessage.payload.viewportHeight,
    rawMessage.payload.expectedPointCount
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.START_QUICK_VALIDATION,
    createResponseMeta(rawMessage.meta),
    { ...rawMessage.payload }
  );
}
async function handleQuickValidationPoint(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isValidationPointPayload(rawMessage.payload) || !isRecord(rawMessage.payload) || !isNonEmptyString(rawMessage.payload.runId)) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen QUICK_VALIDATION_POINT message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for quick validation collection."
    );
  }
  trackerRuntime.assertQuickRecalibrationRun(
    rawMessage.payload.calibrationId,
    typeof rawMessage.payload.runId === "string" ? rawMessage.payload.runId : ""
  );
  const result = await trackerRuntime.collectValidationPoint(
    rawMessage.payload.calibrationId,
    rawMessage.payload.target,
    rawMessage.payload.targetShownAtMs
  );
  const selectedStrategyValidation = result.validationComplete ? trackerRuntime.getCompletedQuickValidationResult() : null;
  return createRuntimeMessage(
    MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT,
    createResponseMeta(rawMessage.meta),
    {
      calibrationId: result.calibrationId,
      correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
      pointIndex: result.pointIndex,
      sufficient: result.sufficient,
      acceptedSampleCount: result.acceptedSampleCount,
      rejectedSampleCount: result.rejectedSampleCount,
      rejectionRatio: result.rejectionRatio,
      completedPointCount: result.completedPointCount,
      expectedPointCount: result.expectedPointCount,
      failureReason: result.failureReason,
      validationComplete: result.validationComplete,
      metrics: result.validation?.metrics ?? null,
      quality: result.validation?.quality ?? null,
      selectedStrategyValidation,
      pointResults: result.validation?.pointResults ?? null
    }
  );
}
function handleStartValidation(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isStartValidationPayload(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen START_VALIDATION message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for validation startup."
    );
  }
  trackerRuntime.startValidation(
    rawMessage.payload.calibrationId,
    rawMessage.payload.viewportWidth,
    rawMessage.payload.viewportHeight,
    rawMessage.payload.expectedPointCount
  );
  return createRuntimeMessage(
    MESSAGE_TYPES.START_VALIDATION,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      ...rawMessage.payload
    }
  );
}
async function handleValidationPoint(rawMessage) {
  if (!isMessageMeta(rawMessage.meta) || rawMessage.meta.source !== "BACKGROUND" || !isValidationPointPayload(
    rawMessage.payload
  )) {
    throw new TrackerError(
      ERROR_CODES.INVALID_MESSAGE,
      "OFFSCREEN",
      "Offscreen VALIDATION_POINT message is invalid."
    );
  }
  if (trackerRuntime === null || !trackerRuntime.isReady()) {
    throw new TrackerError(
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "TrackerRuntime is unavailable for validation point collection."
    );
  }
  const result = await trackerRuntime.collectValidationPoint(
    rawMessage.payload.calibrationId,
    rawMessage.payload.target,
    rawMessage.payload.targetShownAtMs
  );
  const selectedStrategyValidation = result.validationComplete ? trackerRuntime.getSelectedStrategyValidationResult() : null;
  return createRuntimeMessage(
    MESSAGE_TYPES.VALIDATION_POINT_RESULT,
    createResponseMeta(
      rawMessage.meta
    ),
    {
      calibrationId: result.calibrationId,
      correctionStrategy: CALIBRATION.CORRECTION_STRATEGY,
      pointIndex: result.pointIndex,
      sufficient: result.sufficient,
      acceptedSampleCount: result.acceptedSampleCount,
      rejectedSampleCount: result.rejectedSampleCount,
      rejectionRatio: result.rejectionRatio,
      completedPointCount: result.completedPointCount,
      expectedPointCount: result.expectedPointCount,
      failureReason: result.failureReason,
      validationComplete: result.validationComplete,
      metrics: result.validation?.metrics ?? null,
      quality: result.validation?.quality ?? null,
      selectedStrategyValidation,
      pointResults: result.validation?.pointResults ?? null
    }
  );
}
function sendAsyncFailureResponse(error, sendResponse) {
  const normalized = normalizeTrackerError(
    error,
    ERROR_CODES.INVALID_MESSAGE,
    "OFFSCREEN",
    "Offscreen asynchronous message handling failed."
  );
  logger12.warn(
    "Offscreen rejected an asynchronous runtime message.",
    {
      code: normalized.code,
      message: normalized.message
    }
  );
  sendResponse({
    ok: false,
    error: normalized.toSerializable()
  });
}
function registerRuntimeMessageListener() {
  if (runtimeMessageListenerRegistered) {
    return;
  }
  chrome.runtime.onMessage.addListener(
    (rawMessage, _sender, sendResponse) => {
      if (!isMessageForOffscreen(
        rawMessage
      )) {
        return false;
      }
      try {
        if (!isRecord(rawMessage)) {
          return false;
        }
        if (!isCompatibleMessageProtocol(
          rawMessage.protocolVersion
        )) {
          throw new TrackerError(
            ERROR_CODES.INCOMPATIBLE_MESSAGE_PROTOCOL,
            "OFFSCREEN",
            "Received an incompatible Offscreen message protocol version."
          );
        }
        if (!isMessageType(
          rawMessage.type
        )) {
          throw new TrackerError(
            ERROR_CODES.INVALID_MESSAGE,
            "OFFSCREEN",
            "Received an unknown Offscreen message type."
          );
        }
        switch (rawMessage.type) {
          case MESSAGE_TYPES.PING: {
            const response = handlePing(
              rawMessage
            );
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.TRACKING_CONTEXT_CHANGED: {
            const response = handleTrackingContextChanged(
              rawMessage
            );
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED: {
            const response = handleViewportContextChanged(
              rawMessage
            );
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.START_CAMERA: {
            void handleStartCamera(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );
            return true;
          }
          case MESSAGE_TYPES.START_FACE_POSITIONING: {
            void handleStartFacePositioning(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );
            return true;
          }
          case MESSAGE_TYPES.START_CALIBRATION: {
            const response = handleStartCalibration(
              rawMessage
            );
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.CALIBRATION_POINT: {
            void handleCalibrationPoint(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );
            return true;
          }
          case MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION: {
            sendResponse(handleAbortQuickRecalibration(rawMessage));
            return false;
          }
          case MESSAGE_TYPES.START_QUICK_RECALIBRATION: {
            const response = handleStartQuickRecalibration(rawMessage);
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.QUICK_RECALIBRATION_POINT: {
            void handleQuickRecalibrationPoint(rawMessage).then(sendResponse).catch((error) => sendAsyncFailureResponse(error, sendResponse));
            return true;
          }
          case MESSAGE_TYPES.START_QUICK_VALIDATION: {
            const response = handleStartQuickValidation(rawMessage);
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.QUICK_VALIDATION_POINT: {
            void handleQuickValidationPoint(rawMessage).then(sendResponse).catch((error) => sendAsyncFailureResponse(error, sendResponse));
            return true;
          }
          case MESSAGE_TYPES.START_VALIDATION: {
            const response = handleStartValidation(
              rawMessage
            );
            sendResponse(response);
            return false;
          }
          case MESSAGE_TYPES.VALIDATION_POINT: {
            void handleValidationPoint(
              rawMessage
            ).then(
              (response) => {
                sendResponse(response);
              },
              (error) => {
                sendAsyncFailureResponse(
                  error,
                  sendResponse
                );
              }
            );
            return true;
          }
          default:
            logger12.debug(
              "Offscreen received a message that does not yet have a local handler.",
              {
                type: rawMessage.type
              }
            );
            return false;
        }
      } catch (error) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.INVALID_MESSAGE,
          "OFFSCREEN",
          "Offscreen runtime message handling failed."
        );
        logger12.warn(
          "Offscreen rejected a runtime message.",
          {
            code: normalized.code,
            message: normalized.message
          }
        );
        sendResponse({
          ok: false,
          error: normalized.toSerializable()
        });
        return false;
      }
    }
  );
}
function reportFacePositionStatus(result, feedback) {
  const context = faceStatusMessageContext;
  if (context === null) {
    return;
  }
  const stableChanged = lastBroadcastStable === null || lastBroadcastStable !== feedback.status.stable;
  const intervalElapsed = lastFacePositionBroadcastAtMs === null || result.timestampMs - lastFacePositionBroadcastAtMs >= FACE_PIPELINE_RUNTIME.POSITION_STATUS_BROADCAST_INTERVAL_MS;
  if (!stableChanged && !intervalElapsed) {
    return;
  }
  lastFacePositionBroadcastAtMs = result.timestampMs;
  lastBroadcastStable = feedback.status.stable;
  const message = createRuntimeMessage(
    MESSAGE_TYPES.FACE_POSITION_STATUS,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BROADCAST",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId
    },
    {
      status: feedback.status,
      feedback
    }
  );
  void chrome.runtime.sendMessage(message).catch(
    (sendError) => {
      logger12.debug(
        "Face-position status broadcast was not delivered.",
        {
          transportError: sendError instanceof Error ? sendError.message : "Unknown message transport error"
        }
      );
    }
  );
}
function reportCompletedFixationFrame(result) {
  const context = faceStatusMessageContext;
  const fixation = result.fixation.completedFixation;
  if (fixation === null || context === null || context.sessionId === null || context.pageId === null || context.tabId === null || !result.authoritativeGaze.collectionAllowed) {
    return;
  }
  const message = createRuntimeMessage(
    MESSAGE_TYPES.FIXATION_EVENT,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BACKGROUND",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId ?? 0
    },
    {
      event: {
        fixationId: fixation.fixationId,
        sessionId: context.sessionId,
        pageId: context.pageId,
        startTimeMs: fixation.startTimeMs,
        endTimeMs: fixation.endTimeMs,
        durationMs: fixation.durationMs,
        centroidViewportPoint: {
          ...fixation.centroidViewportPoint
        },
        dispersionX: fixation.dispersionX,
        dispersionY: fixation.dispersionY,
        dispersionPx: fixation.dispersionPx,
        sampleCount: fixation.sampleCount,
        qualityMean: fixation.qualityMean,
        aoiId: null,
        aoiDwellRatio: 0
      },
      peakSpeedPxPerSecond: fixation.peakSpeedPxPerSecond
    }
  );
  void chrome.runtime.sendMessage(message).catch((error) => {
    logger12.debug(
      "Completed fixation could not be routed to storage.",
      {
        fixationId: fixation.fixationId,
        transportError: error instanceof Error ? error.message : "Unknown fixation transport error"
      }
    );
  });
}
function reportAoiProbeFrame(result) {
  const context = faceStatusMessageContext;
  const completedFixation = result.fixation.completedFixation;
  const activeFixation = result.fixation.activeFixation;
  const viewportSize = result.stabilizedGaze.viewportSize;
  const completedProbe = completedFixation !== null && viewportSize !== null && viewportSize.width > 0 && viewportSize.height > 0;
  const viewportPoint = completedProbe ? completedFixation.centroidViewportPoint : activeFixation?.centroidViewportPoint ?? result.stabilizedGaze.stabilizedViewportPoint;
  const normalizedPoint = completedProbe ? {
    x: completedFixation.centroidViewportPoint.x / viewportSize.width,
    y: completedFixation.centroidViewportPoint.y / viewportSize.height
  } : activeFixation !== null && viewportSize !== null && viewportSize.width > 0 && viewportSize.height > 0 ? {
    x: activeFixation.centroidViewportPoint.x / viewportSize.width,
    y: activeFixation.centroidViewportPoint.y / viewportSize.height
  } : result.stabilizedGaze.stabilizedNormalizedPoint;
  const pointSource = completedProbe || activeFixation !== null ? "FIXATION_CENTROID" : "STABILIZED_GAZE";
  if (context === null || context.sessionId === null || context.pageId === null || context.tabId === null || viewportPoint === null || normalizedPoint === null || !result.authoritativeGaze.collectionAllowed || !completedProbe && !result.stabilizedGaze.currentSampleValid) {
    return;
  }
  const timestampMs = completedProbe ? completedFixation.endTimeMs : result.prediction.timestampMs;
  if (!completedProbe && lastAoiProbeAtMs !== null && timestampMs - lastAoiProbeAtMs < AOI.PROBE_INTERVAL_MS) {
    return;
  }
  lastAoiProbeAtMs = timestampMs;
  const rawPredictionNormalizedPoint = completedProbe || result.prediction.rawSpace !== "NORMALIZED" ? null : {
    x: result.prediction.rawPoint.x,
    y: result.prediction.rawPoint.y
  };
  const completedFixationSnapshot = completedProbe ? {
    event: {
      fixationId: completedFixation.fixationId,
      sessionId: context.sessionId,
      pageId: context.pageId,
      startTimeMs: completedFixation.startTimeMs,
      endTimeMs: completedFixation.endTimeMs,
      durationMs: completedFixation.durationMs,
      centroidViewportPoint: {
        ...completedFixation.centroidViewportPoint
      },
      dispersionX: completedFixation.dispersionX,
      dispersionY: completedFixation.dispersionY,
      dispersionPx: completedFixation.dispersionPx,
      sampleCount: completedFixation.sampleCount,
      qualityMean: completedFixation.qualityMean,
      aoiId: null,
      aoiDwellRatio: 0
    },
    peakSpeedPxPerSecond: completedFixation.peakSpeedPxPerSecond
  } : null;
  const message = createRuntimeMessage(
    MESSAGE_TYPES.AOI_PROBE,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BACKGROUND",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId ?? 0
    },
    {
      timestampMs,
      normalizedPoint: {
        ...normalizedPoint
      },
      viewportPoint: {
        ...viewportPoint
      },
      pointSource,
      gazeQuality: completedProbe ? completedFixation.qualityMean : result.effectiveQualityScore,
      fixationId: completedProbe ? completedFixation.fixationId : activeFixation?.fixationId ?? null,
      degradedCollection: result.authoritativeGaze.degradedCollection,
      rawPredictionNormalizedPoint,
      authoritativeNormalizedPoint: completedProbe ? null : {
        ...result.authoritativeGaze.normalizedPoint
      },
      stabilizedNormalizedPoint: completedProbe ? null : result.stabilizedGaze.stabilizedNormalizedPoint === null ? null : {
        ...result.stabilizedGaze.stabilizedNormalizedPoint
      },
      completedFixation: completedFixationSnapshot
    }
  );
  void chrome.runtime.sendMessage(message).catch(
    (error) => {
      logger12.debug(
        "AOI probe could not be routed to the research page.",
        {
          fixationCompletionProbe: completedProbe,
          transportError: error instanceof Error ? error.message : "Unknown AOI probe transport error"
        }
      );
    }
  );
}
var lastQuickRecalibrationDriftNoticeAtMs = null;
function reportRuntimeDriftStatus(result) {
  const status = result.driftStatus;
  const context = faceStatusMessageContext;
  if (status === null || !status.quickRecalibrationRecommended || result.maintenanceCalibrationActive || !result.authoritativeGaze.validationReady || context === null || context.sessionId === null || context.tabId === null) {
    return;
  }
  if (lastQuickRecalibrationDriftNoticeAtMs !== null && status.timestampMs - lastQuickRecalibrationDriftNoticeAtMs < DRIFT_THRESHOLDS.QUICK_RECALIBRATION_COOLDOWN_MS) {
    return;
  }
  lastQuickRecalibrationDriftNoticeAtMs = status.timestampMs;
  const message = createRuntimeMessage(
    MESSAGE_TYPES.DRIFT_STATUS,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BACKGROUND",
      sessionId: context.sessionId,
      pageId: context.pageId,
      tabId: context.tabId,
      browserFrameId: context.browserFrameId ?? 0
    },
    { status: { ...status } }
  );
  void chrome.runtime.sendMessage(message).catch(() => {
  });
}
function milestoneLabel(milliseconds) {
  if (milliseconds === 0) return "T0";
  if (milliseconds === 2 * 6e4) return "T2";
  if (milliseconds === 5 * 6e4) return "T5";
  return "T10";
}
function reportLongitudinalRuntimeDiagnostic(result) {
  const context = faceStatusMessageContext;
  if (context === null || context.sessionId === null || !result.authoritativeGaze.validationReady || result.maintenanceCalibrationActive) {
    return;
  }
  if (longitudinalDiagnosticSessionId !== context.sessionId) {
    longitudinalDiagnosticSessionId = context.sessionId;
    longitudinalDiagnosticStartedAtMs = result.prediction.timestampMs;
    emittedLongitudinalMilestones.clear();
  }
  longitudinalDiagnosticStartedAtMs ??= result.prediction.timestampMs;
  const elapsedMs = Math.max(0, result.prediction.timestampMs - longitudinalDiagnosticStartedAtMs);
  for (const milestoneMs of RUNTIME_MAINTENANCE.LONGITUDINAL_MILESTONES_MS) {
    if (emittedLongitudinalMilestones.has(milestoneMs) || elapsedMs < milestoneMs) continue;
    emittedLongitudinalMilestones.add(milestoneMs);
    const message = createRuntimeMessage(
      MESSAGE_TYPES.RUNTIME_QUALITY_DIAGNOSTIC,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "OFFSCREEN",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: context.browserFrameId ?? 0
      },
      {
        diagnostic: {
          timestampMs: result.prediction.timestampMs,
          milestone: milestoneLabel(milestoneMs),
          elapsedMs,
          gazeQualityScore: result.quality.score,
          effectiveGazeQualityScore: result.effectiveQualityScore,
          baselinePrecisionPx: result.baselinePrecisionPx,
          deepPrecisionPx: result.deepPrecisionPx,
          driftStatus: result.driftStatus === null ? null : { ...result.driftStatus },
          authoritativeStrategy: result.authoritativeGaze.strategy,
          collectionAllowed: result.authoritativeGaze.collectionAllowed,
          degradedCollection: result.authoritativeGaze.degradedCollection
        }
      }
    );
    void chrome.runtime.sendMessage(message).catch(() => {
      emittedLongitudinalMilestones.delete(milestoneMs);
    });
  }
}
function reportRawGazeSmokeFrame(result) {
  const timestampMs = result.prediction.timestampMs;
  const completedFixation = result.fixation.completedFixation;
  if (completedFixation !== null) {
    logger12.info(
      "Fixation completed.",
      {
        fixationId: completedFixation.fixationId,
        startTimeMs: completedFixation.startTimeMs,
        endTimeMs: completedFixation.endTimeMs,
        durationMs: completedFixation.durationMs,
        centroidViewportX: completedFixation.centroidViewportPoint.x,
        centroidViewportY: completedFixation.centroidViewportPoint.y,
        dispersionX: completedFixation.dispersionX,
        dispersionY: completedFixation.dispersionY,
        dispersionPx: completedFixation.dispersionPx,
        sampleCount: completedFixation.sampleCount,
        qualityMean: completedFixation.qualityMean,
        peakSpeedPxPerSecond: completedFixation.peakSpeedPxPerSecond
      }
    );
  }
  if (lastGazeSmokeLogAtMs !== null && timestampMs - lastGazeSmokeLogAtMs < GAZE_SMOKE_LOG_INTERVAL_MS) {
    return;
  }
  lastGazeSmokeLogAtMs = timestampMs;
  logger12.info(
    "[GazeSmoke] Raw gaze prediction.",
    {
      frameSequence: result.frameSequence,
      source: result.prediction.source,
      rawSpace: result.prediction.rawSpace,
      rawX: result.prediction.rawPoint.x,
      rawY: result.prediction.rawPoint.y,
      confidence: result.prediction.confidence,
      validationValid: result.validation.valid,
      gazeQuality: result.quality.score,
      effectiveGazeQuality: result.effectiveQualityScore,
      collectionSuspendedForDrift: result.collectionSuspendedForDrift,
      gazeQualityLevel: result.quality.level,
      deepObserverAvailable: result.observer.available,
      deepObserverInFlight: result.observer.inFlight,
      deepObserverAttemptCount: result.observer.attemptCount,
      deepObserverSuccessCount: result.observer.successCount,
      deepObserverFailureCount: result.observer.failureCount,
      deepObserverFrameSequence: result.observer.lastPrediction?.frameSequence ?? null,
      deepObserverRawSpace: result.observer.lastPrediction?.rawSpace ?? null,
      authoritativeStrategy: result.authoritativeGaze.strategy,
      configuredSessionStrategy: result.authoritativeGaze.configuredStrategy,
      authoritativeNormalizedX: result.authoritativeGaze.normalizedPoint.x,
      authoritativeNormalizedY: result.authoritativeGaze.normalizedPoint.y,
      authoritativeDeepWeight: result.authoritativeGaze.deepWeight,
      authoritativeDeepCandidateAgeMs: result.authoritativeGaze.deepCandidateAgeMs,
      authoritativeDeepSourceAgeMs: result.authoritativeGaze.deepCandidateSourceAgeMs,
      authoritativeDeepAvailabilityAgeMs: result.authoritativeGaze.deepCandidateAvailabilityAgeMs,
      authoritativeDeepFreshnessBudgetMs: result.authoritativeGaze.deepCandidateFreshnessBudgetMs,
      authoritativeDeepTemporalAlignmentApplied: result.authoritativeGaze.deepTemporalAlignmentApplied,
      authoritativeValidationReady: result.authoritativeGaze.validationReady,
      authoritativeCollectionAllowed: result.authoritativeGaze.collectionAllowed,
      authoritativeDegradedCollection: result.authoritativeGaze.degradedCollection,
      authoritativeRuntimeDriftSeverity: result.driftStatus?.severity ?? null,
      authoritativeRecalibrationRecommended: result.driftStatus?.quickRecalibrationRecommended ?? false,
      authoritativeFallbackReason: result.authoritativeGaze.fallbackReason,
      stabilizedGazeMode: result.stabilizedGaze.mode,
      stabilizedCurrentSampleValid: result.stabilizedGaze.currentSampleValid,
      stabilizedNormalizedX: result.stabilizedGaze.stabilizedNormalizedPoint?.x ?? null,
      stabilizedNormalizedY: result.stabilizedGaze.stabilizedNormalizedPoint?.y ?? null,
      stabilizedViewportX: result.stabilizedGaze.stabilizedViewportPoint?.x ?? null,
      stabilizedViewportY: result.stabilizedGaze.stabilizedViewportPoint?.y ?? null,
      stabilizedVisualAgeMs: result.stabilizedGaze.visualAgeMs,
      rawGazeSpeedPxPerSecond: result.stabilizedGaze.rawSpeedPxPerSecond,
      stabilizedGazeSpeedPxPerSecond: result.stabilizedGaze.stabilizedSpeedPxPerSecond,
      fixationState: result.fixation.state,
      fixationStrategyTransitionGuardApplied: result.fixation.strategyTransitionGuardApplied,
      fixationVelocityThresholdPxPerSecond: result.fixation.velocityThresholdPxPerSecond,
      fixationCandidateDurationMs: result.fixation.candidateDurationMs,
      fixationCandidateSampleCount: result.fixation.candidateSampleCount,
      activeFixationId: result.fixation.activeFixation?.fixationId ?? null,
      activeFixationDurationMs: result.fixation.activeFixation?.durationMs ?? null,
      activeFixationSampleCount: result.fixation.activeFixation?.sampleCount ?? null,
      activeFixationCentroidViewportX: result.fixation.activeFixation?.centroidViewportPoint.x ?? null,
      activeFixationCentroidViewportY: result.fixation.activeFixation?.centroidViewportPoint.y ?? null,
      activeFixationDispersionPx: result.fixation.activeFixation?.dispersionPx ?? null,
      completedFixationId: result.fixation.completedFixation?.fixationId ?? null,
      completedFixationDurationMs: result.fixation.completedFixation?.durationMs ?? null,
      deepObserverYawRad: result.observer.lastPrediction?.rawPoint.x ?? null,
      deepObserverPitchRad: result.observer.lastPrediction?.rawPoint.y ?? null,
      deepObserverConfidence: result.observer.lastPrediction?.confidence ?? null,
      deepObserverLatencyMs: result.observer.lastPrediction?.inferenceLatencyMs ?? null
    }
  );
  runtimeMessageListenerRegistered = true;
}
function reportTrackerErrorToBackground(error) {
  const serialized = error.toSerializable();
  const message = createRuntimeMessage(
    MESSAGE_TYPES.TRACKER_ERROR,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "OFFSCREEN",
      target: "BACKGROUND",
      sessionId: null,
      pageId: null,
      tabId: null,
      browserFrameId: null
    },
    serialized
  );
  void chrome.runtime.sendMessage(message).catch(
    (sendError) => {
      logger12.error(
        "Failed to report Offscreen error to Background.",
        {
          originalErrorCode: error.code,
          transportError: sendError instanceof Error ? sendError.message : "Unknown message transport error"
        }
      );
    }
  );
}
function registerPageLifecycleCleanup() {
  if (pageLifecycleCleanupRegistered) {
    return;
  }
  globalThis.addEventListener(
    "pagehide",
    () => {
      if (trackerRuntime === null) {
        return;
      }
      try {
        trackerRuntime.dispose();
      } catch (error) {
        const normalized = normalizeTrackerError(
          error,
          ERROR_CODES.UNKNOWN,
          "OFFSCREEN",
          "Offscreen tracker runtime cleanup failed."
        );
        logger12.error(
          "Offscreen cleanup failed.",
          {
            code: normalized.code
          }
        );
      } finally {
        if (quickPreferenceListenerRegistered) {
          try {
            chrome.storage.onChanged.removeListener(
              handleQuickRecalibrationPreferenceChanged
            );
          } catch {
          }
          quickPreferenceListenerRegistered = false;
        }
        trackerRuntime = null;
        faceStatusMessageContext = null;
        lastFacePositionBroadcastAtMs = null;
        lastBroadcastStable = null;
        lastGazeSmokeLogAtMs = null;
        lastAoiProbeAtMs = null;
      }
    },
    {
      once: true
    }
  );
  pageLifecycleCleanupRegistered = true;
}
function createInitializedTrackerRuntime() {
  const videoElement = getCameraVideoElement();
  const runtime = new TrackerRuntime(
    videoElement,
    reportTrackerErrorToBackground,
    reportFacePositionStatus,
    (result) => {
      reportRuntimeDriftStatus(result);
      reportLongitudinalRuntimeDiagnostic(result);
      if (!result.maintenanceCalibrationActive) {
        reportCompletedFixationFrame(result);
        reportAoiProbeFrame(result);
      }
      reportRawGazeSmokeFrame(result);
    }
  );
  runtime.initialize();
  return runtime;
}
function installInitializedTrackerRuntime(runtime) {
  trackerRuntime = runtime;
  lastRuntimeInitializationError = null;
  registerQuickRecalibrationPreferenceListenerSafely();
  void loadQuickRecalibrationPreference(runtime);
  logger12.info(
    "Offscreen tracker runtime is ready.",
    { ready: runtime.isReady() }
  );
}
function tryInitializeTrackerRuntime() {
  if (trackerRuntime !== null && trackerRuntime.isReady()) {
    return trackerRuntime;
  }
  if (trackerRuntime !== null) {
    try {
      trackerRuntime.dispose();
    } catch {
    }
    trackerRuntime = null;
  }
  try {
    const runtime = createInitializedTrackerRuntime();
    installInitializedTrackerRuntime(runtime);
    return runtime;
  } catch (error) {
    const diagnostic = getErrorDiagnostic(error);
    const normalized = normalizeTrackerError(
      error,
      ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
      "OFFSCREEN",
      "Offscreen TrackerRuntime initialization failed.",
      {
        recoverable: true,
        details: {
          originalName: diagnostic.name,
          originalMessage: diagnostic.message,
          originalStack: diagnostic.stack
        }
      }
    );
    lastRuntimeInitializationError = normalized;
    trackerRuntime = null;
    logger12.error(
      "Offscreen TrackerRuntime initialization attempt failed; transport remains available for retry.",
      {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        cause: diagnostic
      }
    );
    return null;
  }
}
async function ensureTrackerRuntimeReady() {
  const existing = trackerRuntime !== null && trackerRuntime.isReady() ? trackerRuntime : null;
  if (existing !== null) {
    return existing;
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const runtime = tryInitializeTrackerRuntime();
    if (runtime !== null) {
      return runtime;
    }
    if (attempt < 2) {
      await sleep(150);
    }
  }
  throw new TrackerError(
    ERROR_CODES.OFFSCREEN_NOT_AVAILABLE,
    "OFFSCREEN",
    "TrackerRuntime could not be initialized for the requested command.",
    {
      recoverable: true,
      details: {
        lastInitializationError: lastRuntimeInitializationError?.toSerializable() ?? null
      }
    }
  );
}
function bootstrapOffscreen() {
  registerRuntimeMessageListener();
  registerPageLifecycleCleanup();
  const runtime = tryInitializeTrackerRuntime();
  if (runtime === null) {
    logger12.warn(
      "Offscreen document transport initialized, but TrackerRuntime will retry on the first command.",
      {
        lastInitializationError: lastRuntimeInitializationError?.toSerializable() ?? null
      }
    );
    return;
  }
  logger12.info(
    "Offscreen document initialized.",
    { ready: runtime.isReady() }
  );
}
bootstrapOffscreen();
//# sourceMappingURL=offscreen.js.map
