import {
  CALIBRATION
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

import {
  distance2D
} from "../shared/utils";

import type {
  CalibrationRawSample,
  HeadPose,
  Point2D
} from "../shared/types";

import type {
  CalibrationPointCollection
} from "./calibrationCollector";

import {
  selectBestCalibrationStableWindow
} from "./calibrationStability";

import type {
  CalibrationStabilityMetrics
} from "./calibrationStability";

/* ========================================================================== 
 * Public types
 * ======================================================================== */

export interface CalibrationCleanedPoint {
  readonly calibrationId: string;
  readonly pointIndex: number;
  readonly targetNormalizedPoint: Point2D;
  readonly targetViewportPoint: Point2D;
  readonly representativeRawPoint: Point2D;
  readonly samples: readonly CalibrationRawSample[];
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly rejectionRatio: number;
  readonly meanHeadPose: HeadPose;
  readonly meanFaceDistanceRatio: number;
  readonly meanQuality: number;

  /** Diagnostics for the selected pre-cleaning fixation window. */
  readonly stability?:
    CalibrationStabilityMetrics;
  readonly stableWindowStartTimestampMs?: number;
  readonly stableWindowEndTimestampMs?: number;
  readonly candidateAcceptedSampleCount?: number;
}

/* ========================================================================== 
 * Numeric helpers
 * ======================================================================== */

function median(
  values: readonly number[]
): number {
  if (values.length === 0) {
    throw new RangeError(
      "median() requires at least one value."
    );
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const value = sorted[middle];

    if (value === undefined) {
      throw new RangeError(
        "median() could not resolve the middle value."
      );
    }

    return value;
  }

  const lower =
    sorted[middle - 1];

  const upper =
    sorted[middle];

  if (
    lower === undefined
    || upper === undefined
  ) {
    throw new RangeError(
      "median() could not resolve the middle pair."
    );
  }

  return (lower + upper) / 2;
}

function mean(
  values: readonly number[]
): number {
  if (values.length === 0) {
    throw new RangeError(
      "mean() requires at least one value."
    );
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
}

function meanPoint(
  points: readonly Point2D[]
): Point2D {
  return {
    x: mean(
      points.map((point) => point.x)
    ),
    y: mean(
      points.map((point) => point.y)
    )
  };
}

function calculateRejectionRatio(
  accepted: number,
  rejected: number
): number {
  const total = accepted + rejected;

  if (total === 0) {
    return 1;
  }

  return rejected / total;
}

function isUsableAcceptedSample(
  sample: CalibrationRawSample
): boolean {
  return (
    sample.accepted
    && sample.rawGazeSpace
      === "NORMALIZED"
    && Number.isFinite(
      sample.rawGazePoint.x
    )
    && Number.isFinite(
      sample.rawGazePoint.y
    )
  );
}

/* ========================================================================== 
 * Cleaner
 * ======================================================================== */

/**
 * Performs robust per-target outlier rejection in raw NORMALIZED gaze space.
 *
 * First chooses the best stable contiguous fixation window from the longer
 * candidate collection. Within that window, the initial center is the
 * coordinate-wise median and samples are rejected by radial distance using a
 * median-absolute-deviation threshold. The final representative gaze point
 * remains the arithmetic mean of the retained inliers; after robust outlier
 * rejection this is intentionally not replaced by an unconditional median.
 */
export function cleanCalibrationPoint(
  collection: CalibrationPointCollection
): CalibrationCleanedPoint {
  const candidateAccepted =
    collection.samples.filter(
      isUsableAcceptedSample
    );

  const stableWindow =
    selectBestCalibrationStableWindow(
      candidateAccepted
    );

  const initialAccepted =
    stableWindow?.samples
    ?? [];

  /*
   * V5: the V4 stability selector is cadence-aware, so a valid 10 Hz host may
   * intentionally select only 5-6 samples inside its best stable temporal
   * window while the full target still contains >=10 accepted observations.
   * Requiring 10 again here silently invalidated that V4 decision. Healthy
   * ~30 Hz hosts still resolve to the original requirement of 10.
   */
  const requiredStableSampleCount =
    stableWindow?.metrics.profile.minSampleCount
    ?? CALIBRATION.MIN_ACCEPTED_SAMPLES_PER_POINT;

  if (
    stableWindow === null
    || initialAccepted.length
      < requiredStableSampleCount
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Calibration point has too few usable gaze samples before outlier cleaning.",
      {
        details: {
          pointIndex:
            collection.target.pointIndex,
          usableSampleCount:
            initialAccepted.length,
          candidateAcceptedSampleCount:
            candidateAccepted.length,
          stableWindowFound:
            stableWindow !== null,
          requiredSampleCount:
            requiredStableSampleCount
        }
      }
    );
  }

  const medianPoint: Point2D = {
    x: median(
      initialAccepted.map(
        (sample) => sample.rawGazePoint.x
      )
    ),
    y: median(
      initialAccepted.map(
        (sample) => sample.rawGazePoint.y
      )
    )
  };

  const radialDistances =
    initialAccepted.map(
      (sample) =>
        distance2D(
          sample.rawGazePoint,
          medianPoint
        )
    );

  const medianRadius =
    median(radialDistances);

  const absoluteDeviations =
    radialDistances.map(
      (radius) =>
        Math.abs(
          radius - medianRadius
        )
    );

  const mad =
    median(absoluteDeviations);

  const robustSigma =
    1.4826 * mad;

  const allowedRadius =
    medianRadius
    + Math.max(
      CALIBRATION
        .OUTLIER_MIN_RADIUS_NORMALIZED,
      CALIBRATION
        .OUTLIER_MAD_SCALE
        * robustSigma
    );

  const inlierTimestamps =
    new Set<number>();

  for (
    let index = 0;
    index < initialAccepted.length;
    index += 1
  ) {
    const sample =
      initialAccepted[index];

    const radius =
      radialDistances[index];

    if (
      sample !== undefined
      && radius !== undefined
      && radius <= allowedRadius
    ) {
      inlierTimestamps.add(
        sample.timestampMs
      );
    }
  }

  const stableWindowSamples =
    collection.samples.filter(
      (sample) =>
        sample.timestampMs
          >= stableWindow.startTimestampMs
        && sample.timestampMs
          <= stableWindow.endTimestampMs
    );

  const finalSamples =
    stableWindowSamples.map(
      (sample) => {
        const accepted =
          isUsableAcceptedSample(sample)
          && inlierTimestamps.has(
            sample.timestampMs
          );

        return {
          ...sample,
          accepted
        };
      }
    );

  const finalAccepted =
    finalSamples.filter(
      (sample) => sample.accepted
    );

  if (
    finalAccepted.length
      < requiredStableSampleCount
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Calibration point has too few samples after robust outlier cleaning.",
      {
        details: {
          pointIndex:
            collection.target.pointIndex,
          acceptedAfterCleaning:
            finalAccepted.length,
          requiredSampleCount:
            requiredStableSampleCount,
          allowedRadius
        }
      }
    );
  }

  const acceptedSampleCount =
    finalAccepted.length;

  const rejectedSampleCount =
    finalSamples.length
    - acceptedSampleCount;

  const rejectionRatio =
    calculateRejectionRatio(
      acceptedSampleCount,
      rejectedSampleCount
    );

  if (
    rejectionRatio
      > CALIBRATION.MAX_REJECTION_RATIO
  ) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_INSUFFICIENT_SAMPLES,
      "CALIBRATION",
      "Calibration point rejection ratio is too high.",
      {
        details: {
          pointIndex:
            collection.target.pointIndex,
          rejectionRatio,
          maximumAllowed:
            CALIBRATION.MAX_REJECTION_RATIO
        }
      }
    );
  }

  return {
    calibrationId:
      collection.calibrationId,
    pointIndex:
      collection.target.pointIndex,
    targetNormalizedPoint:
      collection.target.normalizedPoint,
    targetViewportPoint:
      collection.target.viewportPoint,
    representativeRawPoint:
      meanPoint(
        finalAccepted.map(
          (sample) => sample.rawGazePoint
        )
      ),
    samples:
      finalSamples,
    acceptedSampleCount,
    rejectedSampleCount,
    rejectionRatio,
    meanHeadPose: {
      yawDeg:
        mean(
          finalAccepted.map(
            (sample) =>
              sample.headPose.yawDeg
          )
        ),
      pitchDeg:
        mean(
          finalAccepted.map(
            (sample) =>
              sample.headPose.pitchDeg
          )
        ),
      rollDeg:
        mean(
          finalAccepted.map(
            (sample) =>
              sample.headPose.rollDeg
          )
        )
    },
    meanFaceDistanceRatio:
      mean(
        finalAccepted.map(
          (sample) =>
            sample.faceDistanceRatio
        )
      ),
    meanQuality:
      mean(
        finalAccepted.map(
          (sample) => sample.quality
        )
      ),
    stability:
      stableWindow.metrics,
    stableWindowStartTimestampMs:
      stableWindow.startTimestampMs,
    stableWindowEndTimestampMs:
      stableWindow.endTimestampMs,
    candidateAcceptedSampleCount:
      candidateAccepted.length
  };
}
