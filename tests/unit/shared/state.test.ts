import {
  describe,
  expect,
  it
} from "vitest";

import {
  TRACKER_STATES,
  TrackerStateMachine
} from "../../../src/shared/state";

describe("TrackerStateMachine hard reset", () => {
  it("returns any active workflow state to IDLE and advances the sequence", () => {
    const machine = new TrackerStateMachine(
      TRACKER_STATES.READY,
      100
    );

    const snapshot = machine.reset(200);

    expect(snapshot).toEqual({
      state: TRACKER_STATES.IDLE,
      previousState: TRACKER_STATES.READY,
      changedAtEpochMs: 200,
      sequence: 1
    });
    expect(machine.canTransition(TRACKER_STATES.INITIALIZING)).toBe(true);
  });
});
