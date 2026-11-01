import {
  L2CS_GAZE_MODEL
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  Rect2D
} from "../shared/types";

import type {
  CameraFrameView
} from "../camera/frameCapture";

/* ========================================================================== 
 * Public normalized input
 * ======================================================================== */

export interface L2csNormalizedInput {
  readonly data: Float32Array;

  /**
   * NCHW tensor dimensions expected by the exported L2CS model.
   */
  readonly dimensions:
    readonly [1, 3, 448, 448];

  /**
   * Actual source-frame rectangle used for the transient face crop.
   * Pixels are never persisted by this module.
   */
  readonly sourceCropPx: Rect2D;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function sanitizeCrop(
  crop: Rect2D,
  frameWidth: number,
  frameHeight: number
): Rect2D {
  if (
    !Number.isFinite(crop.left)
    || !Number.isFinite(crop.top)
    || !Number.isFinite(crop.width)
    || !Number.isFinite(crop.height)
    || crop.width <= 1
    || crop.height <= 1
    || frameWidth <= 1
    || frameHeight <= 1
  ) {
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

  const left =
    clamp(
      crop.left,
      0,
      frameWidth - 1
    );

  const top =
    clamp(
      crop.top,
      0,
      frameHeight - 1
    );

  const right =
    clamp(
      crop.left + crop.width,
      left + 1,
      frameWidth
    );

  const bottom =
    clamp(
      crop.top + crop.height,
      top + 1,
      frameHeight
    );

  return {
    left,
    top,
    width:
      right - left,
    height:
      bottom - top
  };
}

function createCanvas(
  width: number,
  height: number
): HTMLCanvasElement {
  if (
    typeof document === "undefined"
    || document.createElement === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "L2CS image preprocessing requires the extension Offscreen document."
    );
  }

  const canvas =
    document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  return canvas;
}

function getContext(
  canvas: HTMLCanvasElement
): CanvasRenderingContext2D {
  const context =
    canvas.getContext(
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

/* ========================================================================== 
 * L2CS browser preprocessor
 * ======================================================================== */

/**
 * Browser equivalent of the official L2CS webcam preprocessing path.
 *
 * Official reference path:
 * RetinaFace crop → OpenCV resize 224×224 → RGB → torchvision Resize(448)
 * → ToTensor → ImageNet normalization.
 *
 * Our project already owns face detection via MediaPipe, so the detected
 * face-oval rectangle is supplied by FaceGeometry. The raw webcam image is
 * read only while this method runs and is never retained or serialized.
 */
export class L2csImageNormalizer {
  private readonly faceCanvas:
    HTMLCanvasElement;

  private readonly modelCanvas:
    HTMLCanvasElement;

  private readonly faceContext:
    CanvasRenderingContext2D;

  private readonly modelContext:
    CanvasRenderingContext2D;

  public constructor() {
    this.faceCanvas =
      createCanvas(
        L2CS_GAZE_MODEL
          .FACE_CROP_WIDTH,
        L2CS_GAZE_MODEL
          .FACE_CROP_HEIGHT
      );

    this.modelCanvas =
      createCanvas(
        L2CS_GAZE_MODEL
          .INPUT_WIDTH,
        L2CS_GAZE_MODEL
          .INPUT_HEIGHT
      );

    this.faceContext =
      getContext(
        this.faceCanvas
      );

    this.modelContext =
      getContext(
        this.modelCanvas
      );
  }

  public normalize(
    frame: CameraFrameView,
    faceCropPx: Rect2D
  ): L2csNormalizedInput {
    const crop =
      sanitizeCrop(
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

    const imageData =
      this.modelContext.getImageData(
        0,
        0,
        this.modelCanvas.width,
        this.modelCanvas.height
      );

    const pixelCount =
      L2CS_GAZE_MODEL.INPUT_WIDTH
      * L2CS_GAZE_MODEL.INPUT_HEIGHT;

    const tensorData =
      new Float32Array(
        pixelCount
        * L2CS_GAZE_MODEL
          .CHANNEL_COUNT
      );

    const rgba =
      imageData.data;

    const mean =
      L2CS_GAZE_MODEL
        .IMAGE_NET_MEAN;

    const std =
      L2CS_GAZE_MODEL
        .IMAGE_NET_STD;

    for (
      let pixelIndex = 0;
      pixelIndex < pixelCount;
      pixelIndex += 1
    ) {
      const rgbaIndex =
        pixelIndex * 4;

      const red =
        (rgba[rgbaIndex] ?? 0)
        / 255;

      const green =
        (rgba[rgbaIndex + 1] ?? 0)
        / 255;

      const blue =
        (rgba[rgbaIndex + 2] ?? 0)
        / 255;

      tensorData[pixelIndex] =
        (red - mean[0])
        / std[0];

      tensorData[
        pixelCount + pixelIndex
      ] =
        (green - mean[1])
        / std[1];

      tensorData[
        (pixelCount * 2)
        + pixelIndex
      ] =
        (blue - mean[2])
        / std[2];
    }

    return {
      data:
        tensorData,
      dimensions: [
        1,
        3,
        448,
        448
      ],
      sourceCropPx:
        crop
    };
  }
}
