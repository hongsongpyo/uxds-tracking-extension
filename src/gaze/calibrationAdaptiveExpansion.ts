import {
  CALIBRATION,
  CALIBRATION_VALIDATION_THRESHOLDS
} from "../shared/constants";

import {
  createCalibrationExpansionCandidates
} from "../calibration/calibrationPattern";

import type {
  CalibrationGroupedCvPointResult
} from "../calibration/calibrationManager";

import type {
  CalibrationSessionStrategyFitResult,
  CalibrationSessionStrategyPointResult
} from "./calibrationSessionStrategySelector";

import type {
  CalibrationTarget,
  Point2D,
  Size2D
} from "../shared/types";

export type AdaptiveCalibrationExpansionTrigger =
  | "NONE"
  | "MEAN_ERROR"
  | "P95_ERROR";

export interface AdaptiveCalibrationWeakPoint {
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  /**
   * Error of the best of Baseline / Deep / Safe Hybrid. A high floor means
   * every currently available strategy is weak at this calibration location,
   * making extra spatial support more appropriate than another ensemble tweak.
   */
  readonly coverageFloorErrorPx: number;
  readonly baselineErrorPx: number;
  readonly deepErrorPx: number;
  readonly safeHybridErrorPx: number;
  readonly allStrategiesRegionMiss: boolean;
}

export interface AdaptiveCalibrationSelectedTarget {
  /** Original index inside PRECISION_25 before adaptive re-indexing. */
  readonly sourcePrecisionPointIndex: number;
  readonly target: CalibrationTarget;
  readonly selectedForWeakPointIndex: number;
  readonly symmetryPartner: boolean;
}

export interface AdaptiveCalibrationExpansionPlan {
  readonly expansionRequired: boolean;
  readonly trigger: AdaptiveCalibrationExpansionTrigger;
  readonly provisionalSelectedStrategy:
    CalibrationSessionStrategyFitResult["selectedStrategy"];
  readonly provisionalMeanErrorPx: number;
  readonly provisionalP95ErrorPx: number;
  readonly acceptableMeanErrorPx: number;
  readonly acceptableP95ErrorPx: number;
  readonly weakPointThresholdPx: number | null;
  readonly weakPoints: readonly AdaptiveCalibrationWeakPoint[];
  readonly selectedTargets: readonly AdaptiveCalibrationSelectedTarget[];
  readonly additionalPointCount: number;
  readonly finalExpectedPointCount: number;
}

function squaredDistance(
  first: Point2D,
  second: Point2D
): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function findStrategyPoint(
  points: readonly CalibrationSessionStrategyPointResult[],
  pointIndex: number
): CalibrationSessionStrategyPointResult | null {
  return points.find((point) => point.pointIndex === pointIndex) ?? null;
}

function createWeakPoints(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  sessionStrategy: CalibrationSessionStrategyFitResult,
  thresholdPx: number
): AdaptiveCalibrationWeakPoint[] {
  const weakPoints: AdaptiveCalibrationWeakPoint[] = [];

  for (const baselinePoint of baselinePoints) {
    const strategyPoint = findStrategyPoint(
      sessionStrategy.pointResults,
      baselinePoint.pointIndex
    );

    if (strategyPoint === null) {
      continue;
    }

    const coverageFloorErrorPx = Math.min(
      strategyPoint.baselineErrorPx,
      strategyPoint.deepErrorPx,
      strategyPoint.safeHybridErrorPx
    );

    if (coverageFloorErrorPx <= thresholdPx) {
      continue;
    }

    weakPoints.push({
      pointIndex: baselinePoint.pointIndex,
      targetNormalizedPoint: {
        ...baselinePoint.targetNormalizedPoint
      },
      targetViewportPoint: {
        ...baselinePoint.targetViewportPoint
      },
      coverageFloorErrorPx,
      baselineErrorPx: strategyPoint.baselineErrorPx,
      deepErrorPx: strategyPoint.deepErrorPx,
      safeHybridErrorPx: strategyPoint.safeHybridErrorPx,
      allStrategiesRegionMiss:
        !strategyPoint.baselineRegionHit
        && !strategyPoint.deepRegionHit
        && !strategyPoint.safeHybridRegionHit
    });
  }

  return weakPoints.sort((first, second) => {
    if (
      first.allStrategiesRegionMiss
      !== second.allStrategiesRegionMiss
    ) {
      return first.allStrategiesRegionMiss ? -1 : 1;
    }

    const errorDifference =
      second.coverageFloorErrorPx
      - first.coverageFloorErrorPx;

    if (Math.abs(errorDifference) > Number.EPSILON) {
      return errorDifference;
    }

    return first.pointIndex - second.pointIndex;
  });
}

function findSymmetryPartnerIndex(
  candidates: readonly CalibrationTarget[],
  sourceIndex: number
): number | null {
  const source = candidates[sourceIndex];

  if (source === undefined) {
    return null;
  }

  const mirrored = {
    x: 1 - source.normalizedPoint.x,
    y: 1 - source.normalizedPoint.y
  };

  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    if (candidate === undefined) {
      continue;
    }

    const distance = squaredDistance(
      candidate.normalizedPoint,
      mirrored
    );

    if (
      distance < bestDistance
      || (
        distance === bestDistance
        && bestIndex !== null
        && candidate.pointIndex
          < (candidates[bestIndex]?.pointIndex ?? Number.POSITIVE_INFINITY)
      )
    ) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function nearestUnusedCandidateIndex(
  candidates: readonly CalibrationTarget[],
  used: ReadonlySet<number>,
  target: Point2D
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    if (used.has(index)) {
      continue;
    }

    const candidate = candidates[index];

    if (candidate === undefined) {
      continue;
    }

    const distance = squaredDistance(
      candidate.normalizedPoint,
      target
    );

    if (
      distance < bestDistance
      || (
        distance === bestDistance
        && bestIndex !== null
        && candidate.pointIndex
          < (candidates[bestIndex]?.pointIndex ?? Number.POSITIVE_INFINITY)
      )
    ) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function selectBalancedExpansionTargets(
  weakPoints: readonly AdaptiveCalibrationWeakPoint[],
  viewport: Size2D
): AdaptiveCalibrationSelectedTarget[] {
  const candidates = createCalibrationExpansionCandidates(viewport);
  const used = new Set<number>();
  const selected: Array<{
    readonly sourcePrecisionPointIndex: number;
    readonly sourceTarget: CalibrationTarget;
    readonly selectedForWeakPointIndex: number;
    readonly symmetryPartner: boolean;
  }> = [];

  for (const weakPoint of weakPoints) {
    if (used.size >= candidates.length) {
      break;
    }

    const nearestIndex = nearestUnusedCandidateIndex(
      candidates,
      used,
      weakPoint.targetNormalizedPoint
    );

    if (nearestIndex === null) {
      break;
    }

    const nearest = candidates[nearestIndex];

    if (nearest === undefined) {
      continue;
    }

    used.add(nearestIndex);
    selected.push({
      sourcePrecisionPointIndex: nearest.pointIndex,
      sourceTarget: nearest,
      selectedForWeakPointIndex: weakPoint.pointIndex,
      symmetryPartner: false
    });

    if (used.size >= candidates.length) {
      break;
    }

    const partnerIndex = findSymmetryPartnerIndex(
      candidates,
      nearestIndex
    );

    if (
      partnerIndex !== null
      && !used.has(partnerIndex)
    ) {
      const partner = candidates[partnerIndex];

      if (partner !== undefined) {
        used.add(partnerIndex);
        selected.push({
          sourcePrecisionPointIndex: partner.pointIndex,
          sourceTarget: partner,
          selectedForWeakPointIndex: weakPoint.pointIndex,
          symmetryPartner: true
        });
      }
    }
  }

  return selected
    .slice(
      0,
      CALIBRATION.PRECISION_POINT_COUNT
        - CALIBRATION.STANDARD_POINT_COUNT
    )
    .map((selection, selectionIndex) => ({
      sourcePrecisionPointIndex:
        selection.sourcePrecisionPointIndex,
      target: {
        pointIndex:
          CALIBRATION.STANDARD_POINT_COUNT
          + selectionIndex,
        normalizedPoint: {
          ...selection.sourceTarget.normalizedPoint
        },
        viewportPoint: {
          ...selection.sourceTarget.viewportPoint
        }
      },
      selectedForWeakPointIndex:
        selection.selectedForWeakPointIndex,
      symmetryPartner:
        selection.symmetryPartner
    }));
}

/**
 * Plans a single calibration-only adaptive expansion after STANDARD_17.
 *
 * Independent validation is deliberately absent from the API. Expansion is
 * triggered only when provisional grouped-CV error misses the existing
 * ACCEPTABLE readiness error limits and there are locations where Baseline,
 * Deep and Safe Hybrid are all weak. The extra targets come exclusively from
 * the eight PRECISION_25 lattice points not already present in STANDARD_17.
 */
export function planAdaptiveCalibrationExpansion(
  baselinePoints: readonly CalibrationGroupedCvPointResult[],
  sessionStrategy: CalibrationSessionStrategyFitResult,
  viewport: Size2D
): AdaptiveCalibrationExpansionPlan {
  const selected = sessionStrategy.selectedCandidate;

  const acceptableMeanErrorPx =
    viewport.width
    * CALIBRATION_VALIDATION_THRESHOLDS
      .ACCEPTABLE_MAX_MEAN_ERROR_WIDTH_RATIO;

  const acceptableP95ErrorPx = Math.min(
    viewport.width
      * CALIBRATION_VALIDATION_THRESHOLDS
        .ACCEPTABLE_MAX_P95_ERROR_WIDTH_RATIO,
    CALIBRATION_VALIDATION_THRESHOLDS
      .ABSOLUTE_MAX_P95_ERROR_PX
  );

  const meanFailed =
    selected.meanErrorPx > acceptableMeanErrorPx;
  const p95Failed =
    selected.p95ErrorPx > acceptableP95ErrorPx;

  if (!meanFailed && !p95Failed) {
    return {
      expansionRequired: false,
      trigger: "NONE",
      provisionalSelectedStrategy:
        sessionStrategy.selectedStrategy,
      provisionalMeanErrorPx: selected.meanErrorPx,
      provisionalP95ErrorPx: selected.p95ErrorPx,
      acceptableMeanErrorPx,
      acceptableP95ErrorPx,
      weakPointThresholdPx: null,
      weakPoints: [],
      selectedTargets: [],
      additionalPointCount: 0,
      finalExpectedPointCount:
        CALIBRATION.STANDARD_POINT_COUNT
    };
  }

  let trigger: AdaptiveCalibrationExpansionTrigger =
    p95Failed ? "P95_ERROR" : "MEAN_ERROR";

  let weakPointThresholdPx =
    p95Failed
      ? acceptableP95ErrorPx
      : acceptableMeanErrorPx;

  let weakPoints = createWeakPoints(
    baselinePoints,
    sessionStrategy,
    weakPointThresholdPx
  );

  /*
   * If P95 failed because of model-selection/ensemble behavior rather than a
   * location where every engine is weak, do not blindly add spatial support.
   * When mean error also fails, a second pass at the existing mean limit is
   * justified because broad moderate error can still indicate sparse coverage.
   */
  if (
    weakPoints.length === 0
    && p95Failed
    && meanFailed
  ) {
    trigger = "MEAN_ERROR";
    weakPointThresholdPx = acceptableMeanErrorPx;
    weakPoints = createWeakPoints(
      baselinePoints,
      sessionStrategy,
      weakPointThresholdPx
    );
  }

  if (weakPoints.length === 0) {
    return {
      expansionRequired: false,
      trigger,
      provisionalSelectedStrategy:
        sessionStrategy.selectedStrategy,
      provisionalMeanErrorPx: selected.meanErrorPx,
      provisionalP95ErrorPx: selected.p95ErrorPx,
      acceptableMeanErrorPx,
      acceptableP95ErrorPx,
      weakPointThresholdPx,
      weakPoints: [],
      selectedTargets: [],
      additionalPointCount: 0,
      finalExpectedPointCount:
        CALIBRATION.STANDARD_POINT_COUNT
    };
  }

  const selectedTargets =
    selectBalancedExpansionTargets(
      weakPoints,
      viewport
    );

  return {
    expansionRequired: selectedTargets.length > 0,
    trigger,
    provisionalSelectedStrategy:
      sessionStrategy.selectedStrategy,
    provisionalMeanErrorPx: selected.meanErrorPx,
    provisionalP95ErrorPx: selected.p95ErrorPx,
    acceptableMeanErrorPx,
    acceptableP95ErrorPx,
    weakPointThresholdPx,
    weakPoints,
    selectedTargets,
    additionalPointCount: selectedTargets.length,
    finalExpectedPointCount:
      CALIBRATION.STANDARD_POINT_COUNT
      + selectedTargets.length
  };
}
