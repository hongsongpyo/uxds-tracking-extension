import {
  TRACKER_STATES,
  isTrackerState
} from "../chunks/chunk-ZYYK23HD.js";
import {
  DEFAULT_CAMERA_REQUEST,
  GAZE_OVERLAY,
  MESSAGE_TYPES,
  QUICK_RECALIBRATION,
  createMessageId,
  createRuntimeMessage,
  isCompatibleMessageProtocol,
  isRecord,
  nowEpochMs
} from "../chunks/chunk-6TH637DM.js";
import "../chunks/chunk-NRCRLAHV.js";

// src/popup/popup.ts
var currentState = TRACKER_STATES.IDLE;
var activeSessionId = null;
var exportableCompletedSessionId = null;
var busy = false;
var DEVELOPMENT_MESSAGE_TIMEOUT_MS = 15e3;
var LAST_EXPORTABLE_SESSION_STORAGE_KEY = "eyeTrackerLastExportableSessionId";
async function loadExportableCompletedSessionId() {
  const stored = await chrome.storage.local.get(
    LAST_EXPORTABLE_SESSION_STORAGE_KEY
  );
  const value = stored[LAST_EXPORTABLE_SESSION_STORAGE_KEY];
  exportableCompletedSessionId = typeof value === "string" && value.length > 0 ? value : null;
}
async function persistExportableCompletedSessionId(sessionId) {
  if (sessionId === null) {
    await chrome.storage.local.remove(
      LAST_EXPORTABLE_SESSION_STORAGE_KEY
    );
    return;
  }
  await chrome.storage.local.set({
    [LAST_EXPORTABLE_SESSION_STORAGE_KEY]: sessionId
  });
}
function getElementByIdOrThrow(id, constructor) {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(
      `Popup element #${id} is missing or has an unexpected type.`
    );
  }
  return element;
}
var stateValue = getElementByIdOrThrow(
  "tracker-state",
  HTMLElement
);
var gazeOverlayToggle = getElementByIdOrThrow(
  "gaze-overlay-toggle",
  HTMLInputElement
);
var quickRecalibrationToggle = getElementByIdOrThrow(
  "quick-recalibration-toggle",
  HTMLInputElement
);
var statusText = getElementByIdOrThrow(
  "status-text",
  HTMLParagraphElement
);
var detailText = getElementByIdOrThrow(
  "detail-text",
  HTMLPreElement
);
var initializeButton = getElementByIdOrThrow(
  "initialize-button",
  HTMLButtonElement
);
var cameraButton = getElementByIdOrThrow(
  "camera-button",
  HTMLButtonElement
);
var faceButton = getElementByIdOrThrow(
  "face-button",
  HTMLButtonElement
);
var smokeButton = getElementByIdOrThrow(
  "smoke-button",
  HTMLButtonElement
);
var refreshButton = getElementByIdOrThrow(
  "refresh-button",
  HTMLButtonElement
);
var exportCsvButton = getElementByIdOrThrow(
  "export-csv-button",
  HTMLButtonElement
);
var exportJsonButton = getElementByIdOrThrow(
  "export-json-button",
  HTMLButtonElement
);
function setStatus(message, details = null) {
  statusText.textContent = message;
  if (details === null) {
    detailText.textContent = "";
    return;
  }
  try {
    detailText.textContent = JSON.stringify(details, null, 2);
  } catch {
    detailText.textContent = "Details could not be serialized.";
  }
}
function renderState() {
  stateValue.textContent = currentState;
  const canInitialize = currentState === TRACKER_STATES.IDLE;
  const canStartCamera = currentState === TRACKER_STATES.INITIALIZING;
  const canStartFace = currentState === TRACKER_STATES.CAMERA_READY;
  const canRunSmoke = currentState === TRACKER_STATES.INITIALIZING || currentState === TRACKER_STATES.CAMERA_READY || currentState === TRACKER_STATES.FACE_POSITIONING;
  initializeButton.disabled = busy || !canInitialize;
  cameraButton.disabled = busy || !canStartCamera;
  faceButton.disabled = busy || !canStartFace;
  smokeButton.disabled = busy || !canRunSmoke;
  refreshButton.disabled = busy;
  const canExport = activeSessionId !== null || exportableCompletedSessionId !== null;
  exportCsvButton.disabled = busy || !canExport;
  exportJsonButton.disabled = busy || !canExport;
  if (currentState === TRACKER_STATES.FACE_POSITIONING) {
    smokeButton.textContent = "Gaze Smoke Test Running";
  } else {
    smokeButton.textContent = "Run Gaze Smoke Test";
  }
}
function setBusy(value) {
  busy = value;
  renderState();
}
function isRouteResult(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.ok !== "boolean" || typeof value.handled !== "boolean") {
    return false;
  }
  if (value.ok) {
    return "response" in value;
  }
  if (!isRecord(value.error)) {
    return false;
  }
  return typeof value.error.code === "string" && typeof value.error.message === "string" && typeof value.error.component === "string" && typeof value.error.recoverable === "boolean" && (value.error.details === null || isRecord(value.error.details));
}
function isRuntimeMessage(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isCompatibleMessageProtocol(
    value.protocolVersion
  ) && typeof value.type === "string" && isRecord(value.meta) && "payload" in value;
}
function createPopupMessage(type, payload) {
  return createRuntimeMessage(
    type,
    {
      messageId: createMessageId(),
      sentAtEpochMs: nowEpochMs(),
      source: "POPUP",
      target: "BACKGROUND",
      sessionId: activeSessionId,
      pageId: null,
      tabId: null,
      browserFrameId: null
    },
    payload
  );
}
function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(
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
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(
          error instanceof Error ? error : new Error(
            "Background request failed with a non-Error rejection."
          )
        );
      }
    );
  });
}
async function sendBackgroundMessage(type, payload) {
  const rawResult = await withTimeout(
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
function getBrowserMetadata() {
  const userAgent = navigator.userAgent;
  const chromeMatch = /(?:Chrome|Chromium)\/([\d.]+)/u.exec(
    userAgent
  );
  return {
    browserName: chromeMatch === null ? "Chrome" : "Chrome",
    browserVersion: chromeMatch?.[1] ?? "unknown",
    operatingSystem: navigator.platform || "unknown",
    userAgent
  };
}
function getScreenMetadata() {
  const orientation = globalThis.screen.orientation;
  return {
    width: globalThis.screen.width,
    height: globalThis.screen.height,
    availableWidth: globalThis.screen.availWidth,
    availableHeight: globalThis.screen.availHeight,
    devicePixelRatio: globalThis.devicePixelRatio,
    orientationType: orientation.type || null,
    orientationAngleDeg: Number.isFinite(orientation.angle) ? orientation.angle : null
  };
}
function createDevelopmentParticipantId() {
  return `dev-${Date.now().toString(36)}-${createMessageId()}`;
}
async function pingBackground() {
  const nonce = createMessageId();
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.PING,
    {
      nonce
    }
  );
  if (response.type !== MESSAGE_TYPES.PONG || response.payload.nonce !== nonce) {
    throw new Error(
      "Background PING/PONG preflight returned an invalid response."
    );
  }
}
async function queryCameraPermissionState() {
  if (navigator.permissions === void 0 || typeof navigator.permissions.query !== "function") {
    return "UNSUPPORTED";
  }
  try {
    const descriptor = {
      name: "camera"
    };
    const status = await navigator.permissions.query(
      descriptor
    );
    return status.state;
  } catch {
    return "UNSUPPORTED";
  }
}
async function openCameraPermissionPage(continuation) {
  const pageUrl = new URL(
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
async function ensureCameraPermission(continuation) {
  const permissionState = await queryCameraPermissionState();
  if (permissionState === "granted") {
    return true;
  }
  setStatus(
    "Opening the extension camera-permission page\u2026",
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
async function refreshTrackerState() {
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.GET_TRACKER_STATE,
    {}
  );
  if (response.type !== MESSAGE_TYPES.TRACKER_STATE_CHANGED) {
    throw new Error(
      `Expected TRACKER_STATE_CHANGED, received ${response.type}.`
    );
  }
  const nextState = response.payload.snapshot.state;
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
async function resetTracker() {
  const resettingSessionId = activeSessionId;
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.RESET_TRACKER,
    {}
  );
  if (response.type !== MESSAGE_TYPES.TRACKER_STATE_CHANGED) {
    throw new Error(
      `Expected TRACKER_STATE_CHANGED, received ${response.type}.`
    );
  }
  const nextState = response.payload.snapshot.state;
  if (!isTrackerState(nextState)) {
    throw new Error(
      "Background returned an invalid tracker state after reset."
    );
  }
  currentState = nextState;
  if (resettingSessionId !== null) {
    exportableCompletedSessionId = resettingSessionId;
    await persistExportableCompletedSessionId(
      resettingSessionId
    );
  }
  activeSessionId = null;
  renderState();
  setStatus(
    "Tracker reset. Start again with Initialize Tracker."
  );
}
async function initializeTracker() {
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.INIT_TRACKER,
    {
      participantId: createDevelopmentParticipantId(),
      preferredGazeEngine: "WEB_EYE_TRACK",
      browser: getBrowserMetadata(),
      screen: getScreenMetadata()
    }
  );
  if (response.type !== MESSAGE_TYPES.TRACKER_INITIALIZED) {
    throw new Error(
      `Expected TRACKER_INITIALIZED, received ${response.type}.`
    );
  }
  activeSessionId = response.payload.session.sessionId;
  setStatus(
    "Tracker initialized.",
    {
      sessionId: response.payload.session.sessionId,
      gazeEngine: response.payload.session.gazeEngine
    }
  );
  await refreshTrackerState();
}
async function startCamera() {
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.START_CAMERA,
    {
      ...DEFAULT_CAMERA_REQUEST
    }
  );
  if (response.type !== MESSAGE_TYPES.CAMERA_READY) {
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
async function startFaceAndGazeSmoke() {
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.START_FACE_POSITIONING,
    {}
  );
  if (response.type !== MESSAGE_TYPES.FACE_POSITION_STATUS) {
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
async function runSmokeTest() {
  setStatus(
    "Smoke button clicked. Checking Background connection..."
  );
  await pingBackground();
  setStatus(
    "Background responded. Reading tracker state..."
  );
  await refreshTrackerState();
  if (currentState === TRACKER_STATES.IDLE) {
    throw new Error(
      "Initialize Tracker must be run before the smoke test."
    );
  }
  if (currentState === TRACKER_STATES.INITIALIZING) {
    const hasCameraPermission = await ensureCameraPermission(
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
  if (currentState === TRACKER_STATES.CAMERA_READY) {
    setStatus(
      "Loading Face Landmarker and WebEyeTrack..."
    );
    await startFaceAndGazeSmoke();
  }
  if (currentState === TRACKER_STATES.FACE_POSITIONING) {
    setStatus(
      "Gaze smoke test is running. Inspect the Offscreen Document console for [GazeSmoke] logs."
    );
    return;
  }
  if (currentState === TRACKER_STATES.ERROR) {
    throw new Error(
      "Tracker is in ERROR state. Reload the extension before retrying this development smoke test."
    );
  }
  throw new Error(
    `Smoke test cannot start from tracker state ${currentState}.`
  );
}
async function downloadTextFile(filename, mimeType, content) {
  const blob = new Blob(
    [content],
    { type: mimeType }
  );
  const objectUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({
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
      5e3
    );
  }
}
async function exportSession(format) {
  const response = await sendBackgroundMessage(
    MESSAGE_TYPES.EXPORT_SESSION,
    {
      sessionId: activeSessionId ?? exportableCompletedSessionId,
      format
    }
  );
  if (response.type !== MESSAGE_TYPES.SESSION_EXPORT_READY) {
    throw new Error(
      `Expected SESSION_EXPORT_READY, received ${response.type}.`
    );
  }
  if (activeSessionId === null) {
    exportableCompletedSessionId = response.payload.sessionId;
    await persistExportableCompletedSessionId(
      response.payload.sessionId
    );
  }
  const downloads = [];
  for (const file of response.payload.files) {
    const downloadId = await downloadTextFile(
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
async function loadGazeOverlayPreference() {
  const stored = await chrome.storage.local.get(
    GAZE_OVERLAY.STORAGE_KEY
  );
  const value = stored[GAZE_OVERLAY.STORAGE_KEY];
  gazeOverlayToggle.checked = typeof value === "boolean" ? value : GAZE_OVERLAY.DEFAULT_ENABLED;
}
async function saveGazeOverlayPreference(enabled) {
  await chrome.storage.local.set({
    [GAZE_OVERLAY.STORAGE_KEY]: enabled
  });
}
async function loadQuickRecalibrationPreference() {
  const stored = await chrome.storage.local.get(
    QUICK_RECALIBRATION.STORAGE_KEY
  );
  const value = stored[QUICK_RECALIBRATION.STORAGE_KEY];
  quickRecalibrationToggle.checked = typeof value === "boolean" ? value : QUICK_RECALIBRATION.DEFAULT_ENABLED;
}
async function saveQuickRecalibrationPreference(enabled) {
  await chrome.storage.local.set({
    [QUICK_RECALIBRATION.STORAGE_KEY]: enabled
  });
}
async function runAction(action) {
  if (busy) {
    return;
  }
  setBusy(true);
  try {
    await action();
  } catch (error) {
    setStatus(
      "Development command failed.",
      {
        error: error instanceof Error ? error.message : "Unknown popup error"
      }
    );
    try {
      await refreshTrackerState();
    } catch {
    }
  } finally {
    setBusy(false);
    renderUxds();
  }
}
gazeOverlayToggle.addEventListener(
  "change",
  () => {
    const requestedValue = gazeOverlayToggle.checked;
    void saveGazeOverlayPreference(
      requestedValue
    ).catch((error) => {
      gazeOverlayToggle.checked = !requestedValue;
      setStatus(
        "Could not update gaze position display setting.",
        {
          error: error instanceof Error ? error.message : "Unknown storage error"
        }
      );
    });
  }
);
quickRecalibrationToggle.addEventListener(
  "change",
  () => {
    const requestedValue = quickRecalibrationToggle.checked;
    void saveQuickRecalibrationPreference(
      requestedValue
    ).then(() => {
      setStatus(
        requestedValue ? "Automatic quick recalibration enabled. Persistent drift must remain before maintenance starts." : "Automatic quick recalibration disabled. Drift diagnostics and adaptive smoothing remain active."
      );
    }).catch((error) => {
      quickRecalibrationToggle.checked = !requestedValue;
      setStatus(
        "Could not update quick recalibration setting.",
        {
          error: error instanceof Error ? error.message : "Unknown storage error"
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
        const hasCameraPermission = await ensureCameraPermission(
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
var uxdsProjectInput = getElementByIdOrThrow("uxds-project-id", HTMLInputElement);
var uxdsConnectButton = getElementByIdOrThrow("uxds-connect", HTMLButtonElement);
var uxdsStartButton = getElementByIdOrThrow("uxds-start", HTMLButtonElement);
var uxdsStopButton = getElementByIdOrThrow("uxds-stop", HTMLButtonElement);
var uxdsRetryButton = getElementByIdOrThrow("uxds-retry", HTMLButtonElement);
var uxdsProjectStatus = getElementByIdOrThrow("uxds-project-status", HTMLParagraphElement);
var uxdsUploadState = getElementByIdOrThrow("uxds-upload-state", HTMLParagraphElement);
var uxdsState = { success: true };
async function sendUxds(message) {
  const raw = await chrome.runtime.sendMessage(message);
  if (!isRecord(raw) || raw.success !== true) {
    throw new Error(isRecord(raw) && typeof raw.error === "string" ? raw.error : "UXDS \uC5F0\uACB0 \uC624\uB958");
  }
  return raw;
}
function renderUxds() {
  const connected = typeof uxdsState.projectId === "string" && uxdsState.projectId.length > 0;
  uxdsProjectStatus.textContent = connected ? `${uxdsState.projectName ?? "\uD504\uB85C\uC81D\uD2B8"} \xB7 ${uxdsState.projectId}` : "UXDS \uD504\uB85C\uC81D\uD2B8\uB97C \uC5F0\uACB0\uD574 \uC8FC\uC138\uC694.";
  const armed = uxdsState.uxdsArmed === true;
  uxdsProjectInput.disabled = busy || armed;
  uxdsConnectButton.disabled = busy || armed;
  uxdsStartButton.disabled = busy || !connected || armed;
  uxdsStopButton.disabled = busy || !armed;
  uxdsUploadState.textContent = uxdsState.lastUploadError ? `\uC804\uC1A1 \uC624\uB958: ${uxdsState.lastUploadError} (\uB85C\uCEEC \uC804\uC1A1 \uB300\uAE30\uC5F4 \uC720\uC9C0)` : `\uB9C8\uC6B0\uC2A4 \uC804\uC1A1 \uB300\uAE30 ${uxdsState.pendingUploadEventCount ?? 0}\uAC74 \xB7 \uC2DC\uC120 \uC804\uC1A1 \uB300\uAE30 ${uxdsState.eyePendingEventCount ?? 0}\uAC74` + (uxdsState.isTracking ? ` \xB7 \uC218\uC9D1 \uC911 (${uxdsState.sessionId ?? ""})` : armed ? " \xB7 \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\xB7\uAC80\uC99D \uC911" : "");
}
async function refreshUxds() {
  uxdsState = await sendUxds({ type: "UXDS_GET_TRACKING_STATE" });
  if (uxdsState.projectId && !uxdsProjectInput.value) uxdsProjectInput.value = uxdsState.projectId;
  renderUxds();
}
uxdsConnectButton.addEventListener("click", () => {
  void runAction(async () => {
    uxdsState = await sendUxds({ type: "UXDS_CONNECT_PROJECT", projectId: uxdsProjectInput.value });
    renderUxds();
    setStatus("UXDS \uD504\uB85C\uC81D\uD2B8\uAC00 \uC5F0\uACB0\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
  });
});
uxdsStartButton.addEventListener("click", () => {
  void runAction(async () => {
    const previousState = await refreshTrackerState();
    if (previousState !== TRACKER_STATES.IDLE) {
      await resetTracker();
      const resetState = await refreshTrackerState();
      if (resetState !== TRACKER_STATES.IDLE) {
        throw new Error("\uC774\uC804 \uC138\uC158 \uCD08\uAE30\uD654\uAC00 \uC644\uB8CC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
      }
    }
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = activeTabs[0]?.url ?? "";
    if (!/^https?:\/\//u.test(url)) throw new Error("\uC2E4\uD5D8\uD560 http/https \uC6F9\uD398\uC774\uC9C0\uB97C \uC5F0 \uC0C1\uD0DC\uC5D0\uC11C \uC218\uC9D1\uC744 \uC2DC\uC791\uD558\uC138\uC694.");
    uxdsState = await sendUxds({ type: "UXDS_ARM_COLLECTION" });
    renderUxds();
    try {
      await initializeTracker();
      const hasCameraPermission = await ensureCameraPermission("smoke");
      if (hasCameraPermission) {
        await startCamera();
        await startFaceAndGazeSmoke();
        setStatus("\uC5BC\uAD74 \uC704\uCE58 \uD655\uC778 \uC911\uC785\uB2C8\uB2E4. \uC774\uC5B4\uC11C \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uACFC \uB3C5\uB9BD \uAC80\uC99D\uC774 \uC790\uB3D9 \uC9C4\uD589\uB429\uB2C8\uB2E4.");
      } else {
        setStatus("\uC5F4\uB9B0 \uCE74\uBA54\uB77C \uAD8C\uD55C \uD398\uC774\uC9C0\uC5D0\uC11C \uAD8C\uD55C\uC744 \uD5C8\uC6A9\uD558\uACE0 '\uACC4\uC18D'\uC744 \uB20C\uB7EC \uC8FC\uC138\uC694. \uBCF4\uC815\uACFC \uAC80\uC99D\uC740 \uC790\uB3D9 \uC9C4\uD589\uB429\uB2C8\uB2E4.");
      }
    } catch (error) {
      await sendUxds({ type: "UXDS_DISARM_COLLECTION" }).catch(() => void 0);
      await resetTracker().catch(() => void 0);
      throw error;
    }
    await refreshUxds();
  });
});
uxdsStopButton.addEventListener("click", () => {
  void runAction(async () => {
    await resetTracker();
    await refreshUxds();
    setStatus("\uC2DC\uC120\uACFC \uB9C8\uC6B0\uC2A4 \uD1B5\uD569 \uC218\uC9D1\uC744 \uC911\uC9C0\uD588\uC2B5\uB2C8\uB2E4. \uB300\uAE30 \uB370\uC774\uD130 \uC5C5\uB85C\uB4DC\uB294 \uACC4\uC18D\uB429\uB2C8\uB2E4.");
  });
});
uxdsRetryButton.addEventListener("click", () => {
  void runAction(async () => {
    await sendUxds({ type: "UXDS_RETRY_UPLOAD" });
    await refreshUxds();
    setStatus("\uC804\uC1A1 \uC7AC\uC2DC\uB3C4 \uC694\uCCAD\uC744 \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4.");
  });
});
async function bootstrapPopup() {
  renderState();
  try {
    await loadGazeOverlayPreference();
    await loadQuickRecalibrationPreference();
    await loadExportableCompletedSessionId();
    await refreshTrackerState();
    await refreshUxds();
    if (currentState === TRACKER_STATES.FACE_POSITIONING) {
      setStatus(
        "\uC5BC\uAD74 \uC704\uCE58 \uD655\uC778 \uC911\uC785\uB2C8\uB2E4. \uC548\uC815\uB41C \uC790\uC138\uAC00 \uAC10\uC9C0\uB418\uBA74 \uCE98\uB9AC\uBE0C\uB808\uC774\uC158\uC774 \uC790\uB3D9\uC73C\uB85C \uC2DC\uC791\uB429\uB2C8\uB2E4."
      );
    } else {
      setStatus(
        "\uD504\uB85C\uC81D\uD2B8\uB97C \uC5F0\uACB0\uD55C \uB4A4 \uC218\uC9D1\uC744 \uC2DC\uC791\uD574 \uC8FC\uC138\uC694."
      );
    }
  } catch (error) {
    setStatus(
      "Could not read tracker state.",
      {
        error: error instanceof Error ? error.message : "Unknown popup bootstrap error"
      }
    );
  }
}
void bootstrapPopup();
window.setInterval(() => {
  if (!busy) {
    void refreshTrackerState().then(refreshUxds).catch(() => void 0);
  }
}, 2500);
//# sourceMappingURL=popup.js.map
