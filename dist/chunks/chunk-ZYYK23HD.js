// src/shared/state.ts
var TRACKER_STATES = {
  IDLE: "IDLE",
  INITIALIZING: "INITIALIZING",
  CAMERA_READY: "CAMERA_READY",
  MODEL_LOADING: "MODEL_LOADING",
  FACE_POSITIONING: "FACE_POSITIONING",
  CALIBRATING: "CALIBRATING",
  VALIDATING: "VALIDATING",
  READY: "READY",
  RECORDING: "RECORDING",
  PAUSED: "PAUSED",
  STOPPING: "STOPPING",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR"
};
var INITIAL_TRACKER_STATE = TRACKER_STATES.IDLE;
var ALLOWED_STATE_TRANSITIONS = {
  [TRACKER_STATES.IDLE]: [
    TRACKER_STATES.INITIALIZING
  ],
  [TRACKER_STATES.INITIALIZING]: [
    TRACKER_STATES.CAMERA_READY,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.CAMERA_READY]: [
    TRACKER_STATES.MODEL_LOADING,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.MODEL_LOADING]: [
    TRACKER_STATES.FACE_POSITIONING,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.FACE_POSITIONING]: [
    TRACKER_STATES.CALIBRATING,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.CALIBRATING]: [
    TRACKER_STATES.VALIDATING,
    TRACKER_STATES.FACE_POSITIONING,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.VALIDATING]: [
    TRACKER_STATES.READY,
    TRACKER_STATES.CALIBRATING,
    TRACKER_STATES.FACE_POSITIONING,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.READY]: [
    TRACKER_STATES.RECORDING,
    TRACKER_STATES.FACE_POSITIONING,
    TRACKER_STATES.ERROR,
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.RECORDING]: [
    TRACKER_STATES.PAUSED,
    TRACKER_STATES.FACE_POSITIONING,
    TRACKER_STATES.STOPPING,
    TRACKER_STATES.ERROR
  ],
  [TRACKER_STATES.PAUSED]: [
    TRACKER_STATES.RECORDING,
    TRACKER_STATES.FACE_POSITIONING,
    TRACKER_STATES.STOPPING,
    TRACKER_STATES.ERROR
  ],
  [TRACKER_STATES.STOPPING]: [
    TRACKER_STATES.COMPLETED,
    TRACKER_STATES.ERROR
  ],
  [TRACKER_STATES.COMPLETED]: [
    TRACKER_STATES.IDLE
  ],
  [TRACKER_STATES.ERROR]: [
    TRACKER_STATES.IDLE
  ]
};
var TRACKER_STATE_VALUES = new Set(Object.values(TRACKER_STATES));
function isTrackerState(value) {
  return typeof value === "string" && TRACKER_STATE_VALUES.has(value);
}
function canTransitionTrackerState(from, to) {
  return ALLOWED_STATE_TRANSITIONS[from].includes(to);
}
var TrackerStateMachine = class {
  currentState;
  previousState;
  sequence;
  changedAtEpochMs;
  constructor(initialState = INITIAL_TRACKER_STATE, initialTimestampEpochMs = Date.now()) {
    this.currentState = initialState;
    this.previousState = null;
    this.sequence = 0;
    this.changedAtEpochMs = initialTimestampEpochMs;
  }
  /**
   * Returns an immutable copy of the current state information.
   */
  getSnapshot() {
    return {
      state: this.currentState,
      previousState: this.previousState,
      changedAtEpochMs: this.changedAtEpochMs,
      sequence: this.sequence
    };
  }
  /**
   * Returns whether the current state may transition to `nextState`.
   */
  canTransition(nextState) {
    return canTransitionTrackerState(
      this.currentState,
      nextState
    );
  }
  /**
   * Administrative hard reset used only by the explicit user reset command.
   * This bypasses the ordinary workflow transition graph because the runtime,
   * session, camera and derived state are torn down at the same time.
   */
  reset(timestampEpochMs = Date.now()) {
    const oldState = this.currentState;
    this.previousState = oldState;
    this.currentState = TRACKER_STATES.IDLE;
    this.changedAtEpochMs = timestampEpochMs;
    this.sequence += 1;
    return this.getSnapshot();
  }
  /**
   * Attempts a state transition. Invalid transitions are explicitly rejected.
   */
  transition(nextState, timestampEpochMs = Date.now()) {
    if (nextState === this.currentState) {
      return {
        ok: false,
        reason: "SAME_STATE",
        from: this.currentState,
        to: nextState
      };
    }
    if (!this.canTransition(nextState)) {
      return {
        ok: false,
        reason: "INVALID_TRANSITION",
        from: this.currentState,
        to: nextState
      };
    }
    const oldState = this.currentState;
    this.previousState = oldState;
    this.currentState = nextState;
    this.changedAtEpochMs = timestampEpochMs;
    this.sequence += 1;
    return {
      ok: true,
      snapshot: this.getSnapshot()
    };
  }
};

export {
  TRACKER_STATES,
  isTrackerState,
  TrackerStateMachine
};
//# sourceMappingURL=chunk-ZYYK23HD.js.map
