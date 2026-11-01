import {
  CAMERA_QUALITY_SAMPLING,
  CAMERA_QUALITY_THRESHOLDS,
  TIME
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  clamp01
} from "../shared/utils";

import type {
  CameraQuality,
  DataQualityLevel,
  TimestampMs
} from "../shared/types";

import type {
  CameraFrameView
} from "./frameCapture";

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function toLuminance(
  red: number,
  green: number,
  blue: number
): number {
  return (
    0.2126 * red
    + 0.7152 * green
    + 0.0722 * blue
  );
}

/* ========================================================================== 
 * Camera quality estimator
 * ======================================================================== */

/**
 * Computes inexpensive runtime quality metrics from a down-sampled frame.
 *
 * Pixel data is transient and never stored outside evaluate().
 */
export class CameraQualityEstimator {
  private readonly canvas:
    OffscreenCanvas;

  private readonly context:
    OffscreenCanvasRenderingContext2D;

  private readonly frameTimestamps:
    TimestampMs[] = [];

  private disposed = false;

  public constructor() {
    this.canvas =
      new OffscreenCanvas(
        CAMERA_QUALITY_SAMPLING
          .WIDTH,
        CAMERA_QUALITY_SAMPLING
          .HEIGHT
      );

    const context =
      this.canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    if (context === null) {
      throw new TrackerError(
        ERROR_CODES
          .CAMERA_QUALITY_FAILED,
        "CAMERA",
        "Could not create the camera-quality 2D canvas context."
      );
    }

    this.context =
      context;
  }

  public evaluate(
    frame: CameraFrameView
  ): CameraQuality {
    this.assertUsable();

    try {
      this.context.drawImage(
        frame.source,
        0,
        0,
        CAMERA_QUALITY_SAMPLING.WIDTH,
        CAMERA_QUALITY_SAMPLING.HEIGHT
      );

      const imageData =
        this.context.getImageData(
          0,
          0,
          CAMERA_QUALITY_SAMPLING.WIDTH,
          CAMERA_QUALITY_SAMPLING.HEIGHT
        );

      const brightness =
        this.calculateBrightness(
          imageData.data
        );

      const sharpness =
        this.calculateSharpness(
          imageData.data,
          imageData.width,
          imageData.height
        );

      const frameRateActual =
        this.updateFrameRate(
          frame.metadata.timestampMs
        );

      return {
        brightness,
        sharpness,
        frameRateActual,

        quality:
          this.classifyQuality(
            brightness,
            sharpness,
            frameRateActual
          )
      };
    } catch (error: unknown) {
      throw normalizeTrackerError(
        error,
        ERROR_CODES
          .CAMERA_QUALITY_FAILED,
        "CAMERA",
        "Camera quality evaluation failed."
      );
    }
  }

  public reset(): void {
    this.assertUsable();

    this.frameTimestamps.length = 0;
  }

  public dispose(): void {
    this.frameTimestamps.length = 0;

    this.disposed = true;
  }

  /* ========================================================================
   * Brightness
   * ====================================================================== */

  private calculateBrightness(
    data: Uint8ClampedArray
  ): number {
    let luminanceSum = 0;
    let pixelCount = 0;

    for (
      let index = 0;
      index + 2 < data.length;
      index += 4
    ) {
      const red =
        data[index];

      const green =
        data[index + 1];

      const blue =
        data[index + 2];

      if (
        red === undefined
        || green === undefined
        || blue === undefined
      ) {
        continue;
      }

      luminanceSum +=
        toLuminance(
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
      luminanceSum
      / pixelCount
      / 255
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
  private calculateSharpness(
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): number {
    if (
      width < 2
      || height < 2
    ) {
      return 0;
    }

    let gradientSum = 0;
    let comparisonCount = 0;

    const luminanceAt = (
      x: number,
      y: number
    ): number => {
      const offset =
        (y * width + x) * 4;

      const red =
        data[offset]
        ?? 0;

      const green =
        data[offset + 1]
        ?? 0;

      const blue =
        data[offset + 2]
        ?? 0;

      return toLuminance(
        red,
        green,
        blue
      );
    };

    for (
      let y = 0;
      y < height - 1;
      y += 1
    ) {
      for (
        let x = 0;
        x < width - 1;
        x += 1
      ) {
        const current =
          luminanceAt(x, y);

        const right =
          luminanceAt(
            x + 1,
            y
          );

        const below =
          luminanceAt(
            x,
            y + 1
          );

        gradientSum +=
          Math.abs(
            current - right
          )
          + Math.abs(
            current - below
          );

        comparisonCount += 2;
      }
    }

    if (comparisonCount === 0) {
      return 0;
    }

    return clamp01(
      gradientSum
      / comparisonCount
      / 255
    );
  }

  /* ========================================================================
   * Actual frame rate
   * ====================================================================== */

  private updateFrameRate(
    timestampMs: TimestampMs
  ): number {
    this.frameTimestamps.push(
      timestampMs
    );

    const maximumTimestampCount =
      CAMERA_QUALITY_SAMPLING
        .FPS_WINDOW_SIZE
      + 1;

    if (
      this.frameTimestamps.length
      > maximumTimestampCount
    ) {
      this.frameTimestamps.shift();
    }

    if (
      this.frameTimestamps.length < 2
    ) {
      return 0;
    }

    const first =
      this.frameTimestamps[0];

    const last =
      this.frameTimestamps[
        this.frameTimestamps.length - 1
      ];

    if (
      first === undefined
      || last === undefined
    ) {
      return 0;
    }

    const elapsedMs =
      last - first;

    if (elapsedMs <= 0) {
      return 0;
    }

    return (
      (this.frameTimestamps.length - 1)
      * TIME.MS_PER_SECOND
      / elapsedMs
    );
  }

  /* ========================================================================
   * Quality classification
   * ====================================================================== */

  private classifyQuality(
    brightness: number,
    sharpness: number,
    frameRateActual: number
  ): DataQualityLevel {
    if (
      !Number.isFinite(brightness)
      || !Number.isFinite(sharpness)
      || !Number.isFinite(frameRateActual)
    ) {
      return "INVALID";
    }

    const lightingAcceptable =
      brightness
        >= CAMERA_QUALITY_THRESHOLDS
          .MIN_BRIGHTNESS
      && brightness
        <= CAMERA_QUALITY_THRESHOLDS
          .MAX_BRIGHTNESS;

    const sharpnessAcceptable =
      sharpness
        >= CAMERA_QUALITY_THRESHOLDS
          .MIN_SHARPNESS;

    if (
      !lightingAcceptable
      || !sharpnessAcceptable
    ) {
      return "POOR";
    }

    if (
      this.frameTimestamps.length
      < CAMERA_QUALITY_SAMPLING
          .MIN_FPS_SAMPLE_COUNT
    ) {
      return "FAIR";
    }

    if (
      frameRateActual
      < CAMERA_QUALITY_THRESHOLDS
          .MIN_ACCEPTABLE_FPS
    ) {
      return "POOR";
    }

    return "GOOD";
  }

  private assertUsable(): void {
    if (!this.disposed) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "CAMERA",
      "Disposed CameraQualityEstimator cannot be used."
    );
  }
}
