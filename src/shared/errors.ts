import type {
  DiagnosticComponent
} from "./types";

/* ==========================================================================
 * Error codes
 * ======================================================================== */

/**
 * Single source of truth for tracker error codes.
 *
 * Do not create arbitrary error-code strings in feature modules.
 */
export const ERROR_CODES = {
  UNKNOWN: "UNKNOWN",

  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  INCOMPATIBLE_MESSAGE_PROTOCOL: "INCOMPATIBLE_MESSAGE_PROTOCOL",
  EXTENSION_CONTEXT_INVALIDATED: "EXTENSION_CONTEXT_INVALIDATED",

  OFFSCREEN_CREATE_FAILED: "OFFSCREEN_CREATE_FAILED",
  OFFSCREEN_NOT_AVAILABLE: "OFFSCREEN_NOT_AVAILABLE",

  CAMERA_PERMISSION_DENIED: "CAMERA_PERMISSION_DENIED",
  CAMERA_NOT_FOUND: "CAMERA_NOT_FOUND",
  CAMERA_NOT_READABLE: "CAMERA_NOT_READABLE",
  CAMERA_CONSTRAINT_UNSATISFIED: "CAMERA_CONSTRAINT_UNSATISFIED",
  CAMERA_DISCONNECTED: "CAMERA_DISCONNECTED",
  CAMERA_START_FAILED: "CAMERA_START_FAILED",
  CAMERA_FRAME_UNAVAILABLE: "CAMERA_FRAME_UNAVAILABLE",
  CAMERA_QUALITY_FAILED: "CAMERA_QUALITY_FAILED",

  MEDIAPIPE_INIT_FAILED: "MEDIAPIPE_INIT_FAILED",
  FACE_MODEL_LOAD_FAILED: "FACE_MODEL_LOAD_FAILED",
  WASM_LOAD_FAILED: "WASM_LOAD_FAILED",
  FACE_DETECTION_FAILED: "FACE_DETECTION_FAILED",

  GAZE_ENGINE_INIT_FAILED: "GAZE_ENGINE_INIT_FAILED",
  GAZE_PREDICTION_FAILED: "GAZE_PREDICTION_FAILED",
  GAZE_INVALID_SAMPLE: "GAZE_INVALID_SAMPLE",

  CALIBRATION_INSUFFICIENT_SAMPLES:
    "CALIBRATION_INSUFFICIENT_SAMPLES",

  CALIBRATION_MODEL_FAILED:
    "CALIBRATION_MODEL_FAILED",

  CALIBRATION_VALIDATION_FAILED:
    "CALIBRATION_VALIDATION_FAILED",

  DRIFT_EXCESSIVE: "DRIFT_EXCESSIVE",

  CONTENT_SCRIPT_UNAVAILABLE: "CONTENT_SCRIPT_UNAVAILABLE",
  PAGE_CONTEXT_INVALID: "PAGE_CONTEXT_INVALID",
  TAB_CLOSED: "TAB_CLOSED",
  TAB_ASSOCIATION_FAILED: "TAB_ASSOCIATION_FAILED",
  FRAME_UNAVAILABLE: "FRAME_UNAVAILABLE",

  AOI_RESOLUTION_FAILED: "AOI_RESOLUTION_FAILED",

  DATABASE_OPEN_FAILED: "DATABASE_OPEN_FAILED",
  DATABASE_READ_FAILED: "DATABASE_READ_FAILED",
  DATABASE_WRITE_FAILED: "DATABASE_WRITE_FAILED",
  DATABASE_MIGRATION_FAILED: "DATABASE_MIGRATION_FAILED",
  STORAGE_FLUSH_FAILED: "STORAGE_FLUSH_FAILED",

  NETWORK_OFFLINE: "NETWORK_OFFLINE",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_REQUEST_FAILED: "NETWORK_REQUEST_FAILED",
  UPLOAD_RETRY_EXHAUSTED: "UPLOAD_RETRY_EXHAUSTED",

  EXPORT_FAILED: "EXPORT_FAILED"
} as const;

export type TrackerErrorCode =
  (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/* ==========================================================================
 * Default recoverability
 * ======================================================================== */

/**
 * Defines whether an error can normally be recovered from without
 * terminating the entire tracking session.
 *
 * Individual error instances may override this value when necessary.
 */
export const DEFAULT_ERROR_RECOVERABILITY: Readonly<
  Record<TrackerErrorCode, boolean>
> = {
  [ERROR_CODES.UNKNOWN]: false,

  [ERROR_CODES.INVALID_STATE_TRANSITION]: true,
  [ERROR_CODES.INVALID_MESSAGE]: true,
  [ERROR_CODES.INCOMPATIBLE_MESSAGE_PROTOCOL]: false,
  [ERROR_CODES.EXTENSION_CONTEXT_INVALIDATED]: false,

  [ERROR_CODES.OFFSCREEN_CREATE_FAILED]: false,
  [ERROR_CODES.OFFSCREEN_NOT_AVAILABLE]: false,

  [ERROR_CODES.CAMERA_PERMISSION_DENIED]: false,
  [ERROR_CODES.CAMERA_NOT_FOUND]: false,
  [ERROR_CODES.CAMERA_NOT_READABLE]: true,
  [ERROR_CODES.CAMERA_CONSTRAINT_UNSATISFIED]: true,
  [ERROR_CODES.CAMERA_DISCONNECTED]: true,
  [ERROR_CODES.CAMERA_START_FAILED]: true,
  [ERROR_CODES.CAMERA_FRAME_UNAVAILABLE]: true,
  [ERROR_CODES.CAMERA_QUALITY_FAILED]: true,

  [ERROR_CODES.MEDIAPIPE_INIT_FAILED]: false,
  [ERROR_CODES.FACE_MODEL_LOAD_FAILED]: false,
  [ERROR_CODES.WASM_LOAD_FAILED]: false,
  [ERROR_CODES.FACE_DETECTION_FAILED]: true,

  [ERROR_CODES.GAZE_ENGINE_INIT_FAILED]: false,
  [ERROR_CODES.GAZE_PREDICTION_FAILED]: true,
  [ERROR_CODES.GAZE_INVALID_SAMPLE]: true,

  [ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES]: true,
  [ERROR_CODES.CALIBRATION_MODEL_FAILED]: true,
  [ERROR_CODES.CALIBRATION_VALIDATION_FAILED]: true,

  [ERROR_CODES.DRIFT_EXCESSIVE]: true,

  [ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE]: true,
  [ERROR_CODES.PAGE_CONTEXT_INVALID]: true,
  [ERROR_CODES.TAB_CLOSED]: true,
  [ERROR_CODES.TAB_ASSOCIATION_FAILED]: true,
  [ERROR_CODES.FRAME_UNAVAILABLE]: true,

  [ERROR_CODES.AOI_RESOLUTION_FAILED]: true,

  [ERROR_CODES.DATABASE_OPEN_FAILED]: false,
  [ERROR_CODES.DATABASE_READ_FAILED]: true,
  [ERROR_CODES.DATABASE_WRITE_FAILED]: true,
  [ERROR_CODES.DATABASE_MIGRATION_FAILED]: false,
  [ERROR_CODES.STORAGE_FLUSH_FAILED]: true,

  [ERROR_CODES.NETWORK_OFFLINE]: true,
  [ERROR_CODES.NETWORK_TIMEOUT]: true,
  [ERROR_CODES.NETWORK_REQUEST_FAILED]: true,
  [ERROR_CODES.UPLOAD_RETRY_EXHAUSTED]: true,

  [ERROR_CODES.EXPORT_FAILED]: true
};

/* ==========================================================================
 * Error details
 * ======================================================================== */

export type TrackerErrorDetails =
  Readonly<Record<string, unknown>> | null;

export interface TrackerErrorOptions {
  recoverable?: boolean;

  details?: TrackerErrorDetails;

  cause?: unknown;
}

/* ==========================================================================
 * Serializable error
 * ======================================================================== */

/**
 * Safe representation for:
 *
 * - Chrome runtime messaging
 * - IndexedDB diagnostics
 * - JSON export
 *
 * Native Error objects themselves should not cross runtime boundaries.
 */
export interface SerializedTrackerError {
  code: TrackerErrorCode;

  message: string;

  component: DiagnosticComponent;

  recoverable: boolean;

  details: TrackerErrorDetails;
}

/* ==========================================================================
 * Tracker error
 * ======================================================================== */

/**
 * Common extension error class.
 *
 * Feature modules should throw TrackerError rather than arbitrary strings.
 */
export class TrackerError extends Error {
  public readonly code: TrackerErrorCode;

  public readonly component: DiagnosticComponent;

  public readonly recoverable: boolean;

  public readonly details: TrackerErrorDetails;

  public constructor(
    code: TrackerErrorCode,
    component: DiagnosticComponent,
    message: string,
    options: TrackerErrorOptions = {}
  ) {
    super(
      message,
      options.cause !== undefined
        ? { cause: options.cause }
        : undefined
    );

    this.name = "TrackerError";

    this.code = code;
    this.component = component;

    this.recoverable =
      options.recoverable
      ?? DEFAULT_ERROR_RECOVERABILITY[code];

    this.details =
      options.details
      ?? null;
  }

  /**
   * Converts the Error instance into a plain serializable object.
   */
  public toSerializable(): SerializedTrackerError {
    return {
      code: this.code,
      message: this.message,
      component: this.component,
      recoverable: this.recoverable,
      details: this.details
    };
  }
}

/* ==========================================================================
 * Type guards
 * ======================================================================== */

const ERROR_CODE_VALUES: ReadonlySet<string> =
  new Set<string>(Object.values(ERROR_CODES));

export function isTrackerErrorCode(
  value: unknown
): value is TrackerErrorCode {
  return (
    typeof value === "string"
    && ERROR_CODE_VALUES.has(value)
  );
}

export function isTrackerError(
  value: unknown
): value is TrackerError {
  return value instanceof TrackerError;
}

/* ==========================================================================
 * Unknown error helpers
 * ======================================================================== */

export function getUnknownErrorMessage(
  error: unknown
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "An unknown error occurred.";
}

/**
 * Converts an arbitrary caught value into TrackerError.
 *
 * Use this at module boundaries where external/browser APIs may throw
 * values that are not TrackerError instances.
 */
export function normalizeTrackerError(
  error: unknown,
  fallbackCode: TrackerErrorCode,
  component: DiagnosticComponent,
  fallbackMessage: string,
  options: Omit<TrackerErrorOptions, "cause"> = {}
): TrackerError {
  if (isTrackerError(error)) {
    return error;
  }

  const originalMessage =
    getUnknownErrorMessage(error);

  return new TrackerError(
    fallbackCode,
    component,
    fallbackMessage,
    {
      ...options,
      cause: error,

      details: {
        ...(options.details ?? {}),
        originalMessage
      }
    }
  );
}

/* ==========================================================================
 * Camera error normalization
 * ======================================================================== */

/**
 * Maps getUserMedia/browser camera errors into the extension's
 * centralized error-code system.
 */
export function normalizeCameraError(
  error: unknown
): TrackerError {
  if (isTrackerError(error)) {
    return error;
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return new TrackerError(
          ERROR_CODES.CAMERA_PERMISSION_DENIED,
          "CAMERA",
          "Camera permission was denied or could not be prompted in this extension context.",
          {
            cause: error,
            details: {
              domExceptionName: error.name,
              originalMessage: error.message
            }
          }
        );

      case "NotFoundError":
      case "DevicesNotFoundError":
        return new TrackerError(
          ERROR_CODES.CAMERA_NOT_FOUND,
          "CAMERA",
          "No usable camera device was found.",
          {
            cause: error
          }
        );

      case "NotReadableError":
      case "TrackStartError":
        return new TrackerError(
          ERROR_CODES.CAMERA_NOT_READABLE,
          "CAMERA",
          "The camera exists but could not be opened.",
          {
            cause: error
          }
        );

      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return new TrackerError(
          ERROR_CODES.CAMERA_CONSTRAINT_UNSATISFIED,
          "CAMERA",
          "The requested camera constraints could not be satisfied.",
          {
            cause: error
          }
        );

      case "AbortError":
        return new TrackerError(
          ERROR_CODES.CAMERA_START_FAILED,
          "CAMERA",
          "Camera initialization was aborted.",
          {
            cause: error
          }
        );

      default:
        return new TrackerError(
          ERROR_CODES.CAMERA_START_FAILED,
          "CAMERA",
          "The camera could not be initialized.",
          {
            cause: error,
            details: {
              domExceptionName: error.name,
              originalMessage: error.message
            }
          }
        );
    }
  }

  return normalizeTrackerError(
    error,
    ERROR_CODES.CAMERA_START_FAILED,
    "CAMERA",
    "The camera could not be initialized."
  );
}