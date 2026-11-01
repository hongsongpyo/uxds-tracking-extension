import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import type {
  CalibrationGroupedCvPointResult
} from "../calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult
} from "./deepPersonalMapper";

import type {
  CalibrationEngineReliabilityFitResult
} from "./calibrationEngineReliability";

import type {
  CalibrationCoarseReliabilityFitResult
} from "./calibrationCoarseEngineReliability";

import {
  classifyGazeScreenRegion
} from "./gazeRegionEstimator";

import type {
  Point2D
} from "../shared/types";

export type CalibrationSessionGazeStrategy =
  | "BASELINE_ONLY"
  | "DEEP_ONLY"
  | "SAFE_ADAPTIVE_HYBRID";

export interface CalibrationSessionStrategyPointResult {
  readonly pointIndex: number;
  readonly targetViewportPoint: Point2D;
  readonly baselineErrorPx: number;
  readonly deepErrorPx: number;
  readonly safeHybridErrorPx: number;
  readonly safeHybridDeepWeight: number;
  readonly routingInfluence: number;
  readonly baselineRegionHit: boolean;
  readonly deepRegionHit: boolean;
  readonly safeHybridRegionHit: boolean;
}

export interface CalibrationSessionStrategyCandidateMetrics {
  readonly strategy: CalibrationSessionGazeStrategy;
  readonly pointCount: number;
  readonly meanErrorPx: number;
  readonly p95ErrorPx: number;
  readonly rmsePx: number;
  readonly maxErrorPx: number;
  readonly regionHitRate: number;
  /**
   * Dimensionless minimax regret across Mean/P95/RMSE. A value of 1 means
   * the candidate is best on every included error metric. Region hit is a
   * deterministic tie-breaker, not folded into this score.
   */
  readonly selectionScore: number;
}

export interface CalibrationStandaloneSelectionEvidence {
  readonly strategy: "BASELINE_ONLY" | "DEEP_ONLY";
  readonly nonTiedPointCount: number;
  readonly standaloneWinCount: number;
  readonly hybridWinCount: number;
  /**
   * Exact one-sided sign-test probability under H0: either strategy is
   * equally likely to win a calibration point. Lower values mean the
   * standalone engine wins point-by-point more consistently.
   */
  readonly oneSidedSignTestPValue: number;
  readonly aggregateNonInferiorToHybrid: boolean;
  readonly pairedConsistencySupported: boolean;
  readonly eligibleForStandaloneSelection: boolean;
}

export interface CalibrationSessionStrategyFitResult {
  readonly selectedStrategy: CalibrationSessionGazeStrategy;
  readonly selectedCandidate: CalibrationSessionStrategyCandidateMetrics;
  readonly candidates:
    Readonly<Record<CalibrationSessionGazeStrategy, CalibrationSessionStrategyCandidateMetrics>>;
  readonly activeCalibrationRoutingMode:
    | "ERROR_DERIVED"
    | "DIRECTIONAL"
    | "COARSE";
  /**
   * Full-data calibration routing influence. The live selector may attenuate
   * this further from target-free current quality/disagreement evidence.
   */
  readonly calibrationRoutingInfluence: number;
  readonly standaloneEvidence: Readonly<{
    BASELINE_ONLY: CalibrationStandaloneSelectionEvidence;
    DEEP_ONLY: CalibrationStandaloneSelectionEvidence;
  }>;
  readonly pointResults: readonly CalibrationSessionStrategyPointResult[];
}

interface CandidatePoint {
  readonly pointIndex: number;
  readonly targetViewportPoint: Point2D;
  readonly predictedViewportPoint: Point2D;
  readonly errorPx: number;
  readonly regionHit: boolean;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Session strategy selector cannot average an empty set."
    );
  }

  return values.reduce((sum, value) => sum + value, 0)
    / values.length;
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
      "Session strategy selector received an invalid percentile request."
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
      "Session strategy selector percentile could not resolve its values."
    );
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function rmse(values: readonly number[]): number {
  return Math.sqrt(mean(values.map((value) => value * value)));
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function blendPoint(
  baseline: Point2D,
  deep: Point2D,
  deepWeight: number
): Point2D {
  const baselineWeight = 1 - deepWeight;

  return {
    x: baselineWeight * baseline.x + deepWeight * deep.x,
    y: baselineWeight * baseline.y + deepWeight * deep.y
  };
}

function pointErrorPx(
  point: Point2D,
  target: Point2D
): number {
  return Math.hypot(
    point.x - target.x,
    point.y - target.y
  );
}

function regionHit(
  predicted: Point2D,
  target: Point2D
): boolean {
  const targetRegion = classifyGazeScreenRegion(target);
  const predictedRegion = classifyGazeScreenRegion(predicted);

  return predictedRegion === targetRegion;
}

function candidateMetrics(
  strategy: CalibrationSessionGazeStrategy,
  points: readonly CandidatePoint[]
): Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore"> {
  const errors = points.map((point) => point.errorPx);

  return {
    strategy,
    pointCount: points.length,
    meanErrorPx: mean(errors),
    p95ErrorPx: percentile(errors, 0.95),
    rmsePx: rmse(errors),
    maxErrorPx: Math.max(...errors),
    regionHitRate: mean(
      points.map((point) => point.regionHit ? 1 : 0)
    )
  };
}

function liveCalibrationRoutingInfluence(
  engineReliability: CalibrationEngineReliabilityFitResult,
  coarseReliability: CalibrationCoarseReliabilityFitResult
): {
  readonly mode: "ERROR_DERIVED" | "DIRECTIONAL" | "COARSE";
  readonly influence: number;
} {
  if (coarseReliability.routingEnabled) {
    return {
      mode: "COARSE",
      influence: clamp(
        coarseReliability.crossValidation.improvedPointFraction,
        0,
        1
      )
    };
  }

  if (engineReliability.routingEnabled) {
    return {
      mode: "DIRECTIONAL",
      influence: clamp(
        engineReliability.crossValidation.improvedPointFraction,
        0,
        1
      )
    };
  }

  return {
    mode: "ERROR_DERIVED",
    influence: 0
  };
}

function directionalRoutingEnabledWithoutPoint(
  pointIndex: number,
  engineReliability: CalibrationEngineReliabilityFitResult
): boolean {
  const remaining =
    engineReliability.crossValidation.pointResults.filter(
      (point) => point.pointIndex !== pointIndex
    );

  if (remaining.length === 0) {
    return false;
  }

  const currentErrors = remaining.map(
    (point) => point.currentHybridErrorPx
  );
  const reliabilityErrors = remaining.map(
    (point) => point.reliabilityHybridErrorPx
  );

  return mean(reliabilityErrors) < mean(currentErrors)
    && percentile(reliabilityErrors, 0.95)
      <= percentile(currentErrors, 0.95);
}

function coarseRoutingEnabledWithoutPoint(
  pointIndex: number,
  coarseReliability: CalibrationCoarseReliabilityFitResult
): boolean {
  const remaining =
    coarseReliability.crossValidation.pointResults.filter(
      (point) => point.pointIndex !== pointIndex
    );

  if (remaining.length === 0) {
    return false;
  }

  const currentErrors = remaining.map(
    (point) => point.currentHybridErrorPx
  );
  const reliabilityErrors = remaining.map(
    (point) => point.coarseReliabilityHybridErrorPx
  );

  return mean(reliabilityErrors) < mean(currentErrors)
    && percentile(reliabilityErrors, 0.95)
      <= percentile(currentErrors, 0.95);
}

function leaveOneOutRouting(
  pointIndex: number,
  engineReliability: CalibrationEngineReliabilityFitResult,
  coarseReliability: CalibrationCoarseReliabilityFitResult
): {
  readonly mode: "ERROR_DERIVED" | "DIRECTIONAL" | "COARSE";
  readonly influence: number;
} {
  if (
    coarseRoutingEnabledWithoutPoint(
      pointIndex,
      coarseReliability
    )
  ) {
    const remaining =
      coarseReliability.crossValidation.pointResults.filter(
        (point) => point.pointIndex !== pointIndex
      );

    return {
      mode: "COARSE",
      influence: clamp(
        mean(remaining.map((point) => point.improved ? 1 : 0)),
        0,
        1
      )
    };
  }

  if (
    directionalRoutingEnabledWithoutPoint(
      pointIndex,
      engineReliability
    )
  ) {
    const remaining =
      engineReliability.crossValidation.pointResults.filter(
        (point) => point.pointIndex !== pointIndex
      );

    return {
      mode: "DIRECTIONAL",
      influence: clamp(
        mean(remaining.map((point) => point.improved ? 1 : 0)),
        0,
        1
      )
    };
  }

  return {
    mode: "ERROR_DERIVED",
    influence: 0
  };
}

function safeHybridPointResults(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  deepPoints: readonly DeepGroupedCvPointResult[],
  engineReliability: CalibrationEngineReliabilityFitResult,
  coarseReliability: CalibrationCoarseReliabilityFitResult
): readonly CalibrationSessionStrategyPointResult[] {
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point] as const)
  );

  const directionalCvByIndex = new Map(
    engineReliability.crossValidation.pointResults.map(
      (point) => [point.pointIndex, point] as const
    )
  );

  const coarseCvByIndex = new Map(
    coarseReliability.crossValidation.pointResults.map(
      (point) => [point.pointIndex, point] as const
    )
  );

  return baselinePoints.map((baseline) => {
    const deep = deepByIndex.get(baseline.pointIndex);
    const directionalCv = directionalCvByIndex.get(baseline.pointIndex);
    const coarseCv = coarseCvByIndex.get(baseline.pointIndex);

    if (
      deep === undefined
      || directionalCv === undefined
      || coarseCv === undefined
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Session strategy selector could not align grouped-CV point diagnostics.",
        { details: { pointIndex: baseline.pointIndex } }
      );
    }

    const currentDeepWeight = directionalCv.currentDeepWeight;

    const heldOutRouting = leaveOneOutRouting(
      baseline.pointIndex,
      engineReliability,
      coarseReliability
    );

    const reliabilityDeepWeight = heldOutRouting.mode === "COARSE"
      ? coarseCv.coarseReliabilityDeepWeight
      : heldOutRouting.mode === "DIRECTIONAL"
        ? directionalCv.reliabilityDeepWeight
        : currentDeepWeight;

    const routingInfluence = heldOutRouting.influence;

    const safeHybridDeepWeight = clamp(
      currentDeepWeight
        + routingInfluence
          * (reliabilityDeepWeight - currentDeepWeight),
      0,
      1
    );

    const safeHybridViewportPoint = blendPoint(
      baseline.predictedViewportPoint,
      deep.predictedViewportPoint,
      safeHybridDeepWeight
    );

    return {
      pointIndex: baseline.pointIndex,
      targetViewportPoint: baseline.targetViewportPoint,
      baselineErrorPx: baseline.errorPx,
      deepErrorPx: deep.errorPx,
      safeHybridErrorPx: pointErrorPx(
        safeHybridViewportPoint,
        baseline.targetViewportPoint
      ),
      safeHybridDeepWeight,
      routingInfluence,
      baselineRegionHit: regionHit(
        baseline.predictedNormalizedPoint,
        baseline.targetNormalizedPoint
      ),
      deepRegionHit: regionHit(
        deep.predictedNormalizedPoint,
        deep.targetNormalizedPoint
      ),
      safeHybridRegionHit: regionHit(
        blendPoint(
          baseline.predictedNormalizedPoint,
          deep.predictedNormalizedPoint,
          safeHybridDeepWeight
        ),
        baseline.targetNormalizedPoint
      )
    };
  });
}

function binomialCoefficient(
  n: number,
  k: number
): number {
  if (k < 0 || k > n) {
    return 0;
  }

  const effectiveK = Math.min(k, n - k);
  let result = 1;

  for (let index = 1; index <= effectiveK; index += 1) {
    result *= (n - effectiveK + index) / index;
  }

  return result;
}

function exactOneSidedSignTestPValue(
  winCount: number,
  nonTiedPointCount: number
): number {
  if (nonTiedPointCount <= 0) {
    return 1;
  }

  let upperTail = 0;

  for (
    let wins = winCount;
    wins <= nonTiedPointCount;
    wins += 1
  ) {
    upperTail += binomialCoefficient(
      nonTiedPointCount,
      wins
    );
  }

  return upperTail / (2 ** nonTiedPointCount);
}

function standaloneSelectionEvidence(
  standalone: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  hybrid: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  standaloneErrors: readonly number[],
  hybridErrors: readonly number[]
): CalibrationStandaloneSelectionEvidence {
  if (standaloneErrors.length !== hybridErrors.length) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Standalone strategy evidence requires paired calibration errors."
    );
  }

  let standaloneWinCount = 0;
  let hybridWinCount = 0;

  for (let index = 0; index < standaloneErrors.length; index += 1) {
    const standaloneError = standaloneErrors[index];
    const hybridError = hybridErrors[index];

    if (standaloneError === undefined || hybridError === undefined) {
      continue;
    }

    if (standaloneError < hybridError) {
      standaloneWinCount += 1;
    } else if (hybridError < standaloneError) {
      hybridWinCount += 1;
    }
  }

  const nonTiedPointCount =
    standaloneWinCount + hybridWinCount;

  const oneSidedSignTestPValue =
    exactOneSidedSignTestPValue(
      standaloneWinCount,
      nonTiedPointCount
    );

  const aggregateNonInferiorToHybrid =
    standalone.meanErrorPx <= hybrid.meanErrorPx
    && standalone.p95ErrorPx <= hybrid.p95ErrorPx
    && standalone.rmsePx <= hybrid.rmsePx
    && standalone.regionHitRate >= hybrid.regionHitRate;

  // 0.05 is a conventional one-sided statistical significance level, not a
  // tuned gaze-performance margin. It only requires consistent paired
  // calibration evidence before abandoning the safer hybrid default.
  const pairedConsistencySupported =
    oneSidedSignTestPValue <= 0.05;

  return {
    strategy: standalone.strategy === "BASELINE_ONLY"
      ? "BASELINE_ONLY"
      : "DEEP_ONLY",
    nonTiedPointCount,
    standaloneWinCount,
    hybridWinCount,
    oneSidedSignTestPValue,
    aggregateNonInferiorToHybrid,
    pairedConsistencySupported,
    eligibleForStandaloneSelection:
      aggregateNonInferiorToHybrid
      && pairedConsistencySupported
  };
}

function scoreCandidates(
  baseline: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  deep: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  hybrid: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">
): Readonly<Record<CalibrationSessionGazeStrategy, CalibrationSessionStrategyCandidateMetrics>> {
  const raw = [baseline, deep, hybrid] as const;

  const bestMean = Math.min(...raw.map((candidate) => candidate.meanErrorPx));
  const bestP95 = Math.min(...raw.map((candidate) => candidate.p95ErrorPx));
  const bestRmse = Math.min(...raw.map((candidate) => candidate.rmsePx));

  const withScores = raw.map((candidate) => ({
    ...candidate,
    selectionScore: Math.max(
      candidate.meanErrorPx / Math.max(1e-9, bestMean),
      candidate.p95ErrorPx / Math.max(1e-9, bestP95),
      candidate.rmsePx / Math.max(1e-9, bestRmse)
    )
  } satisfies CalibrationSessionStrategyCandidateMetrics));

  return Object.fromEntries(
    withScores.map((candidate) => [candidate.strategy, candidate] as const)
  ) as Readonly<Record<CalibrationSessionGazeStrategy, CalibrationSessionStrategyCandidateMetrics>>;
}

function selectCandidate(
  baseline: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  deep: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  hybrid: Omit<CalibrationSessionStrategyCandidateMetrics, "selectionScore">,
  baselineErrors: readonly number[],
  deepErrors: readonly number[],
  hybridErrors: readonly number[]
): {
  readonly selected: CalibrationSessionStrategyCandidateMetrics;
  readonly candidates:
    Readonly<Record<CalibrationSessionGazeStrategy, CalibrationSessionStrategyCandidateMetrics>>;
  readonly standaloneEvidence: Readonly<{
    BASELINE_ONLY: CalibrationStandaloneSelectionEvidence;
    DEEP_ONLY: CalibrationStandaloneSelectionEvidence;
  }>;
} {
  const candidates = scoreCandidates(
    baseline,
    deep,
    hybrid
  );

  const baselineEvidence = standaloneSelectionEvidence(
    baseline,
    hybrid,
    baselineErrors,
    hybridErrors
  );
  const deepEvidence = standaloneSelectionEvidence(
    deep,
    hybrid,
    deepErrors,
    hybridErrors
  );

  const eligibleStandalone = [
    baselineEvidence.eligibleForStandaloneSelection
      ? candidates.BASELINE_ONLY
      : null,
    deepEvidence.eligibleForStandaloneSelection
      ? candidates.DEEP_ONLY
      : null
  ].filter(
    (candidate): candidate is CalibrationSessionStrategyCandidateMetrics =>
      candidate !== null
  );

  const selected = eligibleStandalone.length === 0
    ? candidates.SAFE_ADAPTIVE_HYBRID
    : [...eligibleStandalone].sort((a, b) => {
        const scoreDelta = a.selectionScore - b.selectionScore;

        if (Math.abs(scoreDelta) > 1e-12) {
          return scoreDelta;
        }

        const regionDelta = b.regionHitRate - a.regionHitRate;

        if (Math.abs(regionDelta) > 1e-12) {
          return regionDelta;
        }

        return a.strategy === "BASELINE_ONLY" ? -1 : 1;
      })[0];

  if (selected === undefined) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Session strategy selector could not choose a calibration candidate."
    );
  }

  return {
    selected,
    candidates,
    standaloneEvidence: {
      BASELINE_ONLY: baselineEvidence,
      DEEP_ONLY: deepEvidence
    }
  };
}

/**
 * Selects one session-level gaze strategy using calibration grouped-CV only.
 * Independent validation remains a pure evaluation set and never changes the
 * selected strategy. The hybrid candidate uses conservative leave-one-point-
 * out routing influence, so a point's own routing success cannot strengthen
 * its own hybrid calibration estimate.
 */
export function fitCalibrationSessionStrategy(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  deepPoints: readonly DeepGroupedCvPointResult[],
  engineReliability: CalibrationEngineReliabilityFitResult,
  coarseReliability: CalibrationCoarseReliabilityFitResult
): CalibrationSessionStrategyFitResult {
  if (
    baselinePoints.length === 0
    || baselinePoints.length !== deepPoints.length
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Session strategy selection requires matching grouped-CV calibration points."
    );
  }

  const pointResults = safeHybridPointResults(
    baselinePoints,
    deepPoints,
    engineReliability,
    coarseReliability
  );

  const baselineCandidatePoints = baselinePoints.map((point) => ({
    pointIndex: point.pointIndex,
    targetViewportPoint: point.targetViewportPoint,
    predictedViewportPoint: point.predictedViewportPoint,
    errorPx: point.errorPx,
    regionHit: regionHit(
      point.predictedNormalizedPoint,
      point.targetNormalizedPoint
    )
  }));

  const deepCandidatePoints = deepPoints.map((point) => ({
    pointIndex: point.pointIndex,
    targetViewportPoint: point.targetViewportPoint,
    predictedViewportPoint: point.predictedViewportPoint,
    errorPx: point.errorPx,
    regionHit: regionHit(
      point.predictedNormalizedPoint,
      point.targetNormalizedPoint
    )
  }));

  const baselineCandidate = candidateMetrics(
    "BASELINE_ONLY",
    baselineCandidatePoints
  );

  const deepCandidate = candidateMetrics(
    "DEEP_ONLY",
    deepCandidatePoints
  );

  const baselineByIndex = new Map(
    baselinePoints.map((point) => [point.pointIndex, point] as const)
  );
  const deepByIndex = new Map(
    deepPoints.map((point) => [point.pointIndex, point] as const)
  );

  const safeHybridCandidatePoints = pointResults.map((point) => {
      const baseline = baselineByIndex.get(point.pointIndex);
      const deep = deepByIndex.get(point.pointIndex);

      if (baseline === undefined || deep === undefined) {
        throw new TrackerError(
          ERROR_CODES.CALIBRATION_MODEL_FAILED,
          "CALIBRATION",
          "Session strategy selector lost an aligned hybrid calibration point.",
          { details: { pointIndex: point.pointIndex } }
        );
      }

      const predictedViewportPoint = blendPoint(
        baseline.predictedViewportPoint,
        deep.predictedViewportPoint,
        point.safeHybridDeepWeight
      );

      return {
        pointIndex: point.pointIndex,
        targetViewportPoint: point.targetViewportPoint,
        predictedViewportPoint,
        errorPx: point.safeHybridErrorPx,
        regionHit: point.safeHybridRegionHit
      };
    });

  const safeHybridCandidate = candidateMetrics(
    "SAFE_ADAPTIVE_HYBRID",
    safeHybridCandidatePoints
  );

  const selection = selectCandidate(
    baselineCandidate,
    deepCandidate,
    safeHybridCandidate,
    baselineCandidatePoints.map((point) => point.errorPx),
    deepCandidatePoints.map((point) => point.errorPx),
    safeHybridCandidatePoints.map((point) => point.errorPx)
  );

  const activeRouting = liveCalibrationRoutingInfluence(
    engineReliability,
    coarseReliability
  );

  return {
    selectedStrategy: selection.selected.strategy,
    selectedCandidate: selection.selected,
    candidates: selection.candidates,
    activeCalibrationRoutingMode: activeRouting.mode,
    calibrationRoutingInfluence: activeRouting.influence,
    standaloneEvidence: selection.standaloneEvidence,
    pointResults
  };
}
