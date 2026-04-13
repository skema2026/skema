"""
에브리타임 시간표 이미지 위치기반 파서 (LLM 장애 시 fallback).

파이프라인:
  이미지 → 그리드 감지(컬럼/행) → 색상 블록 감지 → 요일/시간 추론 → 정규화

핵심 설계 원칙:
  - LLM 없이 동작하는 fallback: 과목명은 비어있을 수 있음
  - 시간 보정: 헤더 행 제외 후 start_minute 자동 결정
  - 컬럼 감지: gutter 이후 영역을 요일 컬럼으로 분할
  - 30분 그리드 기준으로 top/bottom y → 시간 변환
"""
from __future__ import annotations

import logging
from typing import List, Tuple

import numpy as np
import cv2  # opencv-python-headless

from .positional_types import GridModel, DetectedBlock, NormalizedEntry, DOW_TO_NAME

logger = logging.getLogger(__name__)


# ── Stage 1: 그리드 감지 ──────────────────────────────────────────────────────

def _load_image(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image bytes")
    return img


def _cluster_line_positions(positions: List[int], min_gap: int = 5) -> List[Tuple[int, int]]:
    """연속된 픽셀 위치들을 클러스터(start, end)로 묶는다."""
    if not positions:
        return []
    clusters: List[Tuple[int, int]] = []
    start = positions[0]
    prev  = positions[0]
    for p in positions[1:]:
        if p <= prev + min_gap:
            prev = p
        else:
            clusters.append((start, prev))
            start = p
            prev  = p
    clusters.append((start, prev))
    return clusters


def _detect_header_bottom(h_proj: np.ndarray, img_h: int) -> int:
    """
    헤더 행(월/화/수/목/금 레이블)의 하단 y 좌표를 반환한다.

    에브리타임 헤더는 이미지 상단 5~20% 구간에 존재한다.
    이 구간에서 가장 강한 수평선 클러스터의 하단 y + 1을 헤더 경계로 사용한다.
    감지 실패 시 이미지 높이의 12%를 기본값으로 반환한다.
    """
    search_end = min(int(img_h * 0.22), len(h_proj))
    region = h_proj[:search_end]
    default_header_y = max(30, int(img_h * 0.12))

    if region.max() <= 0:
        logger.debug("detect_header_bottom: no strong lines in header area, using default %d", default_header_y)
        return default_header_y

    thresh = 0.45 * float(region.max())
    strong_ys = [y for y, val in enumerate(region) if val >= thresh]
    if not strong_ys:
        return default_header_y

    clusters = _cluster_line_positions(strong_ys, min_gap=3)
    # 가장 하단 클러스터의 끝 + 2 = 헤더 경계
    header_bottom = clusters[-1][1] + 2
    # 너무 크거나 작으면 기본값 사용
    if header_bottom < 10 or header_bottom > int(img_h * 0.25):
        header_bottom = default_header_y

    logger.debug(
        "detect_header_bottom: header_bottom=%d (%.1f%% of h=%d), clusters=%d",
        header_bottom, 100 * header_bottom / img_h, img_h, len(clusters),
    )
    return header_bottom


def _detect_gutter_x(v_proj: np.ndarray, w: int) -> int:
    """시간 거터(time gutter)의 오른쪽 경계 x를 반환한다."""
    search_end = min(int(w * 0.25), len(v_proj))
    region = v_proj[:search_end]
    if region.max() <= 0:
        return max(20, int(w * 0.10))

    thresh = 0.35 * float(region.max())
    strong_xs = [x for x, val in enumerate(region) if val >= thresh]
    if not strong_xs:
        return max(20, int(w * 0.10))

    clusters = _cluster_line_positions(strong_xs)
    gutter_x = clusters[-1][1] + 1
    if gutter_x < 10 or gutter_x > int(w * 0.30):
        gutter_x = max(20, int(w * 0.10))

    logger.debug("detect_gutter_x: gutter_x=%d (%.1f%% of w=%d)", gutter_x, 100 * gutter_x / w, w)
    return gutter_x


def _determine_start_minute(content_rows: List[int], header_bottom: int, img_h: int) -> int:
    """
    첫 번째 콘텐츠 행 위치를 기반으로 start_minute(0 또는 30)을 결정한다.

    에브리타임 시간축:
      - 9:00 line: 헤더 직후 (보통 탐지됨)
      - 9:30 dashed line: 9:00 line 아래 1슬롯

    로직:
      전체 콘텐츠 높이와 예상 슬롯 수(26 = 9:00~22:00, 30분 단위)를 기반으로
      한 슬롯의 예상 픽셀 높이를 추정한다.
      첫 번째 content_row가 header_bottom으로부터 0.7슬롯 이내이면 9:00 line으로 판정.
      그보다 멀면 9:30 dashed line으로 판정.
    """
    if not content_rows:
        logger.debug("_determine_start_minute: no content rows, defaulting to 30")
        return 30

    content_h = img_h - header_bottom
    # 9:00~22:00 = 26개 30분 슬롯, 26개 구분선
    expected_slots = 26
    slot_px = content_h / expected_slots if expected_slots > 0 else 40

    gap = content_rows[0] - header_bottom
    threshold = slot_px * 0.7

    if gap <= threshold:
        start_minute = 0
        logger.debug(
            "_determine_start_minute: gap=%dpx <= threshold=%.1fpx → start_minute=0 (9:00 line)",
            gap, threshold,
        )
    else:
        start_minute = 30
        logger.debug(
            "_determine_start_minute: gap=%dpx > threshold=%.1fpx → start_minute=30 (9:30 line)",
            gap, threshold,
        )
    return start_minute


def detect_grid(image_bytes: bytes) -> GridModel:
    """
    에브리타임 이미지에서 column_bounds와 row_bounds를 감지한다.

    변경사항 (v2):
      - 헤더 행 y 자동 감지 및 콘텐츠 행에서 제외
      - start_minute을 헤더~첫 content row 간격으로 자동 결정
        (기존 고정값 30 → 이미지마다 0 또는 30으로 자동 보정)
    """
    img = _load_image(image_bytes)
    h, w = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thr = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 7
    )

    # 수직선 감지 (요일 컬럼 경계)
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(8, h // 40)))
    v_lines  = cv2.morphologyEx(thr, cv2.MORPH_OPEN, v_kernel, iterations=2)

    # 수평선 감지 (시간 그리드 + 헤더)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(8, w // 40), 1))
    h_lines  = cv2.morphologyEx(thr, cv2.MORPH_OPEN, h_kernel, iterations=2)

    v_proj = v_lines.sum(axis=0)
    h_proj = h_lines.sum(axis=1)

    # ── 헤더 하단 감지 ─────────────────────────────────────────────────────
    header_bottom = _detect_header_bottom(h_proj, h)

    # ── 컬럼 감지 ──────────────────────────────────────────────────────────
    gutter_x = _detect_gutter_x(v_proj, w)

    day_region = v_proj[gutter_x:]
    day_col_edges: List[Tuple[int, int]] = []
    if day_region.max() > 0:
        thresh = 0.35 * float(day_region.max())
        day_xs = [gutter_x + x for x, val in enumerate(day_region) if val >= thresh]
        day_col_edges = _cluster_line_positions(day_xs)
        day_col_edges = [e for e in day_col_edges if e[0] < w - 5]

    num_day_cols = len(day_col_edges) + 1
    if num_day_cols < 5:
        num_day_cols = 5
    elif num_day_cols > 7:
        num_day_cols = 7

    if day_col_edges and len(day_col_edges) + 1 == num_day_cols:
        sep_centers = [int((l + r) / 2) for l, r in day_col_edges]
    else:
        col_w = (w - gutter_x) / num_day_cols
        sep_centers = [int(gutter_x + col_w * i) for i in range(1, num_day_cols)]

    # column_bounds:
    #   bounds[0] = (0, gutter_x)       ← time gutter
    #   bounds[1] = (gutter_x, sep[0])  ← 월(MONDAY, dow=0)
    #   bounds[N] = (sep[N-2], w-1)     ← 마지막 요일
    column_bounds: List[Tuple[int, int]] = [(0, gutter_x)]
    prev = gutter_x
    for sx in sep_centers:
        column_bounds.append((prev, sx))
        prev = sx
    column_bounds.append((prev, w - 1))

    logger.debug(
        "detect_grid: gutter_x=%d header_bottom=%d num_day_cols=%d col_bounds=%s",
        gutter_x, header_bottom, num_day_cols,
        [(l, r) for l, r in column_bounds],
    )

    # ── 행 감지 ────────────────────────────────────────────────────────────
    # 헤더 영역(header_bottom 이상)의 수평선만 사용
    content_h_proj = h_proj.copy()
    content_h_proj[:header_bottom] = 0  # 헤더 행 마스킹

    y_thresh = 0.5 * float(content_h_proj.max()) if content_h_proj.max() > 0 else 0
    y_idxs = [int(y) for y, val in enumerate(content_h_proj) if val >= y_thresh]

    row_bounds: List[int] = []
    if y_idxs:
        start_y = y_idxs[0]
        prev_y  = y_idxs[0]
        for y in y_idxs[1:]:
            if y == prev_y + 1:
                prev_y = y
            else:
                row_bounds.append(int((start_y + prev_y) / 2))
                start_y = y
                prev_y  = y
        row_bounds.append(int((start_y + prev_y) / 2))

    row_bounds = sorted(set(row_bounds))

    # 중복 제거 (근접한 행 병합)
    if len(row_bounds) >= 4:
        deltas = np.diff(row_bounds)
        step = int(np.median(deltas))
        deduped: List[int] = []
        for y in row_bounds:
            if not deduped or abs(y - deduped[-1]) >= max(2, step // 3):
                deduped.append(y)
        row_bounds = deduped

    logger.debug(
        "detect_grid: row_bounds=%d (first=%s last=%s)",
        len(row_bounds),
        row_bounds[0] if row_bounds else None,
        row_bounds[-1] if row_bounds else None,
    )

    # ── start_minute 자동 결정 ─────────────────────────────────────────────
    start_minute = _determine_start_minute(row_bounds, header_bottom, h)

    return GridModel(
        column_bounds=column_bounds,
        row_bounds=row_bounds,
        start_hour=9,
        start_minute=start_minute,
        minutes_per_step=30,
    )


# ── Stage 2: 수업 블록 감지 ──────────────────────────────────────────────────

def detect_blocks(image_bytes: bytes, grid: GridModel) -> List[DetectedBlock]:
    """
    색상/텍스트 영역을 기반으로 수업 블록을 감지한다.

    개선 (v2):
      - 헤더 y 영역 (grid.row_bounds 최소값 위) 제외
      - 최소 블록 크기 요건 완화 (작은 블록도 포착)
      - time gutter 영역 블록 제외 강화
    """
    img = _load_image(image_bytes)
    h, w = img.shape[:2]

    # 헤더 영역 하단 y 추정 (grid row_bounds 중 첫 번째)
    header_y = grid.row_bounds[0] if grid.row_bounds else int(h * 0.12)
    gutter_x = grid.column_bounds[0][1] if len(grid.column_bounds) > 1 else int(w * 0.10)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    _, sat_mask = cv2.threshold(sat, 35, 255, cv2.THRESH_BINARY)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thr = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 7)
    rect_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    rects = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, rect_kernel, iterations=2)

    mask = cv2.bitwise_or(sat_mask, rects)

    # 그리드 선 아티팩트 제거
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(8, h // 40)))
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(8, w // 40), 1))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, v_kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, h_kernel, iterations=1)

    # 헤더 영역 마스킹 (블록이 헤더 위에 생기지 않도록)
    mask[:header_y, :] = 0

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    blocks: List[DetectedBlock] = []
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        # 최소 크기 필터
        if bw < 20 or bh < 15:
            continue
        # time gutter 내 블록 제외
        if x + bw // 2 <= gutter_x + 5:
            continue
        # 헤더 영역 블록 제외
        if y + bh // 2 < header_y:
            continue
        cx = x + bw // 2
        blocks.append(DetectedBlock(
            bbox=(x, y, x + bw, y + bh),
            center_x=cx,
            top_y=y,
            bottom_y=y + bh,
            ocr_text="",  # OCR 없음: 과목명은 LLM으로 보완
        ))

    blocks.sort(key=lambda b: (b.top_y, b.center_x))
    logger.debug("detect_blocks: found %d blocks (header_y=%d gutter_x=%d)", len(blocks), header_y, gutter_x)
    return blocks


# ── Stage 3: 요일/시간 추론 ──────────────────────────────────────────────────

def _column_for_x(center_x: int, columns: List[Tuple[int, int]]) -> int:
    """
    center_x가 속하는 컬럼 인덱스를 경계 포함(boundary containment) 방식으로 반환.
    center_x가 어느 (left, right) 구간에 포함되는지 우선 판단하고,
    구간 밖이면 가장 가까운 컬럼으로 fallback.
    """
    for i, (left, right) in enumerate(columns):
        if left <= center_x < right:
            return i
    # 경계 밖 fallback
    centers = [((l + r) // 2) for (l, r) in columns]
    dists = [abs(center_x - c) for c in centers]
    return int(np.argmin(dists))


def _snap_to_row(y: int, row_bounds: List[int]) -> int:
    """y를 가장 가까운 row_bounds 인덱스로 스냅한다."""
    if not row_bounds:
        return 0
    diffs = [abs(y - ry) for ry in row_bounds]
    minv = min(diffs)
    candidates = [i for i, d in enumerate(diffs) if abs(d - minv) < 1e-6]
    return max(candidates)  # 동점 시 더 늦은(아래) 슬롯 선택


def _row_to_time(idx: int, grid: GridModel) -> str:
    """
    row_bounds 인덱스 → "HH:MM".

    time(idx) = start_hour * 60 + start_minute + idx * minutes_per_step
    """
    minutes = grid.start_hour * 60 + grid.start_minute + idx * grid.minutes_per_step
    h = max(0, min(23, minutes // 60))
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


def infer_weekday_time(block: DetectedBlock, grid: GridModel) -> Tuple[int, str, str]:
    """
    블록 픽셀 위치 → (day_of_week, start_time, end_time).

    column_bounds[0] = time gutter (요일 없음).
    column_bounds[1] = 월(dow=0), column_bounds[2] = 화(dow=1), ...
    따라서 raw_col_idx - 1 = dow.
    """
    raw_col_idx = _column_for_x(block.center_x, grid.column_bounds)
    day_idx = max(0, min(6, raw_col_idx - 1))

    start_idx = _snap_to_row(block.top_y, grid.row_bounds)
    end_idx   = _snap_to_row(block.bottom_y, grid.row_bounds)
    if end_idx <= start_idx:
        end_idx = start_idx + 1

    start_time = _row_to_time(start_idx, grid)
    end_time   = _row_to_time(end_idx, grid)

    logger.debug(
        "infer_weekday_time: center_x=%d raw_col=%d dow=%d "
        "top_y=%d→slot%d(%s)  bottom_y=%d→slot%d(%s)  start_minute=%d",
        block.center_x, raw_col_idx, day_idx,
        block.top_y, start_idx, start_time,
        block.bottom_y, end_idx, end_time,
        grid.start_minute,
    )
    return day_idx, start_time, end_time


# ── Stage 4: 정규화 출력 ──────────────────────────────────────────────────────

def normalize_blocks(blocks: List[DetectedBlock], grid: GridModel) -> List[NormalizedEntry]:
    out: List[NormalizedEntry] = []
    seen: set[tuple] = set()

    for b in blocks:
        day_idx, start, end = infer_weekday_time(b, grid)

        # 시간 유효성 검사
        def t2m(t: str) -> int:
            try:
                h, m = t.split(":")
                return int(h) * 60 + int(m)
            except Exception:
                return -1

        if t2m(start) >= t2m(end):
            logger.debug("normalize_blocks: invalid range %s-%s, skipping block", start, end)
            continue
        # 시간 범위 sanity check (9:00~22:00 내)
        if t2m(start) < 9 * 60 or t2m(end) > 22 * 60:
            logger.debug("normalize_blocks: out-of-range %s-%s, skipping block", start, end)
            continue

        # 중복 제거 (같은 요일·시간 블록)
        key = (day_idx, start, end)
        if key in seen:
            continue
        seen.add(key)

        title = (b.ocr_text or '').strip()  # positional fallback: 비어있음
        out.append({
            'title': title,
            'day': DOW_TO_NAME[day_idx],
            'startTime': start,
            'endTime': end,
            'location': '',
            'bbox': b.bbox,
        })

    logger.info("normalize_blocks: %d valid entries from %d detected blocks", len(out), len(blocks))
    return out


# ── 편의 함수: 전체 파이프라인 ────────────────────────────────────────────────

def parse_image_positional(image_bytes: bytes):
    """
    위치기반 파서 전체 파이프라인.
    Returns: (grid, normalized_entries)
    """
    grid = detect_grid(image_bytes)
    blocks = detect_blocks(image_bytes, grid)
    entries = normalize_blocks(blocks, grid)
    return grid, entries
