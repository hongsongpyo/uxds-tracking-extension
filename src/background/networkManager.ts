import {
  NETWORK
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
  nowEpochMs
} from "../shared/utils";

import type {
  EpochMs
} from "../shared/types";

/* ==========================================================================
 * Logger
 * ======================================================================== */

const logger =
  createLogger("NETWORK");

/* ==========================================================================
 * Network status
 * ======================================================================== */

/**
 * navigator.onLine is only a connectivity hint.
 *
 * true does NOT guarantee that the research server is reachable.
 * false is useful as an early indication that a request should not
 * currently be attempted.
 */
export type NetworkConnectivityHint =
  | "ONLINE"
  | "OFFLINE";

export interface NetworkStatus {
  connectivityHint:
    NetworkConnectivityHint;

  checkedAtEpochMs:
    EpochMs;
}

/* ==========================================================================
 * Request definitions
 * ======================================================================== */

export type NetworkHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export interface NetworkRequest {
  url: string;

  method: NetworkHttpMethod;

  headers?:
    Readonly<Record<string, string>>;

  body?: BodyInit;

  timeoutMs?: number;
}

/* ==========================================================================
 * Response definitions
 * ======================================================================== */

export interface NetworkRequestSuccess {
  ok: true;

  status: number;

  response: Response;

  receivedAtEpochMs: EpochMs;
}

export interface NetworkRequestFailure {
  ok: false;

  status: number | null;

  retryable: boolean;

  error: TrackerError;

  failedAtEpochMs: EpochMs;
}

export type NetworkRequestResult =
  | NetworkRequestSuccess
  | NetworkRequestFailure;

/* ==========================================================================
 * JSON response definitions
 * ======================================================================== */

export interface NetworkJsonSuccess<
  TData
> {
  ok: true;

  status: number;

  data: TData;

  receivedAtEpochMs: EpochMs;
}

export interface NetworkJsonFailure {
  ok: false;

  status: number | null;

  retryable: boolean;

  error: TrackerError;

  failedAtEpochMs: EpochMs;
}

export type NetworkJsonResult<
  TData
> =
  | NetworkJsonSuccess<TData>
  | NetworkJsonFailure;

/* ==========================================================================
 * Retry calculation
 * ======================================================================== */

/**
 * Returns whether an HTTP response is normally worth retrying.
 *
 * Client errors such as 400/401/403/404 should generally not be retried
 * automatically because repeating the same request will not fix them.
 */
export function isRetryableHttpStatus(
  status: number
): boolean {
  return (
    status === 408
    || status === 425
    || status === 429
    || (
      status >= 500
      && status <= 599
    )
  );
}

/**
 * Exponential retry delay.
 *
 * attemptNumber starts at 1.
 *
 * attempt 1 -> INITIAL_DELAY_MS
 * attempt 2 -> INITIAL_DELAY_MS * multiplier
 * ...
 */
export function calculateRetryDelayMs(
  attemptNumber: number
): number {
  if (
    !Number.isInteger(attemptNumber)
    || attemptNumber < 1
  ) {
    throw new RangeError(
      "attemptNumber must be an integer greater than or equal to 1."
    );
  }

  const delay =
    NETWORK.RETRY.INITIAL_DELAY_MS
    * (
      NETWORK.RETRY
        .BACKOFF_MULTIPLIER
      ** (attemptNumber - 1)
    );

  return Math.min(
    delay,
    NETWORK.RETRY.MAX_DELAY_MS
  );
}

export function canRetryUpload(
  attemptCount: number
): boolean {
  return (
    Number.isInteger(attemptCount)
    && attemptCount >= 0
    && attemptCount
      < NETWORK.RETRY.MAX_ATTEMPTS
  );
}

export function calculateNextRetryAt(
  nextAttemptNumber: number,
  fromEpochMs: EpochMs =
    nowEpochMs()
): EpochMs {
  return (
    fromEpochMs
    + calculateRetryDelayMs(
      nextAttemptNumber
    )
  );
}

/* ==========================================================================
 * Request helpers
 * ======================================================================== */

function buildRequestInit(
  request: NetworkRequest,
  signal: AbortSignal
): RequestInit {
  const init: RequestInit = {
    method:
      request.method,

    signal,

    cache:
      "no-store",

    credentials:
      "omit"
  };

  if (
    request.headers !== undefined
  ) {
    init.headers = {
      ...request.headers
    };
  }

  if (
    request.body !== undefined
  ) {
    init.body =
      request.body;
  }

  return init;
}

function getRequestTimeoutMs(
  request: NetworkRequest
): number {
  const timeout =
    request.timeoutMs
    ?? NETWORK.REQUEST_TIMEOUT_MS;

  if (
    !Number.isFinite(timeout)
    || timeout <= 0
  ) {
    throw new RangeError(
      "Network request timeout must be a finite positive number."
    );
  }

  return timeout;
}

/* ==========================================================================
 * Network manager
 * ======================================================================== */

/**
 * NetworkManager performs individual network operations only.
 *
 * IMPORTANT:
 *
 * It does NOT own:
 * - gaze tracking
 * - session lifetime
 * - persistent upload queues
 * - IndexedDB
 *
 * Persistent retry scheduling will later be handled by the storage/upload
 * queue layer so Chrome MV3 service-worker suspension cannot lose retries.
 */
export class NetworkManager {
  /**
   * Returns Chrome's current online/offline hint.
   *
   * This must never be treated as proof that the server is reachable.
   */
  public getStatus(): NetworkStatus {
    return {
      connectivityHint:
        globalThis.navigator.onLine
          ? "ONLINE"
          : "OFFLINE",

      checkedAtEpochMs:
        nowEpochMs()
    };
  }

  public isOfflineHint(): boolean {
    return !globalThis.navigator.onLine;
  }

  /**
   * Performs one network attempt.
   *
   * No automatic retry loop occurs here.
   * A failed request must be persisted to upload_queue later.
   */
  public async request(
    request: NetworkRequest
  ): Promise<NetworkRequestResult> {
    if (this.isOfflineHint()) {
      const error =
        new TrackerError(
          ERROR_CODES.NETWORK_OFFLINE,
          "NETWORK",
          "The browser reports that the network is currently offline."
        );

      logger.warn(
        "Network request skipped because the browser is offline.",
        {
          method:
            request.method
        }
      );

      return {
        ok: false,

        status: null,

        retryable: true,

        error,

        failedAtEpochMs:
          nowEpochMs()
      };
    }

    let timeoutMs: number;

    try {
      timeoutMs =
        getRequestTimeoutMs(
          request
        );
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES
            .NETWORK_REQUEST_FAILED,
          "NETWORK",
          "Network request configuration is invalid."
        );

      return {
        ok: false,

        status: null,

        retryable: false,

        error:
          normalized,

        failedAtEpochMs:
          nowEpochMs()
      };
    }

    const controller =
      new AbortController();

    let didTimeout =
      false;

    const timeoutId =
      globalThis.setTimeout(
        () => {
          didTimeout = true;
          controller.abort();
        },
        timeoutMs
      );

    try {
      const response =
        await globalThis.fetch(
          request.url,
          buildRequestInit(
            request,
            controller.signal
          )
        );

      if (!response.ok) {
        const retryable =
          isRetryableHttpStatus(
            response.status
          );

        const error =
          new TrackerError(
            ERROR_CODES
              .NETWORK_REQUEST_FAILED,
            "NETWORK",
            `Network request failed with HTTP status ${response.status}.`,
            {
              recoverable:
                retryable,

              details: {
                method:
                  request.method,

                status:
                  response.status,

                retryable
              }
            }
          );

        logger.warn(
          "Network request returned a non-success HTTP response.",
          {
            method:
              request.method,

            status:
              response.status,

            retryable
          }
        );

        return {
          ok: false,

          status:
            response.status,

          retryable,

          error,

          failedAtEpochMs:
            nowEpochMs()
        };
      }

      logger.debug(
        "Network request completed successfully.",
        {
          method:
            request.method,

          status:
            response.status
        }
      );

      return {
        ok: true,

        status:
          response.status,

        response,

        receivedAtEpochMs:
          nowEpochMs()
      };
    } catch (error: unknown) {
      if (didTimeout) {
        const timeoutError =
          new TrackerError(
            ERROR_CODES.NETWORK_TIMEOUT,
            "NETWORK",
            "Network request timed out.",
            {
              cause:
                error,

              details: {
                method:
                  request.method,

                timeoutMs
              }
            }
          );

        logger.warn(
          "Network request timed out.",
          {
            method:
              request.method,

            timeoutMs
          }
        );

        return {
          ok: false,

          status: null,

          retryable: true,

          error:
            timeoutError,

          failedAtEpochMs:
            nowEpochMs()
        };
      }

      const offline =
        this.isOfflineHint();

      const normalized =
        normalizeTrackerError(
          error,

          offline
            ? ERROR_CODES.NETWORK_OFFLINE
            : ERROR_CODES
                .NETWORK_REQUEST_FAILED,

          "NETWORK",

          offline
            ? "The network became unavailable."
            : "Network request failed."
        );

      logger.warn(
        "Network request failed before receiving an HTTP response.",
        {
          method:
            request.method,

          code:
            normalized.code
        }
      );

      return {
        ok: false,

        status: null,

        retryable: true,

        error:
          normalized,

        failedAtEpochMs:
          nowEpochMs()
      };
    } finally {
      globalThis.clearTimeout(
        timeoutId
      );
    }
  }

  /**
   * Convenience method for JSON APIs.
   *
   * Runtime schema validation of server responses should be performed
   * by the caller when the response structure is important.
   */
  public async requestJson<
    TData
  >(
    request: NetworkRequest
  ): Promise<NetworkJsonResult<TData>> {
    const result =
      await this.request(
        request
      );

    if (!result.ok) {
      return result;
    }

    try {
      const data: unknown =
        await result.response.json();

      return {
        ok: true,

        status:
          result.status,

        data:
          data as TData,

        receivedAtEpochMs:
          result.receivedAtEpochMs
      };
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES
            .NETWORK_REQUEST_FAILED,
          "NETWORK",
          "Network response contained invalid JSON.",
          {
            recoverable:
              false,

            details: {
              status:
                result.status
            }
          }
        );

      return {
        ok: false,

        status:
          result.status,

        retryable:
          false,

        error:
          normalized,

        failedAtEpochMs:
          nowEpochMs()
      };
    }
  }
}

/* ==========================================================================
 * Shared background instance
 * ======================================================================== */

export const networkManager =
  new NetworkManager();