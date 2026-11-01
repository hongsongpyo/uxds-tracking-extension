import {
  NUMERIC_EPSILON
} from "./constants";

import type {
  AoiId,
  CalibrationId,
  DiagnosticId,
  EpochMs,
  FixationId,
  PageId,
  Point2D,
  Rect2D,
  SampleId,
  SessionId,
  TimestampMs,
  UploadQueueId
} from "./types";

/* ==========================================================================
 * Runtime type guards
 * ======================================================================== */

/**
 * Returns true only for non-null, non-array objects.
 *
 * Useful when validating data received through Chrome messaging,
 * IndexedDB, JSON imports, etc.
 */
export function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
  );
}

export function isFiniteNumber(
  value: unknown
): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
  );
}

export function isNullableFiniteNumber(
  value: unknown
): value is number | null {
  return (
    value === null
    || isFiniteNumber(value)
  );
}

export function isNonNegativeFiniteNumber(
  value: unknown
): value is number {
  return (
    isFiniteNumber(value)
    && value >= 0
  );
}

export function isPositiveFiniteNumber(
  value: unknown
): value is number {
  return (
    isFiniteNumber(value)
    && value > 0
  );
}

export function isString(
  value: unknown
): value is string {
  return typeof value === "string";
}

export function isNullableString(
  value: unknown
): value is string | null {
  return (
    value === null
    || typeof value === "string"
  );
}

export function isNonEmptyString(
  value: unknown
): value is string {
  return (
    typeof value === "string"
    && value.trim().length > 0
  );
}

export function isBoolean(
  value: unknown
): value is boolean {
  return typeof value === "boolean";
}

/* ==========================================================================
 * Geometry guards
 * ======================================================================== */

export function isFinitePoint(
  value: unknown
): value is Point2D {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
  );
}

export function isFiniteRect(
  value: unknown
): value is Rect2D {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.left)
    && isFiniteNumber(value.top)
    && isNonNegativeFiniteNumber(
      value.width
    )
    && isNonNegativeFiniteNumber(
      value.height
    )
  );
}

/* ==========================================================================
 * Time
 * ======================================================================== */

/**
 * Unix epoch time in milliseconds.
 *
 * Use for:
 * - session started/ended timestamps
 * - diagnostics
 * - export timestamps
 * - persistent metadata
 */
export function nowEpochMs(): EpochMs {
  return Date.now();
}

/**
 * Shared high-resolution interaction timeline.
 *
 * IMPORTANT:
 * Gaze, mouse, click, scroll and other real-time interaction events
 * should use this clock so timestamps generated in different extension
 * contexts remain comparable.
 *
 * performance.timeOrigin + performance.now() provides an epoch-based,
 * high-resolution timeline while preserving the monotonic characteristics
 * of performance.now().
 */
export function nowTimelineMs(): TimestampMs {
  const timeOrigin =
    globalThis.performance.timeOrigin;

  const elapsed =
    globalThis.performance.now();

  const timestamp =
    timeOrigin + elapsed;

  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  /**
   * Defensive fallback.
   *
   * Modern Chrome extension contexts provide Performance, but falling
   * back to Date.now() prevents a complete tracking failure if the
   * high-resolution clock is unexpectedly unavailable or invalid.
   */
  return Date.now();
}

/**
 * Promise-based short delay.
 *
 * Do not use this as a long-duration scheduling mechanism in an MV3
 * service worker because Chrome may suspend the worker.
 */
export function sleep(
  durationMs: number
): Promise<void> {
  if (
    !Number.isFinite(durationMs)
    || durationMs < 0
  ) {
    return Promise.reject(
      new RangeError(
        "sleep() duration must be a finite, non-negative number."
      )
    );
  }

  return new Promise<void>(
    (resolve) => {
      globalThis.setTimeout(
        resolve,
        durationMs
      );
    }
  );
}

/* ==========================================================================
 * Identifier generation
 * ======================================================================== */

function createPrefixedId(
  prefix: string
): string {
  if (prefix.length === 0) {
    throw new Error(
      "ID prefix must not be empty."
    );
  }

  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

/** UXDS server-compatible ID; remains the authoritative eye+mouse session ID. */
export function createSessionId():
SessionId {
  const randomBytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes, (byte) => (byte % 36).toString(36)).join("");
  return `session_${Date.now()}_${suffix}`;
}

/** UXDS page-view ID shared between the gaze and pointer event streams. */
export function createPageId():
PageId {
  const randomBytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes, (byte) => (byte % 36).toString(36)).join("");
  return `pv_${Date.now()}_${suffix}`;
}

export function createSampleId():
SampleId {
  return createPrefixedId(
    "sample"
  );
}

export function createFixationId():
FixationId {
  return createPrefixedId(
    "fixation"
  );
}

export function createCalibrationId():
CalibrationId {
  return createPrefixedId(
    "calibration"
  );
}

export function createAoiId():
AoiId {
  return createPrefixedId(
    "aoi"
  );
}

export function createDiagnosticId():
DiagnosticId {
  return createPrefixedId(
    "diagnostic"
  );
}

export function createUploadQueueId():
UploadQueueId {
  return createPrefixedId(
    "upload"
  );
}

/**
 * Runtime message IDs currently use the primitive string type.
 */
export function createMessageId():
string {
  return createPrefixedId(
    "msg"
  );
}

/* ==========================================================================
 * Numeric utilities
 * ======================================================================== */

export function clamp(
  value: number,
  min: number,
  max: number
): number {
  if (
    !Number.isFinite(value)
    || !Number.isFinite(min)
    || !Number.isFinite(max)
  ) {
    throw new RangeError(
      "clamp() requires finite numeric arguments."
    );
  }

  if (min > max) {
    throw new RangeError(
      "clamp() requires min <= max."
    );
  }

  return Math.min(
    Math.max(value, min),
    max
  );
}

export function clamp01(
  value: number
): number {
  return clamp(
    value,
    0,
    1
  );
}

export function lerp(
  start: number,
  end: number,
  amount: number
): number {
  if (
    !Number.isFinite(start)
    || !Number.isFinite(end)
    || !Number.isFinite(amount)
  ) {
    throw new RangeError(
      "lerp() requires finite numeric arguments."
    );
  }

  return (
    start
    + (end - start) * amount
  );
}

export function safeDivide(
  numerator: number,
  denominator: number,
  fallback = 0
): number {
  if (
    !Number.isFinite(numerator)
    || !Number.isFinite(denominator)
    || !Number.isFinite(fallback)
  ) {
    throw new RangeError(
      "safeDivide() requires finite numeric arguments."
    );
  }

  if (
    Math.abs(denominator)
    <= NUMERIC_EPSILON
  ) {
    return fallback;
  }

  return numerator / denominator;
}

export function nearlyEqual(
  a: number,
  b: number,
  epsilon: number =
    NUMERIC_EPSILON
): boolean {
  if (
    !Number.isFinite(a)
    || !Number.isFinite(b)
    || !Number.isFinite(epsilon)
    || epsilon < 0
  ) {
    return false;
  }

  return (
    Math.abs(a - b)
    <= epsilon
  );
}

/* ==========================================================================
 * Point / distance utilities
 * ======================================================================== */

export function squaredDistance2D(
  a: Point2D,
  b: Point2D
): number {
  const dx =
    b.x - a.x;

  const dy =
    b.y - a.y;

  return (
    dx * dx
    + dy * dy
  );
}

export function distance2D(
  a: Point2D,
  b: Point2D
): number {
  return Math.sqrt(
    squaredDistance2D(
      a,
      b
    )
  );
}

export function isNormalizedValue(
  value: number
): boolean {
  return (
    Number.isFinite(value)
    && value >= 0
    && value <= 1
  );
}

export function isNormalizedPoint(
  point: Point2D
): boolean {
  return (
    isNormalizedValue(
      point.x
    )
    && isNormalizedValue(
      point.y
    )
  );
}

/* ==========================================================================
 * String utilities
 * ======================================================================== */

export function truncateString(
  value: string,
  maxLength: number
): string {
  if (
    !Number.isInteger(maxLength)
    || maxLength < 0
  ) {
    throw new RangeError(
      "truncateString() maxLength must be a non-negative integer."
    );
  }

  if (
    value.length
    <= maxLength
  ) {
    return value;
  }

  if (maxLength === 0) {
    return "";
  }

  if (maxLength === 1) {
    return "…";
  }

  return `${
    value.slice(
      0,
      maxLength - 1
    )
  }…`;
}

/* ==========================================================================
 * URL utilities
 * ======================================================================== */

export function isHttpOrHttpsUrl(
  value: string
): boolean {
  try {
    const url =
      new URL(value);

    return (
      url.protocol === "http:"
      || url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

export function getUrlOrigin(
  value: string
): string | null {
  try {
    return new URL(
      value
    ).origin;
  } catch {
    return null;
  }
}

/* ==========================================================================
 * Exhaustiveness
 * ======================================================================== */

/**
 * Compile-time exhaustiveness helper for discriminated unions.
 *
 * Example:
 *
 * switch (state) {
 *   ...
 *   default:
 *     return assertNever(state);
 * }
 */
export function assertNever(
  value: never
): never {
  throw new Error(
    `Unexpected value: ${String(value)}`
  );
}