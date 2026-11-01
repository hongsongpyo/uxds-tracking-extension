import type {
  Point2D,
  Size2D
} from "../shared/types";

interface PrecisionSample {
  readonly timestampMs: number;
  readonly pointPx: Point2D;
}

export interface RuntimeGazePrecisionEstimatorConfig {
  readonly windowMs: number;
  readonly minSamples: number;
  readonly maxFixationSpeedPxPerSecond: number;
}

function finitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finiteViewport(viewport: Size2D | null): viewport is Size2D {
  return (
    viewport !== null
    && Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0
  );
}

/** Target-free rolling precision estimate used only for runtime reliability. */
export class RuntimeGazePrecisionEstimator {
  private readonly samples: PrecisionSample[] = [];

  private readonly config: RuntimeGazePrecisionEstimatorConfig;

  public constructor(config: RuntimeGazePrecisionEstimatorConfig) {
    if (
      !Number.isFinite(config.windowMs)
      || config.windowMs <= 0
      || !Number.isInteger(config.minSamples)
      || config.minSamples < 2
      || !Number.isFinite(config.maxFixationSpeedPxPerSecond)
      || config.maxFixationSpeedPxPerSecond <= 0
    ) {
      throw new RangeError("Invalid runtime gaze precision estimator config.");
    }

    this.config = { ...config };
  }

  public update(
    timestampMs: number,
    normalizedPoint: Point2D,
    viewport: Size2D | null
  ): number | null {
    if (
      !Number.isFinite(timestampMs)
      || !finitePoint(normalizedPoint)
      || !finiteViewport(viewport)
    ) {
      this.reset();
      return null;
    }

    const pointPx = {
      x: normalizedPoint.x * viewport.width,
      y: normalizedPoint.y * viewport.height
    };

    const previous = this.samples.at(-1);

    if (previous !== undefined) {
      const dtMs = timestampMs - previous.timestampMs;

      if (dtMs <= 0) {
        this.reset();
      } else {
        const speed = Math.hypot(
          pointPx.x - previous.pointPx.x,
          pointPx.y - previous.pointPx.y
        ) / (dtMs / 1_000);

        if (speed > this.config.maxFixationSpeedPxPerSecond) {
          this.samples.length = 0;
        }
      }
    }

    this.samples.push({ timestampMs, pointPx });

    const oldestAllowed = timestampMs - this.config.windowMs;
    while (
      this.samples.length > 0
      && (this.samples[0]?.timestampMs ?? timestampMs) < oldestAllowed
    ) {
      this.samples.shift();
    }

    if (this.samples.length < this.config.minSamples) {
      return null;
    }

    let meanX = 0;
    let meanY = 0;
    for (const sample of this.samples) {
      meanX += sample.pointPx.x;
      meanY += sample.pointPx.y;
    }
    meanX /= this.samples.length;
    meanY /= this.samples.length;

    let squared = 0;
    for (const sample of this.samples) {
      const dx = sample.pointPx.x - meanX;
      const dy = sample.pointPx.y - meanY;
      squared += dx * dx + dy * dy;
    }

    return Math.sqrt(squared / this.samples.length);
  }

  public reset(): void {
    this.samples.length = 0;
  }
}
