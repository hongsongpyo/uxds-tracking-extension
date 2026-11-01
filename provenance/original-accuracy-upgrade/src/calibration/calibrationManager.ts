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

import { sameCalibrationTarget } from "./calibrationTargetGroups";

import type {
  CalibrationResidualModel
} from "./calibrationModel";

import type {
  CalibrationObservation,
  CalibrationSampleDecision
} from "./calibrationCollector";

import type {
  CalibrationCleanedPoint
} from "./calibrationCleaner";

import type {
  CalibrationStabilityMetrics
} from "./calibrationStability";

import type {
  CalibrationId,
  CalibrationMode,
  CalibrationTarget,
  CalibrationTrainingDiagnostics,
  FaceBaseline,
  Point2D,
  TimestampMs
} from "../shared/types";

/* ========================================================================== 
 * Public result types
 * ======================================================================== */

export type CalibrationPointFailureReason =
  | "INSUFFICIENT_SAMPLES"
  | "UNSTABLE_GAZE"
  | "OUTLIER_REJECTION";

export interface CalibrationManagerPointResult {
  readonly calibrationId: CalibrationId;
  readonly pointIndex: number;
  readonly sufficient: boolean;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly rejectionRatio: number;
  readonly completedPointCount: number;
  readonly expectedPointCount: number;
  readonly failureReason:
    CalibrationPointFailureReason | null;
  readonly stableWindowStartTimestampMs:
    number | null;
  readonly stableWindowEndTimestampMs:
    number | null;
  readonly stability:
    CalibrationStabilityMetrics | null;
  readonly modelReady: boolean;
  readonly trainingRmseNormalized:
    number | null;
  readonly trainingDiagnostics:
    CalibrationTrainingDiagnostics | null;
  readonly model:
    CalibrationResidualModel | null;
  /**
   * Additional calibration targets selected from calibration-only diagnostics.
   * Normally empty; populated by TrackerRuntime only on the provisional
   * STANDARD_17 completion that triggers adaptive expansion.
   */
  readonly adaptiveExpansionTargets:
    readonly CalibrationTarget[];
}


export type CalibrationGroupedCvSpatialBucket =
  | "CENTER"
  | "EDGE"
  | "CORNER";

export interface CalibrationGroupedCvPointResult {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly predictedNormalizedPoint: Point2D;
  readonly predictedViewportPoint: Point2D;
  readonly errorPx: number;
  readonly spatialBucket: CalibrationGroupedCvSpatialBucket;
}

export interface CalibrationGroupedCvDiagnostics {
  readonly pointCount: number;
  readonly meanErrorPx: number;
  readonly p95ErrorPx: number;
  readonly rmsePx: number;
  readonly pointResults: readonly CalibrationGroupedCvPointResult[];
}

export interface CalibrationManagerSnapshot {
  readonly calibrationId:
    CalibrationId | null;
  readonly mode:
    CalibrationMode | null;
  readonly active: boolean;
  readonly activePointIndex:
    number | null;
  readonly completedPointCount: number;
  readonly expectedPointCount: number;
  readonly modelReady: boolean;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function getExpectedPointCount(
  mode: CalibrationMode
): number {
  switch (mode) {
    case "STANDARD_17":
      return CALIBRATION.STANDARD_POINT_COUNT;

    case "PRECISION_25":
      return CALIBRATION.PRECISION_POINT_COUNT;
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

function mean(
  values: readonly number[]
): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration training diagnostics require at least one value."
    );
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
}

function percentile(
  values: readonly number[],
  probability: number
): number {
  if (
    values.length === 0
    || probability < 0
    || probability > 1
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration training diagnostic percentile request is invalid."
    );
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration training diagnostic percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function createTrainingDiagnostics(
  points: readonly CalibrationCleanedPoint[],
  model: CalibrationModel
): CalibrationTrainingDiagnostics {
  const rawErrors: number[] = [];
  const correctedErrors: number[] = [];

  for (const point of points) {
    const normalizedTarget = point.targetNormalizedPoint;

    if (
      normalizedTarget.x <= 0
      || normalizedTarget.y <= 0
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration training diagnostics cannot infer viewport size from a zero target coordinate.",
        {
          details: {
            pointIndex: point.pointIndex
          }
        }
      );
    }

    const viewportWidth =
      point.targetViewportPoint.x
      / normalizedTarget.x;

    const viewportHeight =
      point.targetViewportPoint.y
      / normalizedTarget.y;

    if (
      !Number.isFinite(viewportWidth)
      || !Number.isFinite(viewportHeight)
      || viewportWidth <= 0
      || viewportHeight <= 0
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration training diagnostics inferred an invalid viewport size.",
        {
          details: {
            pointIndex: point.pointIndex
          }
        }
      );
    }

    const raw = point.representativeRawPoint;
    const corrected = model.predict(raw);

    const rawErrorPx = Math.hypot(
      raw.x * viewportWidth
        - point.targetViewportPoint.x,
      raw.y * viewportHeight
        - point.targetViewportPoint.y
    );

    const correctedErrorPx = Math.hypot(
      corrected.x * viewportWidth
        - point.targetViewportPoint.x,
      corrected.y * viewportHeight
        - point.targetViewportPoint.y
    );

    rawErrors.push(rawErrorPx);
    correctedErrors.push(correctedErrorPx);
  }

  const improvements = rawErrors.map(
    (rawError, index) =>
      rawError - (correctedErrors[index] ?? rawError)
  );

  return {
    pointCount: points.length,
    rawMeanErrorPx: mean(rawErrors),
    rawP95ErrorPx: percentile(rawErrors, 0.95),
    rawRmsePx: Math.sqrt(
      mean(rawErrors.map((error) => error * error))
    ),
    correctedMeanErrorPx: mean(correctedErrors),
    correctedP95ErrorPx: percentile(correctedErrors, 0.95),
    correctedRmsePx: Math.sqrt(
      mean(correctedErrors.map((error) => error * error))
    ),
    meanCorrectionImprovementPx: mean(improvements),
    improvedPointCount:
      improvements.filter((value) => value > 0).length,
    degradedPointCount:
      improvements.filter((value) => value < 0).length,
    unchangedPointCount:
      improvements.filter((value) => value === 0).length
  };
}


function classifyGroupedCvSpatialBucket(
  point: Point2D
): CalibrationGroupedCvSpatialBucket {
  const horizontalOuter =
    point.x <= 0.33 || point.x >= 0.67;

  const verticalOuter =
    point.y <= 0.33 || point.y >= 0.67;

  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }

  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }

  return "CENTER";
}

function inferPointViewportSize(
  point: CalibrationCleanedPoint
): { readonly width: number; readonly height: number } {
  const normalized = point.targetNormalizedPoint;
  const viewport = point.targetViewportPoint;

  const width = normalized.x > 0
    ? viewport.x / normalized.x
    : Number.NaN;

  const height = normalized.y > 0
    ? viewport.y / normalized.y
    : Number.NaN;

  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Grouped calibration cross-validation could not infer the viewport size.",
      {
        details: {
          pointIndex: point.pointIndex
        }
      }
    );
  }

  return { width, height };
}

/* ========================================================================== 
 * Manager
 * ======================================================================== */

/**
 * Owns one calibration run inside the Offscreen runtime.
 *
 * The manager intentionally does not know about DOM/UI messaging. It only
 * coordinates the point collector, robust point cleaning, and the personal
 * residual model. This keeps calibration math independent from Chrome UI.
 */
export class CalibrationManager {
  private readonly collector =
    new CalibrationCollector();

  private readonly model =
    new CalibrationModel();

  private calibrationId:
    CalibrationId | null =
      null;

  private mode:
    CalibrationMode | null =
      null;

  private expectedPointCount = 0;

  private activePoint:
    CalibrationTarget | null =
      null;

  private cleanedPoints:
    CalibrationCleanedPoint[] = [];

  private faceBaseline:
    FaceBaseline | null = null;

  public start(
    calibrationId: CalibrationId,
    mode: CalibrationMode,
    faceBaseline: FaceBaseline | null = null
  ): void {
    if (calibrationId.trim().length === 0) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Calibration run requires a non-empty calibration ID."
      );
    }

    this.collector.reset();
    this.model.clear();

    this.calibrationId =
      calibrationId;

    this.mode = mode;

    this.expectedPointCount =
      getExpectedPointCount(mode);

    this.activePoint = null;
    this.cleanedPoints = [];
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

  /**
   * Opens a maintenance-calibration extension while preserving every original
   * cleaned point. The currently installed ResidualCorrector keeps serving the
   * previous model until the additional points have all been collected and a
   * new model is fitted.
   */
  /** A detached copy: an unvalidated maintenance fit must not mutate the live model. */
  public forkForQuickRecalibration(): CalibrationManager {
    if (this.calibrationId === null || this.mode === null
      || this.activePoint !== null || this.model.getModel() === null) {
      throw new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION, "CALIBRATION",
        "A fitted, idle calibration is required to create a maintenance candidate.");
    }
    const originalModel = this.model.getModel();
    if (originalModel === null) {
      throw new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION, "CALIBRATION",
        "Cannot copy a calibration without a fitted model.");
    }
    const candidate = new CalibrationManager();
    candidate.calibrationId = this.calibrationId;
    candidate.mode = this.mode;
    candidate.expectedPointCount = this.expectedPointCount;
    candidate.cleanedPoints = [...this.cleanedPoints];
    candidate.faceBaseline = this.faceBaseline === null ? null : {
      ...this.faceBaseline, headPose: {...this.faceBaseline.headPose}
    };
    candidate.model.setModel(originalModel);
    return candidate;
  }

  public beginIncrementalCalibration(
    additionalPointCount: number
  ): {
    readonly startingPointIndex: number;
    readonly expectedPointCount: number;
  } {
    if (
      this.calibrationId === null
      || this.mode === null
      || this.activePoint !== null
      || this.model.getModel() === null
      || !Number.isInteger(additionalPointCount)
      || additionalPointCount <= 0
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration cannot extend the current calibration state."
      );
    }

    const startingPointIndex = this.cleanedPoints.length;
    this.expectedPointCount = startingPointIndex + additionalPointCount;

    // The previous ResidualCorrector remains installed outside this manager.
    // Clearing only the manager-owned fit prevents modelReady from becoming
    // true until all maintenance points have been incorporated.
    this.model.clear();

    return {
      startingPointIndex,
      expectedPointCount: this.expectedPointCount
    };
  }

  /**
   * Extends an active STANDARD_17 run with a balanced subset of the remaining
   * PRECISION_25 lattice points. The provisional fitted residual is cleared so
   * modelReady cannot become true again until every selected extra point has
   * been collected and the model has been refit on the full calibration set.
   */
  public extendExpectedPointCount(
    nextExpectedPointCount: number
  ): void {
    if (
      this.calibrationId === null
      || this.mode !== "STANDARD_17"
      || this.activePoint !== null
      || !Number.isInteger(nextExpectedPointCount)
      || nextExpectedPointCount <= this.expectedPointCount
      || nextExpectedPointCount > CALIBRATION.PRECISION_POINT_COUNT
      || this.cleanedPoints.length !== this.expectedPointCount
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Adaptive calibration expansion request is invalid for the current run.",
        {
          details: {
            mode: this.mode,
            completedPointCount: this.cleanedPoints.length,
            currentExpectedPointCount: this.expectedPointCount,
            requestedExpectedPointCount: nextExpectedPointCount
          }
        }
      );
    }

    this.expectedPointCount = nextExpectedPointCount;
    this.model.clear();
  }

  public beginPoint(
    calibrationId: CalibrationId,
    target: CalibrationTarget,
    targetShownAtMs: TimestampMs
  ): void {
    this.assertActiveCalibration(
      calibrationId
    );

    if (this.activePoint !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A calibration point is already being collected.",
        {
          details: {
            activePointIndex:
              this.activePoint.pointIndex,
            requestedPointIndex:
              target.pointIndex
          }
        }
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
        "Calibration target is invalid or out of sequence.",
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
  ): CalibrationManagerPointResult {
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
        "Calibration has no active point to finish."
      );
    }

    const collection =
      this.collector.finishPoint(
        timestampMs
      );

    if (!collection.sufficient) {
      const failureReason:
        CalibrationPointFailureReason =
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
        failureReason,
        collection.stability
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

    let fittedModel:
      CalibrationResidualModel | null =
        null;

    let trainingDiagnostics:
      CalibrationTrainingDiagnostics | null =
        null;

    if (
      this.cleanedPoints.length
      === this.expectedPointCount
    ) {
      fittedModel =
        this.model.fit(
          this.cleanedPoints
        );

      trainingDiagnostics =
        createTrainingDiagnostics(
          this.cleanedPoints,
          this.model
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
      stableWindowStartTimestampMs:
        cleaned.stableWindowStartTimestampMs ?? null,
      stableWindowEndTimestampMs:
        cleaned.stableWindowEndTimestampMs ?? null,
      stability:
        cleaned.stability ?? null,
      modelReady:
        fittedModel !== null,
      trainingRmseNormalized:
        fittedModel
          ?.trainingRmseNormalized
        ?? null,
      trainingDiagnostics,
      model:
        fittedModel,
      adaptiveExpansionTargets: []
    };
  }

  public getSnapshot():
  CalibrationManagerSnapshot {
    return {
      calibrationId:
        this.calibrationId,
      mode:
        this.mode,
      active:
        this.calibrationId !== null,
      activePointIndex:
        this.activePoint?.pointIndex
        ?? null,
      completedPointCount:
        this.cleanedPoints.length,
      expectedPointCount:
        this.expectedPointCount,
      modelReady:
        this.model.getModel() !== null
    };
  }

  public getModel():
  CalibrationResidualModel | null {
    return this.model.getModel();
  }

  /**
   * Leave-one-calibration-point-out diagnostics for the established
   * WebEyeTrack residual path. This is calibration-only evidence and is
   * safe to use for a later hybrid selector without touching independent
   * validation targets.
   */
  public getGroupedCrossValidationDiagnostics():
  CalibrationGroupedCvDiagnostics {
    const points = [...this.cleanedPoints];

    if (
      points.length
        < CALIBRATION.MIN_MODEL_POINT_COUNT + 1
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few calibration points are available for grouped residual cross-validation.",
        {
          details: {
            pointCount: points.length,
            requiredPointCount:
              CALIBRATION.MIN_MODEL_POINT_COUNT + 1
          }
        }
      );
    }

    const pointResults:
      CalibrationGroupedCvPointResult[] = [];

    for (
      let heldOutIndex = 0;
      heldOutIndex < points.length;
      heldOutIndex += 1
    ) {
      const heldOut = points[heldOutIndex];

      if (heldOut === undefined) {
        continue;
      }

      // A later maintenance visit may revisit the same screen anchor.
      // Hold out *every* visit to that anchor to avoid target-label leakage.
      const training = points.filter(
        (point) => !sameCalibrationTarget(
          point.targetNormalizedPoint, heldOut.targetNormalizedPoint
        )
      );

      const foldModel = new CalibrationModel();
      foldModel.fit(training);

      const predictedNormalizedPoint =
        foldModel.predict(heldOut.representativeRawPoint);

      const viewport =
        inferPointViewportSize(heldOut);

      const predictedViewportPoint = {
        x: predictedNormalizedPoint.x * viewport.width,
        y: predictedNormalizedPoint.y * viewport.height
      };

      const errorPx = Math.hypot(
        predictedViewportPoint.x
          - heldOut.targetViewportPoint.x,
        predictedViewportPoint.y
          - heldOut.targetViewportPoint.y
      );

      pointResults.push({
        pointIndex: heldOut.pointIndex,
        targetNormalizedPoint: {
          ...heldOut.targetNormalizedPoint
        },
        targetViewportPoint: {
          ...heldOut.targetViewportPoint
        },
        predictedNormalizedPoint,
        predictedViewportPoint,
        errorPx,
        spatialBucket:
          classifyGroupedCvSpatialBucket(
            heldOut.targetNormalizedPoint
          )
      });
    }

    const errors = pointResults.map(
      (point) => point.errorPx
    );

    return {
      pointCount: pointResults.length,
      meanErrorPx: mean(errors),
      p95ErrorPx: percentile(errors, 0.95),
      rmsePx: Math.sqrt(
        mean(errors.map((error) => error * error))
      ),
      pointResults
    };
  }


  public reset(): void {
    this.collector.reset();
    this.model.clear();

    this.calibrationId = null;
    this.mode = null;
    this.expectedPointCount = 0;
    this.activePoint = null;
    this.cleanedPoints = [];
    this.faceBaseline = null;
  }

  /**
   * Replaces the project-owned residual model after an engine-level
   * personalization step. Used to install an identity residual so the native
   * WebEyeTrack correction is not double-corrected during validation.
   */
  public setModel(
    model: CalibrationResidualModel
  ): void {
    this.model.setModel(model);
  }

  private completeInsufficientPoint(
    activePoint: CalibrationTarget,
    acceptedSampleCount: number,
    rejectedSampleCount: number,
    rejectionRatio: number,
    failureReason:
      CalibrationPointFailureReason,
    stability:
      CalibrationStabilityMetrics | null = null
  ): CalibrationManagerPointResult {
    const calibrationId =
      this.calibrationId;

    if (calibrationId === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration ID disappeared while finishing a point."
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
      stableWindowStartTimestampMs: null,
      stableWindowEndTimestampMs: null,
      stability,
      modelReady: false,
      trainingRmseNormalized: null,
      trainingDiagnostics: null,
      model: null,
      adaptiveExpansionTargets: []
    };
  }

  private assertActiveCalibration(
    calibrationId: CalibrationId
  ): void {
    if (
      this.calibrationId === null
      || this.mode === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration has not been started."
      );
    }

    if (
      calibrationId
      !== this.calibrationId
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "CALIBRATION",
        "Calibration point belongs to a different calibration run.",
        {
          details: {
            expectedCalibrationId:
              this.calibrationId,
            receivedCalibrationId:
              calibrationId
          }
        }
      );
    }
  }
}
