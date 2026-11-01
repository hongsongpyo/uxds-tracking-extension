import {
  MESSAGE_TYPES,
  isCompatibleMessageProtocol
} from "./messages";
import { isRecord } from "./utils";

/**
 * The Background must not conclude that calibration started merely because
 * chrome.tabs.sendMessage() did not throw. The Content Script explicitly
 * acknowledges that it mounted the visible calibration overlay. The response
 * is also idempotent for a repeated delivery of the same calibration ID.
 */
export function isCalibrationUiReadyAcknowledgement(
  value: unknown,
  expectedCalibrationId: string,
  expectedSessionId: string,
  expectedPageId: string
): boolean {
  return isRecord(value)
    && isCompatibleMessageProtocol(value.protocolVersion)
    && value.type === MESSAGE_TYPES.CALIBRATION_UI_READY
    && isRecord(value.meta)
    && value.meta.source === "CONTENT"
    && value.meta.target === "BACKGROUND"
    && value.meta.sessionId === expectedSessionId
    && value.meta.pageId === expectedPageId
    && isRecord(value.payload)
    && value.payload.accepted === true
    && value.payload.calibrationId === expectedCalibrationId;
}
