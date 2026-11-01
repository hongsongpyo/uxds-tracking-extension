# server/utils/file_utils.py

import json
import os
import tempfile
from typing import Any, Dict, List


def ensure_directory(path: str) -> None:
    """
    지정한 디렉토리가 존재하지 않으면 생성한다.
    """
    if not path:
        raise ValueError("디렉토리 경로가 비어 있습니다.")

    os.makedirs(path, exist_ok=True)


def append_jsonl(file_path: str, rows: List[Dict[str, Any]]) -> None:
    """
    딕셔너리 리스트를 JSONL 형식으로 파일 끝에 추가 저장한다.
    """
    if not file_path:
        raise ValueError("파일 경로가 비어 있습니다.")

    if not isinstance(rows, list):
        raise TypeError("rows는 리스트 형식이어야 합니다.")

    parent_dir = os.path.dirname(file_path)
    if parent_dir:
        ensure_directory(parent_dir)

    with open(file_path, "a", encoding="utf-8") as file:
        for row in rows:
            if not isinstance(row, dict):
                continue

            json_line = json.dumps(row, ensure_ascii=False)
            file.write(json_line + "\n")


def read_jsonl(file_path: str) -> List[Dict[str, Any]]:
    """
    JSONL 파일을 딕셔너리 리스트로 읽는다.
    파일이 없으면 빈 리스트를 반환한다.
    """
    if not file_path:
        raise ValueError("파일 경로가 비어 있습니다.")

    if not os.path.exists(file_path):
        return []

    rows: List[Dict[str, Any]] = []

    with open(file_path, "r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue

            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue

            if isinstance(row, dict):
                rows.append(row)

    return rows


def write_jsonl_atomic(file_path: str, rows: List[Dict[str, Any]]) -> None:
    """
    JSONL 전체 내용을 임시 파일에 작성한 뒤 원자적으로 교체한다.
    정렬 중 서버가 중단되어 기존 파일이 반쯤 덮이는 것을 방지한다.
    """
    if not file_path:
        raise ValueError("파일 경로가 비어 있습니다.")

    if not isinstance(rows, list):
        raise TypeError("rows는 리스트 형식이어야 합니다.")

    parent_dir = os.path.dirname(file_path)
    if parent_dir:
        ensure_directory(parent_dir)

    fd, temp_path = tempfile.mkstemp(
        prefix=".uxds_jsonl_",
        suffix=".tmp",
        dir=parent_dir or None,
        text=True,
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            for row in rows:
                if not isinstance(row, dict):
                    continue

                file.write(json.dumps(row, ensure_ascii=False) + "\n")

        os.replace(temp_path, file_path)
    except Exception:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def merge_jsonl_sorted_by_timestamp(
    file_path: str,
    new_rows: List[Dict[str, Any]],
) -> None:
    """
    기존 JSONL과 새 이벤트를 합친 뒤 timestamp 오름차순으로 저장한다.

    여러 탭에서 배치가 서로 다른 시점에 도착하더라도 최종 JSONL 행 순서는
    클라이언트 이벤트 timestamp 기준으로 정렬된다.
    """
    if not isinstance(new_rows, list):
        raise TypeError("new_rows는 리스트 형식이어야 합니다.")

    rows = read_jsonl(file_path)
    rows.extend(row for row in new_rows if isinstance(row, dict))
    rows.sort(key=_timestamp_sort_key)
    write_jsonl_atomic(file_path, rows)


def _timestamp_sort_key(row: Dict[str, Any]) -> tuple:
    value = row.get("timestamp")

    try:
        return (0, float(value))
    except (TypeError, ValueError):
        # timestamp가 없는 비정상 행은 뒤쪽으로 보낸다.
        return (1, float("inf"))
