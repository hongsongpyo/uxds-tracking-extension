import {
  createPageId
} from "../shared/utils";

import {
  NAVIGATION
} from "../shared/constants";

import {
  createLogger
} from "../shared/logger";

import type {
  EpochMs,
  PageId,
  SessionId
} from "../shared/types";

/* ==========================================================================
 * Logger
 * ======================================================================== */

const logger = createLogger("BACKGROUND");

/* ==========================================================================
 * Input types
 * ======================================================================== */

/**
 * Browser-independent representation of a newly created/existing tab.
 *
 * Chrome-specific event objects are converted into this structure by
 * serviceWorker.ts before they reach TabManager.
 */
export interface TabDescriptor {
  tabId: number;
  windowId: number;

  openerTabId: number | null;

  url: string | null;

  active: boolean;
}

export interface TabUpdateInput {
  tabId: number;

  windowId: number | null;

  url: string | null;

  active: boolean | null;
}

export interface TabActivationInput {
  tabId: number;
  windowId: number;
}

/**
 * Main-frame navigation committed by chrome.webNavigation.
 *
 * documentId is unique to a document in supported Chrome versions.
 */
export interface NavigationCommittedInput {
  tabId: number;

  frameId: number;

  documentId: string;

  url: string;

  timestampEpochMs: EpochMs;
}

/**
 * SPA/history API route transition.
 *
 * This may retain the same documentId while the logical application page
 * changes.
 */
export interface HistoryStateUpdatedInput {
  tabId: number;

  frameId: number;

  documentId: string;

  url: string;

  timestampEpochMs: EpochMs;
}

/* ==========================================================================
 * Association types
 * ======================================================================== */

export type TabAssociationReason =
  | "INITIAL"
  | "OPENER"
  | "PENDING_OPENER"
  | "EXPLICIT";

export interface TrackedTabState {
  sessionId: SessionId;

  tabId: number;
  windowId: number;

  openerTabId: number | null;

  currentPageId: PageId;

  currentDocumentId: string | null;

  url: string | null;

  active: boolean;

  associationReason: TabAssociationReason;

  associatedAtEpochMs: EpochMs;

  pageStartedAtEpochMs: EpochMs;
}

interface PendingTabAssociation {
  tab: TabDescriptor;

  expectedSessionId: SessionId;

  createdAtEpochMs: EpochMs;
}

/* ==========================================================================
 * Operation results
 * ======================================================================== */

export interface TabAssociationSuccess {
  ok: true;

  association: TrackedTabState;
}

export interface TabAssociationFailure {
  ok: false;

  reason:
    | "INVALID_TAB_ID"
    | "TAB_ALREADY_TRACKED"
    | "NO_ACTIVE_SESSION"
    | "OPENER_NOT_TRACKED";
}

export type TabAssociationResult =
  | TabAssociationSuccess
  | TabAssociationFailure;

export interface PageTransitionSuccess {
  ok: true;

  changed: boolean;

  previousPageId: PageId | null;

  association: TrackedTabState;
}

export interface PageTransitionFailure {
  ok: false;

  reason:
    | "TAB_NOT_TRACKED"
    | "NOT_MAIN_FRAME";
}

export type PageTransitionResult =
  | PageTransitionSuccess
  | PageTransitionFailure;

/* ==========================================================================
 * Internal helpers
 * ======================================================================== */


function cloneTrackedTabState(
  state: TrackedTabState
): TrackedTabState {
  return {
    ...state
  };
}

function isValidTabId(
  tabId: number
): boolean {
  return (
    Number.isInteger(tabId)
    && tabId >= 0
  );
}

/* ==========================================================================
 * Tab manager
 * ======================================================================== */

/**
 * Tracks which browser tabs belong to the current experiment session.
 *
 * Important design rule:
 *
 * TabManager NEVER creates a new experiment session.
 *
 * Session creation is exclusively SessionManager's responsibility.
 * A new browser tab may inherit an existing session, but it may not create
 * one.
 */
export class TabManager {
  private readonly trackedTabs =
    new Map<number, TrackedTabState>();

  /**
   * Handles a short race where a child tab may be observed before its opener
   * has been restored/associated in the service worker.
   */
  private readonly pendingTabs =
    new Map<number, PendingTabAssociation>();

  /* ========================================================================
   * Explicit association
   * ====================================================================== */

  /**
   * Associates the initial research tab with an existing experiment session.
   *
   * This should normally be called once recording/tracking starts.
   */
  public associateInitialTab(
    tab: TabDescriptor,
    sessionId: SessionId,
    timestampEpochMs: EpochMs = Date.now()
  ): TabAssociationResult {
    return this.associateTab(
      tab,
      sessionId,
      "INITIAL",
      timestampEpochMs
    );
  }

  /**
   * Explicit association for restoration or controlled recovery.
   */
  public associateExplicitTab(
    tab: TabDescriptor,
    sessionId: SessionId,
    timestampEpochMs: EpochMs = Date.now()
  ): TabAssociationResult {
    return this.associateTab(
      tab,
      sessionId,
      "EXPLICIT",
      timestampEpochMs
    );
  }

  /* ========================================================================
   * New tab
   * ====================================================================== */

  /**
   * Handles a newly created browser tab.
   *
   * A new tab is automatically associated ONLY when:
   *
   * 1. an experiment session is active,
   * 2. the new tab has openerTabId,
   * 3. the opener tab already belongs to that same session.
   *
   * This prevents unrelated tabs opened by the participant from being
   * silently attached to the experiment.
   */
  public handleTabCreated(
    tab: TabDescriptor,
    activeSessionId: SessionId | null,
    timestampEpochMs: EpochMs = Date.now()
  ): TabAssociationResult {
    this.cleanupExpiredPendingTabs(
      timestampEpochMs
    );

    if (!isValidTabId(tab.tabId)) {
      return {
        ok: false,
        reason: "INVALID_TAB_ID"
      };
    }

    if (this.trackedTabs.has(tab.tabId)) {
      return {
        ok: false,
        reason: "TAB_ALREADY_TRACKED"
      };
    }

    if (activeSessionId === null) {
      return {
        ok: false,
        reason: "NO_ACTIVE_SESSION"
      };
    }

    if (tab.openerTabId === null) {
      return {
        ok: false,
        reason: "OPENER_NOT_TRACKED"
      };
    }

    const opener =
      this.trackedTabs.get(
        tab.openerTabId
      );

    if (
      opener !== undefined
      && opener.sessionId === activeSessionId
    ) {
      return this.associateTab(
        tab,
        activeSessionId,
        "OPENER",
        timestampEpochMs
      );
    }

    /**
     * Keep the association request briefly in case service-worker restoration
     * causes the opener relationship to arrive out of order.
     */
    this.pendingTabs.set(
      tab.tabId,
      {
        tab: {
          ...tab
        },

        expectedSessionId:
          activeSessionId,

        createdAtEpochMs:
          timestampEpochMs
      }
    );

    logger.debug(
      "New tab is waiting for opener association.",
      {
        tabId:
          tab.tabId,

        openerTabId:
          tab.openerTabId,

        sessionId:
          activeSessionId
      }
    );

    return {
      ok: false,
      reason: "OPENER_NOT_TRACKED"
    };
  }

  /* ========================================================================
   * Tab updates
   * ====================================================================== */

  /**
   * Updates URL/window/active metadata for an already tracked tab.
   *
   * This method does not create a new page ID.
   * Page identity changes are driven by webNavigation events.
   */
  public handleTabUpdated(
    input: TabUpdateInput
  ): TrackedTabState | null {
    const existing =
      this.trackedTabs.get(
        input.tabId
      );

    if (existing === undefined) {
      return null;
    }

    const next: TrackedTabState = {
      ...existing,

      windowId:
        input.windowId
        ?? existing.windowId,

      url:
        input.url
        ?? existing.url,

      active:
        input.active
        ?? existing.active
    };

    this.trackedTabs.set(
      input.tabId,
      next
    );

    return cloneTrackedTabState(next);
  }

  /* ========================================================================
   * Active tab
   * ====================================================================== */

  /**
   * Updates active-tab state inside one browser window.
   */
  public handleTabActivated(
    input: TabActivationInput
  ): TrackedTabState | null {
    let activated:
      TrackedTabState
      | null = null;

    for (
      const [tabId, state]
      of this.trackedTabs
    ) {
      if (
        state.windowId
        !== input.windowId
      ) {
        continue;
      }

      const shouldBeActive =
        tabId === input.tabId;

      if (
        state.active
        === shouldBeActive
      ) {
        if (shouldBeActive) {
          activated =
            cloneTrackedTabState(state);
        }

        continue;
      }

      const updated: TrackedTabState = {
        ...state,
        active: shouldBeActive
      };

      this.trackedTabs.set(
        tabId,
        updated
      );

      if (shouldBeActive) {
        activated =
          cloneTrackedTabState(updated);
      }
    }

    return activated;
  }

  /* ========================================================================
   * Full-page navigation
   * ====================================================================== */

  /**
   * Handles a committed main-frame navigation.
   *
   * A new document means a new pageId, but the sessionId stays unchanged.
   */
  public handleNavigationCommitted(
    input: NavigationCommittedInput
  ): PageTransitionResult {
    if (input.frameId !== 0) {
      return {
        ok: false,
        reason: "NOT_MAIN_FRAME"
      };
    }

    const existing =
      this.trackedTabs.get(
        input.tabId
      );

    if (existing === undefined) {
      return {
        ok: false,
        reason: "TAB_NOT_TRACKED"
      };
    }

    /**
     * Duplicate onCommitted signal for the exact same document.
     */
    if (
      existing.currentDocumentId
        === input.documentId
      && existing.url
        === input.url
    ) {
      return {
        ok: true,
        changed: false,
        previousPageId:
          existing.currentPageId,

        association:
          cloneTrackedTabState(existing)
      };
    }

    const previousPageId =
      existing.currentPageId;

    const next: TrackedTabState = {
      ...existing,

      currentPageId:
        createPageId(),

      currentDocumentId:
        input.documentId,

      url:
        input.url,

      pageStartedAtEpochMs:
        input.timestampEpochMs
    };

    this.trackedTabs.set(
      input.tabId,
      next
    );

    logger.info(
      "Tracked tab committed a new document.",
      {
        sessionId:
          next.sessionId,

        tabId:
          next.tabId,

        previousPageId,

        pageId:
          next.currentPageId,

        url:
          next.url
      }
    );

    return {
      ok: true,
      changed: true,

      previousPageId,

      association:
        cloneTrackedTabState(next)
    };
  }

  /* ========================================================================
   * SPA navigation
   * ====================================================================== */

  /**
   * Handles History API route changes.
   *
   * A SPA may keep the same documentId while presenting a logically new page.
   * Therefore an actual URL change receives a new pageId.
   */
  public handleHistoryStateUpdated(
    input: HistoryStateUpdatedInput
  ): PageTransitionResult {
    if (input.frameId !== 0) {
      return {
        ok: false,
        reason: "NOT_MAIN_FRAME"
      };
    }

    const existing =
      this.trackedTabs.get(
        input.tabId
      );

    if (existing === undefined) {
      return {
        ok: false,
        reason: "TAB_NOT_TRACKED"
      };
    }

    if (existing.url === input.url) {
      return {
        ok: true,
        changed: false,

        previousPageId:
          existing.currentPageId,

        association:
          cloneTrackedTabState(existing)
      };
    }

    const previousPageId =
      existing.currentPageId;

    const next: TrackedTabState = {
      ...existing,

      currentPageId:
        createPageId(),

      currentDocumentId:
        input.documentId,

      url:
        input.url,

      pageStartedAtEpochMs:
        input.timestampEpochMs
    };

    this.trackedTabs.set(
      input.tabId,
      next
    );

    logger.info(
      "Tracked tab changed SPA route.",
      {
        sessionId:
          next.sessionId,

        tabId:
          next.tabId,

        previousPageId,

        pageId:
          next.currentPageId,

        url:
          next.url
      }
    );

    return {
      ok: true,
      changed: true,

      previousPageId,

      association:
        cloneTrackedTabState(next)
    };
  }

  /* ========================================================================
   * Tab removal
   * ====================================================================== */

  /**
   * Removes a closed tab from runtime tracking.
   *
   * Closing one tab does NOT end the experiment session.
   */
  public handleTabRemoved(
    tabId: number
  ): TrackedTabState | null {
    this.pendingTabs.delete(tabId);

    const existing =
      this.trackedTabs.get(tabId);

    if (existing === undefined) {
      return null;
    }

    this.trackedTabs.delete(tabId);

    logger.info(
      "Tracked tab removed.",
      {
        sessionId:
          existing.sessionId,

        tabId:
          existing.tabId
      }
    );

    return cloneTrackedTabState(existing);
  }

  /* ========================================================================
   * Queries
   * ====================================================================== */

  public isTrackedTab(
    tabId: number
  ): boolean {
    return this.trackedTabs.has(tabId);
  }

  public getTab(
    tabId: number
  ): TrackedTabState | null {
    const state =
      this.trackedTabs.get(tabId);

    if (state === undefined) {
      return null;
    }

    return cloneTrackedTabState(state);
  }

  public getTrackedTabsForSession(
    sessionId: SessionId
  ): readonly TrackedTabState[] {
    const result:
      TrackedTabState[] = [];

    for (
      const state
      of this.trackedTabs.values()
    ) {
      if (
        state.sessionId
        !== sessionId
      ) {
        continue;
      }

      result.push(
        cloneTrackedTabState(state)
      );
    }

    return result;
  }

  /**
   * Returns the active tracked tab in a window, if one exists.
   */
  public getActiveTrackedTab(
    windowId: number
  ): TrackedTabState | null {
    for (
      const state
      of this.trackedTabs.values()
    ) {
      if (
        state.windowId === windowId
        && state.active
      ) {
        return cloneTrackedTabState(
          state
        );
      }
    }

    return null;
  }

  /* ========================================================================
   * Session cleanup
   * ====================================================================== */

  /**
   * Called only when an experiment session is actually finished.
   *
   * Navigation or tab switches must NOT call this.
   */
  public clearSession(
    sessionId: SessionId
  ): void {
    for (
      const [tabId, state]
      of this.trackedTabs
    ) {
      if (
        state.sessionId
        === sessionId
      ) {
        this.trackedTabs.delete(
          tabId
        );
      }
    }

    for (
      const [tabId, pending]
      of this.pendingTabs
    ) {
      if (
        pending.expectedSessionId
        === sessionId
      ) {
        this.pendingTabs.delete(
          tabId
        );
      }
    }

    logger.info(
      "Tab associations cleared for completed session.",
      {
        sessionId
      }
    );
  }

  /* ========================================================================
   * Internal association
   * ====================================================================== */

  private associateTab(
    tab: TabDescriptor,
    sessionId: SessionId,
    reason: TabAssociationReason,
    timestampEpochMs: EpochMs
  ): TabAssociationResult {
    if (!isValidTabId(tab.tabId)) {
      return {
        ok: false,
        reason: "INVALID_TAB_ID"
      };
    }

    if (this.trackedTabs.has(tab.tabId)) {
      return {
        ok: false,
        reason: "TAB_ALREADY_TRACKED"
      };
    }

    const state: TrackedTabState = {
      sessionId,

      tabId:
        tab.tabId,

      windowId:
        tab.windowId,

      openerTabId:
        tab.openerTabId,

      currentPageId:
        createPageId(),

      currentDocumentId:
        null,

      url:
        tab.url,

      active:
        tab.active,

      associationReason:
        reason,

      associatedAtEpochMs:
        timestampEpochMs,

      pageStartedAtEpochMs:
        timestampEpochMs
    };

    this.trackedTabs.set(
      tab.tabId,
      state
    );

    this.pendingTabs.delete(
      tab.tabId
    );

    logger.info(
      "Tab associated with experiment session.",
      {
        sessionId,

        tabId:
          tab.tabId,

        openerTabId:
          tab.openerTabId,

        reason
      }
    );

    this.resolvePendingChildren(
      tab.tabId,
      sessionId,
      timestampEpochMs
    );

    return {
      ok: true,
      association:
        cloneTrackedTabState(state)
    };
  }

  /* ========================================================================
   * Pending opener association
   * ====================================================================== */

  private resolvePendingChildren(
    openerTabId: number,
    sessionId: SessionId,
    timestampEpochMs: EpochMs
  ): void {
    this.cleanupExpiredPendingTabs(
      timestampEpochMs
    );

    const pendingMatches:
      PendingTabAssociation[] = [];

    for (
      const pending
      of this.pendingTabs.values()
    ) {
      if (
        pending.tab.openerTabId
          !== openerTabId
      ) {
        continue;
      }

      if (
        pending.expectedSessionId
          !== sessionId
      ) {
        continue;
      }

      pendingMatches.push(pending);
    }

    for (
      const pending
      of pendingMatches
    ) {
      this.associateTab(
        pending.tab,
        sessionId,
        "PENDING_OPENER",
        timestampEpochMs
      );
    }
  }

  private cleanupExpiredPendingTabs(
    nowEpochMs: EpochMs
  ): void {
    for (
      const [tabId, pending]
      of this.pendingTabs
    ) {
      const ageMs =
        nowEpochMs
        - pending.createdAtEpochMs;

      if (
        ageMs
        <= NAVIGATION.TAB_ASSOCIATION_TTL_MS
      ) {
        continue;
      }

      this.pendingTabs.delete(tabId);

      logger.debug(
        "Expired pending tab association removed.",
        {
          tabId,

          openerTabId:
            pending.tab.openerTabId
        }
      );
    }
  }
}

/* ==========================================================================
 * Shared background instance
 * ======================================================================== */

export const tabManager =
  new TabManager();