// extension/content.js

const EVENT_BATCH_SIZE = 25;
const MOUSEMOVE_THROTTLE_MS = 50;
const SCROLL_THROTTLE_MS = 75;
const PERIODIC_FLUSH_MS = 1000;
const MAX_QUEUE_SIZE = 5000;

let isTracking = false;
let sessionId = null;
let projectId = null;
let pageViewId = null;
let pageViewEnded = false;
let pageSequenceNo = 0;
let eventQueue = [];
let isFlushing = false;

let lastClientX = null;
let lastClientY = null;

function generatePageViewId() {
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `pv_${Date.now()}_${randomPart}`;
}

function generateEventId(eventType) {
  if (typeof crypto?.randomUUID === "function") {
    return `${eventType}_${crypto.randomUUID()}`;
  }

  return `${eventType}_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}

function throttle(callback, delay) {
  let lastCall = 0;

  return function (...args) {
    const now = Date.now();

    if (now - lastCall >= delay) {
      lastCall = now;
      callback.apply(this, args);
    }
  };
}

function getPageMetadata() {
  return {
    page_url: window.location.href,
    page_title: document.title,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    document_width: Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0
    ),
    document_height: Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ),
    scroll_x: window.scrollX,
    scroll_y: window.scrollY
  };
}

function getAbsolutePosition(clientX, clientY) {
  if (clientX === null || clientY === null) {
    return {
      x: null,
      y: null
    };
  }

  return {
    x: window.scrollX + clientX,
    y: window.scrollY + clientY
  };
}

function updateLastMousePosition(event) {
  lastClientX = event.clientX;
  lastClientY = event.clientY;
}

function getElementInfo(target) {
  if (!target || !(target instanceof Element)) {
    return {
      tag_name: null,
      id: null,
      class_name: null
    };
  }

  return {
    tag_name: target.tagName || null,
    id: target.id || null,
    class_name:
      typeof target.className === "string" ? target.className : null
  };
}

function buildEvent(eventType, data = {}) {
  pageSequenceNo += 1;

  return {
    event_id: generateEventId(eventType),
    project_id: projectId,
    session_id: sessionId,
    page_view_id: pageViewId,
    event_type: eventType,
    sequence_no: pageSequenceNo,
    timestamp: Date.now(),
    ...getPageMetadata(),
    ...data
  };
}

function enqueueEvent(event) {
  if (!isTracking || !sessionId || !projectId) {
    return;
  }

  eventQueue.push(event);

  if (eventQueue.length > MAX_QUEUE_SIZE) {
    const overflowCount = eventQueue.length - MAX_QUEUE_SIZE;
    eventQueue.splice(0, overflowCount);
    console.warn(`[content] 이벤트 큐가 한도를 초과해 오래된 ${overflowCount}개 이벤트를 제거했습니다.`);
  }

  if (eventQueue.length >= EVENT_BATCH_SIZE) {
    void flushEvents();
  }
}

async function flushEvents() {
  if (
    isFlushing ||
    eventQueue.length === 0 ||
    !sessionId ||
    !projectId
  ) {
    return;
  }

  isFlushing = true;
  const batch = eventQueue.slice(0, EVENT_BATCH_SIZE);

  const payload = {
    project_id: projectId,
    session_id: sessionId,
    events: batch
  };

  try {
    const response = await chrome.runtime.sendMessage({
      type: "QUEUE_EVENTS_FOR_UPLOAD",
      payload
    });

    if (!response?.success) {
      console.error("[content] 이벤트 전송 실패:", response?.error);
      return;
    }

    // background의 영속 outbox에 저장된 이벤트만 content queue에서 제거한다.
    eventQueue.splice(0, batch.length);
  } catch (error) {
    console.error("[content] background 전송 오류:", error);
  } finally {
    isFlushing = false;

    if (eventQueue.length >= EVENT_BATCH_SIZE) {
      void flushEvents();
    }
  }
}

function startTracking(newSessionId, newProjectId) {
  if (!newSessionId || !newProjectId) {
    console.error("[content] sessionId 또는 projectId가 없어 수집을 시작할 수 없습니다.");
    return;
  }

  if (
    isTracking &&
    sessionId === newSessionId &&
    projectId === newProjectId
  ) {
    return;
  }

  // 다른 세션이 이미 동작 중이라면 섞이지 않도록 큐를 비운다.
  if (isTracking && sessionId !== newSessionId) {
    eventQueue = [];
  }

  isTracking = true;
  sessionId = newSessionId;
  projectId = newProjectId;
  pageViewId = generatePageViewId();
  pageViewEnded = false;
  pageSequenceNo = 0;

  console.log(
    `[content] Page view started: ${pageViewId} / session=${sessionId} / project=${projectId}`
  );

  enqueueEvent(
    buildEvent("page_view_start", {
      x: null,
      y: null,
      client_x: null,
      client_y: null
    })
  );
}

async function endCurrentPageView(reason) {
  if (!isTracking || !pageViewId || pageViewEnded) {
    return;
  }

  const absolutePosition = getAbsolutePosition(lastClientX, lastClientY);

  pageViewEnded = true;

  enqueueEvent(
    buildEvent("page_view_end", {
      x: absolutePosition.x,
      y: absolutePosition.y,
      client_x: lastClientX,
      client_y: lastClientY,
      end_reason: reason
    })
  );

  await flushAllQueuedEvents();
}

async function flushAllQueuedEvents() {
  while (eventQueue.length > 0) {
    const before = eventQueue.length;
    await flushEvents();

    if (eventQueue.length >= before) {
      // background outbox 저장에 실패한 경우 무한 반복을 막는다.
      break;
    }
  }
}

async function stopTracking() {
  if (!isTracking) {
    return;
  }

  await endCurrentPageView("tracking_stopped");

  console.log(`[content] Tracking stopped: ${sessionId}`);

  isTracking = false;
  sessionId = null;
  projectId = null;
  pageViewId = null;
  pageViewEnded = false;
  pageSequenceNo = 0;
  eventQueue = [];
}

const handleMouseMove = throttle((event) => {
  if (!isTracking) {
    return;
  }

  updateLastMousePosition(event);

  const absolutePosition = getAbsolutePosition(event.clientX, event.clientY);

  enqueueEvent(
    buildEvent("mousemove", {
      x: absolutePosition.x,
      y: absolutePosition.y,
      client_x: event.clientX,
      client_y: event.clientY,
      movement_x: event.movementX,
      movement_y: event.movementY
    })
  );
}, MOUSEMOVE_THROTTLE_MS);

function handleClick(event) {
  if (!isTracking) {
    return;
  }

  updateLastMousePosition(event);

  const elementInfo = getElementInfo(event.target);
  const absolutePosition = getAbsolutePosition(event.clientX, event.clientY);

  enqueueEvent(
    buildEvent("click", {
      x: absolutePosition.x,
      y: absolutePosition.y,
      client_x: event.clientX,
      client_y: event.clientY,
      button: event.button,
      ...elementInfo
    })
  );
}

const handleScroll = throttle(() => {
  if (!isTracking) {
    return;
  }

  const absolutePosition = getAbsolutePosition(lastClientX, lastClientY);

  enqueueEvent(
    buildEvent("scroll", {
      x: absolutePosition.x,
      y: absolutePosition.y,
      client_x: lastClientX,
      client_y: lastClientY
    })
  );
}, SCROLL_THROTTLE_MS);

function handleResize() {
  if (!isTracking) {
    return;
  }

  const absolutePosition = getAbsolutePosition(lastClientX, lastClientY);

  enqueueEvent(
    buildEvent("resize", {
      x: absolutePosition.x,
      y: absolutePosition.y,
      client_x: lastClientX,
      client_y: lastClientY
    })
  );
}

function handlePageHide() {
  if (!isTracking) {
    return;
  }

  void endCurrentPageView("page_hide");
}

// Capture-phase listeners are used intentionally. Some modern sites stop
// propagation in their own UI layers; listening at window/document capture
// keeps UXDS tracking independent from site event handlers.
if ("PointerEvent" in window) {
  window.addEventListener("pointermove", handleMouseMove, {
    capture: true,
    passive: true
  });
} else {
  window.addEventListener("mousemove", handleMouseMove, {
    capture: true,
    passive: true
  });
}

window.addEventListener("click", handleClick, { capture: true });

// scroll does not reliably bubble from nested scroll containers. Capture it
// from document as well as the top-level viewport. The shared throttle avoids
// duplicate events when both listeners observe the same scroll action.
document.addEventListener("scroll", handleScroll, {
  capture: true,
  passive: true
});
window.addEventListener("scroll", handleScroll, {
  capture: true,
  passive: true
});

window.addEventListener("resize", handleResize);
window.addEventListener("pagehide", handlePageHide);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && isTracking) {
    // Flush while the document is still alive. This materially reduces data
    // loss during fast navigation/tab changes compared with waiting for
    // pagehide alone.
    void flushAllQueuedEvents();
  }
});

setInterval(() => {
  void flushEvents();
}, PERIODIC_FLUSH_MS);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "START_TRACKING":
          startTracking(message.sessionId, message.projectId);
          sendResponse({
            success: true,
            message: "content script tracking started",
            sessionId,
            projectId
          });
          break;

        case "STOP_TRACKING":
          await stopTracking();
          sendResponse({
            success: true,
            message: "content script tracking stopped"
          });
          break;

        case "PING":
          sendResponse({
            success: true,
            message: "content script is alive",
            isTracking,
            sessionId,
            projectId,
            pageViewId
          });
          break;

        default:
          sendResponse({
            success: false,
            error: `지원하지 않는 메시지 타입입니다: ${message.type}`
          });
      }
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message || "content.js 처리 중 오류가 발생했습니다."
      });
    }
  })();

  return true;
});

// 같은 탭의 페이지 이동이나 tracked tab에서 열린 새 탭에서도
// background의 현재 세션 상태를 확인해 수집을 복원한다.
(async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "CONTENT_READY" });

    if (
      response?.success &&
      response.shouldTrack &&
      response.sessionId &&
      response.projectId
    ) {
      startTracking(response.sessionId, response.projectId);
    }
  } catch (error) {
    console.warn("[content] 초기 tracking 상태 동기화 실패:", error);
  }
})();
