import {
  GAZE_RUNTIME_DEFAULTS
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import type {
  GazeEngineSource,
  GazePrediction,
  HeadPose,
  Point2D
} from "../shared/types";

import {
  isGazeFeatureProvider
} from "./GazeEngine";

import type {
  GazeEngine,
  GazeEngineFrameInput,
  GazeEngineSnapshot,
  GazeFeatureSnapshot
} from "./GazeEngine";

import {
  RidgeGazeEngine
} from "./ridgeGazeEngine";

import {
  WebEyeTrackEngine
} from "./webEyeTrackEngine";

import {
  UniversalDeepEngine
} from "./universalDeepEngine";

import type {
  WebEyeTrackPersonalizationResult
} from "./webEyeTrackEngine";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * Predictor lifecycle / options
 * ======================================================================== */

export type GazePredictorLifecycle =
  | "CREATED"
  | "INITIALIZING"
  | "READY"
  | "ERROR"
  | "DISPOSED";

export interface GazePredictorOptions {
  /**
   * Maximum prediction-attempt rate.
   *
   * This limits model inference frequency only. It does not change camera or
   * face-analysis frame rates and never synthesizes missing research samples.
   */
  readonly targetSampleRateHz?: number;

  /**
   * When the primary engine returns `null` for an otherwise submitted frame,
   * the predictor may try the fallback engine.
   *
   * This is useful after a participant-specific Ridge model has been trained.
   */
  readonly fallbackOnNullPrediction?: boolean;

  /**
   * Maximum rate for the non-blocking observer engine.
   *
   * Stage D6 uses the UniversalDeepEngine as a shadow/observer path while
   * WebEyeTrack continues to emit the NORMALIZED gaze consumed by the current
   * calibration pipeline. Keeping the observer rate below the main output
   * rate prevents the research probe from starving calibration frames.
   */
  readonly observerSampleRateHz?: number;
}

export interface GazeObserverPredictionSnapshot {
  readonly frameSequence: number;
  readonly timestampMs: number;
  readonly source: GazeEngineSource;
  readonly rawPoint: Point2D;
  readonly rawSpace: GazePrediction["rawSpace"];
  readonly confidence: number;
  readonly inferenceLatencyMs: number;
}

/**
 * Compact geometry copied from the exact frame used by the deep observer.
 * No landmarks, image crops or webcam frames are retained.
 */
export interface GazeObserverGeometrySnapshot {
  readonly headPose: HeadPose;
  readonly faceCenterNormalized: Point2D;
  readonly faceWidthRatio: number;
  readonly faceHeightRatio: number;
  readonly faceDistanceRatio: number;
  readonly leftIrisHorizontalOffsetRatio: number;
  readonly leftIrisVerticalOffsetRatio: number;
  readonly rightIrisHorizontalOffsetRatio: number;
  readonly rightIrisVerticalOffsetRatio: number;
}

/**
 * Runtime-only synchronized deep observation used by participant-specific
 * calibration. The 2048-D feature is intentionally transient and is not a
 * research/storage record.
 */
export interface GazeObserverQualitySnapshot {
  readonly usableForGaze: boolean;
  readonly faceValid: boolean;
  readonly eyesValid: boolean;
  readonly blink: boolean;
  readonly qualityScore: number;
  readonly qualityLevel:
    GazeEngineFrameInput["faceQuality"]["trackingQuality"]["qualityLevel"];
}

export interface GazeObserverRuntimeSample {
  readonly prediction:
    GazeObserverPredictionSnapshot;
  readonly feature: GazeFeatureSnapshot;
  readonly geometry:
    GazeObserverGeometrySnapshot;
  readonly quality:
    GazeObserverQualitySnapshot;
}

export type GazeObserverSampleListener = (
  sample: GazeObserverRuntimeSample
) => void;

export interface GazeObserverSnapshot {
  readonly engine: GazeEngineSnapshot | null;
  readonly available: boolean;
  readonly inFlight: boolean;
  readonly suspended: boolean;
  readonly suspensionReason: string | null;
  readonly targetSampleRateHz: number;
  readonly lastAttemptTimestampMs: number | null;
  readonly lastPrediction: GazeObserverPredictionSnapshot | null;
  readonly attemptCount: number;
  readonly successCount: number;
  readonly nullPredictionCount: number;
  readonly failureCount: number;
  readonly rateLimitedFrameCount: number;
  readonly inFlightSkippedFrameCount: number;
}

export interface GazePredictorSnapshot {
  readonly lifecycle:
    GazePredictorLifecycle;

  readonly targetSampleRateHz:
    number;

  readonly primary:
    GazeEngineSnapshot;

  readonly fallback:
    GazeEngineSnapshot | null;

  readonly primaryAvailable:
    boolean;

  readonly fallbackAvailable:
    boolean;

  readonly activeSource:
    GazeEngineSource | null;

  readonly lastAttemptTimestampMs:
    number | null;

  readonly lastPredictionTimestampMs:
    number | null;

  readonly lastProcessedFrameSequence:
    number | null;

  readonly primaryPredictionFailureCount:
    number;

  readonly fallbackPredictionUseCount:
    number;

  readonly rateLimitedFrameCount:
    number;

  readonly duplicateFrameCount:
    number;

  /**
   * Non-blocking research observer diagnostics. This observer does not decide
   * which gaze value is returned to calibration/tracking.
   */
  readonly observer:
    GazeObserverSnapshot;
}

interface ResolvedGazePredictorOptions {
  readonly targetSampleRateHz: number;
  readonly fallbackOnNullPrediction: boolean;
  readonly observerSampleRateHz: number;
}

/* ========================================================================== 
 * Helpers
 * ======================================================================== */

function resolveOptions(
  options: GazePredictorOptions
): ResolvedGazePredictorOptions {
  const targetSampleRateHz =
    options.targetSampleRateHz
    ?? GAZE_RUNTIME_DEFAULTS
      .TARGET_SAMPLE_RATE_HZ;

  if (
    !Number.isFinite(targetSampleRateHz)
    || targetSampleRateHz <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Gaze predictor sample rate must be a finite positive number.",
      {
        details: {
          targetSampleRateHz
        }
      }
    );
  }

  const observerSampleRateHz =
    options.observerSampleRateHz
    ?? GAZE_RUNTIME_DEFAULTS
      .DEEP_OBSERVER_SAMPLE_RATE_HZ;

  if (
    !Number.isFinite(observerSampleRateHz)
    || observerSampleRateHz <= 0
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Gaze observer sample rate must be a finite positive number.",
      {
        details: {
          observerSampleRateHz
        }
      }
    );
  }

  return {
    targetSampleRateHz,
    fallbackOnNullPrediction:
      options.fallbackOnNullPrediction
      ?? true,
    observerSampleRateHz
  };
}

function isSameFrame(
  input: GazeEngineFrameInput,
  frameSequence: number | null,
  timestampMs: number | null
): boolean {
  return (
    frameSequence !== null
    && timestampMs !== null
    && input.frame.metadata.frameSequence
      === frameSequence
    && input.frame.metadata.timestampMs
      === timestampMs
  );
}

function getErrorSummary(
  error: TrackerError
): Readonly<Record<string, unknown>> {
  return {
    code:
      error.code,
    message:
      error.message,
    recoverable:
      error.recoverable,
    details:
      error.details
  };
}

/* ========================================================================== 
 * Gaze predictor
 * ======================================================================== */

/**
 * Coordinates gaze-estimator selection without exposing engine-specific
 * details to the Offscreen runtime.
 *
 * Default policy:
 *
 *   WebEyeTrack (primary)
 *          ↓ null / prediction failure
 *   Ridge (fallback, once a participant model is available)
 *
 *   UniversalDeepEngine (non-blocking observer)
 *          ↓
 *   MODEL-space yaw/pitch + transient feature diagnostics
 *
 * The observer is intentionally NOT the returned gaze source yet. The current
 * calibration model accepts NORMALIZED input, while L2CS emits MODEL-space
 * yaw/pitch. Stage D6 therefore proves real browser inference without
 * contaminating or breaking the established baseline. A later personal
 * screen mapper will promote deep features into the calibration path.
 *
 * Important boundaries:
 * - this class does not calibrate either engine;
 * - it does not correct or filter gaze coordinates;
 * - it does not emit Chrome messages;
 * - it does not retain webcam frames;
 * - it returns only a raw `GazePrediction` produced by one engine.
 *
 * Calibration code that needs direct access to `RidgeGazeEngine.fit()` should
 * construct the Ridge instance externally and inject that same instance here.
 */
export class GazePredictor {
  private lifecycle:
    GazePredictorLifecycle =
      "CREATED";

  private readonly options:
    ResolvedGazePredictorOptions;

  private readonly minAttemptIntervalMs:
    number;

  private readonly observerMinAttemptIntervalMs:
    number;

  private primaryAvailable =
    false;

  private fallbackAvailable =
    false;

  private activeSource:
    GazeEngineSource | null =
      null;

  private lastAttemptTimestampMs:
    number | null =
      null;

  private lastPredictionTimestampMs:
    number | null =
      null;

  private lastProcessedFrameSequence:
    number | null =
      null;

  private lastProcessedFrameTimestampMs:
    number | null =
      null;

  private primaryPredictionFailureCount =
    0;

  private fallbackPredictionUseCount =
    0;

  private rateLimitedFrameCount =
    0;

  private duplicateFrameCount =
    0;

  private observerAvailable =
    false;

  private observerGeneration = 0;

  private observerPredictionInFlight =
    false;

  private observerSuspended =
    false;

  private observerSuspensionReason:
    string | null =
      null;

  private observerLastAttemptTimestampMs:
    number | null =
      null;

  private observerLastPrediction:
    GazeObserverPredictionSnapshot | null =
      null;

  private observerAttemptCount =
    0;

  private observerSuccessCount =
    0;

  private observerNullPredictionCount =
    0;

  private observerFailureCount =
    0;

  private observerRateLimitedFrameCount =
    0;

  private observerInFlightSkippedFrameCount =
    0;

  private observerSampleListener:
    GazeObserverSampleListener | null =
      null;

  public constructor(
    private readonly primaryEngine:
      GazeEngine =
        new WebEyeTrackEngine(),

    private readonly fallbackEngine:
      GazeEngine | null =
        new RidgeGazeEngine(),

    options:
      GazePredictorOptions = {},

    /**
     * Research-only shadow engine. Inject `null` in unit tests or builds that
     * intentionally do not provision the L2CS model.
     */
    private readonly observerEngine:
      GazeEngine | null =
        new UniversalDeepEngine()
  ) {
    this.options =
      resolveOptions(options);

    this.minAttemptIntervalMs =
      1000
      / this.options.targetSampleRateHz;

    this.observerMinAttemptIntervalMs =
      1000
      / this.options.observerSampleRateHz;
  }

  /* ========================================================================
   * Initialization
   * ====================================================================== */

  public async initialize(): Promise<void> {
    if (this.lifecycle === "READY") {
      return;
    }

    if (this.lifecycle === "INITIALIZING") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Gaze predictor is already initializing."
      );
    }

    if (this.lifecycle === "DISPOSED") {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed gaze predictor cannot be initialized."
      );
    }

    this.lifecycle =
      "INITIALIZING";

    this.resetRuntimeCounters();

    let primaryInitializationError:
      TrackerError | null =
        null;

    let fallbackInitializationError:
      TrackerError | null =
        null;

    let observerInitializationError:
      TrackerError | null =
        null;

    try {
      await this.primaryEngine.initialize();

      this.primaryAvailable =
        this.primaryEngine
          .getSnapshot()
          .initialized;
    } catch (error: unknown) {
      primaryInitializationError =
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          "Primary gaze engine initialization failed."
        );

      this.primaryAvailable =
        false;

      logger.warn(
        "Primary gaze engine unavailable; fallback initialization will continue.",
        {
          source:
            this.primaryEngine.source,
          error:
            getErrorSummary(
              primaryInitializationError
            )
        }
      );
    }

    if (this.fallbackEngine !== null) {
      try {
        await this.fallbackEngine.initialize();

        this.fallbackAvailable =
          this.fallbackEngine
            .getSnapshot()
            .initialized;
      } catch (error: unknown) {
        fallbackInitializationError =
          normalizeTrackerError(
            error,
            ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
            "GAZE",
            "Fallback gaze engine initialization failed."
          );

        this.fallbackAvailable =
          false;

        logger.warn(
          "Fallback gaze engine is unavailable.",
          {
            source:
              this.fallbackEngine.source,
            error:
              getErrorSummary(
                fallbackInitializationError
              )
          }
        );
      }
    } else {
      this.fallbackAvailable =
        false;
    }

    if (this.observerEngine !== null) {
      try {
        await this.observerEngine.initialize();

        this.observerAvailable =
          this.observerEngine
            .getSnapshot()
            .initialized;
      } catch (error: unknown) {
        observerInitializationError =
          normalizeTrackerError(
            error,
            ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
            "GAZE",
            "Observer gaze engine initialization failed."
          );

        this.observerAvailable =
          false;

        logger.warn(
          "Observer gaze engine is unavailable; baseline tracking will continue.",
          {
            source:
              this.observerEngine.source,
            error:
              getErrorSummary(
                observerInitializationError
              )
          }
        );
      }
    } else {
      this.observerAvailable =
        false;
    }

    if (
      !this.primaryAvailable
      && !this.fallbackAvailable
    ) {
      this.lifecycle =
        "ERROR";

      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "No gaze engine could be initialized.",
        {
          details: {
            primarySource:
              this.primaryEngine.source,
            primaryError:
              primaryInitializationError === null
                ? null
                : getErrorSummary(
                    primaryInitializationError
                  ),
            fallbackSource:
              this.fallbackEngine?.source
              ?? null,
            fallbackError:
              fallbackInitializationError === null
                ? null
                : getErrorSummary(
                    fallbackInitializationError
                  )
          },
          cause:
            fallbackInitializationError
            ?? primaryInitializationError
            ?? undefined
        }
      );
    }

    this.lifecycle =
      "READY";

    logger.info(
      "Gaze predictor initialized.",
      {
        primarySource:
          this.primaryEngine.source,
        primaryAvailable:
          this.primaryAvailable,
        fallbackSource:
          this.fallbackEngine?.source
          ?? null,
        fallbackAvailable:
          this.fallbackAvailable,
        observerSource:
          this.observerEngine?.source
          ?? null,
        observerAvailable:
          this.observerAvailable,
        observerSampleRateHz:
          this.options.observerSampleRateHz,
        targetSampleRateHz:
          this.options.targetSampleRateHz
      }
    );

    if (
      observerInitializationError === null
      && this.observerAvailable
      && this.observerEngine !== null
    ) {
      logger.info(
        "Deep gaze observer is active in shadow mode; WebEyeTrack remains the calibration output until a personal screen mapper is available.",
        {
          observerSource:
            this.observerEngine.source,
          observerSampleRateHz:
            this.options.observerSampleRateHz
        }
      );
    }
  }

  /* ========================================================================
   * Prediction
   * ====================================================================== */

  public async predict(
    input: GazeEngineFrameInput
  ): Promise<GazePrediction | null> {
    this.assertReady();

    if (
      isSameFrame(
        input,
        this.lastProcessedFrameSequence,
        this.lastProcessedFrameTimestampMs
      )
    ) {
      this.duplicateFrameCount += 1;

      return null;
    }

    const timestampMs =
      input.frame.metadata.timestampMs;

    if (
      this.lastAttemptTimestampMs !== null
      && timestampMs
        >= this.lastAttemptTimestampMs
      && timestampMs
        - this.lastAttemptTimestampMs
        < this.minAttemptIntervalMs
    ) {
      this.rateLimitedFrameCount += 1;
      this.rememberProcessedFrame(input);

      return null;
    }

    this.lastAttemptTimestampMs =
      timestampMs;

    this.rememberProcessedFrame(input);

    this.maybeStartObserverPrediction(
      input
    );

    let primaryError:
      TrackerError | null =
        null;

    if (this.primaryAvailable) {
      try {
        const primaryPrediction =
          await this.primaryEngine.predict(
            input
          );

        if (primaryPrediction !== null) {
          this.rememberPrediction(
            primaryPrediction
          );

          return primaryPrediction;
        }

        if (
          !this.options
            .fallbackOnNullPrediction
        ) {
          return null;
        }
      } catch (error: unknown) {
        primaryError =
          normalizeTrackerError(
            error,
            ERROR_CODES.GAZE_PREDICTION_FAILED,
            "GAZE",
            "Primary gaze prediction failed.",
            {
              details: {
                source:
                  this.primaryEngine.source,
                frameSequence:
                  input.frame.metadata
                    .frameSequence,
                timestampMs
              }
            }
          );

        this.primaryPredictionFailureCount += 1;

        logger.warn(
          "Primary gaze prediction failed; attempting fallback.",
          {
            source:
              this.primaryEngine.source,
            frameSequence:
              input.frame.metadata
                .frameSequence,
            error:
              getErrorSummary(
                primaryError
              )
          }
        );
      }
    }

    if (
      this.fallbackEngine !== null
      && this.fallbackAvailable
    ) {
      try {
        const fallbackPrediction =
          await this.fallbackEngine.predict(
            input
          );

        if (fallbackPrediction !== null) {
          this.fallbackPredictionUseCount += 1;

          this.rememberPrediction(
            fallbackPrediction
          );

          return fallbackPrediction;
        }
      } catch (error: unknown) {
        const fallbackError =
          normalizeTrackerError(
            error,
            ERROR_CODES.GAZE_PREDICTION_FAILED,
            "GAZE",
            "Fallback gaze prediction failed.",
            {
              details: {
                source:
                  this.fallbackEngine.source,
                frameSequence:
                  input.frame.metadata
                    .frameSequence,
                timestampMs
              }
            }
          );

        if (primaryError !== null) {
          throw new TrackerError(
            ERROR_CODES.GAZE_PREDICTION_FAILED,
            "GAZE",
            "Both primary and fallback gaze predictions failed.",
            {
              recoverable: true,
              details: {
                frameSequence:
                  input.frame.metadata
                    .frameSequence,
                timestampMs,
                primarySource:
                  this.primaryEngine.source,
                primaryError:
                  getErrorSummary(
                    primaryError
                  ),
                fallbackSource:
                  this.fallbackEngine.source,
                fallbackError:
                  getErrorSummary(
                    fallbackError
                  )
              },
              cause:
                fallbackError
            }
          );
        }

        throw fallbackError;
      }
    }

    if (primaryError !== null) {
      throw primaryError;
    }

    return null;
  }

  /* ========================================================================
   * Observer sample bridge
   * ====================================================================== */

  /**
   * Registers one synchronous runtime-only consumer for completed deep
   * observations. The callback receives copied numeric data only; no webcam
   * frame or landmark object crosses this boundary.
   */
  public setObserverSampleListener(
    listener: GazeObserverSampleListener | null
  ): void {
    this.observerSampleListener = listener;
  }

  /**
   * Temporarily pauses only the non-authoritative deep observer. The primary
   * WebEyeTrack and Ridge fallback remain untouched. An in-flight observer
   * prediction is allowed to finish but its result is discarded. No new observer
   * inference starts while suspended.
   */
  public setObserverSuspended(
    suspended: boolean,
    reason: string | null = null
  ): void {
    const nextReason = suspended ? reason : null;

    if (
      this.observerSuspended === suspended
      && this.observerSuspensionReason === nextReason
    ) {
      return;
    }

    this.invalidateObserverSamples();
    this.observerSuspended = suspended;
    this.observerSuspensionReason = nextReason;

    logger.info(
      suspended
        ? "Deep gaze observer suspended; authoritative baseline tracking continues."
        : "Deep gaze observer resumed.",
      {
        reason: this.observerSuspensionReason,
        observerSource: this.observerEngine?.source ?? null,
        lastInferenceLatencyMs:
          this.observerLastPrediction?.inferenceLatencyMs ?? null
      }
    );
  }

  /** Discard late results without starting overlapping inference or changing fitted models. */
  public invalidateObserverSamples(): void {
    this.observerGeneration += 1;
    this.observerLastPrediction = null;
    this.observerLastAttemptTimestampMs = null;
  }

  public isObserverSuspended(): boolean {
    return this.observerSuspended;
  }

  /* ========================================================================
   * Snapshot
   * ====================================================================== */

  /**
   * Starts a calibration-only WebEyeTrack few-shot personalization session.
   * The concrete backend restores the pinned generic BlazeGaze weights first,
   * so recalibration never compounds a prior participant adaptation.
   */
  public beginPrimaryPersonalizationSession(): boolean {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return false;
    }

    return this.primaryEngine
      .beginPersonalizationSession();
  }

  /**
   * Copies the vendor features associated with the just-accepted gaze frame
   * into a bounded calibration-only candidate buffer.
   */
  public recordPrimaryPersonalizationCandidate(
    pointIndex: number,
    expectedTimestampMs: number
  ): boolean {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return false;
    }

    return this.primaryEngine
      .recordLatestPersonalizationCandidate(
        pointIndex,
        expectedTimestampMs
      );
  }

  /**
   * Selects one native support sample from the stable window chosen by the
   * project calibration collector. The target remains project normalized 0..1;
   * the WebEyeTrack bridge converts it to the upstream centered convention.
   */
  public stagePrimaryPersonalizationPoint(
    pointIndex: number,
    targetNormalizedPoint: Point2D,
    stableWindowStartTimestampMs: number,
    stableWindowEndTimestampMs: number
  ): boolean {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return false;
    }

    return this.primaryEngine
      .stagePersonalizationPoint(
        pointIndex,
        targetNormalizedPoint,
        stableWindowStartTimestampMs,
        stableWindowEndTimestampMs
      );
  }

  public async applyPrimaryPersonalization():
  Promise<WebEyeTrackPersonalizationResult> {
    if (!(this.primaryEngine instanceof WebEyeTrackEngine)) {
      return {
        applied: false,
        stagedPointCount: 0,
        supportPointCount: 0
      };
    }

    return this.primaryEngine
      .applyPersonalization();
  }

  public getSnapshot(): GazePredictorSnapshot {
    return {
      lifecycle:
        this.lifecycle,

      targetSampleRateHz:
        this.options.targetSampleRateHz,

      primary:
        this.primaryEngine.getSnapshot(),

      fallback:
        this.fallbackEngine?.getSnapshot()
        ?? null,

      primaryAvailable:
        this.primaryAvailable,

      fallbackAvailable:
        this.fallbackAvailable,

      activeSource:
        this.activeSource,

      lastAttemptTimestampMs:
        this.lastAttemptTimestampMs,

      lastPredictionTimestampMs:
        this.lastPredictionTimestampMs,

      lastProcessedFrameSequence:
        this.lastProcessedFrameSequence,

      primaryPredictionFailureCount:
        this.primaryPredictionFailureCount,

      fallbackPredictionUseCount:
        this.fallbackPredictionUseCount,

      rateLimitedFrameCount:
        this.rateLimitedFrameCount,

      duplicateFrameCount:
        this.duplicateFrameCount,

      observer:
        this.createObserverSnapshot()
    };
  }

  /**
   * Returns the latest transient feature generated by the observer engine.
   *
   * The array is cloned by the provider before it leaves the engine. The
   * predictor never persists it. A later calibration mapper can consume this
   * method without becoming coupled to UniversalDeepEngine itself.
   */
  public getLatestObserverFeatureSnapshot():
  GazeFeatureSnapshot | null {
    if (
      this.observerEngine === null
      || !isGazeFeatureProvider(
        this.observerEngine
      )
    ) {
      return null;
    }

    return this.observerEngine
      .getLatestFeatureSnapshot();
  }

  /* ========================================================================
   * Disposal
   * ====================================================================== */

  public async dispose(): Promise<void> {
    if (this.lifecycle === "DISPOSED") {
      return;
    }

    this.lifecycle =
      "DISPOSED";
    this.invalidateObserverSamples();

    this.observerSampleListener =
      null;

    const engines: GazeEngine[] = [
      this.primaryEngine
    ];

    if (
      this.fallbackEngine !== null
      && this.fallbackEngine
        !== this.primaryEngine
    ) {
      engines.push(
        this.fallbackEngine
      );
    }

    if (
      this.observerEngine !== null
      && this.observerEngine
        !== this.primaryEngine
      && this.observerEngine
        !== this.fallbackEngine
    ) {
      engines.push(
        this.observerEngine
      );
    }

    for (const engine of engines) {
      try {
        await engine.dispose();
      } catch (error: unknown) {
        logger.warn(
          "Gaze engine disposal failed.",
          {
            source:
              engine.source,
            error
          }
        );
      }
    }

    this.primaryAvailable =
      false;

    this.fallbackAvailable =
      false;

    this.observerAvailable =
      false;

    this.observerPredictionInFlight =
      false;

    this.observerSuspended =
      false;

    this.observerSuspensionReason =
      null;

    this.activeSource =
      null;

    this.lastAttemptTimestampMs =
      null;

    this.lastPredictionTimestampMs =
      null;

    this.lastProcessedFrameSequence =
      null;

    this.lastProcessedFrameTimestampMs =
      null;

    this.observerLastAttemptTimestampMs =
      null;

    this.observerLastPrediction =
      null;
  }

  /* ========================================================================
   * Internal state helpers
   * ====================================================================== */

  private assertReady(): void {
    if (this.lifecycle === "READY") {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "Gaze predictor is not ready for prediction.",
      {
        details: {
          lifecycle:
            this.lifecycle
        }
      }
    );
  }

  private rememberProcessedFrame(
    input: GazeEngineFrameInput
  ): void {
    this.lastProcessedFrameSequence =
      input.frame.metadata.frameSequence;

    this.lastProcessedFrameTimestampMs =
      input.frame.metadata.timestampMs;
  }

  private rememberPrediction(
    prediction: GazePrediction
  ): void {
    this.activeSource =
      prediction.source;

    this.lastPredictionTimestampMs =
      prediction.timestampMs;
  }

  private maybeStartObserverPrediction(
    input: GazeEngineFrameInput
  ): void {
    if (
      this.observerEngine === null
      || !this.observerAvailable
      || this.observerSuspended
    ) {
      return;
    }

    if (this.observerPredictionInFlight) {
      this.observerInFlightSkippedFrameCount += 1;
      return;
    }

    const timestampMs =
      input.frame.metadata.timestampMs;

    const adaptiveObserverIntervalMs =
      Math.max(
        this.observerMinAttemptIntervalMs,
        (this.observerLastPrediction?.inferenceLatencyMs ?? 0) * 1.25
      );

    if (
      this.observerLastAttemptTimestampMs !== null
      && timestampMs
        >= this.observerLastAttemptTimestampMs
      && timestampMs
        - this.observerLastAttemptTimestampMs
        < adaptiveObserverIntervalMs
    ) {
      this.observerRateLimitedFrameCount += 1;
      return;
    }

    this.observerLastAttemptTimestampMs =
      timestampMs;

    this.observerPredictionInFlight =
      true;

    this.observerAttemptCount += 1;

    void this.runObserverPrediction(
      input
    );
  }

  private async runObserverPrediction(
    input: GazeEngineFrameInput
  ): Promise<void> {
    const observerEngine =
      this.observerEngine;

    if (observerEngine === null) {
      this.observerPredictionInFlight =
        false;
      return;
    }

    const generation = this.observerGeneration;
    const startedAtMs =
      performance.now();

    try {
      const prediction =
        await observerEngine.predict(input);

      if (
        generation !== this.observerGeneration
        || this.lifecycle !== "READY"
        || this.observerSuspended
      ) {
        return;
      }

      const inferenceLatencyMs =
        performance.now()
        - startedAtMs;

      if (prediction === null) {
        this.observerNullPredictionCount += 1;
        return;
      }

      this.observerSuccessCount += 1;

      const predictionSnapshot:
        GazeObserverPredictionSnapshot = {
          frameSequence:
            input.frame.metadata.frameSequence,
          timestampMs:
            prediction.timestampMs,
          source:
            prediction.source,
          rawPoint: {
            ...prediction.rawPoint
          },
          rawSpace:
            prediction.rawSpace,
          confidence:
            prediction.confidence,
          inferenceLatencyMs
        };

      this.observerLastPrediction =
        predictionSnapshot;

      this.emitObserverRuntimeSample(
        observerEngine,
        input,
        predictionSnapshot
      );

      if (
        this.observerSuccessCount === 1
        || this.observerSuccessCount % 25 === 0
      ) {
        logger.info(
          "Deep gaze observer prediction received.",
          {
            successCount:
              this.observerSuccessCount,
            frameSequence:
              input.frame.metadata.frameSequence,
            source:
              prediction.source,
            rawSpace:
              prediction.rawSpace,
            yawRad:
              prediction.rawPoint.x,
            pitchRad:
              prediction.rawPoint.y,
            confidence:
              prediction.confidence,
            inferenceLatencyMs
          }
        );
      }
    } catch (error: unknown) {
      this.observerFailureCount += 1;

      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_PREDICTION_FAILED,
          "GAZE",
          "Observer gaze prediction failed.",
          {
            details: {
              source:
                observerEngine.source,
              frameSequence:
                input.frame.metadata.frameSequence,
              timestampMs:
                input.frame.metadata.timestampMs
            }
          }
        );

      if (
        this.observerFailureCount <= 3
        || this.observerFailureCount % 10 === 0
      ) {
        logger.warn(
          "Deep gaze observer prediction failed; baseline tracking continues.",
          {
            failureCount:
              this.observerFailureCount,
            error:
              getErrorSummary(normalized)
          }
        );
      }
    } finally {
      this.observerPredictionInFlight =
        false;
    }
  }

  private emitObserverRuntimeSample(
    observerEngine: GazeEngine,
    input: GazeEngineFrameInput,
    prediction: GazeObserverPredictionSnapshot
  ): void {
    const listener =
      this.observerSampleListener;

    if (
      listener === null
      || !isGazeFeatureProvider(observerEngine)
    ) {
      return;
    }

    const feature =
      observerEngine.getLatestFeatureSnapshot();

    const faceGeometry =
      input.faceGeometry.geometry;

    const headPose =
      input.headPose.headPose;

    const leftEye =
      input.eyeGeometry.leftEye;

    const rightEye =
      input.eyeGeometry.rightEye;

    if (
      feature === null
      || feature.frameSequence
        !== prediction.frameSequence
      || feature.timestampMs
        !== prediction.timestampMs
      || faceGeometry === null
      || headPose === null
      || leftEye === null
      || rightEye === null
    ) {
      return;
    }

    const sample:
      GazeObserverRuntimeSample = {
        prediction: {
          ...prediction,
          rawPoint: {
            ...prediction.rawPoint
          }
        },
        feature: {
          frameSequence:
            feature.frameSequence,
          timestampMs:
            feature.timestampMs,
          values:
            new Float32Array(
              feature.values
            )
        },
        geometry: {
          headPose: {
            ...headPose
          },
          faceCenterNormalized: {
            ...faceGeometry.centerNormalized
          },
          faceWidthRatio:
            faceGeometry.widthRatio,
          faceHeightRatio:
            faceGeometry.heightRatio,
          faceDistanceRatio:
            input.faceQuality
              .trackingQuality
              .faceDistanceRatio,
          leftIrisHorizontalOffsetRatio:
            leftEye
              .irisHorizontalOffsetRatio,
          leftIrisVerticalOffsetRatio:
            leftEye
              .irisVerticalOffsetRatio,
          rightIrisHorizontalOffsetRatio:
            rightEye
              .irisHorizontalOffsetRatio,
          rightIrisVerticalOffsetRatio:
            rightEye
              .irisVerticalOffsetRatio
        },
        quality: {
          usableForGaze:
            input.faceQuality.usableForGaze,
          faceValid:
            input.faceQuality.trackingQuality.faceValid,
          eyesValid:
            input.faceQuality.trackingQuality.eyesValid,
          blink:
            input.faceQuality.trackingQuality.blink
            || input.blink.blinkInProgress
            || input.blink.bothEyesClosed,
          qualityScore:
            input.faceQuality.trackingQuality.qualityScore,
          qualityLevel:
            input.faceQuality.trackingQuality.qualityLevel
        }
      };

    try {
      listener(sample);
    } catch (error: unknown) {
      logger.warn(
        "Deep observer sample listener failed; baseline and observer inference continue.",
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown observer listener error"
        }
      );
    }
  }

  private createObserverSnapshot():
  GazeObserverSnapshot {
    return {
      engine:
        this.observerEngine
          ?.getSnapshot()
        ?? null,
      available:
        this.observerAvailable,
      inFlight:
        this.observerPredictionInFlight,
      suspended:
        this.observerSuspended,
      suspensionReason:
        this.observerSuspensionReason,
      targetSampleRateHz:
        this.options.observerSampleRateHz,
      lastAttemptTimestampMs:
        this.observerLastAttemptTimestampMs,
      lastPrediction:
        this.observerLastPrediction === null
          ? null
          : {
              ...this.observerLastPrediction,
              rawPoint: {
                ...this.observerLastPrediction
                  .rawPoint
              }
            },
      attemptCount:
        this.observerAttemptCount,
      successCount:
        this.observerSuccessCount,
      nullPredictionCount:
        this.observerNullPredictionCount,
      failureCount:
        this.observerFailureCount,
      rateLimitedFrameCount:
        this.observerRateLimitedFrameCount,
      inFlightSkippedFrameCount:
        this.observerInFlightSkippedFrameCount
    };
  }

  private resetRuntimeCounters(): void {
    this.primaryAvailable =
      false;

    this.fallbackAvailable =
      false;

    this.observerAvailable =
      false;

    this.observerPredictionInFlight =
      false;

    this.observerSuspended =
      false;

    this.observerSuspensionReason =
      null;

    this.activeSource =
      null;

    this.lastAttemptTimestampMs =
      null;

    this.lastPredictionTimestampMs =
      null;

    this.lastProcessedFrameSequence =
      null;

    this.lastProcessedFrameTimestampMs =
      null;

    this.primaryPredictionFailureCount =
      0;

    this.fallbackPredictionUseCount =
      0;

    this.rateLimitedFrameCount =
      0;

    this.duplicateFrameCount =
      0;

    this.observerLastAttemptTimestampMs =
      null;

    this.observerLastPrediction =
      null;

    this.observerAttemptCount =
      0;

    this.observerSuccessCount =
      0;

    this.observerNullPredictionCount =
      0;

    this.observerFailureCount =
      0;

    this.observerRateLimitedFrameCount =
      0;

    this.observerInFlightSkippedFrameCount =
      0;
  }
}
