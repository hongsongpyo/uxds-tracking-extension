import type { EpochMs } from "./types";

/* ==========================================================================
 * Tracker states
 * ======================================================================== */

/**
 * Single source of truth for every tracker runtime state.
 *
 * IMPORTANT:
 * Never redefine these state strings in other modules.
 */
export const TRACKER_STATES = {
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
} as const;

export type TrackerState =
  (typeof TRACKER_STATES)[keyof typeof TRACKER_STATES];

export const INITIAL_TRACKER_STATE: TrackerState =
  TRACKER_STATES.IDLE;

/* ==========================================================================
 * State transition rules
 * ======================================================================== */

/**
 * Allowed tracker state transitions.
 *
 * This is the single transition table used by the runtime.
 *
 * Invalid transitions must never silently succeed.
 */
export const ALLOWED_STATE_TRANSITIONS: Readonly<
  Record<TrackerState, readonly TrackerState[]>
> = {
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

/* ==========================================================================
 * State snapshot
 * ======================================================================== */

export interface TrackerStateSnapshot {
  state: TrackerState;

  previousState: TrackerState | null;

  changedAtEpochMs: EpochMs;

  /**
   * Incremented every time a successful state transition occurs.
   *
   * Useful for ignoring stale messages arriving out of order.
   */
  sequence: number;
}

/* ==========================================================================
 * Transition results
 * ======================================================================== */

export type StateTransitionFailureReason =
  | "SAME_STATE"
  | "INVALID_TRANSITION";

export interface SuccessfulStateTransition {
  ok: true;

  snapshot: TrackerStateSnapshot;
}

export interface FailedStateTransition {
  ok: false;

  reason: StateTransitionFailureReason;

  from: TrackerState;
  to: TrackerState;
}

export type StateTransitionResult =
  | SuccessfulStateTransition
  | FailedStateTransition;

/* ==========================================================================
 * Utility functions
 * ======================================================================== */

const TRACKER_STATE_VALUES: ReadonlySet<string> =
  new Set<string>(Object.values(TRACKER_STATES));

/**
 * Runtime type guard for data received from Chrome messaging,
 * storage, or other untrusted boundaries.
 */
export function isTrackerState(
  value: unknown
): value is TrackerState {
  return (
    typeof value === "string"
    && TRACKER_STATE_VALUES.has(value)
  );
}

/**
 * Returns whether a transition is permitted by the central transition table.
 */
export function canTransitionTrackerState(
  from: TrackerState,
  to: TrackerState
): boolean {
  return ALLOWED_STATE_TRANSITIONS[from].includes(to);
}

/* ==========================================================================
 * State machine
 * ======================================================================== */

/**
 * Pure tracker state machine.
 *
 * The service worker will later own the authoritative instance.
 * Other modules should request transitions through the service worker
 * rather than maintaining independent authoritative tracker states.
 */
export class TrackerStateMachine {
  private currentState: TrackerState;

  private previousState: TrackerState | null;

  private sequence: number;

  private changedAtEpochMs: EpochMs;

  public constructor(
    initialState: TrackerState = INITIAL_TRACKER_STATE,
    initialTimestampEpochMs: EpochMs = Date.now()
  ) {
    this.currentState = initialState;
    this.previousState = null;
    this.sequence = 0;
    this.changedAtEpochMs = initialTimestampEpochMs;
  }

  /**
   * Returns an immutable copy of the current state information.
   */
  public getSnapshot(): TrackerStateSnapshot {
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
  public canTransition(
    nextState: TrackerState
  ): boolean {
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
  public reset(
    timestampEpochMs: EpochMs = Date.now()
  ): TrackerStateSnapshot {
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
  public transition(
    nextState: TrackerState,
    timestampEpochMs: EpochMs = Date.now()
  ): StateTransitionResult {
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
}