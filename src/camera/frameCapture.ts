import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import {
  nowTimelineMs
} from "../shared/utils";

import type {
  CameraFrameMetadata
} from "../shared/types";

/* ========================================================================== 
 * Runtime frame view
 * ======================================================================== */

/**
 * Non-persistent view of the current webcam frame.
 *
 * No pixel buffer is copied or stored here. Consumers such as MediaPipe may
 * read directly from the live HTMLVideoElement during the current inference
 * step.
 */
export interface CameraFrameView {
  source: HTMLVideoElement;

  metadata: CameraFrameMetadata;
}

/* ========================================================================== 
 * Frame capture
 * ======================================================================== */

export class FrameCapture {
  private frameSequence = 0;

  private disposed = false;

  public constructor(
    private readonly videoElement:
      HTMLVideoElement
  ) {}

  /**
   * Returns a view of the current decoded video frame.
   *
   * This method intentionally avoids ImageData/ImageBitmap allocation so the
   * future face/gaze inference loop can consume the video source directly.
   */
  public captureCurrentFrame():
  CameraFrameView {
    this.assertUsable();

    if (
      this.videoElement.readyState
        < HTMLMediaElement.HAVE_CURRENT_DATA
      || this.videoElement.videoWidth
        <= 0
      || this.videoElement.videoHeight
        <= 0
    ) {
      throw new TrackerError(
        ERROR_CODES
          .CAMERA_FRAME_UNAVAILABLE,
        "CAMERA",
        "No decoded camera frame is currently available.",
        {
          details: {
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
      );
    }

    this.frameSequence += 1;

    return {
      source:
        this.videoElement,

      metadata: {
        frameSequence:
          this.frameSequence,

        timestampMs:
          nowTimelineMs(),

        width:
          this.videoElement
            .videoWidth,

        height:
          this.videoElement
            .videoHeight
      }
    };
  }

  public reset(): void {
    this.assertUsable();

    this.frameSequence = 0;
  }

  public dispose(): void {
    this.disposed = true;
  }

  private assertUsable(): void {
    if (!this.disposed) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CAMERA",
      "Disposed FrameCapture cannot be used."
    );
  }
}
