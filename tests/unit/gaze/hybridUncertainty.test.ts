import {
  describe,
  expect,
  it
} from "vitest";

import {
  DEEP_PERSONALIZATION
} from "../../../src/shared/constants";

import {
  estimateHybridUncertainty
} from "../../../src/gaze/hybridUncertainty";

const BASE_INPUT = {
  minimumViewportDimensionPx: 1_285,
  expectedHybridErrorPx: 95,
  directionalPriorReliability: 0.94,
  baselineWeight: 0.30,
  deepWeight: 0.70,
  baselinePrecisionPx: 45,
  baselineAcceptedSampleCount: 18,
  baselineRejectedSampleCount: 2,
  deepPrecisionPx: 40,
  deepAcceptedSampleCount: 5,
  deepRawSampleCount: 5,
  modelDisagreementNormalized: 0.05
} as const;

describe("estimateHybridUncertainty", () => {
  it("keeps a stable well-sampled point below the maximum radius", () => {
    const result = estimateHybridUncertainty(BASE_INPUT);

    expect(Number.isFinite(result.radiusNormalized)).toBe(true);
    expect(result.radiusNormalized).toBeGreaterThan(0);
    expect(result.radiusNormalized).toBeLessThan(
      DEEP_PERSONALIZATION
        .GAZE_REGION_MAX_UNCERTAINTY_RADIUS_NORMALIZED
    );
    expect(result.clamped).toBe(false);
  });

  it("increases uncertainty when target-free model disagreement grows", () => {
    const low = estimateHybridUncertainty({
      ...BASE_INPUT,
      modelDisagreementNormalized: 0.04
    });

    const high = estimateHybridUncertainty({
      ...BASE_INPUT,
      modelDisagreementNormalized: 0.16
    });

    expect(high.disagreementRadiusNormalized).toBeGreaterThan(
      low.disagreementRadiusNormalized
    );
    expect(high.radiusNormalized).toBeGreaterThan(
      low.radiusNormalized
    );
  });

  it("reduces centroid-noise uncertainty when more deep samples are accepted", () => {
    const fiveSamples = estimateHybridUncertainty({
      ...BASE_INPUT,
      deepAcceptedSampleCount: 5,
      deepRawSampleCount: 5
    });

    const eightSamples = estimateHybridUncertainty({
      ...BASE_INPUT,
      deepAcceptedSampleCount: 8,
      deepRawSampleCount: 8
    });

    expect(eightSamples.temporalNoiseRadiusNormalized).toBeLessThan(
      fiveSamples.temporalNoiseRadiusNormalized
    );
  });

  it("inflates centroid-noise uncertainty when many deep samples are rejected", () => {
    const fullyRetained = estimateHybridUncertainty({
      ...BASE_INPUT,
      deepAcceptedSampleCount: 5,
      deepRawSampleCount: 5
    });

    const partlyRetained = estimateHybridUncertainty({
      ...BASE_INPUT,
      deepAcceptedSampleCount: 5,
      deepRawSampleCount: 8
    });

    expect(partlyRetained.deepRetentionRatio).toBeLessThan(1);
    expect(partlyRetained.temporalNoiseRadiusNormalized).toBeGreaterThan(
      fullyRetained.temporalNoiseRadiusNormalized
    );
  });

  it("uses drift-derived directional reliability to conservatively inflate the calibration prior", () => {
    const stablePose = estimateHybridUncertainty({
      ...BASE_INPUT,
      directionalPriorReliability: 1
    });

    const driftedPose = estimateHybridUncertainty({
      ...BASE_INPUT,
      directionalPriorReliability:
        DEEP_PERSONALIZATION
          .HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY
    });

    expect(driftedPose.calibrationPriorRadiusNormalized).toBeGreaterThan(
      stablePose.calibrationPriorRadiusNormalized
    );
  });

  it("clamps only after the uncertainty components are combined", () => {
    const result = estimateHybridUncertainty({
      ...BASE_INPUT,
      expectedHybridErrorPx: 400,
      modelDisagreementNormalized: 0.30,
      directionalPriorReliability:
        DEEP_PERSONALIZATION
          .HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY
    });

    expect(result.unclampedRadiusNormalized).toBeGreaterThan(
      DEEP_PERSONALIZATION
        .GAZE_REGION_MAX_UNCERTAINTY_RADIUS_NORMALIZED
    );
    expect(result.radiusNormalized).toBe(
      DEEP_PERSONALIZATION
        .GAZE_REGION_MAX_UNCERTAINTY_RADIUS_NORMALIZED
    );
    expect(result.clamped).toBe(true);
  });
});
