import {
  CALIBRATION,
  NUMERIC_EPSILON
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import {
  distance2D,
  isNormalizedPoint
} from "../shared/utils";

import type {
  Point2D
} from "../shared/types";

import type {
  CalibrationCleanedPoint
} from "./calibrationCleaner";

import { sameCalibrationTarget } from "./calibrationTargetGroups";

/* ========================================================================== 
 * Public model types
 * ======================================================================== */

export type AffineCoefficients = readonly [
  intercept: number,
  rawX: number,
  rawY: number
];

export type CalibrationResidualModelKind =
  | "AFFINE_RESIDUAL"
  | "QUADRATIC_RESIDUAL"
  | "RBF_RESIDUAL";

/**
 * Personal screen-space residual model selected using calibration-only
 * leave-one-point-out validation.
 *
 * Older payloads did not contain `kind`; they are intentionally interpreted as
 * AFFINE_RESIDUAL so saved/session models remain backwards compatible.
 */
export interface CalibrationResidualModel {
  readonly version: 1;
  readonly kind?: CalibrationResidualModelKind;
  readonly residualX: readonly number[];
  readonly residualY: readonly number[];
  readonly rbfAnchors?: readonly Point2D[];
  readonly rbfAlphaX?: readonly number[];
  readonly rbfAlphaY?: readonly number[];
  readonly rbfGamma?: number;
  readonly trainingPointCount: number;
  readonly trainingRmseNormalized: number;
  readonly selectionCvMeanErrorNormalized?: number;
  readonly selectionCvP95ErrorNormalized?: number;
}

interface ModelCandidate {
  readonly kind: CalibrationResidualModelKind;
  readonly lambda: number;
  readonly gamma?: number;
  readonly complexityPenalty: number;
}

interface CandidateEvaluation {
  readonly candidate: ModelCandidate;
  readonly meanError: number;
  readonly p95Error: number;
  readonly score: number;
}

export function createIdentityCalibrationResidualModel(
  trainingPointCount: number,
  trainingRmseNormalized = 0
): CalibrationResidualModel {
  if (
    !Number.isInteger(trainingPointCount)
    || trainingPointCount < CALIBRATION.MIN_MODEL_POINT_COUNT
    || !Number.isFinite(trainingRmseNormalized)
    || trainingRmseNormalized < 0
  ) {
    throw new RangeError(
      "Identity calibration residual model metadata is invalid."
    );
  }

  return {
    version: 1,
    kind: "AFFINE_RESIDUAL",
    residualX: [0, 0, 0],
    residualY: [0, 0, 0],
    trainingPointCount,
    trainingRmseNormalized
  };
}

/* ========================================================================== 
 * Numeric helpers
 * ======================================================================== */

function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  vector: readonly number[]
): number[] {
  const size = matrix.length;

  if (
    size === 0
    || vector.length !== size
    || matrix.some((row) => row.length !== size)
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration residual model received an invalid linear system."
    );
  }

  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    vector[rowIndex] ?? 0
  ]);

  for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    let pivotMagnitude = Math.abs(
      augmented[pivotRow]?.[pivotColumn] ?? 0
    );

    for (
      let candidateRow = pivotColumn + 1;
      candidateRow < size;
      candidateRow += 1
    ) {
      const candidateMagnitude = Math.abs(
        augmented[candidateRow]?.[pivotColumn] ?? 0
      );
      if (candidateMagnitude > pivotMagnitude) {
        pivotMagnitude = candidateMagnitude;
        pivotRow = candidateRow;
      }
    }

    if (pivotMagnitude <= NUMERIC_EPSILON) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model matrix is singular."
      );
    }

    if (pivotRow !== pivotColumn) {
      const temporary = augmented[pivotColumn];
      augmented[pivotColumn] = augmented[pivotRow] ?? [];
      augmented[pivotRow] = temporary ?? [];
    }

    const pivotValues = augmented[pivotColumn];
    if (pivotValues === undefined) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model lost its pivot row."
      );
    }

    const pivot = pivotValues[pivotColumn] ?? 0;
    for (let column = pivotColumn; column <= size; column += 1) {
      pivotValues[column] = (pivotValues[column] ?? 0) / pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivotColumn) continue;
      const rowValues = augmented[row];
      if (rowValues === undefined) continue;
      const factor = rowValues[pivotColumn] ?? 0;
      for (let column = pivotColumn; column <= size; column += 1) {
        rowValues[column] =
          (rowValues[column] ?? 0)
          - factor * (pivotValues[column] ?? 0);
      }
    }
  }

  const solution = augmented.map((row) => row[size] ?? Number.NaN);
  if (solution.some((value) => !Number.isFinite(value))) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration residual model produced non-finite coefficients."
    );
  }
  return solution;
}

function percentile(
  values: readonly number[],
  percentileValue: number
): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  );
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function squaredDistance(first: Point2D, second: Point2D): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function affineFeatures(rawPoint: Point2D): readonly number[] {
  return [1, rawPoint.x, rawPoint.y];
}

function quadraticFeatures(rawPoint: Point2D): readonly number[] {
  return [
    1,
    rawPoint.x,
    rawPoint.y,
    rawPoint.x * rawPoint.x,
    rawPoint.x * rawPoint.y,
    rawPoint.y * rawPoint.y
  ];
}

function fitFeatureResidualAxis(
  points: readonly CalibrationCleanedPoint[],
  axis: "x" | "y",
  featureBuilder: (point: Point2D) => readonly number[],
  lambda: number
): readonly number[] {
  const firstFeatures = featureBuilder(
    points[0]?.representativeRawPoint ?? { x: 0, y: 0 }
  );
  const dimension = firstFeatures.length;
  const normalMatrix = Array.from(
    { length: dimension },
    () => Array<number>(dimension).fill(0)
  );
  const normalVector = Array<number>(dimension).fill(0);

  for (const point of points) {
    const raw = point.representativeRawPoint;
    const target = point.targetNormalizedPoint;
    const features = featureBuilder(raw);
    const residual = axis === "x"
      ? target.x - raw.x
      : target.y - raw.y;

    for (let row = 0; row < dimension; row += 1) {
      const featureRow = features[row] ?? 0;
      normalVector[row] = (normalVector[row] ?? 0) + featureRow * residual;
      const matrixRow = normalMatrix[row];
      if (matrixRow === undefined) continue;
      for (let column = 0; column < dimension; column += 1) {
        matrixRow[column] =
          (matrixRow[column] ?? 0)
          + featureRow * (features[column] ?? 0);
      }
    }
  }

  // Do not regularize the intercept; shrink only shape terms.
  for (let index = 1; index < dimension; index += 1) {
    const row = normalMatrix[index];
    if (row !== undefined) {
      row[index] = (row[index] ?? 0) + lambda;
    }
  }

  return solveLinearSystem(normalMatrix, normalVector);
}

function dot(
  coefficients: readonly number[],
  features: readonly number[]
): number {
  let result = 0;
  const count = Math.min(coefficients.length, features.length);
  for (let index = 0; index < count; index += 1) {
    result += (coefficients[index] ?? 0) * (features[index] ?? 0);
  }
  return result;
}

function rbfKernel(
  first: Point2D,
  second: Point2D,
  gamma: number
): number {
  return Math.exp(-gamma * squaredDistance(first, second));
}

function fitRbfResidualAxis(
  points: readonly CalibrationCleanedPoint[],
  axis: "x" | "y",
  affineCoefficients: readonly number[],
  gamma: number,
  lambda: number
): readonly number[] {
  const count = points.length;
  const matrix = Array.from(
    { length: count },
    () => Array<number>(count).fill(0)
  );
  const targetResidual = Array<number>(count).fill(0);

  for (let row = 0; row < count; row += 1) {
    const point = points[row];
    if (point === undefined) continue;
    const raw = point.representativeRawPoint;
    const target = point.targetNormalizedPoint;
    const observedResidual = axis === "x"
      ? target.x - raw.x
      : target.y - raw.y;
    const affineResidual = dot(affineCoefficients, affineFeatures(raw));
    targetResidual[row] = observedResidual - affineResidual;

    const matrixRow = matrix[row];
    if (matrixRow === undefined) continue;
    for (let column = 0; column < count; column += 1) {
      const anchor = points[column]?.representativeRawPoint;
      if (anchor === undefined) continue;
      matrixRow[column] = rbfKernel(raw, anchor, gamma);
    }
    matrixRow[row] = (matrixRow[row] ?? 0) + lambda;
  }

  return solveLinearSystem(matrix, targetResidual);
}

function modelKind(model: CalibrationResidualModel): CalibrationResidualModelKind {
  return model.kind ?? "AFFINE_RESIDUAL";
}

function predictResidualAxis(
  model: CalibrationResidualModel,
  rawPoint: Point2D,
  axis: "x" | "y"
): number {
  const coefficients = axis === "x" ? model.residualX : model.residualY;
  const kind = modelKind(model);

  if (kind === "QUADRATIC_RESIDUAL") {
    return dot(coefficients, quadraticFeatures(rawPoint));
  }

  const affineResidual = dot(coefficients, affineFeatures(rawPoint));
  if (kind !== "RBF_RESIDUAL") return affineResidual;

  const anchors = model.rbfAnchors ?? [];
  const alpha = axis === "x" ? model.rbfAlphaX ?? [] : model.rbfAlphaY ?? [];
  const gamma = model.rbfGamma ?? 0;
  if (
    anchors.length === 0
    || anchors.length !== alpha.length
    || !Number.isFinite(gamma)
    || gamma <= 0
  ) {
    return affineResidual;
  }

  let localResidual = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor === undefined) continue;
    localResidual += (alpha[index] ?? 0) * rbfKernel(rawPoint, anchor, gamma);
  }
  return affineResidual + localResidual;
}

function predictWithModel(
  model: CalibrationResidualModel,
  rawPoint: Point2D
): Point2D {
  return {
    x: rawPoint.x + predictResidualAxis(model, rawPoint, "x"),
    y: rawPoint.y + predictResidualAxis(model, rawPoint, "y")
  };
}

function assertTrainingPoint(point: CalibrationCleanedPoint): void {
  if (
    !isNormalizedPoint(point.targetNormalizedPoint)
    || !Number.isFinite(point.representativeRawPoint.x)
    || !Number.isFinite(point.representativeRawPoint.y)
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration model received a non-finite or invalid training point.",
      { details: { pointIndex: point.pointIndex } }
    );
  }
}

function fitCandidateModel(
  points: readonly CalibrationCleanedPoint[],
  candidate: ModelCandidate
): CalibrationResidualModel {
  const affineX = fitFeatureResidualAxis(
    points,
    "x",
    affineFeatures,
    candidate.lambda
  );
  const affineY = fitFeatureResidualAxis(
    points,
    "y",
    affineFeatures,
    candidate.lambda
  );

  if (candidate.kind === "AFFINE_RESIDUAL") {
    return {
      version: 1,
      kind: candidate.kind,
      residualX: affineX,
      residualY: affineY,
      trainingPointCount: points.length,
      trainingRmseNormalized: 0
    };
  }

  if (candidate.kind === "QUADRATIC_RESIDUAL") {
    return {
      version: 1,
      kind: candidate.kind,
      residualX: fitFeatureResidualAxis(
        points,
        "x",
        quadraticFeatures,
        candidate.lambda
      ),
      residualY: fitFeatureResidualAxis(
        points,
        "y",
        quadraticFeatures,
        candidate.lambda
      ),
      trainingPointCount: points.length,
      trainingRmseNormalized: 0
    };
  }

  const gamma = candidate.gamma ?? 8;
  return {
    version: 1,
    kind: candidate.kind,
    residualX: affineX,
    residualY: affineY,
    rbfAnchors: points.map((point) => ({ ...point.representativeRawPoint })),
    rbfAlphaX: fitRbfResidualAxis(
      points,
      "x",
      affineX,
      gamma,
      candidate.lambda
    ),
    rbfAlphaY: fitRbfResidualAxis(
      points,
      "y",
      affineY,
      gamma,
      candidate.lambda
    ),
    rbfGamma: gamma,
    trainingPointCount: points.length,
    trainingRmseNormalized: 0
  };
}

function candidateModels(): readonly ModelCandidate[] {
  return [
    {
      kind: "AFFINE_RESIDUAL",
      lambda: CALIBRATION.RESIDUAL_RIDGE_LAMBDA,
      complexityPenalty: 0
    },
    ...CALIBRATION.RESIDUAL_QUADRATIC_RIDGE_LAMBDAS.map((lambda) => ({
      kind: "QUADRATIC_RESIDUAL" as const,
      lambda,
      complexityPenalty: CALIBRATION.RESIDUAL_QUADRATIC_COMPLEXITY_PENALTY
    })),
    ...CALIBRATION.RESIDUAL_RBF_GAMMAS.flatMap((gamma) =>
      CALIBRATION.RESIDUAL_RBF_RIDGE_LAMBDAS.map((lambda) => ({
        kind: "RBF_RESIDUAL" as const,
        lambda,
        gamma,
        complexityPenalty: CALIBRATION.RESIDUAL_RBF_COMPLEXITY_PENALTY
      }))
    )
  ];
}

function evaluateCandidate(
  points: readonly CalibrationCleanedPoint[],
  candidate: ModelCandidate
): CandidateEvaluation | null {
  const errors: number[] = [];

  for (let holdoutIndex = 0; holdoutIndex < points.length; holdoutIndex += 1) {
    const heldOut = points[holdoutIndex];
    if (heldOut === undefined) continue;
    const trainingPoints = points.filter(
      (point) => !sameCalibrationTarget(
        point.targetNormalizedPoint, heldOut.targetNormalizedPoint
      )
    );
    if (trainingPoints.length < CALIBRATION.MIN_MODEL_POINT_COUNT) return null;

    try {
      const foldModel = fitCandidateModel(trainingPoints, candidate);
      const predicted = predictWithModel(
        foldModel,
        heldOut.representativeRawPoint
      );
      const error = distance2D(predicted, heldOut.targetNormalizedPoint);
      if (!Number.isFinite(error)) return null;
      errors.push(error);
    } catch {
      return null;
    }
  }

  if (errors.length !== points.length) return null;
  const meanError = mean(errors);
  const p95Error = percentile(errors, 0.95);
  return {
    candidate,
    meanError,
    p95Error,
    score:
      meanError
      + CALIBRATION.RESIDUAL_CV_P95_WEIGHT * p95Error
      + candidate.complexityPenalty
  };
}

function calculateTrainingRmse(
  points: readonly CalibrationCleanedPoint[],
  model: CalibrationResidualModel
): number {
  let squaredErrorSum = 0;
  for (const point of points) {
    const corrected = predictWithModel(model, point.representativeRawPoint);
    const error = distance2D(corrected, point.targetNormalizedPoint);
    squaredErrorSum += error * error;
  }
  return Math.sqrt(squaredErrorSum / points.length);
}

function isFiniteArray(values: readonly number[] | undefined): boolean {
  return values !== undefined
    && values.length > 0
    && values.every((value) => Number.isFinite(value));
}

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/* ========================================================================== 
 * Calibration model
 * ======================================================================== */

export class CalibrationModel {
  private model: CalibrationResidualModel | null = null;

  public fit(
    points: readonly CalibrationCleanedPoint[]
  ): CalibrationResidualModel {
    if (points.length < CALIBRATION.MIN_MODEL_POINT_COUNT) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
        "CALIBRATION",
        "Too few calibration points are available to fit the residual model.",
        {
          details: {
            pointCount: points.length,
            requiredPointCount: CALIBRATION.MIN_MODEL_POINT_COUNT
          }
        }
      );
    }

    for (const point of points) assertTrainingPoint(point);

    const evaluations = candidateModels()
      .map((candidate) => evaluateCandidate(points, candidate))
      .filter((value): value is CandidateEvaluation => value !== null)
      .sort((first, second) => first.score - second.score);

    const affineEvaluation = evaluations.find(
      (evaluation) => evaluation.candidate.kind === "AFFINE_RESIDUAL"
    ) ?? null;
    const bestEvaluation = evaluations[0] ?? null;

    if (bestEvaluation === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "No calibration residual candidate could be fitted safely."
      );
    }

    // Prefer the simpler affine model unless a nonlinear model demonstrates a
    // real leave-one-point-out improvement. This guards against 25-point RBF
    // overfit while still allowing cross-device nonlinear correction.
    const selectedEvaluation =
      affineEvaluation !== null
      && bestEvaluation.candidate.kind !== "AFFINE_RESIDUAL"
      && affineEvaluation.score - bestEvaluation.score
        < CALIBRATION.RESIDUAL_NONLINEAR_MIN_CV_IMPROVEMENT
        ? affineEvaluation
        : bestEvaluation;

    const fitted = fitCandidateModel(points, selectedEvaluation.candidate);
    const model: CalibrationResidualModel = {
      ...fitted,
      trainingRmseNormalized: calculateTrainingRmse(points, fitted),
      selectionCvMeanErrorNormalized: selectedEvaluation.meanError,
      selectionCvP95ErrorNormalized: selectedEvaluation.p95Error
    };

    this.model = model;
    return model;
  }

  public predict(rawPoint: Point2D): Point2D {
    const model = this.model;
    if (model === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model is not fitted."
      );
    }
    if (!isFinitePoint(rawPoint)) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model received a non-finite raw gaze point."
      );
    }
    return predictWithModel(model, rawPoint);
  }

  public getModel(): CalibrationResidualModel | null {
    return this.model;
  }

  public setModel(model: CalibrationResidualModel): void {
    const kind = modelKind(model);
    const expectedCoefficientCount = kind === "QUADRATIC_RESIDUAL" ? 6 : 3;
    const baseValid =
      model.version === 1
      && model.trainingPointCount >= CALIBRATION.MIN_MODEL_POINT_COUNT
      && Number.isFinite(model.trainingRmseNormalized)
      && model.trainingRmseNormalized >= 0
      && model.residualX.length === expectedCoefficientCount
      && model.residualY.length === expectedCoefficientCount
      && model.residualX.every((value) => Number.isFinite(value))
      && model.residualY.every((value) => Number.isFinite(value));

    const rbfValid = kind !== "RBF_RESIDUAL" || (
      Array.isArray(model.rbfAnchors)
      && model.rbfAnchors.length > 0
      && model.rbfAnchors.every(isFinitePoint)
      && isFiniteArray(model.rbfAlphaX)
      && isFiniteArray(model.rbfAlphaY)
      && model.rbfAlphaX?.length === model.rbfAnchors.length
      && model.rbfAlphaY?.length === model.rbfAnchors.length
      && Number.isFinite(model.rbfGamma)
      && (model.rbfGamma ?? 0) > 0
    );

    if (!baseValid || !rbfValid) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Calibration residual model payload is invalid."
      );
    }
    this.model = model;
  }

  public clear(): void {
    this.model = null;
  }
}
