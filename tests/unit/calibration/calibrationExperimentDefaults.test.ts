import {
  describe,
  expect,
  it
} from "vitest";

import {
  classifyCalibrationValidationQuality
} from "../../../src/calibration/calibrationValidator";

import {
  CALIBRATION
} from "../../../src/shared/constants";

import type {
  CalibrationValidationMetrics
} from "../../../src/shared/types";

function metricsWithRatios(
  meanErrorViewportWidthRatio: number,
  p95ErrorViewportWidthRatio: number,
  meanPrecisionViewportWidthRatio: number,
  p95PrecisionViewportWidthRatio: number,
  validSampleRatio = 0.96
): CalibrationValidationMetrics {
  const viewportWidthPx = 2_268;

  return {
    viewportWidthPx,
    viewportHeightPx: 1_285,
    rawMeanErrorPx: 200,
    rawP95ErrorPx: 250,
    rawRmsePx: 210,
    meanErrorPx:
      meanErrorViewportWidthRatio
      * viewportWidthPx,
    medianErrorPx: 70,
    rmsePx: 100,
    p90ErrorPx: 120,
    p95ErrorPx:
      p95ErrorViewportWidthRatio
      * viewportWidthPx,
    maxErrorPx: 190,
    horizontalErrorPx: 60,
    verticalErrorPx: 55,
    centerErrorPx: 70,
    edgeErrorPx: 95,
    cornerErrorPx: 110,
    meanErrorViewportWidthRatio,
    p95ErrorViewportWidthRatio,
    meanPrecisionPx:
      meanPrecisionViewportWidthRatio
      * viewportWidthPx,
    p95PrecisionPx:
      p95PrecisionViewportWidthRatio
      * viewportWidthPx,
    meanPrecisionViewportWidthRatio,
    p95PrecisionViewportWidthRatio,
    meanCorrectionImprovementPx: 50,
    improvedPointCount: 7,
    degradedPointCount: 2,
    validSampleRatio
  };
}

describe("research experiment calibration defaults", () => {
  it("uses the full PRECISION_25 calibration pattern by default", () => {
    expect(CALIBRATION.DEFAULT_MODE)
      .toBe("PRECISION_25");
  });

  it("accepts a borderline high-P95-precision session inside the modestly relaxed band", () => {
    const quality =
      classifyCalibrationValidationQuality(
        metricsWithRatios(
          0.034,
          0.063,
          0.023,
          0.053
        )
      );

    expect(quality).toBe("ACCEPTABLE");
  });

  it("still rejects clearly weaker accuracy from the READY band", () => {
    const quality =
      classifyCalibrationValidationQuality(
        metricsWithRatios(
          0.050,
          0.085,
          0.035,
          0.065
        )
      );

    expect(quality).toBe("POOR");
  });

  it("keeps the GOOD band unchanged", () => {
    const quality =
      classifyCalibrationValidationQuality(
        metricsWithRatios(
          0.029,
          0.049,
          0.019,
          0.034,
          0.90
        )
      );

    expect(quality).toBe("GOOD");
  });
});
