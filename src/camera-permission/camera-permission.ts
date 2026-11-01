import {
  DEFAULT_CAMERA_REQUEST
} from "../camera/cameraConfig";

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
 * Page configuration
 * ======================================================================== */

type ContinuationMode =
  | "camera"
  | "smoke";

const MESSAGE_TIMEOUT_MS =
  5000;

const searchParams =
  new URLSearchParams(
    globalThis.location.search
  );

const continuationMode:
  ContinuationMode =
    searchParams.get("continue") === "camera"
      ? "camera"
      : "smoke";

let activeSessionId:
  SessionId | null =
    null;

let busy = false;

/* ========================================================================== 
 * DOM
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
      `Camera permission element #${id} is missing or has an unexpected type.`
    );
  }

  return element;
}

const permissionStateValue =
  getElementByIdOrThrow(
    "permission-state",
    HTMLElement
  );

const grantButton =
  getElementByIdOrThrow(
    "grant-button",
    HTMLButtonElement
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

function setBusy(
  value: boolean
): void {
  busy = value;
  grantButton.disabled = value;
}

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

/* ========================================================================== 
 * Permission state
 * ======================================================================== */

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

async function renderPermissionState():
Promise<PermissionState | "UNSUPPORTED"> {
  const state =
    await queryCameraPermissionState();

  permissionStateValue.textContent =
    state.toUpperCase();

  return state;
}

async function acquireAndReleaseCamera():
Promise<void> {
  const mediaDevices =
    navigator.mediaDevices;

  if (
    mediaDevices === undefined
    || typeof mediaDevices.getUserMedia
      !== "function"
  ) {
    throw new Error(
      "MediaDevices.getUserMedia() is unavailable on the camera permission page."
    );
  }

  const stream =
    await mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/* ========================================================================== 
 * Background transport
 * ======================================================================== */

interface RouteFailure {
  ok: false;
  handled: false;
  error: {
    code: string;
    message: string;
    component: string;
    recoverable: boolean;
    details:
      Readonly<Record<string, unknown>> | null;
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

function createPermissionUiMessage<
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
        "CAMERA_PERMISSION_UI",

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
        createPermissionUiMessage(
          type,
          payload
        )
      ),
      MESSAGE_TIMEOUT_MS,
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

  activeSessionId =
    typeof rawResult.response.meta.sessionId
      === "string"
      ? rawResult.response.meta.sessionId
      : activeSessionId;

  return rawResult.response;
}

/* ========================================================================== 
 * Tracker continuation
 * ======================================================================== */

function getBrowserMetadata(): BrowserMetadata {
  const userAgent =
    navigator.userAgent;

  const chromeMatch =
    /(?:Chrome|Chromium)\/([\d.]+)/u.exec(
      userAgent
    );

  return {
    browserName: "Chrome",
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
  return `dev-permission-${Date.now().toString(36)}-${createMessageId()}`;
}

async function getTrackerState():
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

  const state =
    response.payload.snapshot.state;

  if (!isTrackerState(state)) {
    throw new Error(
      "Background returned an invalid tracker state."
    );
  }

  return state;
}

async function initializeTrackerIfNeeded(
  state: TrackerState
): Promise<TrackerState> {
  if (state !== TRACKER_STATES.IDLE) {
    return state;
  }

  setStatus(
    "Tracker runtime was idle. Reinitializing it before continuing…"
  );

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

  return getTrackerState();
}

async function startCameraIfNeeded(
  state: TrackerState
): Promise<TrackerState> {
  if (state !== TRACKER_STATES.INITIALIZING) {
    return state;
  }

  setStatus(
    "Permission granted. Starting the Offscreen camera runtime…"
  );

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

  return getTrackerState();
}

async function startFaceIfNeeded(
  state: TrackerState
): Promise<TrackerState> {
  if (
    continuationMode !== "smoke"
    || state !== TRACKER_STATES.CAMERA_READY
  ) {
    return state;
  }

  setStatus(
    "Camera ready. Starting Face Landmarker and WebEyeTrack…"
  );

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

  return getTrackerState();
}

async function continueTrackerFlow():
Promise<void> {
  let state =
    await getTrackerState();

  if (state === TRACKER_STATES.ERROR) {
    throw new Error(
      "Tracker is already in ERROR state. Reload the extension once, then open the popup and run the smoke test again."
    );
  }

  state =
    await initializeTrackerIfNeeded(
      state
    );

  state =
    await startCameraIfNeeded(
      state
    );

  state =
    await startFaceIfNeeded(
      state
    );

  if (
    continuationMode === "smoke"
    && state === TRACKER_STATES.FACE_POSITIONING
  ) {
    setStatus(
      "Camera permission granted and the gaze smoke test is running. Inspect the extension Offscreen Document console for [GazeSmoke] logs.",
      {
        trackerState: state
      }
    );
    return;
  }

  if (
    continuationMode === "camera"
    && state === TRACKER_STATES.CAMERA_READY
  ) {
    setStatus(
      "Camera permission granted and the Offscreen camera is running. You can return to the extension popup.",
      {
        trackerState: state
      }
    );
    return;
  }

  throw new Error(
    `Permission was granted, but continuation stopped in tracker state ${state}.`
  );
}

/* ========================================================================== 
 * User action
 * ======================================================================== */

async function grantCameraAndContinue():
Promise<void> {
  if (busy) {
    return;
  }

  setBusy(true);
  setStatus(
    "Requesting camera access from Chrome…"
  );

  try {
    await acquireAndReleaseCamera();

    const permissionState =
      await renderPermissionState();

    if (permissionState !== "granted") {
      throw new Error(
        `Camera stream opened, but the permission state is ${permissionState}.`
      );
    }

    setStatus(
      "Camera permission granted. Continuing tracker startup…"
    );

    await continueTrackerFlow();
  } catch (error: unknown) {
    const permissionState =
      await renderPermissionState();

    setStatus(
      "Camera permission or tracker continuation failed.",
      {
        permissionState,
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "Unknown camera permission error"
      }
    );
  } finally {
    setBusy(false);
  }
}

grantButton.addEventListener(
  "click",
  () => {
    void grantCameraAndContinue();
  }
);

/* ========================================================================== 
 * Bootstrap
 * ======================================================================== */

async function bootstrap():
Promise<void> {
  const state =
    await renderPermissionState();

  if (state === "granted") {
    setStatus(
      "Camera permission is already granted. Press Continue to start the tracker."
    );
    grantButton.textContent =
      "Continue Tracker";
    return;
  }

  if (state === "denied") {
    setStatus(
      "Camera access is currently blocked for the extension. Change the camera control for this extension page to Allow, then press the button again."
    );
    return;
  }

  setStatus(
    "Press the button below. Chrome should show a camera permission prompt for the extension."
  );
}

void bootstrap();
