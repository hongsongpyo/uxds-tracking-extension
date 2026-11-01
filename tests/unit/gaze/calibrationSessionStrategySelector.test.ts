import {
  describe,
  expect,
  it
} from "vitest";

import {
  fitCalibrationSessionStrategy
} from "../../../src/gaze/calibrationSessionStrategySelector";

import {
  fitCalibrationEngineReliabilityModel
} from "../../../src/gaze/calibrationEngineReliability";

import {
  fitCalibrationCoarseEngineReliabilityModel
} from "../../../src/gaze/calibrationCoarseEngineReliability";

import type {
  CalibrationGroupedCvPointResult,
  CalibrationGroupedCvSpatialBucket
} from "../../../src/calibration/calibrationManager";

import type {
  DeepGroupedCvPointResult
} from "../../../src/gaze/deepPersonalMapper";

import type {
  Point2D
} from "../../../src/shared/types";

const TARGETS: readonly Point2D[] = [
  { x: 0.50, y: 0.50 },
  { x: 0.18, y: 0.18 },
  { x: 0.82, y: 0.18 },
  { x: 0.82, y: 0.82 },
  { x: 0.18, y: 0.82 },
  { x: 0.50, y: 0.18 },
  { x: 0.82, y: 0.50 },
  { x: 0.50, y: 0.82 },
  { x: 0.18, y: 0.50 }
];

function spatialBucket(
  point: Point2D
): CalibrationGroupedCvSpatialBucket {
  const horizontalOuter = point.x <= 0.33 || point.x >= 0.67;
  const verticalOuter = point.y <= 0.33 || point.y >= 0.67;

  if (horizontalOuter && verticalOuter) {
    return "CORNER";
  }

  if (horizontalOuter || verticalOuter) {
    return "EDGE";
  }

  return "CENTER";
}

function offsetPoint(
  target: Point2D,
  offsetXPx: number,
  offsetYPx: number
): {
  readonly normalized: Point2D;
  readonly viewport: Point2D;
  readonly errorPx: number;
} {
  const viewportWidth = 1000;
  const viewportHeight = 800;
  const targetViewport = {
    x: target.x * viewportWidth,
    y: target.y * viewportHeight
  };
  const viewport = {
    x: targetViewport.x + offsetXPx,
    y: targetViewport.y + offsetYPx
  };

  return {
    normalized: {
      x: viewport.x / viewportWidth,
      y: viewport.y / viewportHeight
    },
    viewport,
    errorPx: Math.hypot(offsetXPx, offsetYPx)
  };
}

function makePoints(
  baselineOffset: (index: number) => Point2D,
  deepOffset: (index: number) => Point2D
): {
  readonly baseline: readonly CalibrationGroupedCvPointResult[];
  readonly deep: readonly DeepGroupedCvPointResult[];
} {
  const baseline = TARGETS.map((target, pointIndex) => {
    const offset = baselineOffset(pointIndex);
    const predicted = offsetPoint(target, offset.x, offset.y);

    return {
      pointIndex,
      targetNormalizedPoint: target,
      targetViewportPoint: {
        x: target.x * 1000,
        y: target.y * 800
      },
      predictedNormalizedPoint: predicted.normalized,
      predictedViewportPoint: predicted.viewport,
      errorPx: predicted.errorPx,
      spatialBucket: spatialBucket(target)
    } satisfies CalibrationGroupedCvPointResult;
  });

  const deep = TARGETS.map((target, pointIndex) => {
    const offset = deepOffset(pointIndex);
    const predicted = offsetPoint(target, offset.x, offset.y);

    return {
      pointIndex,
      targetNormalizedPoint: target,
      targetViewportPoint: {
        x: target.x * 1000,
        y: target.y * 800
      },
      predictedNormalizedPoint: predicted.normalized,
      predictedViewportPoint: predicted.viewport,
      errorPx: predicted.errorPx,
      spatialBucket: spatialBucket(target)
    } satisfies DeepGroupedCvPointResult;
  });

  return { baseline, deep };
}

function fitStrategy(
  baseline: readonly CalibrationGroupedCvPointResult[],
  deep: readonly DeepGroupedCvPointResult[]
) {
  const directional = fitCalibrationEngineReliabilityModel(
    baseline,
    deep
  );
  const coarse = fitCalibrationCoarseEngineReliabilityModel(
    baseline,
    deep
  );

  return fitCalibrationSessionStrategy(
    baseline,
    deep,
    directional,
    coarse
  );
}

describe("Calibration session strategy selection", () => {
  it("selects BASELINE_ONLY when baseline grouped-CV is consistently safer", () => {
    const points = makePoints(
      () => ({ x: 20, y: 0 }),
      () => ({ x: 140, y: 0 })
    );

    const fit = fitStrategy(points.baseline, points.deep);

    expect(fit.selectedStrategy).toBe("BASELINE_ONLY");
    expect(fit.candidates.BASELINE_ONLY.meanErrorPx)
      .toBeLessThan(fit.candidates.DEEP_ONLY.meanErrorPx);
  });

  it("selects DEEP_ONLY when deep grouped-CV is consistently safer", () => {
    const points = makePoints(
      () => ({ x: 150, y: 0 }),
      () => ({ x: 18, y: 0 })
    );

    const fit = fitStrategy(points.baseline, points.deep);

    expect(fit.selectedStrategy).toBe("DEEP_ONLY");
    expect(fit.candidates.DEEP_ONLY.p95ErrorPx)
      .toBeLessThan(fit.candidates.BASELINE_ONLY.p95ErrorPx);
  });

  it("selects SAFE_ADAPTIVE_HYBRID when complementary engine errors cancel", () => {
    const points = makePoints(
      () => ({ x: 100, y: 0 }),
      () => ({ x: -100, y: 0 })
    );

    const fit = fitStrategy(points.baseline, points.deep);

    expect(fit.selectedStrategy).toBe("SAFE_ADAPTIVE_HYBRID");
    expect(fit.candidates.SAFE_ADAPTIVE_HYBRID.meanErrorPx)
      .toBeLessThan(fit.candidates.BASELINE_ONLY.meanErrorPx);
    expect(fit.candidates.SAFE_ADAPTIVE_HYBRID.meanErrorPx)
      .toBeLessThan(fit.candidates.DEEP_ONLY.meanErrorPx);
  });


  it("keeps SAFE_ADAPTIVE_HYBRID when a standalone engine wins aggregate metrics without consistent paired wins", () => {
    const points = makePoints(
      (index) => index < 5
        ? ({ x: 300, y: 0 })
        : ({ x: 90, y: 0 }),
      () => ({ x: 100, y: 0 })
    );

    const fit = fitStrategy(points.baseline, points.deep);

    expect(fit.candidates.DEEP_ONLY.meanErrorPx)
      .toBeLessThanOrEqual(
        fit.candidates.SAFE_ADAPTIVE_HYBRID.meanErrorPx
      );
    expect(fit.standaloneEvidence.DEEP_ONLY.pairedConsistencySupported)
      .toBe(false);
    expect(fit.standaloneEvidence.DEEP_ONLY.eligibleForStandaloneSelection)
      .toBe(false);
    expect(fit.selectedStrategy)
      .toBe("SAFE_ADAPTIVE_HYBRID");
  });

  it("uses leave-one-out routing influence for the hybrid calibration estimate", () => {
    const points = makePoints(
      () => ({ x: 90, y: 0 }),
      (index) => index === 0
        ? ({ x: 260, y: 0 })
        : ({ x: -60, y: 0 })
    );

    const fit = fitStrategy(points.baseline, points.deep);
    const heldOut = fit.pointResults.find(
      (point) => point.pointIndex === 0
    );

    expect(heldOut).toBeDefined();
    expect(heldOut?.routingInfluence).toBeGreaterThanOrEqual(0);
    expect(heldOut?.routingInfluence).toBeLessThanOrEqual(1);
    expect(Number.isFinite(heldOut?.safeHybridErrorPx ?? Number.NaN))
      .toBe(true);
  });
});
