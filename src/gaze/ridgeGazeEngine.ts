import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import type {
  GazePrediction,
  Point2D
} from "../shared/types";

import type {
  GazeEngine,
  GazeEngineFrameInput,
  GazeEngineLifecycle,
  GazeEngineSnapshot
} from "./GazeEngine";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * Ridge model configuration
 * ======================================================================== */

const RIDGE_MODEL_VERSION = 1;

const DEFAULT_RIDGE_LAMBDA = 1;

const MIN_FEATURE_SCALE = 1e-6;

const MIN_PIVOT_ABS = 1e-10;

const MIN_TRAINING_SAMPLE_MULTIPLIER = 2;

export const RIDGE_GAZE_FEATURE_NAMES = [
  "LEFT_IRIS_HORIZONTAL_OFFSET",
  "LEFT_IRIS_VERTICAL_OFFSET",
  "RIGHT_IRIS_HORIZONTAL_OFFSET",
  "RIGHT_IRIS_VERTICAL_OFFSET",
  "MEAN_IRIS_HORIZONTAL_OFFSET",
  "MEAN_IRIS_VERTICAL_OFFSET",
  "IRIS_HORIZONTAL_DISPARITY",
  "IRIS_VERTICAL_DISPARITY",
  "FACE_CENTER_X",
  "FACE_CENTER_Y",
  "FACE_WIDTH_RATIO",
  "FACE_HEIGHT_RATIO",
  "FACE_DISTANCE_RATIO",
  "HEAD_YAW_DEG",
  "HEAD_PITCH_DEG",
  "HEAD_ROLL_DEG"
] as const;

export type RidgeGazeFeatureName =
  (typeof RIDGE_GAZE_FEATURE_NAMES)[number];

const RIDGE_FEATURE_COUNT =
  RIDGE_GAZE_FEATURE_NAMES.length;

const RIDGE_COEFFICIENT_COUNT =
  RIDGE_FEATURE_COUNT + 1;

const MIN_TRAINING_SAMPLE_COUNT =
  RIDGE_COEFFICIENT_COUNT
  * MIN_TRAINING_SAMPLE_MULTIPLIER;

/* ========================================================================== 
 * Public model/training types
 * ======================================================================== */

/**
 * Serializable project-owned Ridge model.
 *
 * `coefficientX` and `coefficientY` include the intercept as element 0,
 * followed by one coefficient for each entry in `featureNames`.
 */
export interface RidgeGazeModelState {
  readonly version: number;

  readonly featureNames:
    readonly RidgeGazeFeatureName[];

  readonly featureMean:
    readonly number[];

  readonly featureScale:
    readonly number[];

  readonly coefficientX:
    readonly number[];

  readonly coefficientY:
    readonly number[];

  readonly ridgeLambda: number;

  readonly trainingSampleCount: number;

  /**
   * Root-mean-square Euclidean error in normalized viewport coordinates.
   */
  readonly trainingRmse: number;
}

/**
 * Transient labeled frame used to fit the fallback gaze model.
 *
 * The engine consumes this synchronously during `fit()` and never stores the
 * webcam frame or the full `GazeEngineFrameInput` afterward.
 */
export interface RidgeGazeTrainingSample {
  readonly input:
    GazeEngineFrameInput;

  readonly targetNormalizedPoint:
    Point2D;
}

export interface RidgeGazeEngineSnapshot
  extends GazeEngineSnapshot {
  readonly modelReady: boolean;

  readonly trainingSampleCount: number;

  readonly trainingRmse:
    number | null;
}

/* ========================================================================== 
 * Internal training types
 * ======================================================================== */

interface PreparedTrainingSample {
  readonly features:
    readonly number[];

  readonly target:
    Point2D;
}

interface RidgeAxisFit {
  readonly coefficients:
    readonly number[];
}

/* ========================================================================== 
 * Generic helpers
 * ======================================================================== */

function clamp01(
  value: number
): number {
  return Math.min(
    1,
    Math.max(
      0,
      value
    )
  );
}

function isFinitePoint(
  point: Point2D
): boolean {
  return (
    Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function isNormalizedTarget(
  point: Point2D
): boolean {
  return (
    isFinitePoint(point)
    && point.x >= 0
    && point.x <= 1
    && point.y >= 0
    && point.y <= 1
  );
}

function allFinite(
  values: readonly number[]
): boolean {
  return values.every(
    (value) => Number.isFinite(value)
  );
}

function arraysEqual(
  first: readonly string[],
  second: readonly string[]
): boolean {
  if (first.length !== second.length) {
    return false;
  }

  for (
    let index = 0;
    index < first.length;
    index += 1
  ) {
    if (first[index] !== second[index]) {
      return false;
    }
  }

  return true;
}

/* ========================================================================== 
 * Frame validation / feature extraction
 * ======================================================================== */

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
        "Ridge gaze engine received unsynchronized frame analysis results.",
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

function extractFeatures(
  input: GazeEngineFrameInput
): readonly number[] | null {
  const faceGeometry =
    input.faceGeometry.geometry;

  const headPose =
    input.headPose.headPose;

  const leftEye =
    input.eyeGeometry.leftEye;

  const rightEye =
    input.eyeGeometry.rightEye;

  if (
    faceGeometry === null
    || headPose === null
    || leftEye === null
    || rightEye === null
  ) {
    return null;
  }

  const meanHorizontalOffset =
    (
      leftEye.irisHorizontalOffsetRatio
      + rightEye.irisHorizontalOffsetRatio
    ) / 2;

  const meanVerticalOffset =
    (
      leftEye.irisVerticalOffsetRatio
      + rightEye.irisVerticalOffsetRatio
    ) / 2;

  const features: readonly number[] = [
    leftEye.irisHorizontalOffsetRatio,
    leftEye.irisVerticalOffsetRatio,
    rightEye.irisHorizontalOffsetRatio,
    rightEye.irisVerticalOffsetRatio,
    meanHorizontalOffset,
    meanVerticalOffset,
    leftEye.irisHorizontalOffsetRatio
      - rightEye.irisHorizontalOffsetRatio,
    leftEye.irisVerticalOffsetRatio
      - rightEye.irisVerticalOffsetRatio,
    faceGeometry.centerNormalized.x,
    faceGeometry.centerNormalized.y,
    faceGeometry.widthRatio,
    faceGeometry.heightRatio,
    input.faceQuality
      .trackingQuality
      .faceDistanceRatio,
    headPose.yawDeg,
    headPose.pitchDeg,
    headPose.rollDeg
  ];

  if (
    features.length !== RIDGE_FEATURE_COUNT
    || !allFinite(features)
  ) {
    return null;
  }

  return features;
}

/* ========================================================================== 
 * Standardization
 * ======================================================================== */

function calculateFeatureMean(
  samples:
    readonly PreparedTrainingSample[]
): readonly number[] {
  const mean =
    new Array<number>(
      RIDGE_FEATURE_COUNT
    ).fill(0);

  for (const sample of samples) {
    for (
      let featureIndex = 0;
      featureIndex < RIDGE_FEATURE_COUNT;
      featureIndex += 1
    ) {
      mean[featureIndex] =
        (mean[featureIndex] ?? 0)
        + (sample.features[featureIndex] ?? 0);
    }
  }

  return mean.map(
    (sum) => sum / samples.length
  );
}

function calculateFeatureScale(
  samples:
    readonly PreparedTrainingSample[],
  mean:
    readonly number[]
): readonly number[] {
  const varianceSum =
    new Array<number>(
      RIDGE_FEATURE_COUNT
    ).fill(0);

  for (const sample of samples) {
    for (
      let featureIndex = 0;
      featureIndex < RIDGE_FEATURE_COUNT;
      featureIndex += 1
    ) {
      const value =
        sample.features[featureIndex] ?? 0;

      const featureMean =
        mean[featureIndex] ?? 0;

      const difference =
        value - featureMean;

      varianceSum[featureIndex] =
        (varianceSum[featureIndex] ?? 0)
        + difference * difference;
    }
  }

  return varianceSum.map(
    (sum) => {
      const standardDeviation =
        Math.sqrt(
          sum / samples.length
        );

      return Math.max(
        standardDeviation,
        MIN_FEATURE_SCALE
      );
    }
  );
}

function standardizeFeatures(
  features: readonly number[],
  mean: readonly number[],
  scale: readonly number[]
): readonly number[] | null {
  if (
    features.length !== RIDGE_FEATURE_COUNT
    || mean.length !== RIDGE_FEATURE_COUNT
    || scale.length !== RIDGE_FEATURE_COUNT
  ) {
    return null;
  }

  const standardized =
    new Array<number>(
      RIDGE_COEFFICIENT_COUNT
    );

  standardized[0] = 1;

  for (
    let featureIndex = 0;
    featureIndex < RIDGE_FEATURE_COUNT;
    featureIndex += 1
  ) {
    const value =
      features[featureIndex];

    const featureMean =
      mean[featureIndex];

    const featureScale =
      scale[featureIndex];

    if (
      value === undefined
      || featureMean === undefined
      || featureScale === undefined
      || !Number.isFinite(value)
      || !Number.isFinite(featureMean)
      || !Number.isFinite(featureScale)
      || featureScale < MIN_FEATURE_SCALE
    ) {
      return null;
    }

    standardized[featureIndex + 1] =
      (value - featureMean)
      / featureScale;
  }

  return allFinite(standardized)
    ? standardized
    : null;
}

/* ========================================================================== 
 * Ridge regression math
 * ======================================================================== */

function buildNormalEquation(
  designRows: readonly (readonly number[])[],
  targetValues: readonly number[],
  ridgeLambda: number
): {
  readonly matrix: number[][];
  readonly vector: number[];
} {
  const matrix =
    Array.from(
      {
        length:
          RIDGE_COEFFICIENT_COUNT
      },
      () => new Array<number>(
        RIDGE_COEFFICIENT_COUNT
      ).fill(0)
    );

  const vector =
    new Array<number>(
      RIDGE_COEFFICIENT_COUNT
    ).fill(0);

  for (
    let sampleIndex = 0;
    sampleIndex < designRows.length;
    sampleIndex += 1
  ) {
    const row =
      designRows[sampleIndex];

    const target =
      targetValues[sampleIndex];

    if (
      row === undefined
      || target === undefined
    ) {
      continue;
    }

    for (
      let column = 0;
      column < RIDGE_COEFFICIENT_COUNT;
      column += 1
    ) {
      const columnValue =
        row[column] ?? 0;

      vector[column] =
        (vector[column] ?? 0)
        + columnValue * target;

      const matrixRow =
        matrix[column];

      if (matrixRow === undefined) {
        continue;
      }

      for (
        let innerColumn = 0;
        innerColumn < RIDGE_COEFFICIENT_COUNT;
        innerColumn += 1
      ) {
        const innerValue =
          row[innerColumn] ?? 0;

        matrixRow[innerColumn] =
          (matrixRow[innerColumn] ?? 0)
          + columnValue * innerValue;
      }
    }
  }

  for (
    let diagonal = 1;
    diagonal < RIDGE_COEFFICIENT_COUNT;
    diagonal += 1
  ) {
    const row =
      matrix[diagonal];

    if (row !== undefined) {
      row[diagonal] =
        (row[diagonal] ?? 0)
        + ridgeLambda;
    }
  }

  return {
    matrix,
    vector
  };
}

function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  vector: readonly number[]
): readonly number[] | null {
  const size =
    vector.length;

  if (
    size === 0
    || matrix.length !== size
  ) {
    return null;
  }

  const augmented =
    matrix.map(
      (row, rowIndex) => {
        if (row.length !== size) {
          return [];
        }

        const target =
          vector[rowIndex];

        if (target === undefined) {
          return [];
        }

        return [
          ...row,
          target
        ];
      }
    );

  if (
    augmented.some(
      (row) => row.length !== size + 1
    )
  ) {
    return null;
  }

  for (
    let pivotColumn = 0;
    pivotColumn < size;
    pivotColumn += 1
  ) {
    let pivotRow =
      pivotColumn;

    let pivotAbs =
      Math.abs(
        augmented[pivotRow]?.[pivotColumn]
        ?? 0
      );

    for (
      let candidateRow = pivotColumn + 1;
      candidateRow < size;
      candidateRow += 1
    ) {
      const candidateAbs =
        Math.abs(
          augmented[candidateRow]?.[pivotColumn]
          ?? 0
        );

      if (candidateAbs > pivotAbs) {
        pivotAbs =
          candidateAbs;

        pivotRow =
          candidateRow;
      }
    }

    if (
      !Number.isFinite(pivotAbs)
      || pivotAbs < MIN_PIVOT_ABS
    ) {
      return null;
    }

    if (pivotRow !== pivotColumn) {
      const temporary =
        augmented[pivotColumn];

      const replacement =
        augmented[pivotRow];

      if (
        temporary === undefined
        || replacement === undefined
      ) {
        return null;
      }

      augmented[pivotColumn] =
        replacement;

      augmented[pivotRow] =
        temporary;
    }

    const normalizedPivotRow =
      augmented[pivotColumn];

    const pivotValue =
      normalizedPivotRow?.[pivotColumn];

    if (
      normalizedPivotRow === undefined
      || pivotValue === undefined
      || !Number.isFinite(pivotValue)
      || Math.abs(pivotValue)
        < MIN_PIVOT_ABS
    ) {
      return null;
    }

    for (
      let column = pivotColumn;
      column <= size;
      column += 1
    ) {
      const value =
        normalizedPivotRow[column];

      if (value === undefined) {
        return null;
      }

      normalizedPivotRow[column] =
        value / pivotValue;
    }

    for (
      let rowIndex = 0;
      rowIndex < size;
      rowIndex += 1
    ) {
      if (rowIndex === pivotColumn) {
        continue;
      }

      const row =
        augmented[rowIndex];

      const factor =
        row?.[pivotColumn];

      if (
        row === undefined
        || factor === undefined
        || !Number.isFinite(factor)
      ) {
        return null;
      }

      if (Math.abs(factor) < MIN_PIVOT_ABS) {
        continue;
      }

      for (
        let column = pivotColumn;
        column <= size;
        column += 1
      ) {
        const rowValue =
          row[column];

        const pivotRowValue =
          normalizedPivotRow[column];

        if (
          rowValue === undefined
          || pivotRowValue === undefined
        ) {
          return null;
        }

        row[column] =
          rowValue
          - factor * pivotRowValue;
      }
    }
  }

  const solution =
    new Array<number>(size);

  for (
    let rowIndex = 0;
    rowIndex < size;
    rowIndex += 1
  ) {
    const value =
      augmented[rowIndex]?.[size];

    if (
      value === undefined
      || !Number.isFinite(value)
    ) {
      return null;
    }

    solution[rowIndex] =
      value;
  }

  return solution;
}

function fitAxis(
  designRows: readonly (readonly number[])[],
  targetValues: readonly number[],
  ridgeLambda: number
): RidgeAxisFit | null {
  const equation =
    buildNormalEquation(
      designRows,
      targetValues,
      ridgeLambda
    );

  const coefficients =
    solveLinearSystem(
      equation.matrix,
      equation.vector
    );

  if (
    coefficients === null
    || coefficients.length
      !== RIDGE_COEFFICIENT_COUNT
    || !allFinite(coefficients)
  ) {
    return null;
  }

  return {
    coefficients
  };
}

function dotProduct(
  coefficients: readonly number[],
  designRow: readonly number[]
): number | null {
  if (
    coefficients.length
      !== RIDGE_COEFFICIENT_COUNT
    || designRow.length
      !== RIDGE_COEFFICIENT_COUNT
  ) {
    return null;
  }

  let sum = 0;

  for (
    let index = 0;
    index < RIDGE_COEFFICIENT_COUNT;
    index += 1
  ) {
    const coefficient =
      coefficients[index];

    const value =
      designRow[index];

    if (
      coefficient === undefined
      || value === undefined
    ) {
      return null;
    }

    sum +=
      coefficient * value;
  }

  return Number.isFinite(sum)
    ? sum
    : null;
}

function calculateTrainingRmse(
  designRows: readonly (readonly number[])[],
  targets: readonly Point2D[],
  coefficientX: readonly number[],
  coefficientY: readonly number[]
): number | null {
  let squaredDistanceSum = 0;

  for (
    let index = 0;
    index < designRows.length;
    index += 1
  ) {
    const row =
      designRows[index];

    const target =
      targets[index];

    if (
      row === undefined
      || target === undefined
    ) {
      return null;
    }

    const predictionX =
      dotProduct(
        coefficientX,
        row
      );

    const predictionY =
      dotProduct(
        coefficientY,
        row
      );

    if (
      predictionX === null
      || predictionY === null
    ) {
      return null;
    }

    const errorX =
      predictionX - target.x;

    const errorY =
      predictionY - target.y;

    squaredDistanceSum +=
      errorX * errorX
      + errorY * errorY;
  }

  const rmse =
    Math.sqrt(
      squaredDistanceSum
      / designRows.length
    );

  return Number.isFinite(rmse)
    ? rmse
    : null;
}

/* ========================================================================== 
 * Model validation / cloning
 * ======================================================================== */

function assertValidModel(
  model: RidgeGazeModelState
): void {
  if (model.version !== RIDGE_MODEL_VERSION) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Unsupported Ridge gaze model version.",
      {
        details: {
          expectedVersion:
            RIDGE_MODEL_VERSION,
          receivedVersion:
            model.version
        }
      }
    );
  }

  if (
    !arraysEqual(
      model.featureNames,
      RIDGE_GAZE_FEATURE_NAMES
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Ridge gaze model feature schema does not match this build."
    );
  }

  if (
    model.featureMean.length
      !== RIDGE_FEATURE_COUNT
    || model.featureScale.length
      !== RIDGE_FEATURE_COUNT
    || model.coefficientX.length
      !== RIDGE_COEFFICIENT_COUNT
    || model.coefficientY.length
      !== RIDGE_COEFFICIENT_COUNT
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Ridge gaze model has invalid vector dimensions."
    );
  }

  if (
    !allFinite(model.featureMean)
    || !allFinite(model.featureScale)
    || !allFinite(model.coefficientX)
    || !allFinite(model.coefficientY)
    || model.featureScale.some(
      (value) => value < MIN_FEATURE_SCALE
    )
    || !Number.isFinite(model.ridgeLambda)
    || model.ridgeLambda < 0
    || !Number.isInteger(
      model.trainingSampleCount
    )
    || model.trainingSampleCount < 1
    || !Number.isFinite(model.trainingRmse)
    || model.trainingRmse < 0
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "GAZE",
      "Ridge gaze model contains invalid numeric values."
    );
  }
}

function cloneModel(
  model: RidgeGazeModelState
): RidgeGazeModelState {
  return {
    version:
      model.version,

    featureNames:
      [...model.featureNames],

    featureMean:
      [...model.featureMean],

    featureScale:
      [...model.featureScale],

    coefficientX:
      [...model.coefficientX],

    coefficientY:
      [...model.coefficientY],

    ridgeLambda:
      model.ridgeLambda,

    trainingSampleCount:
      model.trainingSampleCount,

    trainingRmse:
      model.trainingRmse
  };
}

/* ========================================================================== 
 * Ridge gaze engine
 * ======================================================================== */

/**
 * Local fallback gaze estimator based on participant-specific Ridge
 * regression.
 *
 * The engine predicts normalized viewport coordinates from eye, face and head
 * geometry already computed by the Offscreen pipeline. It does not access the
 * DOM, send Chrome messages, retain webcam frames or apply gaze smoothing.
 *
 * A model may either be restored with `setModel()` or fitted from calibration
 * frames with `fit()`. Until a model is available, `predict()` returns null.
 */
export class RidgeGazeEngine implements GazeEngine {
  public readonly source =
    "RIDGE" as const;

  private lifecycle:
    GazeEngineLifecycle =
      "CREATED";

  private lastPredictionTimestampMs:
    number | null =
      null;

  private model:
    RidgeGazeModelState | null =
      null;

  public constructor(
    initialModel?: RidgeGazeModelState
  ) {
    if (initialModel !== undefined) {
      this.setModel(initialModel);
    }
  }

  public initialize(): Promise<void> {
    if (this.lifecycle === "READY") {
      return Promise.resolve();
    }

    if (this.lifecycle === "INITIALIZING") {
      return Promise.reject(
        new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "GAZE",
          "Ridge gaze engine is already initializing."
        )
      );
    }

    if (this.lifecycle === "DISPOSED") {
      return Promise.reject(
        new TrackerError(
          ERROR_CODES.INVALID_STATE_TRANSITION,
          "GAZE",
          "Disposed Ridge gaze engine cannot be initialized."
        )
      );
    }

    this.lifecycle =
      "INITIALIZING";

    this.lastPredictionTimestampMs =
      null;

    this.lifecycle =
      "READY";

    logger.info(
      "Ridge gaze engine initialized.",
      {
        modelReady:
          this.model !== null
      }
    );

    return Promise.resolve();
  }

  public predict(
    input: GazeEngineFrameInput
  ): Promise<GazePrediction | null> {
    try {
      this.assertReady();

      assertSynchronizedInput(input);

      if (
        this.model === null
        || !isInputUsableForPrediction(input)
      ) {
        return Promise.resolve(null);
      }

      const features =
        extractFeatures(input);

      if (features === null) {
        return Promise.resolve(null);
      }

      const designRow =
        standardizeFeatures(
          features,
          this.model.featureMean,
          this.model.featureScale
        );

      if (designRow === null) {
        return Promise.resolve(null);
      }

      const x =
        dotProduct(
          this.model.coefficientX,
          designRow
        );

      const y =
        dotProduct(
          this.model.coefficientY,
          designRow
        );

      const headPose =
        input.headPose.headPose;

      if (
        x === null
        || y === null
        || headPose === null
      ) {
        return Promise.resolve(null);
      }

      const faceQuality =
        clamp01(
          input.faceQuality
            .trackingQuality
            .qualityScore
        );

      const calibrationConfidence =
        1 / (
          1 + this.model.trainingRmse
        );

      const confidence =
        clamp01(
          faceQuality
          * calibrationConfidence
        );

      this.lastPredictionTimestampMs =
        input.frame.metadata.timestampMs;

      return Promise.resolve({
        timestampMs:
          input.frame.metadata.timestampMs,

        rawPoint: {
          x,
          y
        },

        rawSpace:
          "NORMALIZED",

        confidence,

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
      });
    } catch (error: unknown) {
      return Promise.reject(
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_PREDICTION_FAILED,
          "GAZE",
          "Ridge gaze prediction failed.",
          {
            details: {
              frameSequence:
                input.frame.metadata.frameSequence,
              timestampMs:
                input.frame.metadata.timestampMs
            }
          }
        )
      );
    }
  }

  /**
   * Fits a participant-specific model from labeled calibration frames.
   *
   * Invalid/blink/unsynchronized frames are not silently converted into
   * training rows. Unsynchronized data raises an error; ordinary unusable
   * gaze frames are rejected from the fit and the remaining count must still
   * satisfy `MIN_TRAINING_SAMPLE_COUNT`.
   */
  public fit(
    samples:
      readonly RidgeGazeTrainingSample[],
    ridgeLambda:
      number = DEFAULT_RIDGE_LAMBDA
  ): RidgeGazeModelState {
    this.assertNotDisposed();

    if (
      !Number.isFinite(ridgeLambda)
      || ridgeLambda < 0
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "GAZE",
        "Ridge lambda must be a finite non-negative number.",
        {
          details: {
            ridgeLambda
          }
        }
      );
    }

    const prepared:
      PreparedTrainingSample[] = [];

    for (const sample of samples) {
      if (
        !isNormalizedTarget(
          sample.targetNormalizedPoint
        )
      ) {
        throw new TrackerError(
          ERROR_CODES.GAZE_INVALID_SAMPLE,
          "GAZE",
          "Ridge training target must be a normalized 0..1 viewport point.",
          {
            details: {
              target:
                sample.targetNormalizedPoint
            }
          }
        );
      }

      assertSynchronizedInput(
        sample.input
      );

      if (
        !isInputUsableForPrediction(
          sample.input
        )
      ) {
        continue;
      }

      const features =
        extractFeatures(
          sample.input
        );

      if (features === null) {
        continue;
      }

      prepared.push({
        features,
        target: {
          x:
            sample.targetNormalizedPoint.x,
          y:
            sample.targetNormalizedPoint.y
        }
      });
    }

    if (
      prepared.length
        < MIN_TRAINING_SAMPLE_COUNT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "GAZE",
        "Not enough valid calibration frames to fit the Ridge gaze model.",
        {
          details: {
            required:
              MIN_TRAINING_SAMPLE_COUNT,
            received:
              prepared.length,
            submitted:
              samples.length
          }
        }
      );
    }

    const featureMean =
      calculateFeatureMean(
        prepared
      );

    const featureScale =
      calculateFeatureScale(
        prepared,
        featureMean
      );

    const designRows:
      readonly (readonly number[])[] =
        prepared.map(
          (sample) => {
            const row =
              standardizeFeatures(
                sample.features,
                featureMean,
                featureScale
              );

            if (row === null) {
              throw new TrackerError(
                ERROR_CODES.CALIBRATION_MODEL_FAILED,
                "GAZE",
                "Failed to standardize Ridge gaze training features."
              );
            }

            return row;
          }
        );

    const targets =
      prepared.map(
        (sample) => sample.target
      );

    const targetX =
      targets.map(
        (target) => target.x
      );

    const targetY =
      targets.map(
        (target) => target.y
      );

    const xFit =
      fitAxis(
        designRows,
        targetX,
        ridgeLambda
      );

    const yFit =
      fitAxis(
        designRows,
        targetY,
        ridgeLambda
      );

    if (
      xFit === null
      || yFit === null
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "GAZE",
        "Ridge gaze model fitting failed because the regression system is singular or invalid."
      );
    }

    const trainingRmse =
      calculateTrainingRmse(
        designRows,
        targets,
        xFit.coefficients,
        yFit.coefficients
      );

    if (trainingRmse === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "GAZE",
        "Ridge gaze model produced an invalid training RMSE."
      );
    }

    const model:
      RidgeGazeModelState = {
        version:
          RIDGE_MODEL_VERSION,

        featureNames:
          [...RIDGE_GAZE_FEATURE_NAMES],

        featureMean:
          [...featureMean],

        featureScale:
          [...featureScale],

        coefficientX:
          [...xFit.coefficients],

        coefficientY:
          [...yFit.coefficients],

        ridgeLambda,

        trainingSampleCount:
          prepared.length,

        trainingRmse
      };

    assertValidModel(model);

    this.model =
      cloneModel(model);

    logger.info(
      "Ridge gaze model fitted.",
      {
        trainingSampleCount:
          model.trainingSampleCount,
        trainingRmse:
          model.trainingRmse,
        ridgeLambda:
          model.ridgeLambda
      }
    );

    return cloneModel(model);
  }

  public setModel(
    model: RidgeGazeModelState
  ): void {
    this.assertNotDisposed();

    assertValidModel(model);

    this.model =
      cloneModel(model);

    this.lastPredictionTimestampMs =
      null;
  }

  public getModel():
  RidgeGazeModelState | null {
    return this.model === null
      ? null
      : cloneModel(this.model);
  }

  public clearModel(): void {
    this.assertNotDisposed();

    this.model =
      null;

    this.lastPredictionTimestampMs =
      null;
  }

  public getSnapshot():
  RidgeGazeEngineSnapshot {
    return {
      source:
        this.source,

      lifecycle:
        this.lifecycle,

      initialized:
        this.lifecycle === "READY",

      lastPredictionTimestampMs:
        this.lastPredictionTimestampMs,

      modelReady:
        this.model !== null,

      trainingSampleCount:
        this.model?.trainingSampleCount
        ?? 0,

      trainingRmse:
        this.model?.trainingRmse
        ?? null
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

    this.model =
      null;

    return Promise.resolve();
  }

  private assertReady(): void {
    if (this.lifecycle === "READY") {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "Ridge gaze engine is not ready for prediction.",
      {
        details: {
          lifecycle:
            this.lifecycle
        }
      }
    );
  }

  private assertNotDisposed(): void {
    if (this.lifecycle !== "DISPOSED") {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "Disposed Ridge gaze engine cannot be modified."
    );
  }
}
