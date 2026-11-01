import {
  ONNX_RUNTIME_WEB
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * Minimal runtime boundary
 * ======================================================================== */

/**
 * Execution providers the gaze pipeline is allowed to request.
 *
 * The provider is not considered available merely because the browser exposes
 * the API. A real model session must still be created successfully before the
 * provider is recorded as active.
 */
export type OnnxExecutionProvider =
  | "webgpu"
  | "wasm";

interface OnnxWasmEnvironment {
  wasmPaths?:
    string
    | Readonly<Record<string, string>>;

  numThreads?: number;

  proxy?: boolean;
}

interface OnnxEnvironment {
  wasm: OnnxWasmEnvironment;

  logLevel?:
    | "verbose"
    | "info"
    | "warning"
    | "error"
    | "fatal";
}

/**
 * Deliberately minimal view of the vendored ORT module.
 *
 * Stage D3 only owns loading/configuring the local runtime. Model tensors,
 * session input/output names and L2CS preprocessing are intentionally NOT
 * defined here; those belong to the model-specific implementation after the
 * exported ONNX contract has been verified.
 */
export interface OnnxRuntimeModule {
  readonly env: OnnxEnvironment;

  readonly InferenceSession: unknown;

  readonly Tensor: unknown;
}

export interface OnnxRuntimeCapability {
  readonly runtimeVersion: string;

  /**
   * True only when the browser exposes the WebGPU API surface. A later session
   * creation can still fail for a specific GPU/model and must fall back to
   * WASM.
   */
  readonly webGpuApiAvailable: boolean;

  readonly preferredExecutionProviders:
    readonly OnnxExecutionProvider[];
}

let runtimeModulePromise:
  Promise<OnnxRuntimeModule> | null =
    null;

/* ========================================================================== 
 * Guards / helpers
 * ======================================================================== */

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
  );
}

function isOnnxEnvironment(
  value: unknown
): value is OnnxEnvironment {
  if (!isRecord(value)) {
    return false;
  }

  /*
   * ORT exposes configuration fields lazily. On a fresh runtime, properties
   * such as wasmPaths, numThreads, proxy and logLevel may legitimately be
   * undefined until the application assigns them. Requiring their default
   * values here rejects a valid ORT module before we get a chance to
   * configure it. The stable structural requirement is only env.wasm.
   */
  return isRecord(value.wasm);
}

function isOnnxRuntimeModule(
  value: unknown
): value is OnnxRuntimeModule {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isOnnxEnvironment(value.env)
    && "InferenceSession" in value
    && "Tensor" in value
  );
}

function resolveImportedRuntimeModule(
  value: unknown
): OnnxRuntimeModule | null {
  if (isOnnxRuntimeModule(value)) {
    return value;
  }

  /*
   * Direct ESM imports normally expose ORT through named exports, but some
   * bundling/runtime combinations surface the same API under `default`.
   * Accept both shapes without weakening the actual runtime contract.
   */
  if (
    isRecord(value)
    && isOnnxRuntimeModule(value.default)
  ) {
    return value.default;
  }

  return null;
}

function listRecordKeys(
  value: unknown
): readonly string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value).slice(0, 32);
}

function getRuntimeAssetUrl(
  relativePath: string
): string {
  if (
    typeof chrome === "undefined"
    || chrome.runtime?.getURL === undefined
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "ONNX Runtime can only be loaded inside the Chrome extension runtime.",
      {
        details: {
          relativePath
        }
      }
    );
  }

  return chrome.runtime.getURL(
    relativePath
  );
}

async function importLocalRuntimeModule(
  moduleUrl: string
): Promise<unknown> {
  /*
   * The runtime module is copied into the extension package as a static ESM
   * asset. Keep this import URL dynamic so esbuild does not try to rebundle
   * ONNX Runtime or rewrite its internally loaded WASM helper modules.
   */
  return import(moduleUrl) as Promise<unknown>;
}

function configureRuntime(
  runtime: OnnxRuntimeModule
): void {
  runtime.env.logLevel =
    "warning";

  runtime.env.wasm.wasmPaths =
    getRuntimeAssetUrl(
      ONNX_RUNTIME_WEB
        .WASM_BASE_ASSET_PATH
    );

  runtime.env.wasm.numThreads =
    ONNX_RUNTIME_WEB
      .DEFAULT_WASM_THREADS;

  /*
   * ORT's proxy worker is incompatible with WebGPU and can also be blocked by
   * strict CSP because it relies on a Blob worker. The Offscreen document is
   * already the dedicated inference context, so a proxy worker is unnecessary.
   */
  runtime.env.wasm.proxy =
    false;
}

async function loadRuntimeModuleOnce():
Promise<OnnxRuntimeModule> {
  const moduleUrl =
    getRuntimeAssetUrl(
      ONNX_RUNTIME_WEB
        .MODULE_ASSET_PATH
    );

  let importedModule: unknown;

  try {
    importedModule =
      await importLocalRuntimeModule(
        moduleUrl
      );
  } catch (error: unknown) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Failed to load the local ONNX Runtime Web module.",
      {
        cause: error,
        details: {
          moduleAssetPath:
            ONNX_RUNTIME_WEB
              .MODULE_ASSET_PATH,
          runtimeVersion:
            ONNX_RUNTIME_WEB
              .PACKAGE_VERSION
        }
      }
    );
  }

  const runtime =
    resolveImportedRuntimeModule(
      importedModule
    );

  if (runtime === null) {
    const defaultExport =
      isRecord(importedModule)
        ? importedModule.default
        : undefined;

    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "The local ONNX Runtime module does not expose the expected runtime API.",
      {
        details: {
          runtimeVersion:
            ONNX_RUNTIME_WEB
              .PACKAGE_VERSION,
          moduleNamespaceKeys:
            listRecordKeys(importedModule),
          defaultExportKeys:
            listRecordKeys(defaultExport)
        }
      }
    );
  }

  configureRuntime(
    runtime
  );

  logger.info(
    "Local ONNX Runtime Web module loaded.",
    {
      runtimeVersion:
        ONNX_RUNTIME_WEB
          .PACKAGE_VERSION,
      webGpuApiAvailable:
        "gpu" in navigator,
      wasmThreads:
        runtime.env.wasm.numThreads
    }
  );

  return runtime;
}

/* ========================================================================== 
 * Public API
 * ======================================================================== */

/**
 * Loads and configures the pinned extension-local ONNX Runtime module.
 *
 * Repeated calls share one initialization promise. If initialization fails,
 * the cache is cleared so a later explicit retry is possible after the cause
 * has been corrected (for example after reloading a repaired extension build).
 */
export async function loadOnnxRuntimeWeb():
Promise<OnnxRuntimeModule> {
  if (runtimeModulePromise === null) {
    runtimeModulePromise =
      loadRuntimeModuleOnce();
  }

  try {
    return await runtimeModulePromise;
  } catch (error: unknown) {
    runtimeModulePromise =
      null;

    throw error;
  }
}

export function getOnnxRuntimeCapability():
OnnxRuntimeCapability {
  return {
    runtimeVersion:
      ONNX_RUNTIME_WEB
        .PACKAGE_VERSION,
    webGpuApiAvailable:
      "gpu" in navigator,
    preferredExecutionProviders:
      ONNX_RUNTIME_WEB
        .PREFERRED_EXECUTION_PROVIDERS
  };
}
