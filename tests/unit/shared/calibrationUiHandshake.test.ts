import { describe, expect, it } from "vitest";
import { createRuntimeMessage, MESSAGE_TYPES } from "../../../src/shared/messages";
import { isCalibrationUiReadyAcknowledgement } from "../../../src/shared/calibrationUiHandshake";

const response = createRuntimeMessage(MESSAGE_TYPES.CALIBRATION_UI_READY, {
  messageId: "ack_1", sentAtEpochMs: 10, source: "CONTENT", target: "BACKGROUND",
  sessionId: "session_1", pageId: "page_1", tabId: 3, browserFrameId: 0
}, {calibrationId: "calibration_1", accepted: true});
const isAck = (candidate: unknown): boolean =>
  isCalibrationUiReadyAcknowledgement(candidate, "calibration_1", "session_1", "page_1");

describe("Content calibration start acknowledgement", () => {
  it("accepts an actual matching UI-mounted acknowledgement", () => {
    expect(isAck(response)).toBe(true);
  });
  it("rejects no-response deliveries that previously retriggered calibration", () => {
    expect(isAck(undefined)).toBe(false);
    expect(isAck(null)).toBe(false);
  });
  it("rejects a stale calibration ID, page ID, or session ID", () => {
    expect(isAck({...response, payload: {...response.payload, calibrationId: "stale"}})).toBe(false);
    expect(isAck({...response, meta: {...response.meta, pageId: "old_page"}})).toBe(false);
    expect(isAck({...response, meta: {...response.meta, sessionId: "old_session"}})).toBe(false);
  });
  it("rejects a response from the wrong sender or protocol", () => {
    expect(isAck({...response, meta: {...response.meta, source: "OFFSCREEN"}})).toBe(false);
    expect(isAck({...response, protocolVersion: 1})).toBe(false);
    expect(isAck({...response, payload: {...response.payload, accepted: false}})).toBe(false);
  });
});
