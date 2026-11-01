import {
  CameraManager
} from "../camera/cameraManager";

import {
  CalibrationManager
} from "../calibration/calibrationManager";

import type {
  CalibrationManagerPointResult
} from "../calibration/calibrationManager";

import {
  createIdentityCalibrationResidualModel
} from "../calibration/calibrationModel";

import {
  PreCalibrationMonitor
} from "../calibration/preCalibration";

import {
  ValidationManager
} from "../calibration/validationManager";

import type {
  ValidationManagerPointResult
} from "../calibration/validationManager";

import {
  CameraQualityEstimator
} from "../camera/cameraQuality";

import {
  FrameCapture
} from "../camera/frameCapture";

import {
  BlinkDetector
} from "../face/blinkDetector";

import {
  EyeGeometryAnalyzer
} from "../face/eyeGeometry";

import {
  FaceGeometryAnalyzer
} from "../face/faceGeometry";

import {
  FaceLandmarker
} from "../face/faceLandmarker";

import {
  FaceQualityEvaluator
} from "../face/faceQuality";

import {
  HeadPoseEstimator
} from "../face/headPose";

import {
  GazePredictor
} from "../gaze/gazePredictor";

import type {
  GazeObserverRuntimeSample,
  GazeObserverSnapshot
} from "../gaze/gazePredictor";

import {
  DeepPersonalMapper
} from "../gaze/deepPersonalMapper";

import {
  RuntimeDeepFeatureAggregator
} from "../gaze/runtimeDeepFeatureAggregator";

import {
  meanSynchronizedSourceBaseline
} from "../gaze/runtimeDeepSourceAlignment";

import {
  RuntimeGazePrecisionEstimator
} from "../gaze/runtimeGazePrecisionEstimator";

import {
  RuntimeGazeDriftMonitor
} from "../gaze/runtimeGazeDriftMonitor";
import type {
  RuntimeGazeDriftMonitorState
} from "../gaze/runtimeGazeDriftMonitor";

import {
  DeepIndependentValidator
} from "../gaze/deepIndependentValidator";

import {
  CalibrationHybridSelector
} from "../gaze/calibrationHybridSelector";

import type {
  HybridDriftContext
} from "../gaze/calibrationHybridSelector";

import {
  evaluateHybridIndependentValidation
} from "../gaze/hybridIndependentEvaluator";

import {
  createDeepRuntimeCandidate,
  selectSessionRuntimeGaze
} from "../gaze/sessionGazeRuntimeRouter";

import {
  planAdaptiveCalibrationExpansion
} from "../gaze/calibrationAdaptiveExpansion";

import {
  evaluateBaselineSessionStrategyValidation,
  evaluateSelectedSessionStrategyValidation
} from "../gaze/sessionStrategyValidationGate";

import {
  AuthoritativeGazeStabilizer
} from "../gaze/authoritativeGazeStabilizer";

import {
  FixationDetector
} from "../gaze/fixationDetector";

import type {
  AuthoritativeGazeStabilizationResult
} from "../gaze/authoritativeGazeStabilizer";

import type {
  FixationDetectionResult
} from "../gaze/fixationDetector";

import type {
  SessionStrategyValidationResult
} from "../gaze/sessionStrategyValidationGate";

import type {
  PersonalizedDeepRuntimeCandidate,
  SessionGazeRuntimeSelection
} from "../gaze/sessionGazeRuntimeRouter";

import {
  ResidualCorrector
} from "../gaze/residualCorrector";

import {
  evaluateGazeQuality
} from "../gaze/gazeQuality";

import {
  validateGazePrediction
} from "../gaze/gazeValidator";

import {
  CALIBRATION,
  DEEP_PERSONALIZATION,
  FACE_PIPELINE_RUNTIME,
  QUICK_RECALIBRATION,
  RUNTIME_MAINTENANCE
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  normalizeTrackerError
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import {
  nowEpochMs,
  nowTimelineMs
} from "../shared/utils";

import type {
  CameraRequest
} from "../camera/cameraConfig";

import type {
  CameraFrameView
} from "../camera/frameCapture";

import type {
  FaceQualityFrameResult
} from "../face/faceQuality";

import type {
  GazeEngineFrameInput
} from "../gaze/GazeEngine";

import type {
  GazeQualityResult
} from "../gaze/gazeQuality";

import type {
  GazeValidationResult
} from "../gaze/gazeValidator";

import type {
  BlinkFrameResult
} from "../face/blinkDetector";

import type {
  EyeGeometryFrameResult
} from "../face/eyeGeometry";

import type {
  FaceGeometryFrameResult
} from "../face/faceGeometry";

import type {
  FaceLandmarkerFrameResult
} from "../face/faceLandmarker";

import type {
  HeadPoseFrameResult
} from "../face/headPose";

import type {
  CalibrationId,
  CalibrationMode,
  CalibrationTarget,
  CameraQuality,
  CameraSettings,
  EpochMs,
  DriftStatus,
  FaceBaseline,
  GazeEngineSource,
  GazePrediction,
  Point2D,
  PreCalibrationFeedback,
  Size2D
} from "../shared/types";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("OFFSCREEN");

/* ========================================================================== 
 * Runtime lifecycle
 * ======================================================================== */

/**
 * Internal lifecycle of the Offscreen TrackerRuntime.
 *
 * IMPORTANT:
 * This is NOT the experiment's authoritative TrackerState.
 *
 * The authoritative tracker state remains owned by the background
 * TrackerStateMachine.
 */
export type TrackerRuntimeLifecycle =
  | "CREATED"
  | "INITIALIZING"
  | "READY"
  | "DISPOSING"
  | "DISPOSED"
  | "ERROR";

export interface TrackerRuntimeSnapshot {
  lifecycle: TrackerRuntimeLifecycle;

  initializedAtEpochMs:
    EpochMs | null;

  disposedAtEpochMs:
    EpochMs | null;

  hasVideoElement: boolean;

  hasAttachedMediaStream: boolean;

  cameraRunning: boolean;

  cameraSettings:
    CameraSettings | null;

  faceLandmarkerReady: boolean;

  faceAnalysisRunning: boolean;

  lastFaceAnalysisTimestampMs:
    number | null;

  gazePredictorReady: boolean;

  gazePredictionInFlight: boolean;

  lastGazePredictionTimestampMs:
    number | null;

  lastGazeSource:
    GazeEngineSource | null;

  faceBaselineReady: boolean;

  calibrationActive: boolean;

  calibrationModelReady: boolean;
}

export interface GazeRuntimeFrameResult {
  readonly frameSequence: number;
  /** Established WebEyeTrack/raw baseline prediction retained for calibration. */
  readonly prediction: GazePrediction;
  readonly validation: GazeValidationResult;
  readonly quality: GazeQualityResult;
  readonly observer: GazeObserverSnapshot;
  /**
   * Calibration-selected live tracking output. Calibration and independent
   * validation continue to consume `prediction`, so this promotion cannot
   * leak validation targets back into model selection.
   */
  readonly authoritativeGaze: SessionGazeRuntimeSelection;
  /** Persistent calibration-pose drift diagnostic for runtime maintenance. */
  readonly driftStatus: DriftStatus | null;
  /** Raw face/gaze quality after applying target-free runtime pose drift penalty. */
  readonly effectiveQualityScore: number;
  /** Target-free precision diagnostics used by the adaptive hybrid router. */
  readonly baselinePrecisionPx: number | null;
  readonly deepPrecisionPx: number | null;
  /** True when persistent pose OOD suspends research collection pending recalibration. */
  readonly collectionSuspendedForDrift: boolean;
  /** True while a short maintenance calibration/re-validation overlay is active. */
  readonly maintenanceCalibrationActive: boolean;
  /**
   * D21 research-safe derived stream. Raw/authoritative gaze remains intact;
   * calibration and independent validation never consume this output.
   */
  readonly stabilizedGaze: AuthoritativeGazeStabilizationResult;
  /**
   * D22 online fixation state derived only from valid stabilized gaze.
   * Raw/authoritative gaze and independent validation remain untouched.
   */
  readonly fixation: FixationDetectionResult;
}

export type TrackerRuntimeErrorHandler = (
  error: TrackerError
) => void;

export type FaceQualityFrameHandler = (
  result: FaceQualityFrameResult,
  feedback: PreCalibrationFeedback
) => void;

export type GazeRuntimeFrameHandler = (
  result: GazeRuntimeFrameResult
) => void;

interface FacePipelineFrameBundle {
  readonly frame: CameraFrameView;
  readonly landmarker: FaceLandmarkerFrameResult;
  readonly faceGeometry: FaceGeometryFrameResult;
  readonly headPose: HeadPoseFrameResult;
  readonly eyeGeometry: EyeGeometryFrameResult;
  readonly blink: BlinkFrameResult;
  readonly quality: FaceQualityFrameResult;
}

interface RuntimeBaselineHistorySample {
  readonly frameSequence: number;
  readonly timestampMs: number;
  readonly normalizedPoint: Point2D;
}

/* ========================================================================== 
 * Tracker runtime
 * ======================================================================== */

/**
 * Long-lived runtime hosted by the Chrome Offscreen Document.
 *
 * Responsibilities include orchestration of the local camera/model runtime.
 * Browser/session/navigation ownership remains in the background service
 * worker.
 */
interface QuickCalibrationCheckpoint {
  readonly calibrationManager: CalibrationManager;
  readonly deepPersonalMapper: DeepPersonalMapper;
  readonly calibrationHybridSelector: CalibrationHybridSelector;
  readonly residualCorrector: ResidualCorrector;
  readonly validationManager: ValidationManager;
  readonly deepIndependentValidator: DeepIndependentValidator;
  readonly authoritativeSessionValidationReady: boolean;
  readonly authoritativeSessionDegradedCollectionAllowed: boolean;
  readonly selectedStrategyValidationResult: SessionStrategyValidationResult | null;
  readonly deepSessionStrategyEligible: boolean;
  readonly forceBaselineSessionStrategy: boolean;
  readonly independentValidationActive: boolean;
  readonly driftMonitorResumeAfterTimestampMs: number;
  readonly faceBaseline: FaceBaseline | null;
  readonly driftMonitorState: RuntimeGazeDriftMonitorState;
}

export class TrackerRuntime {
  private lifecycle:
    TrackerRuntimeLifecycle =
      "CREATED";

  private initializedAtEpochMs:
    EpochMs | null =
      null;

  private disposedAtEpochMs:
    EpochMs | null =
      null;

  private cameraManager:
    CameraManager | null =
      null;

  private frameCapture:
    FrameCapture | null =
      null;

  private cameraQualityEstimator:
    CameraQualityEstimator | null =
      null;

  private faceLandmarker:
    FaceLandmarker | null =
      null;

  private faceGeometryAnalyzer:
    FaceGeometryAnalyzer | null =
      null;

  private headPoseEstimator:
    HeadPoseEstimator | null =
      null;

  private eyeGeometryAnalyzer:
    EyeGeometryAnalyzer | null =
      null;

  private blinkDetector:
    BlinkDetector | null =
      null;

  private faceQualityEvaluator:
    FaceQualityEvaluator | null =
      null;

  private preCalibrationMonitor:
    PreCalibrationMonitor | null =
      null;

  private calibrationManager:
    CalibrationManager | null =
      null;

  private residualCorrector:
    ResidualCorrector | null =
      null;

  private validationManager:
    ValidationManager | null =
      null;

  private deepPersonalMapper:
    DeepPersonalMapper | null =
      null;

  private deepIndependentValidator:
    DeepIndependentValidator | null =
      null;

  private calibrationHybridSelector:
    CalibrationHybridSelector | null =
      null;

  private activeDeepCalibrationSamples:
    GazeObserverRuntimeSample[] = [];

  private activeDeepValidationSamples:
    GazeObserverRuntimeSample[] = [];

  private deepPersonalPredictionCount =
    0;

  private latestPersonalizedDeepRuntimeCandidate:
    PersonalizedDeepRuntimeCandidate | null =
      null;

  private readonly runtimeBaselineHistory =
    new Map<number, RuntimeBaselineHistorySample>();

  private authoritativeSessionValidationReady =
    false;

  /**
   * POOR validation may continue in explicitly degraded collection mode after
   * the UI warns that recalibration is recommended. This flag never changes
   * the validation quality itself and is reset on every new calibration.
   */
  private authoritativeSessionDegradedCollectionAllowed =
    false;

  private selectedStrategyValidationResult:
    SessionStrategyValidationResult | null =
      null;

  /**
   * V6: Deep/Hybrid may remain available for shadow diagnostics while being
   * ineligible for authoritative session routing on slow/sparse devices.
   */
  private deepSessionStrategyEligible = false;

  /**
   * Safety-only demotion. Independent validation may force an already-fitted
   * Deep/Hybrid strategy back to Baseline, but never promotes or retunes it.
   */
  private forceBaselineSessionStrategy = false;

  /** Validation targets must never feed the runtime drift maintenance gate. */
  private independentValidationActive = false;

  private driftMonitorResumeAfterTimestampMs = 0;

  private adaptiveCalibrationExpansionEvaluated =
    false;

  private readonly authoritativeGazeStabilizer =
    new AuthoritativeGazeStabilizer();

  private readonly runtimeDeepFeatureAggregator =
    new RuntimeDeepFeatureAggregator();

  private readonly baselinePrecisionEstimator =
    new RuntimeGazePrecisionEstimator({
      windowMs: DEEP_PERSONALIZATION.BASELINE_PRECISION_WINDOW_MS,
      minSamples: DEEP_PERSONALIZATION.BASELINE_PRECISION_MIN_SAMPLES,
      maxFixationSpeedPxPerSecond:
        DEEP_PERSONALIZATION.PRECISION_MAX_FIXATION_SPEED_PX_PER_SECOND
    });

  private readonly deepPrecisionEstimator =
    new RuntimeGazePrecisionEstimator({
      windowMs: DEEP_PERSONALIZATION.DEEP_PRECISION_WINDOW_MS,
      minSamples: DEEP_PERSONALIZATION.DEEP_PRECISION_MIN_SAMPLES,
      maxFixationSpeedPxPerSecond:
        DEEP_PERSONALIZATION.PRECISION_MAX_FIXATION_SPEED_PX_PER_SECOND
    });

  private readonly runtimeGazeDriftMonitor =
    new RuntimeGazeDriftMonitor();

  private latestBaselinePrecisionPx: number | null = null;
  private latestDeepPrecisionPx: number | null = null;
  private lastLoggedRuntimeDriftSeverity: DriftStatus["severity"] | null = null;

  private quickRecalibrationActive = false;
  private quickRecalibrationCheckpoint: QuickCalibrationCheckpoint | null = null;
  private quickRecalibrationRunSequence = 0;
  private quickRecalibrationRunId: string | null = null;
  private completedQuickValidationResult: SessionStrategyValidationResult | null = null;
  private quickRecalibrationTimeoutId: number | null = null;


  /**
   * User preference. Drift/precision diagnostics keep running when disabled,
   * but automatic maintenance must not interrupt or suspend collection.
   */
  private automaticQuickRecalibrationEnabled: boolean =
    QUICK_RECALIBRATION.DEFAULT_ENABLED;

  private readonly fixationDetector =
    new FixationDetector();

  /**
   * Current research-page CSS viewport. Validation initializes this value and
   * Content keeps it synchronized afterwards because browser zoom/DPR may
   * change between hosts or tabs.
   */
  private trackingViewportSize:
    Size2D | null = null;


  private activeCalibrationPointRequest:
    {
      calibrationId: CalibrationId;
      pointIndex: number;
      targetNormalizedPoint: Point2D;
      targetViewportPoint: Point2D;
      targetShownAtMs: number;
      resolve: (
        result: CalibrationManagerPointResult
      ) => void;
      reject: (error: unknown) => void;
      timeoutId: number;
      deepGraceTimeoutId: number | null;
      baselineReadyAtMs: number | null;
    } | null =
      null;

  private activeValidationPointRequest:
    {
      calibrationId: CalibrationId;
      pointIndex: number;
      targetNormalizedPoint: Point2D;
      targetViewportPoint: Point2D;
      targetShownAtMs: number;
      resolve: (
        result: ValidationManagerPointResult
      ) => void;
      reject: (error: unknown) => void;
      timeoutId: number;
      deepGraceTimeoutId: number | null;
      baselineReadyAtMs: number | null;
      baselineResult: ValidationManagerPointResult | null;
    } | null =
      null;

  private latestPreCalibrationFeedback:
    PreCalibrationFeedback | null =
      null;

  private faceBaseline:
    FaceBaseline | null =
      null;

  private gazePredictor:
    GazePredictor | null =
      null;

  private gazeContextGeneration = 0;

  private gazePredictionInFlight =
    false;

  private latestGazeFrame:
    GazeRuntimeFrameResult | null =
      null;

  private faceAnalysisRunning =
    false;

  private faceFrameTimerId:
    number | null =
      null;

  private readonly faceFrameIntervalMs =
    1000
    / FACE_PIPELINE_RUNTIME
      .TARGET_ANALYSIS_RATE_HZ;

  private faceAnalysisGeneration =
    0;

  private startFacePositioningPromise:
    Promise<FaceQualityFrameResult> | null =
      null;

  private latestCameraQuality:
    CameraQuality | null =
      null;

  private latestFaceQuality:
    FaceQualityFrameResult | null =
      null;

  private lastReportedFaceErrorAtMs:
    EpochMs | null =
      null;

  private lastReportedFaceErrorCode:
    string | null =
      null;

  public constructor(
    private readonly videoElement:
      HTMLVideoElement,

    private readonly onRuntimeError:
      TrackerRuntimeErrorHandler | null =
        null,

    private readonly onFaceQualityFrame:
      FaceQualityFrameHandler | null =
        null,

    private readonly onGazeRuntimeFrame:
      GazeRuntimeFrameHandler | null =
        null
  ) {}

  /* ========================================================================
   * Initialization
   * ====================================================================== */

  /**
   * Initializes the Offscreen runtime shell.
   *
   * Camera permission is NOT requested here. The camera starts only after an
   * explicit START_CAMERA command routed through the background context.
   * MediaPipe assets are also loaded lazily when face positioning starts.
   */
  public initialize(): void {
    if (
      this.lifecycle === "READY"
    ) {
      return;
    }

    if (
      this.lifecycle === "INITIALIZING"
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "OFFSCREEN",
        "Tracker runtime is already initializing."
      );
    }

    if (
      this.lifecycle === "DISPOSING"
      || this.lifecycle === "DISPOSED"
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "OFFSCREEN",
        "Disposed tracker runtime cannot be initialized."
      );
    }

    this.lifecycle =
      "INITIALIZING";

    try {
      this.configureVideoElement();

      this.cameraManager =
        new CameraManager(
          this.videoElement,
          (error) => {
            this.handleRuntimeError(
              error
            );
          }
        );

      this.frameCapture =
        new FrameCapture(
          this.videoElement
        );

      /*
       * Camera-quality OffscreenCanvas allocation is intentionally lazy.
       * Some Chrome/OS combinations can expose the Offscreen Document before
       * its canvas backend is fully usable; that must never prevent the core
       * runtime transport or camera startup from initializing.
       */
      this.cameraQualityEstimator =
        null;

      this.faceLandmarker =
        new FaceLandmarker();

      this.faceGeometryAnalyzer =
        new FaceGeometryAnalyzer();

      this.headPoseEstimator =
        new HeadPoseEstimator();

      this.eyeGeometryAnalyzer =
        new EyeGeometryAnalyzer();

      this.blinkDetector =
        new BlinkDetector();

      this.faceQualityEvaluator =
        new FaceQualityEvaluator();

      this.preCalibrationMonitor =
        new PreCalibrationMonitor();

      this.calibrationManager =
        new CalibrationManager();

      this.residualCorrector =
        new ResidualCorrector();

      this.validationManager =
        new ValidationManager();

      this.deepPersonalMapper =
        new DeepPersonalMapper();

      this.deepIndependentValidator =
        new DeepIndependentValidator();

      this.calibrationHybridSelector =
        new CalibrationHybridSelector();

      this.gazePredictor =
        new GazePredictor();

      this.gazePredictor
        .setObserverSampleListener(
          (sample) => {
            this.observeDeepObserverSample(
              sample
            );
          }
        );

      this.initializedAtEpochMs =
        nowEpochMs();

      this.disposedAtEpochMs =
        null;

      this.lifecycle =
        "READY";

      logger.info(
        "Offscreen tracker runtime initialized."
      );
    } catch (error: unknown) {
      this.disposeModulesAfterFailedInitialization();

      this.lifecycle =
        "ERROR";

      if (
        error instanceof TrackerError
      ) {
        throw error;
      }

      throw new TrackerError(
        ERROR_CODES.UNKNOWN,
        "OFFSCREEN",
        "Offscreen tracker runtime initialization failed.",
        {
          cause: error
        }
      );
    }
  }

  /* ========================================================================
   * Camera
   * ====================================================================== */

  public async startCamera(
    request: CameraRequest
  ): Promise<CameraSettings> {
    this.assertUsable();

    const cameraManager =
      this.getCameraManagerOrThrow();

    this.stopFaceAnalysis();

    try {
      const settings =
        await cameraManager.start(
          request
        );

      this.frameCapture?.reset();
      this.cameraQualityEstimator?.reset();

      return settings;
    } catch (error: unknown) {
      throw normalizeTrackerError(
        error,
        ERROR_CODES.CAMERA_START_FAILED,
        "CAMERA",
        "Offscreen camera startup failed."
      );
    }
  }

  public stopCamera(): void {
    this.assertUsable();

    this.stopFaceAnalysis();

    this.getCameraManagerOrThrow()
      .stop();

    this.frameCapture?.reset();
    this.cameraQualityEstimator?.reset();
  }

  /**
   * Future Face/Gaze stages consume this scheduler instead of creating their
   * own camera frame source.
   */
  public getFrameCapture():
  FrameCapture {
    this.assertUsable();

    if (
      this.frameCapture === null
    ) {
      throw new TrackerError(
        ERROR_CODES.CAMERA_FRAME_UNAVAILABLE,
        "CAMERA",
        "Camera frame capture is unavailable."
      );
    }

    return this.frameCapture;
  }

  /**
   * Future pre-calibration logic can evaluate lighting/blur/FPS through this
   * single estimator.
   */
  public getCameraQualityEstimator():
  CameraQualityEstimator {
    this.assertUsable();

    if (
      this.cameraQualityEstimator
      === null
    ) {
      try {
        this.cameraQualityEstimator =
          new CameraQualityEstimator();
      } catch (error: unknown) {
        throw normalizeTrackerError(
          error,
          ERROR_CODES.CAMERA_QUALITY_FAILED,
          "CAMERA",
          "Camera quality estimator could not be initialized lazily.",
          { recoverable: true }
        );
      }
    }

    return this.cameraQualityEstimator;
  }

  /* ========================================================================
   * Face pipeline
   * ====================================================================== */

  /**
   * Lazily loads the local MediaPipe model, processes one current frame, and
   * then starts the continuous face-analysis loop.
   *
   * Returning the first quality result gives the Offscreen message layer a
   * typed FACE_POSITION_STATUS acknowledgement without inventing a second
   * model-ready message type.
   */
  public startFacePositioning():
  Promise<FaceQualityFrameResult> {
    this.assertUsable();
    this.assertCameraRunning();

    if (
      this.faceAnalysisRunning
      && this.latestFaceQuality
        !== null
    ) {
      return Promise.resolve(
        this.latestFaceQuality
      );
    }

    if (
      this.startFacePositioningPromise
      !== null
    ) {
      return this.startFacePositioningPromise;
    }

    const generation =
      this.beginFaceAnalysisGeneration();

    const startup =
      this.startFacePositioningInternal(
        generation
      )
        .finally(
          () => {
            if (
              this.startFacePositioningPromise
              === startup
            ) {
              this.startFacePositioningPromise =
                null;
            }
          }
        );

    this.startFacePositioningPromise =
      startup;

    return startup;
  }

  public getLatestFaceQuality():
  FaceQualityFrameResult | null {
    return this.latestFaceQuality;
  }

  public getLatestPreCalibrationFeedback():
  PreCalibrationFeedback | null {
    const feedback =
      this.latestPreCalibrationFeedback;

    if (feedback === null) {
      return null;
    }

    return {
      ...feedback,
      status: {
        ...feedback.status
      },
      cameraFaceBoxNormalized:
        feedback.cameraFaceBoxNormalized
          === null
          ? null
          : {
              ...feedback.cameraFaceBoxNormalized
            },
      metrics: {
        ...feedback.metrics
      }
    };
  }

  public getFaceBaseline():
  FaceBaseline | null {
    const baseline =
      this.faceBaseline;

    if (baseline === null) {
      return null;
    }

    return {
      ...baseline,
      headPose: {
        ...baseline.headPose
      }
    };
  }

  /* ========================================================================
   * Calibration runtime
   * ====================================================================== */

  public startCalibration(
    calibrationId: CalibrationId,
    mode: CalibrationMode
  ): void {
    this.assertUsable();
    this.assertCameraRunning();

    if (
      !this.faceAnalysisRunning
      || this.faceBaseline === null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration requires a completed pre-calibration face baseline."
      );
    }

    if (
      this.gazePredictor === null
      || this.gazePredictor
        .getSnapshot().lifecycle
        !== "READY"
    ) {
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "CALIBRATION",
        "Calibration requires a ready gaze predictor."
      );
    }

    // Full calibration deliberately replaces any pending quick transaction.
    this.quickRecalibrationCheckpoint = null;
    this.quickRecalibrationRunId = null;
    this.quickRecalibrationActive = false;
    if (this.quickRecalibrationTimeoutId !== null) {
      window.clearTimeout(this.quickRecalibrationTimeoutId);
      this.quickRecalibrationTimeoutId = null;
    }
    this.completedQuickValidationResult = null;
    this.cancelActiveCalibrationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A newer calibration run replaced the previous point request."
      )
    );

    this.invalidatePendingGaze();
    const manager =
      this.getCalibrationManagerOrThrow();

    manager.start(
      calibrationId,
      mode,
      this.faceBaseline
    );

    this.getDeepPersonalMapperOrThrow()
      .start(
        calibrationId,
        manager.getSnapshot()
          .expectedPointCount
      );

    /*
     * V5 performance governor: every fresh calibration run gives the shadow
     * observer one chance to prove it can keep up. If a completed L2CS
     * inference exceeds the cross-device latency budget, the observer is
     * suspended for the remainder of this calibration/validation session so
     * it cannot steal CPU/GPU time from the authoritative WebEyeTrack path.
     */
    this.gazePredictor.setObserverSuspended(false);

    this.quickRecalibrationActive = false;
    this.activeDeepCalibrationSamples = [];
    this.deepPersonalPredictionCount = 0;
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
    this.authoritativeSessionValidationReady = false;
    this.authoritativeSessionDegradedCollectionAllowed = false;
    this.selectedStrategyValidationResult = null;
    this.deepSessionStrategyEligible = false;
    this.forceBaselineSessionStrategy = false;
    this.independentValidationActive = false;
    this.driftMonitorResumeAfterTimestampMs = 0;
    this.adaptiveCalibrationExpansionEvaluated = false;
    this.trackingViewportSize = null;
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();

    /*
     * beginPrimaryPersonalizationSession() also restores the pinned generic
     * WebEyeTrack baseline. We invoke it for both A/B strategies so a previous
     * native-adaptation run cannot leak into a later project-residual run.
     * Only the native strategy records/stages/applies support samples below.
     */
    const nativePersonalizationSessionStarted =
      this.gazePredictor
        .beginPrimaryPersonalizationSession();

    this.getResidualCorrectorOrThrow()
      .clear();

    logger.info(
      "Calibration runtime started.",
      {
        calibrationId,
        mode,
        expectedPointCount:
          manager.getSnapshot()
            .expectedPointCount,
        correctionStrategy:
          CALIBRATION.CORRECTION_STRATEGY,
        nativePersonalizationSessionStarted,
        deepObserver:
          this.gazePredictor
            .getSnapshot().observer
      }
    );
  }

  public setAutomaticQuickRecalibrationEnabled(
    enabled: boolean
  ): void {
    if (
      this.automaticQuickRecalibrationEnabled
      === enabled
    ) {
      return;
    }

    this.automaticQuickRecalibrationEnabled =
      enabled;

    /*
     * Restart persistence/reference timers on every preference change so
     * enabling the feature can never cause an immediate stale drift trigger.
     */
    this.runtimeGazeDriftMonitor.reset();
    this.lastLoggedRuntimeDriftSeverity = null;

    logger.info(
      "Automatic quick recalibration preference changed.",
      { enabled }
    );
  }

  /**
   * Starts a short maintenance calibration without discarding the original
   * calibration set. The extra targets are appended to the existing cleaned
   * points so they capture the participant's current drifted pose.
   */
  public startQuickRecalibration(
    calibrationId: CalibrationId,
    pointCount: number
  ): {
    readonly startingPointIndex: number;
    readonly expectedPointCount: number;
    readonly runId: string;
  } {
    this.assertUsable();
    this.assertCameraRunning();

    if (
      !Number.isInteger(pointCount)
      || pointCount <= 0
      || this.quickRecalibrationActive
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration cannot start in the current runtime state."
      );
    }

    const manager = this.getCalibrationManagerOrThrow();
    const snapshot = manager.getSnapshot();

    if (
      snapshot.calibrationId !== calibrationId
      || !snapshot.modelReady
      || snapshot.activePointIndex !== null
    ) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick recalibration requires the active fitted calibration model."
      );
    }

    if (CALIBRATION.CORRECTION_STRATEGY !== "PROJECT_RESIDUAL_ONLY") {
      throw new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION, "CALIBRATION",
        "Native WebEyeTrack quick recalibration needs a native-weight rollback; use full calibration.");
    }

    // Create detached fitting and validation objects. The old objects and
    // their selected strategy stay untouched until independent revalidation.
    const candidateManager = manager.forkForQuickRecalibration();
    const candidateDeepMapper = this.getDeepPersonalMapperOrThrow()
      .forkForQuickRecalibration();
    const extension = candidateManager.beginIncrementalCalibration(pointCount);
    candidateDeepMapper.extendExpectedPointCount(extension.expectedPointCount);
    const oldCorrector = this.getResidualCorrectorOrThrow();
    const oldModel = manager.getModel();
    if (oldModel === null) {
      throw new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION, "CALIBRATION",
        "Cannot start maintenance without a fitted previous model.");
    }
    const candidateCorrector = new ResidualCorrector();
    candidateCorrector.setModel(oldModel);
    this.cancelActiveValidationPoint(
      new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION, "CALIBRATION",
        "Quick recalibration replaced an older validation request.")
    );
    this.quickRecalibrationCheckpoint = {
      calibrationManager: manager,
      deepPersonalMapper: this.getDeepPersonalMapperOrThrow(),
      calibrationHybridSelector: this.getCalibrationHybridSelectorOrThrow(),
      residualCorrector: oldCorrector,
      validationManager: this.getValidationManagerOrThrow(),
      deepIndependentValidator: this.getDeepIndependentValidatorOrThrow(),
      authoritativeSessionValidationReady: this.authoritativeSessionValidationReady,
      authoritativeSessionDegradedCollectionAllowed: this.authoritativeSessionDegradedCollectionAllowed,
      selectedStrategyValidationResult: this.selectedStrategyValidationResult,
      deepSessionStrategyEligible: this.deepSessionStrategyEligible,
      forceBaselineSessionStrategy: this.forceBaselineSessionStrategy,
      independentValidationActive: this.independentValidationActive,
      driftMonitorResumeAfterTimestampMs: this.driftMonitorResumeAfterTimestampMs,
      faceBaseline: this.getFaceBaseline(),
      driftMonitorState: this.runtimeGazeDriftMonitor.captureState()
    };
    this.calibrationManager = candidateManager;
    this.deepPersonalMapper = candidateDeepMapper;
    this.calibrationHybridSelector = new CalibrationHybridSelector();
    this.residualCorrector = candidateCorrector;
    this.validationManager = new ValidationManager();
    this.deepIndependentValidator = new DeepIndependentValidator();
    this.completedQuickValidationResult = null;
    const runId = `${calibrationId}:${++this.quickRecalibrationRunSequence}`;
    this.quickRecalibrationRunId = runId;
    this.quickRecalibrationTimeoutId = window.setTimeout(() => {
      this.abortQuickRecalibration(calibrationId, runId);
    }, QUICK_RECALIBRATION.MAX_RUN_DURATION_MS);
    this.invalidatePendingGaze();
    this.quickRecalibrationActive = true;
    this.authoritativeSessionValidationReady = false;
    this.authoritativeSessionDegradedCollectionAllowed = false;
    this.selectedStrategyValidationResult = null;
    this.activeDeepCalibrationSamples = [];
    this.activeDeepValidationSamples = [];
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.authoritativeGazeStabilizer.reset();
    this.fixationDetector.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;

    logger.info(
      "Quick recalibration started from persistent runtime drift.",
      {
        calibrationId,
        startingPointIndex: extension.startingPointIndex,
        pointCount,
        expectedPointCount: extension.expectedPointCount
      }
    );

    return { ...extension, runId };
  }

  /** Reject stale UI messages from an earlier attempt with the same calibration ID. */
  public assertQuickRecalibrationRun(calibrationId: CalibrationId, runId: string): void {
    if (!this.quickRecalibrationActive || this.quickRecalibrationRunId !== runId
      || this.calibrationManager?.getSnapshot().calibrationId !== calibrationId) {
      throw new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION, "CALIBRATION",
        "The quick recalibration request is expired or belongs to a different run.");
    }
  }

  /** Restore the original fitted models AND readiness flags, never candidate fits. */
  public abortQuickRecalibration(calibrationId: CalibrationId, runId: string): boolean {
    if (!this.quickRecalibrationActive || this.quickRecalibrationRunId !== runId
      || this.calibrationManager?.getSnapshot().calibrationId !== calibrationId) return false;
    const saved = this.quickRecalibrationCheckpoint;
    if (saved === null) return false;
    this.quickRecalibrationActive = false;
    this.quickRecalibrationRunId = null;
    this.quickRecalibrationCheckpoint = null;
    if (this.quickRecalibrationTimeoutId !== null) {
      window.clearTimeout(this.quickRecalibrationTimeoutId);
      this.quickRecalibrationTimeoutId = null;
    }
    this.cancelActiveCalibrationPoint(new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION,
      "CALIBRATION", "Quick recalibration was aborted; previous model restored."));
    this.cancelActiveValidationPoint(new TrackerError(ERROR_CODES.INVALID_STATE_TRANSITION,
      "CALIBRATION", "Quick validation was aborted; previous model restored."));
    this.invalidatePendingGaze();
    this.calibrationManager = saved.calibrationManager;
    this.deepPersonalMapper = saved.deepPersonalMapper;
    this.calibrationHybridSelector = saved.calibrationHybridSelector;
    this.residualCorrector = saved.residualCorrector;
    this.validationManager = saved.validationManager;
    this.deepIndependentValidator = saved.deepIndependentValidator;
    this.authoritativeSessionValidationReady = saved.authoritativeSessionValidationReady;
    this.authoritativeSessionDegradedCollectionAllowed = saved.authoritativeSessionDegradedCollectionAllowed;
    this.selectedStrategyValidationResult = saved.selectedStrategyValidationResult;
    this.deepSessionStrategyEligible = saved.deepSessionStrategyEligible;
    this.forceBaselineSessionStrategy = saved.forceBaselineSessionStrategy;
    this.independentValidationActive = saved.independentValidationActive;
    this.driftMonitorResumeAfterTimestampMs = saved.driftMonitorResumeAfterTimestampMs;
    this.faceBaseline = saved.faceBaseline;
    this.activeDeepCalibrationSamples = [];
    this.activeDeepValidationSamples = [];
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.restoreState(saved.driftMonitorState);
    this.authoritativeGazeStabilizer.reset();
    this.fixationDetector.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    logger.warn("Quick recalibration rolled back to the previous validated model.", {
      calibrationId, runId
    });
    return true;
  }

  public getCompletedQuickValidationResult(): SessionStrategyValidationResult | null {
    return this.completedQuickValidationResult;
  }

  public startQuickValidation(
    calibrationId: CalibrationId,
    viewportWidth: number,
    viewportHeight: number,
    expectedPointCount: number
  ): void {
    if (!this.quickRecalibrationActive) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Quick validation requires an active quick recalibration run."
      );
    }

    this.startValidation(
      calibrationId,
      viewportWidth,
      viewportHeight,
      expectedPointCount
    );
  }

  public collectCalibrationPoint(
    calibrationId: CalibrationId,
    target: CalibrationTarget,
    targetShownAtMs: number
  ): Promise<CalibrationManagerPointResult> {
    this.assertUsable();

    if (this.activeCalibrationPointRequest !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A calibration target is already awaiting gaze samples.",
        {
          details: {
            activePointIndex:
              this.activeCalibrationPointRequest
                .pointIndex,
            requestedPointIndex:
              target.pointIndex
          }
        }
      );
    }

    const manager =
      this.getCalibrationManagerOrThrow();

    manager.beginPoint(
      calibrationId,
      target,
      targetShownAtMs
    );

    this.activeDeepCalibrationSamples = [];

    return new Promise<CalibrationManagerPointResult>(
      (resolve, reject) => {
        const deadlineMs =
          targetShownAtMs
          + CALIBRATION.POINT_TIMEOUT_LOW_FPS_MS;

        const timeoutDelayMs =
          Math.max(
            0,
            deadlineMs
              - nowTimelineMs()
          )
          + 50;

        const timeoutId =
          window.setTimeout(
            () => {
              void this.finishActiveCalibrationPoint();
            },
            timeoutDelayMs
          );

        this.activeCalibrationPointRequest = {
          calibrationId,
          pointIndex:
            target.pointIndex,
          targetNormalizedPoint: {
            ...target.normalizedPoint
          },
          targetViewportPoint: {
            ...target.viewportPoint
          },
          targetShownAtMs,
          resolve,
          reject,
          timeoutId,
          deepGraceTimeoutId: null,
          baselineReadyAtMs: null
        };
      }
    );
  }

  private observeCalibrationFrame(
    result: GazeRuntimeFrameResult,
    faceQuality: FaceQualityFrameResult,
    faceGeometry: FaceGeometryFrameResult
  ): void {
    if (this.activeCalibrationPointRequest === null) {
      return;
    }

    const manager =
      this.getCalibrationManagerOrThrow();

    const decision =
      manager.observe({
        prediction:
          result.prediction,
        gazeValid:
          result.validation.valid,
        gazeQuality:
          result.quality.score,
        face:
          faceQuality.trackingQuality,
        faceCenterNormalized:
          faceGeometry.geometry
            ?.centerNormalized
          ?? null
      });

    if (
      decision.accepted
      && CALIBRATION.CORRECTION_STRATEGY
        === "WEBEYETRACK_NATIVE_ONLY"
    ) {
      this.gazePredictor
        ?.recordPrimaryPersonalizationCandidate(
          this.activeCalibrationPointRequest
            .pointIndex,
          result.prediction.timestampMs
        );
    }

    if (decision.phase === "TIMED_OUT") {
      void this.finishActiveCalibrationPoint();
      return;
    }

    if (decision.phase === "READY") {
      this.maybeFinishCalibrationAfterDeepDwell();
    }
  }

  private getPostSettleDeepSamples():
  readonly GazeObserverRuntimeSample[] {
    const request =
      this.activeCalibrationPointRequest;

    if (request === null) {
      return [];
    }

    const minimumTimestampMs =
      request.targetShownAtMs
      + CALIBRATION.TARGET_SETTLE_MS;

    return this.activeDeepCalibrationSamples
      .filter(
        (sample) =>
          sample.prediction.timestampMs
            >= minimumTimestampMs
      );
  }

  private maybeFinishCalibrationAfterDeepDwell():
  void {
    const request =
      this.activeCalibrationPointRequest;

    if (request === null) {
      return;
    }

    const postSettleDeepSampleCount =
      this.getPostSettleDeepSamples().length;

    if (
      postSettleDeepSampleCount
        >= DEEP_PERSONALIZATION
          .CALIBRATION_DEEP_TARGET_SAMPLE_COUNT
    ) {
      if (request.deepGraceTimeoutId !== null) {
        window.clearTimeout(
          request.deepGraceTimeoutId
        );
        request.deepGraceTimeoutId = null;
      }

      logger.info(
        "Deep calibration dwell requirement satisfied; completing target.",
        {
          calibrationId:
            request.calibrationId,
          pointIndex:
            request.pointIndex,
          postSettleDeepSampleCount,
          targetSampleCount:
            DEEP_PERSONALIZATION
              .CALIBRATION_DEEP_TARGET_SAMPLE_COUNT
        }
      );

      void this.finishActiveCalibrationPoint();
      return;
    }

    if (request.baselineReadyAtMs !== null) {
      return;
    }

    request.baselineReadyAtMs =
      nowTimelineMs();

    if (
      this.gazePredictor
        ?.getSnapshot().observer.suspended
      === true
    ) {
      logger.info(
        "Baseline calibration point is ready; slow deep observer is suspended so the target can complete immediately.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          postSettleDeepSampleCount,
          observerSnapshot:
            this.gazePredictor.getSnapshot().observer
        }
      );

      void this.finishActiveCalibrationPoint();
      return;
    }

    const observerLatencyMs =
      this.gazePredictor
        ?.getSnapshot().observer.lastPrediction
        ?.inferenceLatencyMs
      ?? null;

    const adaptiveDeepGraceMs =
      observerLatencyMs === null
        ? DEEP_PERSONALIZATION.CALIBRATION_DEEP_GRACE_MS
        : Math.min(
            2_500,
            Math.max(
              DEEP_PERSONALIZATION.CALIBRATION_DEEP_GRACE_MS,
              Math.ceil(observerLatencyMs * 1.5)
            )
          );

    request.deepGraceTimeoutId =
      window.setTimeout(
        () => {
          const activeRequest =
            this.activeCalibrationPointRequest;

          if (
            activeRequest === null
            || activeRequest.calibrationId
              !== request.calibrationId
            || activeRequest.pointIndex
              !== request.pointIndex
          ) {
            return;
          }

          activeRequest.deepGraceTimeoutId =
            null;

          logger.info(
            "Deep calibration dwell grace elapsed; completing target with available deep observations.",
            {
              calibrationId:
                activeRequest.calibrationId,
              pointIndex:
                activeRequest.pointIndex,
              graceMs:
                adaptiveDeepGraceMs,
              postSettleDeepSampleCount:
                this.getPostSettleDeepSamples()
                  .length,
              observerSnapshot:
                this.gazePredictor
                  ?.getSnapshot().observer
                ?? null
            }
          );

          void this.finishActiveCalibrationPoint();
        },
        adaptiveDeepGraceMs
      );

    logger.info(
      "Baseline calibration point is ready; extending target briefly for deep observations.",
      {
        calibrationId:
          request.calibrationId,
        pointIndex:
          request.pointIndex,
        graceMs:
          adaptiveDeepGraceMs,
        postSettleDeepSampleCount,
        targetSampleCount:
          DEEP_PERSONALIZATION
            .CALIBRATION_DEEP_TARGET_SAMPLE_COUNT,
        observerSnapshot:
          this.gazePredictor
            ?.getSnapshot().observer
          ?? null
      }
    );
  }

  private async finishActiveCalibrationPoint():
  Promise<void> {
    const request =
      this.activeCalibrationPointRequest;

    if (request === null) {
      return;
    }

    this.activeCalibrationPointRequest =
      null;

    const deepSamples =
      this.activeDeepCalibrationSamples;

    this.activeDeepCalibrationSamples = [];

    window.clearTimeout(
      request.timeoutId
    );

    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }

    try {
      const manager =
        this.getCalibrationManagerOrThrow();

      const result =
        manager.finishActivePoint(
          nowTimelineMs()
        );

      let responseResult:
        CalibrationManagerPointResult =
          result;

      if (
        result.sufficient
        && result.stableWindowStartTimestampMs !== null
        && result.stableWindowEndTimestampMs !== null
        && this.faceBaseline !== null
      ) {
        const stableWindowStartTimestampMs =
          result.stableWindowStartTimestampMs;

        const stableWindowEndTimestampMs =
          result.stableWindowEndTimestampMs;

        const exactStableDeepSamples =
          deepSamples.filter(
            (sample) =>
              sample.prediction.timestampMs
                >= stableWindowStartTimestampMs
              && sample.prediction.timestampMs
                <= stableWindowEndTimestampMs
          );

        const expandedWindowStartTimestampMs =
          Math.max(
            request.targetShownAtMs
              + CALIBRATION.TARGET_SETTLE_MS,
            stableWindowStartTimestampMs
              - DEEP_PERSONALIZATION
                .CALIBRATION_WINDOW_PADDING_MS
          );

        const expandedWindowEndTimestampMs =
          stableWindowEndTimestampMs
          + DEEP_PERSONALIZATION
            .CALIBRATION_WINDOW_PADDING_MS;

        const paddedStableDeepSamples =
          deepSamples.filter(
            (sample) =>
              sample.prediction.timestampMs
                >= expandedWindowStartTimestampMs
              && sample.prediction.timestampMs
                <= expandedWindowEndTimestampMs
          );

        const postSettleDeepSamples =
          deepSamples.filter(
            (sample) =>
              sample.prediction.timestampMs
                >= request.targetShownAtMs
                  + CALIBRATION.TARGET_SETTLE_MS
          );

        const candidateSelection =
          exactStableDeepSamples.length
            >= DEEP_PERSONALIZATION
              .MIN_DEEP_SAMPLES_PER_POINT
            ? {
                mode: "STABLE_WINDOW",
                samples: exactStableDeepSamples
              } as const
            : paddedStableDeepSamples.length
                >= DEEP_PERSONALIZATION
                  .MIN_DEEP_SAMPLES_PER_POINT
              ? {
                  mode: "PADDED_STABLE_WINDOW",
                  samples: paddedStableDeepSamples
                } as const
              : {
                  mode: "TARGET_DWELL_FALLBACK",
                  samples: postSettleDeepSamples
                } as const;

        const stableWindowMidpointMs =
          (
            stableWindowStartTimestampMs
            + stableWindowEndTimestampMs
          ) / 2;

        const selectedDeepSamples =
          [...candidateSelection.samples]
            .sort(
              (first, second) =>
                Math.abs(
                  first.prediction.timestampMs
                  - stableWindowMidpointMs
                )
                - Math.abs(
                  second.prediction.timestampMs
                  - stableWindowMidpointMs
                )
            )
            .slice(
              0,
              DEEP_PERSONALIZATION
                .MAX_DEEP_SAMPLES_PER_POINT
            )
            .sort(
              (first, second) =>
                first.prediction.timestampMs
                - second.prediction.timestampMs
            );

        try {
          const deepPoint =
            this.getDeepPersonalMapperOrThrow()
              .addCalibrationPoint(
                {
                  pointIndex:
                    result.pointIndex,
                  targetNormalizedPoint:
                    request.targetNormalizedPoint,
                  targetViewportPoint:
                    request.targetViewportPoint,
                  samples:
                    selectedDeepSamples
                },
                this.faceBaseline
              );

          logger.info(
            "Deep calibration point staged for grouped personal mapping.",
            {
              calibrationId:
                result.calibrationId,
              pointIndex:
                result.pointIndex,
              bufferedDeepSampleCount:
                deepSamples.length,
              exactStableDeepSampleCount:
                exactStableDeepSamples.length,
              paddedStableDeepSampleCount:
                paddedStableDeepSamples.length,
              postSettleDeepSampleCount:
                postSettleDeepSamples.length,
              deepSampleSelectionMode:
                candidateSelection.mode,
              deepSampleCount:
                deepPoint.sampleCount,
              meanDeepConfidence:
                deepPoint.meanConfidence
            }
          );
        } catch (error: unknown) {
          logger.warn(
            "Deep calibration point could not be staged; baseline calibration continues.",
            {
              calibrationId:
                result.calibrationId,
              pointIndex:
                result.pointIndex,
              bufferedDeepSampleCount:
                deepSamples.length,
              exactStableDeepSampleCount:
                exactStableDeepSamples.length,
              paddedStableDeepSampleCount:
                paddedStableDeepSamples.length,
              postSettleDeepSampleCount:
                postSettleDeepSamples.length,
              deepSampleSelectionMode:
                candidateSelection.mode,
              selectedDeepSampleCount:
                selectedDeepSamples.length,
              observerSnapshot:
                this.gazePredictor
                  ?.getSnapshot().observer
                ?? null,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown deep calibration staging error"
            }
          );
        }
      }

      if (
        result.sufficient
        && result.stableWindowStartTimestampMs !== null
        && result.stableWindowEndTimestampMs !== null
        && CALIBRATION.CORRECTION_STRATEGY
          === "WEBEYETRACK_NATIVE_ONLY"
      ) {
        const staged =
          this.gazePredictor
            ?.stagePrimaryPersonalizationPoint(
              result.pointIndex,
              request.targetNormalizedPoint,
              result.stableWindowStartTimestampMs,
              result.stableWindowEndTimestampMs
            )
          ?? false;

        if (!staged) {
          logger.warn(
            "No WebEyeTrack native support sample was staged for the completed calibration point.",
            {
              calibrationId:
                result.calibrationId,
              pointIndex:
                result.pointIndex
            }
          );
        }
      }

      if (
        result.modelReady
        && result.model !== null
      ) {
        // Always install the project residual first. It remains the safe
        // fallback if native WebEyeTrack adaptation is unsupported or fails.
        this.invalidatePendingGaze();
        this.getResidualCorrectorOrThrow()
          .setModel(result.model);

        logger.info(
          "Calibration residual model fitted.",
          {
            calibrationId:
              result.calibrationId,
            trainingPointCount:
              result.completedPointCount,
            trainingRmseNormalized:
              result.trainingRmseNormalized
          }
        );

        try {
          const deepFit =
            this.getDeepPersonalMapperOrThrow()
              .fit();

          logger.info(
            "Deep personal screen mapper fitted in shadow mode with grouped leave-one-point-out selection.",
            {
              calibrationId:
                result.calibrationId,
              calibrationPointCount:
                deepFit.calibrationPointCount,
              projectedFeatureDimension:
                deepFit.projectedFeatureDimension,
              combinedFeatureDimension:
                deepFit.combinedFeatureDimension,
              selectedKind:
                deepFit.selectedCandidate.kind,
              selectedRidgeLambda:
                deepFit.selectedCandidate.ridgeLambda,
              selectedRbfGammaScale:
                deepFit.selectedCandidate.rbfGammaScale,
              groupedCvMeanErrorPx:
                deepFit.selectedCandidate.meanErrorPx,
              groupedCvP95ErrorPx:
                deepFit.selectedCandidate.p95ErrorPx,
              groupedCvRmsePx:
                deepFit.selectedCandidate.rmsePx
            }
          );

          const deepMapperSnapshot =
            this.getDeepPersonalMapperOrThrow()
              .getSnapshot();
          const observerSnapshot =
            this.gazePredictor?.getSnapshot().observer
            ?? null;
          const expectedDeepPointCount =
            Math.max(
              1,
              deepMapperSnapshot.expectedPointCount
            );
          const deepCoverageRatio =
            deepMapperSnapshot.collectedPointCount
            / expectedDeepPointCount;
          const lastDeepInferenceLatencyMs =
            observerSnapshot?.lastPrediction
              ?.inferenceLatencyMs
            ?? null;

          this.deepSessionStrategyEligible =
            deepCoverageRatio
              >= DEEP_PERSONALIZATION
                .SESSION_STRATEGY_MIN_DEEP_COVERAGE_RATIO
            && observerSnapshot?.suspended !== true
            && lastDeepInferenceLatencyMs !== null
            && lastDeepInferenceLatencyMs
              < DEEP_PERSONALIZATION
                .CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS;

          this.forceBaselineSessionStrategy =
            !this.deepSessionStrategyEligible;

          const eligibilityDetails = {
            calibrationId: result.calibrationId,
            deepCollectedPointCount:
              deepMapperSnapshot.collectedPointCount,
            expectedDeepPointCount,
            deepCoverageRatio,
            requiredCoverageRatio:
              DEEP_PERSONALIZATION
                .SESSION_STRATEGY_MIN_DEEP_COVERAGE_RATIO,
            lastDeepInferenceLatencyMs,
            maximumEligibleInferenceLatencyMs:
              DEEP_PERSONALIZATION
                .CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS,
            observerSuspended:
              observerSnapshot?.suspended ?? true,
            observerSuspensionReason:
              observerSnapshot?.suspensionReason ?? null,
            deepSessionStrategyEligible:
              this.deepSessionStrategyEligible
          };

          if (this.deepSessionStrategyEligible) {
            logger.info(
              "Deep session strategy passed calibration coverage/performance eligibility gate.",
              eligibilityDetails
            );
          } else {
            logger.warn(
              "Deep session strategy is shadow-only because calibration coverage/performance is insufficient; Baseline will remain authoritative unless a future calibration qualifies Deep.",
              eligibilityDetails
            );
          }

          try {
            const baselineCv =
              this.getCalibrationManagerOrThrow()
                .getGroupedCrossValidationDiagnostics();

            const hybridFit =
              this.getCalibrationHybridSelectorOrThrow()
                .fit(baselineCv, deepFit);

            logger.info(
              "Calibration-only residual bias model fitted from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                baselineCorrectionEnabled:
                  hybridFit.residualBias.baseline.correctionEnabled,
                baselineCorrectionStrength:
                  hybridFit.residualBias.baseline.correctionStrength,
                baselineStrengthDiagnostics:
                  hybridFit.residualBias.baseline.strengthDiagnostics,
                baselineCrossValidation:
                  hybridFit.residualBias.baseline.crossValidation,
                baselineGlobalBiasPrior:
                  hybridFit.residualBias.baseline.globalPrior,
                baselineDirectionalBiasPriors:
                  hybridFit.residualBias.baseline.directionalPriors,
                deepCorrectionEnabled:
                  hybridFit.residualBias.deep.correctionEnabled,
                deepCorrectionStrength:
                  hybridFit.residualBias.deep.correctionStrength,
                deepStrengthDiagnostics:
                  hybridFit.residualBias.deep.strengthDiagnostics,
                deepCrossValidation:
                  hybridFit.residualBias.deep.crossValidation,
                deepGlobalBiasPrior:
                  hybridFit.residualBias.deep.globalPrior,
                deepDirectionalBiasPriors:
                  hybridFit.residualBias.deep.directionalPriors
              }
            );

            logger.info(
              "Calibration-only residual bias shrinkage selected from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                baselineCorrectionEnabled:
                  hybridFit.residualBias.baseline.correctionEnabled,
                baselineCorrectionStrength:
                  hybridFit.residualBias.baseline.correctionStrength,
                baselineStrengthDiagnostics:
                  hybridFit.residualBias.baseline.strengthDiagnostics,
                deepCorrectionEnabled:
                  hybridFit.residualBias.deep.correctionEnabled,
                deepCorrectionStrength:
                  hybridFit.residualBias.deep.correctionStrength,
                deepStrengthDiagnostics:
                  hybridFit.residualBias.deep.strengthDiagnostics
              }
            );

            logger.info(
              "Calibration-only hybrid selector fitted from grouped cross-validation; independent validation remains untouched.",
              {
                calibrationId: result.calibrationId,
                calibrationPointCount:
                  hybridFit.calibrationPointCount,
                baselineGroupedCvMeanErrorPx:
                  baselineCv.meanErrorPx,
                baselineGroupedCvP95ErrorPx:
                  baselineCv.p95ErrorPx,
                deepGroupedCvMeanErrorPx:
                  deepFit.selectedCandidate.meanErrorPx,
                deepGroupedCvP95ErrorPx:
                  deepFit.selectedCandidate.p95ErrorPx,
                baselineBiasCorrectionEnabled:
                  hybridFit.residualBias.baseline.correctionEnabled,
                deepBiasCorrectionEnabled:
                  hybridFit.residualBias.deep.correctionEnabled,
                globalPrior:
                  hybridFit.globalPrior,
                bucketPriors:
                  hybridFit.bucketPriors,
                directionalPriors:
                  hybridFit.directionalPriors,
                engineReliabilityRoutingEnabled:
                  hybridFit.engineReliability.routingEnabled,
                engineReliabilityCrossValidation:
                  hybridFit.engineReliability.crossValidation,
                engineReliabilityGlobalPrior:
                  hybridFit.engineReliability.globalPrior,
                engineReliabilityDirectionalPriors:
                  hybridFit.engineReliability.directionalPriors,
                coarseEngineReliabilityRoutingEnabled:
                  hybridFit.coarseEngineReliability.routingEnabled,
                coarseEngineReliabilityCrossValidation:
                  hybridFit.coarseEngineReliability.crossValidation,
                coarseEngineReliabilityGlobalPrior:
                  hybridFit.coarseEngineReliability.globalPrior,
                coarseEngineReliabilityBucketPriors:
                  hybridFit.coarseEngineReliability.bucketPriors
              }
            );

            logger.info(
              "Calibration-only paired engine reliability routing fitted from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                routingEnabled:
                  hybridFit.engineReliability.routingEnabled,
                crossValidation:
                  hybridFit.engineReliability.crossValidation,
                globalPrior:
                  hybridFit.engineReliability.globalPrior,
                directionalPriors:
                  hybridFit.engineReliability.directionalPriors
              }
            );

            logger.info(
              "Calibration-only coarse spatial engine reliability routing fitted from nested grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                routingEnabled:
                  hybridFit.coarseEngineReliability.routingEnabled,
                crossValidation:
                  hybridFit.coarseEngineReliability.crossValidation,
                globalPrior:
                  hybridFit.coarseEngineReliability.globalPrior,
                bucketPriors:
                  hybridFit.coarseEngineReliability.bucketPriors
              }
            );

            logger.info(
              "Calibration-only session gaze strategy selected from grouped diagnostics.",
              {
                calibrationId: result.calibrationId,
                selectedStrategy:
                  hybridFit.sessionStrategy.selectedStrategy,
                selectedCandidate:
                  hybridFit.sessionStrategy.selectedCandidate,
                candidates:
                  hybridFit.sessionStrategy.candidates,
                activeCalibrationRoutingMode:
                  hybridFit.sessionStrategy.activeCalibrationRoutingMode,
                calibrationRoutingInfluence:
                  hybridFit.sessionStrategy.calibrationRoutingInfluence,
                standaloneEvidence:
                  hybridFit.sessionStrategy.standaloneEvidence,
                pointResults:
                  hybridFit.sessionStrategy.pointResults
              }
            );


            if (
              !this.adaptiveCalibrationExpansionEvaluated
              && manager.getSnapshot().mode === "STANDARD_17"
              && result.completedPointCount
                === CALIBRATION.STANDARD_POINT_COUNT
            ) {
              this.adaptiveCalibrationExpansionEvaluated = true;

              const viewport =
                this.inferCalibrationViewportSize(
                  request.targetNormalizedPoint,
                  request.targetViewportPoint
                );

              const expansionPlan =
                planAdaptiveCalibrationExpansion(
                  baselineCv.pointResults,
                  hybridFit.sessionStrategy,
                  viewport
                );

              logger.info(
                "Calibration-only adaptive spatial expansion evaluated after STANDARD_17.",
                {
                  calibrationId: result.calibrationId,
                  ...expansionPlan
                }
              );

              if (expansionPlan.expansionRequired) {
                manager.extendExpectedPointCount(
                  expansionPlan.finalExpectedPointCount
                );

                this.getDeepPersonalMapperOrThrow()
                  .extendExpectedPointCount(
                    expansionPlan.finalExpectedPointCount
                  );

                /*
                 * Provisional 17-point models are diagnostic only. Clear the
                 * project correction/hybrid runtime state so they cannot leak
                 * into the remaining calibration targets. Extending the deep
                 * mapper also invalidates its provisional fitted model.
                 */
                this.getResidualCorrectorOrThrow().clear();
                this.calibrationHybridSelector?.reset();

                responseResult = {
                  ...result,
                  expectedPointCount:
                    expansionPlan.finalExpectedPointCount,
                  modelReady: false,
                  trainingRmseNormalized: null,
                  trainingDiagnostics: null,
                  model: null,
                  adaptiveExpansionTargets:
                    expansionPlan.selectedTargets.map(
                      (selection) => selection.target
                    )
                };
              }
            }
          } catch (hybridError: unknown) {
            this.calibrationHybridSelector?.reset();
            this.deepSessionStrategyEligible = false;
            this.forceBaselineSessionStrategy = true;

            logger.warn(
              "Calibration-only hybrid selector could not be fitted; baseline and deep shadow paths remain available independently.",
              {
                calibrationId: result.calibrationId,
                error:
                  hybridError instanceof Error
                    ? hybridError.message
                    : "Unknown hybrid selector fitting error"
              }
            );
          }
        } catch (error: unknown) {
          this.deepSessionStrategyEligible = false;
          this.forceBaselineSessionStrategy = true;
          this.calibrationHybridSelector?.reset();

          logger.warn(
            "Deep personal screen mapper could not be fitted; established WebEyeTrack calibration remains active.",
            {
              calibrationId:
                result.calibrationId,
              deepMapperSnapshot:
                this.getDeepPersonalMapperOrThrow()
                  .getSnapshot(),
              deepObserverSnapshot:
                this.gazePredictor
                  ?.getSnapshot().observer
                ?? null,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown deep personal mapper fitting error"
            }
          );
        }

        if (
          responseResult.modelReady
          && CALIBRATION.CORRECTION_STRATEGY
            === "WEBEYETRACK_NATIVE_ONLY"
        ) {
          try {
            const personalization =
              await this.gazePredictor
                ?.applyPrimaryPersonalization()
              ?? {
                applied: false,
                stagedPointCount: 0,
                supportPointCount: 0
              };

            if (personalization.applied) {
              const identityModel =
                createIdentityCalibrationResidualModel(
                  result.completedPointCount,
                  result.trainingRmseNormalized
                    ?? 0
                );

              manager.setModel(identityModel);
              this.getResidualCorrectorOrThrow()
                .setModel(identityModel);

              logger.info(
                "WebEyeTrack native personalization applied; project residual correction set to identity for the native-only validation run.",
                {
                  calibrationId:
                    result.calibrationId,
                  correctionStrategy:
                    CALIBRATION.CORRECTION_STRATEGY,
                  stagedPointCount:
                    personalization.stagedPointCount,
                  supportPointCount:
                    personalization.supportPointCount
                }
              );
            } else {
              logger.warn(
                "Native-only calibration strategy could not apply WebEyeTrack personalization; project residual correction remains active as a safety fallback.",
                {
                  calibrationId:
                    result.calibrationId,
                  correctionStrategy:
                    CALIBRATION.CORRECTION_STRATEGY,
                  stagedPointCount:
                    personalization.stagedPointCount,
                  supportPointCount:
                    personalization.supportPointCount
                }
              );
            }
          } catch (error: unknown) {
            logger.warn(
              "WebEyeTrack native personalization failed; project residual correction remains active as a safety fallback.",
              {
                calibrationId:
                  result.calibrationId,
                correctionStrategy:
                  CALIBRATION.CORRECTION_STRATEGY,
                error
              }
            );
          }
        } else if (responseResult.modelReady) {
          logger.info(
            "Project residual calibration retained for independent validation; native personalization was intentionally not applied.",
            {
              calibrationId:
                result.calibrationId,
              correctionStrategy:
                CALIBRATION.CORRECTION_STRATEGY,
              trainingPointCount:
                result.completedPointCount,
              trainingRmseNormalized:
                result.trainingRmseNormalized
            }
          );
        }
      }

      logger.info(
        "Calibration point collection finished.",
        {
          calibrationId:
            responseResult.calibrationId,
          pointIndex:
            responseResult.pointIndex,
          sufficient:
            responseResult.sufficient,
          acceptedSampleCount:
            responseResult.acceptedSampleCount,
          rejectedSampleCount:
            responseResult.rejectedSampleCount,
          completedPointCount:
            responseResult.completedPointCount,
          expectedPointCount:
            responseResult.expectedPointCount,
          adaptiveExpansionTargetCount:
            responseResult.adaptiveExpansionTargets.length,
          stableWindowStartTimestampMs:
            responseResult.stableWindowStartTimestampMs,
          stableWindowEndTimestampMs:
            responseResult.stableWindowEndTimestampMs,
          stability:
            responseResult.stability
        }
      );

      request.resolve(responseResult);
    } catch (error: unknown) {
      request.reject(error);
    }
  }

  private inferCalibrationViewportSize(
    normalizedPoint: Point2D,
    viewportPoint: Point2D
  ): Size2D {
    const width = normalizedPoint.x > 0
      ? viewportPoint.x / normalizedPoint.x
      : Number.NaN;

    const height = normalizedPoint.y > 0
      ? viewportPoint.y / normalizedPoint.y
      : Number.NaN;

    if (
      !Number.isFinite(width)
      || !Number.isFinite(height)
      || width <= 0
      || height <= 0
    ) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_MODEL_FAILED,
        "CALIBRATION",
        "Adaptive calibration expansion could not infer the active viewport size."
      );
    }

    return { width, height };
  }

  private cancelActiveCalibrationPoint(
    error: TrackerError
  ): void {
    const request =
      this.activeCalibrationPointRequest;

    if (request === null) {
      return;
    }

    this.activeCalibrationPointRequest =
      null;

    this.activeDeepCalibrationSamples = [];

    window.clearTimeout(
      request.timeoutId
    );

    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }

    request.reject(error);
  }

  /* ========================================================================
   * Deep observer personalization bridge
   * ====================================================================== */

  private observeDeepObserverSample(
    sample: GazeObserverRuntimeSample
  ): void {
    const calibrationRequest =
      this.activeCalibrationPointRequest;

    if (calibrationRequest !== null) {
      if (
        sample.prediction.inferenceLatencyMs
          >= DEEP_PERSONALIZATION
            .CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS
      ) {
        this.gazePredictor?.setObserverSuspended(
          true,
          `CALIBRATION_OBSERVER_LATENCY_${Math.round(sample.prediction.inferenceLatencyMs)}MS`
        );

        logger.warn(
          "Deep observer exceeded the calibration latency budget and was suspended to protect baseline calibration throughput.",
          {
            calibrationId: calibrationRequest.calibrationId,
            pointIndex: calibrationRequest.pointIndex,
            inferenceLatencyMs:
              sample.prediction.inferenceLatencyMs,
            suspendThresholdMs:
              DEEP_PERSONALIZATION
                .CALIBRATION_OBSERVER_SUSPEND_LATENCY_MS,
            baselineReady:
              calibrationRequest.baselineReadyAtMs !== null
          }
        );

        if (
          calibrationRequest.baselineReadyAtMs
            !== null
        ) {
          this.maybeFinishCalibrationAfterDeepDwell();
        }

        return;
      }
      const timestampMs =
        sample.prediction.timestampMs;

      if (
        timestampMs
          >= calibrationRequest.targetShownAtMs
        && timestampMs
          <= calibrationRequest.targetShownAtMs
            + CALIBRATION.POINT_TIMEOUT_MS
      ) {
        this.activeDeepCalibrationSamples
          .push(sample);

        if (
          calibrationRequest.baselineReadyAtMs
            !== null
        ) {
          this.maybeFinishCalibrationAfterDeepDwell();
        }
      }
    }

    const validationRequest =
      this.activeValidationPointRequest;

    if (validationRequest !== null) {
      const timestampMs =
        sample.prediction.timestampMs;

      if (
        timestampMs
          >= validationRequest.targetShownAtMs
        && timestampMs
          <= validationRequest.targetShownAtMs
            + CALIBRATION.TARGET_SETTLE_MS
            + DEEP_PERSONALIZATION
              .VALIDATION_DEEP_MAX_DWELL_MS
      ) {
        this.activeDeepValidationSamples
          .push(sample);

        if (
          validationRequest.baselineReadyAtMs
            !== null
        ) {
          this.maybeFinishValidationAfterDeepDwell();
        }
      }
    }

    const mapper =
      this.deepPersonalMapper;

    const baseline =
      this.faceBaseline;

    if (
      mapper === null
      || baseline === null
      || !mapper.getSnapshot().modelReady
    ) {
      return;
    }

    try {
      const aggregatedSamples =
        this.runtimeDeepFeatureAggregator.update(sample);

      if (aggregatedSamples === null) {
        return;
      }

      const anchorSample = aggregatedSamples.at(-1);
      if (anchorSample === undefined) {
        return;
      }

      const personalized =
        mapper.predictSamples(
          aggregatedSamples,
          baseline
        );

      if (personalized === null) {
        return;
      }

      // Both operands of the hybrid residual must represent the same
      // temporal support. DeepPersonalMapper used ALL aggregated frames;
      // comparing its output with only the final frame's baseline produces
      // a spurious residual during eye movements.
      const synchronizedSourceBaseline =
        meanSynchronizedSourceBaseline(
          aggregatedSamples,
          this.runtimeBaselineHistory
        );

      const runtimeCandidate =
        synchronizedSourceBaseline === null
          ? null
          : createDeepRuntimeCandidate(
              anchorSample,
              personalized,
              baseline,
              synchronizedSourceBaseline,
              nowTimelineMs()
            );

      if (runtimeCandidate !== null) {
        this.latestPersonalizedDeepRuntimeCandidate =
          runtimeCandidate;

        this.latestDeepPrecisionPx =
          this.deepPrecisionEstimator.update(
            runtimeCandidate.sourceTimestampMs,
            runtimeCandidate.normalizedPoint,
            this.trackingViewportSize
          );
      }

      this.deepPersonalPredictionCount += 1;

      if (
        this.deepPersonalPredictionCount === 1
        || this.deepPersonalPredictionCount % 25 === 0
      ) {
        logger.info(
          "Deep personalized screen prediction available in shadow mode.",
          {
            predictionCount:
              this.deepPersonalPredictionCount,
            timestampMs:
              sample.prediction.timestampMs,
            normalizedX:
              personalized.x,
            normalizedY:
              personalized.y,
            source:
              sample.prediction.source,
            mapper:
              mapper.getSnapshot()
          }
        );
      }
    } catch (error: unknown) {
      logger.warn(
        "Deep personalized shadow prediction failed; baseline tracking continues.",
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown deep personalized prediction error"
        }
      );
    }
  }

  /**
   * D24 page/tab transition boundary.
   *
   * Calibration/personalization remain valid for the participant, but
   * temporal gaze state must not leak across visually unrelated pages.
   */
  public handlePageContextTransition(): void {
    if (this.quickRecalibrationRunId !== null) {
      const calibrationId = this.calibrationManager?.getSnapshot().calibrationId;
      if (calibrationId !== null && calibrationId !== undefined) {
        this.abortQuickRecalibration(calibrationId, this.quickRecalibrationRunId);
      }
    }
    this.invalidatePendingGaze();
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.interrupt();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();
  }

  /**
   * Synchronizes the live CSS viewport owned by the active research page.
   * Normalized calibration/personalization state is intentionally preserved;
   * only pixel-derived temporal state is reset when the CSS coordinate frame
   * changes.
   */
  public updateTrackingViewportContext(
    viewportWidth: number,
    viewportHeight: number,
    devicePixelRatio: number
  ): boolean {
    if (
      !Number.isFinite(viewportWidth)
      || viewportWidth <= 0
      || !Number.isFinite(viewportHeight)
      || viewportHeight <= 0
      || !Number.isFinite(devicePixelRatio)
      || devicePixelRatio <= 0
    ) {
      return false;
    }

    const previous = this.trackingViewportSize;
    const changed =
      previous === null
      || Math.abs(previous.width - viewportWidth) > 0.5
      || Math.abs(previous.height - viewportHeight) > 0.5;

    this.trackingViewportSize = {
      width: viewportWidth,
      height: viewportHeight
    };
    if (changed) {
      this.handlePageContextTransition();
    }

    return changed;
  }

  /* ========================================================================
   * Independent validation runtime
   * ====================================================================== */

  public startValidation(
    calibrationId: CalibrationId,
    viewportWidth: number,
    viewportHeight: number,
    expectedPointCount: number
  ): void {
    this.assertUsable();
    this.assertCameraRunning();

    const calibrationModel =
      this.getCalibrationManagerOrThrow()
        .getModel();

    if (calibrationModel === null) {
      throw new TrackerError(
        ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
        "CALIBRATION",
        "Independent validation requires a fitted calibration model."
      );
    }

    this.cancelActiveValidationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A newer validation run replaced the previous point request."
      )
    );

    const manager =
      this.getValidationManagerOrThrow();

    const viewport = {
      width: viewportWidth,
      height: viewportHeight
    };

    this.trackingViewportSize = {
      ...viewport
    };
    this.invalidatePendingGaze();
    this.independentValidationActive = true;
    this.driftMonitorResumeAfterTimestampMs = 0;
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();

    manager.start(
      calibrationId,
      calibrationModel,
      viewport,
      expectedPointCount,
      this.faceBaseline
    );

    const deepMapperReady =
      this.deepPersonalMapper
        ?.getSnapshot().modelReady
      ?? false;

    const observerSuspended =
      this.gazePredictor
        ?.getSnapshot().observer.suspended
      ?? false;

    const deepDualValidationEnabled =
      this.deepSessionStrategyEligible
      && deepMapperReady
      && this.faceBaseline !== null
      && !observerSuspended;

    if (deepDualValidationEnabled) {
      this.getDeepIndependentValidatorOrThrow()
        .start(
          calibrationId,
          viewport,
          expectedPointCount
        );
    } else {
      this.deepIndependentValidator?.reset();
    }

    this.activeDeepValidationSamples = [];

    logger.info(
      "Independent calibration validation started.",
      {
        calibrationId,
        expectedPointCount,
        viewportWidth,
        viewportHeight,
        deepDualValidationEnabled,
        deepSessionStrategyEligible:
          this.deepSessionStrategyEligible,
        forceBaselineSessionStrategy:
          this.forceBaselineSessionStrategy,
        observerSuspended,
        deepMapperSnapshot:
          this.deepPersonalMapper
            ?.getSnapshot()
          ?? null
      }
    );
  }

  public getSelectedStrategyValidationResult():
  SessionStrategyValidationResult | null {
    const result = this.selectedStrategyValidationResult;

    if (result === null) {
      return null;
    }

    return {
      strategy: result.strategy,
      quality: result.quality,
      metrics: {
        ...result.metrics
      }
    };
  }

  public collectValidationPoint(
    calibrationId: CalibrationId,
    target: CalibrationTarget,
    targetShownAtMs: number
  ): Promise<ValidationManagerPointResult> {
    this.assertUsable();

    if (this.activeValidationPointRequest !== null) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "A validation target is already awaiting gaze samples."
      );
    }

    const manager =
      this.getValidationManagerOrThrow();

    manager.beginPoint(
      calibrationId,
      target,
      targetShownAtMs
    );

    this.activeDeepValidationSamples = [];

    return new Promise<ValidationManagerPointResult>(
      (resolve, reject) => {
        const deadlineMs =
          targetShownAtMs
          + CALIBRATION.POINT_TIMEOUT_MS;

        const timeoutDelayMs =
          Math.max(
            0,
            deadlineMs - nowTimelineMs()
          )
          + 50;

        const timeoutId =
          window.setTimeout(
            () => {
              this.finishActiveValidationPoint();
            },
            timeoutDelayMs
          );

        this.activeValidationPointRequest = {
          calibrationId,
          pointIndex: target.pointIndex,
          targetNormalizedPoint: {
            ...target.normalizedPoint
          },
          targetViewportPoint: {
            ...target.viewportPoint
          },
          targetShownAtMs,
          resolve,
          reject,
          timeoutId,
          deepGraceTimeoutId: null,
          baselineReadyAtMs: null,
          baselineResult: null
        };
      }
    );
  }

  private observeValidationFrame(
    result: GazeRuntimeFrameResult,
    faceQuality: FaceQualityFrameResult,
    faceGeometry: FaceGeometryFrameResult
  ): void {
    const request =
      this.activeValidationPointRequest;

    if (request === null) {
      return;
    }

    /*
     * Once the established collector declares READY, freeze its point result
     * immediately. The UI target may remain visible a little longer only for
     * the slower deep observer; those extra frames must not change the
     * authoritative WebEyeTrack validation score.
     */
    if (request.baselineResult !== null) {
      return;
    }

    const manager =
      this.getValidationManagerOrThrow();

    const decision =
      manager.observe({
        prediction: result.prediction,
        gazeValid: result.validation.valid,
        gazeQuality: result.quality.score,
        face: faceQuality.trackingQuality,
        faceCenterNormalized:
          faceGeometry.geometry
            ?.centerNormalized
          ?? null
      });

    if (decision.phase === "TIMED_OUT") {
      this.finishActiveValidationPoint();
      return;
    }

    if (decision.phase === "READY") {
      try {
        request.baselineResult =
          manager.finishActivePoint(
            nowTimelineMs()
          );
      } catch (error: unknown) {
        this.activeValidationPointRequest = null;
        this.activeDeepValidationSamples = [];

        window.clearTimeout(
          request.timeoutId
        );

        request.reject(error);
        return;
      }

      this.maybeFinishValidationAfterDeepDwell();
    }
  }

  private getPostSettleDeepValidationSamples():
  readonly GazeObserverRuntimeSample[] {
    const request =
      this.activeValidationPointRequest;

    if (request === null) {
      return [];
    }

    const minimumTimestampMs =
      request.targetShownAtMs
      + CALIBRATION.TARGET_SETTLE_MS;

    return this.activeDeepValidationSamples
      .filter(
        (sample) =>
          sample.prediction.timestampMs
            >= minimumTimestampMs
      );
  }

  private maybeFinishValidationAfterDeepDwell():
  void {
    const request =
      this.activeValidationPointRequest;

    if (request === null) {
      return;
    }

    const mapper = this.deepPersonalMapper;
    const baseline = this.faceBaseline;
    const validator = this.deepIndependentValidator;

    const deepValidationActive =
      mapper?.getSnapshot().modelReady === true
      && baseline !== null
      && validator?.getSnapshot().calibrationId
        === request.calibrationId;

    if (
      !deepValidationActive
      || mapper === null
      || baseline === null
      || validator === null
    ) {
      this.finishActiveValidationPoint();
      return;
    }

    const selectedSamples =
      this.getPostSettleDeepValidationSamples()
        .slice(
          -DEEP_PERSONALIZATION
            .MAX_DEEP_VALIDATION_SAMPLES_PER_POINT
        );

    const dwell = validator.assessDwell(
      selectedSamples,
      mapper,
      baseline
    );

    const nowMs = nowTimelineMs();
    const elapsedMs = Math.max(
      0,
      nowMs - request.targetShownAtMs
    );
    const postSettleElapsedMs = Math.max(
      0,
      nowMs
        - request.targetShownAtMs
        - CALIBRATION.TARGET_SETTLE_MS
    );

    const preferredReady =
      dwell.acceptedSampleCount
        >= DEEP_PERSONALIZATION
          .VALIDATION_DEEP_PREFERRED_SAMPLE_COUNT;

    const stableMinimumReady =
      dwell.acceptedSampleCount
        >= DEEP_PERSONALIZATION
          .VALIDATION_DEEP_MIN_ACCEPTED_SAMPLE_COUNT
      && dwell.stable;

    if (preferredReady || stableMinimumReady) {
      if (request.deepGraceTimeoutId !== null) {
        window.clearTimeout(
          request.deepGraceTimeoutId
        );
        request.deepGraceTimeoutId = null;
      }

      logger.info(
        "Robust deep validation dwell requirement satisfied; completing independent target.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          elapsedMs,
          postSettleElapsedMs,
          preferredReady,
          stableMinimumReady,
          dwell
        }
      );

      this.finishActiveValidationPoint();
      return;
    }

    if (request.baselineReadyAtMs !== null) {
      return;
    }

    request.baselineReadyAtMs =
      nowTimelineMs();

    const remainingDwellMs = Math.max(
      0,
      request.targetShownAtMs
        + CALIBRATION.TARGET_SETTLE_MS
        + DEEP_PERSONALIZATION
          .VALIDATION_DEEP_MAX_DWELL_MS
        - nowTimelineMs()
    );

    if (remainingDwellMs === 0) {
      logger.info(
        "Robust deep validation maximum dwell already reached; completing with available observations.",
        {
          calibrationId: request.calibrationId,
          pointIndex: request.pointIndex,
          elapsedMs,
          postSettleElapsedMs,
          dwell
        }
      );
      this.finishActiveValidationPoint();
      return;
    }

    request.deepGraceTimeoutId =
      window.setTimeout(
        () => {
          const activeRequest =
            this.activeValidationPointRequest;

          if (
            activeRequest === null
            || activeRequest.calibrationId
              !== request.calibrationId
            || activeRequest.pointIndex
              !== request.pointIndex
          ) {
            return;
          }

          activeRequest.deepGraceTimeoutId = null;

          const activeMapper = this.deepPersonalMapper;
          const activeBaseline = this.faceBaseline;
          const activeValidator = this.deepIndependentValidator;
          const finalSamples =
            this.getPostSettleDeepValidationSamples()
              .slice(
                -DEEP_PERSONALIZATION
                  .MAX_DEEP_VALIDATION_SAMPLES_PER_POINT
              );

          const finalDwell =
            activeMapper !== null
            && activeBaseline !== null
            && activeValidator !== null
              ? activeValidator.assessDwell(
                  finalSamples,
                  activeMapper,
                  activeBaseline
                )
              : null;

          logger.info(
            "Robust deep validation maximum dwell elapsed; completing independent target with available observations.",
            {
              calibrationId:
                activeRequest.calibrationId,
              pointIndex:
                activeRequest.pointIndex,
              maximumPostSettleDwellMs:
                DEEP_PERSONALIZATION
                  .VALIDATION_DEEP_MAX_DWELL_MS,
              postSettleElapsedMs: Math.max(
                0,
                nowTimelineMs()
                  - activeRequest.targetShownAtMs
                  - CALIBRATION.TARGET_SETTLE_MS
              ),
              dwell: finalDwell,
              observerSnapshot:
                this.gazePredictor
                  ?.getSnapshot().observer
                ?? null
            }
          );

          this.finishActiveValidationPoint();
        },
        remainingDwellMs
      );

    logger.info(
      "Baseline validation point is ready; adaptively extending target for robust deep observations.",
      {
        calibrationId: request.calibrationId,
        pointIndex: request.pointIndex,
        remainingDwellMs,
        maximumPostSettleDwellMs:
          DEEP_PERSONALIZATION
            .VALIDATION_DEEP_MAX_DWELL_MS,
        minimumAcceptedSampleCount:
          DEEP_PERSONALIZATION
            .VALIDATION_DEEP_MIN_ACCEPTED_SAMPLE_COUNT,
        preferredSampleCount:
          DEEP_PERSONALIZATION
            .VALIDATION_DEEP_PREFERRED_SAMPLE_COUNT,
        dwell,
        observerSnapshot:
          this.gazePredictor
            ?.getSnapshot().observer
          ?? null
      }
    );
  }

  private finishActiveValidationPoint():
  void {
    const request =
      this.activeValidationPointRequest;

    if (request === null) {
      return;
    }

    this.activeValidationPointRequest = null;

    const deepSamples =
      this.activeDeepValidationSamples;

    this.activeDeepValidationSamples = [];

    window.clearTimeout(
      request.timeoutId
    );

    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }

    try {
      const result =
        request.baselineResult
        ?? this.getValidationManagerOrThrow()
          .finishActivePoint(
            nowTimelineMs()
          );

      if (
        result.sufficient
        && this.faceBaseline !== null
        && this.deepPersonalMapper
          ?.getSnapshot().modelReady
        && this.deepIndependentValidator
          ?.getSnapshot().calibrationId
          === request.calibrationId
      ) {
        const selectedDeepSamples =
          deepSamples
            .filter(
              (sample) =>
                sample.prediction.timestampMs
                  >= request.targetShownAtMs
                    + CALIBRATION.TARGET_SETTLE_MS
            )
            .slice(
              -DEEP_PERSONALIZATION
                .MAX_DEEP_VALIDATION_SAMPLES_PER_POINT
            );

        try {
          const deepPoint =
            this.getDeepIndependentValidatorOrThrow()
              .addPoint(
                {
                  pointIndex:
                    request.pointIndex,
                  targetNormalizedPoint:
                    request.targetNormalizedPoint,
                  targetViewportPoint:
                    request.targetViewportPoint,
                  samples:
                    selectedDeepSamples
                },
                this.getDeepPersonalMapperOrThrow(),
                this.faceBaseline
              );

          logger.info(
            "Robust independent validation point diagnostic",
            {
              calibrationId:
                request.calibrationId,
              pointIndex:
                request.pointIndex,
              bufferedDeepSampleCount:
                deepSamples.length,
              selectedDeepSampleCount:
                selectedDeepSamples.length,
              rawDeepSampleCount:
                deepPoint.rawDeepSampleCount,
              qualityRejectedDeepSampleCount:
                deepPoint.qualityRejectedDeepSampleCount,
              spatialOutlierRejectedDeepSampleCount:
                deepPoint.spatialOutlierRejectedDeepSampleCount,
              acceptedDeepSampleCount:
                deepPoint.acceptedDeepSampleCount,
              rawDeepCenterX:
                deepPoint.rawDeepCenterViewportPoint.x,
              rawDeepCenterY:
                deepPoint.rawDeepCenterViewportPoint.y,
              robustDeepCenterX:
                deepPoint.robustDeepCenterViewportPoint.x,
              robustDeepCenterY:
                deepPoint.robustDeepCenterViewportPoint.y,
              rawDeepPrecisionPx:
                deepPoint.rawDeepPrecisionPx,
              robustDeepPrecisionPx:
                deepPoint.robustDeepPrecisionPx,
              rawDeepErrorPx:
                deepPoint.rawDeepErrorPx,
              robustDeepErrorPx:
                deepPoint.errorPx,
              meanDeepConfidence:
                deepPoint.meanConfidence,
              deepErrorPx:
                deepPoint.errorPx,
              deepMeanPrecisionPx:
                deepPoint.meanPrecisionPx
            }
          );
        } catch (error: unknown) {
          logger.warn(
            "Deep independent validation point could not be scored; authoritative baseline validation continues.",
            {
              calibrationId:
                request.calibrationId,
              pointIndex:
                request.pointIndex,
              bufferedDeepSampleCount:
                deepSamples.length,
              selectedDeepSampleCount:
                selectedDeepSamples.length,
              deepValidationSnapshot:
                this.deepIndependentValidator
                  ?.getSnapshot()
                ?? null,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown deep independent-validation error"
            }
          );
        }
      }

      logger.info(
        "Validation point collection finished.",
        {
          calibrationId: result.calibrationId,
          pointIndex: result.pointIndex,
          sufficient: result.sufficient,
          acceptedSampleCount:
            result.acceptedSampleCount,
          rejectedSampleCount:
            result.rejectedSampleCount,
          completedPointCount:
            result.completedPointCount,
          expectedPointCount:
            result.expectedPointCount,
          validationComplete:
            result.validationComplete,
          quality:
            result.validation?.quality ?? null,
          meanErrorPx:
            result.validation?.metrics
              .meanErrorPx ?? null,
          p95ErrorPx:
            result.validation?.metrics
              .p95ErrorPx ?? null,
          meanErrorViewportWidthRatio:
            result.validation?.metrics
              .meanErrorViewportWidthRatio ?? null,
          meanPrecisionPx:
            result.validation?.metrics
              .meanPrecisionPx ?? null,
          validSampleRatio:
            result.validation?.metrics
              .validSampleRatio ?? null
        }
      );

      if (
        result.validationComplete
        && result.validation !== null
      ) {
        /*
         * V6 safety default: independent Baseline validation is always a
         * complete, directly observed fallback. Deep/Hybrid may replace it
         * only when their own independent comparison completes successfully
         * and passes the session safety gate. This is a one-way demotion
         * policy; validation never retunes model weights or promotes a model
         * that calibration did not already fit.
         */
        const baselineValidation =
          evaluateBaselineSessionStrategyValidation(
            result.validation
          );

        this.selectedStrategyValidationResult =
          baselineValidation;
        this.authoritativeSessionValidationReady =
          baselineValidation.quality === "GOOD"
          || baselineValidation.quality === "ACCEPTABLE";
        this.authoritativeSessionDegradedCollectionAllowed =
          baselineValidation.quality === "POOR";

        if (!this.deepSessionStrategyEligible) {
          this.forceBaselineSessionStrategy = true;
        }

        this.independentValidationActive = false;
        this.runtimeGazeDriftMonitor.reset();
        this.lastLoggedRuntimeDriftSeverity = null;
        this.driftMonitorResumeAfterTimestampMs =
          nowTimelineMs()
          + DEEP_PERSONALIZATION
            .DRIFT_MONITOR_POST_VALIDATION_WARMUP_MS;

        logger.info(
          `[ValidationSafetySummary] strategy=BASELINE_ONLY quality=${baselineValidation.quality} meanErrorPx=${baselineValidation.metrics.meanErrorPx.toFixed(1)} p95ErrorPx=${baselineValidation.metrics.p95ErrorPx.toFixed(1)} meanPrecisionPx=${baselineValidation.metrics.meanPrecisionPx.toFixed(1)} p95PrecisionPx=${baselineValidation.metrics.p95PrecisionPx.toFixed(1)} validRatio=${baselineValidation.metrics.validSampleRatio.toFixed(3)}`
        );

        logger.info(
          "Baseline independent validation established the default session safety gate.",
          {
            calibrationId: request.calibrationId,
            quality: baselineValidation.quality,
            meanErrorPx:
              baselineValidation.metrics.meanErrorPx,
            p95ErrorPx:
              baselineValidation.metrics.p95ErrorPx,
            validationReady:
              this.authoritativeSessionValidationReady,
            degradedCollectionAllowed:
              this.authoritativeSessionDegradedCollectionAllowed,
            deepSessionStrategyEligible:
              this.deepSessionStrategyEligible,
            forceBaselineSessionStrategy:
              this.forceBaselineSessionStrategy
          }
        );
      }

      if (
        result.validationComplete
        && result.validation !== null
        && this.deepIndependentValidator
          ?.getSnapshot().calibrationId
          === request.calibrationId
      ) {
        try {
          const deepReport =
            this.getDeepIndependentValidatorOrThrow()
              .finish();

          const baselineMetrics =
            result.validation.metrics;

          const deepMetrics =
            deepReport.metrics;

          const meanImprovementPx =
            baselineMetrics.meanErrorPx
            - deepMetrics.meanErrorPx;

          const p95ImprovementPx =
            baselineMetrics.p95ErrorPx
            - deepMetrics.p95ErrorPx;

          const precisionImprovementPx =
            baselineMetrics.meanPrecisionPx
            - deepMetrics.meanPrecisionPx;

          logger.info(
            "Robust aggregation summary",
            {
              calibrationId:
                request.calibrationId,
              baseline: {
                quality:
                  result.validation.quality,
                meanErrorPx:
                  baselineMetrics.meanErrorPx,
                medianErrorPx:
                  baselineMetrics.medianErrorPx,
                rmsePx:
                  baselineMetrics.rmsePx,
                p90ErrorPx:
                  baselineMetrics.p90ErrorPx,
                p95ErrorPx:
                  baselineMetrics.p95ErrorPx,
                centerErrorPx:
                  baselineMetrics.centerErrorPx,
                edgeErrorPx:
                  baselineMetrics.edgeErrorPx,
                cornerErrorPx:
                  baselineMetrics.cornerErrorPx,
                meanPrecisionPx:
                  baselineMetrics.meanPrecisionPx,
                p95PrecisionPx:
                  baselineMetrics.p95PrecisionPx,
                validSampleRatio:
                  baselineMetrics.validSampleRatio
              },
              deep: {
                pointCount:
                  deepMetrics.pointCount,
                totalSampleCount:
                  deepMetrics.totalSampleCount,
                meanSampleCountPerPoint:
                  deepMetrics.meanSampleCountPerPoint,
                meanConfidence:
                  deepMetrics.meanConfidence,
                rawMeanErrorPx:
                  deepMetrics.rawMeanErrorPx,
                rawP95ErrorPx:
                  deepMetrics.rawP95ErrorPx,
                meanErrorPx:
                  deepMetrics.meanErrorPx,
                medianErrorPx:
                  deepMetrics.medianErrorPx,
                rmsePx:
                  deepMetrics.rmsePx,
                p90ErrorPx:
                  deepMetrics.p90ErrorPx,
                p95ErrorPx:
                  deepMetrics.p95ErrorPx,
                centerErrorPx:
                  deepMetrics.centerErrorPx,
                edgeErrorPx:
                  deepMetrics.edgeErrorPx,
                cornerErrorPx:
                  deepMetrics.cornerErrorPx,
                meanPrecisionPx:
                  deepMetrics.meanPrecisionPx,
                p95PrecisionPx:
                  deepMetrics.p95PrecisionPx
              },
              improvement: {
                meanErrorPx:
                  meanImprovementPx,
                meanErrorPercent:
                  baselineMetrics.meanErrorPx > 0
                    ? meanImprovementPx
                      / baselineMetrics.meanErrorPx
                      * 100
                    : 0,
                p95ErrorPx:
                  p95ImprovementPx,
                p95ErrorPercent:
                  baselineMetrics.p95ErrorPx > 0
                    ? p95ImprovementPx
                      / baselineMetrics.p95ErrorPx
                      * 100
                    : 0,
                meanPrecisionPx:
                  precisionImprovementPx,
                deepMeanErrorLower:
                  deepMetrics.meanErrorPx
                    < baselineMetrics.meanErrorPx,
                deepP95ErrorLower:
                  deepMetrics.p95ErrorPx
                    < baselineMetrics.p95ErrorPx
              }
            }
          );

          const baselinePointByIndex =
            new Map(
              result.validation.pointResults.map(
                (point) => [
                  point.pointIndex,
                  point
                ] as const
              )
            );

          for (const deepPoint of deepReport.pointResults) {
            const baselinePoint =
              baselinePointByIndex.get(
                deepPoint.pointIndex
              );

            if (baselinePoint === undefined) {
              continue;
            }

            logger.info(
              "Dual independent validation point comparison.",
              {
                calibrationId:
                  request.calibrationId,
                pointIndex:
                  deepPoint.pointIndex,
                targetViewportPoint:
                  deepPoint.targetViewportPoint,
                baselineErrorPx:
                  baselinePoint.errorPx,
                deepErrorPx:
                  deepPoint.errorPx,
                deepImprovementPx:
                  baselinePoint.errorPx
                    - deepPoint.errorPx,
                deepSampleCount:
                  deepPoint.sampleCount,
                deepMeanConfidence:
                  deepPoint.meanConfidence
              }
            );
          }

          const hybridSelector =
            this.calibrationHybridSelector;

          if (
            hybridSelector !== null
            && hybridSelector.getFitResult() !== null
          ) {
            const hybridReport =
              evaluateHybridIndependentValidation(
                request.calibrationId,
                result.validation,
                deepReport,
                hybridSelector
              );

            const hybridMetrics =
              hybridReport.metrics;

            const calibrationSelectedValidation =
              evaluateSelectedSessionStrategyValidation(
                result.validation,
                deepReport,
                hybridReport
              );

            const baselineStrategyValidation =
              evaluateBaselineSessionStrategyValidation(
                result.validation
              );

            const calibrationSelectedPassed =
              calibrationSelectedValidation.quality === "GOOD"
              || calibrationSelectedValidation.quality === "ACCEPTABLE";
            const baselinePassed =
              baselineStrategyValidation.quality === "GOOD"
              || baselineStrategyValidation.quality === "ACCEPTABLE";

            const safetyDowngradeToBaseline =
              calibrationSelectedValidation.strategy !== "BASELINE_ONLY"
              && !calibrationSelectedPassed
              && baselinePassed;

            const selectedStrategyValidation =
              safetyDowngradeToBaseline
                ? baselineStrategyValidation
                : calibrationSelectedValidation;

            this.forceBaselineSessionStrategy =
              safetyDowngradeToBaseline;
            this.selectedStrategyValidationResult =
              selectedStrategyValidation;
            this.authoritativeSessionValidationReady =
              selectedStrategyValidation.quality === "GOOD"
              || selectedStrategyValidation.quality === "ACCEPTABLE";
            this.authoritativeSessionDegradedCollectionAllowed =
              selectedStrategyValidation.quality === "POOR";

            logger.info(
              safetyDowngradeToBaseline
                ? "Calibration-selected Deep/Hybrid strategy did not pass the independent safety gate; session was demoted to the independently validated Baseline."
                : "Calibration-selected session strategy independent readiness evaluated.",
              {
                calibrationId: request.calibrationId,
                calibrationSelectedSessionStrategy:
                  calibrationSelectedValidation.strategy,
                calibrationSelectedQuality:
                  calibrationSelectedValidation.quality,
                selectedSessionStrategy:
                  selectedStrategyValidation.strategy,
                quality:
                  selectedStrategyValidation.quality,
                safetyDowngradeToBaseline,
                meanErrorPx:
                  selectedStrategyValidation.metrics.meanErrorPx,
                p95ErrorPx:
                  selectedStrategyValidation.metrics.p95ErrorPx,
                meanErrorViewportWidthRatio:
                  selectedStrategyValidation.metrics
                    .meanErrorViewportWidthRatio,
                p95ErrorViewportWidthRatio:
                  selectedStrategyValidation.metrics
                    .p95ErrorViewportWidthRatio,
                meanPrecisionPx:
                  selectedStrategyValidation.metrics.meanPrecisionPx,
                p95PrecisionPx:
                  selectedStrategyValidation.metrics.p95PrecisionPx,
                validSampleRatio:
                  selectedStrategyValidation.metrics.validSampleRatio,
                authoritativeValidationReady:
                  this.authoritativeSessionValidationReady,
                degradedCollectionAllowed:
                  this.authoritativeSessionDegradedCollectionAllowed,
                recalibrationRecommended:
                  !this.authoritativeSessionValidationReady
              }
            );

            logger.info(
              "Calibration-only hybrid independent validation completed in shadow mode.",
              {
                calibrationId:
                  request.calibrationId,
                baselineMeanErrorPx:
                  baselineMetrics.meanErrorPx,
                deepMeanErrorPx:
                  deepMetrics.meanErrorPx,
                hybridMeanErrorPx:
                  hybridMetrics.meanErrorPx,
                selectedSessionStrategy:
                  hybridMetrics.selectedSessionStrategy,
                selectedStrategyMeanErrorPx:
                  hybridMetrics.selectedStrategyMeanErrorPx,
                selectedStrategyP95ErrorPx:
                  hybridMetrics.selectedStrategyP95ErrorPx,
                selectedStrategyRmsePx:
                  hybridMetrics.selectedStrategyRmsePx,
                selectedStrategyRegionHitRate:
                  hybridMetrics.selectedStrategyRegionHitRate,
                baselineP95ErrorPx:
                  baselineMetrics.p95ErrorPx,
                deepP95ErrorPx:
                  deepMetrics.p95ErrorPx,
                hybridP95ErrorPx:
                  hybridMetrics.p95ErrorPx,
                baselineBiasCorrectedMeanErrorPx:
                  hybridMetrics.baselineBiasCorrectedMeanErrorPx,
                baselineBiasCorrectedP95ErrorPx:
                  hybridMetrics.baselineBiasCorrectedP95ErrorPx,
                deepBiasCorrectedMeanErrorPx:
                  hybridMetrics.deepBiasCorrectedMeanErrorPx,
                deepBiasCorrectedP95ErrorPx:
                  hybridMetrics.deepBiasCorrectedP95ErrorPx,
                hybridMedianErrorPx:
                  hybridMetrics.medianErrorPx,
                hybridRmsePx:
                  hybridMetrics.rmsePx,
                hybridCenterErrorPx:
                  hybridMetrics.centerErrorPx,
                hybridEdgeErrorPx:
                  hybridMetrics.edgeErrorPx,
                hybridCornerErrorPx:
                  hybridMetrics.cornerErrorPx,
                baselineRegionHitRate:
                  hybridMetrics.baselineRegionHitRate,
                deepRegionHitRate:
                  hybridMetrics.deepRegionHitRate,
                hybridRegionHitRate:
                  hybridMetrics.hybridRegionHitRate,
                hybridAmbiguousRegionRate:
                  hybridMetrics.hybridAmbiguousRegionRate,
                meanAdaptiveUncertaintyRadiusNormalized:
                  hybridMetrics.meanAdaptiveUncertaintyRadiusNormalized,
                p95AdaptiveUncertaintyRadiusNormalized:
                  hybridMetrics.p95AdaptiveUncertaintyRadiusNormalized,
                uncertaintyClampRate:
                  hybridMetrics.uncertaintyClampRate,
                baselineHorizontalBandHitRate:
                  hybridMetrics.baselineHorizontalBandHitRate,
                deepHorizontalBandHitRate:
                  hybridMetrics.deepHorizontalBandHitRate,
                hybridHorizontalBandHitRate:
                  hybridMetrics.hybridHorizontalBandHitRate,
                baselineVerticalBandHitRate:
                  hybridMetrics.baselineVerticalBandHitRate,
                deepVerticalBandHitRate:
                  hybridMetrics.deepVerticalBandHitRate,
                hybridVerticalBandHitRate:
                  hybridMetrics.hybridVerticalBandHitRate,
                hybridVsBaselineMeanImprovementPercent:
                  baselineMetrics.meanErrorPx > 0
                    ? (baselineMetrics.meanErrorPx
                      - hybridMetrics.meanErrorPx)
                      / baselineMetrics.meanErrorPx
                      * 100
                    : 0,
                hybridVsDeepMeanImprovementPercent:
                  deepMetrics.meanErrorPx > 0
                    ? (deepMetrics.meanErrorPx
                      - hybridMetrics.meanErrorPx)
                      / deepMetrics.meanErrorPx
                      * 100
                    : 0,
                selectedStrategyVsBaselineMeanImprovementPercent:
                  baselineMetrics.meanErrorPx > 0
                    ? (baselineMetrics.meanErrorPx
                      - hybridMetrics.selectedStrategyMeanErrorPx)
                      / baselineMetrics.meanErrorPx
                      * 100
                    : 0,
                selectedStrategyVsDeepMeanImprovementPercent:
                  deepMetrics.meanErrorPx > 0
                    ? (deepMetrics.meanErrorPx
                      - hybridMetrics.selectedStrategyMeanErrorPx)
                      / deepMetrics.meanErrorPx
                      * 100
                    : 0
              }
            );

            for (const hybridPoint of hybridReport.pointResults) {
              logger.info(
                "Calibration-only hybrid independent validation point diagnostic.",
                {
                  calibrationId:
                    request.calibrationId,
                  pointIndex:
                    hybridPoint.pointIndex,
                  targetViewportPoint:
                    hybridPoint.targetViewportPoint,
                  targetSpatialBucket:
                    hybridPoint.targetSpatialBucket,
                  routingBucket:
                    hybridPoint.routingBucket,
                  directionalRoutingBucket:
                    hybridPoint.directionalRoutingBucket,
                  targetGazeRegion:
                    hybridPoint.targetGazeRegion,
                  baselineGazeRegion:
                    hybridPoint.baselineGazeRegion,
                  deepGazeRegion:
                    hybridPoint.deepGazeRegion,
                  hybridGazeRegion:
                    hybridPoint.hybridGazeRegion,
                  baselineRegionHit:
                    hybridPoint.baselineRegionHit,
                  deepRegionHit:
                    hybridPoint.deepRegionHit,
                  hybridRegionHit:
                    hybridPoint.hybridRegionHit,
                  hybridRegionAmbiguous:
                    hybridPoint.hybridRegionAmbiguous,
                  hybridRegionBoundaryMarginNormalized:
                    hybridPoint.hybridRegionBoundaryMarginNormalized,
                  baselineErrorPx:
                    hybridPoint.baselineErrorPx,
                  deepErrorPx:
                    hybridPoint.deepErrorPx,
                  baselineBiasCorrectedErrorPx:
                    hybridPoint.baselineBiasCorrectedErrorPx,
                  deepBiasCorrectedErrorPx:
                    hybridPoint.deepBiasCorrectedErrorPx,
                  baselineBiasCorrectionApplied:
                    hybridPoint.baselineBiasCorrectionApplied,
                  deepBiasCorrectionApplied:
                    hybridPoint.deepBiasCorrectionApplied,
                  baselineBiasCorrectionStrength:
                    hybridPoint.baselineBiasCorrectionStrength,
                  deepBiasCorrectionStrength:
                    hybridPoint.deepBiasCorrectionStrength,
                  baselineBiasCorrectionViewportPx:
                    hybridPoint.baselineBiasCorrectionViewportPx,
                  deepBiasCorrectionViewportPx:
                    hybridPoint.deepBiasCorrectionViewportPx,
                  hybridErrorPx:
                    hybridPoint.hybridErrorPx,
                  selectedSessionStrategy:
                    hybridPoint.selectedSessionStrategy,
                  selectedStrategyErrorPx:
                    hybridPoint.selectedStrategyErrorPx,
                  selectedStrategyGazeRegion:
                    hybridPoint.selectedStrategyGazeRegion,
                  selectedStrategyRegionHit:
                    hybridPoint.selectedStrategyRegionHit,
                  selectedStrategyDeepWeight:
                    hybridPoint.selectedStrategyDeepWeight,
                  calibrationRoutingInfluence:
                    hybridPoint.calibrationRoutingInfluence,
                  liveRoutingAttenuation:
                    hybridPoint.liveRoutingAttenuation,
                  effectiveRoutingInfluence:
                    hybridPoint.effectiveRoutingInfluence,
                  baselineExpectedErrorPx:
                    hybridPoint.baselineExpectedErrorPx,
                  deepExpectedErrorPx:
                    hybridPoint.deepExpectedErrorPx,
                  expectedHybridErrorPx:
                    hybridPoint.expectedHybridErrorPx,
                  directionalPriorReliability:
                    hybridPoint.directionalPriorReliability,
                  driftSeverity:
                    hybridPoint.driftSeverity,
                  deepConfidencePenaltyMultiplier:
                    hybridPoint.deepConfidencePenaltyMultiplier,
                  baselineStabilityPenaltyMultiplier:
                    hybridPoint.baselineStabilityPenaltyMultiplier,
                  deepStabilityPenaltyMultiplier:
                    hybridPoint.deepStabilityPenaltyMultiplier,
                  baselineMeanPrecisionPx:
                    hybridPoint.baselineMeanPrecisionPx,
                  deepMeanPrecisionPx:
                    hybridPoint.deepMeanPrecisionPx,
                  rawModelDisagreementNormalized:
                    hybridPoint.rawModelDisagreementNormalized,
                  modelDisagreementNormalized:
                    hybridPoint.modelDisagreementNormalized,
                  adaptiveUncertaintyRadiusNormalized:
                    hybridPoint.adaptiveUncertaintyRadiusNormalized,
                  uncertaintyUnclampedRadiusNormalized:
                    hybridPoint.uncertaintyUnclampedRadiusNormalized,
                  uncertaintyCalibrationPriorRadiusNormalized:
                    hybridPoint.uncertaintyCalibrationPriorRadiusNormalized,
                  uncertaintyTemporalNoiseRadiusNormalized:
                    hybridPoint.uncertaintyTemporalNoiseRadiusNormalized,
                  uncertaintyDisagreementRadiusNormalized:
                    hybridPoint.uncertaintyDisagreementRadiusNormalized,
                  uncertaintyBaselineRetentionRatio:
                    hybridPoint.uncertaintyBaselineRetentionRatio,
                  uncertaintyDeepRetentionRatio:
                    hybridPoint.uncertaintyDeepRetentionRatio,
                  uncertaintyClamped:
                    hybridPoint.uncertaintyClamped,
                  baselineWeight:
                    hybridPoint.baselineWeight,
                  deepWeight:
                    hybridPoint.deepWeight,
                  errorDerivedDeepWeight:
                    hybridPoint.errorDerivedDeepWeight,
                  calibrationReliabilityDeepWeight:
                    hybridPoint.calibrationReliabilityDeepWeight,
                  calibrationReliabilityRoutingApplied:
                    hybridPoint.calibrationReliabilityRoutingApplied,
                  coarseCalibrationReliabilityDeepWeight:
                    hybridPoint.coarseCalibrationReliabilityDeepWeight,
                  coarseCalibrationReliabilityRoutingApplied:
                    hybridPoint.coarseCalibrationReliabilityRoutingApplied,
                  activeReliabilityRoutingMode:
                    hybridPoint.activeReliabilityRoutingMode,
                  deepMeanConfidence:
                    hybridPoint.deepMeanConfidence,
                  deepSampleCount:
                    hybridPoint.deepSampleCount,
                  drift: {
                    deltaHeadYawDeg:
                      hybridPoint.meanDeltaHeadYawDeg,
                    deltaHeadPitchDeg:
                      hybridPoint.meanDeltaHeadPitchDeg,
                    deltaHeadRollDeg:
                      hybridPoint.meanDeltaHeadRollDeg,
                    deltaFaceCenterX:
                      hybridPoint.meanDeltaFaceCenterX,
                    deltaFaceCenterY:
                      hybridPoint.meanDeltaFaceCenterY,
                    faceWidthScaleDelta:
                      hybridPoint.meanFaceWidthScaleDelta,
                    faceHeightScaleDelta:
                      hybridPoint.meanFaceHeightScaleDelta,
                    faceDistanceDelta:
                      hybridPoint.meanFaceDistanceDelta
                  }
                }
              );
            }
          }
        } catch (error: unknown) {
          this.forceBaselineSessionStrategy = true;

          logger.warn(
            "Deep independent validation comparison could not be completed; independently validated Baseline is authoritative for this session.",
            {
              calibrationId:
                request.calibrationId,
              deepValidationSnapshot:
                this.deepIndependentValidator
                  ?.getSnapshot()
                ?? null,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown deep independent-validation completion error"
            }
          );
        }
      }

      if (
        result.validationComplete
        && this.quickRecalibrationActive
      ) {
        // Preserve the newly measured quality for the UI even when restoring
        // a previously GOOD model. Never claim the old quality is the result.
        this.completedQuickValidationResult = this.selectedStrategyValidationResult;
        const passed = this.authoritativeSessionValidationReady
          && (this.completedQuickValidationResult?.quality === "GOOD"
            || this.completedQuickValidationResult?.quality === "ACCEPTABLE");
        if (!passed && this.quickRecalibrationRunId !== null) {
          this.abortQuickRecalibration(request.calibrationId, this.quickRecalibrationRunId);
        } else {
          this.quickRecalibrationCheckpoint = null;
          this.quickRecalibrationRunId = null;
          if (this.quickRecalibrationTimeoutId !== null) {
            window.clearTimeout(this.quickRecalibrationTimeoutId);
            this.quickRecalibrationTimeoutId = null;
          }
        }
        this.quickRecalibrationActive = false;
        if (passed) {
          this.runtimeGazeDriftMonitor.reset();
          this.runtimeDeepFeatureAggregator.reset();
          this.baselinePrecisionEstimator.reset();
          this.deepPrecisionEstimator.reset();
          this.authoritativeGazeStabilizer.reset();
          this.fixationDetector.reset();
          this.latestBaselinePrecisionPx = null;
          this.latestDeepPrecisionPx = null;
          this.lastLoggedRuntimeDriftSeverity = null;
        }

        logger.info(
          passed
            ? "Quick recalibration candidate committed after independent validation."
            : "Quick recalibration candidate rejected; previous model restored.",
          {
            calibrationId: request.calibrationId,
            candidateValidationQuality:
              this.completedQuickValidationResult?.quality
              ?? result.validation?.quality
              ?? null,
            candidateValidationPassed: passed,
            previousModelRestored: !passed
          }
        );
      }

      request.resolve(result);
    } catch (error: unknown) {
      request.reject(error);
    }
  }

  private cancelActiveValidationPoint(
    error: TrackerError
  ): void {
    const request =
      this.activeValidationPointRequest;

    if (request === null) {
      return;
    }

    this.activeValidationPointRequest = null;
    this.activeDeepValidationSamples = [];

    window.clearTimeout(
      request.timeoutId
    );

    if (request.deepGraceTimeoutId !== null) {
      window.clearTimeout(
        request.deepGraceTimeoutId
      );
    }

    request.reject(error);
  }

  private async startFacePositioningInternal(
    generation: number
  ): Promise<FaceQualityFrameResult> {
    const landmarker =
      this.getFaceLandmarkerOrThrow();

    try {
      await landmarker.initialize();

      await this.initializeGazePredictorForFacePipeline();

      this.assertFaceAnalysisGeneration(
        generation
      );

      this.assertCameraRunning();

      this.resetFaceTemporalState();

      this.faceAnalysisRunning =
        true;

      const firstFrame =
        this.processCurrentFaceFrame(
          generation
        );

      this.startGazePrediction(
        firstFrame,
        generation
      );

      this.scheduleNextFaceFrame(
        generation
      );

      logger.info(
        "Face positioning pipeline started.",
        {
          frameSequence:
            firstFrame.quality.frameSequence,

          usableForGaze:
            firstFrame.quality.usableForGaze,

          scheduler:
            "OFFSCREEN_TIMER",

          targetAnalysisRateHz:
            FACE_PIPELINE_RUNTIME
              .TARGET_ANALYSIS_RATE_HZ
        }
      );

      return firstFrame.quality;
    } catch (error: unknown) {
      this.stopFaceAnalysis();

      throw normalizeTrackerError(
        error,
        ERROR_CODES.FACE_DETECTION_FAILED,
        "FACE",
        "Face positioning pipeline could not start."
      );
    }
  }

  private processCurrentFaceFrame(
    generation: number
  ): FacePipelineFrameBundle {
    this.assertFaceAnalysisGeneration(
      generation
    );

    const frame =
      this.getFrameCapture()
        .captureCurrentFrame();

    const cameraQuality =
      this.evaluateCameraQuality(
        frame
      );

    const landmarkerResult =
      this.getFaceLandmarkerOrThrow()
        .detect(frame);

    const geometryResult =
      this.getFaceGeometryAnalyzerOrThrow()
        .analyze(
          landmarkerResult
        );

    const headPoseResult =
      this.getHeadPoseEstimatorOrThrow()
        .analyze(
          landmarkerResult,
          geometryResult
        );

    const eyeGeometryResult =
      this.getEyeGeometryAnalyzerOrThrow()
        .analyze(
          landmarkerResult
        );

    const blinkResult =
      this.getBlinkDetectorOrThrow()
        .analyze(
          eyeGeometryResult
        );

    const qualityResult =
      this.getFaceQualityEvaluatorOrThrow()
        .evaluate({
          landmarker:
            landmarkerResult,

          geometry:
            geometryResult,

          headPose:
            headPoseResult,

          eyes:
            eyeGeometryResult,

          blink:
            blinkResult,

          cameraQuality
        });

    const preCalibration =
      this.getPreCalibrationMonitorOrThrow()
        .evaluate({
          geometry:
            geometryResult,

          headPose:
            headPoseResult,

          quality:
            qualityResult,

          cameraQuality
        });

    this.latestFaceQuality =
      qualityResult;

    this.latestPreCalibrationFeedback =
      preCalibration.feedback;

    if (
      preCalibration.baselineCaptured
      && preCalibration.baseline !== null
    ) {
      this.faceBaseline =
        preCalibration.baseline;

      logger.info(
        "Pre-calibration face baseline captured.",
        {
          frameSequence:
            qualityResult.frameSequence,

          sampleStableDurationMs:
            preCalibration.feedback
              .metrics.stableDurationMs,

          width:
            preCalibration.baseline.width,

          height:
            preCalibration.baseline.height
        }
      );
    }

    this.emitFaceQualityFrame(
      qualityResult,
      preCalibration.feedback
    );

    return {
      frame,
      landmarker: landmarkerResult,
      faceGeometry: geometryResult,
      headPose: headPoseResult,
      eyeGeometry: eyeGeometryResult,
      blink: blinkResult,
      quality: qualityResult
    };
  }

  private evaluateCameraQuality(
    frame: CameraFrameView
  ): CameraQuality | null {
    try {
      const quality =
        this.getCameraQualityEstimator()
          .evaluate(frame);

      this.latestCameraQuality =
        quality;

      return quality;
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES.CAMERA_QUALITY_FAILED,
          "CAMERA",
          "Camera quality evaluation failed during face analysis."
        );

      this.latestCameraQuality =
        null;

      this.reportFacePipelineError(
        normalized
      );

      return null;
    }
  }

  /**
   * Schedules the next face-analysis cycle independently of page/video
   * compositing. Offscreen Documents can stop receiving
   * requestVideoFrameCallback() callbacks even while their MediaStream keeps
   * producing frames, which previously left the pipeline permanently stuck
   * after the startup frame.
   */
  private scheduleNextFaceFrame(
    generation: number,
    delayMs: number =
      this.faceFrameIntervalMs
  ): void {
    if (
      !this.faceAnalysisRunning
      || generation
        !== this.faceAnalysisGeneration
      || this.faceFrameTimerId
        !== null
    ) {
      return;
    }

    this.faceFrameTimerId =
      window.setTimeout(
        () => {
          this.faceFrameTimerId =
            null;

          this.handleScheduledFaceFrame(
            generation
          );
        },
        Math.max(
          0,
          delayMs
        )
      );
  }

  private handleScheduledFaceFrame(
    generation: number
  ): void {
    if (
      !this.faceAnalysisRunning
      || generation
        !== this.faceAnalysisGeneration
    ) {
      return;
    }

    const cycleStartedAtMs =
      performance.now();

    try {
      const frame =
        this.processCurrentFaceFrame(
          generation
        );

      this.startGazePrediction(
        frame,
        generation
      );
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES.FACE_DETECTION_FAILED,
          "FACE",
          "Face analysis failed for the current camera frame."
        );

      if (!normalized.recoverable) {
        this.stopFaceAnalysis();

        this.handleRuntimeError(
          normalized
        );

        return;
      }

      this.reportFacePipelineError(
        normalized
      );
    }

    const processingDurationMs =
      performance.now()
      - cycleStartedAtMs;

    const nextDelayMs =
      Math.max(
        0,
        this.faceFrameIntervalMs
        - processingDurationMs
      );

    this.scheduleNextFaceFrame(
      generation,
      nextDelayMs
    );
  }

  private async initializeGazePredictorForFacePipeline():
  Promise<void> {
    const predictor =
      this.getGazePredictorOrThrow();

    if (
      predictor.getSnapshot().lifecycle
        === "READY"
    ) {
      return;
    }

    try {
      await predictor.initialize();
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          "Gaze predictor initialization failed during face pipeline startup."
        );

      this.handleRuntimeError(normalized);
    }
  }

  private startGazePrediction(
    frame: FacePipelineFrameBundle,
    generation: number
  ): void {
    const predictor = this.gazePredictor;

    if (
      predictor === null
      || predictor.getSnapshot().lifecycle
        !== "READY"
      || this.gazePredictionInFlight
    ) {
      return;
    }

    this.gazePredictionInFlight = true;

    void this.processGazePrediction(
      predictor,
      frame,
      generation
    ).finally(
      () => {
        this.gazePredictionInFlight = false;
      }
    );
  }

  private invalidatePendingGaze(): void {
    this.gazeContextGeneration += 1;
    this.gazePredictor?.invalidateObserverSamples();
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
  }

  private async processGazePrediction(
    predictor: GazePredictor,
    frame: FacePipelineFrameBundle,
    generation: number
  ): Promise<void> {
    const contextGeneration = this.gazeContextGeneration;
    const input: GazeEngineFrameInput = {
      frame: frame.frame,
      landmarker: frame.landmarker,
      faceGeometry: frame.faceGeometry,
      headPose: frame.headPose,
      eyeGeometry: frame.eyeGeometry,
      blink: frame.blink,
      faceQuality: frame.quality
    };

    try {
      const prediction =
        await predictor.predict(input);

      if (
        prediction === null
        || !this.faceAnalysisRunning
        || contextGeneration !== this.gazeContextGeneration
        || generation
          !== this.faceAnalysisGeneration
      ) {
        return;
      }

      const validation =
        validateGazePrediction(
          prediction,
          {
            expectedTimestampMs:
              frame.frame.metadata.timestampMs
          }
        );

      const quality =
        evaluateGazeQuality({
          prediction,
          validation,
          faceQuality: frame.quality
        });

      const routedBaselinePrediction =
        this.createCalibratedRuntimeBaselinePrediction(
          prediction
        );

      if (validation.valid && quality.valid) {
        this.rememberRuntimeBaselinePrediction(
          frame.frame.metadata.frameSequence,
          routedBaselinePrediction
        );
      } else {
        this.baselinePrecisionEstimator.reset();
        this.deepPrecisionEstimator.reset();
        this.runtimeDeepFeatureAggregator.reset();
        this.latestDeepPrecisionPx = null;
        this.latestPersonalizedDeepRuntimeCandidate = null;
      }

      this.latestBaselinePrecisionPx =
        validation.valid && quality.valid
        && routedBaselinePrediction.rawSpace === "NORMALIZED"
          ? this.baselinePrecisionEstimator.update(
              routedBaselinePrediction.timestampMs,
              routedBaselinePrediction.rawPoint,
              this.trackingViewportSize
            )
          : null;

      const currentDrift =
        this.createCurrentRuntimeDrift(frame);

      const driftMonitoringAllowed =
        !this.independentValidationActive
        && prediction.timestampMs
          >= this.driftMonitorResumeAfterTimestampMs
        && (
          this.authoritativeSessionValidationReady
          || this.authoritativeSessionDegradedCollectionAllowed
        );

      const rawDriftStatus =
        driftMonitoringAllowed
          ? this.runtimeGazeDriftMonitor.update(
              prediction.timestampMs,
              validation.valid && quality.valid ? currentDrift : null,
              this.trackingViewportSize,
              this.latestBaselinePrecisionPx,
              quality.score
            )
          : null;

      const driftStatus =
        rawDriftStatus === null
          ? null
          : this.automaticQuickRecalibrationEnabled
            ? rawDriftStatus
            : {
                ...rawDriftStatus,
                quickRecalibrationRecommended: false
              };

      if (
        driftStatus !== null
        && (
          driftStatus.severity !== this.lastLoggedRuntimeDriftSeverity
          || driftStatus.quickRecalibrationRecommended
        )
      ) {
        logger.info(
          "Runtime calibration drift state changed.",
          {
            severity: driftStatus.severity,
            faceCenterDeltaPx: driftStatus.faceCenterDeltaPx,
            faceDistanceDeltaRatio: driftStatus.faceDistanceDeltaRatio,
            yawDeltaDeg: driftStatus.yawDeltaDeg,
            pitchDeltaDeg: driftStatus.pitchDeltaDeg,
            rollDeltaDeg: driftStatus.rollDeltaDeg,
            baselinePrecisionPx: this.latestBaselinePrecisionPx,
            deepPrecisionPx: this.latestDeepPrecisionPx,
            precisionReferencePx:
              driftStatus.precisionReferencePx ?? null,
            precisionRatio:
              driftStatus.precisionRatio ?? null,
            monitoringElapsedMs:
              driftStatus.monitoringElapsedMs ?? null,
            periodicMaintenanceDue:
              driftStatus.periodicMaintenanceDue ?? false,
            maintenanceReason:
              driftStatus.maintenanceReason ?? null,
            quickRecalibrationRecommended:
              driftStatus.quickRecalibrationRecommended
          }
        );
        this.lastLoggedRuntimeDriftSeverity = driftStatus.severity;
      }

      const driftQualityMultiplier =
        driftStatus?.severity === "HIGH"
          ? RUNTIME_MAINTENANCE.HIGH_DRIFT_QUALITY_MULTIPLIER
          : driftStatus?.severity === "MEDIUM"
            ? RUNTIME_MAINTENANCE.MEDIUM_DRIFT_QUALITY_MULTIPLIER
            : 1;

      const effectiveQualityScore = Math.min(
        1,
        Math.max(0, quality.score * driftQualityMultiplier)
      );

      const collectionSuspendedForDrift =
        RUNTIME_MAINTENANCE.SUSPEND_COLLECTION_ON_RECALIBRATION_RECOMMENDATION
        && driftStatus?.quickRecalibrationRecommended === true;

      const authoritativeGaze =
        selectSessionRuntimeGaze(
          routedBaselinePrediction,
          this.latestPersonalizedDeepRuntimeCandidate,
          this.calibrationHybridSelector,
          {
            validationReady:
              this.authoritativeSessionValidationReady,
            allowDegradedCollection:
              this.authoritativeSessionDegradedCollectionAllowed,
            currentDrift,
            baselinePrecisionPx:
              this.latestBaselinePrecisionPx,
            deepPrecisionPx:
              this.latestDeepPrecisionPx,
            forceBaselineStrategy:
              this.forceBaselineSessionStrategy,
            forceBaselineForDrift:
              rawDriftStatus?.quickRecalibrationRecommended === true,
            suspendCollectionForDrift:
              collectionSuspendedForDrift
          }
        );

      const precisionRatio =
        driftStatus?.precisionRatio ?? null;

      const adaptiveSmoothingMultiplier =
        precisionRatio !== null
        && Number.isFinite(precisionRatio)
        && precisionRatio
          > RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_START_RATIO
          ? Math.min(
              RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_MAX_MULTIPLIER,
              1 + (
                precisionRatio
                - RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_START_RATIO
              ) * RUNTIME_MAINTENANCE.ADAPTIVE_SMOOTHING_GAIN
            )
          : 1;

      const stabilizedGaze =
        this.authoritativeGazeStabilizer.update({
          timestampMs: prediction.timestampMs,
          normalizedPoint:
            authoritativeGaze.normalizedPoint,
          viewport:
            this.trackingViewportSize,
          gazeValid:
            authoritativeGaze.collectionAllowed
            && validation.valid
            && quality.valid,
          smoothingMultiplier:
            adaptiveSmoothingMultiplier
        });

      const fixation =
        this.fixationDetector.update({
          timestampMs: prediction.timestampMs,
          stabilizedViewportPoint:
            stabilizedGaze.stabilizedViewportPoint,
          currentSampleValid:
            stabilizedGaze.currentSampleValid,
          stabilizedSpeedPxPerSecond:
            stabilizedGaze.stabilizedSpeedPxPerSecond,
          qualityScore: effectiveQualityScore,
          authoritativeStrategy:
            authoritativeGaze.strategy
        });

      const result: GazeRuntimeFrameResult = {
        frameSequence:
          frame.frame.metadata.frameSequence,
        prediction,
        validation,
        quality,
        observer:
          predictor.getSnapshot().observer,
        authoritativeGaze,
        driftStatus,
        effectiveQualityScore,
        baselinePrecisionPx: this.latestBaselinePrecisionPx,
        deepPrecisionPx: this.latestDeepPrecisionPx,
        collectionSuspendedForDrift,
        maintenanceCalibrationActive:
          this.quickRecalibrationActive,
        stabilizedGaze,
        fixation
      };

      this.latestGazeFrame = result;

      this.observeCalibrationFrame(
        result,
        frame.quality,
        frame.faceGeometry
      );

      this.observeValidationFrame(
        result,
        frame.quality,
        frame.faceGeometry
      );

      this.emitGazeRuntimeFrame(result);
    } catch (error: unknown) {
      const normalized =
        normalizeTrackerError(
          error,
          ERROR_CODES.GAZE_PREDICTION_FAILED,
          "GAZE",
          "Gaze prediction failed for the current camera frame."
        );

      this.handleRuntimeError(normalized);
    }
  }

  /**
   * Runtime authoritative routing must use the same participant-specific
   * screen correction that independent validation evaluated. The original
   * prediction remains in GazeRuntimeFrameResult so raw research data is
   * preserved and no validation/calibration target leaks into runtime.
   */
  private createCalibratedRuntimeBaselinePrediction(
    prediction: GazePrediction
  ): GazePrediction {
    const corrector = this.residualCorrector;
    const viewport = this.trackingViewportSize;

    if (
      prediction.rawSpace !== "NORMALIZED"
      || corrector === null
      || !corrector.hasModel()
      || viewport === null
    ) {
      return prediction;
    }

    try {
      const corrected = corrector.correct(
        prediction.rawPoint,
        prediction.rawSpace,
        viewport
      );

      return {
        ...prediction,
        rawPoint: {
          ...corrected.correctedNormalizedPoint
        }
      };
    } catch {
      // A correction failure must never stop webcam gaze acquisition.
      return prediction;
    }
  }

  private rememberRuntimeBaselinePrediction(
    frameSequence: number,
    prediction: GazePrediction
  ): void {
    if (
      prediction.rawSpace !== "NORMALIZED"
      || !Number.isFinite(prediction.rawPoint.x)
      || !Number.isFinite(prediction.rawPoint.y)
    ) {
      return;
    }

    this.runtimeBaselineHistory.set(
      frameSequence,
      {
        frameSequence,
        timestampMs: prediction.timestampMs,
        normalizedPoint: {
          x: prediction.rawPoint.x,
          y: prediction.rawPoint.y
        }
      }
    );

    const oldestAllowedTimestampMs =
      prediction.timestampMs
      - DEEP_PERSONALIZATION
        .LIVE_DEEP_MAX_SOURCE_AGE_MS;

    for (const [
      key,
      sample
    ] of this.runtimeBaselineHistory) {
      if (
        sample.timestampMs
          < oldestAllowedTimestampMs
      ) {
        this.runtimeBaselineHistory.delete(key);
      }
    }
  }

  private createCurrentRuntimeDrift(
    frame: FacePipelineFrameBundle
  ): HybridDriftContext | null {
    const baseline =
      this.faceBaseline;

    const geometry =
      frame.faceGeometry.geometry;

    const headPose =
      frame.headPose.headPose;

    if (
      baseline === null
      || geometry === null
      || headPose === null
    ) {
      return null;
    }

    const baselineWidth = Math.max(
      Number.EPSILON,
      baseline.width
    );

    const baselineHeight = Math.max(
      Number.EPSILON,
      baseline.height
    );

    const baselineDistance = Math.max(
      Number.EPSILON,
      baseline.distanceRatio
    );

    return {
      deltaHeadYawDeg:
        headPose.yawDeg
        - baseline.headPose.yawDeg,
      deltaHeadPitchDeg:
        headPose.pitchDeg
        - baseline.headPose.pitchDeg,
      deltaHeadRollDeg:
        headPose.rollDeg
        - baseline.headPose.rollDeg,
      deltaFaceCenterX:
        geometry.centerNormalized.x
        - baseline.centerX,
      deltaFaceCenterY:
        geometry.centerNormalized.y
        - baseline.centerY,
      faceWidthScaleDelta:
        geometry.widthRatio
        / baselineWidth
        - 1,
      faceHeightScaleDelta:
        geometry.heightRatio
        / baselineHeight
        - 1,
      faceDistanceDelta:
        frame.quality.trackingQuality
          .faceDistanceRatio
        / baselineDistance
        - 1
    };
  }

  private emitGazeRuntimeFrame(
    result: GazeRuntimeFrameResult
  ): void {
    if (this.onGazeRuntimeFrame === null) {
      return;
    }

    try {
      this.onGazeRuntimeFrame(result);
    } catch (error: unknown) {
      logger.warn(
        "Gaze runtime frame callback failed.",
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown gaze callback error"
        }
      );
    }
  }

  private stopFaceAnalysis(): void {
    this.invalidatePendingGaze();
    this.faceAnalysisGeneration += 1;
    this.faceAnalysisRunning = false;
    this.latestPersonalizedDeepRuntimeCandidate = null;
    this.runtimeBaselineHistory.clear();
    this.authoritativeSessionValidationReady = false;
    this.authoritativeSessionDegradedCollectionAllowed = false;
    this.selectedStrategyValidationResult = null;
    this.deepSessionStrategyEligible = false;
    this.forceBaselineSessionStrategy = false;
    this.independentValidationActive = false;
    this.driftMonitorResumeAfterTimestampMs = 0;
    this.trackingViewportSize = null;
    this.authoritativeGazeStabilizer.reset();
    this.runtimeDeepFeatureAggregator.reset();
    this.baselinePrecisionEstimator.reset();
    this.deepPrecisionEstimator.reset();
    this.runtimeGazeDriftMonitor.reset();
    this.latestBaselinePrecisionPx = null;
    this.latestDeepPrecisionPx = null;
    this.lastLoggedRuntimeDriftSeverity = null;
    this.fixationDetector.reset();

    this.cancelActiveCalibrationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Calibration point collection stopped with the face-analysis pipeline."
      )
    );

    this.cancelActiveValidationPoint(
      new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "CALIBRATION",
        "Validation point collection stopped with the face-analysis pipeline."
      )
    );

    this.quickRecalibrationActive = false;
    this.quickRecalibrationCheckpoint = null;
    this.quickRecalibrationRunId = null;
    this.completedQuickValidationResult = null;
    if (this.quickRecalibrationTimeoutId !== null) {
      window.clearTimeout(this.quickRecalibrationTimeoutId);
      this.quickRecalibrationTimeoutId = null;
    }
    this.calibrationManager?.reset();
    this.validationManager?.reset();
    this.residualCorrector?.clear();
    this.deepPersonalMapper?.reset();
    this.deepIndependentValidator?.reset();
    this.calibrationHybridSelector?.reset();
    this.activeDeepCalibrationSamples = [];
    this.activeDeepValidationSamples = [];
    this.deepPersonalPredictionCount = 0;

    if (
      this.faceFrameTimerId
      !== null
    ) {
      window.clearTimeout(
        this.faceFrameTimerId
      );

      this.faceFrameTimerId =
        null;
    }

    this.resetFaceTemporalState();

    this.latestCameraQuality =
      null;

    this.latestFaceQuality =
      null;

    this.latestGazeFrame =
      null;

    this.lastReportedFaceErrorAtMs =
      null;

    this.lastReportedFaceErrorCode =
      null;
  }

  private beginFaceAnalysisGeneration():
  number {
    this.stopFaceAnalysis();

    return this.faceAnalysisGeneration;
  }

  private resetFaceTemporalState(): void {
    this.blinkDetector?.reset();
    this.faceQualityEvaluator?.reset();
    this.preCalibrationMonitor?.reset();
    this.cameraQualityEstimator?.reset();
    this.frameCapture?.reset();

    this.latestPreCalibrationFeedback =
      null;

    this.faceBaseline =
      null;
  }

  private assertFaceAnalysisGeneration(
    generation: number
  ): void {
    this.assertUsable();

    if (
      generation
      === this.faceAnalysisGeneration
    ) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face analysis startup was cancelled by a newer runtime operation."
    );
  }

  private assertCameraRunning(): void {
    const snapshot =
      this.getCameraManagerOrThrow()
        .getSnapshot();

    if (snapshot.running) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "FACE",
      "Face analysis requires an active camera stream."
    );
  }

  private reportFacePipelineError(
    error: TrackerError
  ): void {
    const now =
      nowEpochMs();

    const duplicateWithinWindow =
      this.lastReportedFaceErrorCode
        === error.code
      && this.lastReportedFaceErrorAtMs
        !== null
      && now
        - this.lastReportedFaceErrorAtMs
        < FACE_PIPELINE_RUNTIME
          .ERROR_REPORT_THROTTLE_MS;

    if (duplicateWithinWindow) {
      return;
    }

    this.lastReportedFaceErrorCode =
      error.code;

    this.lastReportedFaceErrorAtMs =
      now;

    this.handleRuntimeError(error);
  }

  private emitFaceQualityFrame(
    result: FaceQualityFrameResult,
    feedback: PreCalibrationFeedback
  ): void {
    if (
      this.onFaceQualityFrame === null
    ) {
      return;
    }

    try {
      this.onFaceQualityFrame(
        result,
        feedback
      );
    } catch (error: unknown) {
      logger.error(
        "Face-quality frame bridge failed.",
        {
          bridgeMessage:
            error instanceof Error
              ? error.message
              : "Unknown face-quality bridge failure"
        }
      );
    }
  }

  /* ========================================================================
   * Runtime state
   * ====================================================================== */

  public isReady(): boolean {
    return (
      this.lifecycle === "READY"
    );
  }

  public isDisposed(): boolean {
    return (
      this.lifecycle === "DISPOSED"
    );
  }

  public getSnapshot():
  TrackerRuntimeSnapshot {
    const cameraSnapshot =
      this.cameraManager
        ?.getSnapshot()
      ?? null;

    return {
      lifecycle:
        this.lifecycle,

      initializedAtEpochMs:
        this.initializedAtEpochMs,

      disposedAtEpochMs:
        this.disposedAtEpochMs,

      hasVideoElement:
        true,

      hasAttachedMediaStream:
        this.videoElement.srcObject !== null,

      cameraRunning:
        cameraSnapshot?.running
        ?? false,

      cameraSettings:
        cameraSnapshot?.settings
        ?? null,

      faceLandmarkerReady:
        this.faceLandmarker
          ?.isReady()
        ?? false,

      faceAnalysisRunning:
        this.faceAnalysisRunning,

      lastFaceAnalysisTimestampMs:
        this.latestFaceQuality
          ?.timestampMs
        ?? null,

      gazePredictorReady:
        this.gazePredictor
          ?.getSnapshot()
          .lifecycle
        === "READY",

      gazePredictionInFlight:
        this.gazePredictionInFlight,

      lastGazePredictionTimestampMs:
        this.latestGazeFrame
          ?.prediction.timestampMs
        ?? null,

      lastGazeSource:
        this.latestGazeFrame
          ?.prediction.source
        ?? null,

      faceBaselineReady:
        this.faceBaseline !== null,

      calibrationActive:
        this.calibrationManager
          ?.getSnapshot().active
        ?? false,

      calibrationModelReady:
        this.calibrationManager
          ?.getSnapshot().modelReady
        ?? false
    };
  }

  /**
   * Provides the dedicated runtime video element to later local-only modules
   * when direct video input is required by a browser ML API.
   */
  public getVideoElement():
  HTMLVideoElement {
    this.assertUsable();

    return this.videoElement;
  }

  /* ========================================================================
   * Disposal
   * ====================================================================== */

  /**
   * Releases the camera, local ML model, and Offscreen runtime shell.
   */
  public dispose(): void {
    if (
      this.lifecycle === "DISPOSED"
      || this.lifecycle === "DISPOSING"
    ) {
      return;
    }

    this.lifecycle =
      "DISPOSING";

    try {
      this.stopFaceAnalysis();

      this.faceLandmarker?.dispose();
      this.disposeGazePredictorBestEffort();
      this.cameraManager?.dispose();
      this.frameCapture?.dispose();
      this.cameraQualityEstimator
        ?.dispose();

      this.cameraManager =
        null;

      this.frameCapture =
        null;

      this.cameraQualityEstimator =
        null;

      this.faceLandmarker =
        null;

      this.faceGeometryAnalyzer =
        null;

      this.headPoseEstimator =
        null;

      this.eyeGeometryAnalyzer =
        null;

      this.blinkDetector =
        null;

      this.faceQualityEvaluator =
        null;

      this.preCalibrationMonitor =
        null;

      this.calibrationManager =
        null;

      this.validationManager =
        null;

      this.deepPersonalMapper =
        null;

      this.deepIndependentValidator =
        null;

      this.calibrationHybridSelector =
        null;

      this.residualCorrector =
        null;

      this.activeCalibrationPointRequest =
        null;

      this.activeValidationPointRequest =
        null;

      this.latestPreCalibrationFeedback =
        null;

      this.faceBaseline =
        null;

      this.gazePredictor =
        null;

      this.latestGazeFrame =
        null;

      this.videoElement.pause();

      this.videoElement.srcObject =
        null;

      this.disposedAtEpochMs =
        nowEpochMs();

      this.lifecycle =
        "DISPOSED";

      logger.info(
        "Offscreen tracker runtime disposed."
      );
    } catch (error: unknown) {
      this.lifecycle =
        "ERROR";

      throw new TrackerError(
        ERROR_CODES.UNKNOWN,
        "OFFSCREEN",
        "Offscreen tracker runtime disposal failed.",
        {
          cause: error
        }
      );
    }
  }

  /* ========================================================================
   * Internal video configuration
   * ====================================================================== */

  private configureVideoElement():
  void {
    this.videoElement.autoplay =
      true;

    this.videoElement.muted =
      true;

    this.videoElement.playsInline =
      true;

    this.videoElement.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  /* ========================================================================
   * Runtime error bridge
   * ====================================================================== */

  private handleRuntimeError(
    error: TrackerError
  ): void {
    if (
      this.onRuntimeError === null
    ) {
      logger.warn(
        "Tracker runtime reported an error without a registered bridge.",
        {
          code:
            error.code
        }
      );

      return;
    }

    try {
      this.onRuntimeError(error);
    } catch (bridgeError: unknown) {
      logger.error(
        "Tracker runtime error bridge failed.",
        {
          code:
            error.code,

          bridgeMessage:
            bridgeError instanceof Error
              ? bridgeError.message
              : "Unknown runtime-error bridge failure"
        }
      );
    }
  }

  /* ========================================================================
   * Internal cleanup / guards
   * ====================================================================== */

  private disposeModulesAfterFailedInitialization():
  void {
    try {
      this.stopFaceAnalysis();
      this.faceLandmarker?.dispose();
      this.disposeGazePredictorBestEffort();
      this.cameraManager?.dispose();
      this.frameCapture?.dispose();
      this.cameraQualityEstimator
        ?.dispose();
    } catch {
      // Initialization error is preserved as the primary failure.
    }

    this.cameraManager =
      null;

    this.frameCapture =
      null;

    this.cameraQualityEstimator =
      null;

    this.faceLandmarker =
      null;

    this.faceGeometryAnalyzer =
      null;

    this.headPoseEstimator =
      null;

    this.eyeGeometryAnalyzer =
      null;

    this.blinkDetector =
      null;

    this.faceQualityEvaluator =
      null;

    this.preCalibrationMonitor =
      null;

    this.calibrationManager =
      null;

    this.validationManager =
      null;

    this.deepPersonalMapper =
      null;

    this.deepIndependentValidator =
      null;

    this.calibrationHybridSelector =
      null;

    this.residualCorrector =
      null;

    this.activeCalibrationPointRequest =
      null;

    this.activeValidationPointRequest =
      null;

    this.latestPreCalibrationFeedback =
      null;

    this.faceBaseline =
      null;

    this.gazePredictor =
      null;

    this.latestGazeFrame =
      null;

    this.videoElement.srcObject =
      null;
  }

  private disposeGazePredictorBestEffort(): void {
    const predictor = this.gazePredictor;

    if (predictor === null) {
      return;
    }

    void predictor.dispose().catch(
      (error: unknown) => {
        logger.warn(
          "Gaze predictor disposal failed.",
          {
            error:
              error instanceof Error
                ? error.message
                : "Unknown gaze disposal error"
          }
        );
      }
    );
  }

  private getDeepIndependentValidatorOrThrow():
  DeepIndependentValidator {
    if (this.deepIndependentValidator !== null) {
      return this.deepIndependentValidator;
    }

    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "Deep independent validator is unavailable."
    );
  }

  private getDeepPersonalMapperOrThrow():
  DeepPersonalMapper {
    if (this.deepPersonalMapper !== null) {
      return this.deepPersonalMapper;
    }

    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Deep personal mapper is unavailable."
    );
  }

  private getCalibrationHybridSelectorOrThrow():
  CalibrationHybridSelector {
    if (this.calibrationHybridSelector !== null) {
      return this.calibrationHybridSelector;
    }

    throw new TrackerError(
      ERROR_CODES.CALIBRATION_MODEL_FAILED,
      "CALIBRATION",
      "Calibration-only hybrid selector is unavailable."
    );
  }

  private getGazePredictorOrThrow():
  GazePredictor {
    if (this.gazePredictor !== null) {
      return this.gazePredictor;
    }

    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "GazePredictor is unavailable in the Offscreen runtime.",
      {
        recoverable: false
      }
    );
  }

  private getCameraManagerOrThrow():
  CameraManager {
    if (
      this.cameraManager !== null
    ) {
      return this.cameraManager;
    }

    throw new TrackerError(
      ERROR_CODES.CAMERA_START_FAILED,
      "CAMERA",
      "CameraManager is unavailable in the Offscreen runtime."
    );
  }

  private getFaceLandmarkerOrThrow():
  FaceLandmarker {
    if (
      this.faceLandmarker !== null
    ) {
      return this.faceLandmarker;
    }

    throw new TrackerError(
      ERROR_CODES.MEDIAPIPE_INIT_FAILED,
      "FACE",
      "FaceLandmarker is unavailable in the Offscreen runtime.",
      {
        recoverable: false
      }
    );
  }

  private getFaceGeometryAnalyzerOrThrow():
  FaceGeometryAnalyzer {
    if (
      this.faceGeometryAnalyzer
      !== null
    ) {
      return this.faceGeometryAnalyzer;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "FaceGeometryAnalyzer is unavailable in the Offscreen runtime."
    );
  }

  private getHeadPoseEstimatorOrThrow():
  HeadPoseEstimator {
    if (
      this.headPoseEstimator !== null
    ) {
      return this.headPoseEstimator;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "HeadPoseEstimator is unavailable in the Offscreen runtime."
    );
  }

  private getEyeGeometryAnalyzerOrThrow():
  EyeGeometryAnalyzer {
    if (
      this.eyeGeometryAnalyzer !== null
    ) {
      return this.eyeGeometryAnalyzer;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "EyeGeometryAnalyzer is unavailable in the Offscreen runtime."
    );
  }

  private getBlinkDetectorOrThrow():
  BlinkDetector {
    if (
      this.blinkDetector !== null
    ) {
      return this.blinkDetector;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "BlinkDetector is unavailable in the Offscreen runtime."
    );
  }

  private getFaceQualityEvaluatorOrThrow():
  FaceQualityEvaluator {
    if (
      this.faceQualityEvaluator !== null
    ) {
      return this.faceQualityEvaluator;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "FACE",
      "FaceQualityEvaluator is unavailable in the Offscreen runtime."
    );
  }

  private getPreCalibrationMonitorOrThrow():
  PreCalibrationMonitor {
    if (
      this.preCalibrationMonitor !== null
    ) {
      return this.preCalibrationMonitor;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "CALIBRATION",
      "PreCalibrationMonitor is unavailable in the Offscreen runtime."
    );
  }

  private getCalibrationManagerOrThrow():
  CalibrationManager {
    if (this.calibrationManager !== null) {
      return this.calibrationManager;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "CALIBRATION",
      "CalibrationManager is unavailable in the Offscreen runtime."
    );
  }

  private getValidationManagerOrThrow():
  ValidationManager {
    if (this.validationManager !== null) {
      return this.validationManager;
    }

    throw new TrackerError(
      ERROR_CODES.CALIBRATION_VALIDATION_FAILED,
      "CALIBRATION",
      "ValidationManager is unavailable in the Offscreen runtime."
    );
  }

  private getResidualCorrectorOrThrow():
  ResidualCorrector {
    if (this.residualCorrector !== null) {
      return this.residualCorrector;
    }

    throw new TrackerError(
      ERROR_CODES.UNKNOWN,
      "CALIBRATION",
      "ResidualCorrector is unavailable in the Offscreen runtime."
    );
  }

  private assertUsable(): void {
    if (
      this.lifecycle === "READY"
    ) {
      return;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "OFFSCREEN",
      "Tracker runtime is not ready.",
      {
        details: {
          lifecycle:
            this.lifecycle
        }
      }
    );
  }
}
