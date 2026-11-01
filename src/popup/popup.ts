import {
  DEFAULT_CAMERA_REQUEST
} from "../camera/cameraConfig";

import {
  GAZE_OVERLAY,
  QUICK_RECALIBRATION
} from "../shared/constants";

import {
  MESSAGE_TYPES,
  createRuntimeMessage,
  isCompatibleMessageProtocol
} from "../shared/messages";

import {
  TRACKER_STATES,
  isTrackerState
} from "../shared/state";

import {
  createMessageId,
  isRecord,
  nowEpochMs
} from "../shared/utils";

import type {
  MessagePayloadMap,
  MessageType,
  RuntimeMessage,
  RuntimeMessageOf
} from "../shared/messages";

import type {
  TrackerState
} from "../shared/state";

import type {
  BrowserMetadata,
  ScreenMetadata,
  SessionId
} from "../shared/types";

/* ========================================================================== 
 * Development popup state
 * ======================================================================== */

let currentState: TrackerState =
  TRACKER_STATES.IDLE;

let activeSessionId: SessionId | null =
  null;

/**
 * Session that was just ended by an explicit hard reset. It remains
 * exportable in the current popup instance, but is never reused as the
 * active runtime/session context for the next initialization.
 */
let exportableCompletedSessionId:
  SessionId | null = null;

let busy = false;

const DEVELOPMENT_MESSAGE_TIMEOUT_MS =
  15_000;

const LAST_EXPORTABLE_SESSION_STORAGE_KEY =
  "eyeTrackerLastExportableSessionId";

async function loadExportableCompletedSessionId():
Promise<void> {
  const stored =
    await chrome.storage.local.get(
      LAST_EXPORTABLE_SESSION_STORAGE_KEY
    );

  const value =
    stored[LAST_EXPORTABLE_SESSION_STORAGE_KEY];

  exportableCompletedSessionId =
    typeof value === "string" && value.length > 0
      ? value
      : null;
}

async function persistExportableCompletedSessionId(
  sessionId: SessionId | null
): Promise<void> {
  if (sessionId === null) {
    await chrome.storage.local.remove(
      LAST_EXPORTABLE_SESSION_STORAGE_KEY
    );
    return;
  }

  await chrome.storage.local.set({
    [LAST_EXPORTABLE_SESSION_STORAGE_KEY]:
      sessionId
  });
}

/* ========================================================================== 
 * DOM helpers
 * ======================================================================== */

function getElementByIdOrThrow<
  TElement extends HTMLElement
>(
  id: string,
  constructor: {
    new (...args: never[]): TElement;
  }
): TElement {
  const element =
    document.getElementById(id);

  if (!(element instanceof constructor)) {
    throw new Error(
      `Popup element #${id} is missing or has an unexpected type.`
    );
  }

  return element;
}

const stateValue =
  getElementByIdOrThrow(
    "tracker-state",
    HTMLElement
  );

const gazeOverlayToggle =
  getElementByIdOrThrow(
    "gaze-overlay-toggle",
    HTMLInputElement
  );

const quickRecalibrationToggle =
  getElementByIdOrThrow(
    "quick-recalibration-toggle",
    HTMLInputElement
  );

const statusText =
  getElementByIdOrThrow(
    "status-text",
    HTMLParagraphElement
  );

const detailText =
  getElementByIdOrThrow(
    "detail-text",
    HTMLPreElement
  );

const initializeButton =
  getElementByIdOrThrow(
    "initialize-button",
    HTMLButtonElement
  );

const cameraButton =
  getElementByIdOrThrow(
    "camera-button",
    HTMLButtonElement
  );

const faceButton =
  getElementByIdOrThrow(
    "face-button",
    HTMLButtonElement
  );

const smokeButton =
  getElementByIdOrThrow(
    "smoke-button",
    HTMLButtonElement
  );

const refreshButton =
  getElementByIdOrThrow(
    "refresh-button",
    HTMLButtonElement
  );

const exportCsvButton =
  getElementByIdOrThrow(
    "export-csv-button",
    HTMLButtonElement
  );

const exportJsonButton =
  getElementByIdOrThrow(
    "export-json-button",
    HTMLButtonElement
  );

/* ========================================================================== 
 * UI state
 * ======================================================================== */

function setStatus(
  message: string,
  details: unknown = null
): void {
  statusText.textContent = message;

  if (details === null) {
    detailText.textContent = "";
    return;
  }

  try {
    detailText.textContent =
      JSON.stringify(details, null, 2);
  } catch {
    detailText.textContent =
      "Details could not be serialized.";
  }
}

function renderState(): void {
  stateValue.textContent =
    currentState;

  const canInitialize =
    currentState === TRACKER_STATES.IDLE;

  const canStartCamera =
    currentState === TRACKER_STATES.INITIALIZING;

  const canStartFace =
    currentState === TRACKER_STATES.CAMERA_READY;

  const canRunSmoke =
    currentState === TRACKER_STATES.INITIALIZING
    || currentState === TRACKER_STATES.CAMERA_READY
    || currentState === TRACKER_STATES.FACE_POSITIONING;

  initializeButton.disabled =
    busy || !canInitialize;

  cameraButton.disabled =
    busy || !canStartCamera;

  faceButton.disabled =
    busy || !canStartFace;

  smokeButton.disabled =
    busy || !canRunSmoke;

  refreshButton.disabled =
    busy;

  const canExport =
    activeSessionId !== null
    || exportableCompletedSessionId !== null;

  exportCsvButton.disabled =
    busy || !canExport;

  exportJsonButton.disabled =
    busy || !canExport;

  if (
    currentState === TRACKER_STATES.FACE_POSITIONING
  ) {
    smokeButton.textContent =
      "Gaze Smoke Test Running";
  } else {
    smokeButton.textContent =
      "Run Gaze Smoke Test";
  }
}

function setBusy(
  value: boolean
): void {
  busy = value;
  renderState();
}

/* ========================================================================== 
 * Runtime transport
 * ======================================================================== */

interface RouteFailure {
  ok: false;
  handled: false;
  error: {
    code: string;
    message: string;
    component: string;
    recoverable: boolean;
    details: Readonly<Record<string, unknown>> | null;
  };
}

interface RouteSuccess {
  ok: true;
  handled: boolean;
  response: unknown;
}

type RouteResult =
  | RouteFailure
  | RouteSuccess;

function isRouteResult(
  value: unknown
): value is RouteResult {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.ok !== "boolean"
    || typeof value.handled !== "boolean"
  ) {
    return false;
  }

  if (value.ok) {
    return "response" in value;
  }

  if (!isRecord(value.error)) {
    return false;
  }

  return (
    typeof value.error.code === "string"
    && typeof value.error.message === "string"
    && typeof value.error.component === "string"
    && typeof value.error.recoverable === "boolean"
    && (
      value.error.details === null
      || isRecord(value.error.details)
    )
  );
}

function isRuntimeMessage(
  value: unknown
): value is RuntimeMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isCompatibleMessageProtocol(
      value.protocolVersion
    )
    && typeof value.type === "string"
    && isRecord(value.meta)
    && "payload" in value
  );
}

function createPopupMessage<
  TType extends MessageType
>(
  type: TType,
  payload: MessagePayloadMap[TType]
): RuntimeMessageOf<TType> {
  return createRuntimeMessage(
    type,
    {
      messageId:
        createMessageId(),

      sentAtEpochMs:
        nowEpochMs(),

      source:
        "POPUP",

      target:
        "BACKGROUND",

      sessionId:
        activeSessionId,

      pageId:
        null,

      tabId:
        null,

      browserFrameId:
        null
    },
    payload
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId =
      globalThis.setTimeout(
        () => {
          reject(
            new Error(
              `${label} timed out after ${timeoutMs} ms.`
            )
          );
        },
        timeoutMs
      );

    void promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeoutId);
        reject(
          error instanceof Error
            ? error
            : new Error(
              "Background request failed with a non-Error rejection."
            )
        );
      }
    );
  });
}

async function sendBackgroundMessage<
  TType extends MessageType
>(
  type: TType,
  payload: MessagePayloadMap[TType]
): Promise<RuntimeMessage> {
  const rawResult: unknown =
    await withTimeout(
      chrome.runtime.sendMessage(
        createPopupMessage(
          type,
          payload
        )
      ),
      DEVELOPMENT_MESSAGE_TIMEOUT_MS,
      `${type} background request`
    );

  if (!isRouteResult(rawResult)) {
    throw new Error(
      `Background returned an invalid route result for ${type}.`
    );
  }

  if (!rawResult.ok) {
    throw new Error(
      `${rawResult.error.code}: ${rawResult.error.message}`
    );
  }

  if (!rawResult.handled) {
    throw new Error(
      `Background has no handler for ${type}.`
    );
  }

  if (!isRuntimeMessage(rawResult.response)) {
    throw new Error(
      `Background returned no valid response for ${type}.`
    );
  }

  return rawResult.response;
}

/* ========================================================================== 
 * Metadata
 * ======================================================================== */

function getBrowserMetadata(): BrowserMetadata {
  const userAgent =
    navigator.userAgent;

  const chromeMatch =
    /(?:Chrome|Chromium)\/([\d.]+)/u.exec(
      userAgent
    );

  return {
    browserName:
      chromeMatch === null
        ? "Chrome"
        : "Chrome",

    browserVersion:
      chromeMatch?.[1]
      ?? "unknown",

    operatingSystem:
      navigator.platform
      || "unknown",

    userAgent
  };
}

function getScreenMetadata(): ScreenMetadata {
  const orientation =
    globalThis.screen.orientation;

  return {
    width:
      globalThis.screen.width,

    height:
      globalThis.screen.height,

    availableWidth:
      globalThis.screen.availWidth,

    availableHeight:
      globalThis.screen.availHeight,

    devicePixelRatio:
      globalThis.devicePixelRatio,

    orientationType:
      orientation.type
      || null,

    orientationAngleDeg:
      Number.isFinite(orientation.angle)
        ? orientation.angle
        : null
  };
}

function createDevelopmentParticipantId(): string {
  return `dev-${Date.now().toString(36)}-${createMessageId()}`;
}

/* ========================================================================== 
 * Development transport preflight
 * ======================================================================== */

async function pingBackground():
Promise<void> {
  const nonce =
    createMessageId();

  const response =
    await sendBackgroundMessage(
      MESSAGE_TYPES.PING,
      {
        nonce
      }
    );

  if (
    response.type !== MESSAGE_TYPES.PONG
    || response.payload.nonce !== nonce
  ) {
    throw new Error(
      "Background PING/PONG preflight returned an invalid response."
    );
  }
}


/* ========================================================================== 
 * Camera permission onboarding
 * ======================================================================== */

type CameraPermissionContinuation =
  | "camera"
  | "smoke";

async function queryCameraPermissionState():
Promise<PermissionState | "UNSUPPORTED"> {
  if (
    navigator.permissions === undefined
    || typeof navigator.permissions.query
      !== "function"
  ) {
    return "UNSUPPORTED";
  }

  try {
    const descriptor = {
      name: "camera"
    } as PermissionDescriptor;

    const status =
      await navigator.permissions.query(
        descriptor
      );

    return status.state;
  } catch {
    return "UNSUPPORTED";
  }
}

async function openCameraPermissionPage(
  continuation:
    CameraPermissionContinuation
): Promise<void> {
  const pageUrl =
    new URL(
      chrome.runtime.getURL(
        "camera-permission/camera-permission.html"
      )
    );

  pageUrl.searchParams.set(
    "continue",
    continuation
  );

  await chrome.tabs.create({
    url: pageUrl.toString(),
    active: true
  });
}

async function ensureCameraPermission(
  continuation:
    CameraPermissionContinuation
): Promise<boolean> {
  const permissionState =
    await queryCameraPermissionState();

  if (permissionState === "granted") {
    return true;
  }

  setStatus(
    "Opening the extension camera-permission page…",
    {
      permissionState,
      continuation
    }
  );

  await openCameraPermissionPage(
    continuation
  );

  return false;
}

/* ========================================================================== 
 * Tracker commands
 * ======================================================================== */

async function refreshTrackerState():
Promise<TrackerState> {
  const response =
    await sendBackgroundMessage(
      MESSAGE_TYPES.GET_TRACKER_STATE,
      {}
    );

  if (
    response.type
    !== MESSAGE_TYPES.TRACKER_STATE_CHANGED
  ) {
    throw new Error(
      `Expected TRACKER_STATE_CHANGED, received ${response.type}.`
    );
  }

  const nextState =
    response.payload.snapshot.state;

  if (!isTrackerState(nextState)) {
    throw new Error(
      "Background returned an invalid tracker state."
    );
  }

  currentState = nextState;

  if (currentState === TRACKER_STATES.IDLE) {
    activeSessionId = null;
  } else if (typeof response.meta.sessionId === "string") {
    activeSessionId = response.meta.sessionId;
  }

  renderState();

  return currentState;
}

async function resetTracker():
Promise<void> {
  const resettingSessionId =
    activeSessionId;

  const response =
    await sendBackgroundMessage(
      MESSAGE_TYPES.RESET_TRACKER,
      {}
    );

  if (
    response.type
    !== MESSAGE_TYPES.TRACKER_STATE_CHANGED
  ) {
    throw new Error(
      `Expected TRACKER_STATE_CHANGED, received ${response.type}.`
    );
  }

  const nextState =
    response.payload.snapshot.state;

  if (!isTrackerState(nextState)) {
    throw new Error(
      "Background returned an invalid tracker state after reset."
    );
  }

  currentState = nextState;

  if (resettingSessionId !== null) {
    exportableCompletedSessionId =
      resettingSessionId;

    await persistExportableCompletedSessionId(
      resettingSessionId
    );
  }

  /**
   * Hard reset deliberately clears the active popup/session context. The
   * completed ID above is export-only and is never attached to INIT_TRACKER.
   */
  activeSessionId = null;
  renderState();

  setStatus(
    "Tracker reset. Start again with Initialize Tracker."
  );
}

async function initializeTracker():
Promise<void> {
  const response =
    await sendBackgroundMessage(
      MESSAGE_TYPES.INIT_TRACKER,
      {
        participantId:
          createDevelopmentParticipantId(),

        preferredGazeEngine:
          "WEB_EYE_TRACK",

        browser:
          getBrowserMetadata(),

        screen:
          getScreenMetadata()
      }
    );

  if (
    response.type
    !== MESSAGE_TYPES.TRACKER_INITIALIZED
  ) {
    throw new Error(
      `Expected TRACKER_INITIALIZED, received ${response.type}.`
    );
  }

  activeSessionId =
    response.payload.session.sessionId;

  setStatus(
    "Tracker initialized.",
    {
      sessionId:
        response.payload.session.sessionId,
      gazeEngine:
        response.payload.session.gazeEngine
    }
  );

  await refreshTrackerState();
}

async function startCamera():
Promise<void> {
  const response =
    await sendBackgroundMessage(
      MESSAGE_TYPES.START_CAMERA,
      {
        ...DEFAULT_CAMERA_REQUEST
      }
    );

  if (
    response.type
    !== MESSAGE_TYPES.CAMERA_READY
  ) {
    throw new Error(
      `Expected CAMERA_READY, received ${response.type}.`
    );
  }

  setStatus(
    "Camera ready.",
    response.payload.settings
  );

  await refreshTrackerState();
}

async function startFaceAndGazeSmoke():
Promise<void> {
  const response =
    await sendBackgroundMessage(
      MESSAGE_TYPES.START_FACE_POSITIONING,
      {}
    );

  if (
    response.type
    !== MESSAGE_TYPES.FACE_POSITION_STATUS
  ) {
    throw new Error(
      `Expected FACE_POSITION_STATUS, received ${response.type}.`
    );
  }

  setStatus(
    "Face + raw gaze pipeline started. Open the Offscreen console and filter for [GazeSmoke].",
    response.payload.status
  );

  await refreshTrackerState();
}

async function runSmokeTest():
Promise<void> {
  setStatus(
    "Smoke button clicked. Checking Background connection..."
  );

  await pingBackground();

  setStatus(
    "Background responded. Reading tracker state..."
  );

  await refreshTrackerState();

  if (
    currentState === TRACKER_STATES.IDLE
  ) {
    throw new Error(
      "Initialize Tracker must be run before the smoke test."
    );
  }

  if (
    currentState === TRACKER_STATES.INITIALIZING
  ) {
    const hasCameraPermission =
      await ensureCameraPermission(
        "smoke"
      );

    if (!hasCameraPermission) {
      return;
    }

    setStatus(
      "Starting camera..."
    );

    await startCamera();
  }

  if (
    currentState === TRACKER_STATES.CAMERA_READY
  ) {
    setStatus(
      "Loading Face Landmarker and WebEyeTrack..."
    );

    await startFaceAndGazeSmoke();
  }

  if (
    currentState === TRACKER_STATES.FACE_POSITIONING
  ) {
    setStatus(
      "Gaze smoke test is running. Inspect the Offscreen Document console for [GazeSmoke] logs."
    );

    return;
  }

  if (
    currentState === TRACKER_STATES.ERROR
  ) {
    throw new Error(
      "Tracker is in ERROR state. Reload the extension before retrying this development smoke test."
    );
  }

  throw new Error(
    `Smoke test cannot start from tracker state ${currentState}.`
  );
}

/* ==========================================================================
 * D25 local export
 * ======================================================================== */

async function downloadTextFile(
  filename: string,
  mimeType: string,
  content: string
): Promise<number> {
  const blob = new Blob(
    [content],
    { type: mimeType }
  );

  const objectUrl = URL.createObjectURL(blob);

  try {
    const downloadId =
      await chrome.downloads.download({
        url: objectUrl,
        filename,
        conflictAction: "uniquify",
        saveAs: false
      });

    if (typeof downloadId !== "number") {
      throw new Error(
        `Chrome did not return a download id for ${filename}.`
      );
    }

    return downloadId;
  } finally {
    globalThis.setTimeout(
      () => URL.revokeObjectURL(objectUrl),
      5_000
    );
  }
}

async function exportSession(
  format: "JSON" | "CSV"
): Promise<void> {
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.EXPORT_SESSION,
    {
      sessionId:
        activeSessionId
        ?? exportableCompletedSessionId,
      format
    }
  );

  if (
    response.type
    !== MESSAGE_TYPES.SESSION_EXPORT_READY
  ) {
    throw new Error(
      `Expected SESSION_EXPORT_READY, received ${response.type}.`
    );
  }

  if (activeSessionId === null) {
    exportableCompletedSessionId =
      response.payload.sessionId;

    await persistExportableCompletedSessionId(
      response.payload.sessionId
    );
  }

  const downloads: Array<{
    readonly filename: string;
    readonly downloadId: number;
  }> = [];

  for (const file of response.payload.files) {
    const downloadId =
      await downloadTextFile(
        file.filename,
        file.mimeType,
        file.content
      );

    downloads.push({
      filename: file.filename,
      downloadId
    });
  }

  setStatus(
    `${format} download started.`,
    {
      sessionId: response.payload.sessionId,
      downloads
    }
  );
}

/* ========================================================================== 
 * Gaze overlay preference
 * ======================================================================== */

async function loadGazeOverlayPreference():
Promise<void> {
  const stored =
    await chrome.storage.local.get(
      GAZE_OVERLAY.STORAGE_KEY
    );

  const value =
    stored[GAZE_OVERLAY.STORAGE_KEY];

  gazeOverlayToggle.checked =
    typeof value === "boolean"
      ? value
      : GAZE_OVERLAY.DEFAULT_ENABLED;
}

async function saveGazeOverlayPreference(
  enabled: boolean
): Promise<void> {
  await chrome.storage.local.set({
    [GAZE_OVERLAY.STORAGE_KEY]:
      enabled
  });
}

async function loadQuickRecalibrationPreference():
Promise<void> {
  const stored =
    await chrome.storage.local.get(
      QUICK_RECALIBRATION.STORAGE_KEY
    );

  const value =
    stored[QUICK_RECALIBRATION.STORAGE_KEY];

  quickRecalibrationToggle.checked =
    typeof value === "boolean"
      ? value
      : QUICK_RECALIBRATION.DEFAULT_ENABLED;
}

async function saveQuickRecalibrationPreference(
  enabled: boolean
): Promise<void> {
  await chrome.storage.local.set({
    [QUICK_RECALIBRATION.STORAGE_KEY]:
      enabled
  });
}

/* ========================================================================== 
 * Event handling
 * ======================================================================== */

async function runAction(
  action: () => Promise<void>
): Promise<void> {
  if (busy) {
    return;
  }

  setBusy(true);

  try {
    await action();
  } catch (error: unknown) {
    setStatus(
      "Development command failed.",
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown popup error"
      }
    );

    try {
      await refreshTrackerState();
    } catch {
      // Preserve the original command error in the popup.
    }
  } finally {
    setBusy(false);
    renderUxds();
  }
}

gazeOverlayToggle.addEventListener(
  "change",
  () => {
    const requestedValue =
      gazeOverlayToggle.checked;

    void saveGazeOverlayPreference(
      requestedValue
    ).catch((error: unknown) => {
      gazeOverlayToggle.checked =
        !requestedValue;

      setStatus(
        "Could not update gaze position display setting.",
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown storage error"
        }
      );
    });
  }
);

quickRecalibrationToggle.addEventListener(
  "change",
  () => {
    const requestedValue =
      quickRecalibrationToggle.checked;

    void saveQuickRecalibrationPreference(
      requestedValue
    ).then(() => {
      setStatus(
        requestedValue
          ? "Automatic quick recalibration enabled. Persistent drift must remain before maintenance starts."
          : "Automatic quick recalibration disabled. Drift diagnostics and adaptive smoothing remain active."
      );
    }).catch((error: unknown) => {
      quickRecalibrationToggle.checked =
        !requestedValue;

      setStatus(
        "Could not update quick recalibration setting.",
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown storage error"
        }
      );
    });
  }
);

initializeButton.addEventListener(
  "click",
  () => {
    void runAction(
      initializeTracker
    );
  }
);

cameraButton.addEventListener(
  "click",
  () => {
    void runAction(
      async () => {
        const hasCameraPermission =
          await ensureCameraPermission(
            "camera"
          );

        if (hasCameraPermission) {
          await startCamera();
        }
      }
    );
  }
);

faceButton.addEventListener(
  "click",
  () => {
    void runAction(
      startFaceAndGazeSmoke
    );
  }
);

smokeButton.addEventListener(
  "click",
  () => {
    void runAction(
      runSmokeTest
    );
  }
);

refreshButton.addEventListener(
  "click",
  () => {
    void runAction(
      resetTracker
    );
  }
);

exportCsvButton.addEventListener(
  "click",
  () => {
    void runAction(
      () => exportSession("CSV")
    );
  }
);

exportJsonButton.addEventListener(
  "click",
  () => {
    void runAction(
      () => exportSession("JSON")
    );
  }
);

/* ========================================================================== 
 * UXDS project binding / coordinated collection controls
 * ======================================================================== */
const uxdsProjectInput = getElementByIdOrThrow("uxds-project-id", HTMLInputElement);
const uxdsConnectButton = getElementByIdOrThrow("uxds-connect", HTMLButtonElement);
const uxdsStartButton = getElementByIdOrThrow("uxds-start", HTMLButtonElement);
const uxdsStopButton = getElementByIdOrThrow("uxds-stop", HTMLButtonElement);
const uxdsRetryButton = getElementByIdOrThrow("uxds-retry", HTMLButtonElement);
const uxdsProjectStatus = getElementByIdOrThrow("uxds-project-status", HTMLParagraphElement);
const uxdsUploadState = getElementByIdOrThrow("uxds-upload-state", HTMLParagraphElement);

interface UxdsPopupState {
  success: boolean;
  error?: string;
  isTracking?: boolean;
  uxdsArmed?: boolean;
  projectId?: string | null;
  projectName?: string | null;
  sessionId?: string | null;
  pendingUploadEventCount?: number;
  eyePendingEventCount?: number;
  lastUploadError?: string | null;
}
let uxdsState: UxdsPopupState = {success:true};

async function sendUxds(message: Record<string, unknown>): Promise<UxdsPopupState> {
  const raw: unknown = await chrome.runtime.sendMessage(message);
  if (!isRecord(raw) || raw.success !== true) {
    throw new Error(isRecord(raw) && typeof raw.error === "string" ? raw.error : "UXDS 연결 오류");
  }
  return raw as unknown as UxdsPopupState;
}

function renderUxds(): void {
  const connected = typeof uxdsState.projectId === "string" && uxdsState.projectId.length > 0;
  uxdsProjectStatus.textContent = connected
    ? `${uxdsState.projectName ?? "프로젝트"} · ${uxdsState.projectId}`
    : "UXDS 프로젝트를 연결해 주세요.";
  const armed = uxdsState.uxdsArmed === true;
  uxdsProjectInput.disabled = busy || armed;
  uxdsConnectButton.disabled = busy || armed;
  uxdsStartButton.disabled = busy || !connected || armed;
  uxdsStopButton.disabled = busy || !armed;
  uxdsUploadState.textContent = uxdsState.lastUploadError
    ? `전송 오류: ${uxdsState.lastUploadError} (로컬 전송 대기열 유지)`
    : `마우스 전송 대기 ${uxdsState.pendingUploadEventCount ?? 0}건 · 시선 전송 대기 ${uxdsState.eyePendingEventCount ?? 0}건`
      + (uxdsState.isTracking ? ` · 수집 중 (${uxdsState.sessionId ?? ""})` : armed ? " · 캘리브레이션·검증 중" : "");
}

async function refreshUxds(): Promise<void> {
  uxdsState = await sendUxds({type:"UXDS_GET_TRACKING_STATE"});
  if (uxdsState.projectId && !uxdsProjectInput.value) uxdsProjectInput.value = uxdsState.projectId;
  renderUxds();
}

uxdsConnectButton.addEventListener("click", () => {
  void runAction(async () => {
    uxdsState = await sendUxds({type:"UXDS_CONNECT_PROJECT",projectId:uxdsProjectInput.value});
    renderUxds();
    setStatus("UXDS 프로젝트가 연결되었습니다.");
  });
});

uxdsStartButton.addEventListener("click", () => {
  void runAction(async () => {
    // Never hide a failed reset and start a second session on stale runtime.
    const previousState = await refreshTrackerState();
    if (previousState !== TRACKER_STATES.IDLE) {
      await resetTracker();
      const resetState = await refreshTrackerState();
      if (resetState !== TRACKER_STATES.IDLE) {
        throw new Error("이전 세션 초기화가 완료되지 않았습니다. 다시 시도해 주세요.");
      }
    }
    const activeTabs = await chrome.tabs.query({active:true,currentWindow:true});
    const url = activeTabs[0]?.url ?? "";
    if (!/^https?:\/\//u.test(url)) throw new Error("실험할 http/https 웹페이지를 연 상태에서 수집을 시작하세요.");
    uxdsState = await sendUxds({type:"UXDS_ARM_COLLECTION"});
    renderUxds();
    try {
      await initializeTracker();
      const hasCameraPermission = await ensureCameraPermission("smoke");
      if (hasCameraPermission) {
        await startCamera();
        await startFaceAndGazeSmoke();
        setStatus("얼굴 위치 확인 중입니다. 이어서 캘리브레이션과 독립 검증이 자동 진행됩니다.");
      } else {
        setStatus("열린 카메라 권한 페이지에서 권한을 허용하고 '계속'을 눌러 주세요. 보정과 검증은 자동 진행됩니다.");
      }
    } catch(error:unknown) {
      await sendUxds({type:"UXDS_DISARM_COLLECTION"}).catch(() => undefined);
      await resetTracker().catch(() => undefined);
      throw error;
    }
    await refreshUxds();
  });
});

uxdsStopButton.addEventListener("click", () => {
  void runAction(async () => {
    await resetTracker();
    await refreshUxds();
    setStatus("시선과 마우스 통합 수집을 중지했습니다. 대기 데이터 업로드는 계속됩니다.");
  });
});

uxdsRetryButton.addEventListener("click", () => {
  void runAction(async () => {
    await sendUxds({type:"UXDS_RETRY_UPLOAD"});
    await refreshUxds();
    setStatus("전송 재시도 요청을 보냈습니다.");
  });
});

/* ========================================================================== 
 * Bootstrap
 * ======================================================================== */

async function bootstrapPopup():
Promise<void> {
  renderState();

  try {
    await loadGazeOverlayPreference();
    await loadQuickRecalibrationPreference();
    await loadExportableCompletedSessionId();
    await refreshTrackerState();
    await refreshUxds();

    if (
      currentState === TRACKER_STATES.FACE_POSITIONING
    ) {
      setStatus(
        "얼굴 위치 확인 중입니다. 안정된 자세가 감지되면 캘리브레이션이 자동으로 시작됩니다."
      );
    } else {
      setStatus(
        "프로젝트를 연결한 뒤 수집을 시작해 주세요."
      );
    }
  } catch (error: unknown) {
    setStatus(
      "Could not read tracker state.",
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown popup bootstrap error"
      }
    );
  }
}

void bootstrapPopup();
// Popup can be closed at any point; the background owns the entire run.
window.setInterval(() => {
  if (!busy) {
    void refreshTrackerState().then(refreshUxds).catch(() => undefined);
  }
}, 2500);
