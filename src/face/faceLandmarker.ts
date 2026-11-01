import {
  FaceLandmarker as MediaPipeFaceLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";

import {
  FACE_LANDMARKER_RUNTIME
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  getUnknownErrorMessage,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import type {
  FaceLandmarkerOptions
} from "@mediapipe/tasks-vision";

import type {
  CameraFrameView
} from "../camera/frameCapture";

import type {
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("FACE");

/* ========================================================================== 
 * Runtime-facing face types
 * ======================================================================== */

/**
 * MediaPipe-independent normalized face landmark.
 *
 * x/y are normalized to the input image dimensions. z is MediaPipe's
 * normalized relative depth value. These values are transient runtime data;
 * they are not persistent research records by default.
 */
export interface FaceLandmarkPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility: number;
}

/**
 * MediaPipe-independent view of the facial transformation matrix.
 */
export interface FacialTransformationMatrix {
  readonly rows: number;
  readonly columns: number;
  readonly data: readonly number[];
}

/**
 * One face-landmark inference result for one camera frame.
 *
 * The project tracks a single participant, therefore only the first detected
 * face is exposed even though MediaPipe internally returns an array of faces.
 */
export interface FaceLandmarkerFrameResult {
  readonly frameSequence: number;
  readonly timestampMs: TimestampMs;
  readonly inferenceTimestampMs: number;

  readonly frameWidth: number;
  readonly frameHeight: number;

  readonly faceDetected: boolean;
  readonly landmarkCount: number;

  readonly landmarks:
    readonly FaceLandmarkPoint[];

  readonly transformationMatrix:
    FacialTransformationMatrix | null;
}

export type FaceLandmarkerLifecycle =
  | "CREATED"
  | "INITIALIZING"
  | "READY"
  | "ERROR"
  | "DISPOSED";

export interface FaceLandmarkerSnapshot {
  readonly lifecycle:
    FaceLandmarkerLifecycle;

  readonly initialized: boolean;

  readonly lastInferenceTimestampMs:
    number | null;
}

/**
 * Optional URL overrides are useful for tests or alternate bundlers.
 *
 * Production defaults resolve local extension assets through
 * chrome.runtime.getURL().
 */
export interface FaceLandmarkerAssetOverrides {
  readonly wasmBaseUrl?: string;
  readonly modelAssetUrl?: string;
}

/* ========================================================================== 
 * Empty result helpers
 * ======================================================================== */

const EMPTY_LANDMARKS:
readonly FaceLandmarkPoint[] =
  Object.freeze([]);

/* ========================================================================== 
 * Face landmarker
 * ======================================================================== */

/**
 * Adapter around MediaPipe Face Landmarker.
 *
 * Responsibilities:
 * - load local MediaPipe WASM
 * - load the local face_landmarker.task model
 * - enforce VIDEO-mode timestamp monotonicity
 * - expose MediaPipe-independent runtime face data
 * - own and dispose the MediaPipe task instance
 *
 * This class deliberately does NOT calculate head pose, blink, face geometry
 * or gaze. Those responsibilities remain in their dedicated modules.
 */
export class FaceLandmarker {
  private lifecycle:
    FaceLandmarkerLifecycle =
      "CREATED";

  private mediaPipeLandmarker:
    MediaPipeFaceLandmarker | null =
      null;

  private initializationPromise:
    Promise<void> | null =
      null;

  /**
   * Incremented whenever dispose() invalidates in-flight initialization work.
   */
  private lifecycleGeneration = 0;

  private lastInferenceTimestampMs:
    number | null =
      null;

  public constructor(
    private readonly assetOverrides:
      FaceLandmarkerAssetOverrides = {}
  ) {}

  /* ========================================================================
   * Initialization
   * ====================================================================== */

  public initialize(): Promise<void> {
    if (
      this.lifecycle === "READY"
    ) {
      return Promise.resolve();
    }

    if (
      this.lifecycle === "DISPOSED"
    ) {
      return Promise.reject(
        new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "FACE",
          "Disposed FaceLandmarker cannot be initialized."
        )
      );
    }

    if (
      this.initializationPromise
      !== null
    ) {
      return this.initializationPromise;
    }

    this.lifecycle =
      "INITIALIZING";

    const generation =
      this.lifecycleGeneration;

    const initialization =
      this.initializeInternal(
        generation
      )
        .catch(
          (error: unknown) => {
            if (
              this.lifecycle
              !== "DISPOSED"
            ) {
              this.lifecycle =
                "ERROR";
            }

            throw error;
          }
        )
        .finally(
          () => {
            if (
              this.initializationPromise
              === initialization
            ) {
              this.initializationPromise =
                null;
            }
          }
        );

    this.initializationPromise =
      initialization;

    return initialization;
  }

  private async initializeInternal(
    generation: number
  ): Promise<void> {
    const wasmBaseUrl =
      this.resolveWasmBaseUrl();

    const modelAssetUrl =
      this.resolveModelAssetUrl();

    let wasmFileset:
      Awaited<
        ReturnType<
          typeof FilesetResolver.forVisionTasks
        >
      >;

    try {
      wasmFileset =
        await FilesetResolver
          .forVisionTasks(
            wasmBaseUrl
          );
    } catch (error: unknown) {
      throw new TrackerError(
        ERROR_CODES.WASM_LOAD_FAILED,
        "FACE",
        "MediaPipe Vision WASM files could not be loaded.",
        {
          recoverable: false,
          cause: error,
          details: {
            wasmBaseUrl,
            originalMessage:
              getUnknownErrorMessage(
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
        modelAssetPath:
          modelAssetUrl,

        delegate:
          FACE_LANDMARKER_RUNTIME
            .DELEGATE
      },

      runningMode: "VIDEO",

      numFaces:
        FACE_LANDMARKER_RUNTIME
          .NUM_FACES,

      minFaceDetectionConfidence:
        FACE_LANDMARKER_RUNTIME
          .MIN_FACE_DETECTION_CONFIDENCE,

      minFacePresenceConfidence:
        FACE_LANDMARKER_RUNTIME
          .MIN_FACE_PRESENCE_CONFIDENCE,

      minTrackingConfidence:
        FACE_LANDMARKER_RUNTIME
          .MIN_TRACKING_CONFIDENCE,

      outputFaceBlendshapes:
        FACE_LANDMARKER_RUNTIME
          .OUTPUT_FACE_BLENDSHAPES,

      outputFacialTransformationMatrixes:
        FACE_LANDMARKER_RUNTIME
          .OUTPUT_FACIAL_TRANSFORMATION_MATRIXES
    } satisfies FaceLandmarkerOptions;

    let createdLandmarker:
      MediaPipeFaceLandmarker;

    try {
      createdLandmarker =
        await MediaPipeFaceLandmarker
          .createFromOptions(
            wasmFileset,
            options
          );
    } catch (error: unknown) {
      throw new TrackerError(
        ERROR_CODES.FACE_MODEL_LOAD_FAILED,
        "FACE",
        "MediaPipe Face Landmarker model could not be initialized.",
        {
          recoverable: false,
          cause: error,
          details: {
            modelAssetUrl,
            originalMessage:
              getUnknownErrorMessage(
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
    } catch (error: unknown) {
      createdLandmarker.close();
      throw error;
    }

    this.mediaPipeLandmarker =
      createdLandmarker;

    this.lastInferenceTimestampMs =
      null;

    this.lifecycle =
      "READY";

    logger.info(
      "MediaPipe Face Landmarker initialized.",
      {
        delegate:
          FACE_LANDMARKER_RUNTIME
            .DELEGATE,

        numFaces:
          FACE_LANDMARKER_RUNTIME
            .NUM_FACES,

        transformationMatrixEnabled:
          FACE_LANDMARKER_RUNTIME
            .OUTPUT_FACIAL_TRANSFORMATION_MATRIXES
      }
    );
  }

  /* ========================================================================
   * Inference
   * ====================================================================== */

  public detect(
    frame: CameraFrameView
  ): FaceLandmarkerFrameResult {
    const landmarker =
      this.getReadyLandmarkerOrThrow();

    const inferenceTimestampMs =
      this.createMonotonicTimestamp(
        frame.metadata.timestampMs
      );

    try {
      const result =
        landmarker.detectForVideo(
          frame.source,
          inferenceTimestampMs
        );

      this.lastInferenceTimestampMs =
        inferenceTimestampMs;

      const landmarks =
        result.faceLandmarks[0]
        ?? EMPTY_LANDMARKS;

      const transformationMatrix =
        result
          .facialTransformationMatrixes[0]
        ?? null;

      return {
        frameSequence:
          frame.metadata
            .frameSequence,

        timestampMs:
          frame.metadata
            .timestampMs,

        inferenceTimestampMs,

        frameWidth:
          frame.metadata.width,

        frameHeight:
          frame.metadata.height,

        faceDetected:
          landmarks.length > 0,

        landmarkCount:
          landmarks.length,

        landmarks,

        transformationMatrix
      };
    } catch (error: unknown) {
      this.lastInferenceTimestampMs =
        inferenceTimestampMs;

      throw normalizeTrackerError(
        error,
        ERROR_CODES.FACE_DETECTION_FAILED,
        "FACE",
        "MediaPipe face landmark detection failed.",
        {
          details: {
            frameSequence:
              frame.metadata
                .frameSequence,

            frameWidth:
              frame.metadata.width,

            frameHeight:
              frame.metadata.height
          }
        }
      );
    }
  }

  /* ========================================================================
   * State
   * ====================================================================== */

  public isReady(): boolean {
    return (
      this.lifecycle === "READY"
      && this.mediaPipeLandmarker
        !== null
    );
  }

  public getSnapshot():
  FaceLandmarkerSnapshot {
    return {
      lifecycle:
        this.lifecycle,

      initialized:
        this.isReady(),

      lastInferenceTimestampMs:
        this.lastInferenceTimestampMs
    };
  }

  /* ========================================================================
   * Disposal
   * ====================================================================== */

  public dispose(): void {
    if (
      this.lifecycle === "DISPOSED"
    ) {
      return;
    }

    this.lifecycleGeneration += 1;

    const landmarker =
      this.mediaPipeLandmarker;

    this.mediaPipeLandmarker =
      null;

    this.lastInferenceTimestampMs =
      null;

    this.lifecycle =
      "DISPOSED";

    if (landmarker !== null) {
      try {
        landmarker.close();
      } catch (error: unknown) {
        logger.warn(
          "MediaPipe Face Landmarker cleanup failed.",
          {
            originalMessage:
              getUnknownErrorMessage(
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

  private resolveWasmBaseUrl():
  string {
    if (
      this.assetOverrides
        .wasmBaseUrl
      !== undefined
    ) {
      return this.assetOverrides
        .wasmBaseUrl;
    }

    try {
      return chrome.runtime.getURL(
        FACE_LANDMARKER_RUNTIME
          .WASM_ASSET_DIRECTORY
      );
    } catch (error: unknown) {
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

  private resolveModelAssetUrl():
  string {
    if (
      this.assetOverrides
        .modelAssetUrl
      !== undefined
    ) {
      return this.assetOverrides
        .modelAssetUrl;
    }

    try {
      return chrome.runtime.getURL(
        FACE_LANDMARKER_RUNTIME
          .MODEL_ASSET_PATH
      );
    } catch (error: unknown) {
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

  private assertInitializationCurrent(
    generation: number
  ): void {
    if (
      this.lifecycleGeneration
        === generation
      && this.lifecycle
        !== "DISPOSED"
    ) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face Landmarker initialization was cancelled because the runtime was disposed."
    );
  }

  private getReadyLandmarkerOrThrow():
  MediaPipeFaceLandmarker {
    if (
      this.lifecycle === "READY"
      && this.mediaPipeLandmarker
        !== null
    ) {
      return this.mediaPipeLandmarker;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face landmark inference requires an initialized FaceLandmarker.",
      {
        details: {
          lifecycle:
            this.lifecycle
        }
      }
    );
  }

  private createMonotonicTimestamp(
    timestampMs: TimestampMs
  ): number {
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

    const previousTimestamp =
      this.lastInferenceTimestampMs;

    if (
      previousTimestamp === null
      || timestampMs
        > previousTimestamp
    ) {
      return timestampMs;
    }

    return (
      previousTimestamp
      + FACE_LANDMARKER_RUNTIME
        .MIN_TIMESTAMP_INCREMENT_MS
    );
  }
}
