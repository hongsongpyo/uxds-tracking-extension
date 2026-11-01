import {
  GAZE_OVERLAY
} from "../shared/constants";

import {
  isFiniteNumber
} from "../shared/utils";

import type {
  Point2D
} from "../shared/types";

const GAZE_OVERLAY_HOST_ID =
  "etc-gaze-overlay";

/**
 * Display-only gaze cursor rendered on top of the research page.
 *
 * The overlay consumes the already stabilized normalized gaze point routed to
 * Content for AOI processing. It does not feed any value back into the gaze
 * pipeline and therefore cannot change calibration, AOI assignment or stored
 * research data.
 */
export class GazeOverlay {
  private enabled: boolean =
    GAZE_OVERLAY.DEFAULT_ENABLED;

  private temporarilySuppressed = false;

  private host:
    HTMLDivElement | null = null;

  private marker:
    HTMLDivElement | null = null;

  private currentViewportPoint:
    Point2D | null = null;

  private staleHideTimerId:
    number | null = null;

  private disposed = false;

  constructor() {
    chrome.storage.onChanged.addListener(
      this.handleStorageChanged
    );

    void this.loadPreference();
  }

  setTemporarilySuppressed(
    suppressed: boolean
  ): void {
    this.temporarilySuppressed =
      suppressed;

    if (suppressed) {
      this.hide();
    }
  }

  updateNormalizedPoint(
    point: Point2D | null
  ): void {
    if (
      this.disposed
      || !this.enabled
      || this.temporarilySuppressed
    ) {
      return;
    }

    if (
      point === null
      || !isFiniteNumber(point.x)
      || !isFiniteNumber(point.y)
      || window.innerWidth <= 0
      || window.innerHeight <= 0
    ) {
      this.scheduleStaleHide();
      return;
    }

    const targetPoint = {
      x: point.x * window.innerWidth,
      y: point.y * window.innerHeight
    };

    const previousPoint =
      this.currentViewportPoint;

    const nextPoint =
      previousPoint === null
        ? targetPoint
        : {
            x:
              previousPoint.x
              + (
                targetPoint.x
                - previousPoint.x
              )
              * GAZE_OVERLAY.SMOOTHING_ALPHA,
            y:
              previousPoint.y
              + (
                targetPoint.y
                - previousPoint.y
              )
              * GAZE_OVERLAY.SMOOTHING_ALPHA
          };

    this.currentViewportPoint =
      nextPoint;

    const marker =
      this.ensureMounted();

    if (marker === null) {
      this.scheduleStaleHide();
      return;
    }

    const radius =
      GAZE_OVERLAY.DIAMETER_PX / 2;

    marker.style.transform =
      `translate3d(${nextPoint.x - radius}px, ${nextPoint.y - radius}px, 0)`;

    marker.style.opacity = "1";

    this.scheduleStaleHide();
  }

  hide(): void {
    this.clearStaleHideTimer();
    this.currentViewportPoint = null;

    if (this.marker !== null) {
      this.marker.style.opacity = "0";
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    chrome.storage.onChanged.removeListener(
      this.handleStorageChanged
    );

    this.clearStaleHideTimer();
    this.host?.remove();
    this.host = null;
    this.marker = null;
    this.currentViewportPoint = null;
  }

  private readonly handleStorageChanged = (
    changes: {
      [key: string]: chrome.storage.StorageChange;
    },
    areaName: string
  ): void => {
    if (
      areaName !== "local"
      || !(GAZE_OVERLAY.STORAGE_KEY in changes)
    ) {
      return;
    }

    const nextValue =
      changes[GAZE_OVERLAY.STORAGE_KEY]
        ?.newValue;

    this.setEnabled(
      typeof nextValue === "boolean"
        ? nextValue
        : GAZE_OVERLAY.DEFAULT_ENABLED
    );
  };

  private async loadPreference():
  Promise<void> {
    try {
      const stored =
        await chrome.storage.local.get(
          GAZE_OVERLAY.STORAGE_KEY
        );

      const value =
        stored[GAZE_OVERLAY.STORAGE_KEY];

      this.setEnabled(
        typeof value === "boolean"
          ? value
          : GAZE_OVERLAY.DEFAULT_ENABLED
      );
    } catch {
      this.setEnabled(
        GAZE_OVERLAY.DEFAULT_ENABLED
      );
    }
  }

  private setEnabled(
    enabled: boolean
  ): void {
    this.enabled = enabled;

    if (!enabled) {
      this.hide();
    }
  }

  private ensureMounted():
  HTMLDivElement | null {
    if (this.marker !== null) {
      return this.marker;
    }

    const root =
      document.documentElement;

    if (root === null) {
      return null;
    }

    const host =
      document.createElement("div");

    host.id = GAZE_OVERLAY_HOST_ID;
    host.setAttribute(
      "aria-hidden",
      "true"
    );

    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex =
      String(GAZE_OVERLAY.Z_INDEX);

    const shadowRoot =
      host.attachShadow({ mode: "closed" });

    const style =
      document.createElement("style");

    style.textContent = `
      .gaze-marker {
        position: fixed;
        left: 0;
        top: 0;
        width: ${GAZE_OVERLAY.DIAMETER_PX}px;
        height: ${GAZE_OVERLAY.DIAMETER_PX}px;
        box-sizing: border-box;
        border: 2px solid rgba(20, 126, 255, 0.82);
        border-radius: 50%;
        background: rgba(20, 126, 255, 0.10);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.58),
          0 2px 12px rgba(0, 0, 0, 0.14);
        opacity: 0;
        pointer-events: none;
        will-change: transform, opacity;
        transition: opacity 70ms linear;
      }
    `;

    const marker =
      document.createElement("div");

    marker.className = "gaze-marker";

    shadowRoot.append(
      style,
      marker
    );

    root.append(host);

    this.host = host;
    this.marker = marker;

    return marker;
  }

  private scheduleStaleHide(): void {
    this.clearStaleHideTimer();

    this.staleHideTimerId =
      window.setTimeout(
        () => {
          this.staleHideTimerId = null;
          this.currentViewportPoint = null;

          if (this.marker !== null) {
            this.marker.style.opacity = "0";
          }
        },
        GAZE_OVERLAY.STALE_HIDE_DELAY_MS
      );
  }

  private clearStaleHideTimer(): void {
    if (this.staleHideTimerId === null) {
      return;
    }

    window.clearTimeout(
      this.staleHideTimerId
    );

    this.staleHideTimerId = null;
  }
}
