import {
  PAGE_TRACKING
} from "../shared/constants";

import {
  nowEpochMs,
  nowTimelineMs
} from "../shared/utils";

import type {
  PageCoordinateSnapshot,
  Point2D,
  ScrollDirection,
  ScrollEventRecord,
  ScrollPhase
} from "../shared/types";

export interface PageCoordinateTrackerContext {
  readonly sessionId: string;
  readonly pageId: string;
  readonly tabId: number;
  readonly browserFrameId: number;
}

export type ScrollRecordSink = (
  event: ScrollEventRecord
) => void;

function finiteOrZero(
  value: number
): number {
  return Number.isFinite(value)
    ? value
    : 0;
}

function getDocumentSize(): {
  width: number;
  height: number;
} {
  const documentElement =
    document.documentElement;

  const body = document.body;

  return {
    width: Math.max(
      documentElement?.scrollWidth ?? 0,
      documentElement?.clientWidth ?? 0,
      body?.scrollWidth ?? 0,
      body?.clientWidth ?? 0,
      window.innerWidth
    ),
    height: Math.max(
      documentElement?.scrollHeight ?? 0,
      documentElement?.clientHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.clientHeight ?? 0,
      window.innerHeight
    )
  };
}

export function remapNormalizedPointToViewport(
  normalizedPoint: Point2D,
  viewportWidth: number,
  viewportHeight: number
): Point2D {
  return {
    x: normalizedPoint.x * viewportWidth,
    y: normalizedPoint.y * viewportHeight
  };
}

export function classifyScrollDirection(
  deltaX: number,
  deltaY: number
): ScrollDirection {
  if (deltaX === 0 && deltaY === 0) {
    return "NONE";
  }

  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY > 0
      ? "DOWN"
      : "UP";
  }

  return deltaX > 0
    ? "RIGHT"
    : "LEFT";
}

export function capturePageCoordinateSnapshot(
  viewportPoint: Point2D
): PageCoordinateSnapshot {
  const scrollX = finiteOrZero(window.scrollX);
  const scrollY = finiteOrZero(window.scrollY);

  const viewportWidth = Math.max(
    0,
    finiteOrZero(window.innerWidth)
  );

  const viewportHeight = Math.max(
    0,
    finiteOrZero(window.innerHeight)
  );

  const documentSize = getDocumentSize();

  return {
    capturedAtEpochMs: nowEpochMs(),
    url: window.location.href,
    origin: window.location.origin,
    viewportPoint: {
      x: viewportPoint.x,
      y: viewportPoint.y
    },
    documentPoint: {
      x: viewportPoint.x + scrollX,
      y: viewportPoint.y + scrollY
    },
    insideViewport:
      viewportPoint.x >= 0
      && viewportPoint.y >= 0
      && viewportPoint.x <= viewportWidth
      && viewportPoint.y <= viewportHeight,
    viewportWidth,
    viewportHeight,
    documentWidth: documentSize.width,
    documentHeight: documentSize.height,
    scrollX,
    scrollY,
    devicePixelRatio: Math.max(
      0,
      finiteOrZero(window.devicePixelRatio)
    )
  };
}

/**
 * Main-frame scroll tracker used by D24.
 *
 * The tracker is intentionally dormant until Background supplies an
 * authoritative session/page identity through the first live AOI probe. This
 * avoids creating page events that cannot be attributed to an experiment.
 */
export class PageCoordinateTracker {
  private context:
    PageCoordinateTrackerContext | null =
      null;

  private lastScrollX = 0;
  private lastScrollY = 0;
  private lastEventAtMs:
    number | null = null;

  private scrolling = false;

  private scrollFrameId:
    number | null = null;

  private scrollEndTimerId:
    number | null = null;

  private disposed = false;

  public constructor(
    private readonly onScrollRecord:
      ScrollRecordSink
  ) {
    window.addEventListener(
      "scroll",
      this.handleNativeScroll,
      { passive: true }
    );
  }

  public activate(
    context: PageCoordinateTrackerContext
  ): void {
    if (this.disposed) {
      return;
    }

    const changed =
      this.context === null
      || this.context.sessionId !== context.sessionId
      || this.context.pageId !== context.pageId
      || this.context.tabId !== context.tabId
      || this.context.browserFrameId
        !== context.browserFrameId;

    this.context = {
      ...context
    };

    if (!changed) {
      return;
    }

    this.cancelPendingScrollWork();

    this.lastScrollX = finiteOrZero(window.scrollX);
    this.lastScrollY = finiteOrZero(window.scrollY);
    this.lastEventAtMs = null;
    this.scrolling = false;
  }

  public capture(
    viewportPoint: Point2D
  ): PageCoordinateSnapshot {
    return capturePageCoordinateSnapshot(
      viewportPoint
    );
  }

  /** Clears the active experiment attribution while keeping listeners reusable. */
  public deactivate(): void {
    if (this.disposed) {
      return;
    }

    this.cancelPendingScrollWork();
    this.context = null;
    this.lastEventAtMs = null;
    this.scrolling = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    this.cancelPendingScrollWork();

    window.removeEventListener(
      "scroll",
      this.handleNativeScroll
    );

    this.context = null;
  }

  private readonly handleNativeScroll =
    (): void => {
      if (
        this.disposed
        || this.context === null
        || this.scrollFrameId !== null
      ) {
        return;
      }

      this.scrollFrameId =
        window.requestAnimationFrame(
          () => {
            this.scrollFrameId = null;
            this.flushScrollFrame();
          }
        );
    };

  private flushScrollFrame(): void {
    const context = this.context;

    if (
      this.disposed
      || context === null
    ) {
      return;
    }

    const now = nowTimelineMs();
    const scrollX = finiteOrZero(window.scrollX);
    const scrollY = finiteOrZero(window.scrollY);

    const deltaX = scrollX - this.lastScrollX;
    const deltaY = scrollY - this.lastScrollY;

    if (deltaX === 0 && deltaY === 0) {
      this.scheduleScrollEnd();
      return;
    }

    const elapsedMs =
      this.lastEventAtMs === null
        ? 0
        : Math.max(
            0,
            now - this.lastEventAtMs
          );

    const phase: ScrollPhase =
      this.scrolling
        ? "MOVE"
        : "START";

    const distance = Math.hypot(
      deltaX,
      deltaY
    );

    const velocityPxPerMs =
      elapsedMs > 0
        ? distance / elapsedMs
        : 0;

    this.onScrollRecord({
      timestampMs: now,
      sessionId: context.sessionId,
      pageId: context.pageId,
      scrollX,
      scrollY,
      deltaX,
      deltaY,
      velocityPxPerMs,
      direction: classifyScrollDirection(
        deltaX,
        deltaY
      ),
      phase,
      tabId: context.tabId,
      browserFrameId:
        context.browserFrameId
    });

    this.scrolling = true;
    this.lastScrollX = scrollX;
    this.lastScrollY = scrollY;
    this.lastEventAtMs = now;

    this.scheduleScrollEnd();
  }

  private scheduleScrollEnd(): void {
    if (this.scrollEndTimerId !== null) {
      window.clearTimeout(
        this.scrollEndTimerId
      );
    }

    this.scrollEndTimerId =
      window.setTimeout(
        () => {
          this.scrollEndTimerId = null;
          this.emitScrollEnd();
        },
        PAGE_TRACKING.SCROLL_END_IDLE_MS
      );
  }

  private emitScrollEnd(): void {
    const context = this.context;

    if (
      !this.scrolling
      || context === null
    ) {
      return;
    }

    const now = nowTimelineMs();
    const scrollX = finiteOrZero(window.scrollX);
    const scrollY = finiteOrZero(window.scrollY);

    this.onScrollRecord({
      timestampMs: now,
      sessionId: context.sessionId,
      pageId: context.pageId,
      scrollX,
      scrollY,
      deltaX: 0,
      deltaY: 0,
      velocityPxPerMs: 0,
      direction: "NONE",
      phase: "END",
      tabId: context.tabId,
      browserFrameId:
        context.browserFrameId
    });

    this.lastScrollX = scrollX;
    this.lastScrollY = scrollY;
    this.lastEventAtMs = now;
    this.scrolling = false;
  }

  private cancelPendingScrollWork(): void {
    if (this.scrollFrameId !== null) {
      window.cancelAnimationFrame(
        this.scrollFrameId
      );

      this.scrollFrameId = null;
    }

    if (this.scrollEndTimerId !== null) {
      window.clearTimeout(
        this.scrollEndTimerId
      );

      this.scrollEndTimerId = null;
    }
  }
}
