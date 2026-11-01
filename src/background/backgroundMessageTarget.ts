import {
  isRecord
} from "../shared/utils";

/**
 * The eye tracker and the UXDS bridge have separate Chrome runtime listeners.
 * UXDS commands use a legacy bare {type, ...} shape and MUST be handled only
 * by uxdsMouseBridge. If the eye router also replies, its strict protocol
 * validation races the UXDS response and the popup never connects.
 */
export function isMessageForBackground(
  rawMessage: unknown
): boolean {
  if (!isRecord(rawMessage)) {
    return true;
  }

  if (
    typeof rawMessage.type === "string"
    && rawMessage.type.startsWith("UXDS_")
  ) {
    return false;
  }

  const meta = rawMessage.meta;
  if (!isRecord(meta)) {
    return true;
  }

  const target = meta.target;
  if (typeof target !== "string") {
    return true;
  }

  return target === "BACKGROUND" || target === "BROADCAST";
}
