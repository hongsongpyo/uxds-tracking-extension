import {
  describe,
  expect,
  it
} from "vitest";

import {
  GazePredictor
} from "../../../src/gaze/gazePredictor";

import type {
  GazeEngine,
  GazeEngineFrameInput,
  GazeEngineLifecycle,
  GazeEngineSnapshot
} from "../../../src/gaze/GazeEngine";

import type {
  GazeEngineSource,
  GazePrediction
} from "../../../src/shared/types";

class FakeGazeEngine implements GazeEngine {
  private lifecycle:
    GazeEngineLifecycle = "CREATED";

  private lastPredictionTimestampMs:
    number | null = null;

  public initializeCount = 0;
  public predictCount = 0;
  public disposeCount = 0;

  public constructor(
    public readonly source: GazeEngineSource,
    private readonly predictionFactory:
      (input: GazeEngineFrameInput) => GazePrediction | null,
    private readonly initializeError: Error | null = null,
    private readonly predictError: Error | null = null
  ) {}

  public initialize(): Promise<void> {
    this.initializeCount += 1;

    if (this.initializeError !== null) {
      this.lifecycle = "ERROR";
      return Promise.reject(this.initializeError);
    }

    this.lifecycle = "READY";
    return Promise.resolve();
  }

  public predict(
    input: GazeEngineFrameInput
  ): Promise<GazePrediction | null> {
    this.predictCount += 1;

    if (this.predictError !== null) {
      return Promise.reject(this.predictError);
    }

    const prediction =
      this.predictionFactory(input);

    this.lastPredictionTimestampMs =
      prediction?.timestampMs ?? null;

    return Promise.resolve(prediction);
  }

  public getSnapshot(): GazeEngineSnapshot {
    return {
      source: this.source,
      lifecycle: this.lifecycle,
      initialized: this.lifecycle === "READY",
      lastPredictionTimestampMs:
        this.lastPredictionTimestampMs
    };
  }

  public dispose(): Promise<void> {
    this.disposeCount += 1;
    this.lifecycle = "DISPOSED";
    return Promise.resolve();
  }
}

function createInput(
  frameSequence: number,
  timestampMs: number
): GazeEngineFrameInput {
  const frame = {
    source: {} as HTMLVideoElement,
    metadata: {
      frameSequence,
      timestampMs,
      width: 1280,
      height: 720
    }
  };

  return {
    frame,
    landmarker: {} as GazeEngineFrameInput["landmarker"],
    faceGeometry: {} as GazeEngineFrameInput["faceGeometry"],
    headPose: {} as GazeEngineFrameInput["headPose"],
    eyeGeometry: {} as GazeEngineFrameInput["eyeGeometry"],
    blink: {} as GazeEngineFrameInput["blink"],
    faceQuality: {} as GazeEngineFrameInput["faceQuality"]
  };
}

function createPrediction(
  input: GazeEngineFrameInput,
  source: GazeEngineSource
): GazePrediction {
  return {
    timestampMs:
      input.frame.metadata.timestampMs,
    rawPoint: {
      x: 0.4,
      y: 0.6
    },
    rawSpace: "NORMALIZED",
    confidence: 0.9,
    faceValid: true,
    eyesValid: true,
    headPose: {
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0
    },
    source
  };
}

describe("GazePredictor", () => {
  it("uses the primary engine without invoking the fallback when primary succeeds", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      (input) => createPrediction(
        input,
        "WEB_EYE_TRACK"
      )
    );

    const fallback = new FakeGazeEngine(
      "RIDGE",
      (input) => createPrediction(
        input,
        "RIDGE"
      )
    );

    const predictor = new GazePredictor(
      primary,
      fallback,
      {
        targetSampleRateHz: 30
      },
      null
    );

    await predictor.initialize();

    const prediction = await predictor.predict(
      createInput(1, 100)
    );

    expect(prediction?.source)
      .toBe("WEB_EYE_TRACK");
    expect(primary.predictCount).toBe(1);
    expect(fallback.predictCount).toBe(0);
  });

  it("uses Ridge fallback when the primary returns null", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      () => null
    );

    const fallback = new FakeGazeEngine(
      "RIDGE",
      (input) => createPrediction(
        input,
        "RIDGE"
      )
    );

    const predictor = new GazePredictor(
      primary,
      fallback,
      {},
      null
    );

    await predictor.initialize();

    const prediction = await predictor.predict(
      createInput(1, 100)
    );

    expect(prediction?.source).toBe("RIDGE");
    expect(fallback.predictCount).toBe(1);
    expect(
      predictor.getSnapshot()
        .fallbackPredictionUseCount
    ).toBe(1);
  });

  it("uses Ridge fallback when primary prediction throws", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      () => null,
      null,
      new Error("primary failure")
    );

    const fallback = new FakeGazeEngine(
      "RIDGE",
      (input) => createPrediction(
        input,
        "RIDGE"
      )
    );

    const predictor = new GazePredictor(
      primary,
      fallback,
      {},
      null
    );

    await predictor.initialize();

    const prediction = await predictor.predict(
      createInput(1, 100)
    );

    expect(prediction?.source).toBe("RIDGE");
    expect(
      predictor.getSnapshot()
        .primaryPredictionFailureCount
    ).toBe(1);
  });

  it("surfaces an error when both engines throw", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      () => null,
      null,
      new Error("primary failure")
    );

    const fallback = new FakeGazeEngine(
      "RIDGE",
      () => null,
      null,
      new Error("fallback failure")
    );

    const predictor = new GazePredictor(
      primary,
      fallback,
      {},
      null
    );

    await predictor.initialize();

    await expect(
      predictor.predict(
        createInput(1, 100)
      )
    ).rejects.toThrow(
      "Both primary and fallback gaze predictions failed."
    );
  });

  it("does not predict the same camera frame twice", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      (input) => createPrediction(
        input,
        "WEB_EYE_TRACK"
      )
    );

    const predictor = new GazePredictor(
      primary,
      null,
      {},
      null
    );

    await predictor.initialize();

    const input = createInput(1, 100);

    await predictor.predict(input);
    const duplicate = await predictor.predict(input);

    expect(duplicate).toBeNull();
    expect(primary.predictCount).toBe(1);
    expect(
      predictor.getSnapshot()
        .duplicateFrameCount
    ).toBe(1);
  });

  it("runs an observer engine without replacing the primary returned gaze", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      (input) => createPrediction(
        input,
        "WEB_EYE_TRACK"
      )
    );

    const observer = new FakeGazeEngine(
      "ONNX",
      (input) => ({
        ...createPrediction(
          input,
          "ONNX"
        ),
        rawPoint: {
          x: 0.12,
          y: -0.08
        },
        rawSpace: "MODEL"
      })
    );

    const predictor = new GazePredictor(
      primary,
      null,
      {
        targetSampleRateHz: 30,
        observerSampleRateHz: 5
      },
      observer
    );

    await predictor.initialize();

    const prediction = await predictor.predict(
      createInput(1, 1000)
    );

    await Promise.resolve();

    expect(prediction?.source)
      .toBe("WEB_EYE_TRACK");

    const snapshot =
      predictor.getSnapshot();

    expect(snapshot.observer.available)
      .toBe(true);
    expect(snapshot.observer.successCount)
      .toBe(1);
    expect(snapshot.observer.lastPrediction)
      .toMatchObject({
        source: "ONNX",
        rawSpace: "MODEL",
        rawPoint: {
          x: 0.12,
          y: -0.08
        }
      });
  });
  it("can suspend the non-authoritative observer without affecting primary gaze", async () => {
    const primary = new FakeGazeEngine(
      "WEB_EYE_TRACK",
      (input) => createPrediction(input, "WEB_EYE_TRACK")
    );

    const observer = new FakeGazeEngine(
      "ONNX",
      (input) => ({
        ...createPrediction(input, "ONNX"),
        rawPoint: { x: 0.1, y: -0.1 },
        rawSpace: "MODEL"
      })
    );

    const predictor = new GazePredictor(
      primary,
      null,
      { targetSampleRateHz: 30, observerSampleRateHz: 30 },
      observer
    );

    await predictor.initialize();
    predictor.setObserverSuspended(true, "TEST_SLOW_OBSERVER");

    const prediction = await predictor.predict(createInput(1, 1000));
    await Promise.resolve();

    expect(prediction?.source).toBe("WEB_EYE_TRACK");
    expect(primary.predictCount).toBe(1);
    expect(observer.predictCount).toBe(0);
    expect(predictor.getSnapshot().observer).toMatchObject({
      suspended: true,
      suspensionReason: "TEST_SLOW_OBSERVER"
    });

    predictor.setObserverSuspended(false);
    await predictor.predict(createInput(2, 1100));
    await Promise.resolve();

    expect(observer.predictCount).toBe(1);
  });

});

class DeferredObserverEngine extends FakeGazeEngine {
  private releasePrediction: (() => void) | null = null;

  public override async predict(input: GazeEngineFrameInput): Promise<GazePrediction | null> {
    const prediction = await super.predict(input);
    await new Promise<void>((resolve) => { this.releasePrediction = resolve; });
    return prediction;
  }

  public release(): void {
    this.releasePrediction?.();
    this.releasePrediction = null;
  }
}

describe("observer lifecycle boundaries", () => {
  it.each(["invalidate", "suspend", "dispose"])("discards an outstanding observer result on %s", async (boundary) => {
    const primary = new FakeGazeEngine("WEB_EYE_TRACK", (input) => createPrediction(input, "WEB_EYE_TRACK"));
    const observer = new DeferredObserverEngine("ONNX", (input) => createPrediction(input, "ONNX"));
    const predictor = new GazePredictor(primary, null, { observerSampleRateHz: 30 }, observer);
    await predictor.initialize();
    await predictor.predict(createInput(1, 1000));
    expect(predictor.getSnapshot().observer.inFlight).toBe(true);
    if (boundary === "invalidate") predictor.invalidateObserverSamples();
    else if (boundary === "suspend") predictor.setObserverSuspended(true);
    else await predictor.dispose();

    if (boundary !== "dispose") {
      // Invalidating a result must not unlock an unfinished inference.
      await predictor.predict(createInput(2, 1100));
      expect(observer.predictCount).toBe(1);
    }
    observer.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(predictor.getSnapshot().observer.lastPrediction).toBeNull();
    expect(predictor.getSnapshot().observer.successCount).toBe(0);
    expect(predictor.getSnapshot().observer.inFlight).toBe(false);

    if (boundary !== "dispose") {
      predictor.setObserverSuspended(false);
      await predictor.predict(createInput(3, 1200));
      observer.release();
      await Promise.resolve();
      await Promise.resolve();
      expect(predictor.getSnapshot().observer.lastPrediction?.timestampMs).toBe(1200);
    }
  });
});
