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

import {
  getOnnxRuntimeCapability,
  loadOnnxRuntimeWeb
} from "./onnxRuntime";

import type {
  OnnxExecutionProvider,
  OnnxRuntimeModule
} from "./onnxRuntime";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * ORT structural types
 * ======================================================================== */

export interface L2csOrtTensor {
  readonly data: ArrayBufferView;
  readonly dims: readonly number[];
  readonly type: string;
}

interface L2csOrtTensorConstructor {
  new (
    type: "float32",
    data: Float32Array,
    dims: readonly number[]
  ): L2csOrtTensor;
}

interface L2csOrtSessionOptions {
  readonly executionProviders:
    readonly OnnxExecutionProvider[];

  readonly graphOptimizationLevel:
    "all";
}

interface L2csOrtInferenceSession {
  readonly inputNames:
    readonly string[];

  readonly outputNames:
    readonly string[];

  run(
    feeds:
      Readonly<Record<string, L2csOrtTensor>>
  ):
    Promise<Readonly<Record<string, L2csOrtTensor>>>;

  release?():
    void | Promise<void>;
}

interface L2csOrtInferenceSessionFactory {
  create(
    model:
      Uint8Array,
    options:
      L2csOrtSessionOptions
  ):
    Promise<L2csOrtInferenceSession>;
}

interface ResolvedOrtRuntime {
  readonly Tensor:
    L2csOrtTensorConstructor;

  readonly InferenceSession:
    L2csOrtInferenceSessionFactory;
}

/* ========================================================================== 
 * Public session contract
 * ======================================================================== */

export interface L2csInferenceSession {
  readonly executionProvider:
    OnnxExecutionProvider;

  createInputTensor(
    data: Float32Array
  ): L2csOrtTensor;

  run(
    input: L2csOrtTensor
  ):
    Promise<Readonly<Record<string, L2csOrtTensor>>>;

  release(): Promise<void>;
}

/* ========================================================================== 
 * Guards / helpers
 * ======================================================================== */

function canHaveProperties(
  value: unknown
): value is object {
  return (
    (
      typeof value === "object"
      && value !== null
    )
    || typeof value === "function"
  );
}

function hasCallableCreate(
  value: unknown
): boolean {
  if (!canHaveProperties(value)) {
    return false;
  }

  return (
    "create" in value
    && typeof Reflect.get(
      value,
      "create"
    ) === "function"
  );
}

function resolveOrtRuntime(
  runtime: OnnxRuntimeModule
): ResolvedOrtRuntime {
  const tensor =
    runtime.Tensor;

  const inferenceSession =
    runtime.InferenceSession;

  /*
   * ONNX Runtime Web exposes `InferenceSession` as a class/function with a
   * static `create()` method. JavaScript functions are objects in the general
   * language sense, but `typeof value === "object"` is false for functions.
   * Requiring an object-only namespace here therefore rejects a valid ORT
   * runtime even though `InferenceSession.create` exists. Accept both object
   * namespaces and callable/class values, while still requiring the exact
   * `create()` API used by this adapter.
   */
  if (
    typeof tensor !== "function"
    || !hasCallableCreate(
      inferenceSession
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "ONNX Runtime does not expose the session/tensor API required by L2CS.",
      {
        details: {
          tensorType:
            typeof tensor,
          inferenceSessionType:
            typeof inferenceSession,
          inferenceSessionHasCreate:
            hasCallableCreate(
              inferenceSession
            )
        }
      }
    );
  }

  return {
    Tensor:
      tensor as L2csOrtTensorConstructor,
    InferenceSession:
      inferenceSession as L2csOrtInferenceSessionFactory
  };
}

function getExtensionAssetUrl(
  path: string
): string {
  if (
    typeof chrome === "undefined"
    || chrome.runtime?.getURL === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "L2CS model loading requires the Chrome extension runtime.",
      {
        details: {
          path
        }
      }
    );
  }

  return chrome.runtime.getURL(path);
}

async function loadModelBytes():
Promise<Uint8Array> {
  const modelUrl =
    getExtensionAssetUrl(
      L2CS_GAZE_MODEL
        .MODEL_ASSET_PATH
    );

  let response: Response;

  try {
    response =
      await fetch(modelUrl);
  } catch (error: unknown) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Failed to read the extension-local L2CS ONNX model.",
      {
        cause: error,
        details: {
          modelAssetPath:
            L2CS_GAZE_MODEL
              .MODEL_ASSET_PATH
        }
      }
    );
  }

  if (!response.ok) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "The extension-local L2CS ONNX model is not provisioned.",
      {
        details: {
          modelAssetPath:
            L2CS_GAZE_MODEL
              .MODEL_ASSET_PATH,
          status:
            response.status
        }
      }
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}

function includesName(
  names: readonly string[],
  expected: string
): boolean {
  return names.includes(expected);
}

function assertSessionContract(
  session: L2csOrtInferenceSession
): void {
  if (
    !includesName(
      session.inputNames,
      L2CS_GAZE_MODEL.INPUT_NAME
    )
    || !includesName(
      session.outputNames,
      L2CS_GAZE_MODEL.YAW_OUTPUT_NAME
    )
    || !includesName(
      session.outputNames,
      L2CS_GAZE_MODEL.PITCH_OUTPUT_NAME
    )
    || !includesName(
      session.outputNames,
      L2CS_GAZE_MODEL.FEATURE_OUTPUT_NAME
    )
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "The provisioned L2CS ONNX model does not match the project-owned tensor contract.",
      {
        details: {
          expectedInput:
            L2CS_GAZE_MODEL.INPUT_NAME,
          expectedOutputs: [
            L2CS_GAZE_MODEL
              .YAW_OUTPUT_NAME,
            L2CS_GAZE_MODEL
              .PITCH_OUTPUT_NAME,
            L2CS_GAZE_MODEL
              .FEATURE_OUTPUT_NAME
          ],
          actualInputs:
            session.inputNames,
          actualOutputs:
            session.outputNames
        }
      }
    );
  }
}

async function tryCreateSession(
  factory: L2csOrtInferenceSessionFactory,
  modelBytes: Uint8Array,
  provider: OnnxExecutionProvider
): Promise<L2csOrtInferenceSession> {
  const session =
    await factory.create(
      modelBytes,
      {
        executionProviders: [
          provider
        ],
        graphOptimizationLevel:
          "all"
      }
    );

  assertSessionContract(session);

  return session;
}

/* ========================================================================== 
 * Session implementation
 * ======================================================================== */

class BrowserL2csInferenceSession implements L2csInferenceSession {
  public constructor(
    private readonly session:
      L2csOrtInferenceSession,
    private readonly Tensor:
      L2csOrtTensorConstructor,
    public readonly executionProvider:
      OnnxExecutionProvider
  ) {}

  public createInputTensor(
    data: Float32Array
  ): L2csOrtTensor {
    return new this.Tensor(
      "float32",
      data,
      [
        1,
        L2CS_GAZE_MODEL
          .CHANNEL_COUNT,
        L2CS_GAZE_MODEL
          .INPUT_HEIGHT,
        L2CS_GAZE_MODEL
          .INPUT_WIDTH
      ]
    );
  }

  public async run(
    input: L2csOrtTensor
  ):
  Promise<Readonly<Record<string, L2csOrtTensor>>> {
    return this.session.run({
      [L2CS_GAZE_MODEL.INPUT_NAME]:
        input
    });
  }

  public async release(): Promise<void> {
    if (this.session.release === undefined) {
      return;
    }

    await this.session.release();
  }
}

/* ========================================================================== 
 * Factory
 * ======================================================================== */

/**
 * Creates one local L2CS model session. WebGPU is attempted first only when
 * Chromium exposes navigator.gpu; a failed GPU/model combination then falls
 * back to the WASM execution provider without changing the model contract.
 */
export async function createL2csInferenceSession():
Promise<L2csInferenceSession> {
  const runtime =
    resolveOrtRuntime(
      await loadOnnxRuntimeWeb()
    );

  const capability =
    getOnnxRuntimeCapability();

  const modelBytes =
    await loadModelBytes();

  const providers:
    OnnxExecutionProvider[] =
      capability.webGpuApiAvailable
        ? ["webgpu", "wasm"]
        : ["wasm"];

  let lastError:
    TrackerError | null =
      null;

  for (const provider of providers) {
    try {
      const session =
        await tryCreateSession(
          runtime.InferenceSession,
          modelBytes,
          provider
        );

      logger.info(
        "L2CS ONNX inference session ready.",
        {
          executionProvider:
            provider,
          modelAssetPath:
            L2CS_GAZE_MODEL
              .MODEL_ASSET_PATH,
          modelBytes:
            modelBytes.byteLength
        }
      );

      return new BrowserL2csInferenceSession(
        session,
        runtime.Tensor,
        provider
      );
    } catch (error: unknown) {
      lastError =
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          `L2CS session initialization failed for ${provider}.`
        );

      logger.warn(
        "L2CS execution provider unavailable for the current browser/model combination.",
        {
          executionProvider:
            provider,
          error: {
            code:
              lastError.code,
            message:
              lastError.message
          }
        }
      );
    }
  }

  throw lastError
    ?? new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "No ONNX Runtime execution provider could initialize the L2CS model."
    );
}
