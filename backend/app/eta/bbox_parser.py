"""
에브리타임 시간표 이미지 파싱 — Google Cloud Vision API bbox 기반.

파이프라인:
  Google Vision DOCUMENT_TEXT_DETECTION (text + bbox)
  → 헤더 요일 x좌표 추출
  → 시간 라벨 y좌표 추출
  → 수업 블록 클러스터링
  → 좌표 기반 요일/시간 계산

원칙:
  - LLM 시간/요일 판단 금지
  - 좌표로만 계산
  - requests 만 사용 (추가 SDK 불필요)
"""
from __future__ import annotations

import base64
import logging
import re
from typing import Dict, List, Optional, Tuple

import numpy as np
import requests as _requests

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────────────────

_VISION_URL = "https://vision.googleapis.com/v1/images:annotate"

_HOUR_LABEL_TO_24H: Dict[int, int] = {
    9: 9, 10: 10, 11: 11, 12: 12,
    1: 13, 2: 14, 3: 15, 4: 16,
    5: 17, 6: 18, 7: 19, 8: 20,
}

_KR_DAY_TO_DOW: Dict[str, int] = {
    "월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6,
}


# ── Google Cloud Vision 호출 ─────────────────────────────────────────────────

def _call_google_vision(image_bytes: bytes) -> List[Tuple[int, int, int, int, str]]:
    """
    Google Cloud Vision DOCUMENT_TEXT_DETECTION 호출.

    Returns: [(x0, y0, x1, y1, text), ...] — textAnnotations[1:] 기준
    (textAnnotations[0] = 전체 텍스트 덩어리이므로 스킵)
    """
    api_key = settings.GOOGLE_CLOUD_VISION_API_KEY
    if not api_key:
        raise RuntimeError("GOOGLE_CLOUD_VISION_API_KEY not configured")

    b64 = base64.b64encode(image_bytes).decode()
    payload = {
        "requests": [{
            "image": {"content": b64},
            "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
        }]
    }

    resp = _requests.post(
        _VISION_URL,
        params={"key": api_key},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    error = data.get("responses", [{}])[0].get("error")
    if error:
        raise RuntimeError(f"Vision API error: {error}")

    annotations = data.get("responses", [{}])[0].get("textAnnotations", [])
    items: List[Tuple[int, int, int, int, str]] = []

    for ann in annotations[1:]:          # [0] = 전체 텍스트, 스킵
        text = ann.get("description", "").strip()
        if not text:
            continue
        verts = ann.get("boundingPoly", {}).get("vertices", [])
        if len(verts) < 4:
            continue
        xs = [v.get("x", 0) for v in verts]
        ys = [v.get("y", 0) for v in verts]
        items.append((int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys)), text))

    logger.info("google_vision: %d text items detected", len(items))
    return items


# ── 앵커 추출 ─────────────────────────────────────────────────────────────────

def _extract_day_anchors(
    items: List[Tuple[int, int, int, int, str]],
    img_h: int,
) -> List[Tuple[int, int]]:
    """
    헤더(상단 18%)에서 요일 라벨 → [(dow, x_center), ...] x 기준 오름차순.
    """
    cutoff = img_h * 0.18
    found: Dict[int, List[int]] = {}
    for x0, y0, x1, y1, text in items:
        if (y0 + y1) / 2.0 > cutoff:
            continue
        for ch, dow in _KR_DAY_TO_DOW.items():
            if ch in text and len(text.strip()) <= 4:
                found.setdefault(dow, []).append((x0 + x1) // 2)
                break
    result = [(dow, int(np.mean(xs))) for dow, xs in found.items()]
    result.sort(key=lambda a: a[1])
    logger.debug("day_anchors: %s", result)
    return result


def _extract_time_anchors(
    items: List[Tuple[int, int, int, int, str]],
    img_w: int,
    img_h: int,
) -> List[Tuple[float, int]]:
    """
    거터(좌측 18%)에서 시간 라벨 → [(y_center, hour_24h), ...] y 기준 오름차순.
    같은 hour_24h 중복은 y 평균으로 병합.
    """
    x_cutoff = img_w * 0.18
    y_cutoff = img_h * 0.15
    found: List[Tuple[float, int]] = []

    for x0, y0, x1, y1, text in items:
        if (x0 + x1) / 2.0 > x_cutoff:
            continue
        if (y0 + y1) / 2.0 < y_cutoff:
            continue
        m = re.fullmatch(r'\s*(\d{1,2})\s*', text.strip())
        if not m:
            continue
        n = int(m.group(1))
        if n not in _HOUR_LABEL_TO_24H:
            continue
        found.append(((y0 + y1) / 2.0, _HOUR_LABEL_TO_24H[n]))

    found.sort(key=lambda a: a[0])

    deduped: List[Tuple[float, int]] = []
    for ya, h24 in found:
        if deduped and deduped[-1][1] == h24:
            prev_y, _ = deduped[-1]
            deduped[-1] = ((prev_y + ya) / 2.0, h24)
        else:
            deduped.append((ya, h24))

    logger.debug(
        "time_anchors: %d (first=%s last=%s)",
        len(deduped),
        deduped[0] if deduped else None,
        deduped[-1] if deduped else None,
    )
    return deduped


# ── 격자 경계 빌드 ────────────────────────────────────────────────────────────

def _build_grid_boundaries(
    time_anchors: List[Tuple[float, int]],
) -> List[Tuple[float, str]]:
    """
    time_anchors → 30분 단위 경계 [(y_pixel, "HH:MM"), ...].

    anchor[i] = (y, hour) → :00 라인
    midpoint(i, i+1)      → :30 라인
    """
    if not time_anchors:
        return []

    boundaries: List[Tuple[float, str]] = []
    for i, (ya, ha) in enumerate(time_anchors):
        boundaries.append((ya, f"{ha:02d}:00"))
        if i + 1 < len(time_anchors):
            yb, _ = time_anchors[i + 1]
            boundaries.append(((ya + yb) / 2.0, f"{ha:02d}:30"))

    # 마지막 anchor 뒤 :30
    if len(time_anchors) >= 2:
        y_last, h_last = time_anchors[-1]
        y_prev, _      = time_anchors[-2]
        slot_h = y_last - y_prev
        boundaries.append((y_last + slot_h / 2.0, f"{h_last:02d}:30"))

    return sorted(boundaries, key=lambda b: b[0])


def _snap_time(y: float, boundaries: List[Tuple[float, str]], snap_up: bool) -> str:
    """legacy floor/ceiling — next-block 보정 fallback에서만 사용."""
    if not boundaries:
        return "09:00"
    TOLE = 3.0
    if snap_up:
        for by, bt in boundaries:
            if by >= y - TOLE:
                return bt
        return boundaries[-1][1]
    else:
        result = boundaries[0][1]
        for by, bt in boundaries:
            if by <= y + TOLE:
                result = bt
            else:
                break
        return result


def _boundary_slot_idx(y: float, boundaries: List[Tuple[float, str]]) -> int:
    """y픽셀 → nearest boundary 인덱스."""
    return min(range(len(boundaries)), key=lambda i: abs(boundaries[i][0] - y))


def _boundary_avg_slot_h(boundaries: List[Tuple[float, str]]) -> float:
    if len(boundaries) < 2:
        return 40.0
    return float(np.mean([boundaries[i + 1][0] - boundaries[i][0] for i in range(len(boundaries) - 1)]))


def _slots_from_height(block_h: float, avg_slot_h: float) -> int:
    if avg_slot_h <= 0:
        return 1
    return max(1, int(block_h / avg_slot_h + 0.5))


# ── 블록 클러스터링 ───────────────────────────────────────────────────────────

def _cluster_content_bboxes(
    items: List[Tuple[int, int, int, int, str]],
    img_w: int,
    img_h: int,
) -> List[List[Tuple[int, int, int, int, str]]]:
    """
    헤더/거터 제외 content 아이템 → Union-Find 클러스터링.

    같은 블록 기준:
      - x 범위 겹침 비율 ≥ 40%
      - y 간격 < slot_h (bbox 높이 중간값 × 1.5)
    """
    x_cutoff = img_w * 0.18
    y_cutoff = img_h * 0.18

    content: List[Tuple[int, int, int, int, str]] = [
        (x0, y0, x1, y1, text)
        for x0, y0, x1, y1, text in items
        if (x0 + x1) / 2.0 > x_cutoff and (y0 + y1) / 2.0 > y_cutoff
    ]
    if not content:
        return []

    heights = [y1 - y0 for _, y0, _, y1, _ in content]
    slot_h  = max(15.0, float(np.median(heights)) * 1.5)

    n      = len(content)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        parent[find(i)] = find(j)

    for i in range(n):
        ax0, ay0, ax1, ay1, _ = content[i]
        for j in range(i + 1, n):
            bx0, by0, bx1, by1, _ = content[j]
            x_overlap = min(ax1, bx1) - max(ax0, bx0)
            min_w     = min(ax1 - ax0, bx1 - bx0)
            if min_w <= 0 or x_overlap / min_w < 0.4:
                continue
            y_gap = max(ay0, by0) - min(ay1, by1)
            if y_gap < slot_h:
                union(i, j)

    groups: Dict[int, List[Tuple[int, int, int, int, str]]] = {}
    for i, item in enumerate(content):
        groups.setdefault(find(i), []).append(item)

    return list(groups.values())


# ── x → 요일, 블록 → entry ──────────────────────────────────────────────────

def _x_to_dow(cx: float, day_anchors: List[Tuple[int, int]]) -> int:
    if not day_anchors:
        return 0
    return min(day_anchors, key=lambda a: abs(cx - a[1]))[0]


def _slot_based_times(
    top_y: float,
    block_h: float,
    boundaries: List[Tuple[float, str]],
) -> Tuple[str, str]:
    """
    start = nearest boundary to top_y
    end   = start_slot + round(block_h / avg_slot_h), 최소 1슬롯
    """
    if not boundaries:
        return "09:00", "09:30"
    avg_slot_h = _boundary_avg_slot_h(boundaries)
    start_idx  = _boundary_slot_idx(top_y, boundaries)
    num_slots  = _slots_from_height(block_h, avg_slot_h)
    end_idx    = min(start_idx + num_slots, len(boundaries) - 1)
    return boundaries[start_idx][1], boundaries[end_idx][1]


def _apply_positional_end_times(
    image_bytes: bytes,
    entries_raw: list,
    day_anchors: List[Tuple[int, int]],
    boundaries: List[Tuple[float, str]],
) -> None:
    """
    색상 기반 블록 감지(positional_parser)로 각 entry의 실제 block 높이를 구해
    end_time을 slot 비율로 계산한다.

    매칭 기준: 같은 요일 열 + top_y 근접(50px 이내).
    실패 시 해당 entry는 건드리지 않는다.
    """
    try:
        from .positional_parser import detect_grid, detect_blocks as _pos_detect
        pos_grid = detect_grid(image_bytes)
        pos_blocks = _pos_detect(image_bytes, pos_grid)
        if not pos_blocks:
            return
    except Exception as exc:
        logger.debug("_apply_positional_end_times: detection failed: %s", exc)
        return

    for entry in entries_raw:
        by0 = entry["_by0"]
        dow = entry["day_of_week"]

        best = None
        best_dist = float('inf')
        for pb in pos_blocks:
            if _x_to_dow(float(pb.center_x), day_anchors) != dow:
                continue
            dist = abs(pb.top_y - by0)
            if dist < best_dist:
                best_dist = dist
                best = pb

        if best is None or best_dist > 50:
            continue

        _, new_end = _slot_based_times(float(best.top_y), float(best.bottom_y - best.top_y), boundaries)
        if new_end > entry["start_time"]:
            old_end = entry["end_time"]
            entry["end_time"] = new_end
            if new_end != old_end:
                logger.debug(
                    "_apply_positional_end_times: %r %s end %s → %s "
                    "(top_y=%d bottom_y=%d dist=%d)",
                    entry["subject_name"], entry["start_time"],
                    old_end, new_end, best.top_y, best.bottom_y, best_dist,
                )


def _block_to_entry(
    block: List[Tuple[int, int, int, int, str]],
    day_anchors: List[Tuple[int, int]],
    boundaries: List[Tuple[float, str]],
) -> Optional[dict]:
    if not block:
        return None

    bx0 = min(b[0] for b in block)
    by0 = min(b[1] for b in block)
    bx1 = max(b[2] for b in block)
    by1 = max(b[3] for b in block)

    dow = _x_to_dow((bx0 + bx1) / 2.0, day_anchors)
    start_time, end_time = _slot_based_times(float(by0), float(by1 - by0), boundaries)

    def t2m(t: str) -> int:
        try:
            h, m = t.split(":")
            return int(h) * 60 + int(m)
        except Exception:
            return -1

    if t2m(start_time) >= t2m(end_time):
        return None

    # 큰 bbox 높이(y1-y0) = 큰 폰트 = 과목명; 작은 높이 = 강의실
    sorted_by_height = sorted(block, key=lambda b: b[3] - b[1], reverse=True)
    subject_name = sorted_by_height[0][4].strip()
    location     = sorted_by_height[1][4].strip() if len(sorted_by_height) > 1 else ""

    if not subject_name:
        return None

    logger.debug("entry: %r dow=%d %s-%s loc=%r", subject_name, dow, start_time, end_time, location)
    return {
        "subject_name": subject_name,
        "day_of_week":  dow,
        "start_time":   start_time,
        "end_time":     end_time,
        "location":     location,
        "_by0":         by0,   # 열별 end_time 보정용; 최종 반환 전 제거
    }


# ── Fallback anchors ──────────────────────────────────────────────────────────

def _fallback_day_anchors(img_w: int) -> List[Tuple[int, int]]:
    gutter = int(img_w * 0.12)
    col_w  = (img_w - gutter) // 5
    return [(i, gutter + col_w * i + col_w // 2) for i in range(5)]


def _fallback_time_anchors(img_h: int) -> List[Tuple[float, int]]:
    header = int(img_h * 0.12)
    hours  = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    step   = (img_h - header) / len(hours)
    return [(header + i * step, h) for i, h in enumerate(hours)]


# ── 이미지 크기 파악 ──────────────────────────────────────────────────────────

def _image_size(image_bytes: bytes) -> Tuple[int, int]:
    """(width, height) — opencv 사용."""
    import cv2
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return 800, 1200  # 기본값
    h, w = img.shape[:2]
    return w, h


# ── 공개 진입점 ───────────────────────────────────────────────────────────────

def parse_timetable_bbox(image_bytes: bytes) -> List[dict]:
    """
    Google Cloud Vision bbox 기반 에브리타임 시간표 파싱.

    Returns:
      [{"subject_name", "day_of_week", "start_time", "end_time", "location"}, ...]
    """
    img_w, img_h = _image_size(image_bytes)

    # Google Vision OCR
    items = _call_google_vision(image_bytes)
    if not items:
        logger.warning("bbox_parser: no OCR items")
        return []

    # 앵커 추출
    day_anchors  = _extract_day_anchors(items, img_h)
    time_anchors = _extract_time_anchors(items, img_w, img_h)

    if not day_anchors:
        logger.warning("bbox_parser: day anchors not found, using fallback")
        day_anchors = _fallback_day_anchors(img_w)
    if not time_anchors:
        logger.warning("bbox_parser: time anchors not found, using fallback")
        time_anchors = _fallback_time_anchors(img_h)

    boundaries = _build_grid_boundaries(time_anchors)
    blocks     = _cluster_content_bboxes(items, img_w, img_h)
    logger.info("bbox_parser: %d blocks", len(blocks))

    entries_raw = []
    for block in blocks:
        entry = _block_to_entry(block, day_anchors, boundaries)
        if entry is not None:
            entries_raw.append(entry)

    # ── Step A: 색상 블록 기반 end_time 보정 ─────────────────────────────────
    # OCR 텍스트는 블록 상단에만 있으므로 by1 ≠ 실제 블록 하단.
    # positional_parser의 색상 감지로 실제 bottom_y를 찾아 end_time을 교정한다.
    _apply_positional_end_times(image_bytes, entries_raw, day_anchors, boundaries)

    # ── Step B: 열(요일)별 next-block 보정 ───────────────────────────────────
    # positional 감지가 실패한 블록은 다음 블록 상단 y를 end_time으로 사용한다.
    by_dow: Dict[int, list] = {}
    for e in entries_raw:
        by_dow.setdefault(e["day_of_week"], []).append(e)

    for col_entries in by_dow.values():
        col_entries.sort(key=lambda e: e["_by0"])
        for i, e in enumerate(col_entries):
            if i + 1 < len(col_entries):
                next_by0 = col_entries[i + 1]["_by0"]
                next_idx = _boundary_slot_idx(float(next_by0), boundaries)
                new_end  = boundaries[next_idx][1]
                if new_end > e["start_time"] and new_end > e["end_time"]:
                    e["end_time"] = new_end
                    logger.debug(
                        "end_time corrected via next-block: %r %s → %s",
                        e["subject_name"], e["start_time"], new_end,
                    )

    entries = []
    seen: set[tuple] = set()
    for e in sorted(entries_raw, key=lambda x: (x["day_of_week"], x["start_time"])):
        key = (e["subject_name"], e["day_of_week"], e["start_time"])
        if key in seen:
            continue
        seen.add(key)
        entries.append({k: v for k, v in e.items() if k != "_by0"})

    logger.info("bbox_parser: %d entries", len(entries))
    return entries
