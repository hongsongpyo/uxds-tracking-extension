import {
  CALIBRATION,
  DEEP_PERSONALIZATION,
  NUMERIC_EPSILON
} from "../shared/constants";

import { sameCalibrationTarget } from "../calibration/calibrationTargetGroups";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  FaceBaseline,
  Point2D
} from "../shared/types";

import type {
  GazeObserverRuntimeSample
} from "./gazePredictor";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export type DeepPersonalMapperKind =
  | "LINEAR_RIDGE"
  | "RBF_KERNEL_RIDGE"
  | "RFF_RIDGE";

export interface DeepCalibrationPointInput {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly samples:
    readonly GazeObserverRuntimeSample[];
}

export interface DeepCalibrationPointSummary {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly sampleCount: number;
  readonly meanConfidence: number;
  readonly meanYawRad: number;
  readonly meanPitchRad: number;
  readonly meanFeature: Float32Array;
  readonly meanDeltaHeadYawDeg: number;
  readonly meanDeltaHeadPitchDeg: number;
  readonly meanDeltaHeadRollDeg: number;
  readonly meanDeltaFaceCenterX: number;
  readonly meanDeltaFaceCenterY: number;
  readonly meanFaceWidthScale: number;
  readonly meanFaceHeightScale: number;
  readonly meanFaceDistanceDelta: number;
  readonly meanLeftIrisHorizontalOffsetRatio: number;
  readonly meanLeftIrisVerticalOffsetRatio: number;
  readonly meanRightIrisHorizontalOffsetRatio: number;
  readonly meanRightIrisVerticalOffsetRatio: number;
}

export interface DeepGroupedCvCandidateResult {
  readonly kind: DeepPersonalMapperKind;
  readonly ridgeLambda: number;
  readonly rbfGammaScale: number | null;
  readonly evaluatedPointCount: number;
  readonly meanErrorPx: number;
  readonly p95ErrorPx: number;
  readonly rmsePx: number;
  readonly centerMeanErrorPx?: number;
  readonly edgeMeanErrorPx?: number;
  readonly cornerMeanErrorPx?: number;
  readonly meanWithinPointPrecisionPx?: number;
  readonly selectionScore?: number;
}

export type DeepGroupedCvSpatialBucket =
  | "CENTER"
  | "EDGE"
  | "CORNER";

export interface DeepGroupedCvPointResult {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly predictedNormalizedPoint: Point2D;
  readonly predictedViewportPoint: Point2D;
  readonly errorPx: number;
  readonly spatialBucket: DeepGroupedCvSpatialBucket;
}

export interface DeepPersonalMapperFitResult {
  readonly modelReady: true;
  readonly calibrationPointCount: number;
  readonly projectedFeatureDimension: number;
  readonly combinedFeatureDimension: number;
  readonly selectedCandidate:
    DeepGroupedCvCandidateResult;
  readonly candidates:
    readonly DeepGroupedCvCandidateResult[];
  readonly selectedPointResults:
    readonly DeepGroupedCvPointResult[];
  readonly calibrationMeanConfidence: number;
}

export interface DeepPersonalMapperSnapshot {
  readonly calibrationId: string | null;
  readonly expectedPointCount: number;
  readonly collectedPointCount: number;
  readonly modelReady: boolean;
  readonly selectedKind:
    DeepPersonalMapperKind | null;
  readonly projectedFeatureDimension: number;
  readonly combinedFeatureDimension: number;
}

/* ========================================================================== 
 * Internal model types
 * ======================================================================== */

interface PcaProjection {
  readonly rawDimension: number;
  readonly mean: Float64Array;
  readonly components:
    readonly Float64Array[];
}

interface FeatureStandardizer {
  readonly mean: Float64Array;
  readonly scale: Float64Array;
}

interface RandomFourierProjection {
  readonly inputDimension: number;
  readonly outputDimension: number;
  readonly gamma: number;
  readonly weights: readonly Float64Array[];
  readonly phases: Float64Array;
}

interface KernelModel {
  readonly kind: DeepPersonalMapperKind;
  readonly ridgeLambda: number;
  readonly rbfGamma: number | null;
  readonly randomFourierProjection: RandomFourierProjection | null;
  readonly standardizer: FeatureStandardizer;
  readonly trainingFeatures:
    readonly Float64Array[];
  readonly targetMeanX: number;
  readonly targetMeanY: number;
  readonly alphaX: Float64Array;
  readonly alphaY: Float64Array;
}

interface FittedDeepPersonalModel {
  readonly projection: PcaProjection;
  readonly kernel: KernelModel;
  readonly fitResult:
    DeepPersonalMapperFitResult;
}

interface CandidateConfiguration {
  readonly kind: DeepPersonalMapperKind;
  readonly ridgeLambda: number;
  readonly rbfGammaScale: number | null;
}

interface PreparedPoint {
  readonly summary:
    DeepCalibrationPointSummary;
  readonly combined: Float64Array;
}

/* ========================================================================== 
 * Numeric helpers
 * ======================================================================== */

function mean(
  values: readonly number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
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
      "Deep personal mapper received an invalid percentile request."
    );
  }

  const sorted =
    [...values].sort((a, b) => a - b);

  const position =
    (sorted.length - 1) * probability;

  const lowerIndex =
    Math.floor(position);

  const upperIndex =
    Math.ceil(position);

  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (
    lower === undefined
    || upper === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return (
    lower
    + (upper - lower)
      * (position - lowerIndex)
  );
}

function dot(
  first: Float64Array,
  second: Float64Array
): number {
  if (first.length !== second.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper vector dimensions do not match."
    );
  }

  let total = 0;

  for (
    let index = 0;
    index < first.length;
    index += 1
  ) {
    total +=
      (first[index] ?? 0)
      * (second[index] ?? 0);
  }

  return total;
}

function squaredDistance(
  first: Float64Array,
  second: Float64Array
): number {
  if (first.length !== second.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper vector dimensions do not match."
    );
  }

  let total = 0;

  for (
    let index = 0;
    index < first.length;
    index += 1
  ) {
    const difference =
      (first[index] ?? 0)
      - (second[index] ?? 0);

    total += difference * difference;
  }

  return total;
}

function normalizeVectorInPlace(
  vector: Float64Array
): boolean {
  const magnitude =
    Math.sqrt(dot(vector, vector));

  if (
    !Number.isFinite(magnitude)
    || magnitude <= NUMERIC_EPSILON
  ) {
    return false;
  }

  for (
    let index = 0;
    index < vector.length;
    index += 1
  ) {
    vector[index] =
      (vector[index] ?? 0)
      / magnitude;
  }

  return true;
}

function l2NormalizeFeature(
  values: Float32Array
): Float64Array {
  const normalized =
    new Float64Array(values.length);

  let squaredMagnitude = 0;

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    const value = values[index] ?? 0;

    if (!Number.isFinite(value)) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep feature contains a non-finite value."
      );
    }

    normalized[index] = value;
    squaredMagnitude += value * value;
  }

  const magnitude =
    Math.sqrt(squaredMagnitude);

  if (magnitude <= NUMERIC_EPSILON) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep feature has zero magnitude."
    );
  }

  for (
    let index = 0;
    index < normalized.length;
    index += 1
  ) {
    normalized[index] =
      (normalized[index] ?? 0)
      / magnitude;
  }

  return normalized;
}

function multiplyMatrixVector(
  matrix:
    readonly Float64Array[],
  vector: Float64Array
): Float64Array {
  const output =
    new Float64Array(matrix.length);

  for (
    let row = 0;
    row < matrix.length;
    row += 1
  ) {
    const matrixRow = matrix[row];

    if (matrixRow === undefined) {
      continue;
    }

    output[row] =
      dot(matrixRow, vector);
  }

  return output;
}

function orthogonalizeInPlace(
  vector: Float64Array,
  basis:
    readonly Float64Array[]
): void {
  for (const basisVector of basis) {
    const coefficient =
      dot(vector, basisVector);

    for (
      let index = 0;
      index < vector.length;
      index += 1
    ) {
      vector[index] =
        (vector[index] ?? 0)
        - coefficient
          * (basisVector[index] ?? 0);
    }
  }
}

function solveLinearSystem(
  matrix:
    readonly Float64Array[],
  vector: Float64Array
): Float64Array {
  const dimension = matrix.length;

  if (
    dimension === 0
    || vector.length !== dimension
    || matrix.some(
      (row) => row.length !== dimension
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper linear system has invalid dimensions."
    );
  }

  const augmented =
    Array.from(
      { length: dimension },
      (_, rowIndex) => {
        const row =
          new Float64Array(
            dimension + 1
          );

        const source = matrix[rowIndex];

        if (source === undefined) {
          return row;
        }

        row.set(source, 0);
        row[dimension] =
          vector[rowIndex] ?? 0;

        return row;
      }
    );

  for (
    let pivotColumn = 0;
    pivotColumn < dimension;
    pivotColumn += 1
  ) {
    let pivotRow = pivotColumn;
    let pivotMagnitude =
      Math.abs(
        augmented[pivotRow]?.[pivotColumn]
        ?? 0
      );

    for (
      let candidate = pivotColumn + 1;
      candidate < dimension;
      candidate += 1
    ) {
      const candidateMagnitude =
        Math.abs(
          augmented[candidate]?.[pivotColumn]
          ?? 0
        );

      if (candidateMagnitude > pivotMagnitude) {
        pivotRow = candidate;
        pivotMagnitude = candidateMagnitude;
      }
    }

    if (
      !Number.isFinite(pivotMagnitude)
      || pivotMagnitude <= NUMERIC_EPSILON
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep personal mapper kernel matrix is singular."
      );
    }

    if (pivotRow !== pivotColumn) {
      const temporary = augmented[pivotColumn];
      augmented[pivotColumn] =
        augmented[pivotRow] ?? new Float64Array();
      augmented[pivotRow] =
        temporary ?? new Float64Array();
    }

    const pivotValues =
      augmented[pivotColumn];

    if (pivotValues === undefined) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep personal mapper lost a pivot row."
      );
    }

    const pivot =
      pivotValues[pivotColumn] ?? 0;

    for (
      let column = pivotColumn;
      column <= dimension;
      column += 1
    ) {
      pivotValues[column] =
        (pivotValues[column] ?? 0)
        / pivot;
    }

    for (
      let row = 0;
      row < dimension;
      row += 1
    ) {
      if (row === pivotColumn) {
        continue;
      }

      const rowValues = augmented[row];

      if (rowValues === undefined) {
        continue;
      }

      const factor =
        rowValues[pivotColumn] ?? 0;

      for (
        let column = pivotColumn;
        column <= dimension;
        column += 1
      ) {
        rowValues[column] =
          (rowValues[column] ?? 0)
          - factor
            * (pivotValues[column] ?? 0);
      }
    }
  }

  const solution =
    new Float64Array(dimension);

  for (
    let row = 0;
    row < dimension;
    row += 1
  ) {
    const value =
      augmented[row]?.[dimension];

    if (
      value === undefined
      || !Number.isFinite(value)
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Deep personal mapper solved a non-finite coefficient."
      );
    }

    solution[row] = value;
  }

  return solution;
}

/* ========================================================================== 
 * PCA projection of the L2CS feature
 * ======================================================================== */

function fitProjection(
  features:
    readonly Float32Array[]
): PcaProjection {
  if (features.length < 2) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Deep feature projection requires at least two calibration points."
    );
  }

  const rawDimension =
    features[0]?.length ?? 0;

  if (
    rawDimension === 0
    || features.some(
      (feature) => feature.length !== rawDimension
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep calibration features have inconsistent dimensions."
    );
  }

  const normalized =
    features.map(l2NormalizeFeature);

  const center =
    new Float64Array(rawDimension);

  for (const feature of normalized) {
    for (
      let index = 0;
      index < rawDimension;
      index += 1
    ) {
      center[index] =
        (center[index] ?? 0)
        + (feature[index] ?? 0);
    }
  }

  for (
    let index = 0;
    index < rawDimension;
    index += 1
  ) {
    center[index] =
      (center[index] ?? 0)
      / normalized.length;
  }

  const centered =
    normalized.map(
      (feature) => {
        const output =
          new Float64Array(rawDimension);

        for (
          let index = 0;
          index < rawDimension;
          index += 1
        ) {
          output[index] =
            (feature[index] ?? 0)
            - (center[index] ?? 0);
        }

        return output;
      }
    );

  const sampleCount = centered.length;
  const gram =
    Array.from(
      { length: sampleCount },
      () => new Float64Array(sampleCount)
    );

  for (
    let row = 0;
    row < sampleCount;
    row += 1
  ) {
    const rowFeature = centered[row];

    if (rowFeature === undefined) {
      continue;
    }

    for (
      let column = row;
      column < sampleCount;
      column += 1
    ) {
      const columnFeature = centered[column];

      if (columnFeature === undefined) {
        continue;
      }

      const value =
        dot(rowFeature, columnFeature);

      const rowValues = gram[row];
      const columnValues = gram[column];

      if (
        rowValues === undefined
        || columnValues === undefined
      ) {
        continue;
      }

      rowValues[column] = value;
      columnValues[row] = value;
    }
  }

  const maximumComponents =
    Math.min(
      DEEP_PERSONALIZATION
        .PCA_COMPONENT_COUNT,
      sampleCount - 1,
      rawDimension
    );

  const sampleEigenvectors:
    Float64Array[] = [];

  const components:
    Float64Array[] = [];

  for (
    let componentIndex = 0;
    componentIndex < maximumComponents;
    componentIndex += 1
  ) {
    let vector: Float64Array =
      new Float64Array(sampleCount);

    for (
      let index = 0;
      index < sampleCount;
      index += 1
    ) {
      vector[index] =
        Math.sin(
          (index + 1)
          * (componentIndex + 1)
          * 1.618033988749895
        )
        + Math.cos(
          (index + 1)
          * (componentIndex + 2)
          * 0.7071067811865476
        );
    }

    orthogonalizeInPlace(
      vector,
      sampleEigenvectors
    );

    if (!normalizeVectorInPlace(vector)) {
      break;
    }

    for (
      let iteration = 0;
      iteration < DEEP_PERSONALIZATION
        .PCA_POWER_ITERATIONS;
      iteration += 1
    ) {
      const next =
        multiplyMatrixVector(
          gram,
          vector
        );

      orthogonalizeInPlace(
        next,
        sampleEigenvectors
      );

      if (!normalizeVectorInPlace(next)) {
        break;
      }

      vector = next;
    }

    const gramVector =
      multiplyMatrixVector(
        gram,
        vector
      );

    const eigenvalue =
      dot(vector, gramVector);

    if (
      !Number.isFinite(eigenvalue)
      || eigenvalue
        <= DEEP_PERSONALIZATION
          .PCA_MIN_EIGENVALUE
    ) {
      break;
    }

    const component =
      new Float64Array(rawDimension);

    for (
      let sampleIndex = 0;
      sampleIndex < sampleCount;
      sampleIndex += 1
    ) {
      const coefficient =
        vector[sampleIndex] ?? 0;

      const sample = centered[sampleIndex];

      if (sample === undefined) {
        continue;
      }

      for (
        let featureIndex = 0;
        featureIndex < rawDimension;
        featureIndex += 1
      ) {
        component[featureIndex] =
          (component[featureIndex] ?? 0)
          + coefficient
            * (sample[featureIndex] ?? 0);
      }
    }

    const scale =
      Math.sqrt(eigenvalue);

    for (
      let index = 0;
      index < rawDimension;
      index += 1
    ) {
      component[index] =
        (component[index] ?? 0)
        / scale;
    }

    if (!normalizeVectorInPlace(component)) {
      break;
    }

    sampleEigenvectors.push(vector);
    components.push(component);
  }

  if (components.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep feature projection could not resolve a principal component."
    );
  }

  return {
    rawDimension,
    mean: center,
    components
  };
}

function projectFeature(
  feature: Float32Array,
  projection: PcaProjection
): Float64Array {
  if (
    feature.length
    !== projection.rawDimension
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep feature dimension changed after calibration."
    );
  }

  const normalized =
    l2NormalizeFeature(feature);

  const centered =
    new Float64Array(
      projection.rawDimension
    );

  for (
    let index = 0;
    index < centered.length;
    index += 1
  ) {
    centered[index] =
      (normalized[index] ?? 0)
      - (projection.mean[index] ?? 0);
  }

  const projected =
    new Float64Array(
      projection.components.length
    );

  for (
    let index = 0;
    index < projection.components.length;
    index += 1
  ) {
    const component =
      projection.components[index];

    if (component !== undefined) {
      projected[index] =
        dot(centered, component);
    }
  }

  return projected;
}

/* ========================================================================== 
 * Point summarization / feature construction
 * ======================================================================== */

function finiteMean(
  samples:
    readonly GazeObserverRuntimeSample[],
  selector:
    (sample: GazeObserverRuntimeSample) => number
): number {
  const values =
    samples.map(selector);

  if (
    values.some(
      (value) => !Number.isFinite(value)
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep calibration observation contains a non-finite scalar feature."
    );
  }

  return mean(values);
}

function summarizePoint(
  input: DeepCalibrationPointInput,
  baseline: FaceBaseline,
  minimumSampleCount: number =
    DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
): DeepCalibrationPointSummary {
  if (
    !Number.isInteger(input.pointIndex)
    || input.pointIndex < 0
    || input.samples.length < minimumSampleCount
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Too few synchronized deep observations are available for this calibration point.",
      {
        details: {
          pointIndex: input.pointIndex,
          sampleCount: input.samples.length,
          requiredSampleCount:
            DEEP_PERSONALIZATION
              .MIN_DEEP_SAMPLES_PER_POINT
        }
      }
    );
  }

  const featureDimension =
    input.samples[0]?.feature.values.length
    ?? 0;

  if (
    featureDimension === 0
    || input.samples.some(
      (sample) =>
        sample.feature.values.length
          !== featureDimension
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep calibration samples have inconsistent feature dimensions."
    );
  }

  const meanFeature =
    new Float32Array(featureDimension);

  for (const sample of input.samples) {
    for (
      let index = 0;
      index < featureDimension;
      index += 1
    ) {
      const value =
        sample.feature.values[index] ?? 0;

      if (!Number.isFinite(value)) {
        throw new TrackerError(
          ERROR_CODES.CALIBRATION_MODEL_FAILED,
          "CALIBRATION",
          "Deep calibration feature contains a non-finite value."
        );
      }

      meanFeature[index] =
        (meanFeature[index] ?? 0)
        + value;
    }
  }

  for (
    let index = 0;
    index < featureDimension;
    index += 1
  ) {
    meanFeature[index] =
      (meanFeature[index] ?? 0)
      / input.samples.length;
  }

  const widthScale =
    finiteMean(
      input.samples,
      (sample) =>
        sample.geometry.faceWidthRatio
    )
    / Math.max(
      baseline.width,
      NUMERIC_EPSILON
    );

  const heightScale =
    finiteMean(
      input.samples,
      (sample) =>
        sample.geometry.faceHeightRatio
    )
    / Math.max(
      baseline.height,
      NUMERIC_EPSILON
    );

  return {
    pointIndex: input.pointIndex,
    targetNormalizedPoint: {
      ...input.targetNormalizedPoint
    },
    targetViewportPoint: {
      ...input.targetViewportPoint
    },
    sampleCount:
      input.samples.length,
    meanConfidence:
      finiteMean(
        input.samples,
        (sample) => sample.prediction.confidence
      ),
    meanYawRad:
      finiteMean(
        input.samples,
        (sample) => sample.prediction.rawPoint.x
      ),
    meanPitchRad:
      finiteMean(
        input.samples,
        (sample) => sample.prediction.rawPoint.y
      ),
    meanFeature,
    meanDeltaHeadYawDeg:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.headPose.yawDeg
      ) - baseline.headPose.yawDeg,
    meanDeltaHeadPitchDeg:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.headPose.pitchDeg
      ) - baseline.headPose.pitchDeg,
    meanDeltaHeadRollDeg:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.headPose.rollDeg
      ) - baseline.headPose.rollDeg,
    meanDeltaFaceCenterX:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.faceCenterNormalized.x
      ) - baseline.centerX,
    meanDeltaFaceCenterY:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.faceCenterNormalized.y
      ) - baseline.centerY,
    meanFaceWidthScale:
      widthScale - 1,
    meanFaceHeightScale:
      heightScale - 1,
    meanFaceDistanceDelta:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.faceDistanceRatio
      ) - baseline.distanceRatio,
    meanLeftIrisHorizontalOffsetRatio:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.leftIrisHorizontalOffsetRatio
      ),
    meanLeftIrisVerticalOffsetRatio:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.leftIrisVerticalOffsetRatio
      ),
    meanRightIrisHorizontalOffsetRatio:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.rightIrisHorizontalOffsetRatio
      ),
    meanRightIrisVerticalOffsetRatio:
      finiteMean(
        input.samples,
        (sample) => sample.geometry.rightIrisVerticalOffsetRatio
      )
  };
}

function createCombinedFeature(
  summary: DeepCalibrationPointSummary,
  projection: PcaProjection
): Float64Array {
  const latent =
    projectFeature(
      summary.meanFeature,
      projection
    );

  const geometry = [
    summary.meanYawRad,
    summary.meanPitchRad,
    summary.meanDeltaHeadYawDeg,
    summary.meanDeltaHeadPitchDeg,
    summary.meanDeltaHeadRollDeg,
    summary.meanDeltaFaceCenterX,
    summary.meanDeltaFaceCenterY,
    summary.meanFaceWidthScale,
    summary.meanFaceHeightScale,
    summary.meanFaceDistanceDelta,
    summary.meanLeftIrisHorizontalOffsetRatio,
    summary.meanLeftIrisVerticalOffsetRatio,
    summary.meanRightIrisHorizontalOffsetRatio,
    summary.meanRightIrisVerticalOffsetRatio
  ];

  const combined =
    new Float64Array(
      latent.length + geometry.length
    );

  combined.set(latent, 0);

  for (
    let index = 0;
    index < geometry.length;
    index += 1
  ) {
    combined[latent.length + index] =
      geometry[index] ?? 0;
  }

  return combined;
}

function createLiveSummary(
  samples: readonly GazeObserverRuntimeSample[],
  baseline: FaceBaseline
): DeepCalibrationPointSummary {
  return summarizePoint(
    {
      pointIndex: 0,
      targetNormalizedPoint: {
        x: 0.5,
        y: 0.5
      },
      targetViewportPoint: {
        x: 1,
        y: 1
      },
      samples
    },
    baseline,
    1
  );
}

function isQualityAcceptedMapperSample(
  sample: GazeObserverRuntimeSample
): boolean {
  return (
    sample.quality.usableForGaze
    && sample.quality.faceValid
    && sample.quality.eyesValid
    && !sample.quality.blink
    && Number.isFinite(sample.quality.qualityScore)
    && sample.quality.qualityScore >= CALIBRATION.MIN_SAMPLE_QUALITY
    && Number.isFinite(sample.prediction.confidence)
    && sample.prediction.confidence >= 0
    && sample.prediction.confidence <= 1
  );
}

function calibrationPoseDistance(
  first: GazeObserverRuntimeSample,
  second: GazeObserverRuntimeSample
): number {
  const head = Math.hypot(
    (first.geometry.headPose.yawDeg - second.geometry.headPose.yawDeg) / 5,
    (first.geometry.headPose.pitchDeg - second.geometry.headPose.pitchDeg) / 5,
    (first.geometry.headPose.rollDeg - second.geometry.headPose.rollDeg) / 7
  );

  const face = Math.hypot(
    (first.geometry.faceCenterNormalized.x - second.geometry.faceCenterNormalized.x) / 0.02,
    (first.geometry.faceCenterNormalized.y - second.geometry.faceCenterNormalized.y) / 0.02
  );

  const distance = Math.abs(
    first.geometry.faceDistanceRatio - second.geometry.faceDistanceRatio
  ) / 0.05;

  return Math.hypot(head, face, distance);
}

function clusterCalibrationSamplesByPose(
  samples: readonly GazeObserverRuntimeSample[],
  clusterCount: number,
  minimumClusterSize: number
): readonly (readonly GazeObserverRuntimeSample[])[] | null {
  if (clusterCount <= 1) {
    return [samples];
  }

  const sorted = [...samples].sort(
    (first, second) =>
      first.prediction.timestampMs - second.prediction.timestampMs
  );

  const centerIndex = Math.floor((sorted.length - 1) / 2);
  const firstSeed = sorted[centerIndex];
  if (firstSeed === undefined) {
    return null;
  }

  const seeds: GazeObserverRuntimeSample[] = [firstSeed];

  while (seeds.length < clusterCount) {
    let best: GazeObserverRuntimeSample | null = null;
    let bestDistance = -1;

    for (const sample of sorted) {
      if (seeds.includes(sample)) {
        continue;
      }

      const nearestSeedDistance = Math.min(
        ...seeds.map((seed) => calibrationPoseDistance(sample, seed))
      );

      if (nearestSeedDistance > bestDistance) {
        best = sample;
        bestDistance = nearestSeedDistance;
      }
    }

    if (best === null) {
      return null;
    }

    seeds.push(best);
  }

  const clusters = seeds.map(
    () => [] as GazeObserverRuntimeSample[]
  );

  for (const sample of sorted) {
    let selectedIndex = 0;
    let selectedDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index];
      if (seed === undefined) {
        continue;
      }
      const distance = calibrationPoseDistance(sample, seed);
      if (distance < selectedDistance) {
        selectedDistance = distance;
        selectedIndex = index;
      }
    }

    clusters[selectedIndex]?.push(sample);
  }

  if (clusters.some((cluster) => cluster.length < minimumClusterSize)) {
    return null;
  }

  return clusters.map((cluster) =>
    [...cluster].sort(
      (first, second) =>
        first.prediction.timestampMs - second.prediction.timestampMs
    )
  );
}

function createCalibrationExemplars(
  input: DeepCalibrationPointInput,
  baseline: FaceBaseline
): readonly DeepCalibrationPointSummary[] {
  const ordered = [...input.samples].sort(
    (first, second) =>
      first.prediction.timestampMs - second.prediction.timestampMs
  );

  const minSamples =
    DEEP_PERSONALIZATION.MIN_SAMPLES_PER_EXEMPLAR;
  const maxExemplars =
    DEEP_PERSONALIZATION.MAX_EXEMPLARS_PER_CALIBRATION_POINT;

  const exemplarCount = Math.max(
    1,
    Math.min(
      maxExemplars,
      Math.floor(ordered.length / minSamples)
    )
  );

  if (exemplarCount === 1) {
    return [summarizePoint(input, baseline)];
  }

  const poseClusters = clusterCalibrationSamplesByPose(
    ordered,
    exemplarCount,
    minSamples
  );

  const sampleGroups = poseClusters ?? Array.from(
    { length: exemplarCount },
    (_, exemplarIndex) => {
      const start = Math.floor(
        exemplarIndex * ordered.length / exemplarCount
      );
      const end = Math.floor(
        (exemplarIndex + 1) * ordered.length / exemplarCount
      );
      return ordered.slice(start, end);
    }
  );

  const exemplars = sampleGroups
    .filter((samples) => samples.length >= minSamples)
    .map((samples) =>
      summarizePoint(
        {
          ...input,
          samples
        },
        baseline
      )
    );

  return exemplars.length > 0
    ? exemplars
    : [summarizePoint(input, baseline)];
}

/* ========================================================================== 
 * Feature standardization
 * ======================================================================== */

function fitStandardizer(
  features:
    readonly Float64Array[]
): FeatureStandardizer {
  const dimension =
    features[0]?.length ?? 0;

  if (
    dimension === 0
    || features.some(
      (feature) => feature.length !== dimension
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper features have inconsistent dimensions."
    );
  }

  const featureMean =
    new Float64Array(dimension);

  for (const feature of features) {
    for (
      let index = 0;
      index < dimension;
      index += 1
    ) {
      featureMean[index] =
        (featureMean[index] ?? 0)
        + (feature[index] ?? 0);
    }
  }

  for (
    let index = 0;
    index < dimension;
    index += 1
  ) {
    featureMean[index] =
      (featureMean[index] ?? 0)
      / features.length;
  }

  const scale =
    new Float64Array(dimension);

  for (const feature of features) {
    for (
      let index = 0;
      index < dimension;
      index += 1
    ) {
      const difference =
        (feature[index] ?? 0)
        - (featureMean[index] ?? 0);

      scale[index] =
        (scale[index] ?? 0)
        + difference * difference;
    }
  }

  for (
    let index = 0;
    index < dimension;
    index += 1
  ) {
    const variance =
      (scale[index] ?? 0)
      / Math.max(1, features.length - 1);

    const standardDeviation =
      Math.sqrt(variance);

    scale[index] =
      standardDeviation
        >= DEEP_PERSONALIZATION
          .MIN_FEATURE_STANDARD_DEVIATION
        ? standardDeviation
        : 1;
  }

  return {
    mean: featureMean,
    scale
  };
}

function standardizeFeature(
  feature: Float64Array,
  standardizer: FeatureStandardizer
): Float64Array {
  if (
    feature.length
    !== standardizer.mean.length
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper feature dimension changed after standardization."
    );
  }

  const output =
    new Float64Array(feature.length);

  for (
    let index = 0;
    index < feature.length;
    index += 1
  ) {
    output[index] =
      ((feature[index] ?? 0)
        - (standardizer.mean[index] ?? 0))
      / (standardizer.scale[index] ?? 1);
  }

  return output;
}

/* ========================================================================== 
 * Kernel ridge
 * ======================================================================== */

function getCandidateConfigurations():
readonly CandidateConfiguration[] {
  const candidates:
    CandidateConfiguration[] = [];

  for (
    const ridgeLambda of
      DEEP_PERSONALIZATION
        .LINEAR_RIDGE_LAMBDAS
  ) {
    candidates.push({
      kind: "LINEAR_RIDGE",
      ridgeLambda,
      rbfGammaScale: null
    });
  }

  for (
    const ridgeLambda of
      DEEP_PERSONALIZATION
        .RBF_RIDGE_LAMBDAS
  ) {
    for (
      const rbfGammaScale of
        DEEP_PERSONALIZATION
          .RBF_GAMMA_SCALES
    ) {
      candidates.push({
        kind: "RBF_KERNEL_RIDGE",
        ridgeLambda,
        rbfGammaScale
      });
    }
  }

  for (
    const ridgeLambda of
      DEEP_PERSONALIZATION
        .RFF_RIDGE_LAMBDAS
  ) {
    for (
      const rbfGammaScale of
        DEEP_PERSONALIZATION
          .RFF_GAMMA_SCALES
    ) {
      candidates.push({
        kind: "RFF_RIDGE",
        ridgeLambda,
        rbfGammaScale
      });
    }
  }

  return candidates;
}

function calculateRbfGamma(
  features:
    readonly Float64Array[],
  gammaScale: number
): number {
  const distances: number[] = [];

  for (
    let first = 0;
    first < features.length;
    first += 1
  ) {
    for (
      let second = first + 1;
      second < features.length;
      second += 1
    ) {
      const firstFeature = features[first];
      const secondFeature = features[second];

      if (
        firstFeature === undefined
        || secondFeature === undefined
      ) {
        continue;
      }

      const distance =
        squaredDistance(
          firstFeature,
          secondFeature
        );

      if (
        Number.isFinite(distance)
        && distance > NUMERIC_EPSILON
      ) {
        distances.push(distance);
      }
    }
  }

  const medianDistance =
    distances.length === 0
      ? 1
      : percentile(distances, 0.5);

  return (
    gammaScale
    * 0.5
    / Math.max(
      medianDistance,
      NUMERIC_EPSILON
    )
  );
}

function createDeterministicRandomFourierProjection(
  inputDimension: number,
  outputDimension: number,
  gamma: number
): RandomFourierProjection {
  if (
    inputDimension <= 0
    || outputDimension <= 0
    || !Number.isFinite(gamma)
    || gamma <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Random Fourier projection received invalid dimensions or gamma."
    );
  }

  let state = 0x6d2b79f5;
  const nextUniform = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 1) / 4294967297;
  };

  const nextGaussian = (): number => {
    const first = Math.max(Number.EPSILON, nextUniform());
    const second = nextUniform();
    return Math.sqrt(-2 * Math.log(first))
      * Math.cos(2 * Math.PI * second);
  };

  const standardDeviation = Math.sqrt(2 * gamma);
  const weights: Float64Array[] = [];
  const phases = new Float64Array(outputDimension);

  for (let row = 0; row < outputDimension; row += 1) {
    const weight = new Float64Array(inputDimension);
    for (let column = 0; column < inputDimension; column += 1) {
      weight[column] = nextGaussian() * standardDeviation;
    }
    weights.push(weight);
    phases[row] = 2 * Math.PI * nextUniform();
  }

  return {
    inputDimension,
    outputDimension,
    gamma,
    weights,
    phases
  };
}

function applyRandomFourierProjection(
  feature: Float64Array,
  projection: RandomFourierProjection
): Float64Array {
  if (feature.length !== projection.inputDimension) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Random Fourier projection feature dimension mismatch."
    );
  }

  const output = new Float64Array(projection.outputDimension);
  const scale = Math.sqrt(2 / projection.outputDimension);

  for (let index = 0; index < projection.outputDimension; index += 1) {
    const weight = projection.weights[index];
    if (weight === undefined) {
      continue;
    }
    output[index] = scale * Math.cos(
      dot(feature, weight) + (projection.phases[index] ?? 0)
    );
  }

  return output;
}

function kernelValue(
  kind: DeepPersonalMapperKind,
  first: Float64Array,
  second: Float64Array,
  rbfGamma: number | null
): number {
  if (kind === "LINEAR_RIDGE") {
    return (
      dot(first, second)
      / Math.max(1, first.length)
    );
  }

  if (kind === "RFF_RIDGE") {
    // Random Fourier features already include sqrt(2 / D) scaling, so their
    // direct dot product approximates the RBF kernel. Dividing by D again
    // would collapse the kernel magnitude and make lambda tuning misleading.
    return dot(first, second);
  }

  if (rbfGamma === null) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "RBF deep mapper is missing its gamma parameter."
    );
  }

  return Math.exp(
    -rbfGamma
      * squaredDistance(first, second)
  );
}

function fitKernelModel(
  features:
    readonly Float64Array[],
  targets:
    readonly Point2D[],
  configuration: CandidateConfiguration
): KernelModel {
  if (
    features.length === 0
    || features.length !== targets.length
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep mapper training arrays are inconsistent."
    );
  }

  const standardizer =
    fitStandardizer(features);

  const standardized =
    features.map(
      (feature) =>
        standardizeFeature(
          feature,
          standardizer
        )
    );

  const rbfGamma =
    configuration.kind === "RBF_KERNEL_RIDGE"
      || configuration.kind === "RFF_RIDGE"
      ? calculateRbfGamma(
          standardized,
          configuration.rbfGammaScale
            ?? 1
        )
      : null;

  const randomFourierProjection =
    configuration.kind === "RFF_RIDGE"
      ? createDeterministicRandomFourierProjection(
          standardized[0]?.length ?? 0,
          DEEP_PERSONALIZATION.RFF_FEATURE_COUNT,
          rbfGamma ?? 1
        )
      : null;

  const modelFeatures =
    randomFourierProjection === null
      ? standardized
      : standardized.map(
          (feature) =>
            applyRandomFourierProjection(
              feature,
              randomFourierProjection
            )
        );

  const targetMeanX =
    mean(targets.map((target) => target.x));

  const targetMeanY =
    mean(targets.map((target) => target.y));

  const centeredX =
    new Float64Array(
      targets.map(
        (target) => target.x - targetMeanX
      )
    );

  const centeredY =
    new Float64Array(
      targets.map(
        (target) => target.y - targetMeanY
      )
    );

  const kernelMatrix =
    Array.from(
      { length: modelFeatures.length },
      () => new Float64Array(modelFeatures.length)
    );

  for (
    let row = 0;
    row < modelFeatures.length;
    row += 1
  ) {
    const rowFeature = modelFeatures[row];
    const rowValues = kernelMatrix[row];

    if (
      rowFeature === undefined
      || rowValues === undefined
    ) {
      continue;
    }

    for (
      let column = 0;
      column < modelFeatures.length;
      column += 1
    ) {
      const columnFeature =
        modelFeatures[column];

      if (columnFeature === undefined) {
        continue;
      }

      rowValues[column] =
        kernelValue(
          configuration.kind,
          rowFeature,
          columnFeature,
          rbfGamma
        );
    }

    rowValues[row] =
      (rowValues[row] ?? 0)
      + configuration.ridgeLambda;
  }

  return {
    kind: configuration.kind,
    ridgeLambda:
      configuration.ridgeLambda,
    rbfGamma,
    randomFourierProjection,
    standardizer,
    trainingFeatures: modelFeatures,
    targetMeanX,
    targetMeanY,
    alphaX:
      solveLinearSystem(
        kernelMatrix,
        centeredX
      ),
    alphaY:
      solveLinearSystem(
        kernelMatrix,
        centeredY
      )
  };
}

function predictKernelModel(
  model: KernelModel,
  feature: Float64Array
): Point2D {
  const standardized =
    standardizeFeature(
      feature,
      model.standardizer
    );

  const modelFeature =
    model.randomFourierProjection === null
      ? standardized
      : applyRandomFourierProjection(
          standardized,
          model.randomFourierProjection
        );

  let predictedX = model.targetMeanX;
  let predictedY = model.targetMeanY;

  for (
    let index = 0;
    index < model.trainingFeatures.length;
    index += 1
  ) {
    const trainingFeature =
      model.trainingFeatures[index];

    if (trainingFeature === undefined) {
      continue;
    }

    const value =
      kernelValue(
        model.kind,
        modelFeature,
        trainingFeature,
        model.rbfGamma
      );

    predictedX +=
      value * (model.alphaX[index] ?? 0);

    predictedY +=
      value * (model.alphaY[index] ?? 0);
  }

  if (
    !Number.isFinite(predictedX)
    || !Number.isFinite(predictedY)
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper produced a non-finite screen prediction."
    );
  }

  return {
    x: predictedX,
    y: predictedY
  };
}

/* ========================================================================== 
 * Grouped leave-one-point-out model selection
 * ======================================================================== */

function classifyGroupedCvSpatialBucket(
  point: Point2D
): DeepGroupedCvSpatialBucket {
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

function getViewportSize(
  point: DeepCalibrationPointSummary
): { readonly width: number; readonly height: number } {
  const normalized =
    point.targetNormalizedPoint;

  const viewport =
    point.targetViewportPoint;

  const width =
    Math.abs(normalized.x) > NUMERIC_EPSILON
      ? viewport.x / normalized.x
      : Number.NaN;

  const height =
    Math.abs(normalized.y) > NUMERIC_EPSILON
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
      "Deep mapper could not infer the calibration viewport size."
    );
  }

  return { width, height };
}

function errorPx(
  prediction: Point2D,
  point: DeepCalibrationPointSummary
): number {
  const viewport = getViewportSize(point);

  return Math.hypot(
    (prediction.x
      - point.targetNormalizedPoint.x)
      * viewport.width,
    (prediction.y
      - point.targetNormalizedPoint.y)
      * viewport.height
  );
}

function predictionDispersionPx(
  predictions: readonly Point2D[],
  center: Point2D,
  point: DeepCalibrationPointSummary
): number {
  if (predictions.length <= 1) {
    return 0;
  }

  const viewport = getViewportSize(point);
  const squaredDistances = predictions.map((prediction) => {
    const dx = (prediction.x - center.x) * viewport.width;
    const dy = (prediction.y - center.y) * viewport.height;
    return dx * dx + dy * dy;
  });

  return Math.sqrt(mean(squaredDistances));
}

function groupCalibrationExemplars(
  points: readonly DeepCalibrationPointSummary[]
): readonly (readonly DeepCalibrationPointSummary[])[] {
  const grouped = new Map<number, DeepCalibrationPointSummary[]>();

  for (const point of points) {
    const existing = grouped.get(point.pointIndex);
    if (existing === undefined) {
      grouped.set(point.pointIndex, [point]);
    } else {
      existing.push(point);
    }
  }

  return [...grouped.values()].sort(
    (first, second) =>
      (first[0]?.pointIndex ?? 0) - (second[0]?.pointIndex ?? 0)
  );
}

function meanPrediction(
  predictions: readonly Point2D[]
): Point2D {
  return {
    x: mean(predictions.map((prediction) => prediction.x)),
    y: mean(predictions.map((prediction) => prediction.y))
  };
}

function evaluateCandidates(
  points:
    readonly DeepCalibrationPointSummary[]
): readonly DeepGroupedCvCandidateResult[] {
  const configurations = getCandidateConfigurations();
  const groups = groupCalibrationExemplars(points);

  const errorsByCandidate = configurations.map(
    () => [] as Array<{
      readonly errorPx: number;
      readonly bucket: DeepGroupedCvSpatialBucket;
      readonly withinPointPrecisionPx: number;
    }>
  );

  for (const heldOutGroup of groups) {
    const heldOut = heldOutGroup[0];
    if (heldOut === undefined) {
      continue;
    }

    const training = points.filter(
      (point) => !sameCalibrationTarget(
        point.targetNormalizedPoint, heldOut.targetNormalizedPoint
      )
    );

    const projection = fitProjection(
      training.map((point) => point.meanFeature)
    );

    const preparedTraining: PreparedPoint[] = training.map(
      (summary) => ({
        summary,
        combined: createCombinedFeature(summary, projection)
      })
    );

    const heldOutCombined = heldOutGroup.map(
      (summary) => createCombinedFeature(summary, projection)
    );

    for (
      let candidateIndex = 0;
      candidateIndex < configurations.length;
      candidateIndex += 1
    ) {
      const configuration = configurations[candidateIndex];
      const candidateErrors = errorsByCandidate[candidateIndex];

      if (configuration === undefined || candidateErrors === undefined) {
        continue;
      }

      const model = fitKernelModel(
        preparedTraining.map((item) => item.combined),
        preparedTraining.map(
          (item) => item.summary.targetNormalizedPoint
        ),
        configuration
      );

      const predictions = heldOutCombined.map(
        (combined) => predictKernelModel(model, combined)
      );
      const prediction = meanPrediction(predictions);

      candidateErrors.push({
        errorPx: errorPx(prediction, heldOut),
        bucket: classifyGroupedCvSpatialBucket(
          heldOut.targetNormalizedPoint
        ),
        withinPointPrecisionPx: predictionDispersionPx(
          predictions,
          prediction,
          heldOut
        )
      });
    }
  }

  return configurations.map((configuration, index) => {
    const entries = errorsByCandidate[index] ?? [];
    const errors = entries.map((entry) => entry.errorPx);

    const bucketMean = (
      bucket: DeepGroupedCvSpatialBucket
    ): number => {
      const values = entries
        .filter((entry) => entry.bucket === bucket)
        .map((entry) => entry.errorPx);
      return values.length === 0 ? mean(errors) : mean(values);
    };

    const meanErrorPx = mean(errors);
    const p95ErrorPx = percentile(errors, 0.95);
    const rmsePx = Math.sqrt(
      mean(errors.map((error) => error * error))
    );
    const centerMean = bucketMean("CENTER");
    const edgeMean = bucketMean("EDGE");
    const cornerMean = bucketMean("CORNER");
    const meanWithinPointPrecisionPx = mean(
      entries.map((entry) => entry.withinPointPrecisionPx)
    );
    const selectionScore =
      meanErrorPx
      + 0.30 * p95ErrorPx
      + 0.15 * rmsePx
      + 0.10 * edgeMean
      + 0.15 * cornerMean
      + 0.10 * meanWithinPointPrecisionPx;

    return {
      kind: configuration.kind,
      ridgeLambda: configuration.ridgeLambda,
      rbfGammaScale: configuration.rbfGammaScale,
      evaluatedPointCount: errors.length,
      meanErrorPx,
      p95ErrorPx,
      rmsePx,
      centerMeanErrorPx: centerMean,
      edgeMeanErrorPx: edgeMean,
      cornerMeanErrorPx: cornerMean,
      meanWithinPointPrecisionPx,
      selectionScore
    };
  });
}

function evaluateConfigurationPointwise(
  points: readonly DeepCalibrationPointSummary[],
  configuration: CandidateConfiguration
): readonly DeepGroupedCvPointResult[] {
  const results: DeepGroupedCvPointResult[] = [];
  const groups = groupCalibrationExemplars(points);

  for (const heldOutGroup of groups) {
    const heldOut = heldOutGroup[0];
    if (heldOut === undefined) {
      continue;
    }

    const training = points.filter(
      (point) => !sameCalibrationTarget(
        point.targetNormalizedPoint, heldOut.targetNormalizedPoint
      )
    );

    const projection = fitProjection(
      training.map((point) => point.meanFeature)
    );

    const preparedTraining = training.map(
      (summary) => ({
        summary,
        combined: createCombinedFeature(summary, projection)
      })
    );

    const model = fitKernelModel(
      preparedTraining.map((item) => item.combined),
      preparedTraining.map(
        (item) => item.summary.targetNormalizedPoint
      ),
      configuration
    );

    const predictedNormalizedPoint = meanPrediction(
      heldOutGroup.map(
        (summary) =>
          predictKernelModel(
            model,
            createCombinedFeature(summary, projection)
          )
      )
    );

    const viewport = getViewportSize(heldOut);
    const predictedViewportPoint = {
      x: predictedNormalizedPoint.x * viewport.width,
      y: predictedNormalizedPoint.y * viewport.height
    };

    results.push({
      pointIndex: heldOut.pointIndex,
      targetNormalizedPoint: { ...heldOut.targetNormalizedPoint },
      targetViewportPoint: { ...heldOut.targetViewportPoint },
      predictedNormalizedPoint,
      predictedViewportPoint,
      errorPx: errorPx(predictedNormalizedPoint, heldOut),
      spatialBucket: classifyGroupedCvSpatialBucket(
        heldOut.targetNormalizedPoint
      )
    });
  }

  return results;
}

function selectCandidate(
  candidates:
    readonly DeepGroupedCvCandidateResult[]
): DeepGroupedCvCandidateResult {
  const candidateScore = (
    candidate: DeepGroupedCvCandidateResult
  ): number => {
    return candidate.selectionScore
      ?? (
        candidate.meanErrorPx
        + 0.30 * candidate.p95ErrorPx
        + 0.15 * candidate.rmsePx
      );
  };

  const sorted =
    [...candidates].sort(
      (first, second) => {
        const scoreDelta =
          candidateScore(first) - candidateScore(second);
        if (Math.abs(scoreDelta) > NUMERIC_EPSILON) {
          return scoreDelta;
        }

        if (first.p95ErrorPx !== second.p95ErrorPx) {
          return first.p95ErrorPx - second.p95ErrorPx;
        }

        if (first.kind !== second.kind) {
          const rank = (kind: DeepPersonalMapperKind): number => {
            switch (kind) {
              case "LINEAR_RIDGE": return 0;
              case "RFF_RIDGE": return 1;
              case "RBF_KERNEL_RIDGE": return 2;
            }
          };
          return rank(first.kind) - rank(second.kind);
        }

        return first.ridgeLambda - second.ridgeLambda;
      }
    );

  const selected = sorted[0];

  if (
    selected === undefined
    || !Number.isFinite(
      selected.meanErrorPx
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Grouped cross-validation could not select a deep personal mapper."
    );
  }

  return selected;
}

/* ========================================================================== 
 * Deep personal mapper
 * ======================================================================== */

/**
 * Participant-specific MODEL→NORMALIZED screen mapper for the L2CS observer.
 *
 * Stage D7-D10 remains a shadow path: it is trained from the same calibration
 * targets as WebEyeTrack but does not replace the established calibration
 * output yet. Model selection uses leave-one-calibration-point-out grouped CV,
 * so consecutive frames from the same target never leak across train/test.
 */
export class DeepPersonalMapper {
  private calibrationId:
    string | null = null;

  private expectedPointCount = 0;

  private readonly points =
    new Map<number, readonly DeepCalibrationPointSummary[]>();

  private fitted:
    FittedDeepPersonalModel | null = null;

  public start(
    calibrationId: string,
    expectedPointCount: number
  ): void {
    if (
      calibrationId.trim().length === 0
      || !Number.isInteger(expectedPointCount)
      || expectedPointCount <= 0
    ) {
      throw new RangeError(
        "DeepPersonalMapper.start() received invalid calibration metadata."
      );
    }

    this.calibrationId = calibrationId;
    this.expectedPointCount = expectedPointCount;
    this.points.clear();
    this.fitted = null;
  }

  /** Preserve the installed mapper while a detached candidate is re-fitted. */
  public forkForQuickRecalibration(): DeepPersonalMapper {
    if (this.calibrationId === null) {
      throw new RangeError("Cannot fork an uninitialized deep personal mapper.");
    }
    const candidate = new DeepPersonalMapper();
    candidate.calibrationId = this.calibrationId;
    candidate.expectedPointCount = this.expectedPointCount;
    for (const [index, summaries] of this.points) {
      candidate.points.set(index, [...summaries]);
    }
    candidate.fitted = this.fitted;
    return candidate;
  }

  public extendExpectedPointCount(
    nextExpectedPointCount: number
  ): void {
    if (
      this.calibrationId === null
      || !Number.isInteger(nextExpectedPointCount)
      || nextExpectedPointCount <= this.expectedPointCount
    ) {
      throw new RangeError(
        "DeepPersonalMapper.extendExpectedPointCount() received invalid calibration metadata."
      );
    }

    this.expectedPointCount = nextExpectedPointCount;
    this.fitted = null;
  }

  public addCalibrationPoint(
    input: DeepCalibrationPointInput,
    baseline: FaceBaseline
  ): DeepCalibrationPointSummary {
    if (this.calibrationId === null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Deep calibration point cannot be added before the mapper session starts."
      );
    }

    const qualityAcceptedSamples =
      input.samples.filter(isQualityAcceptedMapperSample);

    if (
      qualityAcceptedSamples.length
        < DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few quality-accepted synchronized deep observations are available for this calibration point.",
        {
          details: {
            pointIndex: input.pointIndex,
            rawSampleCount: input.samples.length,
            acceptedSampleCount: qualityAcceptedSamples.length,
            requiredSampleCount:
              DEEP_PERSONALIZATION.MIN_DEEP_SAMPLES_PER_POINT
          }
        }
      );
    }

    const acceptedInput: DeepCalibrationPointInput = {
      ...input,
      samples: qualityAcceptedSamples
    };

    const exemplars =
      createCalibrationExemplars(acceptedInput, baseline);

    this.points.set(
      input.pointIndex,
      exemplars
    );

    this.fitted = null;

    // Preserve the existing public return shape/logging using the accepted
    // samples while fitting retains multiple target-grouped exemplars.
    return summarizePoint(acceptedInput, baseline);
  }

  public fit(): DeepPersonalMapperFitResult {
    const pointGroups =
      [...this.points.entries()]
        .sort(
          ([firstIndex], [secondIndex]) =>
            firstIndex - secondIndex
        );

    const points = pointGroups.flatMap(
      ([, exemplars]) => exemplars
    );

    if (
      pointGroups.length
      < DEEP_PERSONALIZATION
        .MIN_CALIBRATION_POINT_COUNT
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few calibration targets contain synchronized deep observations to fit the personal screen mapper.",
        {
          details: {
            pointCount: pointGroups.length,
            requiredPointCount:
              DEEP_PERSONALIZATION
                .MIN_CALIBRATION_POINT_COUNT,
            expectedPointCount:
              this.expectedPointCount
          }
        }
      );
    }

    const candidates =
      evaluateCandidates(points);

    const selected =
      selectCandidate(candidates);

    const selectedPointResults =
      evaluateConfigurationPointwise(
        points,
        {
          kind: selected.kind,
          ridgeLambda: selected.ridgeLambda,
          rbfGammaScale: selected.rbfGammaScale
        }
      );

    const projection =
      fitProjection(
        points.map(
          (point) => point.meanFeature
        )
      );

    const combined =
      points.map(
        (point) =>
          createCombinedFeature(
            point,
            projection
          )
      );

    const kernel =
      fitKernelModel(
        combined,
        points.map(
          (point) =>
            point.targetNormalizedPoint
        ),
        {
          kind: selected.kind,
          ridgeLambda:
            selected.ridgeLambda,
          rbfGammaScale:
            selected.rbfGammaScale
        }
      );

    const fitResult:
      DeepPersonalMapperFitResult = {
        modelReady: true,
        calibrationPointCount:
          pointGroups.length,
        projectedFeatureDimension:
          projection.components.length,
        combinedFeatureDimension:
          combined[0]?.length ?? 0,
        selectedCandidate:
          selected,
        candidates,
        selectedPointResults,
        calibrationMeanConfidence:
          mean(
            points.map(
              (point) => point.meanConfidence
            )
          )
      };

    this.fitted = {
      projection,
      kernel,
      fitResult
    };

    return fitResult;
  }

  public predictSamples(
    samples: readonly GazeObserverRuntimeSample[],
    baseline: FaceBaseline
  ): Point2D | null {
    const fitted = this.fitted;

    if (
      fitted === null
      || samples.length
        < DEEP_PERSONALIZATION.RUNTIME_AGGREGATION_MIN_SAMPLE_COUNT
    ) {
      return null;
    }

    const summary = createLiveSummary(samples, baseline);
    const combined = createCombinedFeature(
      summary,
      fitted.projection
    );

    return predictKernelModel(
      fitted.kernel,
      combined
    );
  }

  /**
   * Single-sample inference remains available for independent validation,
   * where each accepted observation must be predicted separately before the
   * validator performs target-free robust aggregation. The live tracking path
   * intentionally uses `predictSamples()` through RuntimeDeepFeatureAggregator.
   */
  public predict(
    sample: GazeObserverRuntimeSample,
    baseline: FaceBaseline
  ): Point2D | null {
    const fitted = this.fitted;

    if (
      fitted === null
      || !isQualityAcceptedMapperSample(sample)
    ) {
      return null;
    }

    const summary = createLiveSummary([sample], baseline);
    const combined = createCombinedFeature(
      summary,
      fitted.projection
    );

    return predictKernelModel(
      fitted.kernel,
      combined
    );
  }

  public getFitResult():
  DeepPersonalMapperFitResult | null {
    return this.fitted?.fitResult ?? null;
  }

  public getSnapshot():
  DeepPersonalMapperSnapshot {
    return {
      calibrationId:
        this.calibrationId,
      expectedPointCount:
        this.expectedPointCount,
      collectedPointCount:
        this.points.size,
      modelReady:
        this.fitted !== null,
      selectedKind:
        this.fitted
          ?.fitResult
          .selectedCandidate
          .kind
        ?? null,
      projectedFeatureDimension:
        this.fitted
          ?.fitResult
          .projectedFeatureDimension
        ?? 0,
      combinedFeatureDimension:
        this.fitted
          ?.fitResult
          .combinedFeatureDimension
        ?? 0
    };
  }

  public reset(): void {
    this.calibrationId = null;
    this.expectedPointCount = 0;
    this.points.clear();
    this.fitted = null;
  }
}
