import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import type {
  CoordinateSpace,
  GazePrediction,
  Point2D
} from "../shared/types";

import type {
  GazeEngine,
  GazeEngineFrameInput,
  GazeEngineLifecycle,
  GazeEngineSnapshot
} from "./GazeEngine";

import {
  LocalWebEyeTrackBackend
} from "./webEyeTrackBackend";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * Backend boundary
 * ======================================================================== */

/**
 * Normalized output expected from the concrete WebEyeTrack integration layer.
 *
 * This deliberately does not expose upstream WebEyeTrack classes or result
 * objects to the rest of the extension. The future vendor bridge is
 * responsible for translating whatever the pinned WebEyeTrack build returns
 * into this stable project-owned shape.
 */
export interface WebEyeTrackBackendPrediction {
  readonly rawPoint: Point2D;
  readonly rawSpace: CoordinateSpace;

  /**
   * Model confidence normalized to 0..1 by the concrete backend bridge.
   */
  readonly confidence: number;
}

export interface WebEyeTrackPersonalizationResult {
  readonly applied: boolean;
  readonly stagedPointCount: number;
  readonly supportPointCount: number;
}

/**
 * Internal adapter boundary around the concrete WebEyeTrack runtime.
 *
 * Why this exists:
 * - the current project intentionally owns camera + MediaPipe lifecycle;
 * - WebEyeTrack package/runtime details must not leak into GazeEngine callers;
 * - a pinned/local WebEyeTrack build can later be replaced without changing
 *   calibration, storage, AOI or message-layer code.
 *
 * Implementations may use `input.frame.source` and/or the already-computed
 * face/eye geometry. They must not retain webcam frames after prediction.
 */
export interface WebEyeTrackBackend {
  initialize(): Promise<void>;

  predict(
    input: GazeEngineFrameInput
  ): Promise<WebEyeTrackBackendPrediction | null>;

  /**
   * Optional engine-native few-shot personalization hooks. Implementations
   * that do not support them simply omit these methods.
   */
  beginPersonalizationSession?(): void;

  recordLatestPersonalizationCandidate?(
    pointIndex: number,
    expectedTimestampMs: number
  ): boolean;

  stagePersonalizationPoint?(
    pointIndex: number,
    targetNormalizedPoint: Point2D,
    stableWindowStartTimestampMs: number,
    stableWindowEndTimestampMs: number
  ): boolean;

  applyPersonalization?():
    Promise<WebEyeTrackPersonalizationResult>;

  dispose(): Promise<void>;
}

/* ========================================================================== 
 * Validation helpers
 * ======================================================================== */

function isFinitePoint(
  point: Point2D
): boolean {
  return (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function isValidConfidence(
  confidence: number
): boolean {
  return (
    Number.isFinite(confidence)
    && confidence >= 0
    && confidence <= 1
  );
}

function assertSynchronizedInput(
  input: GazeEngineFrameInput
): void {
  const expectedFrameSequence =
    input.frame.metadata.frameSequence;

  const expectedTimestampMs =
    input.frame.metadata.timestampMs;

  const frameResults = [
    input.landmarker,
    input.faceGeometry,
    input.headPose,
    input.eyeGeometry,
    input.blink,
    input.faceQuality
  ] as const;

  for (const result of frameResults) {
    if (
      result.frameSequence
        !== expectedFrameSequence
      || result.timestampMs
        !== expectedTimestampMs
    ) {
      throw new TrackerError(
        ERROR_CODES.GAZE_INVALID_SAMPLE,
        "GAZE",
        "Gaze engine received unsynchronized frame analysis results.",
        {
          details: {
            expectedFrameSequence,
            expectedTimestampMs,
            receivedFrameSequence:
              result.frameSequence,
            receivedTimestampMs:
              result.timestampMs
          }
        }
      );
    }
  }
}

function isInputUsableForPrediction(
  input: GazeEngineFrameInput
): boolean {
  const trackingQuality =
    input.faceQuality.trackingQuality;

  return (
    input.faceQuality.usableForGaze
    && trackingQuality.faceValid
    && trackingQuality.eyesValid
    && input.faceGeometry.faceDetected
    && input.faceGeometry.geometryValid
    && input.faceGeometry.geometry !== null
    && input.headPose.faceDetected
    && input.headPose.poseValid
    && input.headPose.headPose !== null
    && input.eyeGeometry.faceDetected
    && input.eyeGeometry.geometryValid
    && input.eyeGeometry.bothEyesValid
    && input.eyeGeometry.leftEye !== null
    && input.eyeGeometry.rightEye !== null
    && input.blink.valid
    && input.blink.bothEyesOpen
    && !input.blink.bothEyesClosed
    && !input.blink.blinkInProgress
    && !input.blink.prolongedClosureDetected
  );
}

function assertValidBackendPrediction(
  prediction: WebEyeTrackBackendPrediction
): void {
  if (!isFinitePoint(prediction.rawPoint)) {
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
          confidence:
            prediction.confidence
        }
      }
    );
  }
}

/* ========================================================================== 
 * WebEyeTrack gaze engine
 * ======================================================================== */

/**
 * Project-owned GazeEngine implementation for WebEyeTrack.
 *
 * Upstream WebEyeTrack details remain isolated behind WebEyeTrackBackend.
 * Production uses LocalWebEyeTrackBackend by default, while tests may inject
 * a deterministic backend without changing the public GazeEngine contract.
 */
export class WebEyeTrackEngine implements GazeEngine {
  public readonly source =
    "WEB_EYE_TRACK" as const;

  private lifecycle:
    GazeEngineLifecycle =
      "CREATED";

  private lastPredictionTimestampMs:
    number | null =
      null;

  public constructor(
    private readonly backend:
      WebEyeTrackBackend =
        new LocalWebEyeTrackBackend()
  ) {}

  public async initialize(): Promise<void> {
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

    this.lifecycle =
      "INITIALIZING";

    try {
      await this.backend.initialize();

      this.lastPredictionTimestampMs =
        null;

      this.lifecycle =
        "READY";

      logger.info(
        "WebEyeTrack engine initialized."
      );
    } catch (error: unknown) {
      this.lifecycle =
        "ERROR";

      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "WebEyeTrack engine initialization failed."
      );
    }
  }

  public async predict(
    input: GazeEngineFrameInput
  ): Promise<GazePrediction | null> {
    this.assertReady();

    assertSynchronizedInput(input);

    if (!isInputUsableForPrediction(input)) {
      return null;
    }

    const headPose =
      input.headPose.headPose;

    if (headPose === null) {
      return null;
    }

    try {
      const backendPrediction =
        await this.backend.predict(input);

      if (backendPrediction === null) {
        return null;
      }

      assertValidBackendPrediction(
        backendPrediction
      );

      this.lastPredictionTimestampMs =
        input.frame.metadata.timestampMs;

      return {
        timestampMs:
          input.frame.metadata.timestampMs,

        rawPoint:
          backendPrediction.rawPoint,

        rawSpace:
          backendPrediction.rawSpace,

        confidence:
          backendPrediction.confidence,

        faceValid:
          input.faceQuality
            .trackingQuality
            .faceValid,

        eyesValid:
          input.faceQuality
            .trackingQuality
            .eyesValid,

        headPose,

        source:
          this.source
      };
    } catch (error: unknown) {
      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "WebEyeTrack gaze prediction failed.",
        {
          details: {
            frameSequence:
              input.frame.metadata.frameSequence,
            timestampMs:
              input.frame.metadata.timestampMs
          }
        }
      );
    }
  }

  public supportsPersonalization(): boolean {
    return (
      typeof this.backend.beginPersonalizationSession
        === "function"
      && typeof this.backend.recordLatestPersonalizationCandidate
        === "function"
      && typeof this.backend.stagePersonalizationPoint
        === "function"
      && typeof this.backend.applyPersonalization
        === "function"
    );
  }

  public beginPersonalizationSession(): boolean {
    if (!this.supportsPersonalization()) {
      return false;
    }

    this.backend.beginPersonalizationSession?.();
    return true;
  }

  public recordLatestPersonalizationCandidate(
    pointIndex: number,
    expectedTimestampMs: number
  ): boolean {
    if (!this.supportsPersonalization()) {
      return false;
    }

    return this.backend
      .recordLatestPersonalizationCandidate?.(
        pointIndex,
        expectedTimestampMs
      )
      ?? false;
  }

  public stagePersonalizationPoint(
    pointIndex: number,
    targetNormalizedPoint: Point2D,
    stableWindowStartTimestampMs: number,
    stableWindowEndTimestampMs: number
  ): boolean {
    if (!this.supportsPersonalization()) {
      return false;
    }

    return this.backend
      .stagePersonalizationPoint?.(
        pointIndex,
        targetNormalizedPoint,
        stableWindowStartTimestampMs,
        stableWindowEndTimestampMs
      )
      ?? false;
  }

  public async applyPersonalization():
  Promise<WebEyeTrackPersonalizationResult> {
    if (!this.supportsPersonalization()) {
      return {
        applied: false,
        stagedPointCount: 0,
        supportPointCount: 0
      };
    }

    return this.backend
      .applyPersonalization?.()
      ?? {
        applied: false,
        stagedPointCount: 0,
        supportPointCount: 0
      };
  }

  public getSnapshot(): GazeEngineSnapshot {
    return {
      source:
        this.source,

      lifecycle:
        this.lifecycle,

      initialized:
        this.lifecycle === "READY",

      lastPredictionTimestampMs:
        this.lastPredictionTimestampMs
    };
  }

  public dispose(): Promise<void> {
    if (this.lifecycle === "DISPOSED") {
      return Promise.resolve();
    }

    this.lifecycle =
      "DISPOSED";

    this.lastPredictionTimestampMs =
      null;

    return this.backend.dispose().catch(
      (error: unknown) => {
        logger.warn(
          "WebEyeTrack backend disposal failed.",
          {
            error
          }
        );
      }
    );
  }

  private assertReady(): void {
    if (this.lifecycle === "READY") {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "WebEyeTrack engine is not ready for prediction.",
      {
        details: {
          lifecycle:
            this.lifecycle
        }
      }
    );
  }
}
