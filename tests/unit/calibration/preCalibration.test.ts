import {
  describe,
  expect,
  it
} from "vitest";

import {
  PreCalibrationMonitor
} from "../../../src/calibration/preCalibration";

import type {
  PreCalibrationFrameInput
} from "../../../src/calibration/preCalibration";

import type {
  FaceGeometryFrameResult
} from "../../../src/face/faceGeometry";

import type {
  HeadPoseFrameResult
} from "../../../src/face/headPose";

import type {
  FaceQualityFrameResult
} from "../../../src/face/faceQuality";

function createGeometry(
  timestampMs: number,
  centerX = 0.5,
  centerY = 0.5,
  widthRatio = 0.36,
  heightRatio = 0.48
): FaceGeometryFrameResult {
  const frameWidth = 640;
  const frameHeight = 480;
  const left = centerX - widthRatio / 2;
  const top = centerY - heightRatio / 2;

  return {
    frameSequence:
      Math.round(timestampMs / 10) + 1,
    timestampMs,
    frameWidth,
    frameHeight,
    faceDetected: true,
    geometryValid: true,
    geometry: {
      boundsNormalized: {
        left,
        top,
        right: left + widthRatio,
        bottom: top + heightRatio,
        width: widthRatio,
        height: heightRatio
      },
      boundsPx: {
        left: left * frameWidth,
        top: top * frameHeight,
        width: widthRatio * frameWidth,
        height: heightRatio * frameHeight
      },
      centerNormalized: {
        x: centerX,
        y: centerY
      },
      centerPx: {
        x: centerX * frameWidth,
        y: centerY * frameHeight
      },
      widthRatio,
      heightRatio,
      areaRatio:
        widthRatio * heightRatio,
      aspectRatio:
        widthRatio / heightRatio,
      proximityProxy:
        Math.sqrt(
          widthRatio * heightRatio
        ),
      eyeCenters: {
        leftNormalized: {
          x: centerX - 0.08,
          y: centerY - 0.05
        },
        rightNormalized: {
          x: centerX + 0.08,
          y: centerY - 0.05
        },
        midpointNormalized: {
          x: centerX,
          y: centerY - 0.05
        },
        leftPx: {
          x: (centerX - 0.08) * frameWidth,
          y: (centerY - 0.05) * frameHeight
        },
        rightPx: {
          x: (centerX + 0.08) * frameWidth,
          y: (centerY - 0.05) * frameHeight
        },
        midpointPx: {
          x: centerX * frameWidth,
          y: (centerY - 0.05) * frameHeight
        },
        interocularDistancePx:
          0.16 * frameWidth,
        interocularDistanceRatio:
          0.16
      },
      anchors: {
        noseTipNormalized: {
          x: centerX,
          y: centerY
        },
        foreheadTopNormalized: {
          x: centerX,
          y: top
        },
        chinNormalized: {
          x: centerX,
          y: top + heightRatio
        },
        leftCheekNormalized: {
          x: left,
          y: centerY
        },
        rightCheekNormalized: {
          x: left + widthRatio,
          y: centerY
        }
      }
    }
  };
}

function createHeadPose(
  timestampMs: number
): HeadPoseFrameResult {
  return {
    frameSequence:
      Math.round(timestampMs / 10) + 1,
    timestampMs,
    faceDetected: true,
    poseValid: true,
    headPose: {
      yawDeg: 1,
      pitchDeg: -2,
      rollDeg: 0.5
    },
    source: "TRANSFORMATION_MATRIX",
    diagnostics: {
      matrixScale: 1,
      orthogonalityError: 0,
      scaleSpread: 0
    }
  };
}

function createQuality(
  timestampMs: number,
  options: {
    blink?: boolean | undefined;
    distanceAcceptable?: boolean | undefined;
    horizontallyCentered?: boolean | undefined;
    brightnessAcceptable?: boolean | undefined;
  } = {}
): FaceQualityFrameResult {
  return {
    frameSequence:
      Math.round(timestampMs / 10) + 1,
    timestampMs,
    trackingQuality: {
      faceValid: true,
      eyesValid: true,
      leftEyeVisible: true,
      rightEyeVisible: true,
      blink:
        options.blink ?? false,
      faceConfidence: 0.95,
      eyeConfidence: 0.95,
      faceDistanceRatio: 1,
      headPose: {
        yawDeg: 1,
        pitchDeg: -2,
        rollDeg: 0.5
      },
      qualityScore: 0.95,
      qualityLevel: "GOOD"
    },
    positionStatus: {
      faceDetected: true,
      bothEyesVisible: true,
      horizontallyCentered:
        options.horizontallyCentered
        ?? true,
      verticallyCentered: true,
      distanceAcceptable:
        options.distanceAcceptable
        ?? true,
      headPoseAcceptable: true,
      brightnessAcceptable:
        options.brightnessAcceptable
        ?? true,
      stable: false
    },
    usableForGaze: true,
    issues: []
  };
}

function createInput(
  timestampMs: number,
  options: {
    centerX?: number;
    centerY?: number;
    widthRatio?: number;
    heightRatio?: number;
    blink?: boolean;
    distanceAcceptable?: boolean;
    horizontallyCentered?: boolean;
    brightness?: number;
    brightnessAcceptable?: boolean;
  } = {}
): PreCalibrationFrameInput {
  return {
    geometry:
      createGeometry(
        timestampMs,
        options.centerX ?? 0.5,
        options.centerY ?? 0.5,
        options.widthRatio ?? 0.36,
        options.heightRatio ?? 0.48
      ),
    headPose:
      createHeadPose(timestampMs),
    quality:
      createQuality(
        timestampMs,
        {
          blink:
            options.blink,
          distanceAcceptable:
            options.distanceAcceptable,
          horizontallyCentered:
            options.horizontallyCentered,
          brightnessAcceptable:
            options.brightnessAcceptable
        }
      ),
    cameraQuality: {
      brightness:
        options.brightness ?? 0.55,
      sharpness: 0.5,
      frameRateActual: 30,
      quality: "GOOD"
    }
  };
}

describe("PreCalibrationMonitor", () => {
  it("captures a robust baseline after a valid one-second stable interval", () => {
    const monitor =
      new PreCalibrationMonitor();

    let result =
      monitor.evaluate(
        createInput(0)
      );

    for (
      let timestampMs = 100;
      timestampMs <= 1000;
      timestampMs += 100
    ) {
      result =
        monitor.evaluate(
          createInput(timestampMs)
        );
    }

    expect(
      result.feedback.readyForCalibration
    ).toBe(true);

    expect(
      result.feedback.instruction
    ).toBe("READY");

    expect(result.baseline)
      .not.toBeNull();

    expect(result.baseline?.centerX)
      .toBeCloseTo(0.5);

    expect(result.baseline?.width)
      .toBeCloseTo(0.36);
  });


  it("latches completion after the first baseline and does not recapture after a later blink", () => {
    const monitor =
      new PreCalibrationMonitor();

    let result =
      monitor.evaluate(
        createInput(0)
      );

    for (
      let timestampMs = 100;
      timestampMs <= 1000;
      timestampMs += 100
    ) {
      result =
        monitor.evaluate(
          createInput(timestampMs)
        );
    }

    expect(result.baselineCaptured)
      .toBe(true);

    const capturedBaseline =
      result.baseline;

    const afterBlink =
      monitor.evaluate(
        createInput(
          1100,
          { blink: true }
        )
      );

    expect(
      afterBlink.feedback.readyForCalibration
    ).toBe(true);

    expect(
      afterBlink.feedback.instruction
    ).toBe("READY");

    expect(
      afterBlink.feedback.metrics.stableProgress
    ).toBe(1);

    expect(afterBlink.baselineCaptured)
      .toBe(false);

    expect(afterBlink.baseline)
      .toEqual(capturedBaseline);

    const stableAgain =
      monitor.evaluate(
        createInput(2200)
      );

    expect(
      stableAgain.feedback.readyForCalibration
    ).toBe(true);

    expect(stableAgain.baselineCaptured)
      .toBe(false);

    expect(stableAgain.baseline)
      .toEqual(capturedBaseline);
  });

  it("clears the completion latch only when reset is explicitly requested", () => {
    const monitor =
      new PreCalibrationMonitor();

    for (
      let timestampMs = 0;
      timestampMs <= 1000;
      timestampMs += 100
    ) {
      monitor.evaluate(
        createInput(timestampMs)
      );
    }

    expect(
      monitor.evaluate(
        createInput(1100)
      ).feedback.readyForCalibration
    ).toBe(true);

    monitor.reset();

    const restarted =
      monitor.evaluate(
        createInput(1200)
      );

    expect(
      restarted.feedback.readyForCalibration
    ).toBe(false);

    expect(restarted.baseline)
      .toBeNull();
  });

  it("resets the stability interval when a blink occurs", () => {
    const monitor =
      new PreCalibrationMonitor();

    monitor.evaluate(
      createInput(0)
    );

    const halfway =
      monitor.evaluate(
        createInput(500)
      );

    const blink =
      monitor.evaluate(
        createInput(
          600,
          { blink: true }
        )
      );

    expect(
      halfway.feedback.metrics.stableProgress
    ).toBeCloseTo(0.5);

    expect(
      blink.feedback.metrics.stableProgress
    ).toBe(0);

    expect(
      blink.feedback.readyForCalibration
    ).toBe(false);
  });

  it("asks the participant to move closer when the face is too small", () => {
    const monitor =
      new PreCalibrationMonitor();

    const result =
      monitor.evaluate(
        createInput(
          0,
          {
            widthRatio: 0.15,
            heightRatio: 0.20,
            distanceAcceptable: false
          }
        )
      );

    expect(result.feedback.instruction)
      .toBe("MOVE_CLOSER");
  });

  it("uses mirrored horizontal guidance for the selfie-view overlay", () => {
    const monitor =
      new PreCalibrationMonitor();

    const result =
      monitor.evaluate(
        createInput(
          0,
          {
            centerX: 0.80,
            horizontallyCentered: false
          }
        )
      );

    expect(result.feedback.instruction)
      .toBe("MOVE_RIGHT");
  });

  it("distinguishes overly bright lighting from insufficient lighting", () => {
    const darkMonitor =
      new PreCalibrationMonitor();

    const brightMonitor =
      new PreCalibrationMonitor();

    const dark =
      darkMonitor.evaluate(
        createInput(
          0,
          {
            brightness: 0.10,
            brightnessAcceptable: false
          }
        )
      );

    const bright =
      brightMonitor.evaluate(
        createInput(
          0,
          {
            brightness: 0.98,
            brightnessAcceptable: false
          }
        )
      );

    expect(dark.feedback.instruction)
      .toBe("IMPROVE_LIGHTING");

    expect(bright.feedback.instruction)
      .toBe("REDUCE_LIGHTING");
  });
});
