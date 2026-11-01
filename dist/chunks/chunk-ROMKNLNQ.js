import {
  APP_NAME,
  LOGGING,
  RUNTIME_LIMITS,
  truncateString
} from "./chunk-6TH637DM.js";

// src/shared/logger.ts
var SENSITIVE_KEY_PATTERNS = [
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
function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) => pattern.test(key)
  );
}
function sanitizeValue(value, depth, seen) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
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
    const result = {};
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
function sanitizeLogDetails(details) {
  if (details === null) {
    return null;
  }
  const seen = /* @__PURE__ */ new WeakSet();
  const sanitized = {};
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
  const serialized = JSON.stringify(sanitized) ?? "{}";
  if (serialized.length <= LOGGING.MAX_SERIALIZED_DETAILS_LENGTH) {
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
var Logger = class {
  constructor(component) {
    this.component = component;
  }
  component;
  debug(message, details = null) {
    if (!LOGGING.ENABLE_DEBUG_LOGS) {
      return;
    }
    this.write(
      "DEBUG",
      message,
      details
    );
  }
  info(message, details = null) {
    this.write(
      "INFO",
      message,
      details
    );
  }
  warn(message, details = null) {
    this.write(
      "WARN",
      message,
      details
    );
  }
  error(message, details = null) {
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
  createDiagnosticRecord(diagnosticId, level, message, details = null, context = {}) {
    return {
      diagnosticId,
      timestampEpochMs: Date.now(),
      level,
      component: this.component,
      code: "LOG",
      message,
      sessionId: context.sessionId ?? null,
      pageId: context.pageId ?? null,
      details: sanitizeLogDetails(details)
    };
  }
  write(level, message, details) {
    const prefix = `[${APP_NAME}][${this.component}][${level}]`;
    const safeDetails = sanitizeLogDetails(details);
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
  writeDebug(prefix, message, details) {
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
  writeInfo(prefix, message, details) {
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
  writeWarn(prefix, message, details) {
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
  writeError(prefix, message, details) {
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
};
function createLogger(component) {
  return new Logger(component);
}

export {
  createLogger
};
//# sourceMappingURL=chunk-ROMKNLNQ.js.map
