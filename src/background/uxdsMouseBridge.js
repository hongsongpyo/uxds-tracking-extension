// extension/background.js
import {
  isUxdsServerSessionId,
  isUxdsServerPageViewId,
  isLegacyEyeSessionId,
  isLegacyEyePageId,
  makeUxdsServerSessionId,
  makeUxdsServerPageViewId,
  toUxdsUploadEvent
} from './uxdsServerIds.js';


// UXDS connection settings used by the extension service worker.
const UXDS_CONFIG = Object.freeze({
  SUPABASE_URL: "https://exburxzvshqhhqbmhesr.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e1e1N_PzU3N7w0C9p0EdQg_Rb8DRRv2",
  VALIDATE_PROJECT_URL:
    "https://exburxzvshqhhqbmhesr.supabase.co/functions/v1/validate-project",
  INGEST_MOUSE_EVENTS_URL:
    "https://exburxzvshqhhqbmhesr.supabase.co/functions/v1/ingest-mouse-events",
  INGEST_EYE_EVENTS_URL:
    "https://exburxzvshqhhqbmhesr.supabase.co/functions/v1/ingest-eye-events"
});



const UPLOAD_RETRY_ALARM = "uxds-upload-retry";
const UPLOAD_RETRY_MINUTES = 1;
const MAX_PENDING_EVENTS = 20000;

const DEFAULT_STATE = Object.freeze({
  isTracking: false,
  sessionId: null,
  projectId: null,
  projectName: null,
  projectConnectedAt: null,
  trackedTabIds: [],
  pendingUploadBatches: [],
  lastUploadAt: null,
  lastUploadError: null,
  uxdsArmed: false,
  eyeUploadQueue: []
});

const eyePageIdsByTab = new Map();
let uploadFlushPromise = null;
let storageWriteLock = Promise.resolve();

// Stable aliases permit previously rejected session_<UUID> / page_<UUID>
// events to be replayed after an upgrade, without overwriting local research IDs.
const UPLOAD_ID_ALIASES_KEY = 'uxdsUploadIdAliasesV1';

async function getUploadAlias(originalId, kind, eventTime) {
  if (kind === 'session' && isUxdsServerSessionId(originalId)) return originalId;
  if (kind === 'page' && isUxdsServerPageViewId(originalId)) return originalId;

  const legacyKnown = kind === 'session'
    ? isLegacyEyeSessionId(originalId)
    : isLegacyEyePageId(originalId);
  if (!legacyKnown) {
    throw new Error(`Unknown ${kind} ID format in the saved UXDS upload queue: ${String(originalId).slice(0, 120)}`);
  }

  return withStorageWriteLock(async () => {
    const stored = await chrome.storage.local.get(UPLOAD_ID_ALIASES_KEY);
    const aliases = stored[UPLOAD_ID_ALIASES_KEY] || {};
    const key = `${kind}:${originalId}`;
    if (typeof aliases[key] === 'string') return aliases[key];

    const time = Number.isFinite(eventTime) && eventTime >= 1_500_000_000_000
      ? Math.trunc(eventTime)
      : Date.now();
    const alias = kind === 'session'
      ? makeUxdsServerSessionId(time)
      : makeUxdsServerPageViewId(time);
    await chrome.storage.local.set({
      [UPLOAD_ID_ALIASES_KEY]: { ...aliases, [key]: alias }
    });
    return alias;
  });
}

async function makeServerUploadBatch(batch) {
  const sessionId = await getUploadAlias(
    batch.session_id, 'session', batch.events?.[0]?.timestamp ?? batch.queuedAt
  );
  const pageIds = new Map();
  for (const event of batch.events) {
    const pageId = typeof event.page_view_id === 'string'
      ? event.page_view_id
      : (typeof event.page_id === 'string' ? event.page_id : null);
    if (pageId && !pageIds.has(pageId)) {
      const normalized = await getUploadAlias(pageId, 'page', event.timestamp);
      pageIds.set(pageId, normalized);
    }
  }
  return {
    project_id: batch.project_id,
    session_id: sessionId,
    events: batch.events.map((event) => {
      const pageId = typeof event.page_view_id === 'string'
        ? event.page_view_id
        : (typeof event.page_id === 'string' ? event.page_id : null);
      return toUxdsUploadEvent(event, sessionId, pageId ? pageIds.get(pageId) : null);
    })
  };
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
    lastUploadError: stored.lastUploadError ?? DEFAULT_STATE.lastUploadError,
    uxdsArmed: stored.uxdsArmed ?? DEFAULT_STATE.uxdsArmed,
    eyeUploadQueue: Array.isArray(stored.eyeUploadQueue) ? stored.eyeUploadQueue : []
  };
}

function toPublicState(state) {
  // Never return the raw persistent queues to popup/content message callers.
  return {
    isTracking: state.isTracking,
    uxdsArmed: state.uxdsArmed,
    sessionId: state.sessionId,
    projectId: state.projectId,
    projectName: state.projectName,
    projectConnectedAt: state.projectConnectedAt,
    trackedTabIds: [...state.trackedTabIds],
    lastUploadAt: state.lastUploadAt,
    lastUploadError: state.lastUploadError,
    pendingUploadEventCount: getPendingUploadEventCount(state),
    eyePendingEventCount: state.eyeUploadQueue.reduce((n, b) => n + b.events.length, 0)
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

  if (current.isTracking || current.uxdsArmed) {
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

  if (current.isTracking || current.uxdsArmed) {
    return {
      success: false,
      error: "수집 중에는 프로젝트 연결을 해제할 수 없습니다. 먼저 수집을 중지하세요."
    };
  }

  if (getPendingUploadEventCount(current) > 0 || current.eyeUploadQueue.length > 0) {
    return {
      success: false,
      error: "아직 서버 전송 대기 중인 데이터가 있습니다. 전송이 끝난 뒤 연결을 해제하세요."
    };
  }

  const state = await patchState({
    projectId: null,
    projectName: null,
    projectConnectedAt: null,
    trackedTabIds: [],
    uxdsArmed: false
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

    if (!current.isTracking || payload.session_id !== current.sessionId) {
      return {success:false,error:"활성 세션과 일치하지 않는 이벤트입니다."};
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
  const upload = await makeServerUploadBatch(batch);
  const response = await fetch(UXDS_CONFIG.INGEST_MOUSE_EVENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify(upload),
    cache: "no-store"
  });

  const data = await response.json().catch(() => null);

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

async function startTracking(sharedSessionId, researchTabId, eyePageId = null) {
  const current = await getState();

  if (current.isTracking) {
    return current.sessionId === sharedSessionId
      ? {success:true,...toPublicState(current)}
      : {success:false,error:"다른 세션이 이미 수집 중입니다."};
  }

  if (!current.uxdsArmed) return {success:false,error:"수집이 활성화되지 않았습니다."};

  if (!current.projectId) {
    return {
      success: false,
      error: "먼저 UXDS Project ID를 연결하세요."
    };
  }

  // UXDS_ARM_COLLECTION already verified this project against Supabase.
  // The webcam may be offline by the time independent gaze validation ends;
  // continue local-first collection and retry both uploads later.
  const validatedProjectId = current.projectId;

  const activeTab = Number.isInteger(researchTabId)
    ? await chrome.tabs.get(researchTabId).catch(() => null)
    : await getActiveTab();

  if (!activeTab?.id || !isTrackableUrl(activeTab.url)) {
    return {
      success: false,
      error: "http/https 웹페이지에서만 수집을 시작할 수 있습니다."
    };
  }

  const sessionId = sharedSessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    return {success:false,error:"시선 추적 세션 ID가 없습니다."};
  }

  await patchState({
    isTracking: true,
    sessionId,
    projectId: validatedProjectId,
    projectName: current.projectName,
    trackedTabIds: [activeTab.id],
    lastUploadError: null
  });

  const sessionStartResult = await enqueueUploadBatch({
    project_id: validatedProjectId,
    session_id: sessionId,
    events: [
      buildSessionBoundaryEvent("session_start", {
        sessionId,
        projectId: validatedProjectId,
        tab: activeTab
      })
    ]
  });

  if (!sessionStartResult.success) {
    console.warn("[background] session_start queue 실패:", sessionStartResult.error);
  }

  const contentResult = await sendMessageToTab(activeTab.id, {
    type: "UXDS_MOUSE_START",
    sessionId,
    projectId: validatedProjectId,
    pageViewId: eyePageId
  });

  if (!contentResult.success || contentResult.data?.success !== true) {
    const reason = contentResult.error || contentResult.data?.error || "Content Script did not acknowledge mouse activation.";
    await patchState({isTracking:false,sessionId:null,trackedTabIds:[],lastUploadError:reason});
    return {success:false,error:reason};
  }

  collectingSessionId = sessionId;
  const state = await getState();
  return {
    success: true,
    ...toPublicState(state)
  };
}

async function stopTracking() {
  const current = await getState();

  if (!current.isTracking) {
    collectingSessionId = null;
    eyePageIdsByTab.clear();
    const state = await patchState({ uxdsArmed: false });
    return { success: true, ...toPublicState(state) };
  }

  await drainEyeBuffer();
  collectingSessionId = null;
  eyePageIdsByTab.clear();
  const tabIds = [...new Set(current.trackedTabIds)];

  await Promise.all(
    tabIds.map((tabId) =>
      sendMessageToTab(tabId, {
        type: "UXDS_MOUSE_STOP",
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
    trackedTabIds: [],
    uxdsArmed: false
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
    pendingUploadEventCount: getPendingUploadEventCount(latest),
    pageViewId: eyePageIdsByTab.get(tabId) ?? null
  };
}

chrome.runtime.onInstalled.addListener(() => {
  initializeStorage()
    .then(() => Promise.all([flushPendingUploads(), flushPendingEyeUploads()]))
    .catch((error) => {
      console.error("[background] 초기 저장소 설정 실패:", error);
    });
});

chrome.runtime.onStartup.addListener(() => {
  initializeStorage()
    .then(() => Promise.all([flushPendingUploads(), flushPendingEyeUploads()]))
    .catch((error) => {
      console.error("[background] 시작 상태 복원 실패:", error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_RETRY_ALARM) {
    void flushPendingUploads();
    void flushPendingEyeUploads();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  eyePageIdsByTab.delete(tabId);
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
  if (!message || typeof message.type !== "string" || !message.type.startsWith("UXDS_") || message.type === "UXDS_ARM_COLLECTION" || message.type === "UXDS_DISARM_COLLECTION") return false;
  (async () => {
    try {
      switch (message.type) {
        case "UXDS_CONNECT_PROJECT":
          sendResponse(await connectProject(message.projectId));
          break;

        case "UXDS_DISCONNECT_PROJECT":
          sendResponse(await disconnectProject());
          break;


        case "UXDS_GET_TRACKING_STATE": {
          const state = await getState();
          sendResponse({
            success: true,
            ...toPublicState(state)
          });
          break;
        }

        case "UXDS_CONTENT_READY":
          sendResponse(await registerContentTab(sender));
          break;

        case "UXDS_QUEUE_EVENTS": {
          const current = await getState();
          if (!sender.tab?.id || !current.trackedTabIds.includes(sender.tab.id)) {
            sendResponse({success:false,error:"등록되지 않은 탭입니다."});
          } else {
            sendResponse(await enqueueUploadBatch(message.payload));
          }
          break;
        }

        case "UXDS_RETRY_UPLOAD": {
          const result = await Promise.all([flushPendingUploads(), flushPendingEyeUploads()]);
          const state = await getState();
          sendResponse({
            success: result.every((r) => r.success),
            ...toPublicState(state)
          });
          break;
        }

        default:
          return;
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
  .then(() => Promise.all([flushPendingUploads(), flushPendingEyeUploads()]))
  .catch((error) => {
    console.error("[background] 저장소 초기화 실패:", error);
  });

/* =====================================================================
 * Eye bridge: activation is called ONLY after Eye independent validation
 * passed the collection safety gate. No mouse collection while calibrating.
 * =================================================================== */
export async function uxdsGetState() {
  return {success: true, ...toPublicState(await getState())};
}
export async function uxdsArmCollection() {
  const current = await getState();
  if (current.isTracking || !current.projectId) {
    return {success:false,error:"프로젝트 연결 후 수집을 시작하세요.",...toPublicState(current)};
  }
  const validation = await validateProject(current.projectId);
  if (!validation.success) return validation;
  const state = await patchState({uxdsArmed:true,projectName:validation.projectName});
  return {success:true,...toPublicState(state)};
}
export async function uxdsActivateForEyeSession(sessionId, tabId, pageId) {
  if (pageId) eyePageIdsByTab.set(tabId,pageId);
  return startTracking(sessionId,tabId,pageId);
}
export function uxdsSyncPageContext(tabId, pageId, sessionId) {
  if (!Number.isInteger(tabId) || !pageId) return;
  eyePageIdsByTab.set(tabId,pageId);
  if (!uxdsIsCollecting(sessionId)) return;
  void sendMessageToTab(tabId,{
    type:"UXDS_MOUSE_PAGE_CHANGED",sessionId,pageViewId:pageId
  });
}
export async function uxdsStopForEye() {
  await drainEyeBuffer();
  return stopTracking();
}
let collectingSessionId = null;
const eyeBuffer = [];
let eyeBufferTimer = null;
let eyeFlushPromise = null;
const MAX_EYE_PENDING_EVENTS = 20000;

export function uxdsIsCollecting(sessionId) {
  return collectingSessionId === sessionId;
}

export function uxdsQueueGazeEvent(event) {
  if (collectingSessionId === null || event?.session_id !== collectingSessionId) return;
  if (!event?.event_id || !Number.isFinite(event?.timestamp)) return;
  eyeBuffer.push(event);
  if (eyeBuffer.length >= 25) {
    void drainEyeBuffer();
  } else if (eyeBufferTimer === null) {
    eyeBufferTimer = setTimeout(() => {
      eyeBufferTimer = null;
      void drainEyeBuffer();
    }, 1500);
  }
}

async function drainEyeBuffer() {
  if (eyeFlushPromise) { await eyeFlushPromise; return; }
  if (eyeBufferTimer !== null) { clearTimeout(eyeBufferTimer); eyeBufferTimer = null; }
  if (!eyeBuffer.length) return;
  const events = eyeBuffer.splice(0);
  eyeFlushPromise = withStorageWriteLock(async () => {
    const state = await getState();
    if (!state.projectId || !state.sessionId || state.sessionId !== events[0].session_id) return;
    const count = state.eyeUploadQueue.reduce((n,b) => n+b.events.length,0);
    if (count + events.length > MAX_EYE_PENDING_EVENTS) {
      eyeBuffer.unshift(...events);
      await chrome.storage.local.set({lastUploadError:"시선 전송 대기 한도 초과: 데이터는 로컬 실험 DB에서도 보존됩니다. UXDS 연결을 확인하세요."});
      return;
    }
    await chrome.storage.local.set({eyeUploadQueue:[...state.eyeUploadQueue,{
      batchId:generateBatchId(),project_id:state.projectId,session_id:state.sessionId,events,queuedAt:Date.now(),attempts:0
    }]});
  }).finally(() => {eyeFlushPromise=null;});
  await eyeFlushPromise;
  void flushPendingEyeUploads();
}

async function flushPendingEyeUploads() {
  if (eyeFlushPromise !== null) await eyeFlushPromise;
  if (eyeUploadPromise !== null) return eyeUploadPromise;
  eyeUploadPromise = flushEyeInternal().finally(() => {eyeUploadPromise=null;});
  return eyeUploadPromise;
}
let eyeUploadPromise = null;

async function flushEyeInternal() {
  while (true) {
    const state = await getState();
    const batch = state.eyeUploadQueue[0];
    if (!batch) return {success:true};
    try {
      const upload = await makeServerUploadBatch(batch);
      const response = await fetch(UXDS_CONFIG.INGEST_EYE_EVENTS_URL,{
        method:"POST",headers:{"Content-Type":"application/json",apikey:UXDS_CONFIG.SUPABASE_PUBLISHABLE_KEY},
        body:JSON.stringify(upload),cache:"no-store"
      });
      if (!response.ok) {
        let message = `시선 API HTTP ${response.status}`;
        const data = await response.json().catch(() => null);
        if (data !== null && typeof data?.error === "string") {
          message = data.error;
        }
        throw new Error(message);
      }
      await withStorageWriteLock(async () => {
        const latest = await getState();
        await chrome.storage.local.set({
          eyeUploadQueue: latest.eyeUploadQueue.filter((b) => b.batchId !== batch.batchId),
          lastUploadAt:Date.now(),lastUploadError:null
        });
      });
    } catch(error) {
      await chrome.storage.local.set({lastUploadError:`시선 업로드 실패: ${error?.message || error}`});
      return {success:false,error:String(error?.message || error)};
    }
  }
}

// Receive only UXDS-prefixed commands. Eye's versioned protocol remains separate.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "UXDS_ARM_COLLECTION" && message?.type !== "UXDS_DISARM_COLLECTION") return false;
  const task = message.type === "UXDS_ARM_COLLECTION"
    ? uxdsArmCollection()
    : patchState({uxdsArmed:false}).then((state) => ({success:true,...toPublicState(state)}));
  void task.then(sendResponse).catch((e) => sendResponse({success:false,error:String(e)}));
  return true;
});
