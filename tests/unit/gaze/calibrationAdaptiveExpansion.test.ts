import {
  describe,
  expect,
  it
} from "vitest";

import {
  planAdaptiveCalibrationExpansion
} from "../../../src/gaze/calibrationAdaptiveExpansion";

import type {
  CalibrationGroupedCvPointResult
} from "../../../src/calibration/calibrationManager";

import type {
  CalibrationSessionStrategyFitResult,
  CalibrationSessionStrategyPointResult
} from "../../../src/gaze/calibrationSessionStrategySelector";

import type {
  Point2D
} from "../../../src/shared/types";

const VIEWPORT = {
  width: 1000,
  height: 800
} as const;

const TARGETS: readonly Point2D[] = [
  { x: 0.50, y: 0.50 },
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
  { x: 0.50, y: 0.08 },
  { x: 0.92, y: 0.50 },
  { x: 0.50, y: 0.92 },
  { x: 0.08, y: 0.50 },
  { x: 0.29, y: 0.29 },
  { x: 0.71, y: 0.29 },
  { x: 0.71, y: 0.71 },
  { x: 0.29, y: 0.71 },
  { x: 0.50, y: 0.29 },
  { x: 0.71, y: 0.50 },
  { x: 0.50, y: 0.71 },
  { x: 0.29, y: 0.50 }
];

function spatialBucket(
  target: Point2D
): "CENTER" | "EDGE" | "CORNER" {
  const horizontalOuter = target.x <= 0.33 || target.x >= 0.67;
  const verticalOuter = target.y <= 0.33 || target.y >= 0.67;

  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }

  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }

  return "CENTER";
}

function baselinePoints(): readonly CalibrationGroupedCvPointResult[] {
  return TARGETS.map((target, pointIndex) => ({
    pointIndex,
    targetNormalizedPoint: target,
    targetViewportPoint: {
      x: target.x * VIEWPORT.width,
      y: target.y * VIEWPORT.height
    },
    predictedNormalizedPoint: target,
    predictedViewportPoint: {
      x: target.x * VIEWPORT.width,
      y: target.y * VIEWPORT.height
    },
    errorPx: 0,
    spatialBucket: spatialBucket(target)
  }));
}

function pointResult(
  pointIndex: number,
  baselineErrorPx: number,
  deepErrorPx: number,
  hybridErrorPx: number
): CalibrationSessionStrategyPointResult {
  const target = TARGETS[pointIndex];

  if (target === undefined) {
    throw new RangeError("Unknown synthetic calibration point index.");
  }

  return {
    pointIndex,
    targetViewportPoint: {
      x: target.x * VIEWPORT.width,
      y: target.y * VIEWPORT.height
    },
    baselineErrorPx,
    deepErrorPx,
    safeHybridErrorPx: hybridErrorPx,
    safeHybridDeepWeight: 0.5,
    routingInfluence: 0,
    baselineRegionHit: true,
    deepRegionHit: true,
    safeHybridRegionHit: true
  };
}

function sessionFit(
  meanErrorPx: number,
  p95ErrorPx: number,
  points: readonly CalibrationSessionStrategyPointResult[]
): CalibrationSessionStrategyFitResult {
  const hybridCandidate = {
    strategy: "SAFE_ADAPTIVE_HYBRID" as const,
    pointCount: points.length,
    meanErrorPx,
    p95ErrorPx,
    rmsePx: meanErrorPx,
    maxErrorPx: p95ErrorPx,
    regionHitRate: 1,
    selectionScore: 1
  };

  const standaloneEvidence = {
    BASELINE_ONLY: {
      strategy: "BASELINE_ONLY" as const,
      nonTiedPointCount: points.length,
      standaloneWinCount: 0,
      hybridWinCount: points.length,
      oneSidedSignTestPValue: 1,
      aggregateNonInferiorToHybrid: false,
      pairedConsistencySupported: false,
      eligibleForStandaloneSelection: false
    },
    DEEP_ONLY: {
      strategy: "DEEP_ONLY" as const,
      nonTiedPointCount: points.length,
      standaloneWinCount: 0,
      hybridWinCount: points.length,
      oneSidedSignTestPValue: 1,
      aggregateNonInferiorToHybrid: false,
      pairedConsistencySupported: false,
      eligibleForStandaloneSelection: false
    }
  };

  return {
    selectedStrategy: "SAFE_ADAPTIVE_HYBRID",
    selectedCandidate: hybridCandidate,
    candidates: {
      BASELINE_ONLY: {
        ...hybridCandidate,
        strategy: "BASELINE_ONLY"
      },
      DEEP_ONLY: {
        ...hybridCandidate,
        strategy: "DEEP_ONLY"
      },
      SAFE_ADAPTIVE_HYBRID: hybridCandidate
    },
    activeCalibrationRoutingMode: "ERROR_DERIVED",
    calibrationRoutingInfluence: 0,
    standaloneEvidence,
    pointResults: points
  };
}

describe("Adaptive calibration expansion", () => {
  it("keeps STANDARD_17 when grouped-CV already satisfies existing acceptable error limits", () => {
    const points = TARGETS.map((_, index) =>
      pointResult(index, 30, 35, 25)
    );

    const plan = planAdaptiveCalibrationExpansion(
      baselinePoints(),
      sessionFit(30, 50, points),
      VIEWPORT
    );

    expect(plan.expansionRequired).toBe(false);
    expect(plan.trigger).toBe("NONE");
    expect(plan.additionalPointCount).toBe(0);
    expect(plan.finalExpectedPointCount).toBe(17);
  });

  it("adds a center-symmetric pair when every strategy is weak at one spatial location", () => {
    const points = TARGETS.map((_, index) =>
      index === 1
        ? pointResult(index, 180, 190, 170)
        : pointResult(index, 55, 60, 50)
    );

    const plan = planAdaptiveCalibrationExpansion(
      baselinePoints(),
      sessionFit(95, 180, points),
      VIEWPORT
    );

    expect(plan.expansionRequired).toBe(true);
    expect(plan.additionalPointCount).toBe(2);
    expect(plan.finalExpectedPointCount).toBe(19);
    expect(plan.weakPoints).toHaveLength(1);
    expect(plan.selectedTargets).toHaveLength(2);

    const first = plan.selectedTargets[0]?.target.normalizedPoint;
    const second = plan.selectedTargets[1]?.target.normalizedPoint;

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    if (first !== undefined && second !== undefined) {
      expect(first.x + second.x).toBeCloseTo(1);
      expect(first.y + second.y).toBeCloseTo(1);
    }
  });

  it("does not add spatial points when one engine is already accurate at the P95 outlier", () => {
    const points = TARGETS.map((_, index) =>
      index === 1
        ? pointResult(index, 250, 35, 180)
        : pointResult(index, 45, 40, 42)
    );

    const plan = planAdaptiveCalibrationExpansion(
      baselinePoints(),
      sessionFit(35, 180, points),
      VIEWPORT
    );

    expect(plan.expansionRequired).toBe(false);
    expect(plan.additionalPointCount).toBe(0);
    expect(plan.weakPoints).toHaveLength(0);
  });

  it("never expands beyond the eight PRECISION_25-only candidates", () => {
    const points = TARGETS.map((_, index) =>
      pointResult(index, 260, 250, 240)
    );

    const plan = planAdaptiveCalibrationExpansion(
      baselinePoints(),
      sessionFit(220, 280, points),
      VIEWPORT
    );

    expect(plan.expansionRequired).toBe(true);
    expect(plan.additionalPointCount).toBe(8);
    expect(plan.finalExpectedPointCount).toBe(25);
    expect(
      new Set(
        plan.selectedTargets.map(
          (selection) =>
            `${selection.target.normalizedPoint.x}:${selection.target.normalizedPoint.y}`
        )
      ).size
    ).toBe(8);
  });
});
