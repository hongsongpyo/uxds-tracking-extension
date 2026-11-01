import {
  CAMERA_RUNTIME
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  normalizeCameraError,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import {
  createCameraConstraints,
  readActualCameraSettings
} from "./cameraConfig";

import type {
  CameraSettings
} from "../shared/types";

import type {
  CameraRequest
} from "./cameraConfig";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("CAMERA");

/* ========================================================================== 
 * Lifecycle
 * ======================================================================== */

export type CameraLifecycle =
  | "IDLE"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "DISPOSED";

export interface CameraSnapshot {
  lifecycle: CameraLifecycle;

  running: boolean;

  settings: CameraSettings | null;
}

export type CameraDisconnectHandler = (
  error: TrackerError
) => void;

/* ========================================================================== 
 * Camera manager
 * ======================================================================== */

/**
 * Owns the MediaStream lifecycle for the Offscreen runtime.
 *
 * Webcam frames are never persisted by this class. The MediaStream exists
 * only in memory and is attached to the dedicated hidden video element.
 */
export class CameraManager {
  private lifecycle:
    CameraLifecycle =
      "IDLE";

  private stream:
    MediaStream | null =
      null;

  private videoTrack:
    MediaStreamTrack | null =
      null;

  private settings:
    CameraSettings | null =
      null;

  private startPromise:
    Promise<CameraSettings> | null =
      null;

  public constructor(
    private readonly videoElement:
      HTMLVideoElement,

    private readonly onDisconnected:
      CameraDisconnectHandler | null =
        null
  ) {}

  /* ========================================================================
   * Start
   * ====================================================================== */

  public start(
    request: CameraRequest
  ): Promise<CameraSettings> {
    this.assertNotDisposed();

    if (
      this.lifecycle === "RUNNING"
      && this.settings !== null
    ) {
      return Promise.resolve({
        ...this.settings
      });
    }

    if (
      this.startPromise !== null
    ) {
      return this.startPromise;
    }

    const pending =
      this.startInternal(request);

    this.startPromise =
      pending;

    const clearStartPromise = (): void => {
      if (
        this.startPromise
        === pending
      ) {
        this.startPromise =
          null;
      }
    };

    void pending.then(
      clearStartPromise,
      clearStartPromise
    );

    return pending;
  }

  private async startInternal(
    request: CameraRequest
  ): Promise<CameraSettings> {
    if (
      this.lifecycle === "STOPPING"
    ) {
      throw new TrackerError(
        ERROR_CODES
          .INVALID_STATE_TRANSITION,
        "CAMERA",
        "Camera cannot start while it is stopping."
      );
    }

    this.lifecycle =
      "STARTING";

    try {
      const mediaDevices =
        globalThis.navigator
          .mediaDevices;

      if (
        mediaDevices === undefined
        || typeof mediaDevices
          .getUserMedia !== "function"
      ) {
        throw new TrackerError(
          ERROR_CODES.CAMERA_START_FAILED,
          "CAMERA",
          "MediaDevices.getUserMedia() is unavailable in the Offscreen runtime."
        );
      }

      const acquiredStream =
        await mediaDevices.getUserMedia(
          createCameraConstraints(
            request
          )
        );

      /**
       * Store the stream immediately so every failure path below can stop all
       * acquired tracks through releaseCurrentStream().
       */
      this.stream =
        acquiredStream;

      if (
        this.lifecycle !== "STARTING"
      ) {
        throw new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "CAMERA",
          "Camera startup was cancelled before getUserMedia() completed.",
          {
            details: {
              lifecycle:
                this.lifecycle
            }
          }
        );
      }

      const videoTracks =
        acquiredStream
          .getVideoTracks();

      const track =
        videoTracks[0];

      if (
        track === undefined
      ) {
        throw new TrackerError(
          ERROR_CODES.CAMERA_NOT_FOUND,
          "CAMERA",
          "getUserMedia() returned no video track."
        );
      }

      this.videoTrack =
        track;

      track.addEventListener(
        "ended",
        this.handleTrackEnded
      );

      this.videoElement.srcObject =
        acquiredStream;

      await this.videoElement.play();

      await this.waitForVideoReady();

      if (
        track.readyState
        !== "live"
      ) {
        throw new TrackerError(
          ERROR_CODES.CAMERA_DISCONNECTED,
          "CAMERA",
          "Camera track ended during startup."
        );
      }

      const actualSettings =
        readActualCameraSettings(
          track,
          this.videoElement,
          request
        );

      this.settings = {
        ...actualSettings
      };

      this.lifecycle =
        "RUNNING";

      logger.info(
        "Camera started.",
        {
          width:
            actualSettings.width,

          height:
            actualSettings.height,

          frameRate:
            actualSettings.frameRate
        }
      );

      return {
        ...actualSettings
      };
    } catch (error: unknown) {
      const disposed =
        this.isDisposedLifecycle();

      this.releaseCurrentStream();

      if (!disposed) {
        this.lifecycle =
          "IDLE";
      }

      throw normalizeCameraError(
        error
      );
    }
  }

  /* ========================================================================
   * Runtime state
   * ====================================================================== */

  public isRunning(): boolean {
    return (
      this.lifecycle === "RUNNING"
      && this.videoTrack !== null
      && this.videoTrack.readyState
        === "live"
    );
  }

  public getSettings():
  CameraSettings | null {
    if (
      this.settings === null
    ) {
      return null;
    }

    return {
      ...this.settings
    };
  }

  public getSnapshot():
  CameraSnapshot {
    return {
      lifecycle:
        this.lifecycle,

      running:
        this.isRunning(),

      settings:
        this.getSettings()
    };
  }

  /* ========================================================================
   * Stop / disposal
   * ====================================================================== */

  public stop(): void {
    if (
      this.lifecycle === "DISPOSED"
      || this.lifecycle === "IDLE"
    ) {
      return;
    }

    this.lifecycle =
      "STOPPING";

    try {
      this.releaseCurrentStream();

      this.lifecycle =
        "IDLE";

      logger.info(
        "Camera stopped."
      );
    } catch (error: unknown) {
      this.lifecycle =
        "IDLE";

      throw normalizeTrackerError(
        error,
        ERROR_CODES.CAMERA_START_FAILED,
        "CAMERA",
        "Camera cleanup failed."
      );
    }
  }

  public dispose(): void {
    if (
      this.lifecycle === "DISPOSED"
    ) {
      return;
    }

    this.stop();

    this.lifecycle =
      "DISPOSED";
  }

  /* ========================================================================
   * Video readiness
   * ====================================================================== */

  private waitForVideoReady():
  Promise<void> {
    if (this.isVideoReady()) {
      return Promise.resolve();
    }

    return new Promise<void>(
      (resolve, reject) => {
        const cleanup = (): void => {
          globalThis.clearTimeout(
            timeoutId
          );

          this.videoElement
            .removeEventListener(
              "loadeddata",
              handleReady
            );

          this.videoElement
            .removeEventListener(
              "canplay",
              handleReady
            );
        };

        const handleReady = (): void => {
          if (!this.isVideoReady()) {
            return;
          }

          cleanup();
          resolve();
        };

        const timeoutId =
          globalThis.setTimeout(
            () => {
              cleanup();

              reject(
                new TrackerError(
                  ERROR_CODES
                    .CAMERA_START_FAILED,
                  "CAMERA",
                  "Camera video did not become ready before the startup timeout.",
                  {
                    details: {
                      timeoutMs:
                        CAMERA_RUNTIME
                          .VIDEO_READY_TIMEOUT_MS,

                      readyState:
                        this.videoElement
                          .readyState,

                      videoWidth:
                        this.videoElement
                          .videoWidth,

                      videoHeight:
                        this.videoElement
                          .videoHeight
                    }
                  }
                )
              );
            },
            CAMERA_RUNTIME
              .VIDEO_READY_TIMEOUT_MS
          );

        this.videoElement
          .addEventListener(
            "loadeddata",
            handleReady
          );

        this.videoElement
          .addEventListener(
            "canplay",
            handleReady
          );
      }
    );
  }

  private isVideoReady(): boolean {
    return (
      this.videoElement.readyState
        >= HTMLMediaElement.HAVE_CURRENT_DATA
      && this.videoElement.videoWidth
        > 0
      && this.videoElement.videoHeight
        > 0
    );
  }

  /* ========================================================================
   * Unexpected disconnection
   * ====================================================================== */

  private readonly handleTrackEnded =
    (): void => {
      if (
        this.lifecycle === "STOPPING"
        || this.lifecycle === "DISPOSED"
      ) {
        return;
      }

      this.releaseCurrentStream();

      this.lifecycle =
        "IDLE";

      const error =
        new TrackerError(
          ERROR_CODES.CAMERA_DISCONNECTED,
          "CAMERA",
          "The active camera stream ended unexpectedly."
        );

      logger.warn(
        "Camera disconnected unexpectedly."
      );

      if (
        this.onDisconnected
        === null
      ) {
        return;
      }

      try {
        this.onDisconnected(error);
      } catch (callbackError: unknown) {
        logger.error(
          "Camera disconnect handler failed.",
          {
            message:
              callbackError
              instanceof Error
                ? callbackError.message
                : "Unknown disconnect-handler error"
          }
        );
      }
    };

  /* ========================================================================
   * Stream cleanup
   * ====================================================================== */

  private releaseCurrentStream(): void {
    const track =
      this.videoTrack;

    if (track !== null) {
      track.removeEventListener(
        "ended",
        this.handleTrackEnded
      );
    }

    const stream =
      this.stream;

    this.videoTrack =
      null;

    this.stream =
      null;

    this.settings =
      null;

    if (stream !== null) {
      for (
        const mediaTrack
        of stream.getTracks()
      ) {
        mediaTrack.stop();
      }
    }

    this.videoElement.pause();

    if (
      this.videoElement.srcObject
      !== null
    ) {
      this.videoElement.srcObject =
        null;
    }
  }

  /* ========================================================================
   * Guards
   * ====================================================================== */

  private isDisposedLifecycle(): boolean {
    return this.lifecycle === "DISPOSED";
  }

  private assertNotDisposed(): void {
    if (
      this.lifecycle !== "DISPOSED"
    ) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CAMERA",
      "Disposed CameraManager cannot be used."
    );
  }
}
