import { describe, expect, it } from "vitest";
import type { GazeObserverRuntimeSample } from "../../../src/gaze/gazePredictor";
import { meanSynchronizedSourceBaseline } from "../../../src/gaze/runtimeDeepSourceAlignment";

function frame(frameSequence: number, timestampMs: number): GazeObserverRuntimeSample {
  return {
    prediction: {
      frameSequence, timestampMs, source: "ONNX", rawPoint: { x: 0, y: 0 },
      rawSpace: "MODEL", confidence: 0.9, inferenceLatencyMs: 20
    },
    feature: { frameSequence, timestampMs, values: new Float32Array([0, 1]) },
    geometry: {
      headPose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
      faceCenterNormalized: { x: 0.5, y: 0.5 },
      faceWidthRatio: 0.3, faceHeightRatio: 0.5, faceDistanceRatio: 1,
      leftIrisHorizontalOffsetRatio: 0, leftIrisVerticalOffsetRatio: 0,
      rightIrisHorizontalOffsetRatio: 0, rightIrisVerticalOffsetRatio: 0
    },
    quality: {
      usableForGaze: true, faceValid: true, eyesValid: true, blink: false,
      qualityScore: 0.9, qualityLevel: "GOOD"
    }
  };
}

describe("aggregated deep / baseline temporal correspondence", () => {
  it("averages baselines over precisely the same source frames as the deep mapper", () => {
    const history = new Map([
      [1, { timestampMs: 100, normalizedPoint: { x: 0.2, y: 0.4 } }],
      [2, { timestampMs: 130, normalizedPoint: { x: 0.6, y: 0.8 } }]
    ]);
    const result = meanSynchronizedSourceBaseline([frame(1, 100), frame(2, 130)], history);
    expect(result?.x).toBeCloseTo(0.4);
    expect(result?.y).toBeCloseTo(0.6);
  });

  it("rejects stale, missing, duplicate or out-of-order frames instead of inventing an aligned residual", () => {
    const history = new Map([
      [1, { timestampMs: 100, normalizedPoint: { x: 0.2, y: 0.4 } }],
      [2, { timestampMs: 130, normalizedPoint: { x: 0.6, y: 0.8 } }]
    ]);
    expect(meanSynchronizedSourceBaseline([], history)).toBeNull();
    expect(meanSynchronizedSourceBaseline([frame(1, 100), frame(2, 140)], history)).toBeNull();
    expect(meanSynchronizedSourceBaseline([frame(1, 100), frame(3, 130)], history)).toBeNull();
    expect(meanSynchronizedSourceBaseline([frame(1, 100), frame(1, 100)], history)).toBeNull();
    expect(meanSynchronizedSourceBaseline([frame(2, 130), frame(1, 100)], history)).toBeNull();
  });
});
