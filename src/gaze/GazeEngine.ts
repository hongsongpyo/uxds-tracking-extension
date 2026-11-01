import type {
  CameraFrameView
} from "../camera/frameCapture";

import type {
  BlinkFrameResult
} from "../face/blinkDetector";

import type {
  EyeGeometryFrameResult
} from "../face/eyeGeometry";

import type {
  FaceGeometryFrameResult
} from "../face/faceGeometry";

import type {
  FaceLandmarkerFrameResult
} from "../face/faceLandmarker";

import type {
  FaceQualityFrameResult
} from "../face/faceQuality";

import type {
  HeadPoseFrameResult
} from "../face/headPose";

import type {
  GazeEngineSource,
  GazePrediction
} from "../shared/types";

/* ========================================================================== 
 * Gaze-engine frame input
 * ======================================================================== */

/**
 * Transient runtime input for one gaze-estimation attempt.
 *
 * IMPORTANT:
 * - This object is not a persistent research record.
 * - `frame` exposes the live HTMLVideoElement for the current inference step;
 *   consumers must not retain, serialize or store the webcam frame.
 * - All face/eye results are expected to describe the same camera frame as
 *   `frame.metadata.frameSequence` and `frame.metadata.timestampMs`.
 * - Browser/page/viewport state intentionally does not belong here. A gaze
 *   engine returns its native raw coordinate space and downstream modules
 *   perform calibration and coordinate mapping.
 */
export interface GazeEngineFrameInput {
  readonly frame: CameraFrameView;

  /**
   * Raw MediaPipe-independent landmark result for the same camera frame.
   *
   * Gaze backends such as WebEyeTrack need the full landmark geometry and
   * facial transformation matrix to build their transient model input. This
   * data remains runtime-only and must not be persisted by a gaze engine.
   */
  readonly landmarker:
    FaceLandmarkerFrameResult;

  readonly faceGeometry:
    FaceGeometryFrameResult;

  readonly headPose:
    HeadPoseFrameResult;

  readonly eyeGeometry:
    EyeGeometryFrameResult;

  readonly blink:
    BlinkFrameResult;

  readonly faceQuality:
    FaceQualityFrameResult;
}

/* ========================================================================== 
 * Gaze-engine lifecycle
 * ======================================================================== */

export type GazeEngineLifecycle =
  | "CREATED"
  | "INITIALIZING"
  | "READY"
  | "ERROR"
  | "DISPOSED";

/**
 * Minimal implementation-independent runtime state.
 *
 * Engine-specific diagnostics remain inside each adapter so the rest of the
 * application does not become coupled to WebEyeTrack, Ridge, ONNX, etc.
 */
export interface GazeEngineSnapshot {
  readonly source: GazeEngineSource;

  readonly lifecycle:
    GazeEngineLifecycle;

  readonly initialized: boolean;

  readonly lastPredictionTimestampMs:
    number | null;
}

/* ========================================================================== 
 * Optional runtime feature capability
 * ======================================================================== */

/**
 * Transient deep representation associated with one accepted model frame.
 *
 * These values are runtime-only by default. They are exposed so the later
 * participant-specific mapper can build calibration features without making
 * the base GazeEngine contract depend on a specific deep architecture.
 */
export interface GazeFeatureSnapshot {
  readonly frameSequence: number;
  readonly timestampMs: number;
  readonly values: Float32Array;
}

export interface GazeFeatureProvider {
  getLatestFeatureSnapshot():
    GazeFeatureSnapshot | null;
}

export function isGazeFeatureProvider(
  engine: GazeEngine
): engine is GazeEngine & GazeFeatureProvider {
  return (
    "getLatestFeatureSnapshot" in engine
    && typeof (
      engine as Partial<GazeFeatureProvider>
    ).getLatestFeatureSnapshot
      === "function"
  );
}

/* ========================================================================== 
 * Gaze-engine contract
 * ======================================================================== */

/**
 * Common contract implemented by every gaze estimator.
 *
 * Architectural boundary:
 *
 * Camera / Face / Eye runtime
 *        ↓
 *     GazeEngine
 *        ↓
 *   GazePrediction
 *        ↓
 * Calibration / residual correction / filtering / coordinate mapping
 *
 * The engine MUST NOT:
 * - emit Chrome runtime messages directly
 * - access page DOM/AOI state
 * - persist webcam frames or eye/face images
 * - apply visualization smoothing
 * - construct the final research `GazeSample`
 *
 * `predict()` returns the model's raw estimate only. The returned
 * `GazePrediction.timestampMs` should use the input capture timestamp rather
 * than inference-completion time so gaze, mouse and click data remain on the
 * shared timeline.
 */
export interface GazeEngine {
  /**
   * Stable identifier recorded in session metadata and each final gaze
   * sample.
   */
  readonly source: GazeEngineSource;

  /**
   * Loads local model/runtime assets and prepares the estimator.
   *
   * Implementations should make repeated calls idempotent while READY and
   * reject initialization after disposal.
   */
  initialize(): Promise<void>;

  /**
   * Predicts raw gaze for one synchronized runtime frame.
   *
   * Return `null` when no trustworthy model output can be produced for the
   * current frame (for example invalid face/eye geometry or an active blink).
   * Recoverable per-frame invalidity should not be promoted to a fatal engine
   * failure.
   */
  predict(
    input: GazeEngineFrameInput
  ): Promise<GazePrediction | null>;

  /**
   * Returns implementation-independent lifecycle information for the
   * Offscreen runtime and diagnostics.
   */
  getSnapshot(): GazeEngineSnapshot;

  /**
   * Releases model/runtime resources.
   *
   * Implementations may return `Promise.resolve()` when cleanup is entirely
   * synchronous; keeping a Promise contract avoids changing callers when a
   * future engine needs asynchronous disposal.
   */
  dispose(): Promise<void>;
}
