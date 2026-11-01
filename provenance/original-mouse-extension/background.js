// extension/background.js

importScripts("config.js");

const UPLOAD_RETRY_ALARM = "uxds-upload-retry";
const UPLOAD_RETRY_MINUTES = 1;
const MAX_PENDING_EVENTS = 3000;

const DEFAULT_STATE = Object.freeze({
  isTracking: false,
  sessionId: null,
  projectId: null,
  projectName: null,
  projectConnectedAt: null,
  trackedTabIds: [],
  pendingUploadBatches: [],
  lastUploadAt: null,
  lastUploadError: null
});

let uploadFlushPromise = null;
let storageWriteLock = Promise.resolve();

function generateSessionId() {
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `session_${Date.now()}_${randomPart}`;
}

function generateEventId(prefix = "evt") {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}

function generateBatchId() {
  return generateEventId("batch");
}

function normalizeProjectId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidProjectIdFormat(projectId) {
  return /^prj_[0-9a-f]{12}$/.test(projectId);
}

function getPendingUploadEventCount(state) {
  return (state.pendingUploadBatches || []).reduce(
    (total, batch) => total + (Array.isArray(batch?.events) ? batch.events.length : 0),
    0
  );
}

function withStorageWriteLock(task) {
  const run = storageWriteLock.then(task, task);
  storageWriteLock = run.catch(() => undefined);
  return run;
}

async function getState() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));

  return {
    isTracking: stored.isTracking ?? DEFAULT_STATE.isTracking,
    sessionId: stored.sessionId ?? DEFAULT_STATE.sessionId,
    projectId: stored.projectId ?? DEFAULT_STATE.projectId,
    projectName: stored.projectName ?? DEFAULT_STATE.projectName,
    projectConnectedAt: stored.projectConnectedAt ?? DEFAULT_STATE.projectConnectedAt,
    trackedTabIds: Array.isArray(stored.trackedTabIds)
      ? stored.trackedTabIds.filter((value) => Number.isInteger(value))
      : [],
    pendingUploadBatches: Array.isArray(stored.pendingUploadBatches)
      ? stored.pendingUploadBatches
      : [],
    lastUploadAt: stored.lastUploadAt ?? DEFAULT_STATE.lastUploadAt,
    lastUploadError: stored.lastUploadError ?? DEFAULT_STATE.lastUploadError
  };
}

function toPublicState(state) {
  return {
    ...state,
    pendingUploadEventCount: getPendingUploadEventCount(state)
  };
}

async function patchState(partialState) {
  await chrome.storage.local.set(partialState);
  return getState();
}

async function initializeStorage() {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const missing = {};

  for (const [key, defaultValue] of Object.entries(DEFAULT_STATE)) {
    if (typeof existing[key] === "undefined") {
      missing[key] = defaultValue;
    }
  }

  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }

  await chrome.alarms.create(UPLOAD_RETRY_ALARM, {
    periodInMinutes: UPLOAD_RETRY_MINUTES
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs?.[0] ?? null;
}

function isTrackableUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
}

function buildSessionBoundaryEvent(eventType, { sessionId, projectId, tab = null }) {
  return {
    event_id: generateEventId(eventType),
    project_id: projectId,
    session_id: sessionId,
    page_view_id: null,
    event_type: eventType,
    timestamp: Date.now(),
    page_url: tab?.url || null,
    page_title: tab?.title || null,
    source: "background"
  };
}

async function sendMessageToTab(tabId, message) {
  if (!Number.isInteger(tabId)) {
    return {
      success: false,
      error: "유효한 탭을 찾을 수 없습니다."
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return {
      success: true,
      data: response
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "content script와 통신할 수 없습니다."
    };
  }
}

async function validateProject(projectId) {
  const normalizedProjectId = normalizeProjectId(projectId);

  if (!isValidProjectIdFormat(normalizedProjectId)) {
    return {
      success: false,
      error: "Project ID 형식이 올바르지 않습니다."
    };
  }

  try {
    const response = await fetch(UXDS_CONFIG.VALIDATE_PROJECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify({ projectId: normalizedProjectId }),
      cache: "no-store"
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.valid || !data?.project?.id) {
      return {
        success: false,
        error: data?.error || `프로젝트 확인에 실패했습니다. (${response.status})`
      };
    }

    return {
      success: true,
      projectId: data.project.id,
      projectName: data.project.name || "이름 없는 프로젝트"
    };
  } catch (error) {
    return {
      success: false,
      error:
        error.message ||
        "UXDS 서버에 연결할 수 없습니다. 인터넷 연결과 API 배포 상태를 확인하세요."
    };
  }
}

async function connectProject(projectId) {
  const current = await getState();

  if (current.isTracking) {
    return {
      success: false,
      error: "수집 중에는 프로젝트를 변경할 수 없습니다. 먼저 수집을 중지하세요."
    };
  }

  const validation = await validateProject(projectId);

  if (!validation.success) {
    return validation;
  }

  const state = await patchState({
    projectId: validation.projectId,
    projectName: validation.projectName,
    projectConnectedAt: Date.now()
  });

  return {
    success: true,
    ...toPublicState(state)
  };
}

async function disconnectProject() {
  const current = await getState();

  if (current.isTracking) {
    return {
      success: false,
      error: "수집 중에는 프로젝트 연결을 해제할 수 없습니다. 먼저 수집을 중지하세요."
    };
  }

  if (getPendingUploadEventCount(current) > 0) {
    return {
      success: false,
      error: "아직 서버 전송 대기 중인 데이터가 있습니다. 전송이 끝난 뒤 연결을 해제하세요."
    };
  }

  const state = await patchState({
    projectId: null,
    projectName: null,
    projectConnectedAt: null,
    trackedTabIds: []
  });

  return {
    success: true,
    ...toPublicState(state)
  };
}

async function enqueueUploadBatch(payload) {
  if (!payload || !Array.isArray(payload.events) || payload.events.length === 0) {
    return {
      success: false,
      error: "전송할 이벤트가 없습니다."
    };
  }

  return withStorageWriteLock(async () => {
    const current = await getState();

    if (!current.projectId) {
      return {
        success: false,
        error: "연결된 Project ID가 없습니다."
      };
    }

    if (payload.project_id !== current.projectId) {
      return {
        success: false,
        error: "현재 연결된 프로젝트와 이벤트의 Project ID가 일치하지 않습니다."
      };
    }

    const currentPendingCount = getPendingUploadEventCount(current);
    const nextPendingCount = currentPendingCount + payload.events.length;

    if (nextPendingCount > MAX_PENDING_EVENTS) {
      return {
        success: false,
        error: `서버 전송 대기 데이터가 ${MAX_PENDING_EVENTS}개를 초과했습니다. 인터넷 연결을 확인하세요.`
      };
    }

    const batch = {
      batchId: generateBatchId(),
      project_id: payload.project_id,
      session_id: payload.session_id,
      events: payload.events,
      queuedAt: Date.now(),
      attempts: 0
    };

    await chrome.storage.local.set({
      pendingUploadBatches: [...current.pendingUploadBatches, batch]
    });

    return {
      success: true,
      queued: payload.events.length,
      pendingUploadEventCount: nextPendingCount
    };
  }).then((result) => {
    if (result.success) {
      void flushPendingUploads();
    }
    return result;
  });
}

async function postBatchToUxds(batch) {
  const response = await fetch(UXDS_CONFIG.INGEST_MOUSE_EVENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify({
      project_id: batch.project_id,
      session_id: batch.session_id,
      events: batch.events
    }),
    cache: "no-store"
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.error || `UXDS 수집 API 응답 오류: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function flushPendingUploadsInternal() {
  while (true) {
    const current = await getState();
    const firstBatch = current.pendingUploadBatches[0];

    if (!firstBatch) {
      return {
        success: true,
        pendingUploadEventCount: 0
      };
    }

    try {
      await postBatchToUxds(firstBatch);

      await withStorageWriteLock(async () => {
        const latest = await getState();
        const remaining = latest.pendingUploadBatches.filter(
          (batch) => batch.batchId !== firstBatch.batchId
        );

        await chrome.storage.local.set({
          pendingUploadBatches: remaining,
          lastUploadAt: Date.now(),
          lastUploadError: null
        });
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 429 || status >= 500;
      const errorMessage = error?.message || "UXDS 서버 전송에 실패했습니다.";

      await withStorageWriteLock(async () => {
        const latest = await getState();
        const updatedBatches = latest.pendingUploadBatches.map((batch) =>
          batch.batchId === firstBatch.batchId
            ? {
                ...batch,
                attempts: Number(batch.attempts || 0) + 1,
                lastAttemptAt: Date.now(),
                lastError: errorMessage,
                lastHttpStatus: status || null,
                retryable
              }
            : batch
        );

        // Never silently discard captured participant data. Even a 4xx batch
        // stays in the persistent outbox so the popup exposes the failure and
        // the data can be retried after the client/server contract is fixed.
        await chrome.storage.local.set({
          pendingUploadBatches: updatedBatches,
          lastUploadError: errorMessage
        });
      });

      if (!retryable) {
        console.error(
          `[background] 업로드가 거부되었습니다(${status}). 데이터는 삭제하지 않고 outbox에 보존합니다:`,
          errorMessage
        );
      } else {
        console.warn("[background] UXDS 업로드 재시도 대기:", errorMessage);
      }

      const failedState = await getState();
      return {
        success: false,
        error: errorMessage,
        pendingUploadEventCount: getPendingUploadEventCount(failedState)
      };
    }
  }
}

function flushPendingUploads() {
  if (uploadFlushPromise) {
    return uploadFlushPromise;
  }

  uploadFlushPromise = flushPendingUploadsInternal().finally(() => {
    uploadFlushPromise = null;
  });

  return uploadFlushPromise;
}

async function startTracking() {
  const current = await getState();

  if (current.isTracking) {
    return {
      success: true,
      ...toPublicState(current)
    };
  }

  if (!current.projectId) {
    return {
      success: false,
      error: "먼저 UXDS Project ID를 연결하세요."
    };
  }

  const validation = await validateProject(current.projectId);
  if (!validation.success) {
    return validation;
  }

  const activeTab = await getActiveTab();

  if (!activeTab?.id || !isTrackableUrl(activeTab.url)) {
    return {
      success: false,
      error: "http/https 웹페이지에서만 수집을 시작할 수 있습니다."
    };
  }

  const sessionId = generateSessionId();

  await patchState({
    isTracking: true,
    sessionId,
    projectId: validation.projectId,
    projectName: validation.projectName,
    trackedTabIds: [activeTab.id],
    lastUploadError: null
  });

  const sessionStartResult = await enqueueUploadBatch({
    project_id: validation.projectId,
    session_id: sessionId,
    events: [
      buildSessionBoundaryEvent("session_start", {
        sessionId,
        projectId: validation.projectId,
        tab: activeTab
      })
    ]
  });

  if (!sessionStartResult.success) {
    console.warn("[background] session_start queue 실패:", sessionStartResult.error);
  }

  const contentResult = await sendMessageToTab(activeTab.id, {
    type: "START_TRACKING",
    sessionId,
    projectId: validation.projectId
  });

  if (!contentResult.success) {
    console.warn("[background] START_TRACKING 전달 지연:", contentResult.error);
  }

  const state = await getState();
  return {
    success: true,
    ...toPublicState(state)
  };
}

async function stopTracking() {
  const current = await getState();

  if (!current.isTracking) {
    return {
      success: true,
      ...toPublicState(current)
    };
  }

  const tabIds = [...new Set(current.trackedTabIds)];

  await Promise.all(
    tabIds.map((tabId) =>
      sendMessageToTab(tabId, {
        type: "STOP_TRACKING",
        sessionId: current.sessionId
      })
    )
  );

  const previousSessionId = current.sessionId;
  const previousProjectId = current.projectId;

  if (previousSessionId && previousProjectId) {
    const sessionEndResult = await enqueueUploadBatch({
      project_id: previousProjectId,
      session_id: previousSessionId,
      events: [
        buildSessionBoundaryEvent("session_end", {
          sessionId: previousSessionId,
          projectId: previousProjectId
        })
      ]
    });

    if (!sessionEndResult.success) {
      console.warn("[background] session_end queue 실패:", sessionEndResult.error);
    }
  }

  const state = await patchState({
    isTracking: false,
    sessionId: null,
    trackedTabIds: []
  });

  void flushPendingUploads();

  return {
    success: true,
    previousSessionId,
    ...toPublicState(state)
  };
}

async function registerContentTab(sender) {
  const state = await getState();
  const tab = sender?.tab;

  if (!state.isTracking || !state.sessionId || !state.projectId || !tab?.id) {
    return {
      success: true,
      shouldTrack: false,
      ...toPublicState(state)
    };
  }

  const tabId = tab.id;
  const openerTabId = tab.openerTabId;
  const alreadyTracked = state.trackedTabIds.includes(tabId);
  const openedFromTrackedTab =
    Number.isInteger(openerTabId) && state.trackedTabIds.includes(openerTabId);

  if (!alreadyTracked && !openedFromTrackedTab) {
    return {
      success: true,
      shouldTrack: false,
      ...toPublicState(state)
    };
  }

  if (!alreadyTracked) {
    await patchState({
      trackedTabIds: [...new Set([...state.trackedTabIds, tabId])]
    });
  }

  const latest = await getState();
  return {
    success: true,
    shouldTrack: true,
    isTracking: true,
    sessionId: latest.sessionId,
    projectId: latest.projectId,
    projectName: latest.projectName,
    pendingUploadEventCount: getPendingUploadEventCount(latest)
  };
}

chrome.runtime.onInstalled.addListener(() => {
  initializeStorage()
    .then(() => flushPendingUploads())
    .catch((error) => {
      console.error("[background] 초기 저장소 설정 실패:", error);
    });
});

chrome.runtime.onStartup.addListener(() => {
  initializeStorage()
    .then(() => flushPendingUploads())
    .catch((error) => {
      console.error("[background] 시작 상태 복원 실패:", error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_RETRY_ALARM) {
    void flushPendingUploads();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const state = await getState();
    if (!state.trackedTabIds.includes(tabId)) {
      return;
    }

    await patchState({
      trackedTabIds: state.trackedTabIds.filter((id) => id !== tabId)
    });
  })().catch((error) => {
    console.error("[background] 탭 상태 정리 실패:", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "CONNECT_PROJECT":
          sendResponse(await connectProject(message.projectId));
          break;

        case "DISCONNECT_PROJECT":
          sendResponse(await disconnectProject());
          break;

        case "START_TRACKING":
          sendResponse(await startTracking());
          break;

        case "STOP_TRACKING":
          sendResponse(await stopTracking());
          break;

        case "GET_TRACKING_STATE": {
          const state = await getState();
          sendResponse({
            success: true,
            ...toPublicState(state)
          });
          break;
        }

        case "CONTENT_READY":
          sendResponse(await registerContentTab(sender));
          break;

        case "QUEUE_EVENTS_FOR_UPLOAD":
          sendResponse(await enqueueUploadBatch(message.payload));
          break;

        case "RETRY_PENDING_UPLOADS": {
          const result = await flushPendingUploads();
          const state = await getState();
          sendResponse({
            ...result,
            ...toPublicState(state)
          });
          break;
        }

        default:
          sendResponse({
            success: false,
            error: `지원하지 않는 메시지 타입입니다: ${message.type}`
          });
      }
    } catch (error) {
      console.error("[background] 메시지 처리 실패:", error);
      sendResponse({
        success: false,
        error: error.message || "background 처리 중 오류가 발생했습니다."
      });
    }
  })();

  return true;
});

initializeStorage()
  .then(() => flushPendingUploads())
  .catch((error) => {
    console.error("[background] 저장소 초기화 실패:", error);
  });
