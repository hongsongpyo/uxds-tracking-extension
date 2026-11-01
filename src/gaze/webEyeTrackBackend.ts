import {
  CALIBRATION,
  NORMALIZED_COORDINATE,
  WEB_EYE_TRACK_RUNTIME
} from "../shared/constants";

import {
  ERROR_CODES,
  TrackerError,
  getUnknownErrorMessage
} from "../shared/errors";

import {
  createLogger
} from "../shared/logger";

import type {
  WebEyeTrack as VendorWebEyeTrack
} from "../vendor/webeyetrack/runtime.cjs";

import type {
  FaceLandmarkerFrameResult
} from "../face/faceLandmarker";

import type {
  Point2D
} from "../shared/types";

import type {
  GazeEngineFrameInput
} from "./GazeEngine";

import type {
  WebEyeTrackBackend,
  WebEyeTrackBackendPrediction
} from "./webEyeTrackEngine";

/* ========================================================================== 
 * Logger
 * ======================================================================== */

const logger =
  createLogger("GAZE");

/* ========================================================================== 
 * Local vendor bridge types
 * ======================================================================== */

interface VendorLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
}

interface VendorMatrix {
  readonly rows: number;
  readonly columns: number;
  readonly data: readonly number[];
}

interface VendorFaceLandmarkerResult {
  readonly faceLandmarks:
    readonly (readonly VendorLandmark[])[];

  readonly facialTransformationMatrixes:
    readonly VendorMatrix[];

  readonly faceBlendshapes:
    readonly unknown[];
}

interface VendorFaceLandmarkerClient {
  processFrame(
    frame: ImageData
  ): Promise<VendorFaceLandmarkerResult | null>;
}

interface VendorTensor {
  clone(): VendorTensor;
  dispose(): void;
}

interface VendorDisposableModel {
  dispose(): void;
  getWeights?(): VendorTensor[];
  setWeights?(weights: readonly VendorTensor[]): void;
}

interface VendorCalibrationSupportX {
  eyePatches: VendorTensor;
  headVectors: VendorTensor;
  faceOrigins3D: VendorTensor;
}

interface VendorCalibrationData {
  supportX: VendorCalibrationSupportX[];
  supportY: VendorTensor[];
  timestamps: number[];
  ptType: ("calib" | "click")[];
}

interface VendorGazeResult {
  readonly gazeState: "open" | "closed";
  readonly normPog: readonly number[];
  readonly timestamp: number;
  readonly eyePatch: ImageData;
  readonly headVector: readonly number[];
  readonly faceOrigin3D: readonly number[];
}

interface VendorPersonalizationCandidate {
  readonly timestampMs: number;
  readonly eyePatch: ImageData;
  readonly headVector: readonly number[];
  readonly faceOrigin3D: readonly number[];
}

interface VendorStagedPersonalizationPoint
extends VendorPersonalizationCandidate {
  readonly pointIndex: number;
  readonly targetCentered: Point2D;
}

interface VendorBlazeGaze {
  loadModel(
    baseUrl?: string
  ): Promise<void>;

  model?:
    VendorDisposableModel | null;
}

interface VendorKalmanFilter {
  step(
    measurement: number[]
  ): number[];
}

type VendorWebEyeTrackConstructor =
  new (
    maxPoints?: number,
    clickTTL?: number
  ) => VendorWebEyeTrack;

type WebEyeTrackInitializationStage =
  | "VERIFY_MODEL_MANIFEST"
  | "IMPORT_VENDOR_RUNTIME"
  | "RESOLVE_VENDOR_EXPORT"
  | "CONSTRUCT_VENDOR_RUNTIME"
  | "VERIFY_RUNTIME_SHAPE"
  | "INSTALL_FACE_BRIDGE"
  | "INSTALL_RAW_OUTPUT_BRIDGE"
  | "LOAD_BLAZEGAZE_MODEL"
  | "READY";

interface ResolvedVendorModule {
  readonly WebEyeTrack:
    VendorWebEyeTrackConstructor;

  readonly vendorStub:
    boolean;

  readonly exportShape:
    "NAMED" | "DEFAULT_OBJECT" | "DEFAULT_CONSTRUCTOR";
}

/**
 * Runtime-private fields from the pinned WebEyeTrack 0.0.2 build.
 *
 * These fields are intentionally isolated to this bridge. Initialization
 * performs structural assertions so a future upstream change fails loudly
 * instead of silently producing incorrect gaze data.
 */
interface PinnedWebEyeTrackInternals {
  faceLandmarkerClient:
    VendorFaceLandmarkerClient;

  blazeGaze:
    VendorBlazeGaze;

  kalmanFilter:
    VendorKalmanFilter;

  affineMatrix:
    VendorTensor | null;

  calibData?: VendorCalibrationData;

  adapt?(
    eyePatches: ImageData[],
    headVectors: number[][],
    faceOrigins3D: number[][],
    normPogs: number[][],
    stepsInner?: number,
    innerLR?: number,
    ptType?: "calib" | "click"
  ): Promise<void>;

  loaded: boolean;
}

export interface LocalWebEyeTrackBackendOptions {
  /**
   * URL for the directory containing the upstream `web/` model directory.
   * Production defaults to the extension-local `models/webeyetrack` folder.
   */
  readonly modelBaseUrl?: string;

  /**
   * Keep enabled in production to fail early when local model assets are
   * missing from the packaged extension.
   */
  readonly verifyModelAsset?: boolean;
}

/* ========================================================================== 
 * Generic helpers
 * ======================================================================== */

function clamp01(
  value: number
): number {
  return Math.min(
    NORMALIZED_COORDINATE.MAX,
    Math.max(
      NORMALIZED_COORDINATE.MIN,
      value
    )
  );
}

function readFinitePoint(
  values: readonly number[]
): Point2D | null {
  const x = values[0];
  const y = values[1];

  if (
    typeof x !== "number"
    || typeof y !== "number"
    || !Number.isFinite(x)
    || !Number.isFinite(y)
  ) {
    return null;
  }

  return {
    x,
    y
  };
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
  );
}

function resolveVendorModule(
  moduleValue: unknown
): ResolvedVendorModule {
  if (!isObject(moduleValue)) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "WebEyeTrack vendor module did not evaluate to an object."
    );
  }

  const namedConstructor =
    moduleValue["WebEyeTrack"];

  if (typeof namedConstructor === "function") {
    return {
      WebEyeTrack:
        namedConstructor as VendorWebEyeTrackConstructor,
      vendorStub:
        moduleValue["__WEBEYETRACK_VENDOR_STUB__"] === true,
      exportShape:
        "NAMED"
    };
  }

  const defaultExport =
    moduleValue["default"];

  if (isObject(defaultExport)) {
    const defaultConstructor =
      defaultExport["WebEyeTrack"];

    if (typeof defaultConstructor === "function") {
      return {
        WebEyeTrack:
          defaultConstructor as VendorWebEyeTrackConstructor,
        vendorStub:
          defaultExport["__WEBEYETRACK_VENDOR_STUB__"] === true
          || moduleValue["__WEBEYETRACK_VENDOR_STUB__"] === true,
        exportShape:
          "DEFAULT_OBJECT"
      };
    }
  }

  if (typeof defaultExport === "function") {
    return {
      WebEyeTrack:
        defaultExport as VendorWebEyeTrackConstructor,
      vendorStub:
        moduleValue["__WEBEYETRACK_VENDOR_STUB__"] === true,
      exportShape:
        "DEFAULT_CONSTRUCTOR"
    };
  }

  throw new TrackerError(
    ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
    "GAZE",
    "Unable to resolve the WebEyeTrack constructor from the local vendor runtime.",
    {
      details: {
        moduleKeys:
          Object.keys(moduleValue),
        defaultExportType:
          typeof defaultExport,
        defaultExportKeys:
          isObject(defaultExport)
            ? Object.keys(defaultExport)
            : []
      }
    }
  );
}

function assertPinnedRuntimeShape(
  runtime: VendorWebEyeTrack
): asserts runtime is VendorWebEyeTrack & PinnedWebEyeTrackInternals {
  const candidate =
    runtime as unknown as Record<string, unknown>;

  const faceLandmarkerClient =
    candidate["faceLandmarkerClient"];

  const blazeGaze =
    candidate["blazeGaze"];

  const kalmanFilter =
    candidate["kalmanFilter"];

  if (
    !isObject(faceLandmarkerClient)
    || typeof faceLandmarkerClient["processFrame"]
      !== "function"
    || !isObject(blazeGaze)
    || typeof blazeGaze["loadModel"]
      !== "function"
    || !isObject(kalmanFilter)
    || typeof kalmanFilter["step"]
      !== "function"
    || !("affineMatrix" in candidate)
  ) {
    throw new TrackerError(
      ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
      "GAZE",
      "Pinned WebEyeTrack runtime structure does not match the local backend bridge.",
      {
        details: {
          expectedPackageVersion:
            WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION,
          expectedUpstreamCommit:
            WEB_EYE_TRACK_RUNTIME.UPSTREAM_COMMIT
        }
      }
    );
  }
}

function toVendorFaceResult(
  result: FaceLandmarkerFrameResult
): VendorFaceLandmarkerResult | null {
  const transformationMatrix =
    result.transformationMatrix;

  if (
    !result.faceDetected
    || result.landmarks.length === 0
    || transformationMatrix === null
  ) {
    return null;
  }

  return {
    faceLandmarks: [
      result.landmarks
    ],

    facialTransformationMatrixes: [
      {
        rows:
          transformationMatrix.rows,
        columns:
          transformationMatrix.columns,
        data:
          transformationMatrix.data
      }
    ],

    faceBlendshapes: []
  };
}

/* ========================================================================== 
 * Local WebEyeTrack backend
 * ======================================================================== */

/**
 * Concrete local-only adapter around the pinned WebEyeTrack/BlazeGaze runtime.
 *
 * Integration strategy:
 * 1. Reuse the project's already-computed Face Landmarker result instead of
 *    allowing upstream WebEyeTrack to initialize a second MediaPipe runtime.
 * 2. Load only the extension-local BlazeGaze TF.js model assets.
 * 3. Replace WebEyeTrack's Kalman step with an identity bridge that captures
 *    the pre-filter BlazeGaze output. This preserves research-grade raw gaze;
 *    project-owned filtering happens later in `gazeFilter.ts`.
 * 4. Keep native adaptation disabled during ordinary prediction. During the
 *    explicit calibration phase only, selected stable samples can be staged
 *    and applied through WebEyeTrack's pinned few-shot `adapt()` routine.
 * 5. Preserve project raw/corrected boundaries: after native personalization,
 *    the project residual model is replaced with identity to avoid double
 *    correction.
 *
 * Full webcam frames are never retained. A small eye patch may be held only
 * transiently during an active calibration session and is released after
 * personalization is applied or reset.
 */
export class LocalWebEyeTrackBackend
implements WebEyeTrackBackend {
  private runtime:
    VendorWebEyeTrack | null =
      null;

  private currentFaceResult:
    VendorFaceLandmarkerResult | null =
      null;

  private capturedRawCenteredPoint:
    Point2D | null =
      null;

  private originalModelWeights:
    VendorTensor[] = [];

  private personalizationCaptureActive =
    false;

  private personalizationResetPending =
    false;

  private personalizationAdaptationInFlight =
    false;

  private latestPersonalizationCandidate:
    VendorPersonalizationCandidate | null =
      null;

  private personalizationCandidates =
    new Map<number, VendorPersonalizationCandidate[]>();

  private stagedPersonalizationPoints:
    VendorStagedPersonalizationPoint[] = [];

  private canvas:
    HTMLCanvasElement | null =
      null;

  private context:
    CanvasRenderingContext2D | null =
      null;

  private initialized = false;

  private disposed = false;

  private predictionInFlight = false;

  public constructor(
    private readonly options:
      LocalWebEyeTrackBackendOptions = {}
  ) {}

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.disposed) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "Disposed WebEyeTrack backend cannot be initialized."
      );
    }

    const modelBaseUrl =
      this.resolveModelBaseUrl();

    let stage:
      WebEyeTrackInitializationStage =
        "VERIFY_MODEL_MANIFEST";

    try {
      logger.info(
        "WebEyeTrack initialization started.",
        {
          packageVersion:
            WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION,
          stage
        }
      );

      if (this.options.verifyModelAsset !== false) {
        await this.verifyLocalModelManifest(
          modelBaseUrl
        );
      }

      logger.info(
        "WebEyeTrack local model manifest verified.",
        { stage }
      );

      stage =
        "IMPORT_VENDOR_RUNTIME";

      const importedVendorModule:
        unknown =
          await import(
            "../vendor/webeyetrack/runtime.cjs"
          );

      stage =
        "RESOLVE_VENDOR_EXPORT";

      const vendorModule =
        resolveVendorModule(
          importedVendorModule
        );

      logger.info(
        "WebEyeTrack vendor runtime imported.",
        {
          stage,
          exportShape:
            vendorModule.exportShape
        }
      );

      if (vendorModule.vendorStub) {
        throw new TrackerError(
          ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
          "GAZE",
          "WebEyeTrack local vendor runtime has not been provisioned.",
          {
            details: {
              command:
                "npm run vendor:webeyetrack",
              packageVersion:
                WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION
            }
          }
        );
      }

      stage =
        "CONSTRUCT_VENDOR_RUNTIME";

      const runtime =
        new vendorModule.WebEyeTrack();

      stage =
        "VERIFY_RUNTIME_SHAPE";

      assertPinnedRuntimeShape(runtime);

      logger.info(
        "WebEyeTrack runtime structure verified.",
        { stage }
      );

      stage =
        "INSTALL_FACE_BRIDGE";

      this.installFaceLandmarkerBridge(
        runtime
      );

      stage =
        "INSTALL_RAW_OUTPUT_BRIDGE";

      this.installRawOutputBridge(
        runtime
      );

      // Upstream affine adaptation must remain disabled. Project calibration
      // is applied by the independent residual-correction pipeline.
      runtime.affineMatrix = null;

      stage =
        "LOAD_BLAZEGAZE_MODEL";

      logger.info(
        "Loading extension-local BlazeGaze model.",
        { stage }
      );

      await runtime.blazeGaze.loadModel(
        modelBaseUrl
      );

      this.captureOriginalModelWeights(
        runtime
      );

      runtime.loaded = true;

      this.runtime =
        runtime;

      this.initialized = true;

      stage =
        "READY";

      logger.info(
        "Local WebEyeTrack backend initialized.",
        {
          packageVersion:
            WEB_EYE_TRACK_RUNTIME.PACKAGE_VERSION,
          modelSource:
            "extension-local",
          stage
        }
      );
    } catch (error: unknown) {
      const originalMessage =
        getUnknownErrorMessage(error);

      logger.error(
        "Local WebEyeTrack backend initialization failed.",
        {
          stage,
          originalMessage,
          trackerError:
            error instanceof TrackerError
              ? error.toSerializable()
              : null
        }
      );

      if (error instanceof TrackerError) {
        throw new TrackerError(
          error.code,
          error.component,
          error.message,
          {
            recoverable:
              error.recoverable,
            cause:
              error,
            details: {
              ...(error.details ?? {}),
              initializationStage:
                stage,
              originalMessage
            }
          }
        );
      }

      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "WebEyeTrack backend initialization failed.",
        {
          cause:
            error,
          details: {
            initializationStage:
              stage,
            originalMessage
          }
        }
      );
    }
  }

  public async predict(
    input: GazeEngineFrameInput
  ): Promise<WebEyeTrackBackendPrediction | null> {
    const runtime =
      this.assertReady();

    if (this.personalizationAdaptationInFlight) {
      return null;
    }

    if (this.personalizationResetPending) {
      this.activatePendingPersonalizationSession(
        runtime
      );
    }

    if (this.predictionInFlight) {
      throw new TrackerError(
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "Concurrent WebEyeTrack prediction is not allowed."
      );
    }

    const faceResult =
      toVendorFaceResult(
        input.landmarker
      );

    if (faceResult === null) {
      return null;
    }

    this.predictionInFlight = true;
    this.currentFaceResult = faceResult;
    this.capturedRawCenteredPoint = null;

    try {
      const frame =
        this.captureFrame(input);

      const gazeResult =
        await runtime.step(
          frame,
          input.frame.metadata.timestampMs
        );

      if (this.personalizationCaptureActive) {
        this.latestPersonalizationCandidate =
          this.readPersonalizationCandidate(
            runtime,
            input.frame.metadata.timestampMs
          );
      } else {
        this.latestPersonalizationCandidate = null;
      }

      // The vendor object itself is never retained. Calibration stores only
      // an explicitly accepted eye patch/head-pose candidate when requested
      // by the project collector.
      runtime.latestGazeResult = null;

      if (gazeResult.gazeState !== "open") {
        return null;
      }

      const rawCenteredPoint =
        this.getCapturedRawCenteredPoint();

      if (rawCenteredPoint === null) {
        throw new TrackerError(
          ERROR_CODES.GAZE_INVALID_SAMPLE,
          "GAZE",
          "WebEyeTrack did not expose a finite pre-filter BlazeGaze prediction."
        );
      }

      return {
        rawPoint: {
          // Upstream BlazeGaze uses screen-centered normalized coordinates
          // where (0, 0) is the center. The project NORMALIZED convention is
          // 0..1 with 0.5 at the center. Do not clamp raw model output.
          x:
            rawCenteredPoint.x
            + NORMALIZED_COORDINATE.CENTER,
          y:
            rawCenteredPoint.y
            + NORMALIZED_COORDINATE.CENTER
        },

        rawSpace:
          "NORMALIZED",

        // WebEyeTrack 0.0.2 does not expose a native prediction confidence.
        // Use the already-computed face/eye tracking quality as a transparent
        // input-quality proxy; gazeQuality.ts can refine it downstream.
        confidence:
          clamp01(
            input.faceQuality
              .trackingQuality
              .qualityScore
          )
      };
    } finally {
      this.currentFaceResult = null;
      this.capturedRawCenteredPoint = null;
      this.predictionInFlight = false;

      this.clearCanvas();

      // Clear even when upstream throws after assigning latestGazeResult.
      runtime.latestGazeResult = null;
    }
  }

  public beginPersonalizationSession(): void {
    const runtime =
      this.assertReadyWithInternals();

    this.clearPersonalizationBuffers();
    this.personalizationCaptureActive = false;
    this.personalizationResetPending = false;

    if (
      !CALIBRATION.WEBEYETRACK_PERSONALIZATION_ENABLED
      || typeof runtime.adapt !== "function"
      || this.originalModelWeights.length === 0
    ) {
      logger.warn(
        "WebEyeTrack native personalization is unavailable; project residual calibration will be used.",
        {
          adaptationAvailable:
            typeof runtime.adapt === "function",
          genericWeightSnapshotAvailable:
            this.originalModelWeights.length > 0
        }
      );
      return;
    }

    if (this.predictionInFlight) {
      // Never mutate model weights while a prediction is executing. The next
      // prediction activates the reset before inference; settling samples are
      // discarded anyway, so this does not contaminate calibration support.
      this.personalizationResetPending = true;
      return;
    }

    this.activatePersonalizationSession(runtime);
  }

  public recordLatestPersonalizationCandidate(
    pointIndex: number,
    expectedTimestampMs: number
  ): boolean {
    if (!this.personalizationCaptureActive) {
      return false;
    }

    const candidate =
      this.latestPersonalizationCandidate;

    if (
      candidate === null
      || !Number.isInteger(pointIndex)
      || pointIndex < 0
      || !Number.isFinite(expectedTimestampMs)
      || Math.abs(
        candidate.timestampMs
        - expectedTimestampMs
      )
        > CALIBRATION
          .WEBEYETRACK_PERSONALIZATION_TIMESTAMP_TOLERANCE_MS
    ) {
      return false;
    }

    const candidates =
      this.personalizationCandidates
        .get(pointIndex)
      ?? [];

    candidates.push({
      timestampMs:
        candidate.timestampMs,
      eyePatch:
        this.cloneImageData(
          candidate.eyePatch
        ),
      headVector:
        [...candidate.headVector],
      faceOrigin3D:
        [...candidate.faceOrigin3D]
    });

    const maximum =
      CALIBRATION
        .WEBEYETRACK_PERSONALIZATION_MAX_CANDIDATES_PER_POINT;

    if (candidates.length > maximum) {
      candidates.splice(
        0,
        candidates.length - maximum
      );
    }

    this.personalizationCandidates
      .set(pointIndex, candidates);

    return true;
  }

  public stagePersonalizationPoint(
    pointIndex: number,
    targetNormalizedPoint: Point2D,
    stableWindowStartTimestampMs: number,
    stableWindowEndTimestampMs: number
  ): boolean {
    if (
      !this.personalizationCaptureActive
      || !Number.isInteger(pointIndex)
      || pointIndex < 0
      || !Number.isFinite(targetNormalizedPoint.x)
      || !Number.isFinite(targetNormalizedPoint.y)
      || targetNormalizedPoint.x < 0
      || targetNormalizedPoint.x > 1
      || targetNormalizedPoint.y < 0
      || targetNormalizedPoint.y > 1
      || !Number.isFinite(stableWindowStartTimestampMs)
      || !Number.isFinite(stableWindowEndTimestampMs)
      || stableWindowEndTimestampMs
        < stableWindowStartTimestampMs
    ) {
      return false;
    }

    const candidates =
      this.personalizationCandidates
        .get(pointIndex)
      ?? [];

    const inWindow = candidates.filter(
      (candidate) => (
        candidate.timestampMs
          >= stableWindowStartTimestampMs
        && candidate.timestampMs
          <= stableWindowEndTimestampMs
      )
    );

    if (inWindow.length === 0) {
      return false;
    }

    const windowMidpoint =
      (
        stableWindowStartTimestampMs
        + stableWindowEndTimestampMs
      ) / 2;

    let selected = inWindow[0];

    if (selected === undefined) {
      return false;
    }

    for (const candidate of inWindow.slice(1)) {
      if (
        Math.abs(
          candidate.timestampMs
          - windowMidpoint
        )
        < Math.abs(
          selected.timestampMs
          - windowMidpoint
        )
      ) {
        selected = candidate;
      }
    }

    this.stagedPersonalizationPoints =
      this.stagedPersonalizationPoints
        .filter(
          (point) => point.pointIndex !== pointIndex
        );

    this.stagedPersonalizationPoints.push({
      pointIndex,
      timestampMs:
        selected.timestampMs,
      eyePatch:
        selected.eyePatch,
      headVector:
        [...selected.headVector],
      faceOrigin3D:
        [...selected.faceOrigin3D],
      targetCentered: {
        x:
          targetNormalizedPoint.x
          - NORMALIZED_COORDINATE.CENTER,
        y:
          targetNormalizedPoint.y
          - NORMALIZED_COORDINATE.CENTER
      }
    });

    this.stagedPersonalizationPoints.sort(
      (left, right) =>
        left.pointIndex - right.pointIndex
    );

    this.personalizationCandidates
      .delete(pointIndex);

    return true;
  }

  public async applyPersonalization():
  Promise<{
    readonly applied: boolean;
    readonly stagedPointCount: number;
    readonly supportPointCount: number;
  }> {
    const runtime =
      this.assertReadyWithInternals();

    const staged =
      [...this.stagedPersonalizationPoints];

    const support = staged.slice(
      0,
      CALIBRATION
        .WEBEYETRACK_PERSONALIZATION_MAX_SUPPORT_POINTS
    );

    if (this.predictionInFlight) {
      throw new TrackerError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        "GAZE",
        "WebEyeTrack personalization cannot run concurrently with prediction.",
        { recoverable: true }
      );
    }

    if (
      !CALIBRATION.WEBEYETRACK_PERSONALIZATION_ENABLED
      || typeof runtime.adapt !== "function"
      || support.length
        < CALIBRATION
          .WEBEYETRACK_PERSONALIZATION_MIN_POINT_COUNT
    ) {
      return {
        applied: false,
        stagedPointCount:
          staged.length,
        supportPointCount:
          support.length
      };
    }

    this.personalizationAdaptationInFlight = true;

    try {
      await runtime.adapt(
        support.map(
          (point) => point.eyePatch
        ),
        support.map(
          (point) => [...point.headVector]
        ),
        support.map(
          (point) => [...point.faceOrigin3D]
        ),
        support.map(
          (point) => [
            point.targetCentered.x,
            point.targetCentered.y
          ]
        ),
        CALIBRATION.WEBEYETRACK_PERSONALIZATION_STEPS,
        CALIBRATION.WEBEYETRACK_PERSONALIZATION_INNER_LR,
        "calib"
      );
    } finally {
      this.personalizationAdaptationInFlight = false;
    }

    this.personalizationCaptureActive = false;
    this.latestPersonalizationCandidate = null;
    this.personalizationCandidates.clear();
    this.stagedPersonalizationPoints = [];

    logger.info(
      "WebEyeTrack native personalization applied.",
      {
        stagedPointCount:
          staged.length,
        appliedSupportPointCount:
          support.length,
        stepsInner:
          CALIBRATION.WEBEYETRACK_PERSONALIZATION_STEPS,
        innerLearningRate:
          CALIBRATION.WEBEYETRACK_PERSONALIZATION_INNER_LR
      }
    );

    return {
      applied: true,
      stagedPointCount:
        staged.length,
      supportPointCount:
        support.length
    };
  }

  public dispose(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.disposed = true;
    this.initialized = false;
    this.predictionInFlight = false;

    this.currentFaceResult = null;
    this.capturedRawCenteredPoint = null;
    this.latestPersonalizationCandidate = null;
    this.personalizationCaptureActive = false;
    this.personalizationResetPending = false;
    this.personalizationAdaptationInFlight = false;
    this.clearPersonalizationBuffers();

    for (const weight of this.originalModelWeights) {
      weight.dispose();
    }
    this.originalModelWeights = [];

    const runtime =
      this.runtime;

    this.runtime = null;

    if (runtime !== null) {
      const internals =
        runtime as unknown as Partial<PinnedWebEyeTrackInternals>;

      try {
        internals.blazeGaze
          ?.model
          ?.dispose();
      } catch (error: unknown) {
        logger.warn(
          "Failed to dispose WebEyeTrack model resources.",
          {
            error
          }
        );
      }

      runtime.latestGazeResult = null;
    }

    this.clearCanvas();
    this.context = null;
    this.canvas = null;

    return Promise.resolve();
  }

  private activatePendingPersonalizationSession(
    runtime: VendorWebEyeTrack
  ): void {
    const internals =
      runtime as VendorWebEyeTrack
        & PinnedWebEyeTrackInternals;

    this.activatePersonalizationSession(
      internals
    );
  }

  private activatePersonalizationSession(
    runtime: VendorWebEyeTrack & PinnedWebEyeTrackInternals
  ): void {
    this.restoreOriginalModelWeights(runtime);
    this.clearVendorCalibrationState(runtime);
    this.clearPersonalizationBuffers();

    this.personalizationResetPending = false;
    this.personalizationCaptureActive = true;

    logger.info(
      "WebEyeTrack personalization session started.",
      {
        nativeAdaptationAvailable:
          typeof runtime.adapt === "function"
      }
    );
  }

  private captureOriginalModelWeights(
    runtime: VendorWebEyeTrack & PinnedWebEyeTrackInternals
  ): void {
    const model =
      runtime.blazeGaze.model;

    if (
      model === null
      || model === undefined
      || typeof model.getWeights !== "function"
      || typeof model.setWeights !== "function"
    ) {
      logger.warn(
        "WebEyeTrack model does not expose weight snapshot APIs; native personalization reset will be unavailable."
      );
      return;
    }

    for (const weight of this.originalModelWeights) {
      weight.dispose();
    }

    this.originalModelWeights =
      model.getWeights().map(
        (weight) => weight.clone()
      );
  }

  private restoreOriginalModelWeights(
    runtime: VendorWebEyeTrack & PinnedWebEyeTrackInternals
  ): void {
    if (this.originalModelWeights.length === 0) {
      return;
    }

    const model =
      runtime.blazeGaze.model;

    if (
      model === null
      || model === undefined
      || typeof model.setWeights !== "function"
    ) {
      return;
    }

    model.setWeights(
      this.originalModelWeights
    );
  }

  private clearVendorCalibrationState(
    runtime: VendorWebEyeTrack & PinnedWebEyeTrackInternals
  ): void {
    runtime.affineMatrix?.dispose();
    runtime.affineMatrix = null;

    const data =
      runtime.calibData;

    if (data === undefined) {
      return;
    }

    for (const support of data.supportX) {
      support.eyePatches.dispose();
      support.headVectors.dispose();
      support.faceOrigins3D.dispose();
    }

    for (const supportY of data.supportY) {
      supportY.dispose();
    }

    data.supportX = [];
    data.supportY = [];
    data.timestamps = [];
    data.ptType = [];
  }

  private clearPersonalizationBuffers(): void {
    this.latestPersonalizationCandidate = null;
    this.personalizationCandidates.clear();
    this.stagedPersonalizationPoints = [];
  }

  private readPersonalizationCandidate(
    runtime: VendorWebEyeTrack,
    expectedTimestampMs: number
  ): VendorPersonalizationCandidate | null {
    const gazeResult = runtime.latestGazeResult as
      VendorGazeResult | null;

    const eyePatch =
      gazeResult?.eyePatch;
    const headVector =
      gazeResult?.headVector;
    const faceOrigin3D =
      gazeResult?.faceOrigin3D;

    if (
      gazeResult === null
      || gazeResult.gazeState !== "open"
      || eyePatch === undefined
      || headVector === undefined
      || faceOrigin3D === undefined
      || headVector.length < 3
      || faceOrigin3D.length < 3
      || headVector.some(
        (value) => !Number.isFinite(value)
      )
      || faceOrigin3D.some(
        (value) => !Number.isFinite(value)
      )
    ) {
      return null;
    }

    return {
      timestampMs:
        expectedTimestampMs,
      eyePatch,
      headVector:
        [...headVector],
      faceOrigin3D:
        [...faceOrigin3D]
    };
  }

  private cloneImageData(
    source: ImageData
  ): ImageData {
    return new ImageData(
      new Uint8ClampedArray(source.data),
      source.width,
      source.height
    );
  }

  private assertReadyWithInternals():
  VendorWebEyeTrack & PinnedWebEyeTrackInternals {
    const runtime =
      this.assertReady();

    assertPinnedRuntimeShape(runtime);
    return runtime;
  }

  private resolveModelBaseUrl(): string {
    const override =
      this.options.modelBaseUrl;

    if (
      typeof override === "string"
      && override.length > 0
    ) {
      return override.replace(
        /\/$/u,
        ""
      );
    }

    return chrome.runtime.getURL(
      WEB_EYE_TRACK_RUNTIME.MODEL_BASE_ASSET_PATH
    ).replace(
      /\/$/u,
      ""
    );
  }

  private async verifyLocalModelManifest(
    modelBaseUrl: string
  ): Promise<void> {
    const manifestUrl =
      `${modelBaseUrl}/web/model.json`;

    let response: Response;

    try {
      response = await fetch(
        manifestUrl,
        {
          cache: "no-store"
        }
      );
    } catch (error: unknown) {
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Unable to read the extension-local WebEyeTrack model manifest.",
        {
          cause: error,
          details: {
            modelAssetPath:
              WEB_EYE_TRACK_RUNTIME.MODEL_JSON_ASSET_PATH
          }
        }
      );
    }

    if (!response.ok) {
      throw new TrackerError(
        ERROR_CODES.GAZE_ENGINE_INIT_FAILED,
        "GAZE",
        "Extension-local WebEyeTrack model manifest is missing.",
        {
          details: {
            status:
              response.status,
            modelAssetPath:
              WEB_EYE_TRACK_RUNTIME.MODEL_JSON_ASSET_PATH,
            provisioningCommand:
              "npm run vendor:webeyetrack"
          }
        }
      );
    }
  }

  private getCapturedRawCenteredPoint():
  Point2D | null {
    return this.capturedRawCenteredPoint;
  }

  private installFaceLandmarkerBridge(
    runtime:
      VendorWebEyeTrack & PinnedWebEyeTrackInternals
  ): void {
    runtime.faceLandmarkerClient = {
      processFrame: (
        _frame: ImageData
      ): Promise<VendorFaceLandmarkerResult | null> =>
        Promise.resolve(
          this.currentFaceResult
        )
    };
  }

  private installRawOutputBridge(
    runtime:
      VendorWebEyeTrack & PinnedWebEyeTrackInternals
  ): void {
    runtime.kalmanFilter = {
      step: (
        measurement: number[]
      ): number[] => {
        const point =
          readFinitePoint(measurement);

        if (point === null) {
          this.capturedRawCenteredPoint = null;
          return measurement;
        }

        // Capture the model output before WebEyeTrack applies its Kalman
        // smoothing and clipping. Identity return keeps upstream step() alive
        // without introducing a second smoothing stage.
        this.capturedRawCenteredPoint = point;

        return [
          point.x,
          point.y
        ];
      }
    };
  }

  private captureFrame(
    input: GazeEngineFrameInput
  ): ImageData {
    const width =
      input.frame.metadata.width;

    const height =
      input.frame.metadata.height;

    const context =
      this.ensureCanvas(
        width,
        height
      );

    context.drawImage(
      input.frame.source,
      0,
      0,
      width,
      height
    );

    return context.getImageData(
      0,
      0,
      width,
      height
    );
  }

  private ensureCanvas(
    width: number,
    height: number
  ): CanvasRenderingContext2D {
    if (this.canvas === null) {
      this.canvas =
        document.createElement("canvas");
    }

    if (
      this.canvas.width !== width
      || this.canvas.height !== height
    ) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.context = null;
    }

    if (this.context === null) {
      this.context =
        this.canvas.getContext(
          "2d",
          {
            alpha: false,
            willReadFrequently: true
          }
        );
    }

    if (this.context === null) {
      throw new TrackerError(
        ERROR_CODES.GAZE_PREDICTION_FAILED,
        "GAZE",
        "Unable to create the transient WebEyeTrack canvas context."
      );
    }

    return this.context;
  }

  private clearCanvas(): void {
    if (
      this.canvas === null
      || this.context === null
    ) {
      return;
    }

    this.context.clearRect(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
  }

  private assertReady(): VendorWebEyeTrack {
    if (
      this.initialized
      && !this.disposed
      && this.runtime !== null
    ) {
      return this.runtime;
    }

    throw new TrackerError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      "GAZE",
      "WebEyeTrack backend is not ready for prediction."
    );
  }
}
