import type {
  FacePositionInstruction,
  PreCalibrationFeedback
} from "../shared/types";

/* ========================================================================== 
 * Static copy
 * ======================================================================== */

const INSTRUCTION_TEXT:
  Readonly<Record<FacePositionInstruction, string>> = {
    FIND_FACE:
      "카메라가 얼굴을 찾을 수 있도록 화면 중앙을 바라봐 주세요.",

    SHOW_BOTH_EYES:
      "양쪽 눈이 모두 보이도록 얼굴과 안경/머리카락 위치를 조정해 주세요.",

    MOVE_CLOSER:
      "카메라에 조금 더 가까이 이동해 주세요.",

    MOVE_FARTHER:
      "카메라에서 조금 더 멀리 이동해 주세요.",

    MOVE_LEFT:
      "얼굴을 화면 기준 왼쪽으로 조금 이동해 주세요.",

    MOVE_RIGHT:
      "얼굴을 화면 기준 오른쪽으로 조금 이동해 주세요.",

    MOVE_UP:
      "얼굴을 화면 기준 위쪽으로 조금 이동해 주세요.",

    MOVE_DOWN:
      "얼굴을 화면 기준 아래쪽으로 조금 이동해 주세요.",

    FACE_FORWARD:
      "고개를 기울이지 말고 카메라 정면을 바라봐 주세요.",

    IMPROVE_LIGHTING:
      "얼굴이 조금 어둡습니다. 주변 조명을 밝게 해 주세요.",

    REDUCE_LIGHTING:
      "얼굴이 너무 밝습니다. 강한 역광이나 직접 조명을 줄여 주세요.",

    HOLD_STEADY:
      "좋습니다. 현재 자세를 잠시 유지해 주세요.",

    READY:
      "얼굴 위치 확인이 완료되었습니다. 캘리브레이션을 시작할 수 있습니다."
  };

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function toPercent(
  value: number
): string {
  return `${clamp(value, 0, 1) * 100}%`;
}

function formatDegrees(
  value: number | null
): string {
  if (value === null) {
    return "--";
  }

  return `${value.toFixed(1)}°`;
}

function formatBrightness(
  value: number | null
): string {
  if (value === null) {
    return "--";
  }

  return `${Math.round(value * 100)}%`;
}

/* ========================================================================== 
 * Overlay
 * ======================================================================== */

/**
 * Privacy-preserving pre-calibration UI.
 *
 * The overlay never receives webcam pixels. It visualizes only normalized
 * face geometry and transient quality metrics supplied by the Offscreen
 * runtime.
 */
export class PreCalibrationOverlay {
  private host:
    HTMLDivElement | null =
      null;

  private instructionElement:
    HTMLDivElement | null =
      null;

  private faceBoxElement:
    HTMLDivElement | null =
      null;

  private progressFillElement:
    HTMLDivElement | null =
      null;

  private progressTextElement:
    HTMLSpanElement | null =
      null;

  private faceStatusElement:
    HTMLSpanElement | null =
      null;

  private eyesStatusElement:
    HTMLSpanElement | null =
      null;

  private distanceStatusElement:
    HTMLSpanElement | null =
      null;

  private poseStatusElement:
    HTMLSpanElement | null =
      null;

  private lightingStatusElement:
    HTMLSpanElement | null =
      null;

  private poseMetricsElement:
    HTMLDivElement | null =
      null;

  private brightnessMetricsElement:
    HTMLDivElement | null =
      null;

  public render(
    feedback: PreCalibrationFeedback
  ): void {
    this.ensureMounted();

    if (
      this.host === null
      || this.instructionElement === null
      || this.faceBoxElement === null
      || this.progressFillElement === null
      || this.progressTextElement === null
      || this.faceStatusElement === null
      || this.eyesStatusElement === null
      || this.distanceStatusElement === null
      || this.poseStatusElement === null
      || this.lightingStatusElement === null
      || this.poseMetricsElement === null
      || this.brightnessMetricsElement === null
    ) {
      return;
    }

    this.host.dataset.ready =
      feedback.readyForCalibration
        ? "true"
        : "false";

    this.instructionElement.textContent =
      INSTRUCTION_TEXT[
        feedback.instruction
      ];

    this.renderFaceBox(feedback);

    const progress =
      clamp(
        feedback.metrics.stableProgress,
        0,
        1
      );

    this.progressFillElement.style.width =
      `${progress * 100}%`;

    this.progressTextElement.textContent =
      feedback.readyForCalibration
        ? "완료"
        : `${Math.round(progress * 100)}%`;

    this.setCheckStatus(
      this.faceStatusElement,
      feedback.status.faceDetected,
      "얼굴",
      "감지됨",
      "감지되지 않음"
    );

    this.setCheckStatus(
      this.eyesStatusElement,
      feedback.status.bothEyesVisible,
      "양쪽 눈",
      "확인됨",
      "확인 필요"
    );

    this.setCheckStatus(
      this.distanceStatusElement,
      feedback.status.distanceAcceptable,
      "거리",
      "적정",
      "조정 필요"
    );

    this.setCheckStatus(
      this.poseStatusElement,
      feedback.status.headPoseAcceptable,
      "머리 자세",
      "적정",
      "정면 필요"
    );

    this.setCheckStatus(
      this.lightingStatusElement,
      feedback.status.brightnessAcceptable,
      "조명",
      "적정",
      "조정 필요"
    );

    this.poseMetricsElement.textContent =
      `Yaw ${formatDegrees(feedback.metrics.yawDeg)} · `
      + `Pitch ${formatDegrees(feedback.metrics.pitchDeg)} · `
      + `Roll ${formatDegrees(feedback.metrics.rollDeg)}`;

    this.brightnessMetricsElement.textContent =
      `밝기 ${formatBrightness(feedback.metrics.brightness)}`;
  }

  public hide(): void {
    if (this.host !== null) {
      this.host.style.display =
        "none";
    }
  }

  private ensureMounted(): void {
    if (this.host !== null) {
      this.host.style.display =
        "block";

      return;
    }

    document
      .getElementById(
        "etc-precalibration-overlay-host"
      )
      ?.remove();

    const host =
      document.createElement("div");

    host.id =
      "etc-precalibration-overlay-host";

    const shadow =
      host.attachShadow({
        mode: "closed"
      });

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .etc-layer {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f7f8fa;
        }

        .etc-panel {
          position: absolute;
          top: 18px;
          left: 50%;
          width: min(420px, calc(100vw - 32px));
          transform: translateX(-50%);
          box-sizing: border-box;
          padding: 16px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 16px;
          background: rgba(18, 20, 25, 0.94);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
          backdrop-filter: blur(14px);
        }

        .etc-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .etc-title {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }

        .etc-privacy {
          color: rgba(247, 248, 250, 0.58);
          font-size: 10px;
          white-space: nowrap;
        }

        .etc-map {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          overflow: hidden;
          box-sizing: border-box;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          background:
            linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px),
            #111318;
          background-size: 25% 25%;
        }

        .etc-guide {
          position: absolute;
          left: 31%;
          top: 10%;
          width: 38%;
          height: 80%;
          box-sizing: border-box;
          border: 2px dashed rgba(255, 255, 255, 0.45);
          border-radius: 48% 48% 44% 44%;
        }

        .etc-crosshair-x,
        .etc-crosshair-y {
          position: absolute;
          background: rgba(255, 255, 255, 0.10);
        }

        .etc-crosshair-x {
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
        }

        .etc-crosshair-y {
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
        }

        .etc-face-box {
          position: absolute;
          display: none;
          box-sizing: border-box;
          min-width: 6px;
          min-height: 6px;
          border: 2px solid #f0c15b;
          border-radius: 24%;
          background: rgba(240, 193, 91, 0.07);
          transition:
            left 80ms linear,
            top 80ms linear,
            width 80ms linear,
            height 80ms linear,
            border-color 120ms ease;
        }

        [data-ready="true"] .etc-face-box {
          border-color: #63d894;
          background: rgba(99, 216, 148, 0.08);
        }

        .etc-instruction {
          min-height: 42px;
          box-sizing: border-box;
          padding: 11px 2px 8px;
          font-size: 14px;
          line-height: 1.45;
          font-weight: 650;
          text-align: center;
        }

        [data-ready="true"] .etc-instruction {
          color: #78e0a2;
        }

        .etc-progress-row {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 10px;
          margin-bottom: 11px;
        }

        .etc-progress-track {
          height: 6px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.10);
        }

        .etc-progress-fill {
          width: 0;
          height: 100%;
          border-radius: inherit;
          background: #d8dde7;
          transition: width 120ms linear;
        }

        [data-ready="true"] .etc-progress-fill {
          background: #63d894;
        }

        .etc-progress-text {
          min-width: 36px;
          color: rgba(247, 248, 250, 0.7);
          font-size: 11px;
          text-align: right;
        }

        .etc-checks {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 5px;
        }

        .etc-check {
          min-width: 0;
          padding: 7px 5px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.055);
          color: rgba(247, 248, 250, 0.62);
          font-size: 9px;
          line-height: 1.25;
          text-align: center;
        }

        .etc-check[data-ok="true"] {
          color: #8de8b1;
          background: rgba(99, 216, 148, 0.10);
        }

        .etc-check strong {
          display: block;
          margin-bottom: 2px;
          color: rgba(247, 248, 250, 0.94);
          font-size: 10px;
          font-weight: 650;
        }

        .etc-metrics {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 9px;
          color: rgba(247, 248, 250, 0.50);
          font-size: 9px;
          line-height: 1.35;
        }
      </style>

      <div class="etc-layer">
        <section class="etc-panel" role="status" aria-live="polite">
          <div class="etc-title-row">
            <h2 class="etc-title">캘리브레이션 준비 · 얼굴 위치</h2>
            <span class="etc-privacy">영상 저장 안 함</span>
          </div>

          <div class="etc-map" aria-hidden="true">
            <div class="etc-crosshair-x"></div>
            <div class="etc-crosshair-y"></div>
            <div class="etc-guide"></div>
            <div class="etc-face-box"></div>
          </div>

          <div class="etc-instruction"></div>

          <div class="etc-progress-row">
            <div class="etc-progress-track">
              <div class="etc-progress-fill"></div>
            </div>
            <span class="etc-progress-text">0%</span>
          </div>

          <div class="etc-checks">
            <span class="etc-check etc-face-status"></span>
            <span class="etc-check etc-eyes-status"></span>
            <span class="etc-check etc-distance-status"></span>
            <span class="etc-check etc-pose-status"></span>
            <span class="etc-check etc-lighting-status"></span>
          </div>

          <div class="etc-metrics">
            <div class="etc-pose-metrics"></div>
            <div class="etc-brightness-metrics"></div>
          </div>
        </section>
      </div>
    `;

    this.host = host;

    this.instructionElement =
      shadow.querySelector(
        ".etc-instruction"
      );

    this.faceBoxElement =
      shadow.querySelector(
        ".etc-face-box"
      );

    this.progressFillElement =
      shadow.querySelector(
        ".etc-progress-fill"
      );

    this.progressTextElement =
      shadow.querySelector(
        ".etc-progress-text"
      );

    this.faceStatusElement =
      shadow.querySelector(
        ".etc-face-status"
      );

    this.eyesStatusElement =
      shadow.querySelector(
        ".etc-eyes-status"
      );

    this.distanceStatusElement =
      shadow.querySelector(
        ".etc-distance-status"
      );

    this.poseStatusElement =
      shadow.querySelector(
        ".etc-pose-status"
      );

    this.lightingStatusElement =
      shadow.querySelector(
        ".etc-lighting-status"
      );

    this.poseMetricsElement =
      shadow.querySelector(
        ".etc-pose-metrics"
      );

    this.brightnessMetricsElement =
      shadow.querySelector(
        ".etc-brightness-metrics"
      );

    const root =
      document.documentElement;

    root.appendChild(host);
  }

  private renderFaceBox(
    feedback: PreCalibrationFeedback
  ): void {
    const element =
      this.faceBoxElement;

    if (element === null) {
      return;
    }

    const box =
      feedback.cameraFaceBoxNormalized;

    if (box === null) {
      element.style.display =
        "none";

      return;
    }

    /**
     * Mirror camera X for a natural selfie-view positioning map.
     * Raw research geometry remains untouched in the Offscreen runtime.
     */
    const mirroredLeft =
      1 - (box.left + box.width);

    element.style.display =
      "block";

    element.style.left =
      toPercent(mirroredLeft);

    element.style.top =
      toPercent(box.top);

    element.style.width =
      toPercent(box.width);

    element.style.height =
      toPercent(box.height);
  }

  private setCheckStatus(
    element: HTMLSpanElement,
    ok: boolean,
    label: string,
    okText: string,
    badText: string
  ): void {
    element.dataset.ok =
      ok ? "true" : "false";

    element.innerHTML =
      `<strong>${label}</strong>${ok ? okText : badText}`;
  }
}
