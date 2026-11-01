# server/services/visualization_service.py

import json
import os
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

from utils.file_utils import ensure_directory

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

LOGS_DIR = os.path.join(BASE_DIR, "logs")
SESSIONS_DIR = os.path.join(LOGS_DIR, "sessions")

OUTPUT_DIR = os.path.join(BASE_DIR, "output")
HEATMAP_DIR = os.path.join(OUTPUT_DIR, "heatmaps")
SCANPATH_DIR = os.path.join(OUTPUT_DIR, "scanpaths")
BACKGROUND_DIR = os.path.join(OUTPUT_DIR, "backgrounds")


def generate_heatmap(session_id: str) -> Dict[str, Any]:
    """
    특정 세션의 로그를 기반으로 heatmap 이미지를 생성한다.
    배경 이미지가 있으면 그 위에 오버레이하고,
    없으면 밝은 배경 위에 heatmap을 그린다.
    """
    if not session_id:
        raise ValueError("session_id가 필요합니다.")

    events = _load_session_events(session_id)
    points, click_points, document_width, document_height = _extract_points(events)

    if not points:
        raise ValueError("Heatmap을 생성할 유효한 좌표 데이터가 없습니다.")

    ensure_directory(HEATMAP_DIR)

    output_file = os.path.join(HEATMAP_DIR, f"{session_id}_heatmap.png")

    effective_width, effective_height = _get_effective_canvas_size(
        points=points,
        click_points=click_points,
        document_width=document_width,
        document_height=document_height
    )

    figure_width, figure_height = _calculate_figure_size(effective_width, effective_height)

    fig, ax = plt.subplots(figsize=(figure_width, figure_height), facecolor="white")
    ax.set_facecolor("#fafafa")

    # 배경 이미지가 있으면 표시
    background_path = os.path.join(BACKGROUND_DIR, f"{session_id}.png")
    if os.path.exists(background_path):
        background_img = plt.imread(background_path)
        ax.imshow(
            background_img,
            extent=[0, effective_width, effective_height, 0],
            aspect="auto",
            alpha=1.0
        )

    # 좌표 분리
    x_values = np.array([point[0] for point in points], dtype=float)
    y_values = np.array([point[1] for point in points], dtype=float)

    # heatmap histogram 생성
    x_bins = max(20, min(140, effective_width // 18 if effective_width else 60))
    y_bins = max(20, min(240, effective_height // 30 if effective_height else 100))

    heatmap, xedges, yedges = np.histogram2d(
        x_values,
        y_values,
        bins=[x_bins, y_bins],
        range=[[0, effective_width], [0, effective_height]]
    )

    # 너무 각진 느낌을 줄이기 위한 간단한 smoothing
    heatmap = _smooth_heatmap(heatmap, iterations=2)

    # 값이 0인 부분은 투명하게 처리
    masked_heatmap = np.ma.masked_where(heatmap <= 0, heatmap)

    ax.imshow(
        masked_heatmap.T,
        extent=[0, effective_width, effective_height, 0],
        origin="upper",
        cmap="hot",
        alpha=0.72,
        aspect="auto",
        interpolation="bilinear"
    )

    # 클릭 포인트 강조
    if click_points:
        click_x = [point[0] for point in click_points]
        click_y = [point[1] for point in click_points]
        ax.scatter(
            click_x,
            click_y,
            s=28,
            facecolors="none",
            edgecolors="white",
            linewidths=0.9,
            alpha=0.9
        )

    ax.set_title(f"Heatmap - {session_id}", fontsize=11, pad=10)
    ax.set_xlim(0, effective_width)
    ax.set_ylim(effective_height, 0)

    # 시각적으로 더 깔끔하게 축 단순화
    ax.set_xlabel("X", fontsize=9)
    ax.set_ylabel("Y", fontsize=9)
    ax.tick_params(axis="both", labelsize=8)

    fig.tight_layout()
    fig.savefig(output_file, dpi=180, facecolor=fig.get_facecolor())
    plt.close(fig)

    return {
        "output_file": _to_relative_path(output_file),
        "point_count": len(points),
        "click_count": len(click_points),
        "canvas_width": effective_width,
        "canvas_height": effective_height
    }


def generate_scanpath(session_id: str) -> Dict[str, Any]:
    """
    특정 세션의 로그를 기반으로 scanpath 이미지를 생성한다.
    """
    if not session_id:
        raise ValueError("session_id가 필요합니다.")

    events = _load_session_events(session_id)
    points, click_points, document_width, document_height = _extract_points(events)

    if not points:
        raise ValueError("Scanpath를 생성할 유효한 좌표 데이터가 없습니다.")

    ensure_directory(SCANPATH_DIR)

    output_file = os.path.join(SCANPATH_DIR, f"{session_id}_scanpath.png")

    effective_width, effective_height = _get_effective_canvas_size(
        points=points,
        click_points=click_points,
        document_width=document_width,
        document_height=document_height
    )

    figure_width, figure_height = _calculate_figure_size(effective_width, effective_height)

    fig, ax = plt.subplots(figsize=(figure_width, figure_height), facecolor="white")
    ax.set_facecolor("#fafafa")

    background_path = os.path.join(BACKGROUND_DIR, f"{session_id}.png")
    if os.path.exists(background_path):
        background_img = plt.imread(background_path)
        ax.imshow(
            background_img,
            extent=[0, effective_width, effective_height, 0],
            aspect="auto",
            alpha=1.0
        )

    x_values = [point[0] for point in points]
    y_values = [point[1] for point in points]

    ax.plot(
        x_values,
        y_values,
        linewidth=1.4,
        marker="o",
        markersize=2.8,
        alpha=0.9
    )

    ax.annotate("Start", (x_values[0], y_values[0]), fontsize=8)
    ax.annotate("End", (x_values[-1], y_values[-1]), fontsize=8)

    if click_points:
        click_x = [point[0] for point in click_points]
        click_y = [point[1] for point in click_points]
        ax.scatter(
            click_x,
            click_y,
            s=30,
            facecolors="none",
            edgecolors="red",
            linewidths=1.0
        )

    ax.set_title(f"Scanpath - {session_id}", fontsize=11, pad=10)
    ax.set_xlim(0, effective_width)
    ax.set_ylim(effective_height, 0)
    ax.set_xlabel("X", fontsize=9)
    ax.set_ylabel("Y", fontsize=9)
    ax.tick_params(axis="both", labelsize=8)

    fig.tight_layout()
    fig.savefig(output_file, dpi=180, facecolor=fig.get_facecolor())
    plt.close(fig)

    return {
        "output_file": _to_relative_path(output_file),
        "point_count": len(points),
        "click_count": len(click_points),
        "canvas_width": effective_width,
        "canvas_height": effective_height
    }


def _load_session_events(session_id: str) -> List[Dict[str, Any]]:
    """
    세션별 JSONL 파일을 읽어서 이벤트 리스트로 반환한다.
    """
    session_file = os.path.join(SESSIONS_DIR, f"{session_id}.jsonl")

    if not os.path.exists(session_file):
        raise FileNotFoundError(f"세션 파일을 찾을 수 없습니다: {session_id}")

    events: List[Dict[str, Any]] = []

    with open(session_file, "r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()

            if not line:
                continue

            try:
                event = json.loads(line)
                if isinstance(event, dict):
                    events.append(event)
            except json.JSONDecodeError:
                continue

    if not events:
        raise ValueError("세션 파일에 유효한 이벤트가 없습니다.")

    events.sort(key=lambda event: event.get("timestamp", 0))
    return events


def _extract_points(
    events: List[Dict[str, Any]]
) -> Tuple[List[Tuple[float, float]], List[Tuple[float, float]], int, int]:
    """
    이벤트 리스트에서 시각화용 좌표를 추출한다.

    사용 이벤트:
    - mousemove
    - click
    """
    points: List[Tuple[float, float]] = []
    click_points: List[Tuple[float, float]] = []

    max_document_width = 0
    max_document_height = 0

    for event in events:
        if not isinstance(event, dict):
            continue

        document_width = _safe_int(event.get("document_width"))
        document_height = _safe_int(event.get("document_height"))

        if document_width > max_document_width:
            max_document_width = document_width

        if document_height > max_document_height:
            max_document_height = document_height

        event_type = event.get("event_type")
        if event_type not in {"mousemove", "click"}:
            continue

        x = _safe_float(event.get("x"))
        y = _safe_float(event.get("y"))

        if x is None or y is None:
            continue

        if x < 0 or y < 0:
            continue

        points.append((x, y))

        if event_type == "click":
            click_points.append((x, y))

    if max_document_width <= 0:
        max_document_width = 1440

    if max_document_height <= 0:
        max_document_height = 3000

    return points, click_points, max_document_width, max_document_height


def _get_effective_canvas_size(
    points: List[Tuple[float, float]],
    click_points: List[Tuple[float, float]],
    document_width: int,
    document_height: int
) -> Tuple[int, int]:
    """
    실제 상호작용이 있었던 영역 중심으로 canvas 크기를 줄인다.
    너무 긴 빈 하단 영역이 나오지 않게 한다.
    """
    if not points:
        return document_width, min(document_height, 3000)

    all_y = [point[1] for point in points]
    max_used_y = max(all_y)

    margin = 800
    effective_height = int(min(document_height, max_used_y + margin))
    effective_height = max(effective_height, 1200)

    return document_width, effective_height


def _smooth_heatmap(heatmap: np.ndarray, iterations: int = 1) -> np.ndarray:
    """
    scipy 없이 간단한 평균 커널로 heatmap을 부드럽게 만든다.
    """
    kernel = np.array([
        [1, 2, 1],
        [2, 4, 2],
        [1, 2, 1]
    ], dtype=float)
    kernel = kernel / kernel.sum()

    result = heatmap.astype(float)

    for _ in range(iterations):
        padded = np.pad(result, ((1, 1), (1, 1)), mode="edge")
        smoothed = np.zeros_like(result, dtype=float)

        for row in range(result.shape[0]):
            for col in range(result.shape[1]):
                region = padded[row:row + 3, col:col + 3]
                smoothed[row, col] = np.sum(region * kernel)

        result = smoothed

    return result


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int:
    try:
        if value is None:
            return 0
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _calculate_figure_size(document_width: int, document_height: int) -> Tuple[float, float]:
    """
    문서 비율에 따라 matplotlib figure 크기를 계산한다.
    """
    safe_width = max(1, document_width)
    safe_height = max(1, document_height)

    base_width = 8.0
    ratio = safe_height / safe_width
    calculated_height = base_width * ratio

    figure_height = min(max(calculated_height, 6.5), 20.0)

    return base_width, figure_height


def _to_relative_path(absolute_path: str) -> str:
    return os.path.relpath(absolute_path, BASE_DIR)