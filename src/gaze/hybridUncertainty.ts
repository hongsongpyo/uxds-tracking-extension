import {
  DEEP_PERSONALIZATION
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError
} from "../shared/errors";

export interface HybridUncertaintyInput {
  readonly minimumViewportDimensionPx: number;
  /** Calibration-only grouped-CV expected hybrid error. */
  readonly expectedHybridErrorPx: number;
  readonly directionalPriorReliability: number;
  readonly baselineWeight: number;
  readonly deepWeight: number;
  readonly baselinePrecisionPx: number | null;
  readonly baselineAcceptedSampleCount: number;
  readonly baselineRejectedSampleCount: number;
  readonly deepPrecisionPx: number;
  readonly deepAcceptedSampleCount: number;
  readonly deepRawSampleCount: number;
  readonly modelDisagreementNormalized: number;
}

export interface HybridUncertaintyEstimate {
  readonly radiusNormalized: number;
  readonly unclampedRadiusNormalized: number;
  readonly calibrationPriorRadiusNormalized: number;
  readonly temporalNoiseRadiusNormalized: number;
  readonly disagreementRadiusNormalized: number;
  readonly baselineRetentionRatio: number;
  readonly deepRetentionRatio: number;
  readonly clamped: boolean;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertFiniteNonNegative(
  value: number,
  name: string
): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      `Hybrid uncertainty requires finite non-negative ${name}.`,
      { details: { [name]: value } }
    );
  }
}

function retentionRatio(
  acceptedSampleCount: number,
  rawSampleCount: number
): number {
  if (rawSampleCount <= 0) {
    return 1;
  }

  return clamp(
    acceptedSampleCount / rawSampleCount,
    Number.EPSILON,
    1
  );
}

function centroidNoiseNormalized(
  precisionPx: number | null,
  acceptedSampleCount: number,
  retention: number,
  minimumViewportDimensionPx: number
): number {
  if (
    precisionPx === null
    || !Number.isFinite(precisionPx)
    || precisionPx < 0
    || acceptedSampleCount <= 0
  ) {
    return 0;
  }

  const effectiveSampleCount =
    acceptedSampleCount * retention;

  return (
    precisionPx / minimumViewportDimensionPx
  ) / Math.sqrt(
    Math.max(effectiveSampleCount, Number.EPSILON)
  );
}

/**
 * Target-free adaptive uncertainty for the calibration-only hybrid.
 *
 * Components are combined as independent uncertainty sources using RSS rather
 * than a linear sum, which avoids the previous frequent saturation at the
 * region-radius clamp.
 *
 * - Calibration prior: grouped-CV expected hybrid error, inflated only when
 *   drift reduces the already-computed directional prior reliability.
 * - Temporal noise: current-window centroid uncertainty. More accepted samples
 *   reduce this term by sqrt(n), while rejected samples reduce the effective n.
 * - Model disagreement: only disagreement beyond the established soft zone is
 *   counted, and the contribution is proportional to sqrt(w_b * w_d), matching
 *   the between-model spread of a weighted two-model mixture.
 *
 * No independent-validation target coordinate or target error is accepted by
 * this function, so it cannot tune uncertainty using validation accuracy.
 */
export function estimateHybridUncertainty(
  input: HybridUncertaintyInput
): HybridUncertaintyEstimate {
  assertFiniteNonNegative(
    input.minimumViewportDimensionPx,
    "minimumViewportDimensionPx"
  );
  assertFiniteNonNegative(
    input.expectedHybridErrorPx,
    "expectedHybridErrorPx"
  );
  assertFiniteNonNegative(
    input.modelDisagreementNormalized,
    "modelDisagreementNormalized"
  );

  if (input.minimumViewportDimensionPx <= 0) {
    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Hybrid uncertainty requires a positive viewport dimension."
    );
  }

  const baselineWeight = clamp(
    input.baselineWeight,
    0,
    1
  );
  const deepWeight = clamp(
    input.deepWeight,
    0,
    1
  );

  const directionalReliability = clamp(
    input.directionalPriorReliability,
    DEEP_PERSONALIZATION.HYBRID_DRIFT_LOCAL_PRIOR_MIN_RELIABILITY,
    1
  );

  const calibrationPriorRadiusNormalized = (
    input.expectedHybridErrorPx
    / input.minimumViewportDimensionPx
  ) / Math.sqrt(directionalReliability);

  const baselineRawSampleCount =
    Math.max(
      0,
      input.baselineAcceptedSampleCount
        + input.baselineRejectedSampleCount
    );

  const baselineRetentionRatio = retentionRatio(
    input.baselineAcceptedSampleCount,
    baselineRawSampleCount
  );

  const deepRetentionRatio = retentionRatio(
    input.deepAcceptedSampleCount,
    input.deepRawSampleCount
  );

  const baselineCentroidNoise = centroidNoiseNormalized(
    input.baselinePrecisionPx,
    input.baselineAcceptedSampleCount,
    baselineRetentionRatio,
    input.minimumViewportDimensionPx
  );

  const deepCentroidNoise = centroidNoiseNormalized(
    input.deepPrecisionPx,
    input.deepAcceptedSampleCount,
    deepRetentionRatio,
    input.minimumViewportDimensionPx
  );

  const temporalNoiseRadiusNormalized = Math.hypot(
    baselineWeight * baselineCentroidNoise,
    deepWeight * deepCentroidNoise
  );

  const disagreementSoft =
    DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_SOFT_NORMALIZED;
  const disagreementHard = Math.max(
    disagreementSoft,
    DEEP_PERSONALIZATION.HYBRID_DISAGREEMENT_HARD_NORMALIZED
  );

  const disagreementExcess = clamp(
    input.modelDisagreementNormalized - disagreementSoft,
    0,
    disagreementHard - disagreementSoft
  );

  const disagreementRadiusNormalized =
    Math.sqrt(baselineWeight * deepWeight)
    * disagreementExcess;

  const unclampedRadiusNormalized = Math.hypot(
    calibrationPriorRadiusNormalized,
    temporalNoiseRadiusNormalized,
    disagreementRadiusNormalized
  );

  const maximumRadius =
    DEEP_PERSONALIZATION
      .GAZE_REGION_MAX_UNCERTAINTY_RADIUS_NORMALIZED;

  const radiusNormalized = Math.min(
    maximumRadius,
    unclampedRadiusNormalized
  );

  return {
    radiusNormalized,
    unclampedRadiusNormalized,
    calibrationPriorRadiusNormalized,
    temporalNoiseRadiusNormalized,
    disagreementRadiusNormalized,
    baselineRetentionRatio,
    deepRetentionRatio,
    clamped: unclampedRadiusNormalized > maximumRadius
  };
}
