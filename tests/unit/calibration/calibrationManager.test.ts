import {
  describe,
  expect,
  it
} from "vitest";

import {
  CalibrationManager
} from "../../../src/calibration/calibrationManager";

import {
  createCalibrationPattern
} from "../../../src/calibration/calibrationPattern";

import type {
  CalibrationObservation
} from "../../../src/calibration/calibrationCollector";

import type {
  CalibrationTarget,
  Point2D
} from "../../../src/shared/types";

function createObservation(
  timestampMs: number,
  rawPoint: Point2D
): CalibrationObservation {
  return {
    prediction: {
      timestampMs,
      rawPoint,
      rawSpace: "NORMALIZED",
      confidence: 0.92,
      faceValid: true,
      eyesValid: true,
      headPose: {
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0
      },
      source: "WEB_EYE_TRACK"
    },
    gazeValid: true,
    gazeQuality: 0.9,
    face: {
      faceValid: true,
      eyesValid: true,
      leftEyeVisible: true,
      rightEyeVisible: true,
      blink: false,
      faceConfidence: 0.95,
      eyeConfidence: 0.95,
      faceDistanceRatio: 1,
      headPose: {
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0
      },
      qualityScore: 0.9,
      qualityLevel: "GOOD"
    }
  };
}

function collectStablePoint(
  manager: CalibrationManager,
  calibrationId: string,
  target: CalibrationTarget,
  targetShownAtMs: number,
  rawPoint: Point2D
) {
  manager.beginPoint(
    calibrationId,
    target,
    targetShownAtMs
  );

  for (
    let index = 0;
    index < 12;
    index += 1
  ) {
    manager.observe(
      createObservation(
        targetShownAtMs
          + 500
          + index * 30,
        {
          x:
            rawPoint.x
            + (index % 2 === 0
              ? 0.001
              : -0.001),
          y:
            rawPoint.y
            + (index % 3 === 0
              ? 0.001
              : -0.001)
        }
      )
    );
  }

  return manager.finishActivePoint(
    targetShownAtMs + 1_300
  );
}

describe(
  "CalibrationManager",
  () => {
    it(
      "starts a standard 17-point calibration run",
      () => {
        const manager =
          new CalibrationManager();

        manager.start(
          "calibration_test",
          "STANDARD_17"
        );

        expect(
          manager.getSnapshot()
        ).toMatchObject({
          calibrationId:
            "calibration_test",
          mode: "STANDARD_17",
          active: true,
          completedPointCount: 0,
          expectedPointCount: 17,
          modelReady: false
        });
      }
    );

    it(
      "accepts a stable point and advances the sequential point index",
      () => {
        const manager =
          new CalibrationManager();

        const target =
          createCalibrationPattern(
            "STANDARD_17",
            {
              width: 1_000,
              height: 800
            }
          )[0];

        expect(target).toBeDefined();

        manager.start(
          "calibration_test",
          "STANDARD_17"
        );

        const result =
          collectStablePoint(
            manager,
            "calibration_test",
            target!,
            1_000,
            {
              x: 0.48,
              y: 0.51
            }
          );

        expect(result.sufficient)
          .toBe(true);

        expect(result.completedPointCount)
          .toBe(1);

        expect(
          manager.getSnapshot()
            .activePointIndex
        ).toBeNull();
      }
    );

    it(
      "allows the same point to be retried after an insufficient attempt",
      () => {
        const manager =
          new CalibrationManager();

        const target =
          createCalibrationPattern(
            "STANDARD_17",
            {
              width: 1_000,
              height: 800
            }
          )[0];

        expect(target).toBeDefined();

        manager.start(
          "calibration_test",
          "STANDARD_17"
        );

        manager.beginPoint(
          "calibration_test",
          target!,
          1_000
        );

        for (
          let index = 0;
          index < 3;
          index += 1
        ) {
          manager.observe(
            createObservation(
              1_500 + index * 50,
              {
                x: 0.5,
                y: 0.5
              }
            )
          );
        }

        const failed =
          manager.finishActivePoint(
            4_100
          );

        expect(failed.sufficient)
          .toBe(false);

        expect(failed.completedPointCount)
          .toBe(0);

        expect(() => {
          manager.beginPoint(
            "calibration_test",
            target!,
            5_000
          );
        }).not.toThrow();
      }
    );

    it(
      "fits the residual model after all 17 standard points are collected",
      () => {
        const manager =
          new CalibrationManager();

        const targets =
          createCalibrationPattern(
            "STANDARD_17",
            {
              width: 1_000,
              height: 800
            }
          );

        manager.start(
          "calibration_test",
          "STANDARD_17"
        );

        let finalResult = null;

        for (const target of targets) {
          const base =
            10_000
            + target.pointIndex
              * 2_000;

          finalResult =
            collectStablePoint(
              manager,
              "calibration_test",
              target,
              base,
              {
                x:
                  target.normalizedPoint.x
                  - 0.025,
                y:
                  target.normalizedPoint.y
                  + 0.018
              }
            );
        }

        expect(finalResult)
          .not.toBeNull();

        expect(finalResult?.modelReady)
          .toBe(true);

        expect(
          finalResult
            ?.trainingRmseNormalized
        ).not.toBeNull();

        expect(
          manager.getSnapshot()
        ).toMatchObject({
          completedPointCount: 17,
          expectedPointCount: 17,
          modelReady: true
        });
      }
    );
  }
);
