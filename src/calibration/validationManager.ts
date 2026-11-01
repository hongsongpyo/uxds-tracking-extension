import {
  CALIBRATION
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  isTrackerError
} from "../shared/errors";

import {
  CalibrationCollector
} from "./calibrationCollector";

import {
  cleanCalibrationPoint
} from "./calibrationCleaner";

import {
  CalibrationModel
} from "./calibrationModel";

import {
  validateCalibrationModel
} from "./calibrationValidator";

import type {
  CalibrationObservation,
  CalibrationSampleDecision
} from "./calibrationCollector";

import type {
  CalibrationCleanedPoint
} from "./calibrationCleaner";

import type {
  CalibrationResidualModel
} from "./calibrationModel";

import type {
  CalibrationValidationResult
} from "./calibrationValidator";

import type {
  CalibrationId,
  CalibrationTarget,
  FaceBaseline,
  Size2D,
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export type ValidationPointFailureReason =
  | "INSUFFICIENT_SAMPLES"
  | "UNSTABLE_GAZE"
  | "OUTLIER_REJECTION";

export interface ValidationManagerPointResult {
  readonly calibrationId: CalibrationId;
  readonly pointIndex: number;
  readonly sufficient: boolean;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly rejectionRatio: number;
  readonly completedPointCount: number;
  readonly expectedPointCount: number;
  readonly failureReason:
    ValidationPointFailureReason | null;
  readonly validationComplete: boolean;
  readonly validation:
    CalibrationValidationResult | null;
}

export interface ValidationManagerSnapshot {
  readonly calibrationId:
    CalibrationId | null;
  readonly active: boolean;
  readonly activePointIndex:
    number | null;
  readonly completedPointCount: number;
  readonly expectedPointCount: number;
  readonly validationComplete: boolean;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function assertViewport(
  viewport: Size2D
): void {
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Validation requires a positive finite viewport size."
    );
  }
}

function isFiniteTarget(
  target: CalibrationTarget
): boolean {
  return (
    Number.isInteger(target.pointIndex)
    && target.pointIndex >= 0
    && Number.isFinite(
      target.normalizedPoint.x
    )
    && Number.isFinite(
      target.normalizedPoint.y
    )
    && target.normalizedPoint.x >= 0
    && target.normalizedPoint.x <= 1
    && target.normalizedPoint.y >= 0
    && target.normalizedPoint.y <= 1
    && Number.isFinite(
      target.viewportPoint.x
    )
    && Number.isFinite(
      target.viewportPoint.y
    )
    && target.viewportPoint.x >= 0
    && target.viewportPoint.y >= 0
  );
}

/* ========================================================================== 
 * Manager
 * ======================================================================== */

/**
 * Collects an independent validation set without mutating the fitted
 * calibration model. The validation targets must never be added to the
 * calibration training set.
 */
export class ValidationManager {
  private readonly collector =
    new CalibrationCollector();

  private readonly model =
    new CalibrationModel();

  private calibrationId:
    CalibrationId | null =
      null;

  private viewport:
    Size2D | null =
      null;

  private activePoint:
    CalibrationTarget | null =
      null;

  private cleanedPoints:
    CalibrationCleanedPoint[] = [];

  private validation:
    CalibrationValidationResult | null =
      null;

  private faceBaseline:
    FaceBaseline | null = null;

  public start(
    calibrationId: CalibrationId,
    model: CalibrationResidualModel,
    viewport: Size2D,
    expectedPointCount: number,
    faceBaseline: FaceBaseline | null = null
  ): void {
    if (
      calibrationId.trim().length === 0
      || !Number.isInteger(expectedPointCount)
      || expectedPointCount
        < CALIBRATION.MIN_VALIDATION_POINT_COUNT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Validation startup metadata is invalid."
      );
    }

    assertViewport(viewport);

    this.collector.reset();
    this.model.setModel(model);

    this.calibrationId =
      calibrationId;

    this.viewport = {
      ...viewport
    };

    this.expectedPointCount =
      expectedPointCount;

    this.activePoint = null;
    this.cleanedPoints = [];
    this.validation = null;
    this.faceBaseline =
      faceBaseline === null
        ? null
        : {
            ...faceBaseline,
            headPose: {
              ...faceBaseline.headPose
            }
          };
  }

  private expectedPointCount = 0;

  public beginPoint(
    calibrationId: CalibrationId,
    target: CalibrationTarget,
    targetShownAtMs: TimestampMs
  ): void {
    this.assertActiveValidation(
      calibrationId
    );

    if (this.validation !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation is already complete."
      );
    }

    if (this.activePoint !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A validation point is already being collected."
      );
    }

    const expectedPointIndex =
      this.cleanedPoints.length;

    if (
      !isFiniteTarget(target)
      || target.pointIndex
        !== expectedPointIndex
      || target.pointIndex
        >= this.expectedPointCount
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Validation target is invalid or out of sequence.",
        {
          details: {
            requestedPointIndex:
              target.pointIndex,
            expectedPointIndex,
            expectedPointCount:
              this.expectedPointCount
          }
        }
      );
    }

    this.activePoint = {
      pointIndex:
        target.pointIndex,
      normalizedPoint: {
        ...target.normalizedPoint
      },
      viewportPoint: {
        ...target.viewportPoint
      }
    };

    this.collector.beginPoint(
      calibrationId,
      this.activePoint,
      targetShownAtMs,
      this.faceBaseline
    );
  }

  public observe(
    observation: CalibrationObservation
  ): CalibrationSampleDecision {
    return this.collector.observe(
      observation
    );
  }

  public finishActivePoint(
    timestampMs: TimestampMs
  ): ValidationManagerPointResult {
    const calibrationId =
      this.calibrationId;

    const activePoint =
      this.activePoint;

    if (
      calibrationId === null
      || activePoint === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation has no active point to finish."
      );
    }

    const collection =
      this.collector.finishPoint(
        timestampMs
      );

    if (!collection.sufficient) {
      const failureReason:
        ValidationPointFailureReason =
          collection.stability?.stable === false
          || (
            collection.acceptedSampleCount
              >= CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT
            && collection.stability === null
          )
            ? "UNSTABLE_GAZE"
            : "INSUFFICIENT_SAMPLES";

      return this.completeInsufficientPoint(
        activePoint,
        collection.acceptedSampleCount,
        collection.rejectedSampleCount,
        collection.rejectionRatio,
        failureReason
      );
    }

    let cleaned:
      CalibrationCleanedPoint;

    try {
      cleaned =
        cleanCalibrationPoint(
          collection
        );
    } catch (error: unknown) {
      if (
        isTrackerError(error)
        && error.code
          === ERROR_CODES
            .CALIBRATION_INSUFFICIENT_SAMPLES
      ) {
        return this.completeInsufficientPoint(
          activePoint,
          collection.acceptedSampleCount,
          collection.rejectedSampleCount,
          collection.rejectionRatio,
          "OUTLIER_REJECTION"
        );
      }

      throw error;
    }

    this.cleanedPoints.push(
      cleaned
    );

    this.activePoint = null;
    this.collector.reset();

    if (
      this.cleanedPoints.length
      === this.expectedPointCount
    ) {
      const viewport =
        this.viewport;

      if (viewport === null) {
        throw new TrackerError(
          ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
          "CALIBRATION",
          "Validation viewport disappeared before scoring."
        );
      }

      this.validation =
        validateCalibrationModel(
          this.model,
          this.cleanedPoints,
          viewport
        );
    }

    return {
      calibrationId,
      pointIndex:
        cleaned.pointIndex,
      sufficient: true,
      acceptedSampleCount:
        cleaned.acceptedSampleCount,
      rejectedSampleCount:
        cleaned.rejectedSampleCount,
      rejectionRatio:
        cleaned.rejectionRatio,
      completedPointCount:
        this.cleanedPoints.length,
      expectedPointCount:
        this.expectedPointCount,
      failureReason: null,
      validationComplete:
        this.validation !== null,
      validation:
        this.validation
    };
  }

  public getSnapshot():
  ValidationManagerSnapshot {
    return {
      calibrationId:
        this.calibrationId,
      active:
        this.calibrationId !== null,
      activePointIndex:
        this.activePoint?.pointIndex
        ?? null,
      completedPointCount:
        this.cleanedPoints.length,
      expectedPointCount:
        this.expectedPointCount,
      validationComplete:
        this.validation !== null
    };
  }

  public reset(): void {
    this.collector.reset();
    this.model.clear();

    this.calibrationId = null;
    this.viewport = null;
    this.activePoint = null;
    this.cleanedPoints = [];
    this.validation = null;
    this.expectedPointCount = 0;
  }

  private completeInsufficientPoint(
    activePoint: CalibrationTarget,
    acceptedSampleCount: number,
    rejectedSampleCount: number,
    rejectionRatio: number,
    failureReason:
      ValidationPointFailureReason
  ): ValidationManagerPointResult {
    const calibrationId =
      this.calibrationId;

    if (calibrationId === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration ID disappeared while finishing a validation point."
      );
    }

    this.activePoint = null;
    this.collector.reset();

    return {
      calibrationId,
      pointIndex:
        activePoint.pointIndex,
      sufficient: false,
      acceptedSampleCount,
      rejectedSampleCount,
      rejectionRatio,
      completedPointCount:
        this.cleanedPoints.length,
      expectedPointCount:
        this.expectedPointCount,
      failureReason,
      validationComplete: false,
      validation: null
    };
  }

  private assertActiveValidation(
    calibrationId: CalibrationId
  ): void {
    if (
      this.calibrationId === null
      || this.viewport === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation has not been started."
      );
    }

    if (
      calibrationId
      !== this.calibrationId
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Validation point belongs to a different calibration run."
      );
    }
  }
}
