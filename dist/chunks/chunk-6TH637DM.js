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
function isMessageType(value) {
  return typeof value === "string" && MESSAGE_TYPE_VALUES.has(value);
}
function isCompatibleMessageProtocol(value) {
  return value === MESSAGE_PROTOCOL_VERSION;
}

// src/shared/constants.ts
var APP_NAME = "Webcam Eye Tracker";
var SCHEMA_VERSION = 2;
var TRACKER_VERSION = "0.1.0";
var TIME = {
  MS_PER_SECOND: 1e3,
  MS_PER_MINUTE: 6e4
};
var OFFSCREEN_RUNTIME = {
  DOCUMENT_PATH: "offscreen/offscreen.html",
  CREATE_JUSTIFICATION: "Keeps the local webcam eye-tracking runtime alive outside content pages.",
  HEALTH_CHECK_TIMEOUT_MS: 1500,
  HEALTH_CHECK_MAX_ATTEMPTS: 12,
  HEALTH_CHECK_RETRY_DELAY_MS: 150,
  BOOTSTRAP_GRACE_MS: 250,
  STALE_CONTEXT_RECOVERY_ATTEMPTS: 1
};
var CAMERA_DEFAULTS = {
  WIDTH: 640,
  HEIGHT: 480,
  FRAME_RATE: 30,
  FACING_MODE: "user"
};
var CAMERA_RUNTIME = {
  VIDEO_READY_TIMEOUT_MS: 8e3
};
var CAMERA_QUALITY_SAMPLING = {
  WIDTH: 160,
  HEIGHT: 120,
  FPS_WINDOW_SIZE: 30,
  MIN_FPS_SAMPLE_COUNT: 5
};
var CAMERA_QUALITY_THRESHOLDS = {
  MIN_ACCEPTABLE_FPS: 20,
  /**
   * Brightness metrics will later be normalized to 0..1.
   */
  MIN_BRIGHTNESS: 0.18,
  MAX_BRIGHTNESS: 0.92,
  MIN_SHARPNESS: 0.15
};
var FACE_PIPELINE_RUNTIME = {
  TARGET_ANALYSIS_RATE_HZ: 30,
  ERROR_REPORT_THROTTLE_MS: 2e3,
  POSITION_STATUS_BROADCAST_INTERVAL_MS: 200
};
var FACE_LANDMARKER_RUNTIME = {
  WASM_ASSET_DIRECTORY: "wasm",
  MODEL_ASSET_PATH: "models/face_landmarker.task",
  NUM_FACES: 1,
  MIN_FACE_DETECTION_CONFIDENCE: 0.5,
  MIN_FACE_PRESENCE_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
  OUTPUT_FACE_BLENDSHAPES: false,
  OUTPUT_FACIAL_TRANSFORMATION_MATRIXES: true,
  /**
   * CPU is the conservative default because it does not require a dedicated
   * WebGL canvas. GPU can be evaluated later behind this adapter.
   */
  DELEGATE: "CPU",
  /**
   * MediaPipe VIDEO mode requires monotonically increasing timestamps.
   * This increment is used only when two captured frames happen to carry the
   * same timestamp due to timer precision.
   */
  MIN_TIMESTAMP_INCREMENT_MS: 1e-3
};
var FACE_LANDMARK_INDICES = {
  NOSE_TIP: 1,
  FOREHEAD_TOP: 10,
  CHIN: 152,
  RIGHT_CHEEK: 234,
  LEFT_CHEEK: 454,
  LEFT_EYE_CONTOUR: [
    263,
    249,
    390,
    373,
    374,
    380,
    381,
    382,
    362,
    466,
    388,
    387,
    386,
    385,
    384,
    398
  ],
  RIGHT_EYE_CONTOUR: [
    33,
    7,
    163,
    144,
    145,
    153,
    154,
    155,
    133,
    246,
    161,
    160,
    159,
    158,
    157,
    173
  ],
  LEFT_IRIS: [
    474,
    475,
    476,
    477
  ],
  RIGHT_IRIS: [
    469,
    470,
    471,
    472
  ],
  LEFT_EYE_OUTER_CORNER: 263,
  LEFT_EYE_INNER_CORNER: 362,
  RIGHT_EYE_OUTER_CORNER: 33,
  RIGHT_EYE_INNER_CORNER: 133,
  /**
   * Three upper/lower eyelid pairs used to calculate an EAR-like opening
   * ratio. Pair order does not affect the distance calculation.
   */
  LEFT_EYELID_PAIRS: [
    [386, 374],
    [385, 380],
    [387, 373]
  ],
  RIGHT_EYELID_PAIRS: [
    [159, 145],
    [160, 144],
    [158, 153]
  ],
  FACE_OVAL: [
    10,
    338,
    297,
    332,
    284,
    251,
    389,
    356,
    454,
    323,
    361,
    288,
    397,
    365,
    379,
    378,
    400,
    377,
    152,
    148,
    176,
    149,
    150,
    136,
    172,
    58,
    132,
    93,
    234,
    127,
    162,
    21,
    54,
    103,
    67,
    109
  ]
};
var FACE_GEOMETRY_RUNTIME = {
  MIN_NORMALIZED_DIMENSION: 1e-6,
  MIN_PIXEL_DISTANCE: 1
};
var EYE_GEOMETRY_RUNTIME = {
  MIN_EYE_WIDTH_PX: 4,
  MIN_IRIS_DIAMETER_PX: 1,
  MIN_AXIS_LENGTH_PX: 1e-6
};
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
var FACE_POSITION_THRESHOLDS = {
  MAX_ABS_YAW_DEG: 18,
  MAX_ABS_PITCH_DEG: 18,
  MAX_ABS_ROLL_DEG: 15,
  MIN_FACE_DISTANCE_RATIO: 0.75,
  MAX_FACE_DISTANCE_RATIO: 1.25,
  /**
   * Relative normalized deviation from the desired screen/camera center.
   */
  MAX_CENTER_OFFSET_X_RATIO: 0.12,
  MAX_CENTER_OFFSET_Y_RATIO: 0.12,
  /**
   * User must remain within the valid positioning range for this long
   * before calibration may begin.
   */
  REQUIRED_STABLE_DURATION_MS: 1e3
};
var PRE_CALIBRATION_RUNTIME = {
  MIN_BASELINE_SAMPLE_COUNT: 10,
  MAX_BASELINE_SAMPLE_COUNT: 90
};
var FACE_QUALITY_THRESHOLDS = {
  MIN_FACE_CONFIDENCE: 0.65,
  MIN_EYE_CONFIDENCE: 0.6,
  GOOD_QUALITY_SCORE: 0.8,
  FAIR_QUALITY_SCORE: 0.6,
  POOR_QUALITY_SCORE: 0.35
};
var FACE_QUALITY_RUNTIME = {
  EXPECTED_LANDMARK_COUNT: 478,
  FACE_CONFIDENCE_GEOMETRY_WEIGHT: 0.55,
  FACE_CONFIDENCE_POSE_WEIGHT: 0.35,
  FACE_CONFIDENCE_MATRIX_BONUS: 0.1,
  SINGLE_EYE_GEOMETRY_WEIGHT: 0.5,
  IMPLAUSIBLE_EYE_SCORE_MULTIPLIER: 0.6,
  EYE_HORIZONTAL_POSITION_MIN: -0.25,
  EYE_HORIZONTAL_POSITION_MAX: 1.25,
  EYE_MAX_ABS_VERTICAL_OFFSET_RATIO: 0.75,
  EYE_MIN_IRIS_TO_EYE_WIDTH_RATIO: 0.08,
  EYE_MAX_IRIS_TO_EYE_WIDTH_RATIO: 0.7,
  FACE_SCORE_WEIGHT: 0.3,
  EYE_SCORE_WEIGHT: 0.3,
  HEAD_POSE_SCORE_WEIGHT: 0.2,
  POSITION_SCORE_WEIGHT: 0.1,
  CAMERA_SCORE_WEIGHT: 0.1,
  FALLBACK_POSE_SCORE_MULTIPLIER: 0.85,
  BLINK_SCORE_MULTIPLIER: 0.1,
  ASYMMETRIC_CLOSURE_SCORE_MULTIPLIER: 0.5,
  CAMERA_GOOD_SCORE: 1,
  CAMERA_FAIR_SCORE: 0.75,
  CAMERA_POOR_SCORE: 0.35,
  CAMERA_INVALID_SCORE: 0,
  /**
   * Absolute pre-calibration face-size guards used before a participant
   * baseline exists. Ratios are relative to the camera frame.
   */
  MIN_PRECALIBRATION_FACE_WIDTH_RATIO: 0.2,
  MAX_PRECALIBRATION_FACE_WIDTH_RATIO: 0.62,
  MIN_PRECALIBRATION_FACE_HEIGHT_RATIO: 0.28,
  MAX_PRECALIBRATION_FACE_HEIGHT_RATIO: 0.82
};
var BLINK_THRESHOLDS = {
  CLOSED_THRESHOLD: 0.18,
  OPEN_THRESHOLD: 0.23,
  MIN_BLINK_DURATION_MS: 50,
  MAX_BLINK_DURATION_MS: 500,
  /**
   * Both eyes must stay above OPEN_THRESHOLD for this long before a closure
   * candidate is finalized. This suppresses one-frame reopen jitter.
   */
  REOPEN_CONFIRMATION_MS: 40,
  /**
   * Preserve an in-progress blink candidate across very short eye-geometry
   * dropouts, but reset temporal state after a longer tracking gap.
   */
  MAX_INVALID_SAMPLE_GAP_MS: 100
};
var GAZE_ENGINE_DEFAULTS = {
  PRIMARY: "WEB_EYE_TRACK",
  FALLBACK: "RIDGE"
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
var ONNX_RUNTIME_WEB = {
  PACKAGE_VERSION: "1.29.0",
  MODULE_ASSET_PATH: "vendor/onnxruntime/ort.webgpu.bundle.min.mjs",
  WASM_BASE_ASSET_PATH: "wasm/onnxruntime/",
  WASM_ASSET_PATH: "wasm/onnxruntime/ort-wasm-simd-threaded.wasm",
  WEBGPU_WASM_ASSET_PATH: "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.wasm",
  /**
   * Keep WASM single-threaded until the extension runtime explicitly proves
   * that SharedArrayBuffer/cross-origin isolation is available. This avoids
   * making high-performance threading a hidden startup requirement.
   */
  DEFAULT_WASM_THREADS: 1,
  PREFERRED_EXECUTION_PROVIDERS: [
    "webgpu",
    "wasm"
  ]
};
var L2CS_GAZE_MODEL = {
  MODEL_ASSET_PATH: "models/l2cs/l2cs_resnet50_gaze360.onnx",
  CONTRACT_ASSET_PATH: "models/l2cs/l2cs_resnet50_gaze360.contract.json",
  INPUT_NAME: "input",
  YAW_OUTPUT_NAME: "yaw_logits",
  PITCH_OUTPUT_NAME: "pitch_logits",
  FEATURE_OUTPUT_NAME: "features",
  INPUT_WIDTH: 448,
  INPUT_HEIGHT: 448,
  /**
   * The official webcam pipeline first warps the detected face crop to
   * 224x224 and then torchvision Resize(448) is applied by preprocessing.
   * Keeping the intermediate size explicit makes our browser path auditable.
   */
  FACE_CROP_WIDTH: 224,
  FACE_CROP_HEIGHT: 224,
  CHANNEL_COUNT: 3,
  BIN_COUNT: 90,
  BIN_SIZE_DEGREES: 4,
  MIN_ANGLE_DEGREES: -180,
  BACKBONE_FEATURE_DIMENSION: 2048,
  IMAGE_NET_MEAN: [
    0.485,
    0.456,
    0.406
  ],
  IMAGE_NET_STD: [
    0.229,
    0.224,
    0.225
  ],
  EXECUTION_PROVIDERS: [
    "webgpu",
    "wasm"
  ]
};
var WEB_EYE_TRACK_RUNTIME = {
  PACKAGE_VERSION: "0.0.2",
  UPSTREAM_COMMIT: "75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c",
  MODEL_BASE_ASSET_PATH: "models/webeyetrack",
  MODEL_JSON_ASSET_PATH: "models/webeyetrack/web/model.json",
  MODEL_WEIGHT_ASSET_PATH: "models/webeyetrack/web/group1-shard1of1.bin"
};
var GAZE_QUALITY_THRESHOLDS = {
  GOOD: 0.8,
  FAIR: 0.6,
  POOR: 0.35,
  /**
   * Samples below this value are invalid by default.
   */
  MIN_VALID: 0.35
};
var GAZE_QUALITY_RUNTIME = {
  ENGINE_CONFIDENCE_WEIGHT: 0.55,
  FACE_PIPELINE_WEIGHT: 0.45
};
var GAZE_VALIDATION_DEFAULTS = {
  NORMALIZED_OVERSCAN_MARGIN: 0.5,
  TIMESTAMP_TOLERANCE_MS: 1
};
var DEEP_PERSONALIZATION = {
  MIN_DEEP_SAMPLES_PER_POINT: 2,
  MIN_CALIBRATION_POINT_COUNT: 9,
  /**
   * The WebEyeTrack stability selector can return a short 280-500 ms window.
   * Deep inference is intentionally lower-rate and asynchronous, so an exact
   * timestamp intersection can contain only one sample even when the observer
   * is healthy. We may therefore admit deep samples slightly before/after the
   * accepted stability window, but never before the target settling interval.
   */
  CALIBRATION_WINDOW_PADDING_MS: 180,
  /**
   * L2CS ResNet-50 currently runs at roughly 2-3 Hz on the validated WebGPU
   * path. When the established WebEyeTrack collector becomes READY, keep the
   * same target visible for a short bounded grace interval so at least two
   * post-settle deep observations can be associated with the target. This is
   * a synchronization allowance only; it does not relax gaze-quality or
   * independent-validation thresholds.
   */
  CALIBRATION_DEEP_GRACE_MS: 1250,
  CALIBRATION_DEEP_TARGET_SAMPLE_COUNT: 5,
  MAX_DEEP_SAMPLES_PER_POINT: 10,
  /**
   * V5 cross-device performance governor. L2CS is a shadow observer during
   * calibration, so a very slow observer must never starve the authoritative
   * WebEyeTrack + MediaPipe path. Once a completed deep inference exceeds this
   * latency, deep observation is suspended until independent validation ends.
   * The baseline calibration and validation continue unchanged.
   */
  CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS: 650,
  /**
   * V6 session-strategy safety gate. A Deep/Hybrid strategy is promoted only
   * when synchronized deep observations cover most calibration targets. The
   * personal mapper may still fit with fewer targets for shadow diagnostics,
   * but sparse coverage must not make a slow/partial Deep path authoritative.
   */
  SESSION_STRATEGY_MIN_DEEP_COVERAGE_RATIO: 0.75,
  /**
   * After independent validation completes, wait briefly before runtime drift
   * maintenance starts. This prevents validation-target transitions from being
   * interpreted as an immediate post-calibration pose drift.
   */
  DRIFT_MONITOR_POST_VALIDATION_WARMUP_MS: 1500,
  /**
   * Keep multiple robust temporal/pose exemplars from each calibration target
   * instead of collapsing every target to one point-average feature. Grouped
   * CV still holds out every exemplar belonging to the same target together.
   */
  MAX_EXEMPLARS_PER_CALIBRATION_POINT: 3,
  MIN_SAMPLES_PER_EXEMPLAR: 2,
  /** Runtime deep observations are aggregated only across a very short window. */
  RUNTIME_AGGREGATION_MIN_SAMPLE_COUNT: 2,
  RUNTIME_AGGREGATION_MAX_SAMPLE_COUNT: 3,
  RUNTIME_AGGREGATION_MAX_AGE_MS: 900,
  RUNTIME_AGGREGATION_MAX_GAZE_ANGLE_DELTA_RAD: 0.12,
  RUNTIME_AGGREGATION_MAX_HEAD_DELTA_DEG: 4,
  RUNTIME_AGGREGATION_MAX_FACE_CENTER_DELTA: 0.035,
  RUNTIME_AGGREGATION_MAX_DISTANCE_DELTA: 0.08,
  /**
   * Live temporal alignment has a substantially tighter hard source-age cap
   * than independent-validation target dwell. This prevents a valid but old
   * L2CS result from being transported indefinitely through the live stream.
   */
  LIVE_DEEP_MAX_SOURCE_AGE_MS: 1200,
  /**
   * Independent validation remains completely excluded from fitting/model
   * selection. We only keep the target visible briefly after the established
   * baseline collector becomes READY so the slower L2CS observer can produce
   * enough predictions to score the same target independently.
   */
  /**
   * Stage D15 adaptive independent-validation dwell. The target remains
   * visible only until enough quality deep observations are available, with
   * a bounded maximum post-settle collection window. TARGET_SETTLE_MS is
   * intentionally excluded from this dwell budget so the slower L2CS observer
   * can actually collect the requested 5-6 usable predictions. Independent-
   * validation labels are never used to decide whether a sample is accepted.
   */
  VALIDATION_DEEP_MIN_ACCEPTED_SAMPLE_COUNT: 5,
  VALIDATION_DEEP_PREFERRED_SAMPLE_COUNT: 6,
  VALIDATION_DEEP_MAX_DWELL_MS: 2500,
  MAX_DEEP_VALIDATION_SAMPLES_PER_POINT: 8,
  /**
   * Calibration-only hybrid selector. Expected errors come exclusively from
   * leave-one-calibration-point-out diagnostics; independent validation never
   * changes these weights. Bucket estimates are shrunk toward the global
   * estimate because STANDARD_17 contains only one exact center point.
   */
  HYBRID_BUCKET_PSEUDOCOUNT: 3,
  /**
   * Directional 3x3 priors receive two STANDARD_17 targets per non-center
   * direction and one exact center target. Shrink local estimates toward the
   * global prior to reduce overfitting while still preserving directional
   * asymmetry observed in calibration.
   */
  HYBRID_DIRECTIONAL_BUCKET_PSEUDOCOUNT: 2,
  HYBRID_MIN_EXPECTED_ERROR_PX: 20,
  HYBRID_MIN_DEEP_WEIGHT: 0.2,
  HYBRID_MAX_DEEP_WEIGHT: 0.8,
  /**
   * Deep confidence is used only as a conservative reliability penalty. High
   * confidence does not earn an optimistic bonus; low confidence can only
   * increase the expected deep error and therefore reduce its fusion weight.
   */
  HYBRID_DEEP_CONFIDENCE_REFERENCE: 0.7,
  HYBRID_DEEP_CONFIDENCE_FLOOR: 0.55,
  HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER: 1.35,
  /**
   * Geometry drift does not pick a winner. Instead, it reduces trust in the
   * direction-specific calibration prior and smoothly backs off toward the
   * global grouped-CV prior. This prevents a changed head/device pose from
   * causing overconfident directional routing.
   */
  HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY: 0.55,
  HYBRID_DRIFT_HEAD_SOFT_DEG: 2,
  HYBRID_DRIFT_HEAD_HARD_DEG: 10,
  HYBRID_DRIFT_FACE_CENTER_SOFT: 0.01,
  HYBRID_DRIFT_FACE_CENTER_HARD: 0.06,
  HYBRID_DRIFT_SCALE_SOFT: 0.03,
  HYBRID_DRIFT_SCALE_HARD: 0.15,
  HYBRID_DRIFT_DISTANCE_SOFT: 0.03,
  HYBRID_DRIFT_DISTANCE_HARD: 0.15,
  /**
   * Stage D14: current-window temporal stability is target-free evidence.
   * Precision is measured as sample spread around each engine's own centroid,
   * so it can adapt reliability without using independent-validation labels.
   * A stable engine is not given an optimistic bonus; only excessive jitter
   * increases its expected error. Drift makes that stability evidence count
   * more strongly because pose changes weaken calibration-only priors.
   */
  HYBRID_STABILITY_SOFT_RATIO: 0.3,
  HYBRID_STABILITY_HARD_RATIO: 0.9,
  HYBRID_MAX_STABILITY_ERROR_MULTIPLIER: 1.75,
  HYBRID_STABILITY_BASE_STRENGTH: 0.45,
  HYBRID_STABILITY_DRIFT_STRENGTH: 0.55,
  /**
   * Stage D15-C uncertainty treats baseline/deep disagreement as a separate
   * target-free uncertainty source. Disagreement inside the soft zone adds no
   * extra radius; only the excess up to the hard zone contributes through the
   * weighted two-model mixture spread. It is combined with calibration-prior
   * and current-window centroid noise using RSS rather than a linear sum.
   */
  HYBRID_DISAGREEMENT_SOFT_NORMALIZED: 0.035,
  HYBRID_DISAGREEMENT_HARD_NORMALIZED: 0.12,
  /**
   * Final region uncertainty remains bounded as a safety guard. D15-C no
   * longer tries to reach this value through linear additive penalties; the
   * clamp applies only after independently interpretable uncertainty sources
   * have been combined.
   */
  GAZE_REGION_MAX_UNCERTAINTY_RADIUS_NORMALIZED: 0.12,
  /** Maximum PCA rank for point-averaged L2CS backbone features. */
  PCA_COMPONENT_COUNT: 12,
  PCA_POWER_ITERATIONS: 14,
  PCA_MIN_EIGENVALUE: 1e-10,
  MIN_FEATURE_STANDARD_DEVIATION: 1e-6,
  LINEAR_RIDGE_LAMBDAS: [
    0.01,
    0.1,
    1
  ],
  RBF_RIDGE_LAMBDAS: [
    0.01,
    0.1
  ],
  RBF_GAMMA_SCALES: [
    0.5,
    1,
    2
  ],
  /** Deterministic Random-Fourier approximation to the RBF mapper. */
  RFF_RIDGE_LAMBDAS: [
    0.01,
    0.1,
    1
  ],
  RFF_GAMMA_SCALES: [
    0.5,
    1,
    2
  ],
  RFF_FEATURE_COUNT: 64,
  /** Rolling target-free precision estimates used by live hybrid routing. */
  BASELINE_PRECISION_WINDOW_MS: 420,
  BASELINE_PRECISION_MIN_SAMPLES: 5,
  DEEP_PRECISION_WINDOW_MS: 1600,
  DEEP_PRECISION_MIN_SAMPLES: 3,
  PRECISION_MAX_FIXATION_SPEED_PX_PER_SECOND: 520
};
var GAZE_RUNTIME_DEFAULTS = {
  TARGET_SAMPLE_RATE_HZ: 30,
  /**
   * Stage D6 shadow-inference cadence for the universal deep engine.
   *
   * The deep observer remains slower than the emitted gaze stream, but 10 Hz
   * gives the 280-500 ms calibration stability window enough synchronized
   * samples for participant-specific mapping. The in-flight guard still
   * prevents overlapping L2CS inference when a device cannot sustain 10 Hz.
   */
  DEEP_OBSERVER_SAMPLE_RATE_HZ: 10,
  /**
   * Maximum age of a previous valid sample that may be used for
   * visualization continuity.
   *
   * It must NOT turn an invalid research sample into a valid sample.
   */
  MAX_VISUAL_HOLD_MS: 180
};
var GAZE_FILTER_DEFAULTS = {
  /**
   * One-Euro display filter defaults. Coordinates are viewport pixels, so
   * beta is deliberately small and must be tuned from pilot jitter/latency.
   */
  ONE_EURO_MIN_CUTOFF_HZ: 1,
  ONE_EURO_BETA: 4e-3,
  ONE_EURO_DERIVATIVE_CUTOFF_HZ: 1,
  /**
   * Research denoiser uses a causal five-sample buffer and only repairs
   * isolated spikes; it does not replace raw gaze or validation metrics.
   */
  RESEARCH_DENOISE_WINDOW_SIZE: 5,
  RESEARCH_SPIKE_NEIGHBOR_RADIUS_PX: 45,
  RESEARCH_SPIKE_CENTER_DEVIATION_PX: 80,
  /**
   * Real-time isolated-jump gate. A very large single-frame displacement is
   * held for one frame and accepted immediately when the next sample confirms
   * the same movement, preserving real saccades while rejecting one-frame
   * spikes.
   */
  RUNTIME_OUTLIER_JUMP_PX: 170,
  RUNTIME_OUTLIER_CONFIRM_RADIUS_PX: 95,
  RUNTIME_OUTLIER_RETURN_RADIUS_PX: 70,
  RUNTIME_OUTLIER_MAX_CONFIRM_MS: 120
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
var CALIBRATION_VALIDATION_THRESHOLDS = {
  /**
   * Production-oriented READY gate using CSS viewport-width ratios.
   *
   * Ratios are intentionally preferred over fixed pixel thresholds because
   * browser zoom and display resolution change CSS pixel counts. They are
   * still only a screen-relative proxy, not degrees of visual angle. A true
   * degree conversion requires measured physical display geometry and viewing
   * distance, which the browser cannot infer reliably.
   */
  GOOD_MAX_MEAN_ERROR_WIDTH_RATIO: 0.03,
  GOOD_MAX_P95_ERROR_WIDTH_RATIO: 0.05,
  GOOD_MAX_MEAN_PRECISION_WIDTH_RATIO: 0.02,
  GOOD_MAX_P95_PRECISION_WIDTH_RATIO: 0.035,
  GOOD_MIN_VALID_SAMPLE_RATIO: 0.85,
  /**
   * Slightly relaxed experiment-ready gate. GOOD remains unchanged; only the
   * ACCEPTABLE band receives a small margin so borderline but still spatially
   * usable sessions are not rejected unnecessarily.
   */
  ACCEPTABLE_MAX_MEAN_ERROR_WIDTH_RATIO: 0.0425,
  ACCEPTABLE_MAX_P95_ERROR_WIDTH_RATIO: 0.075,
  ACCEPTABLE_MAX_MEAN_PRECISION_WIDTH_RATIO: 0.0325,
  ACCEPTABLE_MAX_P95_PRECISION_WIDTH_RATIO: 0.055,
  ACCEPTABLE_MIN_VALID_SAMPLE_RATIO: 0.75,
  POOR_MAX_MEAN_ERROR_WIDTH_RATIO: 0.06,
  POOR_MAX_P95_ERROR_WIDTH_RATIO: 0.1,
  POOR_MAX_MEAN_PRECISION_WIDTH_RATIO: 0.05,
  POOR_MAX_P95_PRECISION_WIDTH_RATIO: 0.08,
  POOR_MIN_VALID_SAMPLE_RATIO: 0.6,
  /** Catastrophic safety cap independent of viewport-ratio classification. */
  ABSOLUTE_MAX_P95_ERROR_PX: 300
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
var NORMALIZED_COORDINATE = {
  MIN: 0,
  CENTER: 0.5,
  MAX: 1
};
var NUMERIC_EPSILON = 1e-9;
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
var NAVIGATION = {
  /**
   * Maximum time to retain temporary opener/new-tab association data.
   */
  TAB_ASSOCIATION_TTL_MS: 3e4,
  /**
   * Prevent duplicate page lifecycle events caused by multiple
   * navigation signals arriving almost simultaneously.
   */
  EVENT_DEDUPLICATION_WINDOW_MS: 100
};
var FIXATION_DEFAULTS = {
  MIN_DURATION_MS: 100,
  DISPERSION_THRESHOLD_PX: 80,
  MIN_SAMPLE_COUNT: 3,
  MAX_SAMPLE_GAP_MS: 100
};
var DATABASE = {
  NAME: "webcam-eye-tracker-db",
  VERSION: 2,
  STORES: {
    SESSIONS: "sessions",
    GAZE_SAMPLES: "gaze_samples",
    INTERACTION_EVENTS: "interaction_events",
    AOI_REGISTRY: "aoi_registry",
    FIXATION_EVENTS: "fixation_events",
    CALIBRATION_SAMPLES: "calibration_samples",
    CALIBRATION_SUMMARY: "calibration_summary",
    PAGE_EVENTS: "page_events",
    DIAGNOSTICS: "diagnostics",
    UPLOAD_QUEUE: "upload_queue"
  }
};
var STORAGE_BATCH = {
  GAZE_MAX_ITEMS: 60,
  EVENT_MAX_ITEMS: 100,
  /**
   * Flush even if a batch has not reached its maximum size.
   */
  MAX_FLUSH_INTERVAL_MS: 1e3,
  /**
   * Buffer should always be flushed during STOPPING/page shutdown paths.
   */
  FLUSH_ON_STOP: true
};
var LOGGING = {
  ENABLE_DEBUG_LOGS: false,
  MAX_SERIALIZED_DETAILS_LENGTH: 4e3
};
var RUNTIME_LIMITS = {
  MAX_DIAGNOSTIC_DETAILS_DEPTH: 5,
  MAX_AOI_TEXT_LENGTH: 250,
  MAX_URL_LENGTH: 8192
};

// src/shared/utils.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isNullableFiniteNumber(value) {
  return value === null || isFiniteNumber(value);
}
function isPositiveFiniteNumber(value) {
  return isFiniteNumber(value) && value > 0;
}
function isNullableString(value) {
  return value === null || typeof value === "string";
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
function createSessionId() {
  const randomBytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes, (byte) => (byte % 36).toString(36)).join("");
  return `session_${Date.now()}_${suffix}`;
}
function createPageId() {
  const randomBytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes, (byte) => (byte % 36).toString(36)).join("");
  return `pv_${Date.now()}_${suffix}`;
}
function createFixationId() {
  return createPrefixedId(
    "fixation"
  );
}
function createCalibrationId() {
  return createPrefixedId(
    "calibration"
  );
}
function createMessageId() {
  return createPrefixedId(
    "msg"
  );
}
function clamp(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RangeError(
      "clamp() requires finite numeric arguments."
    );
  }
  if (min > max) {
    throw new RangeError(
      "clamp() requires min <= max."
    );
  }
  return Math.min(
    Math.max(value, min),
    max
  );
}
function clamp01(value) {
  return clamp(
    value,
    0,
    1
  );
}
function squaredDistance2D(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}
function distance2D(a, b) {
  return Math.sqrt(
    squaredDistance2D(
      a,
      b
    )
  );
}
function isNormalizedValue(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
function isNormalizedPoint(point) {
  return isNormalizedValue(
    point.x
  ) && isNormalizedValue(
    point.y
  );
}
function truncateString(value, maxLength) {
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError(
      "truncateString() maxLength must be a non-negative integer."
    );
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength === 0) {
    return "";
  }
  if (maxLength === 1) {
    return "\u2026";
  }
  return `${value.slice(
    0,
    maxLength - 1
  )}\u2026`;
}
function isHttpOrHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// src/shared/errors.ts
var ERROR_CODES = {
  UNKNOWN: "UNKNOWN",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  INCOMPATIBLE_MESSAGE_PROTOCOL: "INCOMPATIBLE_MESSAGE_PROTOCOL",
  EXTENSION_CONTEXT_INVALIDATED: "EXTENSION_CONTEXT_INVALIDATED",
  OFFSCREEN_CREATE_FAILED: "OFFSCREEN_CREATE_FAILED",
  OFFSCREEN_NOT_AVAILABLE: "OFFSCREEN_NOT_AVAILABLE",
  CAMERA_PERMISSION_DENIED: "CAMERA_PERMISSION_DENIED",
  CAMERA_NOT_FOUND: "CAMERA_NOT_FOUND",
  CAMERA_NOT_READABLE: "CAMERA_NOT_READABLE",
  CAMERA_CONSTRAINT_UNSATISFIED: "CAMERA_CONSTRAINT_UNSATISFIED",
  CAMERA_DISCONNECTED: "CAMERA_DISCONNECTED",
  CAMERA_START_FAILED: "CAMERA_START_FAILED",
  CAMERA_FRAME_UNAVAILABLE: "CAMERA_FRAME_UNAVAILABLE",
  CAMERA_QUALITY_FAILED: "CAMERA_QUALITY_FAILED",
  MEDIAPIPE_INIT_FAILED: "MEDIAPIPE_INIT_FAILED",
  FACE_MODEL_LOAD_FAILED: "FACE_MODEL_LOAD_FAILED",
  WASM_LOAD_FAILED: "WASM_LOAD_FAILED",
  FACE_DETECTION_FAILED: "FACE_DETECTION_FAILED",
  GAZE_ENGINE_INIT_FAILED: "GAZE_ENGINE_INIT_FAILED",
  GAZE_PREDICTION_FAILED: "GAZE_PREDICTION_FAILED",
  GAZE_INVALID_SAMPLE: "GAZE_INVALID_SAMPLE",
  CALIBRATION_INSUFFICIENT_SAMPLES: "CALIBRATION_INSUFFICIENT_SAMPLES",
  CALIBRATION_MODEL_FAILED: "CALIBRATION_MODEL_FAILED",
  CALIBRATION_VALIDATION_FAILED: "CALIBRATION_VALIDATION_FAILED",
  DRIFT_EXCESSIVE: "DRIFT_EXCESSIVE",
  CONTENT_SCRIPT_UNAVAILABLE: "CONTENT_SCRIPT_UNAVAILABLE",
  PAGE_CONTEXT_INVALID: "PAGE_CONTEXT_INVALID",
  TAB_CLOSED: "TAB_CLOSED",
  TAB_ASSOCIATION_FAILED: "TAB_ASSOCIATION_FAILED",
  FRAME_UNAVAILABLE: "FRAME_UNAVAILABLE",
  AOI_RESOLUTION_FAILED: "AOI_RESOLUTION_FAILED",
  DATABASE_OPEN_FAILED: "DATABASE_OPEN_FAILED",
  DATABASE_READ_FAILED: "DATABASE_READ_FAILED",
  DATABASE_WRITE_FAILED: "DATABASE_WRITE_FAILED",
  DATABASE_MIGRATION_FAILED: "DATABASE_MIGRATION_FAILED",
  STORAGE_FLUSH_FAILED: "STORAGE_FLUSH_FAILED",
  NETWORK_OFFLINE: "NETWORK_OFFLINE",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_REQUEST_FAILED: "NETWORK_REQUEST_FAILED",
  UPLOAD_RETRY_EXHAUSTED: "UPLOAD_RETRY_EXHAUSTED",
  EXPORT_FAILED: "EXPORT_FAILED"
};
var DEFAULT_ERROR_RECOVERABILITY = {
  [ERROR_CODES.UNKNOWN]: false,
  [ERROR_CODES.INVALID_STATE_TRANSITION]: true,
  [ERROR_CODES.INVALID_MESSAGE]: true,
  [ERROR_CODES.INCOMPATIBLE_MESSAGE_PROTOCOL]: false,
  [ERROR_CODES.EXTENSION_CONTEXT_INVALIDATED]: false,
  [ERROR_CODES.OFFSCREEN_CREATE_FAILED]: false,
  [ERROR_CODES.OFFSCREEN_NOT_AVAILABLE]: false,
  [ERROR_CODES.CAMERA_PERMISSION_DENIED]: false,
  [ERROR_CODES.CAMERA_NOT_FOUND]: false,
  [ERROR_CODES.CAMERA_NOT_READABLE]: true,
  [ERROR_CODES.CAMERA_CONSTRAINT_UNSATISFIED]: true,
  [ERROR_CODES.CAMERA_DISCONNECTED]: true,
  [ERROR_CODES.CAMERA_START_FAILED]: true,
  [ERROR_CODES.CAMERA_FRAME_UNAVAILABLE]: true,
  [ERROR_CODES.CAMERA_QUALITY_FAILED]: true,
  [ERROR_CODES.MEDIAPIPE_INIT_FAILED]: false,
  [ERROR_CODES.FACE_MODEL_LOAD_FAILED]: false,
  [ERROR_CODES.WASM_LOAD_FAILED]: false,
  [ERROR_CODES.FACE_DETECTION_FAILED]: true,
  [ERROR_CODES.GAZE_ENGINE_INIT_FAILED]: false,
  [ERROR_CODES.GAZE_PREDICTION_FAILED]: true,
  [ERROR_CODES.GAZE_INVALID_SAMPLE]: true,
  [ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES]: true,
  [ERROR_CODES.CALIBRATION_MODEL_FAILED]: true,
  [ERROR_CODES.CALIBRATION_VALIDATION_FAILED]: true,
  [ERROR_CODES.DRIFT_EXCESSIVE]: true,
  [ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE]: true,
  [ERROR_CODES.PAGE_CONTEXT_INVALID]: true,
  [ERROR_CODES.TAB_CLOSED]: true,
  [ERROR_CODES.TAB_ASSOCIATION_FAILED]: true,
  [ERROR_CODES.FRAME_UNAVAILABLE]: true,
  [ERROR_CODES.AOI_RESOLUTION_FAILED]: true,
  [ERROR_CODES.DATABASE_OPEN_FAILED]: false,
  [ERROR_CODES.DATABASE_READ_FAILED]: true,
  [ERROR_CODES.DATABASE_WRITE_FAILED]: true,
  [ERROR_CODES.DATABASE_MIGRATION_FAILED]: false,
  [ERROR_CODES.STORAGE_FLUSH_FAILED]: true,
  [ERROR_CODES.NETWORK_OFFLINE]: true,
  [ERROR_CODES.NETWORK_TIMEOUT]: true,
  [ERROR_CODES.NETWORK_REQUEST_FAILED]: true,
  [ERROR_CODES.UPLOAD_RETRY_EXHAUSTED]: true,
  [ERROR_CODES.EXPORT_FAILED]: true
};
var TrackerError = class extends Error {
  code;
  component;
  recoverable;
  details;
  constructor(code, component, message, options = {}) {
    super(
      message,
      options.cause !== void 0 ? { cause: options.cause } : void 0
    );
    this.name = "TrackerError";
    this.code = code;
    this.component = component;
    this.recoverable = options.recoverable ?? DEFAULT_ERROR_RECOVERABILITY[code];
    this.details = options.details ?? null;
  }
  /**
   * Converts the Error instance into a plain serializable object.
   */
  toSerializable() {
    return {
      code: this.code,
      message: this.message,
      component: this.component,
      recoverable: this.recoverable,
      details: this.details
    };
  }
};
var ERROR_CODE_VALUES = new Set(Object.values(ERROR_CODES));
function isTrackerErrorCode(value) {
  return typeof value === "string" && ERROR_CODE_VALUES.has(value);
}
function isTrackerError(value) {
  return value instanceof TrackerError;
}
function getUnknownErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred.";
}
function normalizeTrackerError(error, fallbackCode, component, fallbackMessage, options = {}) {
  if (isTrackerError(error)) {
    return error;
  }
  const originalMessage = getUnknownErrorMessage(error);
  return new TrackerError(
    fallbackCode,
    component,
    fallbackMessage,
    {
      ...options,
      cause: error,
      details: {
        ...options.details ?? {},
        originalMessage
      }
    }
  );
}
function normalizeCameraError(error) {
  if (isTrackerError(error)) {
    return error;
  }
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return new TrackerError(
          ERROR_CODES.CAMERA_PERMISSION_DENIED,
          "CAMERA",
          "Camera permission was denied or could not be prompted in this extension context.",
          {
            cause: error,
            details: {
              domExceptionName: error.name,
              originalMessage: error.message
            }
          }
        );
      case "NotFoundError":
      case "DevicesNotFoundError":
        return new TrackerError(
          ERROR_CODES.CAMERA_NOT_FOUND,
          "CAMERA",
          "No usable camera device was found.",
          {
            cause: error
          }
        );
      case "NotReadableError":
      case "TrackStartError":
        return new TrackerError(
          ERROR_CODES.CAMERA_NOT_READABLE,
          "CAMERA",
          "The camera exists but could not be opened.",
          {
            cause: error
          }
        );
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return new TrackerError(
          ERROR_CODES.CAMERA_CONSTRAINT_UNSATISFIED,
          "CAMERA",
          "The requested camera constraints could not be satisfied.",
          {
            cause: error
          }
        );
      case "AbortError":
        return new TrackerError(
          ERROR_CODES.CAMERA_START_FAILED,
          "CAMERA",
          "Camera initialization was aborted.",
          {
            cause: error
          }
        );
      default:
        return new TrackerError(
          ERROR_CODES.CAMERA_START_FAILED,
          "CAMERA",
          "The camera could not be initialized.",
          {
            cause: error,
            details: {
              domExceptionName: error.name,
              originalMessage: error.message
            }
          }
        );
    }
  }
  return normalizeTrackerError(
    error,
    ERROR_CODES.CAMERA_START_FAILED,
    "CAMERA",
    "The camera could not be initialized."
  );
}

// src/camera/cameraConfig.ts
var DEFAULT_CAMERA_REQUEST = {
  preferredWidth: CAMERA_DEFAULTS.WIDTH,
  preferredHeight: CAMERA_DEFAULTS.HEIGHT,
  preferredFrameRate: CAMERA_DEFAULTS.FRAME_RATE,
  preferredDeviceId: null
};
function isCameraRequest(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isPositiveFiniteNumber(
    value.preferredWidth
  ) && isPositiveFiniteNumber(
    value.preferredHeight
  ) && isPositiveFiniteNumber(
    value.preferredFrameRate
  ) && (value.preferredDeviceId === null || isNonEmptyString(
    value.preferredDeviceId
  ));
}
function isCameraSettings(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isPositiveFiniteNumber(
    value.width
  ) && isPositiveFiniteNumber(
    value.height
  ) && isPositiveFiniteNumber(
    value.frameRate
  ) && (value.deviceId === null || typeof value.deviceId === "string") && (value.facingMode === null || typeof value.facingMode === "string");
}
function assertCameraRequest(request) {
  if (isCameraRequest(request)) {
    return;
  }
  throw new TrackerError(
    ERROR_CODES.CAMERA_CONSTRAINT_UNSATISFIED,
    "CAMERA",
    "Camera request contains invalid preferred constraints."
  );
}
function createCameraConstraints(request) {
  assertCameraRequest(request);
  const videoConstraints = {
    width: {
      ideal: request.preferredWidth
    },
    height: {
      ideal: request.preferredHeight
    },
    frameRate: {
      ideal: request.preferredFrameRate
    },
    facingMode: {
      ideal: CAMERA_DEFAULTS.FACING_MODE
    }
  };
  if (request.preferredDeviceId !== null) {
    videoConstraints.deviceId = {
      ideal: request.preferredDeviceId
    };
  }
  return {
    audio: false,
    video: videoConstraints
  };
}
function getPositiveSetting(value, fallback) {
  if (value !== void 0 && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}
function readActualCameraSettings(track, videoElement, request) {
  const settings = track.getSettings();
  const width = getPositiveSetting(
    settings.width,
    videoElement.videoWidth
  );
  const height = getPositiveSetting(
    settings.height,
    videoElement.videoHeight
  );
  const frameRate = getPositiveSetting(
    settings.frameRate,
    request.preferredFrameRate
  );
  if (width <= 0 || height <= 0) {
    throw new TrackerError(
      ERROR_CODES.CAMERA_START_FAILED,
      "CAMERA",
      "Camera started without usable video dimensions.",
      {
        details: {
          trackWidth: settings.width ?? null,
          trackHeight: settings.height ?? null,
          videoWidth: videoElement.videoWidth,
          videoHeight: videoElement.videoHeight
        }
      }
    );
  }
  return {
    width,
    height,
    frameRate,
    deviceId: settings.deviceId ?? null,
    facingMode: settings.facingMode ?? null
  };
}

export {
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  createRuntimeMessage,
  isMessageType,
  isCompatibleMessageProtocol,
  APP_NAME,
  SCHEMA_VERSION,
  TRACKER_VERSION,
  TIME,
  OFFSCREEN_RUNTIME,
  CAMERA_RUNTIME,
  CAMERA_QUALITY_SAMPLING,
  CAMERA_QUALITY_THRESHOLDS,
  FACE_PIPELINE_RUNTIME,
  FACE_LANDMARKER_RUNTIME,
  FACE_LANDMARK_INDICES,
  FACE_GEOMETRY_RUNTIME,
  EYE_GEOMETRY_RUNTIME,
  HEAD_POSE_RUNTIME,
  FACE_POSITION_THRESHOLDS,
  PRE_CALIBRATION_RUNTIME,
  FACE_QUALITY_THRESHOLDS,
  FACE_QUALITY_RUNTIME,
  BLINK_THRESHOLDS,
  GAZE_ENGINE_DEFAULTS,
  GAZE_OVERLAY,
  QUICK_RECALIBRATION,
  ONNX_RUNTIME_WEB,
  L2CS_GAZE_MODEL,
  WEB_EYE_TRACK_RUNTIME,
  GAZE_QUALITY_THRESHOLDS,
  GAZE_QUALITY_RUNTIME,
  GAZE_VALIDATION_DEFAULTS,
  DEEP_PERSONALIZATION,
  GAZE_RUNTIME_DEFAULTS,
  GAZE_FILTER_DEFAULTS,
  CALIBRATION,
  CALIBRATION_VALIDATION_THRESHOLDS,
  DRIFT_THRESHOLDS,
  RUNTIME_MAINTENANCE,
  NORMALIZED_COORDINATE,
  NUMERIC_EPSILON,
  PAGE_TRACKING,
  AOI,
  NAVIGATION,
  FIXATION_DEFAULTS,
  DATABASE,
  STORAGE_BATCH,
  LOGGING,
  RUNTIME_LIMITS,
  isRecord,
  isFiniteNumber,
  isNullableFiniteNumber,
  isNullableString,
  isNonEmptyString,
  nowEpochMs,
  nowTimelineMs,
  sleep,
  createSessionId,
  createPageId,
  createFixationId,
  createCalibrationId,
  createMessageId,
  clamp01,
  distance2D,
  isNormalizedPoint,
  truncateString,
  isHttpOrHttpsUrl,
  ERROR_CODES,
  TrackerError,
  isTrackerErrorCode,
  isTrackerError,
  getUnknownErrorMessage,
  normalizeTrackerError,
  normalizeCameraError,
  DEFAULT_CAMERA_REQUEST,
  isCameraRequest,
  isCameraSettings,
  createCameraConstraints,
  readActualCameraSettings
};
//# sourceMappingURL=chunk-6TH637DM.js.map
