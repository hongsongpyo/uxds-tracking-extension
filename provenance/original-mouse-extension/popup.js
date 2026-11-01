// extension/popup.js

const projectStatusElement = document.getElementById("project-status");
const projectInputView = document.getElementById("project-input-view");
const projectConnectedView = document.getElementById("project-connected-view");
const projectIdInput = document.getElementById("project-id-input");
const connectProjectButton = document.getElementById("connect-project-btn");
const disconnectProjectButton = document.getElementById("disconnect-project-btn");
const copyProjectIdButton = document.getElementById("copy-project-id-btn");
const projectNameElement = document.getElementById("project-name");
const connectedProjectIdElement = document.getElementById("connected-project-id");
const projectMessageElement = document.getElementById("project-message");

const statusElement = document.getElementById("tracking-status");
const sessionIdElement = document.getElementById("session-id");
const uploadStatusElement = document.getElementById("upload-status");
const uploadDetailElement = document.getElementById("upload-detail");
const retryUploadButton = document.getElementById("retry-upload-btn");
const startButton = document.getElementById("start-btn");
const stopButton = document.getElementById("stop-btn");
const trackingGuideElement = document.getElementById("tracking-guide");

let currentState = {
  isTracking: false,
  sessionId: null,
  projectId: null,
  projectName: null,
  pendingUploadEventCount: 0,
  lastUploadAt: null,
  lastUploadError: null
};

function setProjectMessage(message = "", type = "") {
  projectMessageElement.textContent = message;
  projectMessageElement.classList.remove("error", "success");

  if (type) {
    projectMessageElement.classList.add(type);
  }
}

function setProjectActionLoading(isLoading) {
  connectProjectButton.disabled = isLoading || currentState.isTracking;
  disconnectProjectButton.disabled = isLoading || currentState.isTracking;
  projectIdInput.disabled = isLoading || currentState.isTracking;
  connectProjectButton.textContent = isLoading ? "확인 중" : "연결";
}

function formatLastUpload(timestamp) {
  if (!timestamp) {
    return null;
  }

  try {
    return new Date(timestamp).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return null;
  }
}

function updateUploadUI() {
  const pendingCount = Number(currentState.pendingUploadEventCount || 0);
  const hasError = Boolean(currentState.lastUploadError);
  const lastUpload = formatLastUpload(currentState.lastUploadAt);

  uploadStatusElement.classList.remove("upload-ok", "upload-waiting", "upload-error");

  if (pendingCount > 0 && hasError) {
    uploadStatusElement.textContent = `대기 ${pendingCount}건`;
    uploadStatusElement.classList.add("upload-error");
    uploadDetailElement.hidden = false;
    uploadDetailElement.textContent = currentState.lastUploadError;
    retryUploadButton.hidden = false;
    return;
  }

  if (pendingCount > 0) {
    uploadStatusElement.textContent = `전송 중 ${pendingCount}건`;
    uploadStatusElement.classList.add("upload-waiting");
    uploadDetailElement.hidden = false;
    uploadDetailElement.textContent = "데이터를 UXDS 서버로 전송하고 있습니다.";
    retryUploadButton.hidden = true;
    return;
  }

  uploadStatusElement.textContent = "정상";
  uploadStatusElement.classList.add("upload-ok");
  uploadDetailElement.hidden = !lastUpload;
  uploadDetailElement.textContent = lastUpload ? `최근 전송 ${lastUpload}` : "";
  retryUploadButton.hidden = true;
}

function updateUI(state) {
  currentState = {
    ...currentState,
    ...state
  };

  const isConnected = Boolean(currentState.projectId);
  const hasPendingUploads = Number(currentState.pendingUploadEventCount || 0) > 0;

  projectStatusElement.textContent = isConnected ? "연결됨" : "미연결";
  projectStatusElement.classList.toggle("connected", isConnected);
  projectStatusElement.classList.toggle("disconnected", !isConnected);

  projectInputView.hidden = isConnected;
  projectConnectedView.hidden = !isConnected;

  if (isConnected) {
    projectNameElement.textContent = currentState.projectName || "이름 없는 프로젝트";
    connectedProjectIdElement.textContent = currentState.projectId;
  } else {
    projectNameElement.textContent = "-";
    connectedProjectIdElement.textContent = "-";
  }

  if (currentState.isTracking) {
    statusElement.textContent = "ON";
    statusElement.classList.remove("status-off");
    statusElement.classList.add("status-on");
    sessionIdElement.textContent = currentState.sessionId || "없음";
    sessionIdElement.title = currentState.sessionId || "";
  } else {
    statusElement.textContent = "OFF";
    statusElement.classList.remove("status-on");
    statusElement.classList.add("status-off");
    sessionIdElement.textContent = "없음";
    sessionIdElement.title = "";
  }

  startButton.disabled = currentState.isTracking || !isConnected;
  stopButton.disabled = !currentState.isTracking;

  connectProjectButton.disabled = currentState.isTracking;
  disconnectProjectButton.disabled = currentState.isTracking || hasPendingUploads;
  projectIdInput.disabled = currentState.isTracking;

  if (!isConnected) {
    trackingGuideElement.textContent = "먼저 UXDS Project ID를 연결하세요.";
  } else if (currentState.isTracking) {
    trackingGuideElement.textContent = `${currentState.projectName || "프로젝트"}에 행동 데이터를 수집 중입니다.`;
  } else if (hasPendingUploads) {
    trackingGuideElement.textContent = "수집은 중지되었지만 일부 데이터가 서버 전송 대기 중입니다.";
  } else {
    trackingGuideElement.textContent = "수집 데이터는 로컬 Flask 없이 UXDS 서버로 직접 저장됩니다.";
  }

  updateUploadUI();
}

async function sendRuntimeMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.error("[popup] 메시지 전송 오류:", error);
    return {
      success: false,
      error: error.message || "확장프로그램 내부 통신 중 오류가 발생했습니다."
    };
  }
}

async function loadState() {
  const response = await sendRuntimeMessage({ type: "GET_TRACKING_STATE" });

  if (!response?.success) {
    setProjectMessage(response?.error || "상태를 불러오지 못했습니다.", "error");
    updateUI({
      isTracking: false,
      sessionId: null,
      projectId: null,
      projectName: null,
      pendingUploadEventCount: 0
    });
    return;
  }

  updateUI(response);
}

async function handleConnectProject() {
  const projectId = projectIdInput.value.trim().toLowerCase();
  setProjectMessage();

  if (!projectId) {
    setProjectMessage("Project ID를 입력하세요.", "error");
    projectIdInput.focus();
    return;
  }

  if (!/^prj_[0-9a-f]{12}$/.test(projectId)) {
    setProjectMessage("Project ID 형식이 올바르지 않습니다. 예: prj_42cb9ad1e597", "error");
    projectIdInput.focus();
    return;
  }

  setProjectActionLoading(true);

  const response = await sendRuntimeMessage({
    type: "CONNECT_PROJECT",
    projectId
  });

  setProjectActionLoading(false);

  if (!response?.success) {
    setProjectMessage(response?.error || "프로젝트 연결에 실패했습니다.", "error");
    return;
  }

  projectIdInput.value = "";
  setProjectMessage("프로젝트 연결이 완료되었습니다.", "success");
  updateUI(response);
}

async function handleDisconnectProject() {
  setProjectMessage();

  const response = await sendRuntimeMessage({ type: "DISCONNECT_PROJECT" });

  if (!response?.success) {
    setProjectMessage(response?.error || "프로젝트 연결 해제에 실패했습니다.", "error");
    return;
  }

  setProjectMessage("프로젝트 연결을 해제했습니다.", "success");
  updateUI(response);
}

async function handleCopyProjectId() {
  if (!currentState.projectId) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentState.projectId);
    setProjectMessage("Project ID를 복사했습니다.", "success");
  } catch (error) {
    console.error("[popup] Project ID 복사 실패:", error);
    setProjectMessage("Project ID를 복사하지 못했습니다.", "error");
  }
}

async function handleStartTracking() {
  setProjectMessage();

  const response = await sendRuntimeMessage({ type: "START_TRACKING" });

  if (!response?.success) {
    setProjectMessage(response?.error || "수집을 시작하지 못했습니다.", "error");
    return;
  }

  updateUI(response);
}

async function handleStopTracking() {
  const response = await sendRuntimeMessage({ type: "STOP_TRACKING" });

  if (!response?.success) {
    setProjectMessage(response?.error || "수집을 중지하지 못했습니다.", "error");
    return;
  }

  updateUI(response);
}

async function handleRetryUpload() {
  retryUploadButton.disabled = true;
  retryUploadButton.textContent = "재전송 중";

  const response = await sendRuntimeMessage({ type: "RETRY_PENDING_UPLOADS" });

  retryUploadButton.disabled = false;
  retryUploadButton.textContent = "지금 다시 전송";

  if (!response?.success && response?.error) {
    setProjectMessage(response.error, "error");
  }

  updateUI(response || {});
}

projectIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleConnectProject();
  }
});

connectProjectButton.addEventListener("click", handleConnectProject);
disconnectProjectButton.addEventListener("click", handleDisconnectProject);
copyProjectIdButton.addEventListener("click", handleCopyProjectId);
startButton.addEventListener("click", handleStartTracking);
stopButton.addEventListener("click", handleStopTracking);
retryUploadButton.addEventListener("click", handleRetryUpload);

document.addEventListener("DOMContentLoaded", loadState);
