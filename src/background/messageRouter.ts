import {
  isFiniteNumber,
  isNullableFiniteNumber,
  isNullableString,
  isRecord
} from "../shared/utils";

import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  MESSAGE_PROTOCOL_VERSION,
  isCompatibleMessageProtocol,
  isMessageType
} from "../shared/messages";

import {
  createLogger
} from "../shared/logger";

import type {
  EmptyPayload,
  MessageMeta,
  MessagePayloadMap,
  MessageType,
  PingPayload,
  PongPayload,
  RuntimeContext,
  RuntimeMessage,
  RuntimeMessageOf
} from "../shared/messages";

import type {
  SerializedTrackerError
} from "../shared/errors";

/* ==========================================================================
 * Logger
 * ======================================================================== */

const logger = createLogger("BACKGROUND");

/* ==========================================================================
 * Message sender context
 * ======================================================================== */

/**
 * Normalized representation of chrome.runtime.MessageSender.
 *
 * Chrome-specific MessageSender objects should be converted into this type
 * by serviceWorker.ts before entering the router.
 */
export interface MessageRouteContext {
  senderTabId: number | null;
  senderWindowId: number | null;

  senderFrameId: number | null;

  senderDocumentId: string | null;

  senderUrl: string | null;
}

/* ==========================================================================
 * Runtime envelope
 * ======================================================================== */

/**
 * Message envelope after the common protocol fields have been validated,
 * but before the message-specific payload has been validated.
 */
interface RuntimeMessageEnvelope {
  protocolVersion:
    typeof MESSAGE_PROTOCOL_VERSION;

  type: MessageType;

  meta: MessageMeta;

  payload: unknown;
}

/* ==========================================================================
 * Handler / validator contracts
 * ======================================================================== */

/**
 * Every registered message handler must provide a runtime payload validator.
 *
 * TypeScript types disappear at runtime, so this validator is what prevents
 * malformed Chrome messages from being trusted blindly.
 */
export type MessagePayloadValidator<
  TType extends MessageType
> = (
  payload: unknown
) => payload is MessagePayloadMap[TType];

/**
 * A handler may optionally return another typed runtime message.
 *
 * Returning null means the message was successfully handled but no direct
 * response message is needed.
 */
export type MessageHandler<
  TType extends MessageType
> = (
  message: RuntimeMessageOf<TType>,
  context: MessageRouteContext
) =>
  | RuntimeMessage
  | null
  | Promise<RuntimeMessage | null>;

/* ==========================================================================
 * Router results
 * ======================================================================== */

export interface MessageRouteHandled {
  ok: true;

  handled: true;

  response: RuntimeMessage | null;
}

export interface MessageRouteUnhandled {
  ok: true;

  handled: false;

  response: null;
}

export interface MessageRouteFailed {
  ok: false;

  handled: false;

  error: SerializedTrackerError;
}

export type MessageRouteResult =
  | MessageRouteHandled
  | MessageRouteUnhandled
  | MessageRouteFailed;

/* ==========================================================================
 * Registered route abstraction
 * ======================================================================== */

interface RegisteredRoute {
  execute(
    envelope: RuntimeMessageEnvelope,
    context: MessageRouteContext
  ): Promise<RuntimeMessage | null>;
}

/* ==========================================================================
 * General runtime guards
 * ======================================================================== */


/* ==========================================================================
 * Runtime context validation
 * ======================================================================== */

const RUNTIME_CONTEXT_VALUES:
  ReadonlySet<string> =
    new Set<string>([
      "BACKGROUND",
      "OFFSCREEN",
      "CONTENT",
      "POPUP",
      "CAMERA_PERMISSION_UI",
      "CALIBRATION_UI",
      "BROADCAST"
    ] satisfies readonly RuntimeContext[]);

function isRuntimeContext(
  value: unknown
): value is RuntimeContext {
  return (
    typeof value === "string"
    && RUNTIME_CONTEXT_VALUES.has(value)
  );
}

/* ==========================================================================
 * Message metadata validation
 * ======================================================================== */

function isMessageMeta(
  value: unknown
): value is MessageMeta {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.messageId !== "string"
    || value.messageId.length === 0
  ) {
    return false;
  }

  if (
    !isFiniteNumber(
      value.sentAtEpochMs
    )
  ) {
    return false;
  }

  if (
    !isRuntimeContext(
      value.source
    )
  ) {
    return false;
  }

  if (
    !isRuntimeContext(
      value.target
    )
  ) {
    return false;
  }

  if (
    !isNullableString(
      value.sessionId
    )
  ) {
    return false;
  }

  if (
    !isNullableString(
      value.pageId
    )
  ) {
    return false;
  }

  if (
    !isNullableFiniteNumber(
      value.tabId
    )
  ) {
    return false;
  }

  if (
    !isNullableFiniteNumber(
      value.browserFrameId
    )
  ) {
    return false;
  }

  return true;
}

/* ==========================================================================
 * Envelope parsing
 * ======================================================================== */

type EnvelopeParseResult =
  | {
      ok: true;

      envelope:
        RuntimeMessageEnvelope;
    }
  | {
      ok: false;

      error:
        SerializedTrackerError;
    };

function createRouterError(
  code: typeof ERROR_CODES.INVALID_MESSAGE
    | typeof ERROR_CODES.INCOMPATIBLE_MESSAGE_PROTOCOL,
  message: string,
  details:
    Readonly<Record<string, unknown>>
    | null = null
): SerializedTrackerError {
  return new TrackerError(
    code,
    "BACKGROUND",
    message,
    {
      details
    }
  ).toSerializable();
}

function parseRuntimeMessageEnvelope(
  value: unknown
): EnvelopeParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,

      error:
        createRouterError(
          ERROR_CODES.INVALID_MESSAGE,
          "Runtime message must be a plain object."
        )
    };
  }

  if (
    !isCompatibleMessageProtocol(
      value.protocolVersion
    )
  ) {
    return {
      ok: false,

      error:
        createRouterError(
          ERROR_CODES
            .INCOMPATIBLE_MESSAGE_PROTOCOL,

          "Runtime message protocol version is incompatible.",

          {
            receivedProtocolVersion:
              value.protocolVersion,

            expectedProtocolVersion:
              MESSAGE_PROTOCOL_VERSION
          }
        )
    };
  }

  if (!isMessageType(value.type)) {
    return {
      ok: false,

      error:
        createRouterError(
          ERROR_CODES.INVALID_MESSAGE,
          "Runtime message type is invalid.",
          {
            receivedType:
              value.type
          }
        )
    };
  }

  if (!isMessageMeta(value.meta)) {
    return {
      ok: false,

      error:
        createRouterError(
          ERROR_CODES.INVALID_MESSAGE,
          "Runtime message metadata is invalid.",
          {
            messageType:
              value.type
          }
        )
    };
  }

  return {
    ok: true,

    envelope: {
      protocolVersion:
        MESSAGE_PROTOCOL_VERSION,

      type:
        value.type,

      meta:
        value.meta,

      payload:
        value.payload
    }
  };
}

/* ==========================================================================
 * Sender consistency validation
 * ======================================================================== */

/**
 * Prevents a content-script message from claiming that it belongs to a
 * different tab/frame than the Chrome MessageSender that actually delivered
 * it.
 *
 * Popup/offscreen/background messages do not necessarily have tab metadata,
 * so the stricter check applies only to CONTENT messages.
 */
function validateSenderConsistency(
  envelope: RuntimeMessageEnvelope,
  context: MessageRouteContext
): SerializedTrackerError | null {
  if (
    envelope.meta.source
    !== "CONTENT"
  ) {
    return null;
  }

  if (
    context.senderTabId !== null
    && envelope.meta.tabId !== null
    && context.senderTabId
      !== envelope.meta.tabId
  ) {
    return createRouterError(
      ERROR_CODES.INVALID_MESSAGE,
      "Content message tab ID does not match its Chrome sender.",
      {
        messageTabId:
          envelope.meta.tabId,

        senderTabId:
          context.senderTabId,

        messageType:
          envelope.type
      }
    );
  }

  if (
    context.senderFrameId !== null
    && envelope.meta.browserFrameId
      !== null
    && context.senderFrameId
      !== envelope.meta.browserFrameId
  ) {
    return createRouterError(
      ERROR_CODES.INVALID_MESSAGE,
      "Content message frame ID does not match its Chrome sender.",
      {
        messageFrameId:
          envelope.meta.browserFrameId,

        senderFrameId:
          context.senderFrameId,

        messageType:
          envelope.type
      }
    );
  }

  return null;
}

/* ==========================================================================
 * Common payload validators
 * ======================================================================== */

/**
 * Validator for messages whose payload must be exactly {}.
 */
export function isEmptyPayload(
  payload: unknown
): payload is EmptyPayload {
  return (
    isRecord(payload)
    && Object.keys(payload).length === 0
  );
}

export function isPingPayload(
  payload: unknown
): payload is PingPayload {
  return (
    isRecord(payload)
    && typeof payload.nonce === "string"
    && payload.nonce.length > 0
  );
}

export function isPongPayload(
  payload: unknown
): payload is PongPayload {
  return (
    isRecord(payload)
    && typeof payload.nonce === "string"
    && payload.nonce.length > 0
  );
}

/* ==========================================================================
 * Message router
 * ======================================================================== */

export class MessageRouter {
  private readonly routes =
    new Map<MessageType, RegisteredRoute>();

  /**
   * Registers one type-safe message route.
   *
   * Every route requires:
   *
   * 1. message type,
   * 2. runtime payload validator,
   * 3. typed handler.
   *
   * Duplicate registrations are rejected.
   */
  public register<
    TType extends MessageType
  >(
    type: TType,
    validatePayload:
      MessagePayloadValidator<TType>,
    handler:
      MessageHandler<TType>
  ): void {
    if (this.routes.has(type)) {
      throw new TrackerError(
        ERROR_CODES.INVALID_MESSAGE,
        "BACKGROUND",
        `A handler for ${type} is already registered.`,
        {
          recoverable: false,

          details: {
            type
          }
        }
      );
    }

    const route:
      RegisteredRoute = {
        execute:
          async (
            envelope:
              RuntimeMessageEnvelope,
            context:
              MessageRouteContext
          ): Promise<
            RuntimeMessage | null
          > => {
            if (
              envelope.type
              !== type
            ) {
              throw new TrackerError(
                ERROR_CODES.INVALID_MESSAGE,
                "BACKGROUND",
                "Message route type mismatch.",
                {
                  recoverable: false,

                  details: {
                    expectedType:
                      type,

                    receivedType:
                      envelope.type
                  }
                }
              );
            }

            if (
              !validatePayload(
                envelope.payload
              )
            ) {
              throw new TrackerError(
                ERROR_CODES.INVALID_MESSAGE,
                "BACKGROUND",
                `Invalid payload for message ${type}.`,
                {
                  details: {
                    type
                  }
                }
              );
            }

            const message:
              RuntimeMessageOf<TType> = {
                protocolVersion:
                  envelope.protocolVersion,

                type,

                meta:
                  envelope.meta,

                payload:
                  envelope.payload
              };

            return handler(
              message,
              context
            );
          }
      };

    this.routes.set(
      type,
      route
    );

    logger.debug(
      "Message route registered.",
      {
        type
      }
    );
  }

  /**
   * Removes a previously registered route.
   *
   * Mainly useful for tests or controlled runtime reconfiguration.
   */
  public unregister(
    type: MessageType
  ): boolean {
    return this.routes.delete(type);
  }

  public hasHandler(
    type: MessageType
  ): boolean {
    return this.routes.has(type);
  }

  /**
   * Validates and dispatches one incoming Chrome runtime message.
   *
   * Unknown/unregistered message types are not treated as fatal errors.
   * The service worker may decide to forward them to another runtime context.
   */
  public async route(
    rawMessage: unknown,
    context: MessageRouteContext
  ): Promise<MessageRouteResult> {
    const parsed =
      parseRuntimeMessageEnvelope(
        rawMessage
      );

    if (!parsed.ok) {
      logger.warn(
        "Rejected invalid runtime message.",
        {
          code:
            parsed.error.code,

          message:
            parsed.error.message
        }
      );

      return {
        ok: false,
        handled: false,

        error:
          parsed.error
      };
    }

    const senderError =
      validateSenderConsistency(
        parsed.envelope,
        context
      );

    if (senderError !== null) {
      logger.warn(
        "Rejected runtime message with inconsistent sender metadata.",
        {
          code:
            senderError.code,

          messageType:
            parsed.envelope.type
        }
      );

      return {
        ok: false,
        handled: false,

        error:
          senderError
      };
    }

    const route =
      this.routes.get(
        parsed.envelope.type
      );

    if (route === undefined) {
      logger.debug(
        "No local handler registered for runtime message.",
        {
          type:
            parsed.envelope.type,

          target:
            parsed.envelope.meta.target
        }
      );

      return {
        ok: true,
        handled: false,
        response: null
      };
    }

    try {
      const response =
        await route.execute(
          parsed.envelope,
          context
        );

      return {
        ok: true,
        handled: true,
        response
      };
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES.UNKNOWN,
          "BACKGROUND",
          "Runtime message handler failed.",
          {
            details: {
              messageType:
                parsed.envelope.type,

              messageId:
                parsed.envelope.meta
                  .messageId
            }
          }
        );

      logger.error(
        "Runtime message handler failed.",
        {
          code:
            normalized.code,

          messageType:
            parsed.envelope.type,

          recoverable:
            normalized.recoverable
        }
      );

      return {
        ok: false,
        handled: false,

        error:
          normalized.toSerializable()
      };
    }
  }
}

/* ==========================================================================
 * Shared background instance
 * ======================================================================== */

export const messageRouter =
  new MessageRouter();