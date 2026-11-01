"use strict";
(() => {
  // src/shared/constants.ts
  var HEAD_POSE_RUNTIME = {
    MATRIX_ROWS: 4,
    MATRIX_COLUMNS: 4,
    MATRIX_ELEMENT_COUNT: 16,
    MIN_AXIS_SCALE: 1e-6,
    MAX_RELATIVE_SCALE_SPREAD: 0.15,
    MAX_ORTHOGONALITY_ERROR: 0.12,
    MIN_THIRD_AXIS_ALIGNMENT: 0.85,
    GIMBAL_LOCK_COS_THRESHOLD: 1e-6,
    MIN_FALLBACK_AXIS_LENGTH: 1e-6,
    RADIANS_TO_DEGREES: 180 / Math.PI
  };
  var GAZE_OVERLAY = {
    STORAGE_KEY: "etc.gazeOverlayEnabled.v1",
    DEFAULT_ENABLED: false,
    DIAMETER_PX: 42,
    SMOOTHING_ALPHA: 0.32,
    STALE_HIDE_DELAY_MS: 180,
    Z_INDEX: 2147483647
  };
  var QUICK_RECALIBRATION = {
    STORAGE_KEY: "etc.quickRecalibrationEnabled.v1",
    DEFAULT_ENABLED: false,
    // Recovery if Content crashes, disconnects, or never reports a failed point.
    MAX_RUN_DURATION_MS: 5 * 6e4
  };
  var CALIBRATION = {
    /**
     * Research experiment default: always collect the full balanced 5x5 lattice.
     * STANDARD_17 and adaptive expansion remain available in code for later
     * service/fast modes, but the active experiment flow starts in PRECISION_25.
     */
    DEFAULT_MODE: "PRECISION_25",
    /**
     * Calibration A/B strategy switch.
     *
     * PROJECT_RESIDUAL_ONLY:
     * - reset WebEyeTrack to its generic baseline at calibration start;
     * - fit and retain the project residual model;
     * - do not apply native WebEyeTrack personalization.
     *
     * WEBEYETRACK_NATIVE_ONLY:
     * - collect the same project calibration points;
     * - apply WebEyeTrack native personalization after collection;
     * - replace the project residual model with identity so correction is not
     *   applied twice.
     *
     * Run independent validation after each strategy before deciding which path
     * should become the production default.
     */
    CORRECTION_STRATEGY: "PROJECT_RESIDUAL_ONLY",
    STANDARD_POINT_COUNT: 17,
    PRECISION_POINT_COUNT: 25,
    /**
     * Visible calibration UI retry policy. The collector already waits up to
     * POINT_TIMEOUT_MS for each attempt; these values only control participant
     * retry behavior after an attempt is still insufficient.
     */
    MAX_POINT_ATTEMPTS: 3,
    POINT_RETRY_PAUSE_MS: 500,
    /**
     * Brief handoff after pre-calibration completes so the preparation panel can
     * disappear before the first fixation target is shown.
     */
    UI_START_DELAY_MS: 550,
    /**
     * When independent validation is POOR, keep the warning visible long
     * enough for the participant/researcher to notice that recalibration is
     * recommended, then return to the research page in degraded collection
     * mode. FAIL remains blocking.
     */
    DEGRADED_COLLECTION_WARNING_MS: 3e3,
    /**
     * Initial movement interval after a target appears.
     * Samples from this interval are ignored.
     */
    TARGET_SETTLE_MS: 450,
    /**
     * Candidate-data collection interval after the minimum settling period.
     * A point may finish after the minimum window only when a stable sub-window
     * is already available. Otherwise collection continues up to the maximum
     * window before the point is retried/fails quality checks.
     */
    SAMPLE_WINDOW_MIN_MS: 800,
    SAMPLE_WINDOW_MAX_MS: 1200,
    /**
     * Sliding stability window used to choose the cleanest fixation segment.
     * At ~30 Hz, 500 ms normally contains about 15 samples.
     */
    STABILITY_WINDOW_MS: 500,
    STABILITY_MIN_WINDOW_DURATION_MS: 280,
    STABILITY_MIN_SAMPLE_COUNT: 10,
    STABILITY_MAX_FRAME_GAP_MS: 120,
    /**
     * Cross-device stability adaptation. A fixed 10 samples / 500 ms gate is
     * impossible below roughly 20 Hz, which can occur on Windows laptops when
     * WebEyeTrack + MediaPipe + the deep observer share GPU/CPU time. Keep the
     * original 10-sample rule on healthy hosts, but derive a smaller count and
     * a slightly longer temporal window from the measured baseline cadence.
     */
    STABILITY_ADAPTIVE_TARGET_DURATION_MS: 420,
    STABILITY_ADAPTIVE_MIN_SAMPLE_COUNT: 5,
    STABILITY_ADAPTIVE_MAX_WINDOW_MS: 1e3,
    STABILITY_ADAPTIVE_WINDOW_MARGIN: 1.35,
    STABILITY_ADAPTIVE_FRAME_GAP_MULTIPLIER: 2.5,
    STABILITY_ADAPTIVE_MAX_FRAME_GAP_MS: 350,
    STABILITY_CADENCE_MAX_INTERVAL_MS: 1e3,
    /**
     * Calibration-only robust spike rejection performed before stability
     * scoring. It never uses the target coordinate, so it cannot pull gaze
     * toward the expected answer; it only removes isolated prediction spikes.
     */
    STABILITY_PREFILTER_MAD_SCALE: 3.5,
    STABILITY_PREFILTER_MIN_RADIUS_NORMALIZED: 0.02,
    STABILITY_PREFILTER_MIN_INLIER_RATIO: 0.6,
    /**
     * V5 calibration-only temporal median radius. Stability metrics use a
     * 3-sample centered median trajectory (radius 1) to suppress alternating
     * one-frame model noise. Raw calibration samples remain unchanged and are
     * still robustly cleaned before model fitting.
     */
    STABILITY_TEMPORAL_MEDIAN_RADIUS: 1,
    /**
     * Pilot defaults for within-point stability. These are intentionally
     * permissive enough for webcam gaze noise while still rejecting active
     * saccades/head movement. They should be tuned from calibration diagnostics.
     */
    STABILITY_MAX_GAZE_VELOCITY_RMS_PER_SEC: 2.5,
    STABILITY_MAX_GAZE_DISPERSION_RMS_NORMALIZED: 0.055,
    STABILITY_MAX_YAW_SPAN_DEG: 5,
    STABILITY_MAX_PITCH_SPAN_DEG: 5,
    STABILITY_MAX_ROLL_SPAN_DEG: 4,
    STABILITY_MAX_FACE_CENTER_SPAN_NORMALIZED: 0.035,
    STABILITY_MAX_FACE_DISTANCE_SPAN_RATIO: 0.1,
    /**
     * Calibration-only baseline drift guard. Head pose is already a BlazeGaze
     * input; these limits are therefore used as a quality gate rather than as a
     * second corrective gaze model.
     */
    BASELINE_MAX_YAW_DELTA_DEG: 12,
    BASELINE_MAX_PITCH_DELTA_DEG: 12,
    BASELINE_MAX_ROLL_DELTA_DEG: 10,
    BASELINE_MAX_FACE_CENTER_DELTA_NORMALIZED: 0.09,
    BASELINE_MAX_FACE_DISTANCE_DELTA_RATIO: 0.2,
    /**
     * WebEyeTrack-native few-shot personalization. Targets are converted from
     * project normalized 0..1 coordinates to the upstream centered -0.5..0.5
     * convention before adaptation. Keep the upstream defaults conservative;
     * independent 9-point validation remains the acceptance gate.
     */
    WEBEYETRACK_PERSONALIZATION_ENABLED: true,
    WEBEYETRACK_PERSONALIZATION_MIN_POINT_COUNT: 4,
    /** Center + four corners + four edge midpoints in the current pattern. */
    WEBEYETRACK_PERSONALIZATION_MAX_SUPPORT_POINTS: 9,
    WEBEYETRACK_PERSONALIZATION_STEPS: 1,
    WEBEYETRACK_PERSONALIZATION_INNER_LR: 1e-5,
    WEBEYETRACK_PERSONALIZATION_TIMESTAMP_TOLERANCE_MS: 1.5,
    WEBEYETRACK_PERSONALIZATION_MAX_CANDIDATES_PER_POINT: 48,
    /**
     * Minimum number of accepted samples required for one target.
     *
     * At ~30 Hz, 800 ms can contain roughly 24 frames,
     * so this allows rejection of blink/invalid/outlier frames.
     */
    MIN_ACCEPTED_SAMPLES_PER_POINT: 10,
    /**
     * Maximum time to wait for a calibration point to collect enough
     * usable samples before considering the point unsuccessful.
     */
    POINT_TIMEOUT_MS: 3e3,
    /**
     * Cross-device collection protection. The collector keeps the ordinary
     * 3 s budget on healthy hosts, but may extend a point when the observed
     * baseline gaze cadence is low. Quality/stability thresholds are unchanged.
     */
    POINT_TIMEOUT_MEDIUM_FPS_MS: 3500,
    POINT_TIMEOUT_LOW_FPS_MS: 5e3,
    POINT_TIMEOUT_MEDIUM_FPS_THRESHOLD_HZ: 20,
    POINT_TIMEOUT_LOW_FPS_THRESHOLD_HZ: 10,
    /**
     * Maximum proportion of rejected frames before the point should
     * be considered unreliable.
     */
    MAX_REJECTION_RATIO: 0.7,
    /**
     * Keep calibration targets away from the exact browser viewport edge.
     * This reduces clipping and makes targets easier to fixate.
     */
    TARGET_MARGIN_RATIO: 0.08,
    /**
     * Calibration uses a stricter quality floor than ordinary gaze recording.
     */
    MIN_SAMPLE_QUALITY: 0.6,
    /**
     * Robust outlier rejection in normalized gaze space.
     * A small absolute radius prevents an almost-zero MAD from rejecting every
     * sample when predictions are tightly clustered.
     */
    OUTLIER_MAD_SCALE: 3.5,
    OUTLIER_MIN_RADIUS_NORMALIZED: 0.015,
    /**
     * Ridge penalty for the lightweight affine residual model.
     * The intercept is intentionally not regularized.
     */
    RESIDUAL_RIDGE_LAMBDA: 1e-3,
    /** Calibration-only nonlinear residual candidates. Selection uses
     * leave-one-point-out error from calibration points only; independent
     * validation targets are never used for model selection. */
    RESIDUAL_QUADRATIC_RIDGE_LAMBDAS: [1e-3, 5e-3, 0.02],
    RESIDUAL_RBF_GAMMAS: [2, 8, 24],
    RESIDUAL_RBF_RIDGE_LAMBDAS: [1e-3, 5e-3, 0.02],
    RESIDUAL_CV_P95_WEIGHT: 0.35,
    RESIDUAL_QUADRATIC_COMPLEXITY_PENALTY: 6e-4,
    RESIDUAL_RBF_COMPLEXITY_PENALTY: 12e-4,
    RESIDUAL_NONLINEAR_MIN_CV_IMPROVEMENT: 15e-4,
    /**
     * At least four spatially distinct point summaries are required before
     * fitting the 2D affine residual model.
     */
    MIN_MODEL_POINT_COUNT: 4,
    /**
     * Independent validation should cover center, edges and corners.
     */
    /** Engine-level minimum. Full validation still uses 9 points; quick re-validation uses 3. */
    MIN_VALIDATION_POINT_COUNT: 3
  };
  var DRIFT_THRESHOLDS = {
    FACE_CENTER_LOW_PX: 20,
    FACE_CENTER_MEDIUM_PX: 40,
    FACE_CENTER_HIGH_PX: 70,
    FACE_DISTANCE_LOW_RATIO: 0.08,
    FACE_DISTANCE_MEDIUM_RATIO: 0.15,
    FACE_DISTANCE_HIGH_RATIO: 0.25,
    HEAD_POSE_LOW_DEG: 5,
    HEAD_POSE_MEDIUM_DEG: 10,
    HEAD_POSE_HIGH_DEG: 18,
    QUICK_RECALIBRATION_POINT_COUNT: 5,
    QUICK_REVALIDATION_POINT_COUNT: 3,
    QUICK_RECALIBRATION_COOLDOWN_MS: 2 * 6e4,
    /** Persistence guards so transient posture changes do not trigger drift. */
    HIGH_PERSIST_MS: 900,
    QUICK_RECALIBRATION_HIGH_PERSIST_MS: 4e3,
    QUICK_RECALIBRATION_MEDIUM_PERSIST_MS: 12e3
  };
  var RUNTIME_MAINTENANCE = {
    /** Missing observations cannot prove sustained drift (independent of wall-clock maintenance). */
    MAX_CONTINUOUS_OBSERVATION_GAP_MS: 1500,
    MEDIUM_DRIFT_QUALITY_MULTIPLIER: 0.72,
    HIGH_DRIFT_QUALITY_MULTIPLIER: 0.35,
    SUSPEND_COLLECTION_ON_RECALIBRATION_RECOMMENDATION: true,
    QUICK_FAILURE_LIMIT_BEFORE_FULL_CALIBRATION: 2,
    QUICK_REPEAT_LIMIT_BEFORE_FULL_CALIBRATION: 2,
    QUICK_REPEAT_WINDOW_MS: 5 * 6e4,
    /**
     * V7-B: target-free precision reference is learned only from early
     * fixation-like windows after independent validation. This follows the
     * mobile/iPad-style principle of continuously checking that the face/gaze
     * state remains close to the calibrated operating envelope.
     */
    PRECISION_REFERENCE_MIN_SAMPLES: 8,
    PRECISION_REFERENCE_TARGET_SAMPLES: 16,
    PRECISION_REFERENCE_MIN_CAPTURE_MS: 8e3,
    PRECISION_REFERENCE_MAX_CAPTURE_MS: 3e4,
    PRECISION_REFERENCE_MIN_QUALITY: 0.6,
    /** Relative precision deterioration versus the participant's own baseline. */
    PRECISION_LOW_RATIO: 1.35,
    PRECISION_MEDIUM_RATIO: 1.75,
    PRECISION_HIGH_RATIO: 2.5,
    /** Absolute viewport-normalized dispersion guards for poor initial baselines. */
    PRECISION_MEDIUM_VIEWPORT_WIDTH_RATIO: 0.028,
    PRECISION_HIGH_VIEWPORT_WIDTH_RATIO: 0.045,
    /** Persistence guards prevent a single noisy fixation from triggering UI. */
    PRECISION_HIGH_PERSIST_MS: 5e3,
    PRECISION_MEDIUM_PERSIST_MS: 15e3,
    /** Do not interrupt the first minute of an otherwise valid tracking run. */
    AUTO_QUICK_RECALIBRATION_MIN_MONITORING_MS: 6e4,
    /**
     * Recalibration cannot fix poor lighting/occlusion. Automatic maintenance is
     * therefore allowed only while the base gaze-quality signal is usable.
     */
    AUTO_QUICK_RECALIBRATION_MIN_QUALITY: 0.55,
    /**
     * Multi-point maintenance calibration approximately every twenty minutes.
     * Longitudinal studies show systematic gaze error is not stable indefinitely
     * and benefits from repeated multi-location correction rather than a single
     * centre-point drift correction.
     */
    PERIODIC_MAINTENANCE_INTERVAL_MS: 20 * 6e4,
    /**
     * Apple exposes gaze-pointer smoothing to trade responsiveness for stability.
     * We apply a bounded automatic boost only to the derived stabilized stream;
     * raw/calibration/validation coordinates are never altered by this setting.
     */
    ADAPTIVE_SMOOTHING_START_RATIO: 1.35,
    ADAPTIVE_SMOOTHING_GAIN: 0.55,
    ADAPTIVE_SMOOTHING_MAX_MULTIPLIER: 2,
    LONGITUDINAL_MILESTONES_MS: [0, 2 * 6e4, 5 * 6e4, 10 * 6e4]
  };
  var PAGE_TRACKING = {
    /**
     * Native scroll events can arrive faster than the display refresh rate.
     * Coalesce them to one event per animation frame while preserving START /
     * MOVE / END semantics.
     */
    SCROLL_END_IDLE_MS: 120,
    /**
     * Development smoke logging only. D25 will persist every accepted scroll
     * record rather than relying on this cadence.
     */
    SCROLL_SMOKE_LOG_INTERVAL_MS: 500
  };
  var AOI = {
    /**
     * Maximum DOM ancestor depth searched when resolving a semantic/
     * interactive parent from the element directly under the gaze point.
     */
    MAX_INTERACTIVE_ANCESTOR_DEPTH: 8,
    /**
     * Maximum number of AOI candidates retained around one gaze point.
     */
    MAX_HIT_CANDIDATES: 5,
    /**
     * Distance around gaze used by future uncertainty-aware AOI resolution.
     */
    DEFAULT_SEARCH_RADIUS_PX: 40,
    /**
     * Maximum AOI DOM-probe cadence. Keeping this below the camera cadence
     * prevents expensive elementsFromPoint() calls from competing with gaze
     * inference while remaining fast enough for fixation/AOI assignment.
     */
    PROBE_INTERVAL_MS: 50,
    MUTATION_DEBOUNCE_MS: 100,
    RESIZE_DEBOUNCE_MS: 100
  };
  var PRIVACY_DEFAULTS = {
    STORE_WEBCAM_FRAMES: false,
    STORE_FACE_IMAGES: false,
    STORE_EYE_CROPS: false,
    STORE_FULL_FACE_LANDMARKS: false,
    DEFAULT_TEXT_STORAGE_POLICY: "HASHED"
  };
  var RUNTIME_LIMITS = {
    MAX_DIAGNOSTIC_DETAILS_DEPTH: 5,
    MAX_AOI_TEXT_LENGTH: 250,
    MAX_URL_LENGTH: 8192
  };

  // src/calibration/calibrationPattern.ts
  var STANDARD_SEQUENCE = [
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
    [1, 2]
  ];
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
  var VALIDATION_INSET_RATIO = 0.18;
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
        const x = axis[column];
        const y = axis[row];
        if (x === void 0 || y === void 0) {
          throw new RangeError(
            "Calibration pattern contains an invalid grid index."
          );
        }
        const normalizedPoint = {
          x,
          y
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
  function createCalibrationPattern(mode, viewport) {
    switch (mode) {
      case "STANDARD_17":
        return createTargetsFromSequence(
          STANDARD_SEQUENCE,
          viewport
        );
      case "PRECISION_25":
        return createTargetsFromSequence(
          PRECISION_SEQUENCE,
          viewport
        );
    }
  }
  function createCalibrationValidationPattern(viewport) {
    assertViewportSize(viewport);
    const low = VALIDATION_INSET_RATIO;
    const center = 0.5;
    const high = 1 - VALIDATION_INSET_RATIO;
    const normalizedPoints = [
      { x: center, y: center },
      { x: low, y: low },
      { x: high, y: low },
      { x: high, y: high },
      { x: low, y: high },
      { x: center, y: low },
      { x: high, y: center },
      { x: center, y: high },
      { x: low, y: center }
    ];
    return normalizedPoints.map(
      (normalizedPoint, pointIndex) => ({
        pointIndex,
        normalizedPoint,
        viewportPoint: normalizedToViewport(
          normalizedPoint,
          viewport
        )
      })
    );
  }
  function createQuickRecalibrationPattern(viewport, startingPointIndex) {
    assertViewportSize(viewport);
    if (!Number.isInteger(startingPointIndex) || startingPointIndex < 0) {
      throw new RangeError(
        "Quick recalibration requires a non-negative integer starting point index."
      );
    }
    const low = VALIDATION_INSET_RATIO;
    const center = 0.5;
    const high = 1 - VALIDATION_INSET_RATIO;
    const normalizedPoints = [
      { x: center, y: center },
      { x: low, y: low },
      { x: high, y: low },
      { x: high, y: high },
      { x: low, y: high }
    ];
    return normalizedPoints.map((normalizedPoint, offset) => ({
      pointIndex: startingPointIndex + offset,
      normalizedPoint,
      viewportPoint: normalizedToViewport(normalizedPoint, viewport)
    }));
  }
  function createQuickValidationPattern(viewport) {
    assertViewportSize(viewport);
    const low = VALIDATION_INSET_RATIO;
    const center = 0.5;
    const high = 1 - VALIDATION_INSET_RATIO;
    const normalizedPoints = [
      { x: center, y: center },
      { x: center, y: low },
      { x: high, y: high }
    ];
    return normalizedPoints.map((normalizedPoint, pointIndex) => ({
      pointIndex,
      normalizedPoint,
      viewportPoint: normalizedToViewport(normalizedPoint, viewport)
    }));
  }

  // src/shared/messages.ts
  var MESSAGE_PROTOCOL_VERSION = 5;
  var MESSAGE_TYPES = {
    PING: "PING",
    PONG: "PONG",
    INIT_TRACKER: "INIT_TRACKER",
    TRACKER_INITIALIZED: "TRACKER_INITIALIZED",
    START_CAMERA: "START_CAMERA",
    CAMERA_READY: "CAMERA_READY",
    START_FACE_POSITIONING: "START_FACE_POSITIONING",
    FACE_POSITION_STATUS: "FACE_POSITION_STATUS",
    START_CALIBRATION: "START_CALIBRATION",
    CALIBRATION_UI_READY: "CALIBRATION_UI_READY",
    CALIBRATION_POINT: "CALIBRATION_POINT",
    CALIBRATION_POINT_RESULT: "CALIBRATION_POINT_RESULT",
    CALIBRATION_COMPLETE: "CALIBRATION_COMPLETE",
    START_VALIDATION: "START_VALIDATION",
    VALIDATION_POINT: "VALIDATION_POINT",
    VALIDATION_POINT_RESULT: "VALIDATION_POINT_RESULT",
    VALIDATION_RESULT: "VALIDATION_RESULT",
    START_QUICK_RECALIBRATION: "START_QUICK_RECALIBRATION",
    QUICK_RECALIBRATION_STARTED: "QUICK_RECALIBRATION_STARTED",
    ABORT_QUICK_RECALIBRATION: "ABORT_QUICK_RECALIBRATION",
    QUICK_RECALIBRATION_POINT: "QUICK_RECALIBRATION_POINT",
    QUICK_RECALIBRATION_POINT_RESULT: "QUICK_RECALIBRATION_POINT_RESULT",
    START_QUICK_VALIDATION: "START_QUICK_VALIDATION",
    QUICK_VALIDATION_POINT: "QUICK_VALIDATION_POINT",
    QUICK_VALIDATION_POINT_RESULT: "QUICK_VALIDATION_POINT_RESULT",
    START_RECORDING: "START_RECORDING",
    PAUSE_RECORDING: "PAUSE_RECORDING",
    RESUME_RECORDING: "RESUME_RECORDING",
    STOP_RECORDING: "STOP_RECORDING",
    GET_TRACKER_STATE: "GET_TRACKER_STATE",
    RESET_TRACKER: "RESET_TRACKER",
    TRACKER_STATE_CHANGED: "TRACKER_STATE_CHANGED",
    SESSION_STARTED: "SESSION_STARTED",
    SESSION_ENDED: "SESSION_ENDED",
    PAGE_READY: "PAGE_READY",
    PAGE_EVENT: "PAGE_EVENT",
    TAB_CHANGED: "TAB_CHANGED",
    TRACKING_CONTEXT_CHANGED: "TRACKING_CONTEXT_CHANGED",
    VIEWPORT_CONTEXT_CHANGED: "VIEWPORT_CONTEXT_CHANGED",
    AOI_PROBE: "AOI_PROBE",
    AOI_HIT: "AOI_HIT",
    AOI_REGISTRY_UPDATE: "AOI_REGISTRY_UPDATE",
    GAZE_SAMPLE: "GAZE_SAMPLE",
    POINTER_SAMPLE: "POINTER_SAMPLE",
    CLICK_EVENT: "CLICK_EVENT",
    SCROLL_EVENT: "SCROLL_EVENT",
    FIXATION_EVENT: "FIXATION_EVENT",
    EXPORT_SESSION: "EXPORT_SESSION",
    SESSION_EXPORT_READY: "SESSION_EXPORT_READY",
    DRIFT_STATUS: "DRIFT_STATUS",
    RUNTIME_QUALITY_DIAGNOSTIC: "RUNTIME_QUALITY_DIAGNOSTIC",
    TRACKER_ERROR: "TRACKER_ERROR"
  };
  function createRuntimeMessage(type, meta, payload) {
    return {
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      type,
      meta,
      payload
    };
  }
  var MESSAGE_TYPE_VALUES = new Set(Object.values(MESSAGE_TYPES));
  function isCompatibleMessageProtocol(value) {
    return value === MESSAGE_PROTOCOL_VERSION;
  }

  // src/shared/utils.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function nowEpochMs() {
    return Date.now();
  }
  function nowTimelineMs() {
    const timeOrigin = globalThis.performance.timeOrigin;
    const elapsed = globalThis.performance.now();
    const timestamp = timeOrigin + elapsed;
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
    return Date.now();
  }
  function sleep(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return Promise.reject(
        new RangeError(
          "sleep() duration must be a finite, non-negative number."
        )
      );
    }
    return new Promise(
      (resolve) => {
        globalThis.setTimeout(
          resolve,
          durationMs
        );
      }
    );
  }
  function createPrefixedId(prefix) {
    if (prefix.length === 0) {
      throw new Error(
        "ID prefix must not be empty."
      );
    }
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  function createMessageId() {
    return createPrefixedId(
      "msg"
    );
  }

  // src/content/calibrationOverlay.ts
  var CalibrationOverlay = class {
    host = null;
    statusElement = null;
    progressElement = null;
    targetElement = null;
    showPreparing(totalPoints) {
      this.ensureMounted();
      this.setTargetVisible(false);
      this.setStatus(
        "\uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4. \uB098\uD0C0\uB098\uB294 \uC810\uC758 \uC911\uC2EC\uC744 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `0 / ${totalPoints}`
      );
    }
    showTarget(target, completedPointCount, totalPoints, attempt) {
      this.ensureMounted();
      if (this.targetElement === null) {
        return;
      }
      this.targetElement.style.left = `${target.viewportPoint.x}px`;
      this.targetElement.style.top = `${target.viewportPoint.y}px`;
      this.setTargetVisible(true);
      this.setStatus(
        attempt === 1 ? "\uC810\uC758 \uC911\uC2EC\uC744 \uBC14\uB77C\uBCF4\uACE0 \uC2DC\uC120\uC744 \uC7A0\uC2DC \uC720\uC9C0\uD574 \uC8FC\uC138\uC694." : "\uC720\uD6A8\uD55C \uC2DC\uC120 \uB370\uC774\uD130\uAC00 \uBD80\uC871\uD588\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uC810\uC744 \uB2E4\uC2DC \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `${completedPointCount + 1} / ${totalPoints}` + (attempt > 1 ? ` \xB7 \uC7AC\uCE21\uC815 ${attempt}` : "")
      );
    }
    showAdaptiveExpansion(completedPointCount, totalPointCount, additionalPointCount) {
      this.setTargetVisible(false);
      this.setStatus(
        `\uCD08\uAE30 \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC5D0\uC11C \uCDE8\uC57D \uC601\uC5ED\uC774 \uD655\uC778\uB418\uC5B4 ${additionalPointCount}\uAC1C \uC9C0\uC810\uC744 \uCD94\uAC00 \uCE21\uC815\uD569\uB2C8\uB2E4.`
      );
      this.setProgress(
        `${completedPointCount} / ${totalPointCount} \xB7 \uC801\uC751\uD615 \uBCF4\uAC15`
      );
    }
    showQuickRecalibrationPreparing(totalPoints) {
      this.ensureMounted();
      this.setTargetVisible(false);
      this.setStatus(
        "\uC2DC\uC120 \uC815\uD655\uB3C4 \uC800\uD558\uAC00 \uAC10\uC9C0\uB418\uC5B4 \uC9E7\uC740 \uC7AC\uBCF4\uC815\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4. \uD604\uC7AC \uC790\uC138\uB97C \uC720\uC9C0\uD55C \uCC44 \uB098\uD0C0\uB098\uB294 \uC810\uC744 \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `\uBE60\uB978 \uC7AC\uBCF4\uC815 0 / ${totalPoints}`
      );
    }
    showQuickRecalibrationTarget(target, completedPointCount, totalPoints, attempt) {
      this.ensureMounted();
      if (this.targetElement === null) {
        return;
      }
      this.targetElement.style.left = `${target.viewportPoint.x}px`;
      this.targetElement.style.top = `${target.viewportPoint.y}px`;
      this.setTargetVisible(true);
      this.setStatus(
        attempt === 1 ? "\uBE60\uB978 \uC7AC\uBCF4\uC815 \uC911\uC785\uB2C8\uB2E4. \uC810 \uC911\uC2EC\uC744 \uBC14\uB77C\uBCF4\uACE0 \uBA38\uB9AC\uB294 \uD604\uC7AC \uC704\uCE58\uC5D0\uC11C \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uC720\uC9C0\uD574 \uC8FC\uC138\uC694." : "\uC720\uD6A8 \uB370\uC774\uD130\uAC00 \uBD80\uC871\uD588\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uC810\uC744 \uB2E4\uC2DC \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `\uBE60\uB978 \uC7AC\uBCF4\uC815 ${completedPointCount + 1} / ${totalPoints}` + (attempt > 1 ? ` \xB7 \uC7AC\uCE21\uC815 ${attempt}` : "")
      );
    }
    showQuickValidationPreparing(totalPoints) {
      this.ensureMounted();
      this.setTargetVisible(false);
      this.setStatus(
        "\uC7AC\uBCF4\uC815 \uACB0\uACFC\uB97C \uB3C5\uB9BD\uC801\uC73C\uB85C \uD655\uC778\uD569\uB2C8\uB2E4. \uB9C8\uC9C0\uB9C9 \uBA87 \uAC1C\uC758 \uC810\uC744 \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(`\uBE60\uB978 \uAC80\uC99D 0 / ${totalPoints}`);
    }
    showQuickValidationTarget(target, completedPointCount, totalPoints, attempt) {
      this.ensureMounted();
      if (this.targetElement === null) {
        return;
      }
      this.targetElement.style.left = `${target.viewportPoint.x}px`;
      this.targetElement.style.top = `${target.viewportPoint.y}px`;
      this.setTargetVisible(true);
      this.setStatus(
        attempt === 1 ? "\uBE60\uB978 \uC815\uD655\uB3C4 \uAC80\uC99D \uC911\uC785\uB2C8\uB2E4. \uC810 \uC911\uC2EC\uC744 \uC7A0\uC2DC \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694." : "\uAC80\uC99D \uB370\uC774\uD130\uAC00 \uBD80\uC871\uD588\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uC810\uC744 \uB2E4\uC2DC \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `\uBE60\uB978 \uAC80\uC99D ${completedPointCount + 1} / ${totalPoints}` + (attempt > 1 ? ` \xB7 \uC7AC\uCE21\uC815 ${attempt}` : "")
      );
    }
    showQuickValidationCompleted(quality, metrics) {
      this.setTargetVisible(false);
      const passed = quality === "GOOD" || quality === "ACCEPTABLE";
      this.setStatus(
        passed ? "\uBE60\uB978 \uC7AC\uBCF4\uC815\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC2DC\uC120 \uCD94\uC801\uC744 \uACC4\uC18D\uD569\uB2C8\uB2E4." : "\uBE60\uB978 \uC7AC\uBCF4\uC815 \uD6C4\uC5D0\uB3C4 \uC815\uD655\uB3C4\uAC00 \uB0AE\uC2B5\uB2C8\uB2E4. \uAC00\uB2A5\uD55C \uACBD\uC6B0 \uC804\uCCB4 \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC744 \uB2E4\uC2DC \uC9C4\uD589\uD574 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `${quality} \xB7 \uD3C9\uADE0 ${metrics.meanErrorPx.toFixed(1)} px \xB7 P95 ${metrics.p95ErrorPx.toFixed(1)} px \xB7 \uC815\uBC00\uB3C4 ${metrics.meanPrecisionPx.toFixed(1)} px`
      );
    }
    showRetrying() {
      this.setTargetVisible(false);
      this.setStatus(
        "\uC7A0\uC2DC \uD6C4 \uAC19\uC740 \uC9C0\uC810\uC744 \uB2E4\uC2DC \uCE21\uC815\uD569\uB2C8\uB2E4. \uC5BC\uAD74\uC740 \uAC00\uB2A5\uD55C \uD55C \uADF8\uB300\uB85C \uC720\uC9C0\uD574 \uC8FC\uC138\uC694."
      );
    }
    showCompleted(totalPoints, trainingRmseNormalized) {
      this.setTargetVisible(false);
      const diagnostic = trainingRmseNormalized === null ? "" : ` \xB7 \uD559\uC2B5 RMSE ${trainingRmseNormalized.toFixed(4)}`;
      this.setStatus(
        `${totalPoints}-point \uCE98\uB9AC\uBE0C\uB808\uC774\uC158 \uC218\uC9D1\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB3C5\uB9BD \uC815\uD655\uB3C4 \uAC80\uC99D \uB2E8\uACC4\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.`
      );
      this.setProgress(
        `\uC218\uC9D1 \uC644\uB8CC${diagnostic}`
      );
    }
    showValidationPreparing(totalPoints) {
      this.ensureMounted();
      this.setTargetVisible(false);
      this.setStatus(
        "\uCE98\uB9AC\uBE0C\uB808\uC774\uC158 \uC815\uD655\uB3C4\uB97C \uB3C5\uB9BD\uC801\uC73C\uB85C \uAC80\uC99D\uD569\uB2C8\uB2E4. \uB2E4\uC2DC \uB098\uD0C0\uB098\uB294 \uC810\uC758 \uC911\uC2EC\uC744 \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `\uAC80\uC99D 0 / ${totalPoints}`
      );
    }
    showValidationTarget(target, completedPointCount, totalPoints, attempt) {
      this.ensureMounted();
      if (this.targetElement === null) {
        return;
      }
      this.targetElement.style.left = `${target.viewportPoint.x}px`;
      this.targetElement.style.top = `${target.viewportPoint.y}px`;
      this.setTargetVisible(true);
      this.setStatus(
        attempt === 1 ? "\uC815\uD655\uB3C4 \uAC80\uC99D \uC911\uC785\uB2C8\uB2E4. \uC810\uC758 \uC911\uC2EC\uC744 \uBC14\uB77C\uBCF4\uACE0 \uC2DC\uC120\uC744 \uC7A0\uC2DC \uC720\uC9C0\uD574 \uC8FC\uC138\uC694." : "\uAC80\uC99D\uC6A9 \uC2DC\uC120 \uB370\uC774\uD130\uAC00 \uBD80\uC871\uD588\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uC810\uC744 \uB2E4\uC2DC \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694."
      );
      this.setProgress(
        `\uAC80\uC99D ${completedPointCount + 1} / ${totalPoints}` + (attempt > 1 ? ` \xB7 \uC7AC\uCE21\uC815 ${attempt}` : "")
      );
    }
    showValidationCompleted(quality, metrics) {
      this.setTargetVisible(false);
      const passed = quality === "GOOD" || quality === "ACCEPTABLE";
      this.setStatus(
        passed ? "\uB3C5\uB9BD \uC815\uD655\uB3C4 \uAC80\uC99D\uC744 \uD1B5\uACFC\uD588\uC2B5\uB2C8\uB2E4. \uC544\uC774\uD2B8\uB798\uCEE4\uAC00 \uC900\uBE44\uB418\uC5C8\uC2B5\uB2C8\uB2E4." : quality === "POOR" ? "\uB3C5\uB9BD \uC815\uD655\uB3C4 \uAC80\uC99D \uAE30\uC900\uC744 \uCDA9\uC871\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7AC\uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC744 \uAD8C\uC7A5\uD569\uB2C8\uB2E4. 3\uCD08 \uD6C4 \uD604\uC7AC \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC73C\uB85C \uC218\uC9D1\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4." : "\uB3C5\uB9BD \uC815\uD655\uB3C4 \uAC80\uC99D \uAE30\uC900\uC744 \uCDA9\uC871\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7AC\uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC774 \uD544\uC694\uD569\uB2C8\uB2E4."
      );
      this.setProgress(
        `${quality} \xB7 \uD3C9\uADE0 ${metrics.meanErrorPx.toFixed(1)} px (${(metrics.meanErrorViewportWidthRatio * 100).toFixed(2)}% W) \xB7 P95 ${metrics.p95ErrorPx.toFixed(1)} px \xB7 \uC815\uBC00\uB3C4 ${metrics.meanPrecisionPx.toFixed(1)} px \xB7 \uC720\uD6A8 ${(metrics.validSampleRatio * 100).toFixed(0)}%`
      );
    }
    showError(message) {
      this.setTargetVisible(false);
      this.setStatus(message);
      this.setProgress(
        "\uCE98\uB9AC\uBE0C\uB808\uC774\uC158 \uC911\uB2E8"
      );
    }
    hide() {
      if (this.host !== null) {
        this.host.remove();
        this.host = null;
      }
      this.statusElement = null;
      this.progressElement = null;
      this.targetElement = null;
    }
    ensureMounted() {
      if (this.host !== null) {
        return;
      }
      document.getElementById(
        "etc-calibration-overlay-host"
      )?.remove();
      const host = document.createElement("div");
      host.id = "etc-calibration-overlay-host";
      const shadow = host.attachShadow({
        mode: "closed"
      });
      shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .etc-calibration-layer {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          overflow: hidden;
          box-sizing: border-box;
          background: rgba(15, 17, 21, 0.992);
          color: #f7f8fa;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
          user-select: none;
          cursor: default;
        }

        .etc-calibration-header {
          position: absolute;
          top: 18px;
          left: 50%;
          width: min(620px, calc(100vw - 40px));
          transform: translateX(-50%);
          box-sizing: border-box;
          padding: 12px 16px;
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 14px;
          background: rgba(25, 28, 34, .90);
          text-align: center;
          box-shadow: 0 10px 36px rgba(0,0,0,.22);
        }

        .etc-calibration-status {
          font-size: 14px;
          line-height: 1.45;
          font-weight: 650;
          letter-spacing: -0.01em;
        }

        .etc-calibration-progress {
          margin-top: 5px;
          color: rgba(247,248,250,.60);
          font-size: 11px;
        }

        .etc-calibration-target {
          position: absolute;
          width: 34px;
          height: 34px;
          transform: translate(-50%, -50%);
          border: 3px solid #f6f7f9;
          border-radius: 50%;
          box-sizing: border-box;
          background: rgba(255,255,255,.04);
          box-shadow:
            0 0 0 8px rgba(255,255,255,.07),
            0 8px 30px rgba(0,0,0,.30);
        }

        .etc-calibration-target::before,
        .etc-calibration-target::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          background: #f6f7f9;
        }

        .etc-calibration-target::before {
          width: 4px;
          height: 4px;
          border-radius: 50%;
        }

        .etc-calibration-target::after {
          width: 14px;
          height: 1px;
          opacity: .65;
        }
      </style>

      <div class="etc-calibration-layer" data-role="layer">
        <div class="etc-calibration-header">
          <div class="etc-calibration-status" data-role="status"></div>
          <div class="etc-calibration-progress" data-role="progress"></div>
        </div>
        <div class="etc-calibration-target" data-role="target"></div>
      </div>
    `;
      this.statusElement = shadow.querySelector(
        '[data-role="status"]'
      );
      this.progressElement = shadow.querySelector(
        '[data-role="progress"]'
      );
      this.targetElement = shadow.querySelector(
        '[data-role="target"]'
      );
      const layer = shadow.querySelector(
        '[data-role="layer"]'
      );
      layer?.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
        },
        {
          passive: false
        }
      );
      layer?.addEventListener(
        "touchmove",
        (event) => {
          event.preventDefault();
        },
        {
          passive: false
        }
      );
      document.documentElement.append(
        host
      );
      this.host = host;
    }
    setStatus(text) {
      if (this.statusElement !== null) {
        this.statusElement.textContent = text;
      }
    }
    setProgress(text) {
      if (this.progressElement !== null) {
        this.progressElement.textContent = text;
      }
    }
    setTargetVisible(visible) {
      if (this.targetElement === null) {
        return;
      }
      this.targetElement.style.display = visible ? "block" : "none";
    }
  };

  // src/content/preCalibrationOverlay.ts
  var INSTRUCTION_TEXT = {
    FIND_FACE: "\uCE74\uBA54\uB77C\uAC00 \uC5BC\uAD74\uC744 \uCC3E\uC744 \uC218 \uC788\uB3C4\uB85D \uD654\uBA74 \uC911\uC559\uC744 \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694.",
    SHOW_BOTH_EYES: "\uC591\uCABD \uB208\uC774 \uBAA8\uB450 \uBCF4\uC774\uB3C4\uB85D \uC5BC\uAD74\uACFC \uC548\uACBD/\uBA38\uB9AC\uCE74\uB77D \uC704\uCE58\uB97C \uC870\uC815\uD574 \uC8FC\uC138\uC694.",
    MOVE_CLOSER: "\uCE74\uBA54\uB77C\uC5D0 \uC870\uAE08 \uB354 \uAC00\uAE4C\uC774 \uC774\uB3D9\uD574 \uC8FC\uC138\uC694.",
    MOVE_FARTHER: "\uCE74\uBA54\uB77C\uC5D0\uC11C \uC870\uAE08 \uB354 \uBA40\uB9AC \uC774\uB3D9\uD574 \uC8FC\uC138\uC694.",
    MOVE_LEFT: "\uC5BC\uAD74\uC744 \uD654\uBA74 \uAE30\uC900 \uC67C\uCABD\uC73C\uB85C \uC870\uAE08 \uC774\uB3D9\uD574 \uC8FC\uC138\uC694.",
    MOVE_RIGHT: "\uC5BC\uAD74\uC744 \uD654\uBA74 \uAE30\uC900 \uC624\uB978\uCABD\uC73C\uB85C \uC870\uAE08 \uC774\uB3D9\uD574 \uC8FC\uC138\uC694.",
    MOVE_UP: "\uC5BC\uAD74\uC744 \uD654\uBA74 \uAE30\uC900 \uC704\uCABD\uC73C\uB85C \uC870\uAE08 \uC774\uB3D9\uD574 \uC8FC\uC138\uC694.",
    MOVE_DOWN: "\uC5BC\uAD74\uC744 \uD654\uBA74 \uAE30\uC900 \uC544\uB798\uCABD\uC73C\uB85C \uC870\uAE08 \uC774\uB3D9\uD574 \uC8FC\uC138\uC694.",
    FACE_FORWARD: "\uACE0\uAC1C\uB97C \uAE30\uC6B8\uC774\uC9C0 \uB9D0\uACE0 \uCE74\uBA54\uB77C \uC815\uBA74\uC744 \uBC14\uB77C\uBD10 \uC8FC\uC138\uC694.",
    IMPROVE_LIGHTING: "\uC5BC\uAD74\uC774 \uC870\uAE08 \uC5B4\uB461\uC2B5\uB2C8\uB2E4. \uC8FC\uBCC0 \uC870\uBA85\uC744 \uBC1D\uAC8C \uD574 \uC8FC\uC138\uC694.",
    REDUCE_LIGHTING: "\uC5BC\uAD74\uC774 \uB108\uBB34 \uBC1D\uC2B5\uB2C8\uB2E4. \uAC15\uD55C \uC5ED\uAD11\uC774\uB098 \uC9C1\uC811 \uC870\uBA85\uC744 \uC904\uC5EC \uC8FC\uC138\uC694.",
    HOLD_STEADY: "\uC88B\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uC790\uC138\uB97C \uC7A0\uC2DC \uC720\uC9C0\uD574 \uC8FC\uC138\uC694.",
    READY: "\uC5BC\uAD74 \uC704\uCE58 \uD655\uC778\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC744 \uC2DC\uC791\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
  };
  function clamp(value, minimum, maximum) {
    return Math.min(
      maximum,
      Math.max(
        minimum,
        value
      )
    );
  }
  function toPercent(value) {
    return `${clamp(value, 0, 1) * 100}%`;
  }
  function formatDegrees(value) {
    if (value === null) {
      return "--";
    }
    return `${value.toFixed(1)}\xB0`;
  }
  function formatBrightness(value) {
    if (value === null) {
      return "--";
    }
    return `${Math.round(value * 100)}%`;
  }
  var PreCalibrationOverlay = class {
    host = null;
    instructionElement = null;
    faceBoxElement = null;
    progressFillElement = null;
    progressTextElement = null;
    faceStatusElement = null;
    eyesStatusElement = null;
    distanceStatusElement = null;
    poseStatusElement = null;
    lightingStatusElement = null;
    poseMetricsElement = null;
    brightnessMetricsElement = null;
    render(feedback) {
      this.ensureMounted();
      if (this.host === null || this.instructionElement === null || this.faceBoxElement === null || this.progressFillElement === null || this.progressTextElement === null || this.faceStatusElement === null || this.eyesStatusElement === null || this.distanceStatusElement === null || this.poseStatusElement === null || this.lightingStatusElement === null || this.poseMetricsElement === null || this.brightnessMetricsElement === null) {
        return;
      }
      this.host.dataset.ready = feedback.readyForCalibration ? "true" : "false";
      this.instructionElement.textContent = INSTRUCTION_TEXT[feedback.instruction];
      this.renderFaceBox(feedback);
      const progress = clamp(
        feedback.metrics.stableProgress,
        0,
        1
      );
      this.progressFillElement.style.width = `${progress * 100}%`;
      this.progressTextElement.textContent = feedback.readyForCalibration ? "\uC644\uB8CC" : `${Math.round(progress * 100)}%`;
      this.setCheckStatus(
        this.faceStatusElement,
        feedback.status.faceDetected,
        "\uC5BC\uAD74",
        "\uAC10\uC9C0\uB428",
        "\uAC10\uC9C0\uB418\uC9C0 \uC54A\uC74C"
      );
      this.setCheckStatus(
        this.eyesStatusElement,
        feedback.status.bothEyesVisible,
        "\uC591\uCABD \uB208",
        "\uD655\uC778\uB428",
        "\uD655\uC778 \uD544\uC694"
      );
      this.setCheckStatus(
        this.distanceStatusElement,
        feedback.status.distanceAcceptable,
        "\uAC70\uB9AC",
        "\uC801\uC815",
        "\uC870\uC815 \uD544\uC694"
      );
      this.setCheckStatus(
        this.poseStatusElement,
        feedback.status.headPoseAcceptable,
        "\uBA38\uB9AC \uC790\uC138",
        "\uC801\uC815",
        "\uC815\uBA74 \uD544\uC694"
      );
      this.setCheckStatus(
        this.lightingStatusElement,
        feedback.status.brightnessAcceptable,
        "\uC870\uBA85",
        "\uC801\uC815",
        "\uC870\uC815 \uD544\uC694"
      );
      this.poseMetricsElement.textContent = `Yaw ${formatDegrees(feedback.metrics.yawDeg)} \xB7 Pitch ${formatDegrees(feedback.metrics.pitchDeg)} \xB7 Roll ${formatDegrees(feedback.metrics.rollDeg)}`;
      this.brightnessMetricsElement.textContent = `\uBC1D\uAE30 ${formatBrightness(feedback.metrics.brightness)}`;
    }
    hide() {
      if (this.host !== null) {
        this.host.style.display = "none";
      }
    }
    ensureMounted() {
      if (this.host !== null) {
        this.host.style.display = "block";
        return;
      }
      document.getElementById(
        "etc-precalibration-overlay-host"
      )?.remove();
      const host = document.createElement("div");
      host.id = "etc-precalibration-overlay-host";
      const shadow = host.attachShadow({
        mode: "closed"
      });
      shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .etc-layer {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f7f8fa;
        }

        .etc-panel {
          position: absolute;
          top: 18px;
          left: 50%;
          width: min(420px, calc(100vw - 32px));
          transform: translateX(-50%);
          box-sizing: border-box;
          padding: 16px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 16px;
          background: rgba(18, 20, 25, 0.94);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
          backdrop-filter: blur(14px);
        }

        .etc-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .etc-title {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }

        .etc-privacy {
          color: rgba(247, 248, 250, 0.58);
          font-size: 10px;
          white-space: nowrap;
        }

        .etc-map {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          overflow: hidden;
          box-sizing: border-box;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          background:
            linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px),
            #111318;
          background-size: 25% 25%;
        }

        .etc-guide {
          position: absolute;
          left: 31%;
          top: 10%;
          width: 38%;
          height: 80%;
          box-sizing: border-box;
          border: 2px dashed rgba(255, 255, 255, 0.45);
          border-radius: 48% 48% 44% 44%;
        }

        .etc-crosshair-x,
        .etc-crosshair-y {
          position: absolute;
          background: rgba(255, 255, 255, 0.10);
        }

        .etc-crosshair-x {
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
        }

        .etc-crosshair-y {
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
        }

        .etc-face-box {
          position: absolute;
          display: none;
          box-sizing: border-box;
          min-width: 6px;
          min-height: 6px;
          border: 2px solid #f0c15b;
          border-radius: 24%;
          background: rgba(240, 193, 91, 0.07);
          transition:
            left 80ms linear,
            top 80ms linear,
            width 80ms linear,
            height 80ms linear,
            border-color 120ms ease;
        }

        [data-ready="true"] .etc-face-box {
          border-color: #63d894;
          background: rgba(99, 216, 148, 0.08);
        }

        .etc-instruction {
          min-height: 42px;
          box-sizing: border-box;
          padding: 11px 2px 8px;
          font-size: 14px;
          line-height: 1.45;
          font-weight: 650;
          text-align: center;
        }

        [data-ready="true"] .etc-instruction {
          color: #78e0a2;
        }

        .etc-progress-row {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 10px;
          margin-bottom: 11px;
        }

        .etc-progress-track {
          height: 6px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.10);
        }

        .etc-progress-fill {
          width: 0;
          height: 100%;
          border-radius: inherit;
          background: #d8dde7;
          transition: width 120ms linear;
        }

        [data-ready="true"] .etc-progress-fill {
          background: #63d894;
        }

        .etc-progress-text {
          min-width: 36px;
          color: rgba(247, 248, 250, 0.7);
          font-size: 11px;
          text-align: right;
        }

        .etc-checks {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 5px;
        }

        .etc-check {
          min-width: 0;
          padding: 7px 5px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.055);
          color: rgba(247, 248, 250, 0.62);
          font-size: 9px;
          line-height: 1.25;
          text-align: center;
        }

        .etc-check[data-ok="true"] {
          color: #8de8b1;
          background: rgba(99, 216, 148, 0.10);
        }

        .etc-check strong {
          display: block;
          margin-bottom: 2px;
          color: rgba(247, 248, 250, 0.94);
          font-size: 10px;
          font-weight: 650;
        }

        .etc-metrics {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 9px;
          color: rgba(247, 248, 250, 0.50);
          font-size: 9px;
          line-height: 1.35;
        }
      </style>

      <div class="etc-layer">
        <section class="etc-panel" role="status" aria-live="polite">
          <div class="etc-title-row">
            <h2 class="etc-title">\uCE98\uB9AC\uBE0C\uB808\uC774\uC158 \uC900\uBE44 \xB7 \uC5BC\uAD74 \uC704\uCE58</h2>
            <span class="etc-privacy">\uC601\uC0C1 \uC800\uC7A5 \uC548 \uD568</span>
          </div>

          <div class="etc-map" aria-hidden="true">
            <div class="etc-crosshair-x"></div>
            <div class="etc-crosshair-y"></div>
            <div class="etc-guide"></div>
            <div class="etc-face-box"></div>
          </div>

          <div class="etc-instruction"></div>

          <div class="etc-progress-row">
            <div class="etc-progress-track">
              <div class="etc-progress-fill"></div>
            </div>
            <span class="etc-progress-text">0%</span>
          </div>

          <div class="etc-checks">
            <span class="etc-check etc-face-status"></span>
            <span class="etc-check etc-eyes-status"></span>
            <span class="etc-check etc-distance-status"></span>
            <span class="etc-check etc-pose-status"></span>
            <span class="etc-check etc-lighting-status"></span>
          </div>

          <div class="etc-metrics">
            <div class="etc-pose-metrics"></div>
            <div class="etc-brightness-metrics"></div>
          </div>
        </section>
      </div>
    `;
      this.host = host;
      this.instructionElement = shadow.querySelector(
        ".etc-instruction"
      );
      this.faceBoxElement = shadow.querySelector(
        ".etc-face-box"
      );
      this.progressFillElement = shadow.querySelector(
        ".etc-progress-fill"
      );
      this.progressTextElement = shadow.querySelector(
        ".etc-progress-text"
      );
      this.faceStatusElement = shadow.querySelector(
        ".etc-face-status"
      );
      this.eyesStatusElement = shadow.querySelector(
        ".etc-eyes-status"
      );
      this.distanceStatusElement = shadow.querySelector(
        ".etc-distance-status"
      );
      this.poseStatusElement = shadow.querySelector(
        ".etc-pose-status"
      );
      this.lightingStatusElement = shadow.querySelector(
        ".etc-lighting-status"
      );
      this.poseMetricsElement = shadow.querySelector(
        ".etc-pose-metrics"
      );
      this.brightnessMetricsElement = shadow.querySelector(
        ".etc-brightness-metrics"
      );
      const root = document.documentElement;
      root.appendChild(host);
    }
    renderFaceBox(feedback) {
      const element = this.faceBoxElement;
      if (element === null) {
        return;
      }
      const box = feedback.cameraFaceBoxNormalized;
      if (box === null) {
        element.style.display = "none";
        return;
      }
      const mirroredLeft = 1 - (box.left + box.width);
      element.style.display = "block";
      element.style.left = toPercent(mirroredLeft);
      element.style.top = toPercent(box.top);
      element.style.width = toPercent(box.width);
      element.style.height = toPercent(box.height);
    }
    setCheckStatus(element, ok, label, okText, badText) {
      element.dataset.ok = ok ? "true" : "false";
      element.innerHTML = `<strong>${label}</strong>${ok ? okText : badText}`;
    }
  };

  // src/content/gazeOverlay.ts
  var GAZE_OVERLAY_HOST_ID = "etc-gaze-overlay";
  var GazeOverlay = class {
    enabled = GAZE_OVERLAY.DEFAULT_ENABLED;
    temporarilySuppressed = false;
    host = null;
    marker = null;
    currentViewportPoint = null;
    staleHideTimerId = null;
    disposed = false;
    constructor() {
      chrome.storage.onChanged.addListener(
        this.handleStorageChanged
      );
      void this.loadPreference();
    }
    setTemporarilySuppressed(suppressed) {
      this.temporarilySuppressed = suppressed;
      if (suppressed) {
        this.hide();
      }
    }
    updateNormalizedPoint(point) {
      if (this.disposed || !this.enabled || this.temporarilySuppressed) {
        return;
      }
      if (point === null || !isFiniteNumber(point.x) || !isFiniteNumber(point.y) || window.innerWidth <= 0 || window.innerHeight <= 0) {
        this.scheduleStaleHide();
        return;
      }
      const targetPoint = {
        x: point.x * window.innerWidth,
        y: point.y * window.innerHeight
      };
      const previousPoint = this.currentViewportPoint;
      const nextPoint = previousPoint === null ? targetPoint : {
        x: previousPoint.x + (targetPoint.x - previousPoint.x) * GAZE_OVERLAY.SMOOTHING_ALPHA,
        y: previousPoint.y + (targetPoint.y - previousPoint.y) * GAZE_OVERLAY.SMOOTHING_ALPHA
      };
      this.currentViewportPoint = nextPoint;
      const marker = this.ensureMounted();
      if (marker === null) {
        this.scheduleStaleHide();
        return;
      }
      const radius = GAZE_OVERLAY.DIAMETER_PX / 2;
      marker.style.transform = `translate3d(${nextPoint.x - radius}px, ${nextPoint.y - radius}px, 0)`;
      marker.style.opacity = "1";
      this.scheduleStaleHide();
    }
    hide() {
      this.clearStaleHideTimer();
      this.currentViewportPoint = null;
      if (this.marker !== null) {
        this.marker.style.opacity = "0";
      }
    }
    dispose() {
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      chrome.storage.onChanged.removeListener(
        this.handleStorageChanged
      );
      this.clearStaleHideTimer();
      this.host?.remove();
      this.host = null;
      this.marker = null;
      this.currentViewportPoint = null;
    }
    handleStorageChanged = (changes, areaName) => {
      if (areaName !== "local" || !(GAZE_OVERLAY.STORAGE_KEY in changes)) {
        return;
      }
      const nextValue = changes[GAZE_OVERLAY.STORAGE_KEY]?.newValue;
      this.setEnabled(
        typeof nextValue === "boolean" ? nextValue : GAZE_OVERLAY.DEFAULT_ENABLED
      );
    };
    async loadPreference() {
      try {
        const stored = await chrome.storage.local.get(
          GAZE_OVERLAY.STORAGE_KEY
        );
        const value = stored[GAZE_OVERLAY.STORAGE_KEY];
        this.setEnabled(
          typeof value === "boolean" ? value : GAZE_OVERLAY.DEFAULT_ENABLED
        );
      } catch {
        this.setEnabled(
          GAZE_OVERLAY.DEFAULT_ENABLED
        );
      }
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) {
        this.hide();
      }
    }
    ensureMounted() {
      if (this.marker !== null) {
        return this.marker;
      }
      const root = document.documentElement;
      if (root === null) {
        return null;
      }
      const host = document.createElement("div");
      host.id = GAZE_OVERLAY_HOST_ID;
      host.setAttribute(
        "aria-hidden",
        "true"
      );
      host.style.position = "fixed";
      host.style.left = "0";
      host.style.top = "0";
      host.style.width = "0";
      host.style.height = "0";
      host.style.pointerEvents = "none";
      host.style.zIndex = String(GAZE_OVERLAY.Z_INDEX);
      const shadowRoot = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
      .gaze-marker {
        position: fixed;
        left: 0;
        top: 0;
        width: ${GAZE_OVERLAY.DIAMETER_PX}px;
        height: ${GAZE_OVERLAY.DIAMETER_PX}px;
        box-sizing: border-box;
        border: 2px solid rgba(20, 126, 255, 0.82);
        border-radius: 50%;
        background: rgba(20, 126, 255, 0.10);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.58),
          0 2px 12px rgba(0, 0, 0, 0.14);
        opacity: 0;
        pointer-events: none;
        will-change: transform, opacity;
        transition: opacity 70ms linear;
      }
    `;
      const marker = document.createElement("div");
      marker.className = "gaze-marker";
      shadowRoot.append(
        style,
        marker
      );
      root.append(host);
      this.host = host;
      this.marker = marker;
      return marker;
    }
    scheduleStaleHide() {
      this.clearStaleHideTimer();
      this.staleHideTimerId = window.setTimeout(
        () => {
          this.staleHideTimerId = null;
          this.currentViewportPoint = null;
          if (this.marker !== null) {
            this.marker.style.opacity = "0";
          }
        },
        GAZE_OVERLAY.STALE_HIDE_DELAY_MS
      );
    }
    clearStaleHideTimer() {
      if (this.staleHideTimerId === null) {
        return;
      }
      window.clearTimeout(
        this.staleHideTimerId
      );
      this.staleHideTimerId = null;
    }
  };

  // src/content/domAoiResolver.ts
  var INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "tab",
    "menuitem",
    "option",
    "switch",
    "textbox",
    "combobox"
  ]);
  var TEXT_TAGS = /* @__PURE__ */ new Set([
    "p",
    "span",
    "label",
    "li",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "em"
  ]);
  var EXTENSION_HOST_IDS = /* @__PURE__ */ new Set([
    "etc-calibration-overlay-host",
    "etc-precalibration-overlay-host",
    "etc-gaze-overlay"
  ]);
  function normalizedAttribute(element, name) {
    const value = element.getAttribute(name)?.trim() ?? "";
    return value.length > 0 ? value : null;
  }
  function isInteractiveElement(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "button" || tag === "a" || tag === "input" || tag === "textarea" || tag === "select" || tag === "summary") {
      return true;
    }
    const role = normalizedAttribute(element, "role")?.toLowerCase() ?? null;
    return role !== null && INTERACTIVE_ROLES.has(role);
  }
  function classifyAoiType(tagName, role, inputType, interactive) {
    const tag = tagName.toLowerCase();
    const normalizedRole = role?.toLowerCase() ?? null;
    const normalizedInputType = inputType?.toLowerCase() ?? null;
    if (tag === "button" || normalizedRole === "button") return "BUTTON";
    if (tag === "a" || normalizedRole === "link") return "LINK";
    if (tag === "textarea") return "TEXTAREA";
    if (tag === "select" || normalizedRole === "combobox") return "SELECT";
    if (tag === "img" || tag === "picture") return "IMAGE";
    if (tag === "video") return "VIDEO";
    if (tag === "canvas") return "CANVAS";
    if (tag === "iframe") return "IFRAME";
    if (normalizedRole === "tab") return "TAB";
    if (normalizedRole === "menuitem") return "MENU_ITEM";
    if (tag === "input") {
      if (normalizedInputType === "checkbox") return "CHECKBOX";
      if (normalizedInputType === "radio") return "RADIO";
      return "INPUT";
    }
    if (normalizedRole === "checkbox") return "CHECKBOX";
    if (normalizedRole === "radio") return "RADIO";
    if (TEXT_TAGS.has(tag)) return "TEXT";
    if (interactive || normalizedRole !== null) return "CUSTOM";
    if (tag === "div" || tag === "section" || tag === "article" || tag === "nav") {
      return "CONTAINER";
    }
    return "UNKNOWN";
  }
  function distancePointToRect(point, rect) {
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const dx = point.x < rect.left ? rect.left - point.x : point.x > right ? point.x - right : 0;
    const dy = point.y < rect.top ? rect.top - point.y : point.y > bottom ? point.y - bottom : 0;
    return Math.hypot(dx, dy);
  }
  function pointInsideRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
  }
  function isExtensionOwnedElement(element) {
    let current = element;
    for (let depth = 0; current !== null && depth <= AOI.MAX_INTERACTIVE_ANCESTOR_DEPTH; depth += 1) {
      const id = current.id;
      if (EXTENSION_HOST_IDS.has(id) || id.startsWith("etc-") || current.hasAttribute("data-eye-tracker-overlay")) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }
  function hasMeaningfulText(element) {
    const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return text.length > 0;
  }
  function isMeaningfulAoiElement(element) {
    if (isExtensionOwnedElement(element)) return false;
    const tag = element.tagName.toLowerCase();
    const role = normalizedAttribute(element, "role");
    if (isInteractiveElement(element)) return true;
    if (tag === "img" || tag === "video" || tag === "canvas" || tag === "iframe") {
      return true;
    }
    if (role !== null) return true;
    if (TEXT_TAGS.has(tag) && hasMeaningfulText(element)) return true;
    return false;
  }
  function resolveSemanticElement(element) {
    let current = element;
    let textFallback = null;
    for (let depth = 0; current !== null && depth <= AOI.MAX_INTERACTIVE_ANCESTOR_DEPTH; depth += 1) {
      if (isExtensionOwnedElement(current)) return null;
      if (isInteractiveElement(current)) return current;
      if (textFallback === null && isMeaningfulAoiElement(current)) {
        textFallback = current;
      }
      current = current.parentElement;
    }
    return textFallback;
  }
  function semanticPriorityForElement(element) {
    if (isInteractiveElement(element)) return 5;
    const tagName = element.tagName.toLowerCase();
    const role = normalizedAttribute(element, "role");
    const inputType = tagName === "input" ? normalizedAttribute(element, "type") : null;
    const aoiType = classifyAoiType(tagName, role, inputType, false);
    switch (aoiType) {
      case "IMAGE":
      case "VIDEO":
      case "CANVAS":
      case "IFRAME":
        return 4;
      case "TEXT":
        return 3;
      case "CUSTOM":
        return 2;
      case "CONTAINER":
        return 1;
      default:
        return 0;
    }
  }
  function elementDomDepth(element) {
    let depth = 0;
    let current = element.parentElement;
    while (current !== null) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }
  function rectFromDomRect(rect) {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }
  function isVisibleElement(element, rect) {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && Number.parseFloat(style.opacity || "1") > 0;
  }
  function escapeAttributeValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
  }
  function nthOfTypeIndex(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling !== null) {
      if (sibling.tagName === element.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }
  function createDomPath(element) {
    const segments = [];
    let current = element;
    while (current !== null) {
      const tag = current.tagName.toLowerCase();
      if (current.id.trim().length > 0) {
        segments.unshift(`${tag}[id="${escapeAttributeValue(current.id)}"]`);
        break;
      }
      segments.unshift(`${tag}:nth-of-type(${nthOfTypeIndex(current)})`);
      if (tag === "html") break;
      current = current.parentElement;
    }
    return segments.join(" > ");
  }
  function extractText(element) {
    const value = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (value.length === 0) return null;
    return value.slice(0, RUNTIME_LIMITS.MAX_AOI_TEXT_LENGTH);
  }
  async function sha256Text(value) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === void 0) return null;
    const bytes = new TextEncoder().encode(value);
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
  }
  function entrySignature(entry) {
    return JSON.stringify({
      tagName: entry.tagName,
      elementId: entry.elementId,
      role: entry.role,
      ariaLabel: entry.ariaLabel,
      elementName: entry.elementName,
      textLabel: entry.textLabel,
      textHash: entry.textHash,
      cssSelector: entry.cssSelector,
      domPath: entry.domPath,
      aoiType: entry.aoiType,
      interactive: entry.interactive,
      viewportRect: entry.viewportRect,
      documentRect: entry.documentRect,
      visible: entry.visible,
      enabled: entry.enabled,
      textStoragePolicy: entry.textStoragePolicy
    });
  }
  var DomAoiResolver = class {
    constructor(pageId, browserFrameId, textStoragePolicy = PRIVACY_DEFAULTS.DEFAULT_TEXT_STORAGE_POLICY) {
      this.pageId = pageId;
      this.browserFrameId = browserFrameId;
      this.textStoragePolicy = textStoragePolicy;
    }
    pageId;
    browserFrameId;
    textStoragePolicy;
    elementIds = /* @__PURE__ */ new WeakMap();
    registered = /* @__PURE__ */ new Map();
    textHashCache = /* @__PURE__ */ new Map();
    nextAoiSequence = 1;
    async resolve(timestampMs, viewportPoint) {
      const removedAoiIds = this.collectDisconnectedAois();
      if (viewportPoint.x < 0 || viewportPoint.y < 0 || viewportPoint.x > window.innerWidth || viewportPoint.y > window.innerHeight) {
        return {
          hit: {
            timestampMs,
            primaryAoiId: null,
            candidates: []
          },
          upserted: [],
          removedAoiIds
        };
      }
      const scored = this.collectScoredElements(viewportPoint);
      const upserted = [];
      const candidates = [];
      const retained = scored.slice(0, AOI.MAX_HIT_CANDIDATES);
      const totalScore = retained.reduce((sum, item) => sum + item.score, 0);
      for (const item of retained) {
        const entry = await this.upsertElement(item.element);
        if (entry.changed) upserted.push(entry.value);
        candidates.push({
          aoiId: entry.value.aoiId,
          probability: totalScore > 0 ? item.score / totalScore : 0,
          distancePx: item.distancePx,
          inside: item.inside
        });
      }
      return {
        hit: {
          timestampMs,
          primaryAoiId: candidates[0]?.aoiId ?? null,
          candidates
        },
        upserted,
        removedAoiIds
      };
    }
    collectScoredElements(viewportPoint) {
      const radius = AOI.DEFAULT_SEARCH_RADIUS_PX;
      const diagonal = radius / Math.SQRT2;
      const offsets = [
        { x: 0, y: 0 },
        { x: radius, y: 0 },
        { x: -radius, y: 0 },
        { x: 0, y: radius },
        { x: 0, y: -radius },
        { x: diagonal, y: diagonal },
        { x: diagonal, y: -diagonal },
        { x: -diagonal, y: diagonal },
        { x: -diagonal, y: -diagonal }
      ];
      const candidateMap = /* @__PURE__ */ new Map();
      for (const offset of offsets) {
        const x = Math.min(Math.max(viewportPoint.x + offset.x, 0), Math.max(window.innerWidth - 1, 0));
        const y = Math.min(Math.max(viewportPoint.y + offset.y, 0), Math.max(window.innerHeight - 1, 0));
        const elements = document.elementsFromPoint(x, y);
        for (const rawElement of elements) {
          const semantic = resolveSemanticElement(rawElement);
          if (semantic === null) continue;
          const existing = candidateMap.get(semantic);
          const centerHit = offset.x === 0 && offset.y === 0;
          if (existing === void 0) {
            candidateMap.set(semantic, { centerHit });
          } else if (centerHit && !existing.centerHit) {
            candidateMap.set(semantic, { centerHit: true });
          }
        }
      }
      const scored = [];
      for (const [element, metadata] of candidateMap) {
        const rect = rectFromDomRect(element.getBoundingClientRect());
        if (!isVisibleElement(element, rect)) continue;
        const distancePx = distancePointToRect(viewportPoint, rect);
        if (distancePx > radius) continue;
        const inside = pointInsideRect(viewportPoint, rect);
        const proximity = inside ? 1 : Math.max(0, 1 - distancePx / radius);
        const semanticPriority = semanticPriorityForElement(element);
        const interactiveBoost = isInteractiveElement(element) ? 1.15 : 1;
        const centerBoost = metadata.centerHit ? 1.2 : 1;
        const score = Math.max(1e-3, proximity * interactiveBoost * centerBoost);
        scored.push({
          element,
          inside,
          distancePx,
          score,
          centerHit: metadata.centerHit,
          semanticPriority,
          domDepth: elementDomDepth(element),
          areaPx2: Math.max(1, rect.width * rect.height)
        });
      }
      scored.sort((a, b) => {
        if (a.inside !== b.inside) return a.inside ? -1 : 1;
        if (a.inside && b.inside) {
          if (a.centerHit !== b.centerHit) return a.centerHit ? -1 : 1;
          if (a.semanticPriority !== b.semanticPriority) {
            return b.semanticPriority - a.semanticPriority;
          }
          if (a.domDepth !== b.domDepth) return b.domDepth - a.domDepth;
          if (a.areaPx2 !== b.areaPx2) return a.areaPx2 - b.areaPx2;
        }
        if (a.score !== b.score) return b.score - a.score;
        if (a.distancePx !== b.distancePx) return a.distancePx - b.distancePx;
        if (a.semanticPriority !== b.semanticPriority) {
          return b.semanticPriority - a.semanticPriority;
        }
        if (a.domDepth !== b.domDepth) return b.domDepth - a.domDepth;
        return a.areaPx2 - b.areaPx2;
      });
      return scored;
    }
    async upsertElement(element) {
      let aoiId = this.elementIds.get(element);
      if (aoiId === void 0) {
        aoiId = `aoi_${this.pageId}_${this.browserFrameId}_${this.nextAoiSequence}`;
        this.nextAoiSequence += 1;
        this.elementIds.set(element, aoiId);
      }
      const previous = this.registered.get(aoiId);
      const createdAtEpochMs = previous?.entry.createdAtEpochMs ?? nowEpochMs();
      const entry = await this.createRegistryEntry(element, aoiId, createdAtEpochMs);
      const signature = entrySignature(entry);
      const changed = previous === void 0 || previous.signature !== signature;
      this.registered.set(aoiId, {
        element,
        entry,
        signature
      });
      return { value: entry, changed };
    }
    async createRegistryEntry(element, aoiId, createdAtEpochMs) {
      const rect = rectFromDomRect(element.getBoundingClientRect());
      const role = normalizedAttribute(element, "role");
      const interactive = isInteractiveElement(element);
      const text = extractText(element);
      let textLabel = null;
      let textHash = null;
      if (text !== null) {
        if (this.textStoragePolicy === "RAW") {
          textLabel = text;
        } else if (this.textStoragePolicy === "HASHED") {
          if (!this.textHashCache.has(text)) {
            this.textHashCache.set(text, await sha256Text(text));
          }
          textHash = this.textHashCache.get(text) ?? null;
        }
      }
      const tagName = element.tagName.toLowerCase();
      const inputType = tagName === "input" ? normalizedAttribute(element, "type") : null;
      const domPath = createDomPath(element);
      return {
        aoiId,
        pageId: this.pageId,
        browserFrameId: this.browserFrameId,
        tagName,
        elementId: element.id.trim().length > 0 ? element.id : null,
        role,
        ariaLabel: normalizedAttribute(element, "aria-label"),
        elementName: normalizedAttribute(element, "name"),
        textLabel,
        textHash,
        cssSelector: domPath,
        domPath,
        aoiType: classifyAoiType(tagName, role, inputType, interactive),
        interactive,
        viewportRect: rect,
        documentRect: {
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height
        },
        visible: isVisibleElement(element, rect),
        enabled: !element.hasAttribute("disabled") && normalizedAttribute(element, "aria-disabled") !== "true",
        textStoragePolicy: this.textStoragePolicy,
        createdAtEpochMs,
        updatedAtEpochMs: nowEpochMs()
      };
    }
    collectDisconnectedAois() {
      const removed = [];
      for (const [aoiId, registered] of this.registered) {
        if (registered.element.isConnected) continue;
        this.registered.delete(aoiId);
        removed.push(aoiId);
      }
      return removed;
    }
  };

  // src/content/pageCoordinateTracker.ts
  function finiteOrZero(value) {
    return Number.isFinite(value) ? value : 0;
  }
  function getDocumentSize() {
    const documentElement = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(
        documentElement?.scrollWidth ?? 0,
        documentElement?.clientWidth ?? 0,
        body?.scrollWidth ?? 0,
        body?.clientWidth ?? 0,
        window.innerWidth
      ),
      height: Math.max(
        documentElement?.scrollHeight ?? 0,
        documentElement?.clientHeight ?? 0,
        body?.scrollHeight ?? 0,
        body?.clientHeight ?? 0,
        window.innerHeight
      )
    };
  }
  function remapNormalizedPointToViewport(normalizedPoint, viewportWidth, viewportHeight) {
    return {
      x: normalizedPoint.x * viewportWidth,
      y: normalizedPoint.y * viewportHeight
    };
  }
  function classifyScrollDirection(deltaX, deltaY) {
    if (deltaX === 0 && deltaY === 0) {
      return "NONE";
    }
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      return deltaY > 0 ? "DOWN" : "UP";
    }
    return deltaX > 0 ? "RIGHT" : "LEFT";
  }
  function capturePageCoordinateSnapshot(viewportPoint) {
    const scrollX = finiteOrZero(window.scrollX);
    const scrollY = finiteOrZero(window.scrollY);
    const viewportWidth = Math.max(
      0,
      finiteOrZero(window.innerWidth)
    );
    const viewportHeight = Math.max(
      0,
      finiteOrZero(window.innerHeight)
    );
    const documentSize = getDocumentSize();
    return {
      capturedAtEpochMs: nowEpochMs(),
      url: window.location.href,
      origin: window.location.origin,
      viewportPoint: {
        x: viewportPoint.x,
        y: viewportPoint.y
      },
      documentPoint: {
        x: viewportPoint.x + scrollX,
        y: viewportPoint.y + scrollY
      },
      insideViewport: viewportPoint.x >= 0 && viewportPoint.y >= 0 && viewportPoint.x <= viewportWidth && viewportPoint.y <= viewportHeight,
      viewportWidth,
      viewportHeight,
      documentWidth: documentSize.width,
      documentHeight: documentSize.height,
      scrollX,
      scrollY,
      devicePixelRatio: Math.max(
        0,
        finiteOrZero(window.devicePixelRatio)
      )
    };
  }
  var PageCoordinateTracker = class {
    constructor(onScrollRecord) {
      this.onScrollRecord = onScrollRecord;
      window.addEventListener(
        "scroll",
        this.handleNativeScroll,
        { passive: true }
      );
    }
    onScrollRecord;
    context = null;
    lastScrollX = 0;
    lastScrollY = 0;
    lastEventAtMs = null;
    scrolling = false;
    scrollFrameId = null;
    scrollEndTimerId = null;
    disposed = false;
    activate(context) {
      if (this.disposed) {
        return;
      }
      const changed = this.context === null || this.context.sessionId !== context.sessionId || this.context.pageId !== context.pageId || this.context.tabId !== context.tabId || this.context.browserFrameId !== context.browserFrameId;
      this.context = {
        ...context
      };
      if (!changed) {
        return;
      }
      this.cancelPendingScrollWork();
      this.lastScrollX = finiteOrZero(window.scrollX);
      this.lastScrollY = finiteOrZero(window.scrollY);
      this.lastEventAtMs = null;
      this.scrolling = false;
    }
    capture(viewportPoint) {
      return capturePageCoordinateSnapshot(
        viewportPoint
      );
    }
    /** Clears the active experiment attribution while keeping listeners reusable. */
    deactivate() {
      if (this.disposed) {
        return;
      }
      this.cancelPendingScrollWork();
      this.context = null;
      this.lastEventAtMs = null;
      this.scrolling = false;
    }
    dispose() {
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      this.cancelPendingScrollWork();
      window.removeEventListener(
        "scroll",
        this.handleNativeScroll
      );
      this.context = null;
    }
    handleNativeScroll = () => {
      if (this.disposed || this.context === null || this.scrollFrameId !== null) {
        return;
      }
      this.scrollFrameId = window.requestAnimationFrame(
        () => {
          this.scrollFrameId = null;
          this.flushScrollFrame();
        }
      );
    };
    flushScrollFrame() {
      const context = this.context;
      if (this.disposed || context === null) {
        return;
      }
      const now = nowTimelineMs();
      const scrollX = finiteOrZero(window.scrollX);
      const scrollY = finiteOrZero(window.scrollY);
      const deltaX = scrollX - this.lastScrollX;
      const deltaY = scrollY - this.lastScrollY;
      if (deltaX === 0 && deltaY === 0) {
        this.scheduleScrollEnd();
        return;
      }
      const elapsedMs = this.lastEventAtMs === null ? 0 : Math.max(
        0,
        now - this.lastEventAtMs
      );
      const phase = this.scrolling ? "MOVE" : "START";
      const distance = Math.hypot(
        deltaX,
        deltaY
      );
      const velocityPxPerMs = elapsedMs > 0 ? distance / elapsedMs : 0;
      this.onScrollRecord({
        timestampMs: now,
        sessionId: context.sessionId,
        pageId: context.pageId,
        scrollX,
        scrollY,
        deltaX,
        deltaY,
        velocityPxPerMs,
        direction: classifyScrollDirection(
          deltaX,
          deltaY
        ),
        phase,
        tabId: context.tabId,
        browserFrameId: context.browserFrameId
      });
      this.scrolling = true;
      this.lastScrollX = scrollX;
      this.lastScrollY = scrollY;
      this.lastEventAtMs = now;
      this.scheduleScrollEnd();
    }
    scheduleScrollEnd() {
      if (this.scrollEndTimerId !== null) {
        window.clearTimeout(
          this.scrollEndTimerId
        );
      }
      this.scrollEndTimerId = window.setTimeout(
        () => {
          this.scrollEndTimerId = null;
          this.emitScrollEnd();
        },
        PAGE_TRACKING.SCROLL_END_IDLE_MS
      );
    }
    emitScrollEnd() {
      const context = this.context;
      if (!this.scrolling || context === null) {
        return;
      }
      const now = nowTimelineMs();
      const scrollX = finiteOrZero(window.scrollX);
      const scrollY = finiteOrZero(window.scrollY);
      this.onScrollRecord({
        timestampMs: now,
        sessionId: context.sessionId,
        pageId: context.pageId,
        scrollX,
        scrollY,
        deltaX: 0,
        deltaY: 0,
        velocityPxPerMs: 0,
        direction: "NONE",
        phase: "END",
        tabId: context.tabId,
        browserFrameId: context.browserFrameId
      });
      this.lastScrollX = scrollX;
      this.lastScrollY = scrollY;
      this.lastEventAtMs = now;
      this.scrolling = false;
    }
    cancelPendingScrollWork() {
      if (this.scrollFrameId !== null) {
        window.cancelAnimationFrame(
          this.scrollFrameId
        );
        this.scrollFrameId = null;
      }
      if (this.scrollEndTimerId !== null) {
        window.clearTimeout(
          this.scrollEndTimerId
        );
        this.scrollEndTimerId = null;
      }
    }
  };

  // src/content/contentScript.ts
  var FACE_POSITION_INSTRUCTION_VALUES = /* @__PURE__ */ new Set([
    "FIND_FACE",
    "SHOW_BOTH_EYES",
    "MOVE_CLOSER",
    "MOVE_FARTHER",
    "MOVE_LEFT",
    "MOVE_RIGHT",
    "MOVE_UP",
    "MOVE_DOWN",
    "FACE_FORWARD",
    "IMPROVE_LIGHTING",
    "REDUCE_LIGHTING",
    "HOLD_STEADY",
    "READY"
  ]);
  function isNullableMetric(value) {
    return value === null || isFiniteNumber(value);
  }
  function isPreCalibrationFeedback(value) {
    if (!isRecord(value) || !isRecord(value.status) || typeof value.instruction !== "string" || !FACE_POSITION_INSTRUCTION_VALUES.has(value.instruction) || typeof value.readyForCalibration !== "boolean" || !isRecord(value.metrics)) {
      return false;
    }
    const status = value.status;
    const validStatus = typeof status.faceDetected === "boolean" && typeof status.bothEyesVisible === "boolean" && typeof status.horizontallyCentered === "boolean" && typeof status.verticallyCentered === "boolean" && typeof status.distanceAcceptable === "boolean" && typeof status.headPoseAcceptable === "boolean" && typeof status.brightnessAcceptable === "boolean" && typeof status.stable === "boolean";
    if (!validStatus) {
      return false;
    }
    if (value.cameraFaceBoxNormalized !== null) {
      if (!isRecord(
        value.cameraFaceBoxNormalized
      ) || !isFiniteNumber(
        value.cameraFaceBoxNormalized.left
      ) || !isFiniteNumber(
        value.cameraFaceBoxNormalized.top
      ) || !isFiniteNumber(
        value.cameraFaceBoxNormalized.width
      ) || !isFiniteNumber(
        value.cameraFaceBoxNormalized.height
      )) {
        return false;
      }
    }
    const metrics = value.metrics;
    return isNullableMetric(metrics.centerX) && isNullableMetric(metrics.centerY) && isNullableMetric(metrics.widthRatio) && isNullableMetric(metrics.heightRatio) && isNullableMetric(metrics.proximityProxy) && isNullableMetric(metrics.yawDeg) && isNullableMetric(metrics.pitchDeg) && isNullableMetric(metrics.rollDeg) && isNullableMetric(metrics.brightness) && isFiniteNumber(
      metrics.stableDurationMs
    ) && isFiniteNumber(
      metrics.stableProgress
    );
  }
  function isCalibrationMode(value) {
    return value === "STANDARD_17" || value === "PRECISION_25";
  }
  function isNullablePoint2D(value) {
    return value === null || isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
  }
  function isCompletedFixationSnapshotPayload(value) {
    if (value === null) {
      return true;
    }
    if (!isRecord(value) || !isRecord(value.event) || !isFiniteNumber(value.peakSpeedPxPerSecond)) {
      return false;
    }
    const event = value.event;
    return typeof event.fixationId === "string" && typeof event.sessionId === "string" && typeof event.pageId === "string" && isFiniteNumber(event.startTimeMs) && isFiniteNumber(event.endTimeMs) && isFiniteNumber(event.durationMs) && isRecord(event.centroidViewportPoint) && isFiniteNumber(event.centroidViewportPoint.x) && isFiniteNumber(event.centroidViewportPoint.y) && isFiniteNumber(event.dispersionX) && isFiniteNumber(event.dispersionY) && isFiniteNumber(event.dispersionPx) && Number.isInteger(event.sampleCount) && isFiniteNumber(event.qualityMean);
  }
  function isAoiProbePayload(value) {
    return isRecord(value) && isFiniteNumber(value.timestampMs) && isRecord(value.normalizedPoint) && isFiniteNumber(value.normalizedPoint.x) && isFiniteNumber(value.normalizedPoint.y) && isRecord(value.viewportPoint) && isFiniteNumber(value.viewportPoint.x) && isFiniteNumber(value.viewportPoint.y) && (value.pointSource === "STABILIZED_GAZE" || value.pointSource === "FIXATION_CENTROID") && isFiniteNumber(value.gazeQuality) && value.gazeQuality >= 0 && value.gazeQuality <= 1 && (value.fixationId === null || typeof value.fixationId === "string") && typeof value.degradedCollection === "boolean" && isNullablePoint2D(value.rawPredictionNormalizedPoint) && isNullablePoint2D(value.authoritativeNormalizedPoint) && isNullablePoint2D(value.stabilizedNormalizedPoint) && isCompletedFixationSnapshotPayload(value.completedFixation);
  }
  function isCalibrationTarget(value) {
    if (!isRecord(value) || !Number.isInteger(value.pointIndex) || !isRecord(value.normalizedPoint) || !isRecord(value.viewportPoint)) {
      return false;
    }
    return isFiniteNumber(value.normalizedPoint.x) && isFiniteNumber(value.normalizedPoint.y) && isFiniteNumber(value.viewportPoint.x) && isFiniteNumber(value.viewportPoint.y);
  }
  function isStartCalibrationPayload(value) {
    return isRecord(value) && typeof value.calibrationId === "string" && value.calibrationId.length > 0 && isCalibrationMode(
      value.mode
    );
  }
  function isCalibrationTrainingDiagnostics(value) {
    if (!isRecord(value)) {
      return false;
    }
    return isFiniteNumber(value.pointCount) && Number.isInteger(value.pointCount) && value.pointCount > 0 && isFiniteNumber(value.rawMeanErrorPx) && value.rawMeanErrorPx >= 0 && isFiniteNumber(value.rawP95ErrorPx) && value.rawP95ErrorPx >= 0 && isFiniteNumber(value.rawRmsePx) && value.rawRmsePx >= 0 && isFiniteNumber(value.correctedMeanErrorPx) && value.correctedMeanErrorPx >= 0 && isFiniteNumber(value.correctedP95ErrorPx) && value.correctedP95ErrorPx >= 0 && isFiniteNumber(value.correctedRmsePx) && value.correctedRmsePx >= 0 && isFiniteNumber(value.meanCorrectionImprovementPx) && isFiniteNumber(value.improvedPointCount) && Number.isInteger(value.improvedPointCount) && value.improvedPointCount >= 0 && isFiniteNumber(value.degradedPointCount) && Number.isInteger(value.degradedPointCount) && value.degradedPointCount >= 0 && isFiniteNumber(value.unchangedPointCount) && Number.isInteger(value.unchangedPointCount) && value.unchangedPointCount >= 0;
  }
  function isCalibrationPointResultPayload(value) {
    if (!isRecord(value)) {
      return false;
    }
    const failureReason = value.failureReason;
    return typeof value.calibrationId === "string" && isFiniteNumber(
      value.pointIndex
    ) && Number.isInteger(
      value.pointIndex
    ) && typeof value.sufficient === "boolean" && isFiniteNumber(
      value.acceptedSampleCount
    ) && isFiniteNumber(
      value.rejectedSampleCount
    ) && isFiniteNumber(
      value.rejectionRatio
    ) && isFiniteNumber(
      value.completedPointCount
    ) && isFiniteNumber(
      value.expectedPointCount
    ) && (failureReason === null || failureReason === "INSUFFICIENT_SAMPLES" || failureReason === "UNSTABLE_GAZE" || failureReason === "OUTLIER_REJECTION") && typeof value.modelReady === "boolean" && (value.trainingRmseNormalized === null || isFiniteNumber(
      value.trainingRmseNormalized
    )) && (value.trainingDiagnostics === null || isCalibrationTrainingDiagnostics(
      value.trainingDiagnostics
    )) && Array.isArray(value.adaptiveExpansionTargets) && value.adaptiveExpansionTargets.every(
      (target) => isCalibrationTarget(target)
    );
  }
  function isStartValidationPayload(value) {
    return isRecord(value) && typeof value.calibrationId === "string" && value.calibrationId.length > 0 && isFiniteNumber(
      value.viewportWidth
    ) && value.viewportWidth > 0 && isFiniteNumber(
      value.viewportHeight
    ) && value.viewportHeight > 0 && isFiniteNumber(
      value.expectedPointCount
    ) && Number.isInteger(
      value.expectedPointCount
    );
  }
  function isValidationMetrics(value) {
    if (!isRecord(value)) {
      return false;
    }
    return [
      value.viewportWidthPx,
      value.viewportHeightPx,
      value.meanErrorViewportWidthRatio,
      value.p95ErrorViewportWidthRatio,
      value.meanPrecisionPx,
      value.p95PrecisionPx,
      value.meanPrecisionViewportWidthRatio,
      value.p95PrecisionViewportWidthRatio,
      value.validSampleRatio,
      value.meanErrorPx,
      value.medianErrorPx,
      value.rmsePx,
      value.p90ErrorPx,
      value.p95ErrorPx,
      value.maxErrorPx,
      value.horizontalErrorPx,
      value.verticalErrorPx,
      value.centerErrorPx,
      value.edgeErrorPx,
      value.cornerErrorPx
    ].every(
      (metric) => isFiniteNumber(metric) && metric >= 0
    ) && isFiniteNumber(
      value.viewportWidthPx
    ) && value.viewportWidthPx > 0 && isFiniteNumber(
      value.viewportHeightPx
    ) && value.viewportHeightPx > 0 && isFiniteNumber(
      value.validSampleRatio
    ) && value.validSampleRatio <= 1;
  }
  function isFinitePoint2D(value) {
    return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
  }
  function isCalibrationPointDiagnostic(value) {
    if (!isRecord(value)) {
      return false;
    }
    return typeof value.calibrationId === "string" && value.calibrationId.length > 0 && isFiniteNumber(value.pointIndex) && Number.isInteger(value.pointIndex) && isFinitePoint2D(
      value.targetViewportPoint
    ) && isFinitePoint2D(
      value.rawMeanPoint
    ) && value.rawMeanSpace === "NORMALIZED" && isFinitePoint2D(
      value.correctedViewportPoint
    ) && isFiniteNumber(value.errorXPx) && isFiniteNumber(value.errorYPx) && isFiniteNumber(value.errorPx) && value.errorPx >= 0 && isFiniteNumber(value.sampleCount) && Number.isInteger(value.sampleCount) && value.sampleCount >= 0 && isFiniteNumber(value.rejectedCount) && Number.isInteger(value.rejectedCount) && value.rejectedCount >= 0 && isRecord(value.meanHeadPose) && isFiniteNumber(
      value.meanHeadPose.yawDeg
    ) && isFiniteNumber(
      value.meanHeadPose.pitchDeg
    ) && isFiniteNumber(
      value.meanHeadPose.rollDeg
    ) && isFiniteNumber(
      value.meanFaceDistanceRatio
    ) && isFiniteNumber(value.meanQuality) && value.meanQuality >= 0 && value.meanQuality <= 1;
  }
  function isCalibrationCorrectionStrategy(value) {
    return value === "PROJECT_RESIDUAL_ONLY" || value === "WEBEYETRACK_NATIVE_ONLY";
  }
  function isValidationPointResultPayload(value) {
    if (!isRecord(value)) {
      return false;
    }
    const failureReason = value.failureReason;
    const qualityValid = value.quality === null || value.quality === "GOOD" || value.quality === "ACCEPTABLE" || value.quality === "POOR" || value.quality === "FAIL";
    const metricsValid = value.metrics === null || isValidationMetrics(
      value.metrics
    );
    const selectedStrategyValidation = value.selectedStrategyValidation;
    const selectedStrategyValidationValid = selectedStrategyValidation === null || isRecord(selectedStrategyValidation) && (selectedStrategyValidation.strategy === "BASELINE_ONLY" || selectedStrategyValidation.strategy === "DEEP_ONLY" || selectedStrategyValidation.strategy === "SAFE_ADAPTIVE_HYBRID") && isValidationMetrics(
      selectedStrategyValidation.metrics
    ) && (selectedStrategyValidation.quality === "GOOD" || selectedStrategyValidation.quality === "ACCEPTABLE" || selectedStrategyValidation.quality === "POOR" || selectedStrategyValidation.quality === "FAIL");
    const pointResultsValid = value.pointResults === null || Array.isArray(value.pointResults) && value.pointResults.every(
      isCalibrationPointDiagnostic
    );
    return typeof value.calibrationId === "string" && isCalibrationCorrectionStrategy(
      value.correctionStrategy
    ) && isFiniteNumber(
      value.pointIndex
    ) && Number.isInteger(
      value.pointIndex
    ) && typeof value.sufficient === "boolean" && isFiniteNumber(
      value.acceptedSampleCount
    ) && isFiniteNumber(
      value.rejectedSampleCount
    ) && isFiniteNumber(
      value.rejectionRatio
    ) && isFiniteNumber(
      value.completedPointCount
    ) && isFiniteNumber(
      value.expectedPointCount
    ) && (failureReason === null || failureReason === "INSUFFICIENT_SAMPLES" || failureReason === "UNSTABLE_GAZE" || failureReason === "OUTLIER_REJECTION") && typeof value.validationComplete === "boolean" && qualityValid && metricsValid && selectedStrategyValidationValid && pointResultsValid && (value.validationComplete ? value.metrics !== null && value.quality !== null && value.pointResults !== null : value.metrics === null && value.quality === null && value.selectedStrategyValidation === null && value.pointResults === null);
  }
  var latestResearchViewportContext = null;
  var lastViewportSyncSignature = null;
  function clearResearchViewportSync() {
    latestResearchViewportContext = null;
    lastViewportSyncSignature = null;
  }
  function reportViewportContextIfChanged(context) {
    latestResearchViewportContext = { ...context };
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const devicePixelRatio = window.devicePixelRatio;
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
      return;
    }
    const signature = [
      context.sessionId,
      context.pageId,
      context.tabId,
      context.browserFrameId,
      viewportWidth,
      viewportHeight,
      devicePixelRatio
    ].join("::");
    if (signature === lastViewportSyncSignature) {
      return;
    }
    lastViewportSyncSignature = signature;
    const message = createRuntimeMessage(
      MESSAGE_TYPES.VIEWPORT_CONTEXT_CHANGED,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: context.browserFrameId
      },
      {
        viewportWidth,
        viewportHeight,
        devicePixelRatio
      }
    );
    void chrome.runtime.sendMessage(message).catch(() => {
    });
  }
  function reportLatestViewportContext() {
    if (latestResearchViewportContext === null) {
      return;
    }
    reportViewportContextIfChanged(
      latestResearchViewportContext
    );
  }
  async function handleAoiProbe(resolver, coordinateTracker, meta, payload) {
    coordinateTracker.activate(meta);
    reportViewportContextIfChanged(meta);
    const currentViewportPoint = remapNormalizedPointToViewport(
      payload.normalizedPoint,
      window.innerWidth,
      window.innerHeight
    );
    const coordinates = coordinateTracker.capture(
      currentViewportPoint
    );
    const stabilizedGazeViewportPoint = payload.stabilizedNormalizedPoint === null ? null : remapNormalizedPointToViewport(
      payload.stabilizedNormalizedPoint,
      window.innerWidth,
      window.innerHeight
    );
    const gazeCoordinates = stabilizedGazeViewportPoint === null ? null : coordinateTracker.capture(
      stabilizedGazeViewportPoint
    );
    const resolution = await resolver.resolve(
      payload.timestampMs,
      currentViewportPoint
    );
    if (resolution.upserted.length > 0 || resolution.removedAoiIds.length > 0) {
      const registryMessage = createRuntimeMessage(
        MESSAGE_TYPES.AOI_REGISTRY_UPDATE,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: meta.sessionId,
          pageId: meta.pageId,
          tabId: meta.tabId,
          browserFrameId: meta.browserFrameId
        },
        {
          pageId: meta.pageId,
          browserFrameId: meta.browserFrameId,
          upserted: resolution.upserted,
          removedAoiIds: resolution.removedAoiIds,
          fullSnapshot: false
        }
      );
      await chrome.runtime.sendMessage(registryMessage);
    }
    const hitMessage = createRuntimeMessage(
      MESSAGE_TYPES.AOI_HIT,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: meta.sessionId,
        pageId: meta.pageId,
        tabId: meta.tabId,
        browserFrameId: meta.browserFrameId
      },
      {
        pageId: meta.pageId,
        browserFrameId: meta.browserFrameId,
        fixationId: payload.fixationId,
        pointSource: payload.pointSource,
        gazeQuality: payload.gazeQuality,
        degradedCollection: payload.degradedCollection,
        probeNormalizedPoint: {
          ...payload.normalizedPoint
        },
        rawPredictionNormalizedPoint: payload.rawPredictionNormalizedPoint === null ? null : { ...payload.rawPredictionNormalizedPoint },
        authoritativeNormalizedPoint: payload.authoritativeNormalizedPoint === null ? null : { ...payload.authoritativeNormalizedPoint },
        stabilizedNormalizedPoint: payload.stabilizedNormalizedPoint === null ? null : { ...payload.stabilizedNormalizedPoint },
        completedFixation: payload.completedFixation === null ? null : {
          event: {
            ...payload.completedFixation.event,
            centroidViewportPoint: {
              ...currentViewportPoint
            }
          },
          peakSpeedPxPerSecond: payload.completedFixation.peakSpeedPxPerSecond
        },
        coordinates,
        gazeCoordinates,
        hit: resolution.hit
      }
    );
    await chrome.runtime.sendMessage(hitMessage);
  }
  function waitForNextPaint() {
    return new Promise(
      (resolve) => {
        window.requestAnimationFrame(
          () => {
            resolve();
          }
        );
      }
    );
  }
  async function sendCalibrationPoint(context, calibrationId, target, targetShownAtMs, attempt) {
    const message = createRuntimeMessage(
      MESSAGE_TYPES.CALIBRATION_POINT,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: 0
      },
      {
        calibrationId,
        target,
        targetShownAtMs,
        attempt
      }
    );
    const rawResult = await chrome.runtime.sendMessage(message);
    if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response)) {
      const messageText = isRecord(rawResult) && isRecord(rawResult.error) && typeof rawResult.error.message === "string" ? rawResult.error.message : "Calibration point request failed.";
      throw new Error(messageText);
    }
    const response = rawResult.response;
    if (!isCompatibleMessageProtocol(
      response.protocolVersion
    ) || response.type !== MESSAGE_TYPES.CALIBRATION_POINT_RESULT || !isRecord(response.meta) || response.meta.source !== "BACKGROUND" || response.meta.target !== "CONTENT" || !isCalibrationPointResultPayload(
      response.payload
    )) {
      throw new Error(
        "Calibration point response was invalid."
      );
    }
    return {
      ...response.payload
    };
  }
  async function startValidation(context, calibrationId, viewportWidth, viewportHeight, expectedPointCount) {
    const payload = {
      calibrationId,
      viewportWidth,
      viewportHeight,
      expectedPointCount
    };
    const message = createRuntimeMessage(
      MESSAGE_TYPES.START_VALIDATION,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: 0
      },
      payload
    );
    const rawResult = await chrome.runtime.sendMessage(message);
    if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response)) {
      const messageText = isRecord(rawResult) && isRecord(rawResult.error) && typeof rawResult.error.message === "string" ? rawResult.error.message : "Validation startup failed.";
      throw new Error(messageText);
    }
    const response = rawResult.response;
    if (!isCompatibleMessageProtocol(
      response.protocolVersion
    ) || response.type !== MESSAGE_TYPES.START_VALIDATION || !isRecord(response.meta) || response.meta.source !== "BACKGROUND" || response.meta.target !== "CONTENT" || !isStartValidationPayload(
      response.payload
    )) {
      throw new Error(
        "Validation startup response was invalid."
      );
    }
    return {
      ...response.payload
    };
  }
  async function sendValidationPoint(context, calibrationId, target, targetShownAtMs, attempt) {
    const message = createRuntimeMessage(
      MESSAGE_TYPES.VALIDATION_POINT,
      {
        messageId: createMessageId(),
        sentAtEpochMs: nowEpochMs(),
        source: "CONTENT",
        target: "BACKGROUND",
        sessionId: context.sessionId,
        pageId: context.pageId,
        tabId: context.tabId,
        browserFrameId: 0
      },
      {
        calibrationId,
        target,
        targetShownAtMs,
        attempt
      }
    );
    const rawResult = await chrome.runtime.sendMessage(message);
    if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response)) {
      const messageText = isRecord(rawResult) && isRecord(rawResult.error) && typeof rawResult.error.message === "string" ? rawResult.error.message : "Validation point request failed.";
      throw new Error(messageText);
    }
    const response = rawResult.response;
    if (!isCompatibleMessageProtocol(
      response.protocolVersion
    ) || response.type !== MESSAGE_TYPES.VALIDATION_POINT_RESULT || !isRecord(response.meta) || response.meta.source !== "BACKGROUND" || response.meta.target !== "CONTENT" || !isValidationPointResultPayload(
      response.payload
    )) {
      throw new Error(
        "Validation point response was invalid."
      );
    }
    return {
      ...response.payload,
      metrics: response.payload.metrics === null ? null : {
        ...response.payload.metrics
      }
    };
  }
  if (window.top === window) {
    let processAoiProbeRequest2 = function(request) {
      if (aoiProbeInFlight) {
        if (request.payload.completedFixation !== null) {
          pendingFixationCompletionProbes.push(request);
        }
        return;
      }
      if (aoiResolver === null || aoiResolverPageId !== request.context.pageId || aoiResolverFrameId !== request.context.browserFrameId) {
        aoiResolver = new DomAoiResolver(
          request.context.pageId,
          request.context.browserFrameId
        );
        aoiResolverPageId = request.context.pageId;
        aoiResolverFrameId = request.context.browserFrameId;
      }
      const resolver = aoiResolver;
      const generation = aoiProbeGeneration;
      aoiProbeInFlight = true;
      void handleAoiProbe(
        resolver,
        pageCoordinateTracker,
        request.context,
        request.payload
      ).catch(() => {
      }).finally(() => {
        if (generation !== aoiProbeGeneration) {
          return;
        }
        aoiProbeInFlight = false;
        const nextCompletion = pendingFixationCompletionProbes.shift();
        if (nextCompletion !== void 0) {
          processAoiProbeRequest2(nextCompletion);
        }
      });
    };
    processAoiProbeRequest = processAoiProbeRequest2;
    const preCalibrationOverlay = new PreCalibrationOverlay();
    const calibrationOverlay = new CalibrationOverlay();
    const gazeOverlay = new GazeOverlay();
    let activePreCalibrationSessionId = null;
    let preCalibrationCompleted = false;
    let completionHideTimerId = null;
    let calibrationGeneration = 0;
    let activeCalibrationId = null;
    let quickRecalibrationInFlight = false;
    let quickRecalibrationFailureCount = 0;
    const quickRecalibrationStartedAtMs = [];
    let automaticQuickRecalibrationEnabled = QUICK_RECALIBRATION.DEFAULT_ENABLED;
    const handleQuickRecalibrationPreferenceChanged = (changes, areaName) => {
      if (areaName !== "local" || !(QUICK_RECALIBRATION.STORAGE_KEY in changes)) {
        return;
      }
      const value = changes[QUICK_RECALIBRATION.STORAGE_KEY]?.newValue;
      automaticQuickRecalibrationEnabled = typeof value === "boolean" ? value : QUICK_RECALIBRATION.DEFAULT_ENABLED;
    };
    chrome.storage.onChanged.addListener(
      handleQuickRecalibrationPreferenceChanged
    );
    void chrome.storage.local.get(
      QUICK_RECALIBRATION.STORAGE_KEY
    ).then((stored) => {
      const value = stored[QUICK_RECALIBRATION.STORAGE_KEY];
      automaticQuickRecalibrationEnabled = typeof value === "boolean" ? value : QUICK_RECALIBRATION.DEFAULT_ENABLED;
    }).catch(() => {
      automaticQuickRecalibrationEnabled = QUICK_RECALIBRATION.DEFAULT_ENABLED;
    });
    window.addEventListener(
      "pagehide",
      () => {
        chrome.storage.onChanged.removeListener(
          handleQuickRecalibrationPreferenceChanged
        );
      },
      { once: true }
    );
    let aoiResolver = null;
    let aoiResolverPageId = null;
    let aoiResolverFrameId = null;
    let aoiProbeInFlight = false;
    let aoiProbeGeneration = 0;
    const pendingFixationCompletionProbes = [];
    const pageCoordinateTracker = new PageCoordinateTracker(
      (event) => {
        const message = createRuntimeMessage(
          MESSAGE_TYPES.SCROLL_EVENT,
          {
            messageId: createMessageId(),
            sentAtEpochMs: nowEpochMs(),
            source: "CONTENT",
            target: "BACKGROUND",
            sessionId: event.sessionId,
            pageId: event.pageId,
            tabId: event.tabId,
            browserFrameId: event.browserFrameId
          },
          {
            event
          }
        );
        void chrome.runtime.sendMessage(message).catch(() => {
        });
      }
    );
    window.addEventListener(
      "resize",
      reportLatestViewportContext,
      { passive: true }
    );
    window.visualViewport?.addEventListener(
      "resize",
      reportLatestViewportContext,
      { passive: true }
    );
    async function startQuickRecalibration(context, calibrationId, viewportWidth, viewportHeight) {
      const payload = {
        calibrationId,
        viewportWidth,
        viewportHeight,
        pointCount: DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
      };
      const message = createRuntimeMessage(
        MESSAGE_TYPES.START_QUICK_RECALIBRATION,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: context.sessionId,
          pageId: context.pageId,
          tabId: context.tabId,
          browserFrameId: 0
        },
        payload
      );
      const rawResult = await chrome.runtime.sendMessage(message);
      if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response)) {
        throw new Error("Quick recalibration startup failed.");
      }
      const response = rawResult.response;
      if (!isCompatibleMessageProtocol(response.protocolVersion) || response.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_STARTED || !isRecord(response.payload) || response.payload.calibrationId !== calibrationId || !isFiniteNumber(response.payload.startingPointIndex) || !Number.isInteger(response.payload.startingPointIndex) || !isFiniteNumber(response.payload.expectedPointCount) || !Number.isInteger(response.payload.expectedPointCount) || response.payload.pointCount !== DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT || typeof response.payload.runId !== "string" || response.payload.runId.length === 0) {
        throw new Error("Quick recalibration startup response was invalid.");
      }
      return {
        calibrationId,
        startingPointIndex: response.payload.startingPointIndex,
        expectedPointCount: response.payload.expectedPointCount,
        pointCount: response.payload.pointCount,
        runId: response.payload.runId
      };
    }
    async function sendQuickRecalibrationPoint(context, runId, calibrationId, target, targetShownAtMs, attempt) {
      const message = createRuntimeMessage(
        MESSAGE_TYPES.QUICK_RECALIBRATION_POINT,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: context.sessionId,
          pageId: context.pageId,
          tabId: context.tabId,
          browserFrameId: 0
        },
        { calibrationId, runId, target, targetShownAtMs, attempt }
      );
      const rawResult = await chrome.runtime.sendMessage(message);
      if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response)) {
        throw new Error("Quick recalibration point request failed.");
      }
      const response = rawResult.response;
      if (!isCompatibleMessageProtocol(response.protocolVersion) || response.type !== MESSAGE_TYPES.QUICK_RECALIBRATION_POINT_RESULT || !isCalibrationPointResultPayload(response.payload)) {
        throw new Error("Quick recalibration point response was invalid.");
      }
      return { ...response.payload };
    }
    async function startQuickValidation(context, runId, calibrationId, viewportWidth, viewportHeight) {
      const payload = {
        calibrationId,
        runId,
        viewportWidth,
        viewportHeight,
        expectedPointCount: DRIFT_THRESHOLDS.QUICK_REVALIDATION_POINT_COUNT
      };
      const message = createRuntimeMessage(
        MESSAGE_TYPES.START_QUICK_VALIDATION,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: context.sessionId,
          pageId: context.pageId,
          tabId: context.tabId,
          browserFrameId: 0
        },
        payload
      );
      const rawResult = await chrome.runtime.sendMessage(message);
      if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response) || rawResult.response.type !== MESSAGE_TYPES.START_QUICK_VALIDATION) {
        throw new Error("Quick validation startup failed.");
      }
    }
    async function sendQuickValidationPoint(context, runId, calibrationId, target, targetShownAtMs, attempt) {
      const message = createRuntimeMessage(
        MESSAGE_TYPES.QUICK_VALIDATION_POINT,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: context.sessionId,
          pageId: context.pageId,
          tabId: context.tabId,
          browserFrameId: 0
        },
        { calibrationId, runId, target, targetShownAtMs, attempt }
      );
      const rawResult = await chrome.runtime.sendMessage(message);
      if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true || !isRecord(rawResult.response)) {
        throw new Error("Quick validation point request failed.");
      }
      const response = rawResult.response;
      if (!isCompatibleMessageProtocol(response.protocolVersion) || response.type !== MESSAGE_TYPES.QUICK_VALIDATION_POINT_RESULT || !isValidationPointResultPayload(response.payload)) {
        throw new Error("Quick validation point response was invalid.");
      }
      return {
        ...response.payload,
        metrics: response.payload.metrics === null ? null : { ...response.payload.metrics }
      };
    }
    async function requestFullRecalibration(context, reason) {
      calibrationGeneration += 1;
      activeCalibrationId = null;
      quickRecalibrationInFlight = false;
      quickRecalibrationFailureCount = 0;
      quickRecalibrationStartedAtMs.length = 0;
      calibrationOverlay.showError(
        `\uBE60\uB978 \uC7AC\uBCF4\uC815\uC73C\uB85C \uC815\uD655\uB3C4\uB97C \uD68C\uBCF5\uD558\uC9C0 \uBABB\uD574 \uC804\uCCB4 \uBCF4\uC815\uC744 \uB2E4\uC2DC \uC2DC\uC791\uD569\uB2C8\uB2E4. (${reason})`
      );
      await sleep(900);
      const message = createRuntimeMessage(
        MESSAGE_TYPES.START_FACE_POSITIONING,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: context.sessionId,
          pageId: context.pageId,
          tabId: context.tabId,
          browserFrameId: 0
        },
        {}
      );
      const rawResult = await chrome.runtime.sendMessage(message);
      if (!isRecord(rawResult) || rawResult.ok !== true || rawResult.handled !== true) {
        throw new Error("Full recalibration escalation could not restart face positioning.");
      }
    }
    async function abortQuickRecalibration(context, calibrationId, runId) {
      const message = createRuntimeMessage(
        MESSAGE_TYPES.ABORT_QUICK_RECALIBRATION,
        {
          messageId: createMessageId(),
          sentAtEpochMs: nowEpochMs(),
          source: "CONTENT",
          target: "BACKGROUND",
          sessionId: context.sessionId,
          pageId: context.pageId,
          tabId: context.tabId,
          browserFrameId: 0
        },
        { calibrationId, runId }
      );
      const result = await chrome.runtime.sendMessage(message);
      if (!isRecord(result) || result.ok !== true || result.handled !== true) {
        throw new Error("Quick rollback request could not be delivered.");
      }
    }
    async function runQuickRecalibration(calibrationId, context, generation) {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      calibrationOverlay.showQuickRecalibrationPreparing(
        DRIFT_THRESHOLDS.QUICK_RECALIBRATION_POINT_COUNT
      );
      const started = await startQuickRecalibration(
        context,
        calibrationId,
        viewport.width,
        viewport.height
      );
      const targets = createQuickRecalibrationPattern(
        viewport,
        started.startingPointIndex
      );
      try {
        await sleep(CALIBRATION.UI_START_DELAY_MS);
        let lastResult = null;
        for (let localIndex = 0; localIndex < targets.length; localIndex += 1) {
          const target = targets[localIndex];
          if (target === void 0) continue;
          if (generation !== calibrationGeneration || activeCalibrationId !== calibrationId) {
            throw new Error("Quick recalibration was cancelled by a newer context.");
          }
          let completed = false;
          for (let attempt = 1; attempt <= CALIBRATION.MAX_POINT_ATTEMPTS; attempt += 1) {
            calibrationOverlay.showQuickRecalibrationTarget(
              target,
              localIndex,
              targets.length,
              attempt
            );
            await waitForNextPaint();
            const result = await sendQuickRecalibrationPoint(
              context,
              started.runId,
              calibrationId,
              target,
              nowTimelineMs(),
              attempt
            );
            lastResult = result;
            if (result.sufficient) {
              completed = true;
              break;
            }
            if (attempt < CALIBRATION.MAX_POINT_ATTEMPTS) {
              calibrationOverlay.showRetrying();
              await sleep(CALIBRATION.POINT_RETRY_PAUSE_MS);
            }
          }
          if (!completed) {
            throw new Error(`Quick recalibration point ${localIndex + 1} failed.`);
          }
        }
        if (generation !== calibrationGeneration || activeCalibrationId !== calibrationId) {
          throw new Error("Quick recalibration context changed before validation.");
        }
        if (lastResult === null || !lastResult.modelReady) {
          throw new Error("Quick recalibration finished without a refitted model.");
        }
        const validationTargets = createQuickValidationPattern(viewport);
        calibrationOverlay.showQuickValidationPreparing(validationTargets.length);
        await startQuickValidation(
          context,
          started.runId,
          calibrationId,
          viewport.width,
          viewport.height
        );
        await sleep(300);
        let finalValidation = null;
        for (const target of validationTargets) {
          let completed = false;
          for (let attempt = 1; attempt <= CALIBRATION.MAX_POINT_ATTEMPTS; attempt += 1) {
            calibrationOverlay.showQuickValidationTarget(
              target,
              target.pointIndex,
              validationTargets.length,
              attempt
            );
            await waitForNextPaint();
            const result = await sendQuickValidationPoint(
              context,
              started.runId,
              calibrationId,
              target,
              nowTimelineMs(),
              attempt
            );
            finalValidation = result;
            if (result.sufficient) {
              completed = true;
              break;
            }
            if (attempt < CALIBRATION.MAX_POINT_ATTEMPTS) {
              calibrationOverlay.showRetrying();
              await sleep(CALIBRATION.POINT_RETRY_PAUSE_MS);
            }
          }
          if (!completed) throw new Error("Quick validation could not collect enough valid gaze samples.");
        }
        if (finalValidation === null || !finalValidation.validationComplete || finalValidation.metrics === null || finalValidation.quality === null) {
          throw new Error("Quick validation finished without a final quality result.");
        }
        const readinessQuality = finalValidation.selectedStrategyValidation?.quality ?? finalValidation.quality;
        const readinessMetrics = finalValidation.selectedStrategyValidation?.metrics ?? finalValidation.metrics;
        calibrationOverlay.showQuickValidationCompleted(readinessQuality, readinessMetrics);
        const quickValidationPassed = readinessQuality === "GOOD" || readinessQuality === "ACCEPTABLE";
        await sleep(
          quickValidationPassed ? 1200 : CALIBRATION.DEGRADED_COLLECTION_WARNING_MS
        );
        if (!quickValidationPassed) {
          throw new Error(`Quick re-validation quality remained ${readinessQuality}.`);
        }
        quickRecalibrationFailureCount = 0;
        if (generation === calibrationGeneration && activeCalibrationId === calibrationId) {
          calibrationOverlay.hide();
        }
      } catch (error) {
        try {
          await abortQuickRecalibration(context, calibrationId, started.runId);
        } catch (rollbackError) {
          throw new Error(`Quick recalibration failed and rollback was not confirmed: ${rollbackError instanceof Error ? rollbackError.message : "unknown error"}. Original recalibration failure: ${error instanceof Error ? error.message : String(error)}`, { cause: rollbackError });
        }
        throw error;
      }
    }
    async function runValidation(calibrationId, context, generation) {
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
      const targets = createCalibrationValidationPattern(
        viewport
      );
      calibrationOverlay.showValidationPreparing(
        targets.length
      );
      await startValidation(
        context,
        calibrationId,
        viewport.width,
        viewport.height,
        targets.length
      );
      await sleep(
        CALIBRATION.UI_START_DELAY_MS
      );
      let finalResult = null;
      for (const target of targets) {
        if (generation !== calibrationGeneration || activeCalibrationId !== calibrationId) {
          return;
        }
        let pointCompleted = false;
        for (let attempt = 1; attempt <= CALIBRATION.MAX_POINT_ATTEMPTS; attempt += 1) {
          calibrationOverlay.showValidationTarget(
            target,
            target.pointIndex,
            targets.length,
            attempt
          );
          await waitForNextPaint();
          const targetShownAtMs = nowTimelineMs();
          const result = await sendValidationPoint(
            context,
            calibrationId,
            target,
            targetShownAtMs,
            attempt
          );
          finalResult = result;
          if (result.sufficient) {
            pointCompleted = true;
            break;
          }
          if (attempt < CALIBRATION.MAX_POINT_ATTEMPTS) {
            calibrationOverlay.showRetrying();
            await sleep(
              CALIBRATION.POINT_RETRY_PAUSE_MS
            );
          }
        }
        if (!pointCompleted) {
          throw new Error(
            `Validation point ${target.pointIndex + 1} could not collect enough valid gaze samples.`
          );
        }
      }
      if (finalResult === null || !finalResult.validationComplete || finalResult.metrics === null || finalResult.quality === null) {
        throw new Error(
          "Validation targets finished but no final validation result was produced."
        );
      }
      const readinessResult = finalResult.selectedStrategyValidation;
      const readinessQuality = readinessResult?.quality ?? finalResult.quality;
      const readinessMetrics = readinessResult?.metrics ?? finalResult.metrics;
      calibrationOverlay.showValidationCompleted(
        readinessQuality,
        readinessMetrics
      );
      const passed = readinessResult !== null && (readinessQuality === "GOOD" || readinessQuality === "ACCEPTABLE");
      const degradedCollectionAllowed = readinessResult !== null && readinessQuality === "POOR";
      if (passed || degradedCollectionAllowed) {
        await sleep(
          passed ? 1400 : CALIBRATION.DEGRADED_COLLECTION_WARNING_MS
        );
        if (generation === calibrationGeneration && activeCalibrationId === calibrationId) {
          calibrationOverlay.hide();
        }
      }
    }
    async function runCalibration(payload, context, generation) {
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
      const targets = [
        ...createCalibrationPattern(
          payload.mode,
          viewport
        )
      ];
      await sleep(
        CALIBRATION.UI_START_DELAY_MS
      );
      let lastResult = null;
      for (const target of targets) {
        if (generation !== calibrationGeneration || activeCalibrationId !== payload.calibrationId) {
          return;
        }
        let pointCompleted = false;
        for (let attempt = 1; attempt <= CALIBRATION.MAX_POINT_ATTEMPTS; attempt += 1) {
          calibrationOverlay.showTarget(
            target,
            target.pointIndex,
            targets.length,
            attempt
          );
          await waitForNextPaint();
          const targetShownAtMs = nowTimelineMs();
          const result = await sendCalibrationPoint(
            context,
            payload.calibrationId,
            target,
            targetShownAtMs,
            attempt
          );
          lastResult = result;
          if (result.sufficient) {
            pointCompleted = true;
            if (result.adaptiveExpansionTargets.length > 0) {
              targets.push(
                ...result.adaptiveExpansionTargets
              );
              calibrationOverlay.showAdaptiveExpansion(
                result.completedPointCount,
                result.expectedPointCount,
                result.adaptiveExpansionTargets.length
              );
              await sleep(700);
            }
            break;
          }
          if (attempt < CALIBRATION.MAX_POINT_ATTEMPTS) {
            calibrationOverlay.showRetrying();
            await sleep(
              CALIBRATION.POINT_RETRY_PAUSE_MS
            );
          }
        }
        if (!pointCompleted) {
          const reason = lastResult?.failureReason ?? "INSUFFICIENT_SAMPLES";
          const reasonText = reason === "UNSTABLE_GAZE" ? "gaze/head position was not stable enough" : reason === "OUTLIER_REJECTION" ? "too many samples were removed as outliers" : "not enough valid gaze samples were collected";
          throw new Error(
            `Calibration point ${target.pointIndex + 1} failed: ${reasonText}. Accepted ${lastResult?.acceptedSampleCount ?? 0}, rejected ${lastResult?.rejectedSampleCount ?? 0}.`
          );
        }
      }
      if (lastResult === null || !lastResult.modelReady) {
        throw new Error(
          "Calibration targets finished but the residual model was not fitted."
        );
      }
      calibrationOverlay.showCompleted(
        targets.length,
        lastResult.trainingRmseNormalized
      );
      await sleep(700);
      if (generation === calibrationGeneration && activeCalibrationId === payload.calibrationId) {
        await runValidation(
          payload.calibrationId,
          context,
          generation
        );
      }
    }
    chrome.runtime.onMessage.addListener(
      (rawMessage, _sender, sendResponse) => {
        if (!isRecord(rawMessage)) {
          return false;
        }
        if (!isCompatibleMessageProtocol(
          rawMessage.protocolVersion
        ) || !isRecord(rawMessage.meta) || rawMessage.meta.target !== "CONTENT" || rawMessage.meta.source !== "BACKGROUND") {
          return false;
        }
        if (rawMessage.type === MESSAGE_TYPES.PING && isRecord(rawMessage.payload) && typeof rawMessage.payload.nonce === "string") {
          sendResponse(
            createRuntimeMessage(
              MESSAGE_TYPES.PONG,
              {
                messageId: createMessageId(),
                sentAtEpochMs: nowEpochMs(),
                source: "CONTENT",
                target: "BACKGROUND",
                sessionId: typeof rawMessage.meta.sessionId === "string" ? rawMessage.meta.sessionId : null,
                pageId: typeof rawMessage.meta.pageId === "string" ? rawMessage.meta.pageId : null,
                tabId: isFiniteNumber(rawMessage.meta.tabId) ? rawMessage.meta.tabId : null,
                browserFrameId: 0
              },
              { nonce: rawMessage.payload.nonce }
            )
          );
          return false;
        }
        if (rawMessage.type === MESSAGE_TYPES.RESET_TRACKER) {
          calibrationGeneration += 1;
          activeCalibrationId = null;
          quickRecalibrationInFlight = false;
          quickRecalibrationFailureCount = 0;
          quickRecalibrationStartedAtMs.length = 0;
          activePreCalibrationSessionId = null;
          preCalibrationCompleted = false;
          if (completionHideTimerId !== null) {
            window.clearTimeout(completionHideTimerId);
            completionHideTimerId = null;
          }
          preCalibrationOverlay.hide();
          calibrationOverlay.hide();
          gazeOverlay.setTemporarilySuppressed(false);
          gazeOverlay.hide();
          aoiProbeGeneration += 1;
          aoiResolver = null;
          aoiResolverPageId = null;
          aoiResolverFrameId = null;
          aoiProbeInFlight = false;
          pendingFixationCompletionProbes.length = 0;
          pageCoordinateTracker.deactivate();
          clearResearchViewportSync();
          return false;
        }
        if (rawMessage.type === MESSAGE_TYPES.AOI_PROBE) {
          if (quickRecalibrationInFlight) {
            return false;
          }
          if (rawMessage.meta.source !== "BACKGROUND" || typeof rawMessage.meta.sessionId !== "string" || typeof rawMessage.meta.pageId !== "string" || !isFiniteNumber(rawMessage.meta.tabId) || !isFiniteNumber(rawMessage.meta.browserFrameId) || !isAoiProbePayload(rawMessage.payload)) {
            return false;
          }
          gazeOverlay.updateNormalizedPoint(
            rawMessage.payload.stabilizedNormalizedPoint
          );
          processAoiProbeRequest2({
            context: {
              sessionId: rawMessage.meta.sessionId,
              pageId: rawMessage.meta.pageId,
              tabId: rawMessage.meta.tabId,
              browserFrameId: rawMessage.meta.browserFrameId
            },
            payload: rawMessage.payload
          });
          return false;
        }
        if (rawMessage.type === MESSAGE_TYPES.DRIFT_STATUS) {
          if (!automaticQuickRecalibrationEnabled || quickRecalibrationInFlight || activeCalibrationId === null || !isRecord(rawMessage.payload) || !isRecord(rawMessage.payload.status) || rawMessage.payload.status.quickRecalibrationRecommended !== true || typeof rawMessage.meta.sessionId !== "string" || !isFiniteNumber(rawMessage.meta.tabId)) {
            return false;
          }
          const nowMs = nowTimelineMs();
          while (quickRecalibrationStartedAtMs.length > 0 && nowMs - (quickRecalibrationStartedAtMs[0] ?? nowMs) > RUNTIME_MAINTENANCE.QUICK_REPEAT_WINDOW_MS) {
            quickRecalibrationStartedAtMs.shift();
          }
          const calibrationId = activeCalibrationId;
          const context = {
            sessionId: rawMessage.meta.sessionId,
            pageId: typeof rawMessage.meta.pageId === "string" ? rawMessage.meta.pageId : null,
            tabId: rawMessage.meta.tabId
          };
          if (quickRecalibrationFailureCount >= RUNTIME_MAINTENANCE.QUICK_FAILURE_LIMIT_BEFORE_FULL_CALIBRATION || quickRecalibrationStartedAtMs.length >= RUNTIME_MAINTENANCE.QUICK_REPEAT_LIMIT_BEFORE_FULL_CALIBRATION) {
            void requestFullRecalibration(context, "persistent drift").catch(() => {
              calibrationOverlay.showError("\uC804\uCCB4 \uC7AC\uBCF4\uC815\uC744 \uC790\uB3D9\uC73C\uB85C \uC2DC\uC791\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. Tracker\uB97C \uB2E4\uC2DC \uCD08\uAE30\uD654\uD574\uC8FC\uC138\uC694.");
            });
            return false;
          }
          quickRecalibrationStartedAtMs.push(nowMs);
          quickRecalibrationInFlight = true;
          gazeOverlay.setTemporarilySuppressed(true);
          gazeOverlay.hide();
          calibrationGeneration += 1;
          const generation = calibrationGeneration;
          void runQuickRecalibration(calibrationId, context, generation).catch((error) => {
            if (generation !== calibrationGeneration) return;
            quickRecalibrationFailureCount += 1;
            if (quickRecalibrationFailureCount >= RUNTIME_MAINTENANCE.QUICK_FAILURE_LIMIT_BEFORE_FULL_CALIBRATION) {
              void requestFullRecalibration(context, "quick recalibration failure").catch(() => {
                calibrationOverlay.showError("\uC804\uCCB4 \uC7AC\uBCF4\uC815\uC744 \uC790\uB3D9\uC73C\uB85C \uC2DC\uC791\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. Tracker\uB97C \uB2E4\uC2DC \uCD08\uAE30\uD654\uD574\uC8FC\uC138\uC694.");
              });
              return;
            }
            calibrationOverlay.showError(
              error instanceof Error ? `\uBE60\uB978 \uC7AC\uBCF4\uC815 \uC2E4\uD328: ${error.message}` : "\uBE60\uB978 \uC7AC\uBCF4\uC815\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."
            );
            window.setTimeout(() => calibrationOverlay.hide(), 2500);
          }).finally(() => {
            if (generation === calibrationGeneration) {
              quickRecalibrationInFlight = false;
              gazeOverlay.setTemporarilySuppressed(false);
            }
          });
          return false;
        }
        if (rawMessage.type === MESSAGE_TYPES.FACE_POSITION_STATUS) {
          if (!isRecord(rawMessage.payload) || !isPreCalibrationFeedback(
            rawMessage.payload.feedback
          )) {
            return false;
          }
          const sessionId = typeof rawMessage.meta.sessionId === "string" ? rawMessage.meta.sessionId : null;
          if (sessionId !== activePreCalibrationSessionId) {
            activePreCalibrationSessionId = sessionId;
            preCalibrationCompleted = false;
            if (completionHideTimerId !== null) {
              window.clearTimeout(
                completionHideTimerId
              );
              completionHideTimerId = null;
            }
          }
          const feedback = rawMessage.payload.feedback;
          if (feedback.readyForCalibration) {
            preCalibrationCompleted = true;
            if (completionHideTimerId !== null) {
              window.clearTimeout(
                completionHideTimerId
              );
              completionHideTimerId = null;
            }
            preCalibrationOverlay.hide();
            return false;
          }
          if (preCalibrationCompleted) {
            preCalibrationCompleted = false;
          }
          preCalibrationOverlay.render(
            feedback
          );
          return false;
        }
        if (rawMessage.type === MESSAGE_TYPES.START_CALIBRATION) {
          if (!isStartCalibrationPayload(
            rawMessage.payload
          ) || typeof rawMessage.meta.sessionId !== "string" || !isFiniteNumber(
            rawMessage.meta.tabId
          )) {
            return false;
          }
          const confirmedCalibrationPayload = rawMessage.payload;
          const confirmedSessionId = rawMessage.meta.sessionId;
          const confirmedTabId = rawMessage.meta.tabId;
          const confirmedPageId = typeof rawMessage.meta.pageId === "string" ? rawMessage.meta.pageId : null;
          const acknowledgeCalibrationUi = () => {
            const acknowledgement = createRuntimeMessage(
              MESSAGE_TYPES.CALIBRATION_UI_READY,
              {
                messageId: createMessageId(),
                sentAtEpochMs: nowEpochMs(),
                source: "CONTENT",
                target: "BACKGROUND",
                sessionId: confirmedSessionId,
                pageId: confirmedPageId,
                tabId: confirmedTabId,
                browserFrameId: 0
              },
              { calibrationId: confirmedCalibrationPayload.calibrationId, accepted: true }
            );
            sendResponse(acknowledgement);
            void chrome.runtime.sendMessage(acknowledgement).catch(() => void 0);
          };
          if (activeCalibrationId === rawMessage.payload.calibrationId) {
            acknowledgeCalibrationUi();
            return true;
          }
          gazeOverlay.setTemporarilySuppressed(true);
          gazeOverlay.hide();
          preCalibrationCompleted = true;
          if (completionHideTimerId !== null) {
            window.clearTimeout(
              completionHideTimerId
            );
            completionHideTimerId = null;
          }
          preCalibrationOverlay.hide();
          calibrationGeneration += 1;
          const generation = calibrationGeneration;
          activeCalibrationId = rawMessage.payload.calibrationId;
          try {
            calibrationOverlay.showPreparing(
              createCalibrationPattern(rawMessage.payload.mode, {
                width: window.innerWidth,
                height: window.innerHeight
              }).length
            );
          } catch (error) {
            activeCalibrationId = null;
            calibrationOverlay.showError(
              error instanceof Error ? error.message : "Calibration UI failed to mount."
            );
            return false;
          }
          const context = {
            sessionId: rawMessage.meta.sessionId,
            pageId: typeof rawMessage.meta.pageId === "string" ? rawMessage.meta.pageId : null,
            tabId: rawMessage.meta.tabId
          };
          void runCalibration(
            rawMessage.payload,
            context,
            generation
          ).catch(
            (error) => {
              if (generation !== calibrationGeneration) {
                return;
              }
              calibrationOverlay.showError(
                error instanceof Error ? error.message : "Calibration failed."
              );
            }
          ).finally(() => {
            if (generation === calibrationGeneration) {
              gazeOverlay.setTemporarilySuppressed(
                false
              );
            }
          });
          acknowledgeCalibrationUi();
          return true;
        }
        return false;
      }
    );
  }
  var processAoiProbeRequest;
})();
//# sourceMappingURL=contentScript.js.map
