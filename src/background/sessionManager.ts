import {
  createSessionId
} from "../shared/utils";

import {
  SCHEMA_VERSION,
  TRACKER_VERSION
} from "../shared/constants";

import {
  createLogger
} from "../shared/logger";

import type {
  BrowserMetadata,
  CalibrationProfileId,
  CameraSettings,
  EpochMs,
  GazeEngineSource,
  ParticipantId,
  ScreenMetadata,
  SessionId,
  SessionRecord
} from "../shared/types";

/* ==========================================================================
 * Logger
 * ======================================================================== */

const logger = createLogger("BACKGROUND");

/* ==========================================================================
 * Session start input
 * ======================================================================== */

export interface SessionStartInput {
  projectId?: string | null;
  participantId: ParticipantId;

  gazeEngine: GazeEngineSource;

  browser: BrowserMetadata;

  screen: ScreenMetadata;
}

/* ==========================================================================
 * Session operation results
 * ======================================================================== */

export type SessionStartFailureReason =
  | "SESSION_ALREADY_ACTIVE"
  | "INVALID_PARTICIPANT_ID";

export interface SessionStartSuccess {
  ok: true;

  session: SessionRecord;
}

export interface SessionStartFailure {
  ok: false;

  reason: SessionStartFailureReason;

  activeSession: SessionRecord | null;
}

export type SessionStartResult =
  | SessionStartSuccess
  | SessionStartFailure;

export interface SessionEndSuccess {
  ok: true;

  session: SessionRecord;
}

export interface SessionEndFailure {
  ok: false;

  reason: "SESSION_NOT_ACTIVE";
}

export type SessionEndResult =
  | SessionEndSuccess
  | SessionEndFailure;

export interface SessionUpdateSuccess {
  ok: true;

  session: SessionRecord;
}

export interface SessionUpdateFailure {
  ok: false;

  reason: "SESSION_NOT_ACTIVE";
}

export type SessionUpdateResult =
  | SessionUpdateSuccess
  | SessionUpdateFailure;

/* ==========================================================================
 * Internal helpers
 * ======================================================================== */



function getExtensionVersion(): string {
  return chrome.runtime.getManifest().version;
}

/**
 * Session records contain nested objects.
 *
 * Returning a copy prevents other modules from accidentally mutating
 * SessionManager's authoritative state.
 */
function cloneSessionRecord(
  session: SessionRecord
): SessionRecord {
  return {
    ...session,

    browser: {
      ...session.browser
    },

    screen: {
      ...session.screen
    },

    camera:
      session.camera === null
        ? null
        : {
            ...session.camera
          }
  };
}

/* ==========================================================================
 * Session manager
 * ======================================================================== */

/**
 * Owns the authoritative experiment session.
 *
 * Important:
 * A navigation, page reload, SPA transition or newly opened tab must NOT
 * create a new experiment session while this manager has an active session.
 *
 * Page/tab identity will be managed separately by TabManager and page
 * lifecycle modules.
 */
export class SessionManager {
  private activeSession: SessionRecord | null = null;

  private lastCompletedSession: SessionRecord | null = null;

  /**
   * Starts one experiment session.
   *
   * Only one authoritative experiment session may be active at a time.
   */
  public startSession(
    input: SessionStartInput,
    startedAtEpochMs: EpochMs = Date.now()
  ): SessionStartResult {
    if (this.activeSession !== null) {
      logger.warn(
        "Attempted to start a session while another session is active.",
        {
          activeSessionId: this.activeSession.sessionId
        }
      );

      return {
        ok: false,
        reason: "SESSION_ALREADY_ACTIVE",
        activeSession: cloneSessionRecord(
          this.activeSession
        )
      };
    }

    const participantId =
      input.participantId.trim();

    if (participantId.length === 0) {
      logger.warn(
        "Session start rejected because participant ID is empty."
      );

      return {
        ok: false,
        reason: "INVALID_PARTICIPANT_ID",
        activeSession: null
      };
    }

    const session: SessionRecord = {
      sessionId: createSessionId(),

      participantId,
      projectId: input.projectId ?? null,

      startedAtEpochMs,
      endedAtEpochMs: null,

      durationMs: null,

      extensionVersion:
        getExtensionVersion(),

      schemaVersion:
        SCHEMA_VERSION,

      trackerVersion:
        TRACKER_VERSION,

      gazeEngine:
        input.gazeEngine,

      browser: {
        ...input.browser
      },

      screen: {
        ...input.screen
      },

      camera: null,

      calibrationProfileId: null
    };

    this.activeSession = session;

    logger.info(
      "Experiment session started.",
      {
        sessionId: session.sessionId,
        gazeEngine: session.gazeEngine
      }
    );

    return {
      ok: true,
      session: cloneSessionRecord(session)
    };
  }

  /**
   * Ends the currently active experiment session.
   */
  public endSession(
    endedAtEpochMs: EpochMs = Date.now()
  ): SessionEndResult {
    if (this.activeSession === null) {
      logger.warn(
        "Attempted to end a session when no session is active."
      );

      return {
        ok: false,
        reason: "SESSION_NOT_ACTIVE"
      };
    }

    const safeEndedAt =
      Math.max(
        endedAtEpochMs,
        this.activeSession.startedAtEpochMs
      );

    const completedSession: SessionRecord = {
      ...this.activeSession,

      endedAtEpochMs: safeEndedAt,

      durationMs:
        safeEndedAt
        - this.activeSession.startedAtEpochMs
    };

    this.lastCompletedSession =
      completedSession;

    this.activeSession = null;

    logger.info(
      "Experiment session ended.",
      {
        sessionId:
          completedSession.sessionId,

        durationMs:
          completedSession.durationMs
      }
    );

    return {
      ok: true,
      session:
        cloneSessionRecord(completedSession)
    };
  }

  /**
   * Returns whether a research session is currently active.
   */
  public hasActiveSession(): boolean {
    return this.activeSession !== null;
  }

  /**
   * Returns a safe copy of the current session.
   */
  public getActiveSession(): SessionRecord | null {
    if (this.activeSession === null) {
      return null;
    }

    return cloneSessionRecord(
      this.activeSession
    );
  }

  /**
   * Returns only the active session ID.
   *
   * This is useful for associating newly opened tabs/pages with the
   * existing experiment session.
   */
  public getActiveSessionId(): SessionId | null {
    return (
      this.activeSession?.sessionId
      ?? null
    );
  }

  /**
   * Returns the most recently completed session.
   *
   * This is useful immediately after STOPPING/COMPLETED for storage/export.
   */
  public getLastCompletedSession(): SessionRecord | null {
    if (this.lastCompletedSession === null) {
      return null;
    }

    return cloneSessionRecord(
      this.lastCompletedSession
    );
  }

  /**
   * Stores the actual camera settings after getUserMedia succeeds.
   *
   * Requested constraints and actual camera settings may differ,
   * therefore this must use MediaStreamTrack.getSettings()-derived data.
   */
  public setCameraSettings(
    settings: CameraSettings
  ): SessionUpdateResult {
    if (this.activeSession === null) {
      return {
        ok: false,
        reason: "SESSION_NOT_ACTIVE"
      };
    }

    this.activeSession = {
      ...this.activeSession,

      camera: {
        ...settings
      }
    };

    logger.info(
      "Session camera settings updated.",
      {
        sessionId:
          this.activeSession.sessionId,

        width:
          settings.width,

        height:
          settings.height,

        frameRate:
          settings.frameRate
      }
    );

    return {
      ok: true,
      session:
        cloneSessionRecord(
          this.activeSession
        )
    };
  }

  /**
   * Associates a successful calibration profile with the active session.
   */
  public setCalibrationProfile(
    profileId: CalibrationProfileId
  ): SessionUpdateResult {
    if (this.activeSession === null) {
      return {
        ok: false,
        reason: "SESSION_NOT_ACTIVE"
      };
    }

    this.activeSession = {
      ...this.activeSession,

      calibrationProfileId:
        profileId
    };

    logger.info(
      "Calibration profile associated with session.",
      {
        sessionId:
          this.activeSession.sessionId,

        calibrationProfileId:
          profileId
      }
    );

    return {
      ok: true,
      session:
        cloneSessionRecord(
          this.activeSession
        )
    };
  }
}

/* ==========================================================================
 * Shared background instance
 * ======================================================================== */

/**
 * The background service worker should use this single instance as the
 * authoritative session manager.
 *
 * Note:
 * MV3 service workers may be suspended by Chrome.
 * Persistent restoration will later be connected to the storage layer.
 */
export const sessionManager =
  new SessionManager();