# server/services/event_service.py

import os
import re
import threading
from typing import Any, Dict, List

from utils.file_utils import (
    ensure_directory,
    merge_jsonl_sorted_by_timestamp,
)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS_DIR = os.path.join(BASE_DIR, "logs")
SESSIONS_DIR = os.path.join(LOGS_DIR, "sessions")
ALL_EVENTS_FILE = os.path.join(LOGS_DIR, "events.jsonl")
PROJECT_ID_PATTERN = re.compile(r"^prj_[0-9a-f]{12}$")

# Flask가 여러 탭의 요청을 동시에 처리할 때 JSONL read/merge/write가 서로 겹치지 않게 한다.
_FILE_WRITE_LOCK = threading.RLock()


def save_event_batch(
    project_id: str,
    session_id: str,
    events: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    이벤트 배치를 전체 로그 파일과 세션별 로그 파일에 저장한다.

    핵심 규칙:
    1. project_id/session_id는 배치 메타데이터를 기준으로 서버에서 덮어쓴다.
    2. page_view_id는 content script가 생성한 값을 보존한다.
    3. JSONL 행 순서는 요청 도착 순서가 아니라 timestamp 오름차순으로 정렬한다.

    기존 heatmap/scanpath 코드와의 호환성을 위해 세션 파일 경로는
    logs/sessions/{session_id}.jsonl 형식을 유지한다.
    """
    if not project_id or not PROJECT_ID_PATTERN.match(project_id):
        raise ValueError("유효한 project_id가 필요합니다.")

    if not session_id:
        raise ValueError("session_id는 비어 있을 수 없습니다.")

    if not isinstance(events, list):
        raise TypeError("events는 리스트 형식이어야 합니다.")

    ensure_directory(LOGS_DIR)
    ensure_directory(SESSIONS_DIR)

    normalized_events = []

    for event in events:
        if not isinstance(event, dict):
            continue

        normalized_event = dict(event)
        normalized_event["project_id"] = project_id
        normalized_event["session_id"] = session_id
        normalized_events.append(normalized_event)

    session_file_path = os.path.join(SESSIONS_DIR, f"{session_id}.jsonl")

    if not normalized_events:
        return {
            "saved_count": 0,
            "all_events_file": _to_relative_path(ALL_EVENTS_FILE),
            "session_file": _to_relative_path(session_file_path)
        }

    # 탭 A/B의 batch arrival order가 뒤섞여도 최종 파일은 timestamp 기준으로 정렬한다.
    with _FILE_WRITE_LOCK:
        merge_jsonl_sorted_by_timestamp(ALL_EVENTS_FILE, normalized_events)
        merge_jsonl_sorted_by_timestamp(session_file_path, normalized_events)

    return {
        "saved_count": len(normalized_events),
        "all_events_file": _to_relative_path(ALL_EVENTS_FILE),
        "session_file": _to_relative_path(session_file_path)
    }


def _to_relative_path(absolute_path: str) -> str:
    return os.path.relpath(absolute_path, BASE_DIR)
