import {
  L2CS_GAZE_MODEL
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import type {
  GazePrediction
} from "../shared/types";

import type {
  GazeEngine,
  GazeEngineFrameInput,
  GazeEngineLifecycle,
  GazeEngineSnapshot,
  GazeFeatureProvider,
  GazeFeatureSnapshot
} from "./GazeEngine";

import {
  L2csImageNormalizer
} from "./gazeImageNormalizer";

import {
  createL2csInferenceSession
} from "./l2csOnnxSession";

import type {
  L2csInferenceSession,
  L2csOrtTensor
} from "./l2csOnnxSession";

import type {
  OnnxExecutionProvider
} from "./onnxRuntime";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function assertSynchronizedInput(
  input: GazeEngineFrameInput
): void {
  const frameSequence =
    input.frame.metadata.frameSequence;

  const timestampMs =
    input.frame.metadata.timestampMs;

  const results = [
    input.landmarker,
    input.faceGeometry,
    input.headPose,
    input.eyeGeometry,
    input.blink,
    input.faceQuality
  ] as const;

  for (const result of results) {
    if (
      result.frameSequence !== frameSequence
      || result.timestampMs !== timestampMs
    ) {
      throw new TrackerError(
        ERROR_CODES.GAZE_INVALID_SAMPLE,
        "GAZE",
        "Universal deep gaze engine received unsynchronized frame analysis results.",
        {
          details: {
            expectedFrameSequence:
              frameSequence,
            expectedTimestampMs:
              timestampMs,
            receivedFrameSequence:
              result.frameSequence,
            receivedTimestampMs:
              result.timestampMs
          }
        }
      );
    }
  }
}

function isInputUsable(
  input: GazeEngineFrameInput
): boolean {
  const trackingQuality =
    input.faceQuality.trackingQuality;

  return (
    input.faceQuality.usableForGaze
    && trackingQuality.faceValid
    && trackingQuality.eyesValid
    && input.faceGeometry.faceDetected
    && input.faceGeometry.geometryValid
    && input.faceGeometry.geometry !== null
    && input.headPose.faceDetected
    && input.headPose.poseValid
    && input.headPose.headPose !== null
    && input.eyeGeometry.faceDetected
    && input.eyeGeometry.geometryValid
    && input.eyeGeometry.bothEyesValid
    && input.blink.valid
    && input.blink.bothEyesOpen
    && !input.blink.bothEyesClosed
    && !input.blink.blinkInProgress
    && !input.blink.prolongedClosureDetected
  );
}

function getFloat32Output(
  outputs: Readonly<Record<string, L2csOrtTensor>>,
  name: string,
  expectedLength: number
): Float32Array {
  const output =
    outputs[name];

  if (
    output === undefined
    || output.type !== "float32"
    || !(output.data instanceof Float32Array)
    || output.data.length !== expectedLength
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_PREDICTION_FAILED,
      "GAZE",
      "L2CS ONNX output does not match the expected float32 tensor contract.",
      {
        details: {
          outputName:
            name,
          expectedLength,
          actualType:
            output?.type ?? null,
          actualLength:
            output?.data.byteLength ?? null,
          actualDimensions:
            output?.dims ?? null
        }
      }
    );
  }

  return output.data;
}

interface DecodedAngle {
  readonly radians: number;
  readonly entropyConfidence: number;
}

function decodeBinnedAngle(
  logits: Float32Array
): DecodedAngle {
  let maxLogit =
    Number.NEGATIVE_INFINITY;

  for (const logit of logits) {
    if (!Number.isFinite(logit)) {
      throw new TrackerError(
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "L2CS produced a non-finite gaze logit."
      );
    }

    maxLogit =
      Math.max(
        maxLogit,
        logit
      );
  }

  let probabilitySum = 0;
  let weightedBinSum = 0;
  let entropyNumerator = 0;

  const exponentials =
    new Float64Array(logits.length);

  for (
    let index = 0;
    index < logits.length;
    index += 1
  ) {
    const logit =
      logits[index];

    if (logit === undefined) {
      continue;
    }

    const exponent =
      Math.exp(
        logit - maxLogit
      );

    exponentials[index] =
      exponent;

    probabilitySum +=
      exponent;
  }

  if (
    !Number.isFinite(probabilitySum)
    || probabilitySum <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_PREDICTION_FAILED,
      "GAZE",
      "L2CS softmax normalization failed."
    );
  }

  for (
    let index = 0;
    index < exponentials.length;
    index += 1
  ) {
    const probability =
      (exponentials[index] ?? 0)
      / probabilitySum;

    weightedBinSum +=
      probability
      * index;

    if (probability > 0) {
      entropyNumerator -=
        probability
        * Math.log(probability);
    }
  }

  const degrees =
    weightedBinSum
    * L2CS_GAZE_MODEL
      .BIN_SIZE_DEGREES
    + L2CS_GAZE_MODEL
      .MIN_ANGLE_DEGREES;

  const normalizedEntropy =
    entropyNumerator
    / Math.log(
      L2CS_GAZE_MODEL.BIN_COUNT
    );

  const entropyConfidence =
    Math.min(
      1,
      Math.max(
        0,
        1 - normalizedEntropy
      )
    );

  return {
    radians:
      degrees * Math.PI / 180,
    entropyConfidence
  };
}

function cloneFeature(
  feature: Float32Array
): Float32Array {
  return new Float32Array(feature);
}

/* ========================================================================== 
 * Universal deep gaze engine
 * ======================================================================== */

/**
 * Research universal appearance-based gaze engine using the project-owned
 * L2CS ONNX export contract.
 *
 * Important:
 * - Output coordinates are MODEL-space yaw/pitch radians, not screen points.
 * - This engine does not apply calibration or screen mapping.
 * - The 2048-D backbone feature is kept runtime-only for the upcoming
 *   participant-specific mapper and is never persisted here.
 * - The Gaze360-derived checkpoint is research-only and is not bundled by
 *   this repository; users export it locally with scripts/export-l2cs-onnx.py.
 */
export class UniversalDeepEngine implements
  GazeEngine,
  GazeFeatureProvider {
  public readonly source =
    "ONNX" as const;

  private lifecycle:
    GazeEngineLifecycle =
      "CREATED";

  private session:
    L2csInferenceSession | null =
      null;

  private normalizer:
    L2csImageNormalizer | null =
      null;

  private lastPredictionTimestampMs:
    number | null =
      null;

  private latestFeature:
    GazeFeatureSnapshot | null =
      null;

  public async initialize(): Promise<void> {
    if (this.lifecycle === "READY") {
      return;
    }

    if (this.lifecycle === "INITIALIZING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Universal deep gaze engine is already initializing."
      );
    }

    if (this.lifecycle === "DISPOSED") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed universal deep gaze engine cannot be initialized."
      );
    }

    this.lifecycle =
      "INITIALIZING";

    try {
      this.normalizer =
        new L2csImageNormalizer();

      this.session =
        await createL2csInferenceSession();

      this.latestFeature =
        null;

      this.lastPredictionTimestampMs =
        null;

      this.lifecycle =
        "READY";
    } catch (error: unknown) {
      this.session =
        null;

      this.normalizer =
        null;

      this.latestFeature =
        null;

      this.lifecycle =
        "ERROR";

      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Failed to initialize the universal L2CS deep gaze engine."
      );
    }
  }

  public async predict(
    input: GazeEngineFrameInput
  ): Promise<GazePrediction | null> {
    if (
      this.lifecycle !== "READY"
      || this.session === null
      || this.normalizer === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Universal deep gaze prediction requires a ready engine."
      );
    }

    assertSynchronizedInput(input);

    if (!isInputUsable(input)) {
      this.latestFeature =
        null;

      return null;
    }

    const geometry =
      input.faceGeometry.geometry;

    const headPose =
      input.headPose.headPose;

    if (
      geometry === null
      || headPose === null
    ) {
      this.latestFeature =
        null;

      return null;
    }

    try {
      const normalizedInput =
        this.normalizer.normalize(
          input.frame,
          geometry.boundsPx
        );

      const tensor =
        this.session.createInputTensor(
          normalizedInput.data
        );

      const outputs =
        await this.session.run(tensor);

      const yawLogits =
        getFloat32Output(
          outputs,
          L2CS_GAZE_MODEL
            .YAW_OUTPUT_NAME,
          L2CS_GAZE_MODEL.BIN_COUNT
        );

      const pitchLogits =
        getFloat32Output(
          outputs,
          L2CS_GAZE_MODEL
            .PITCH_OUTPUT_NAME,
          L2CS_GAZE_MODEL.BIN_COUNT
        );

      const feature =
        getFloat32Output(
          outputs,
          L2CS_GAZE_MODEL
            .FEATURE_OUTPUT_NAME,
          L2CS_GAZE_MODEL
            .BACKBONE_FEATURE_DIMENSION
        );

      const yaw =
        decodeBinnedAngle(yawLogits);

      const pitch =
        decodeBinnedAngle(pitchLogits);

      const confidence =
        (
          yaw.entropyConfidence
          + pitch.entropyConfidence
        ) / 2;

      this.latestFeature = {
        frameSequence:
          input.frame.metadata
            .frameSequence,
        timestampMs:
          input.frame.metadata
            .timestampMs,
        values:
          cloneFeature(feature)
      };

      this.lastPredictionTimestampMs =
        input.frame.metadata
          .timestampMs;

      return {
        timestampMs:
          input.frame.metadata
            .timestampMs,
        rawPoint: {
          x:
            yaw.radians,
          y:
            pitch.radians
        },
        rawSpace:
          "MODEL",
        confidence,
        faceValid: true,
        eyesValid: true,
        headPose,
        source:
          this.source
      };
    } catch (error: unknown) {
      this.latestFeature =
        null;

      throw normalizeTrackerError(
        error,
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "L2CS ONNX gaze inference failed."
      );
    }
  }

  public getLatestFeatureSnapshot():
  GazeFeatureSnapshot | null {
    if (this.latestFeature === null) {
      return null;
    }

    return {
      frameSequence:
        this.latestFeature
          .frameSequence,
      timestampMs:
        this.latestFeature
          .timestampMs,
      values:
        cloneFeature(
          this.latestFeature.values
        )
    };
  }

  public getExecutionProvider():
  OnnxExecutionProvider | null {
    return this.session
      ?.executionProvider
      ?? null;
  }

  public getSnapshot(): GazeEngineSnapshot {
    return {
      source:
        this.source,
      lifecycle:
        this.lifecycle,
      initialized:
        this.lifecycle === "READY",
      lastPredictionTimestampMs:
        this.lastPredictionTimestampMs
    };
  }

  public async dispose(): Promise<void> {
    if (this.lifecycle === "DISPOSED") {
      return;
    }

    this.lifecycle =
      "DISPOSED";

    const session =
      this.session;

    this.session =
      null;

    this.normalizer =
      null;

    this.latestFeature =
      null;

    this.lastPredictionTimestampMs =
      null;

    if (session !== null) {
      try {
        await session.release();
      } catch (error: unknown) {
        logger.warn(
          "L2CS ONNX session release failed.",
          {
            error
          }
        );
      }
    }
  }
}
