/* eslint-disable no-console --
 * This file is the single approved console boundary for the extension.
 * Feature modules must use Logger instead of calling console directly.
 */

import {
  truncateString
} from "./utils";

import {
  APP_NAME,
  LOGGING,
  RUNTIME_LIMITS
} from "./constants";

import type {
  DiagnosticComponent,
  DiagnosticId,
  DiagnosticLevel,
  DiagnosticRecord,
  PageId,
  SessionId
} from "./types";

/* ==========================================================================
 * Logger types
 * ======================================================================== */

export type LogDetails =
  Readonly<Record<string, unknown>> | null;

export interface LogContext {
  sessionId?: SessionId | null;
  pageId?: PageId | null;
}

/* ==========================================================================
 * Sensitive-data protection
 * ======================================================================== */

/**
 * Keys that should never be printed directly to the developer console.
 *
 * This is intentionally conservative because webcam/face related data
 * can contain sensitive information.
 */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /^password$/i,
  /^passwd$/i,
  /^secret$/i,
  /^token$/i,
  /^accessToken$/i,
  /^refreshToken$/i,
  /^authorization$/i,
  /^cookie$/i,
  /^setCookie$/i,

  /^webcamFrame$/i,
  /^cameraFrame$/i,
  /^rawFrame$/i,

  /^faceImage$/i,
  /^eyeImage$/i,
  /^eyeCrop$/i,

  /^imageData$/i,
  /^imageBitmap$/i,

  /landmarks$/i
];

function isSensitiveKey(
  key: string
): boolean {
  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) => pattern.test(key)
  );
}

/* ==========================================================================
 * String sanitization
 * ======================================================================== */



/* ==========================================================================
 * Recursive value sanitization
 * ======================================================================== */

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(
      value,
      RUNTIME_LIMITS.MAX_AOI_TEXT_LENGTH
    );
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (typeof value === "function") {
    return "[Function]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(
        value.message,
        RUNTIME_LIMITS.MAX_AOI_TEXT_LENGTH
      )
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= RUNTIME_LIMITS.MAX_DIAGNOSTIC_DETAILS_DEPTH) {
    return "[MaxDepth]";
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map(
        (item) => sanitizeValue(
          item,
          depth + 1,
          seen
        )
      );
    }

    const result: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED]";
        continue;
      }

      result[key] = sanitizeValue(
        nestedValue,
        depth + 1,
        seen
      );
    }

    return result;
  } finally {
    seen.delete(value);
  }
}

/* ==========================================================================
 * Log-detail sanitization
 * ======================================================================== */

/**
 * Produces a console/diagnostic-safe copy of details.
 *
 * The source object itself is never modified.
 */
export function sanitizeLogDetails(
  details: LogDetails
): LogDetails {
  if (details === null) {
    return null;
  }

  const seen = new WeakSet<object>();

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    sanitized[key] = sanitizeValue(
      value,
      0,
      seen
    );
  }

  const serialized =
    JSON.stringify(sanitized)
    ?? "{}";

  if (
    serialized.length
    <= LOGGING.MAX_SERIALIZED_DETAILS_LENGTH
  ) {
    return sanitized;
  }

  return {
    truncated: true,

    preview: truncateString(
      serialized,
      LOGGING.MAX_SERIALIZED_DETAILS_LENGTH
    )
  };
}

/* ==========================================================================
 * Logger
 * ======================================================================== */

/**
 * Central extension logger.
 *
 * Feature modules should create one logger per logical component:
 *
 * const logger = createLogger("CAMERA");
 *
 * logger.info("Camera initialized.");
 */
export class Logger {
  public constructor(
    private readonly component: DiagnosticComponent
  ) {}

  public debug(
    message: string,
    details: LogDetails = null
  ): void {
    if (!LOGGING.ENABLE_DEBUG_LOGS) {
      return;
    }

    this.write(
      "DEBUG",
      message,
      details
    );
  }

  public info(
    message: string,
    details: LogDetails = null
  ): void {
    this.write(
      "INFO",
      message,
      details
    );
  }

  public warn(
    message: string,
    details: LogDetails = null
  ): void {
    this.write(
      "WARN",
      message,
      details
    );
  }

  public error(
    message: string,
    details: LogDetails = null
  ): void {
    this.write(
      "ERROR",
      message,
      details
    );
  }

  /**
   * Creates a persistable diagnostic record.
   *
   * This method does not write anything to IndexedDB by itself.
   * diagnostics storage will be handled later by the storage layer.
   */
  public createDiagnosticRecord(
    diagnosticId: DiagnosticId,
    level: DiagnosticLevel,
    message: string,
    details: LogDetails = null,
    context: LogContext = {}
  ): DiagnosticRecord {
    return {
      diagnosticId,

      timestampEpochMs: Date.now(),

      level,

      component: this.component,

      code: "LOG",

      message,

      sessionId:
        context.sessionId
        ?? null,

      pageId:
        context.pageId
        ?? null,

      details: sanitizeLogDetails(details)
    };
  }

  private write(
    level: DiagnosticLevel,
    message: string,
    details: LogDetails
  ): void {
    const prefix =
      `[${APP_NAME}][${this.component}][${level}]`;

    const safeDetails =
      sanitizeLogDetails(details);

    switch (level) {
      case "DEBUG":
        this.writeDebug(
          prefix,
          message,
          safeDetails
        );
        return;

      case "INFO":
        this.writeInfo(
          prefix,
          message,
          safeDetails
        );
        return;

      case "WARN":
        this.writeWarn(
          prefix,
          message,
          safeDetails
        );
        return;

      case "ERROR":
        this.writeError(
          prefix,
          message,
          safeDetails
        );
        return;
    }
  }

  private writeDebug(
    prefix: string,
    message: string,
    details: LogDetails
  ): void {
    if (details === null) {
      console.debug(
        prefix,
        message
      );

      return;
    }

    console.debug(
      prefix,
      message,
      details
    );
  }

  private writeInfo(
    prefix: string,
    message: string,
    details: LogDetails
  ): void {
    if (details === null) {
      console.info(
        prefix,
        message
      );

      return;
    }

    console.info(
      prefix,
      message,
      details
    );
  }

  private writeWarn(
    prefix: string,
    message: string,
    details: LogDetails
  ): void {
    if (details === null) {
      console.warn(
        prefix,
        message
      );

      return;
    }

    console.warn(
      prefix,
      message,
      details
    );
  }

  private writeError(
    prefix: string,
    message: string,
    details: LogDetails
  ): void {
    if (details === null) {
      console.error(
        prefix,
        message
      );

      return;
    }

    console.error(
      prefix,
      message,
      details
    );
  }
}

/* ==========================================================================
 * Logger factory
 * ======================================================================== */

/**
 * Preferred way to create loggers in feature modules.
 */
export function createLogger(
  component: DiagnosticComponent
): Logger {
  return new Logger(component);
}