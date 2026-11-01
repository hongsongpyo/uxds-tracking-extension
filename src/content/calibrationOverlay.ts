import type {
  CalibrationQualityLevel,
  CalibrationTarget,
  CalibrationValidationMetrics
} from "../shared/types";

/* ========================================================================== 
 * Overlay
 * ======================================================================== */

/**
 * Full-viewport fixation UI used only while calibration targets are collected.
 *
 * The page is visually covered so arbitrary website content does not compete
 * with the fixation target. No webcam pixels or gaze coordinates are rendered.
 */
export class CalibrationOverlay {
  private host:
    HTMLDivElement | null =
      null;

  private statusElement:
    HTMLDivElement | null =
      null;

  private progressElement:
    HTMLDivElement | null =
      null;

  private targetElement:
    HTMLDivElement | null =
      null;

  public showPreparing(
    totalPoints: number
  ): void {
    this.ensureMounted();
    this.setTargetVisible(false);
    this.setStatus(
      "캘리브레이션을 시작합니다. 나타나는 점의 중심을 자연스럽게 바라봐 주세요."
    );
    this.setProgress(
      `0 / ${totalPoints}`
    );
  }

  public showTarget(
    target: CalibrationTarget,
    completedPointCount: number,
    totalPoints: number,
    attempt: number
  ): void {
    this.ensureMounted();

    if (
      this.targetElement === null
    ) {
      return;
    }

    this.targetElement.style.left =
      `${target.viewportPoint.x}px`;

    this.targetElement.style.top =
      `${target.viewportPoint.y}px`;

    this.setTargetVisible(true);

    this.setStatus(
      attempt === 1
        ? "점의 중심을 바라보고 시선을 잠시 유지해 주세요."
        : "유효한 시선 데이터가 부족했습니다. 같은 점을 다시 바라봐 주세요."
    );

    this.setProgress(
      `${completedPointCount + 1} / ${totalPoints}`
      + (attempt > 1
        ? ` · 재측정 ${attempt}`
        : "")
    );
  }

  public showAdaptiveExpansion(
    completedPointCount: number,
    totalPointCount: number,
    additionalPointCount: number
  ): void {
    this.setTargetVisible(false);
    this.setStatus(
      `초기 캘리브레이션에서 취약 영역이 확인되어 ${additionalPointCount}개 지점을 추가 측정합니다.`
    );
    this.setProgress(
      `${completedPointCount} / ${totalPointCount} · 적응형 보강`
    );
  }

  public showQuickRecalibrationPreparing(
    totalPoints: number
  ): void {
    this.ensureMounted();
    this.setTargetVisible(false);
    this.setStatus(
      "시선 정확도 저하가 감지되어 짧은 재보정을 진행합니다. 현재 자세를 유지한 채 나타나는 점을 바라봐 주세요."
    );
    this.setProgress(
      `빠른 재보정 0 / ${totalPoints}`
    );
  }

  public showQuickRecalibrationTarget(
    target: CalibrationTarget,
    completedPointCount: number,
    totalPoints: number,
    attempt: number
  ): void {
    this.ensureMounted();

    if (this.targetElement === null) {
      return;
    }

    this.targetElement.style.left = `${target.viewportPoint.x}px`;
    this.targetElement.style.top = `${target.viewportPoint.y}px`;
    this.setTargetVisible(true);
    this.setStatus(
      attempt === 1
        ? "빠른 재보정 중입니다. 점 중심을 바라보고 머리는 현재 위치에서 자연스럽게 유지해 주세요."
        : "유효 데이터가 부족했습니다. 같은 점을 다시 바라봐 주세요."
    );
    this.setProgress(
      `빠른 재보정 ${completedPointCount + 1} / ${totalPoints}`
      + (attempt > 1 ? ` · 재측정 ${attempt}` : "")
    );
  }

  public showQuickValidationPreparing(
    totalPoints: number
  ): void {
    this.ensureMounted();
    this.setTargetVisible(false);
    this.setStatus(
      "재보정 결과를 독립적으로 확인합니다. 마지막 몇 개의 점을 바라봐 주세요."
    );
    this.setProgress(`빠른 검증 0 / ${totalPoints}`);
  }

  public showQuickValidationTarget(
    target: CalibrationTarget,
    completedPointCount: number,
    totalPoints: number,
    attempt: number
  ): void {
    this.ensureMounted();

    if (this.targetElement === null) {
      return;
    }

    this.targetElement.style.left = `${target.viewportPoint.x}px`;
    this.targetElement.style.top = `${target.viewportPoint.y}px`;
    this.setTargetVisible(true);
    this.setStatus(
      attempt === 1
        ? "빠른 정확도 검증 중입니다. 점 중심을 잠시 바라봐 주세요."
        : "검증 데이터가 부족했습니다. 같은 점을 다시 바라봐 주세요."
    );
    this.setProgress(
      `빠른 검증 ${completedPointCount + 1} / ${totalPoints}`
      + (attempt > 1 ? ` · 재측정 ${attempt}` : "")
    );
  }

  public showQuickValidationCompleted(
    quality: CalibrationQualityLevel,
    metrics: CalibrationValidationMetrics
  ): void {
    this.setTargetVisible(false);
    const passed = quality === "GOOD" || quality === "ACCEPTABLE";
    this.setStatus(
      passed
        ? "빠른 재보정이 완료되었습니다. 시선 추적을 계속합니다."
        : "빠른 재보정 후에도 정확도가 낮습니다. 가능한 경우 전체 캘리브레이션을 다시 진행해 주세요."
    );
    this.setProgress(
      `${quality} · 평균 ${metrics.meanErrorPx.toFixed(1)} px`
      + ` · P95 ${metrics.p95ErrorPx.toFixed(1)} px`
      + ` · 정밀도 ${metrics.meanPrecisionPx.toFixed(1)} px`
    );
  }

  public showRetrying(): void {
    this.setTargetVisible(false);
    this.setStatus(
      "잠시 후 같은 지점을 다시 측정합니다. 얼굴은 가능한 한 그대로 유지해 주세요."
    );
  }

  public showCompleted(
    totalPoints: number,
    trainingRmseNormalized:
      number | null
  ): void {
    this.setTargetVisible(false);

    const diagnostic =
      trainingRmseNormalized === null
        ? ""
        : ` · 학습 RMSE ${trainingRmseNormalized.toFixed(4)}`;

    this.setStatus(
      `${totalPoints}-point 캘리브레이션 수집이 완료되었습니다. 독립 정확도 검증 단계로 이동합니다.`
    );

    this.setProgress(
      `수집 완료${diagnostic}`
    );
  }

  public showValidationPreparing(
    totalPoints: number
  ): void {
    this.ensureMounted();
    this.setTargetVisible(false);
    this.setStatus(
      "캘리브레이션 정확도를 독립적으로 검증합니다. 다시 나타나는 점의 중심을 바라봐 주세요."
    );
    this.setProgress(
      `검증 0 / ${totalPoints}`
    );
  }

  public showValidationTarget(
    target: CalibrationTarget,
    completedPointCount: number,
    totalPoints: number,
    attempt: number
  ): void {
    this.ensureMounted();

    if (this.targetElement === null) {
      return;
    }

    this.targetElement.style.left =
      `${target.viewportPoint.x}px`;

    this.targetElement.style.top =
      `${target.viewportPoint.y}px`;

    this.setTargetVisible(true);

    this.setStatus(
      attempt === 1
        ? "정확도 검증 중입니다. 점의 중심을 바라보고 시선을 잠시 유지해 주세요."
        : "검증용 시선 데이터가 부족했습니다. 같은 점을 다시 바라봐 주세요."
    );

    this.setProgress(
      `검증 ${completedPointCount + 1} / ${totalPoints}`
      + (attempt > 1
        ? ` · 재측정 ${attempt}`
        : "")
    );
  }

  public showValidationCompleted(
    quality: CalibrationQualityLevel,
    metrics: CalibrationValidationMetrics
  ): void {
    this.setTargetVisible(false);

    const passed =
      quality === "GOOD"
      || quality === "ACCEPTABLE";

    this.setStatus(
      passed
        ? "독립 정확도 검증을 통과했습니다. 아이트래커가 준비되었습니다."
        : quality === "POOR"
          ? "독립 정확도 검증 기준을 충족하지 못했습니다. 재캘리브레이션을 권장합니다. 3초 후 현재 캘리브레이션으로 수집을 시작합니다."
          : "독립 정확도 검증 기준을 충족하지 못했습니다. 재캘리브레이션이 필요합니다."
    );

    this.setProgress(
      `${quality}`
      + ` · 평균 ${metrics.meanErrorPx.toFixed(1)} px`
      + ` (${(metrics.meanErrorViewportWidthRatio * 100).toFixed(2)}% W)`
      + ` · P95 ${metrics.p95ErrorPx.toFixed(1)} px`
      + ` · 정밀도 ${metrics.meanPrecisionPx.toFixed(1)} px`
      + ` · 유효 ${(metrics.validSampleRatio * 100).toFixed(0)}%`
    );
  }

  public showError(
    message: string
  ): void {
    this.setTargetVisible(false);
    this.setStatus(message);
    this.setProgress(
      "캘리브레이션 중단"
    );
  }

  public hide(): void {
    if (this.host !== null) {
      this.host.remove();
      this.host = null;
    }

    this.statusElement = null;
    this.progressElement = null;
    this.targetElement = null;
  }

  private ensureMounted(): void {
    if (this.host !== null) {
      return;
    }

    document
      .getElementById(
        "etc-calibration-overlay-host"
      )
      ?.remove();

    const host =
      document.createElement("div");

    host.id =
      "etc-calibration-overlay-host";

    const shadow =
      host.attachShadow({
        mode: "closed"
      });

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .etc-calibration-layer {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          overflow: hidden;
          box-sizing: border-box;
          background: rgba(15, 17, 21, 0.992);
          color: #f7f8fa;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
          user-select: none;
          cursor: default;
        }

        .etc-calibration-header {
          position: absolute;
          top: 18px;
          left: 50%;
          width: min(620px, calc(100vw - 40px));
          transform: translateX(-50%);
          box-sizing: border-box;
          padding: 12px 16px;
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 14px;
          background: rgba(25, 28, 34, .90);
          text-align: center;
          box-shadow: 0 10px 36px rgba(0,0,0,.22);
        }

        .etc-calibration-status {
          font-size: 14px;
          line-height: 1.45;
          font-weight: 650;
          letter-spacing: -0.01em;
        }

        .etc-calibration-progress {
          margin-top: 5px;
          color: rgba(247,248,250,.60);
          font-size: 11px;
        }

        .etc-calibration-target {
          position: absolute;
          width: 34px;
          height: 34px;
          transform: translate(-50%, -50%);
          border: 3px solid #f6f7f9;
          border-radius: 50%;
          box-sizing: border-box;
          background: rgba(255,255,255,.04);
          box-shadow:
            0 0 0 8px rgba(255,255,255,.07),
            0 8px 30px rgba(0,0,0,.30);
        }

        .etc-calibration-target::before,
        .etc-calibration-target::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          background: #f6f7f9;
        }

        .etc-calibration-target::before {
          width: 4px;
          height: 4px;
          border-radius: 50%;
        }

        .etc-calibration-target::after {
          width: 14px;
          height: 1px;
          opacity: .65;
        }
      </style>

      <div class="etc-calibration-layer" data-role="layer">
        <div class="etc-calibration-header">
          <div class="etc-calibration-status" data-role="status"></div>
          <div class="etc-calibration-progress" data-role="progress"></div>
        </div>
        <div class="etc-calibration-target" data-role="target"></div>
      </div>
    `;

    this.statusElement =
      shadow.querySelector<HTMLDivElement>(
        '[data-role="status"]'
      );

    this.progressElement =
      shadow.querySelector<HTMLDivElement>(
        '[data-role="progress"]'
      );

    this.targetElement =
      shadow.querySelector<HTMLDivElement>(
        '[data-role="target"]'
      );

    const layer =
      shadow.querySelector<HTMLDivElement>(
        '[data-role="layer"]'
      );

    layer?.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
      },
      {
        passive: false
      }
    );

    layer?.addEventListener(
      "touchmove",
      (event) => {
        event.preventDefault();
      },
      {
        passive: false
      }
    );

    document.documentElement.append(
      host
    );

    this.host = host;
  }

  private setStatus(
    text: string
  ): void {
    if (this.statusElement !== null) {
      this.statusElement.textContent = text;
    }
  }

  private setProgress(
    text: string
  ): void {
    if (this.progressElement !== null) {
      this.progressElement.textContent = text;
    }
  }

  private setTargetVisible(
    visible: boolean
  ): void {
    if (this.targetElement === null) {
      return;
    }

    this.targetElement.style.display =
      visible
        ? "block"
        : "none";
  }
}
