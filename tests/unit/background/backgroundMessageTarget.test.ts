import {
  describe,
  expect,
  it
} from "vitest";

import {
  isMessageForBackground
} from "../../../src/background/backgroundMessageTarget";

describe("background eye/UXDS runtime message isolation", () => {
  it("delegates project connection and unified control to the UXDS bridge", () => {
    for (const type of [
      "UXDS_CONNECT_PROJECT",
      "UXDS_GET_TRACKING_STATE",
      "UXDS_ARM_COLLECTION",
      "UXDS_DISARM_COLLECTION",
      "UXDS_QUEUE_EVENTS",
      "UXDS_RETRY_UPLOAD"
    ]) {
      expect(isMessageForBackground({ type })).toBe(false);
      expect(isMessageForBackground({ type, meta: { target: "BACKGROUND" } })).toBe(false);
    }
  });

  it("preserves versioned eye commands and existing target filtering", () => {
    expect(isMessageForBackground({
      type: "GET_TRACKER_STATE",
      protocolVersion: 5,
      meta: { target: "BACKGROUND", source: "POPUP" },
      payload: {}
    })).toBe(true);
    expect(isMessageForBackground({ type: "PING", meta: { target: "BROADCAST" } })).toBe(true);
    expect(isMessageForBackground({ type: "PING", meta: { target: "OFFSCREEN" } })).toBe(false);
  });
});
