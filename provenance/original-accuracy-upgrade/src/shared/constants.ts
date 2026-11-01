/**
 * Central constants for the Webcam Eye Tracker extension.
 *
 * IMPORTANT
 * ---------
 * 1. Avoid magic numbers in feature modules.
 * 2. Runtime-tunable values should originate from this file.
 * 3. These are development defaults, not experimentally validated constants.
 * 4. Research-specific thresholds may be adjusted after pilot validation.
 */

import type {
  CalibrationCorrectionStrategy
} from "./types";

/* ==========================================================================
 * Project / schema
 * ======================================================================== */

export const APP_NAME = "Webcam Eye Tracker" as const;

export const SCHEMA_VERSION = 2 as const;

export const TRACKER_VERSION = "0.1.0" as const;

/* ==========================================================================
 * Time
 * ======================================================================== */

export const TIME = {
  MS_PER_SECOND: 1_000,
  MS_PER_MINUTE: 60_000
} as const;

/* ==========================================================================
 * Offscreen runtime
 * ======================================================================== */

/**
 * Chrome Offscreen Document lifecycle defaults.
 *
 * The background service worker owns creation/health checks while the
 * Offscreen Document owns the long-lived camera/model runtime itself.
 */
export const OFFSCREEN_RUNTIME = {
  DOCUMENT_PATH: "offscreen/offscreen.html",

  CREATE_JUSTIFICATION:
    "Keeps the local webcam eye-tracking runtime alive outside content pages.",

  HEALTH_CHECK_TIMEOUT_MS: 1_500,
  HEALTH_CHECK_MAX_ATTEMPTS: 12,
  HEALTH_CHECK_RETRY_DELAY_MS: 150,
  BOOTSTRAP_GRACE_MS: 250,
  STALE_CONTEXT_RECOVERY_ATTEMPTS: 1
} as const;

/* ==========================================================================
 * Camera
 * ======================================================================== */

/**
 * Preferred webcam configuration.
 *
 * These values are requests to getUserMedia(), not guarantees.
 * The actual camera settings must always be read back from MediaStreamTrack.
 */
export const CAMERA_DEFAULTS = {
  WIDTH: 640,
  HEIGHT: 480,

  FRAME_RATE: 30,

  FACING_MODE: "user"
} as const;

/**
 * Camera startup/runtime behavior.
 */
export const CAMERA_RUNTIME = {
  VIDEO_READY_TIMEOUT_MS: 8_000
} as const;

/**
 * Down-sampled frame size and rolling window used for runtime camera-quality
 * estimation. Pixel buffers are transient and are never persisted.
 */
export const CAMERA_QUALITY_SAMPLING = {
  WIDTH: 160,
  HEIGHT: 120,

  FPS_WINDOW_SIZE: 30,
  MIN_FPS_SAMPLE_COUNT: 5
} as const;

/**
 * Minimum runtime camera quality expectations.
 */
export const CAMERA_QUALITY_THRESHOLDS = {
  MIN_ACCEPTABLE_FPS: 20,

  /**
   * Brightness metrics will later be normalized to 0..1.
   */
  MIN_BRIGHTNESS: 0.18,
  MAX_BRIGHTNESS: 0.92,

  MIN_SHARPNESS: 0.15
} as const;

/* ==========================================================================
 * Face analysis pipeline
 * ======================================================================== */

/**
 * Runtime orchestration controls for continuous face analysis.
 *
 * Chrome Offscreen Documents are not guaranteed to participate in normal
 * compositor-driven video presentation, so requestVideoFrameCallback() must
 * not be the only scheduler for the research pipeline. Face analysis uses a
 * timer-driven cadence against the live MediaStream-backed video element.
 * Repeated recoverable errors are throttled before they cross the
 * Offscreen -> Background bridge.
 */
export const FACE_PIPELINE_RUNTIME = {
  TARGET_ANALYSIS_RATE_HZ: 30,
  ERROR_REPORT_THROTTLE_MS: 2_000,
  POSITION_STATUS_BROADCAST_INTERVAL_MS: 200
} as const;

/* ==========================================================================
 * MediaPipe Face Landmarker
 * ======================================================================== */

/**
 * Local-only MediaPipe Face Landmarker runtime configuration.
 *
 * The public/ directory is expected to be copied to the extension bundle
 * root, so these paths resolve to:
 * - <extension-root>/wasm
 * - <extension-root>/models/face_landmarker.task
 */
export const FACE_LANDMARKER_RUNTIME = {
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
  MIN_TIMESTAMP_INCREMENT_MS: 0.001
} as const;

/* ==========================================================================
 * Face geometry landmarks
 * ======================================================================== */

/**
 * MediaPipe Face Landmarker landmark indices used by geometry/eye modules.
 *
 * These values mirror the canonical Face Landmarker topology but are kept in
 * shared constants so downstream modules do not depend directly on
 * @mediapipe/tasks-vision. Left/right labels follow MediaPipe's anatomical
 * convention and are not swapped for visually mirrored previews.
 */
export const FACE_LANDMARK_INDICES = {
  NOSE_TIP: 1,
  FOREHEAD_TOP: 10,
  CHIN: 152,
  RIGHT_CHEEK: 234,
  LEFT_CHEEK: 454,

  LEFT_EYE_CONTOUR: [
    263, 249, 390, 373, 374, 380, 381, 382,
    362, 466, 388, 387, 386, 385, 384, 398
  ],

  RIGHT_EYE_CONTOUR: [
    33, 7, 163, 144, 145, 153, 154, 155,
    133, 246, 161, 160, 159, 158, 157, 173
  ],

  LEFT_IRIS: [
    474, 475, 476, 477
  ],

  RIGHT_IRIS: [
    469, 470, 471, 472
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
    10, 338, 297, 332, 284, 251, 389, 356, 454,
    323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132,
    93, 234, 127, 162, 21, 54, 103, 67, 109
  ]
} as const;

/**
 * Numerical guards for face geometry calculations.
 */
export const FACE_GEOMETRY_RUNTIME = {
  MIN_NORMALIZED_DIMENSION: 1e-6,
  MIN_PIXEL_DISTANCE: 1
} as const;


/**
 * Numerical guards for eye geometry calculations.
 *
 * The blink detector consumes `lidOpeningRatio`, while gaze engines may use
 * the iris offsets. These values only guard degenerate geometry; they are not
 * behavioral thresholds.
 */
export const EYE_GEOMETRY_RUNTIME = {
  MIN_EYE_WIDTH_PX: 4,
  MIN_IRIS_DIAMETER_PX: 1,
  MIN_AXIS_LENGTH_PX: 1e-6
} as const;

/* ==========================================================================
 * Head pose
 * ======================================================================== */

/**
 * Numerical guards for extracting head rotation from MediaPipe's facial
 * transformation matrix and for the landmark-only fallback path.
 *
 * MediaPipe serializes MatrixData in column-major order by default. The
 * facial transformation matrix contains uniform scale, rotation and
 * translation; only the rotation component is consumed by headPose.ts.
 */
export const HEAD_POSE_RUNTIME = {
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
} as const;

/* ==========================================================================
 * Face positioning
 * ======================================================================== */

/**
 * Initial pre-calibration face-position thresholds.
 *
 * These are deliberately centralized because they will likely need
 * adjustment during pilot testing.
 */
export const FACE_POSITION_THRESHOLDS = {
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
  REQUIRED_STABLE_DURATION_MS: 1_000
} as const;

/**
 * Runtime controls for robust pre-calibration baseline capture.
 *
 * The baseline is estimated from multiple stable frames rather than from a
 * single webcam frame. Only compact geometry/head-pose values are retained.
 */
export const PRE_CALIBRATION_RUNTIME = {
  MIN_BASELINE_SAMPLE_COUNT: 10,
  MAX_BASELINE_SAMPLE_COUNT: 90
} as const;

/* ==========================================================================
 * Face / eye validity
 * ======================================================================== */

export const FACE_QUALITY_THRESHOLDS = {
  MIN_FACE_CONFIDENCE: 0.65,
  MIN_EYE_CONFIDENCE: 0.60,

  GOOD_QUALITY_SCORE: 0.80,
  FAIR_QUALITY_SCORE: 0.60,
  POOR_QUALITY_SCORE: 0.35
} as const;

/**
 * Runtime heuristics used by faceQuality.ts.
 *
 * These are intentionally centralized development defaults. They describe
 * structural/geometry confidence proxies, not MediaPipe model probabilities.
 */
export const FACE_QUALITY_RUNTIME = {
  EXPECTED_LANDMARK_COUNT: 478,

  FACE_CONFIDENCE_GEOMETRY_WEIGHT: 0.55,
  FACE_CONFIDENCE_POSE_WEIGHT: 0.35,
  FACE_CONFIDENCE_MATRIX_BONUS: 0.10,

  SINGLE_EYE_GEOMETRY_WEIGHT: 0.50,
  IMPLAUSIBLE_EYE_SCORE_MULTIPLIER: 0.60,

  EYE_HORIZONTAL_POSITION_MIN: -0.25,
  EYE_HORIZONTAL_POSITION_MAX: 1.25,
  EYE_MAX_ABS_VERTICAL_OFFSET_RATIO: 0.75,
  EYE_MIN_IRIS_TO_EYE_WIDTH_RATIO: 0.08,
  EYE_MAX_IRIS_TO_EYE_WIDTH_RATIO: 0.70,

  FACE_SCORE_WEIGHT: 0.30,
  EYE_SCORE_WEIGHT: 0.30,
  HEAD_POSE_SCORE_WEIGHT: 0.20,
  POSITION_SCORE_WEIGHT: 0.10,
  CAMERA_SCORE_WEIGHT: 0.10,

  FALLBACK_POSE_SCORE_MULTIPLIER: 0.85,
  BLINK_SCORE_MULTIPLIER: 0.10,
  ASYMMETRIC_CLOSURE_SCORE_MULTIPLIER: 0.50,

  CAMERA_GOOD_SCORE: 1.0,
  CAMERA_FAIR_SCORE: 0.75,
  CAMERA_POOR_SCORE: 0.35,
  CAMERA_INVALID_SCORE: 0.0,

  /**
   * Absolute pre-calibration face-size guards used before a participant
   * baseline exists. Ratios are relative to the camera frame.
   */
  MIN_PRECALIBRATION_FACE_WIDTH_RATIO: 0.20,
  MAX_PRECALIBRATION_FACE_WIDTH_RATIO: 0.62,
  MIN_PRECALIBRATION_FACE_HEIGHT_RATIO: 0.28,
  MAX_PRECALIBRATION_FACE_HEIGHT_RATIO: 0.82
} as const;

/* ==========================================================================
 * Blink
 * ======================================================================== */

/**
 * Initial blink thresholds for EyeGeometry.lidOpeningRatio.
 *
 * They are centralized defaults rather than universal physiological values;
 * pilot data may later justify participant-specific or device-specific
 * thresholds without changing the detector state machine.
 */
export const BLINK_THRESHOLDS = {
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
} as const;

/* ==========================================================================
 * Gaze
 * ======================================================================== */
export const GAZE_ENGINE_DEFAULTS = {
  PRIMARY: "WEB_EYE_TRACK",
  FALLBACK: "RIDGE"
} as const;

/**
 * Development/user-facing visualization of the final stabilized gaze point.
 * This overlay is display-only and must never modify or replace research
 * gaze data, AOI resolution, calibration samples or persisted records.
 */
export const GAZE_OVERLAY = {
  STORAGE_KEY: "etc.gazeOverlayEnabled.v1",
  DEFAULT_ENABLED: false,
  DIAMETER_PX: 42,
  SMOOTHING_ALPHA: 0.32,
  STALE_HIDE_DELAY_MS: 180,
  Z_INDEX: 2_147_483_647
} as const;

/**
 * User-facing automatic quick-recalibration preference. Runtime drift/precision
 * diagnostics remain active when disabled, but they must not interrupt data
 * collection or open the 5-point maintenance UI. Disabled by default so a
 * stable research session is never interrupted without an explicit opt-in.
 */
export const QUICK_RECALIBRATION = {
  STORAGE_KEY: "etc.quickRecalibrationEnabled.v1",
  DEFAULT_ENABLED: false,
  // Recovery if Content crashes, disconnects, or never reports a failed point.
  MAX_RUN_DURATION_MS: 5 * 60_000
} as const;

/**
 * Pinned local WebEyeTrack vendor/runtime metadata.
 *
 * The upstream runtime and BlazeGaze model are provisioned during development
 * by `npm run vendor:webeyetrack` and packaged with the extension. Tracking
 * must never download them at runtime.
 */
/**
 * Pinned local ONNX Runtime Web assets.
 *
 * These files are provisioned during development with
 * `npm run vendor:onnxruntime` and copied into the extension package.
 * Runtime inference must never fetch ORT code or WASM from a CDN.
 */
export const ONNX_RUNTIME_WEB = {
  PACKAGE_VERSION: "1.29.0",

  MODULE_ASSET_PATH:
    "vendor/onnxruntime/ort.webgpu.bundle.min.mjs",

  WASM_BASE_ASSET_PATH:
    "wasm/onnxruntime/",

  WASM_ASSET_PATH:
    "wasm/onnxruntime/ort-wasm-simd-threaded.wasm",

  WEBGPU_WASM_ASSET_PATH:
    "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.wasm",

  /**
   * Keep WASM single-threaded until the extension runtime explicitly proves
   * that SharedArrayBuffer/cross-origin isolation is available. This avoids
   * making high-performance threading a hidden startup requirement.
   */
  DEFAULT_WASM_THREADS: 1,

  PREFERRED_EXECUTION_PROVIDERS: [
    "webgpu",
    "wasm"
  ] as const
} as const;

/**
 * Research prototype contract for the L2CS-Net ResNet-50 Gaze360 checkpoint.
 *
 * The ONNX file is intentionally NOT distributed with this project because
 * the Gaze360 dataset/model license restricts redistribution and commercial
 * use. Researchers provision the official checkpoint locally and export the
 * deterministic ONNX contract with `npm run export:l2cs`.
 */
export const L2CS_GAZE_MODEL = {
  MODEL_ASSET_PATH:
    "models/l2cs/l2cs_resnet50_gaze360.onnx",

  CONTRACT_ASSET_PATH:
    "models/l2cs/l2cs_resnet50_gaze360.contract.json",

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
  ] as const,

  IMAGE_NET_STD: [
    0.229,
    0.224,
    0.225
  ] as const,

  EXECUTION_PROVIDERS: [
    "webgpu",
    "wasm"
  ] as const
} as const;

export const WEB_EYE_TRACK_RUNTIME = {
  PACKAGE_VERSION: "0.0.2",
  UPSTREAM_COMMIT:
    "75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c",

  MODEL_BASE_ASSET_PATH:
    "models/webeyetrack",

  MODEL_JSON_ASSET_PATH:
    "models/webeyetrack/web/model.json",

  MODEL_WEIGHT_ASSET_PATH:
    "models/webeyetrack/web/group1-shard1of1.bin"
} as const;

export const GAZE_QUALITY_THRESHOLDS = {
  GOOD: 0.80,
  FAIR: 0.60,
  POOR: 0.35,

  /**
   * Samples below this value are invalid by default.
   */
  MIN_VALID: 0.35
} as const;

/**
 * Runtime weights for final gaze-quality scoring.
 *
 * `FACE_PIPELINE_WEIGHT` consumes FaceQualityFrameResult.trackingQuality
 * .qualityScore, which already combines face confidence, eye confidence,
 * head pose, face positioning, camera quality and blink penalties. Keeping
 * that composite intact avoids double-counting the same upstream signals.
 */
export const GAZE_QUALITY_RUNTIME = {
  ENGINE_CONFIDENCE_WEIGHT: 0.55,
  FACE_PIPELINE_WEIGHT: 0.45
} as const;

/**
 * Structural/raw-output validation guards.
 *
 * `NORMALIZED` gaze is intentionally allowed to fall outside the viewport
 * range 0..1 because a raw estimator may legitimately predict a point just
 * beyond the visible screen. Only extreme values beyond this overscan margin
 * are rejected as implausible model output. These are development guards,
 * not experimentally validated accuracy thresholds.
 */
export const GAZE_VALIDATION_DEFAULTS = {
  NORMALIZED_OVERSCAN_MARGIN: 0.5,
  TIMESTAMP_TOLERANCE_MS: 1
} as const;

/**
 * Runtime output rate.
 *
 * This does not force the camera to run at exactly this rate.
 * It controls how frequently the pipeline should attempt to emit gaze data.
 */
/**
 * Participant-specific deep screen-mapping defaults.
 *
 * These are research/prototype hyperparameter candidates rather than claimed
 * universal optima. The final mapper is selected with grouped leave-one-point-
 * out cross-validation and still must pass independent validation.
 */
export const DEEP_PERSONALIZATION = {
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
  CALIBRATION_DEEP_GRACE_MS: 1_250,
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
  DRIFT_MONITOR_POST_VALIDATION_WARMUP_MS: 1_500,

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
  RUNTIME_AGGREGATION_MAX_HEAD_DELTA_DEG: 4.0,
  RUNTIME_AGGREGATION_MAX_FACE_CENTER_DELTA: 0.035,
  RUNTIME_AGGREGATION_MAX_DISTANCE_DELTA: 0.08,

  /**
   * Live temporal alignment has a substantially tighter hard source-age cap
   * than independent-validation target dwell. This prevents a valid but old
   * L2CS result from being transported indefinitely through the live stream.
   */
  LIVE_DEEP_MAX_SOURCE_AGE_MS: 1_200,

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
  VALIDATION_DEEP_MAX_DWELL_MS: 2_500,
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
  HYBRID_MIN_DEEP_WEIGHT: 0.20,
  HYBRID_MAX_DEEP_WEIGHT: 0.80,

  /**
   * Deep confidence is used only as a conservative reliability penalty. High
   * confidence does not earn an optimistic bonus; low confidence can only
   * increase the expected deep error and therefore reduce its fusion weight.
   */
  HYBRID_DEEP_CONFIDENCE_REFERENCE: 0.70,
  HYBRID_DEEP_CONFIDENCE_FLOOR: 0.55,
  HYBRID_MAX_CONFIDENCE_ERROR_MULTIPLIER: 1.35,

  /**
   * Geometry drift does not pick a winner. Instead, it reduces trust in the
   * direction-specific calibration prior and smoothly backs off toward the
   * global grouped-CV prior. This prevents a changed head/device pose from
   * causing overconfident directional routing.
   */
  HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY: 0.55,
  HYBRID_DRIFT_HEAD_SOFT_DEG: 2.0,
  HYBRID_DRIFT_HEAD_HARD_DEG: 10.0,
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
  HYBRID_STABILITY_SOFT_RATIO: 0.30,
  HYBRID_STABILITY_HARD_RATIO: 0.90,
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
  ] as const,

  RBF_RIDGE_LAMBDAS: [
    0.01,
    0.1
  ] as const,

  RBF_GAMMA_SCALES: [
    0.5,
    1,
    2
  ] as const,

  /** Deterministic Random-Fourier approximation to the RBF mapper. */
  RFF_RIDGE_LAMBDAS: [
    0.01,
    0.1,
    1
  ] as const,
  RFF_GAMMA_SCALES: [
    0.5,
    1,
    2
  ] as const,
  RFF_FEATURE_COUNT: 64,

  /** Rolling target-free precision estimates used by live hybrid routing. */
  BASELINE_PRECISION_WINDOW_MS: 420,
  BASELINE_PRECISION_MIN_SAMPLES: 5,
  DEEP_PRECISION_WINDOW_MS: 1_600,
  DEEP_PRECISION_MIN_SAMPLES: 3,
  PRECISION_MAX_FIXATION_SPEED_PX_PER_SECOND: 520
} as const;

export const GAZE_RUNTIME_DEFAULTS = {
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
} as const;

/* ==========================================================================
 * Gaze filtering
 * ======================================================================== */

/**
 * Exponential smoothing defaults intended primarily for visualization.
 *
 * Research raw/corrected gaze must remain stored independently.
 */
export const GAZE_FILTER_DEFAULTS = {
  /**
   * One-Euro display filter defaults. Coordinates are viewport pixels, so
   * beta is deliberately small and must be tuned from pilot jitter/latency.
   */
  ONE_EURO_MIN_CUTOFF_HZ: 1.0,
  ONE_EURO_BETA: 0.004,
  ONE_EURO_DERIVATIVE_CUTOFF_HZ: 1.0,

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
} as const;

/* ==========================================================================
 * Calibration
 * ======================================================================== */

export const CALIBRATION = {
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
  CORRECTION_STRATEGY:
    "PROJECT_RESIDUAL_ONLY" as CalibrationCorrectionStrategy,

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
  DEGRADED_COLLECTION_WARNING_MS: 3_000,

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
  SAMPLE_WINDOW_MAX_MS: 1_200,

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
  STABILITY_ADAPTIVE_MAX_WINDOW_MS: 1_000,
  STABILITY_ADAPTIVE_WINDOW_MARGIN: 1.35,
  STABILITY_ADAPTIVE_FRAME_GAP_MULTIPLIER: 2.5,
  STABILITY_ADAPTIVE_MAX_FRAME_GAP_MS: 350,
  STABILITY_CADENCE_MAX_INTERVAL_MS: 1_000,

  /**
   * Calibration-only robust spike rejection performed before stability
   * scoring. It never uses the target coordinate, so it cannot pull gaze
   * toward the expected answer; it only removes isolated prediction spikes.
   */
  STABILITY_PREFILTER_MAD_SCALE: 3.5,
  STABILITY_PREFILTER_MIN_RADIUS_NORMALIZED: 0.020,
  STABILITY_PREFILTER_MIN_INLIER_RATIO: 0.60,

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
  STABILITY_MAX_FACE_DISTANCE_SPAN_RATIO: 0.10,

  /**
   * Calibration-only baseline drift guard. Head pose is already a BlazeGaze
   * input; these limits are therefore used as a quality gate rather than as a
   * second corrective gaze model.
   */
  BASELINE_MAX_YAW_DELTA_DEG: 12,
  BASELINE_MAX_PITCH_DELTA_DEG: 12,
  BASELINE_MAX_ROLL_DELTA_DEG: 10,
  BASELINE_MAX_FACE_CENTER_DELTA_NORMALIZED: 0.09,
  BASELINE_MAX_FACE_DISTANCE_DELTA_RATIO: 0.20,

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
  POINT_TIMEOUT_MS: 3_000,

  /**
   * Cross-device collection protection. The collector keeps the ordinary
   * 3 s budget on healthy hosts, but may extend a point when the observed
   * baseline gaze cadence is low. Quality/stability thresholds are unchanged.
   */
  POINT_TIMEOUT_MEDIUM_FPS_MS: 3_500,
  POINT_TIMEOUT_LOW_FPS_MS: 5_000,
  POINT_TIMEOUT_MEDIUM_FPS_THRESHOLD_HZ: 20,
  POINT_TIMEOUT_LOW_FPS_THRESHOLD_HZ: 10,

  /**
   * Maximum proportion of rejected frames before the point should
   * be considered unreliable.
   */
  MAX_REJECTION_RATIO: 0.70,

  /**
   * Keep calibration targets away from the exact browser viewport edge.
   * This reduces clipping and makes targets easier to fixate.
   */
  TARGET_MARGIN_RATIO: 0.08,

  /**
   * Calibration uses a stricter quality floor than ordinary gaze recording.
   */
  MIN_SAMPLE_QUALITY: 0.60,

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
  RESIDUAL_QUADRATIC_RIDGE_LAMBDAS: [1e-3, 5e-3, 2e-2] as const,
  RESIDUAL_RBF_GAMMAS: [2, 8, 24] as const,
  RESIDUAL_RBF_RIDGE_LAMBDAS: [1e-3, 5e-3, 2e-2] as const,
  RESIDUAL_CV_P95_WEIGHT: 0.35,
  RESIDUAL_QUADRATIC_COMPLEXITY_PENALTY: 0.0006,
  RESIDUAL_RBF_COMPLEXITY_PENALTY: 0.0012,
  RESIDUAL_NONLINEAR_MIN_CV_IMPROVEMENT: 0.0015,

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
} as const;

/* ==========================================================================
 * Calibration validation
 * ======================================================================== */

/**
 * Initial validation categories in pixels.
 *
 * These are development defaults only.
 * Final thresholds should be calibrated against:
 * - screen resolution
 * - viewing distance
 * - webcam quality
 * - actual participant performance
 *
 * The validation module should retain the raw numeric error regardless
 * of the resulting category.
 */
export const CALIBRATION_VALIDATION_THRESHOLDS = {
  /**
   * Production-oriented READY gate using CSS viewport-width ratios.
   *
   * Ratios are intentionally preferred over fixed pixel thresholds because
   * browser zoom and display resolution change CSS pixel counts. They are
   * still only a screen-relative proxy, not degrees of visual angle. A true
   * degree conversion requires measured physical display geometry and viewing
   * distance, which the browser cannot infer reliably.
   */
  GOOD_MAX_MEAN_ERROR_WIDTH_RATIO: 0.030,
  GOOD_MAX_P95_ERROR_WIDTH_RATIO: 0.050,
  GOOD_MAX_MEAN_PRECISION_WIDTH_RATIO: 0.020,
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

  POOR_MAX_MEAN_ERROR_WIDTH_RATIO: 0.060,
  POOR_MAX_P95_ERROR_WIDTH_RATIO: 0.100,
  POOR_MAX_MEAN_PRECISION_WIDTH_RATIO: 0.050,
  POOR_MAX_P95_PRECISION_WIDTH_RATIO: 0.080,
  POOR_MIN_VALID_SAMPLE_RATIO: 0.60,

  /** Catastrophic safety cap independent of viewport-ratio classification. */
  ABSOLUTE_MAX_P95_ERROR_PX: 300
} as const;

/* ==========================================================================
 * Drift
 * ======================================================================== */

export const DRIFT_THRESHOLDS = {
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
  QUICK_RECALIBRATION_COOLDOWN_MS: 2 * 60_000,

  /** Persistence guards so transient posture changes do not trigger drift. */
  HIGH_PERSIST_MS: 900,
  QUICK_RECALIBRATION_HIGH_PERSIST_MS: 4_000,
  QUICK_RECALIBRATION_MEDIUM_PERSIST_MS: 12_000
} as const;

/**
 * Runtime maintenance guards. These values do not change calibration targets
 * or validation thresholds; they only decide when target-free runtime data is
 * considered too far outside the calibrated pose distribution to store.
 */
export const RUNTIME_MAINTENANCE = {
  /** Missing observations cannot prove sustained drift (independent of wall-clock maintenance). */
  MAX_CONTINUOUS_OBSERVATION_GAP_MS: 1_500,
  MEDIUM_DRIFT_QUALITY_MULTIPLIER: 0.72,
  HIGH_DRIFT_QUALITY_MULTIPLIER: 0.35,
  SUSPEND_COLLECTION_ON_RECALIBRATION_RECOMMENDATION: true,

  QUICK_FAILURE_LIMIT_BEFORE_FULL_CALIBRATION: 2,
  QUICK_REPEAT_LIMIT_BEFORE_FULL_CALIBRATION: 2,
  QUICK_REPEAT_WINDOW_MS: 5 * 60_000,

  /**
   * V7-B: target-free precision reference is learned only from early
   * fixation-like windows after independent validation. This follows the
   * mobile/iPad-style principle of continuously checking that the face/gaze
   * state remains close to the calibrated operating envelope.
   */
  PRECISION_REFERENCE_MIN_SAMPLES: 8,
  PRECISION_REFERENCE_TARGET_SAMPLES: 16,
  PRECISION_REFERENCE_MIN_CAPTURE_MS: 8_000,
  PRECISION_REFERENCE_MAX_CAPTURE_MS: 30_000,
  PRECISION_REFERENCE_MIN_QUALITY: 0.60,

  /** Relative precision deterioration versus the participant's own baseline. */
  PRECISION_LOW_RATIO: 1.35,
  PRECISION_MEDIUM_RATIO: 1.75,
  PRECISION_HIGH_RATIO: 2.50,

  /** Absolute viewport-normalized dispersion guards for poor initial baselines. */
  PRECISION_MEDIUM_VIEWPORT_WIDTH_RATIO: 0.028,
  PRECISION_HIGH_VIEWPORT_WIDTH_RATIO: 0.045,

  /** Persistence guards prevent a single noisy fixation from triggering UI. */
  PRECISION_HIGH_PERSIST_MS: 5_000,
  PRECISION_MEDIUM_PERSIST_MS: 15_000,

  /** Do not interrupt the first minute of an otherwise valid tracking run. */
  AUTO_QUICK_RECALIBRATION_MIN_MONITORING_MS: 60_000,

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
  PERIODIC_MAINTENANCE_INTERVAL_MS: 20 * 60_000,

  /**
   * Apple exposes gaze-pointer smoothing to trade responsiveness for stability.
   * We apply a bounded automatic boost only to the derived stabilized stream;
   * raw/calibration/validation coordinates are never altered by this setting.
   */
  ADAPTIVE_SMOOTHING_START_RATIO: 1.35,
  ADAPTIVE_SMOOTHING_GAIN: 0.55,
  ADAPTIVE_SMOOTHING_MAX_MULTIPLIER: 2.0,

  LONGITUDINAL_MILESTONES_MS: [0, 2 * 60_000, 5 * 60_000, 10 * 60_000] as const
} as const;

/* ==========================================================================
 * Coordinates
 * ======================================================================== */

export const NORMALIZED_COORDINATE = {
  MIN: 0,
  CENTER: 0.5,
  MAX: 1
} as const;

/**
 * Small epsilon used for numerical comparisons.
 */
export const NUMERIC_EPSILON = 1e-9;

/* ==========================================================================
 * AOI
 * ======================================================================== */

/* ==========================================================================
 * Page / scroll tracking
 * ======================================================================== */

export const PAGE_TRACKING = {
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
} as const;

export const AOI = {
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
} as const;

/* ==========================================================================
 * Pointer / mouse
 * ======================================================================== */

export const POINTER_TRACKING = {
  /**
   * Mouse movement is sampled/throttled to avoid writing every raw
   * browser mousemove event.
   */
  SAMPLE_INTERVAL_MS: 16,

  IDLE_THRESHOLD_MS: 1_000,

  MIN_MOVEMENT_DISTANCE_PX: 0.5
} as const;

/* ==========================================================================
 * Scroll
 * ======================================================================== */

export const SCROLL_TRACKING = {
  SAMPLE_INTERVAL_MS: 16,

  /**
   * Delay with no scroll events before a scroll sequence is marked END.
   */
  END_DEBOUNCE_MS: 150
} as const;

/* ==========================================================================
 * Navigation
 * ======================================================================== */

export const NAVIGATION = {
  /**
   * Maximum time to retain temporary opener/new-tab association data.
   */
  TAB_ASSOCIATION_TTL_MS: 30_000,

  /**
   * Prevent duplicate page lifecycle events caused by multiple
   * navigation signals arriving almost simultaneously.
   */
  EVENT_DEDUPLICATION_WINDOW_MS: 100
} as const;

/* ==========================================================================
 * Fixation
 * ======================================================================== */

/**
 * Initial I-DT configuration.
 *
 * The raw gaze remains available, so these can later be changed and
 * fixations recalculated without recollecting the experiment.
 */
export const FIXATION_DEFAULTS = {
  MIN_DURATION_MS: 100,

  DISPERSION_THRESHOLD_PX: 80,

  MIN_SAMPLE_COUNT: 3,

  MAX_SAMPLE_GAP_MS: 100
} as const;

/* ==========================================================================
 * Storage
 * ======================================================================== */

export const DATABASE = {
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
} as const;

/**
 * IndexedDB batch-write configuration.
 */
export const STORAGE_BATCH = {
  GAZE_MAX_ITEMS: 60,
  EVENT_MAX_ITEMS: 100,

  /**
   * Flush even if a batch has not reached its maximum size.
   */
  MAX_FLUSH_INTERVAL_MS: 1_000,

  /**
   * Buffer should always be flushed during STOPPING/page shutdown paths.
   */
  FLUSH_ON_STOP: true
} as const;

/* ==========================================================================
 * Upload / network
 * ======================================================================== */

export const NETWORK = {
  REQUEST_TIMEOUT_MS: 15_000,

  RETRY: {
    INITIAL_DELAY_MS: 1_000,
    MAX_DELAY_MS: 60_000,

    BACKOFF_MULTIPLIER: 2,

    MAX_ATTEMPTS: 8
  }
} as const;

/* ==========================================================================
 * Runtime messaging
 * ======================================================================== */

export const MESSAGING = {
  /**
   * Default timeout for request/response-style internal messages.
   */
  REQUEST_TIMEOUT_MS: 10_000
} as const;

/* ==========================================================================
 * Logging
 * ======================================================================== */

export const LOGGING = {
  ENABLE_DEBUG_LOGS: false,

  MAX_SERIALIZED_DETAILS_LENGTH: 4_000
} as const;

/* ==========================================================================
 * Privacy
 * ======================================================================== */

/**
 * Privacy-sensitive defaults.
 *
 * Raw webcam frames and image crops must never become persistent storage
 * simply because debug mode is enabled.
 */
export const PRIVACY_DEFAULTS = {
  STORE_WEBCAM_FRAMES: false,
  STORE_FACE_IMAGES: false,
  STORE_EYE_CROPS: false,
  STORE_FULL_FACE_LANDMARKS: false,

  DEFAULT_TEXT_STORAGE_POLICY: "HASHED"
} as const;

/* ==========================================================================
 * Limits
 * ======================================================================== */

export const RUNTIME_LIMITS = {
  MAX_DIAGNOSTIC_DETAILS_DEPTH: 5,

  MAX_AOI_TEXT_LENGTH: 250,

  MAX_URL_LENGTH: 8_192
} as const;