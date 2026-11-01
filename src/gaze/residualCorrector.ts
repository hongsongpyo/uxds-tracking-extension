import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  CoordinateSpace,
  GazeCorrection,
  Point2D,
  Size2D
} from "../shared/types";

import {
  CalibrationModel
} from "../calibration/calibrationModel";

import type {
  CalibrationResidualModel
} from "../calibration/calibrationModel";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export interface ResidualCorrectionResult {
  readonly rawPoint: Point2D;
  readonly rawSpace: "NORMALIZED";
  readonly correctedNormalizedPoint:
    Point2D;
  readonly correctedViewportPoint:
    Point2D;
  readonly correction: GazeCorrection;
  readonly insideViewport: boolean;
}

/* ========================================================================== 
 * Residual corrector
 * ======================================================================== */

/**
 * Applies the independently fitted calibration residual model.
 *
 * The corrected point is intentionally NOT clamped to the viewport. Keeping
 * out-of-bounds corrected gaze preserves information for later quality,
 * uncertainty and AOI logic.
 */
export class ResidualCorrector {
  private readonly model =
    new CalibrationModel();

  public setModel(
    model: CalibrationResidualModel
  ): void {
    this.model.setModel(model);
  }

  public clear(): void {
    this.model.clear();
  }

  public hasModel(): boolean {
    return this.model.getModel() !== null;
  }

  public correct(
    rawPoint: Point2D,
    rawSpace: CoordinateSpace,
    viewport: Size2D
  ): ResidualCorrectionResult {
    if (rawSpace !== "NORMALIZED") {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Residual correction currently requires NORMALIZED raw gaze input.",
        {
          details: {
            rawSpace
          }
        }
      );
    }

    if (
      !Number.isFinite(viewport.width)
      || !Number.isFinite(viewport.height)
      || viewport.width <= 0
      || viewport.height <= 0
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Residual correction requires positive finite viewport dimensions."
      );
    }

    const correctedNormalizedPoint =
      this.model.predict(rawPoint);

    const rawViewportPoint = {
      x: rawPoint.x * viewport.width,
      y: rawPoint.y * viewport.height
    };

    const correctedViewportPoint = {
      x:
        correctedNormalizedPoint.x
        * viewport.width,
      y:
        correctedNormalizedPoint.y
        * viewport.height
    };

    return {
      rawPoint,
      rawSpace: "NORMALIZED",
      correctedNormalizedPoint,
      correctedViewportPoint,
      correction: {
        viewportOffsetXPx:
          correctedViewportPoint.x
          - rawViewportPoint.x,
        viewportOffsetYPx:
          correctedViewportPoint.y
          - rawViewportPoint.y
      },
      insideViewport:
        correctedViewportPoint.x >= 0
        && correctedViewportPoint.x
          <= viewport.width
        && correctedViewportPoint.y >= 0
        && correctedViewportPoint.y
          <= viewport.height
    };
  }
}
