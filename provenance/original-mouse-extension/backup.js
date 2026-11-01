// extension/content.js

const EVENT_BATCH_SIZE = 50;
const MOUSEMOVE_THROTTLE_MS = 50;
const SCROLL_THROTTLE_MS = 75;

let isTracking = false;
let sessionId = null;
let eventQueue = [];

// 마지막 마우스 위치 저장
let lastClientX = null;
let lastClientY = null;

/**
 * 마지막 실행 시점을 기억하는 throttle 함수
 */
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

/**
 * 현재 페이지 메타데이터 수집
 */
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

/**
 * 화면 기준 좌표를 문서 전체 기준 절대 좌표로 변환
 */
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

/**
 * 마지막 마우스 위치 갱신
 */
function updateLastMousePosition(event) {
  lastClientX = event.clientX;
  lastClientY = event.clientY;
}

/**
 * DOM 요소 정보 요약
 */
function getElementInfo(target) {
  if (!target) {
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

/**
 * 이벤트 객체 생성
 */
function buildEvent(eventType, data = {}) {
  return {
    session_id: sessionId,
    event_type: eventType,
    timestamp: Date.now(),
    ...getPageMetadata(),
    ...data
  };
}

/**
 * 큐에 이벤트 추가
 */
function enqueueEvent(event) {
  if (!isTracking || !sessionId) {
    return;
  }

  eventQueue.push(event);

  if (eventQueue.length >= EVENT_BATCH_SIZE) {
    flushEvents();
  }
}

/**
 * background.js로 이벤트 전송
 */
async function flushEvents() {
  if (!eventQueue.length || !sessionId) {
    return;
  }

  const payload = {
    session_id: sessionId,
    events: [...eventQueue]
  };

  eventQueue = [];

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FORWARD_EVENTS_TO_SERVER",
      payload
    });

    if (!response?.success) {
      console.error("[content] 이벤트 전송 실패:", response?.error);
    }
  } catch (error) {
    console.error("[content] background 전송 오류:", error);
  }
}

/**
 * tracking 시작
 */
function startTracking(newSessionId) {
  if (isTracking) {
    return;
  }

  isTracking = true;
  sessionId = newSessionId;

  console.log(`[content] Tracking started: ${sessionId}`);

  enqueueEvent(
    buildEvent("session_start", {
      x: null,
      y: null,
      client_x: null,
      client_y: null
    })
  );
}

/**
 * tracking 종료
 */
async function stopTracking() {
  if (!isTracking) {
    return;
  }

  enqueueEvent(
    buildEvent("session_end", {
      x: null,
      y: null,
      client_x: null,
      client_y: null
    })
  );

  await flushEvents();

  console.log(`[content] Tracking stopped: ${sessionId}`);

  isTracking = false;
  sessionId = null;
}

/**
 * mousemove 이벤트 처리
 * x, y는 문서 전체 기준 절대 좌표
 * client_x, client_y는 현재 화면 기준 좌표
 */
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

/**
 * click 이벤트 처리
 * x, y는 문서 전체 기준 절대 좌표
 */
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

/**
 * scroll 이벤트 처리
 * scroll 자체에는 마우스 좌표가 없으므로,
 * 마지막으로 기록된 client_x/client_y를 현재 scroll_x/scroll_y와 합쳐
 * 문서 전체 기준 x, y를 계산한다.
 */
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

/**
 * resize 이벤트 처리
 */
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

/**
 * 페이지 이탈 직전 마지막 전송
 */
async function handleBeforeUnload() {
  if (!isTracking) {
    return;
  }

  const absolutePosition = getAbsolutePosition(lastClientX, lastClientY);

  enqueueEvent(
    buildEvent("page_unload", {
      x: absolutePosition.x,
      y: absolutePosition.y,
      client_x: lastClientX,
      client_y: lastClientY
    })
  );

  await flushEvents();
}

/**
 * 이벤트 리스너 등록
 */
document.addEventListener("mousemove", handleMouseMove, { passive: true });
document.addEventListener("click", handleClick, true);
window.addEventListener("scroll", handleScroll, { passive: true });
window.addEventListener("resize", handleResize);
window.addEventListener("beforeunload", handleBeforeUnload);

// 10초마다 남은 이벤트 전송
setInterval(() => {
  flushEvents();
}, 10000);

/**
 * background.js 또는 popup.js에서 오는 메시지 처리
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "START_TRACKING":
          startTracking(message.sessionId);
          sendResponse({
            success: true,
            message: "content script tracking started",
            sessionId
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
            message: "content script is alive"
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

/**
 * 확장프로그램 새로고침/페이지 재진입 시 storage 상태 복구
 */
(async function restoreTrackingState() {
  try {
    const result = await chrome.storage.local.get(["isTracking", "sessionId"]);

    if (result.isTracking && result.sessionId) {
      isTracking = true;
      sessionId = result.sessionId;

      console.log(`[content] Tracking state restored: ${sessionId}`);

      enqueueEvent(
        buildEvent("page_enter", {
          x: null,
          y: null,
          client_x: null,
          client_y: null
        })
      );
    }
  } catch (error) {
    console.error("[content] tracking state restore 실패:", error);
  }
})();