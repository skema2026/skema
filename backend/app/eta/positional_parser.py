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

    # ── 행 감지: solid(:00) / dashed(:30) 강도 분리 ──────────────────────
    # solid 실선은 h_proj 강도가 높고, dashed 점선은 낮다.
    # solid 선만으로 hour_px를 계산 → pps = hour_px / 2.
    # 이렇게 하면 :30 선이 일부만 검출돼도 pps가 왜곡되지 않는다.
    content_h_proj = h_proj.copy()
    content_h_proj[:header_bottom] = 0

    proj_max = float(content_h_proj.max()) if content_h_proj.max() > 0 else 1.0

    def _collect_row_centers(thresh_ratio: float) -> List[int]:
        idxs = [int(y) for y, val in enumerate(content_h_proj)
                if val >= thresh_ratio * proj_max]
        centers: List[int] = []
        if not idxs:
            return centers
        s, p = idxs[0], idxs[0]
        for y in idxs[1:]:
            if y <= p + 3:
                p = y
            else:
                centers.append((s + p) // 2)
                s = p = y
        centers.append((s + p) // 2)
        return centers

    # solid 선: 상위 65% 이상 강도 (dashed :30 선 제외)
    solid_centers = _collect_row_centers(0.65)
    # 모든 선(solid + dashed): 상위 20% 이상 강도
    all_centers   = _collect_row_centers(0.20)

    # ── solid 선으로 hour_px 계산 ─────────────────────────────────────────
    if len(solid_centers) >= 2:
        solid_diffs = np.diff(solid_centers)
        # 이상치 제거: 중앙값 ±50% 범위만 사용
        med = float(np.median(solid_diffs))
        clean = [d for d in solid_diffs if 0.5 * med <= d <= 1.5 * med]
        hour_px = float(np.mean(clean)) if clean else med
        pixels_per_slot = hour_px / 2.0
    else:
        # solid 선 부족 → all_centers fallback
        if len(all_centers) >= 2:
            pixels_per_slot = float(np.median(np.diff(all_centers)))
        else:
            pixels_per_slot = (h - header_bottom) / 26.0

    # ── :30 위치 채우기 ───────────────────────────────────────────────────
    # solid 선 사이의 중간에 all_centers 점이 있으면 그 값을, 없으면 보간값 사용.
    all_set = set(all_centers)
    row_bounds: List[int] = []
    if solid_centers:
        for i, sc in enumerate(solid_centers):
            row_bounds.append(sc)
            if i + 1 < len(solid_centers):
                expected_half = int(sc + pixels_per_slot)
                # all_centers 중 expected_half ±30% pps 이내에 있는 점 사용
                tol = int(pixels_per_slot * 0.30)
                candidates = [c for c in all_centers
                              if abs(c - expected_half) <= tol]
                half_y = int(np.mean(candidates)) if candidates else expected_half
                row_bounds.append(half_y)
        # 마지막 solid 선 이후 :30 추가
        row_bounds.append(int(solid_centers[-1] + pixels_per_slot))
    else:
        row_bounds = all_centers

    row_bounds = sorted(set(row_bounds))

    # 근접 중복 제거
    if len(row_bounds) >= 2:
        min_gap = max(2, int(pixels_per_slot * 0.3))
        deduped: List[int] = [row_bounds[0]]
        for y in row_bounds[1:]:
            if y - deduped[-1] >= min_gap:
                deduped.append(y)
        row_bounds = deduped

    logger.debug(
        "detect_grid: solid=%d all=%d row_bounds=%d hour_px=%.1f pps=%.2f",
        len(solid_centers), len(all_centers), len(row_bounds), pixels_per_slot * 2, pixels_per_slot,
    )

    # ── grid_origin_y: slot 0(9:00)의 y픽셀 ─────────────────────────────
    # first_solid가 몇 번째 :00 선인지 gap/pps로 추론 → 역산으로 9:00 위치 계산
    if solid_centers and pixels_per_slot > 0:
        first_solid = solid_centers[0]
        gap = first_solid - header_bottom
        # header_bottom ~ first_solid 사이에 몇 슬롯이 있는지 반올림
        n_slots = int(gap / pixels_per_slot + 0.5)
        grid_origin_y = int(first_solid - n_slots * pixels_per_slot)
        # 역산 결과가 헤더 위로 올라가면 한 슬롯 덜 빼기
        if grid_origin_y < header_bottom and n_slots > 0:
            grid_origin_y = int(first_solid - (n_slots - 1) * pixels_per_slot)
        grid_origin_y = max(0, grid_origin_y)
        start_minute = 0
    else:
        grid_origin_y = header_bottom
        start_minute  = 0

    logger.debug(
        "detect_grid: header_bottom=%d grid_origin_y=%d pps=%.2f start_minute=%d",
        header_bottom, grid_origin_y, pixels_per_slot, start_minute,
    )

    return GridModel(
        column_bounds=column_bounds,
        row_bounds=row_bounds,
        start_hour=9,
        start_minute=start_minute,
        minutes_per_step=30,
        header_bottom=header_bottom,
        pixels_per_slot=pixels_per_slot,
        grid_origin_y=grid_origin_y,
    )


# ── Stage 2: 수업 블록 감지 ──────────────────────────────────────────────────

def _merge_blocks(raw: List[DetectedBlock], step: float) -> List[DetectedBlock]:
    """
    같은 수업 블록이 그리드 선/마스크 아티팩트로 여러 contour로 분리된 경우 병합한다.

    병합 조건 (두 블록 A, B에 대해):
      - x overlap 비율 > 0.5  (같은 열에 위치)
      - y gap < 1.2 * step   (인접한 슬롯 내에 있음)

    Union-Find 방식으로 전체 병합 그룹을 구성한 뒤
    각 그룹의 bbox union을 DetectedBlock으로 반환한다.
    """
    n = len(raw)
    if n == 0:
        return []

    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        parent[find(i)] = find(j)

    threshold_y = 1.2 * step

    for i in range(n):
        ax0, ay0, ax1, ay1 = raw[i].bbox
        aw = ax1 - ax0
        for j in range(i + 1, n):
            bx0, by0, bx1, by1 = raw[j].bbox
            bw = bx1 - bx0

            # x overlap 비율
            x_overlap = min(ax1, bx1) - max(ax0, bx0)
            min_w = min(aw, bw)
            if min_w <= 0 or x_overlap / min_w <= 0.5:
                continue

            # y gap (두 bbox 사이의 수직 거리; 겹치면 음수)
            y_gap = max(ay0, by0) - min(ay1, by1)
            if y_gap < threshold_y:
                union(i, j)

    groups: dict[int, List[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    merged: List[DetectedBlock] = []
    for indices in groups.values():
        x0 = min(raw[i].bbox[0] for i in indices)
        y0 = min(raw[i].bbox[1] for i in indices)
        x1 = max(raw[i].bbox[2] for i in indices)
        y1 = max(raw[i].bbox[3] for i in indices)
        cx = (x0 + x1) // 2
        merged.append(DetectedBlock(
            bbox=(x0, y0, x1, y1),
            center_x=cx,
            top_y=y0,
            bottom_y=y1,
            ocr_text="",
        ))

    merged.sort(key=lambda b: (b.top_y, b.center_x))
    return merged


def detect_blocks(image_bytes: bytes, grid: GridModel) -> List[DetectedBlock]:
    """
    색상/텍스트 영역을 기반으로 수업 블록을 감지한다.

    처리 순서:
      1. 채도 마스크 + adaptive threshold 마스크 합산
      2. CLOSE → OPEN 순서로 morphology (먼저 내부 gap 메우고, 선 아티팩트 제거)
      3. contour 추출 후 크기/위치 필터
      4. 분리된 contour를 x-overlap + y-gap 기준으로 merge
    """
    img = _load_image(image_bytes)
    h, w = img.shape[:2]

    header_y = grid.header_bottom if grid.header_bottom > 0 else (
        grid.row_bounds[0] if grid.row_bounds else int(h * 0.12)
    )
    gutter_x = grid.column_bounds[0][1] if len(grid.column_bounds) > 1 else int(w * 0.10)

    # ── 마스크 생성 ──────────────────────────────────────────────────────────
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    _, sat_mask = cv2.threshold(hsv[:, :, 1], 35, 255, cv2.THRESH_BINARY)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thr = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 7)

    mask = cv2.bitwise_or(sat_mask, thr)

    # ── morphology: CLOSE → OPEN ─────────────────────────────────────────────
    # 1) CLOSE: 블록 내부 gap(그리드 선으로 잘린 틈)을 먼저 메운다.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, max(5, int(grid.pixels_per_slot * 0.6) if grid.pixels_per_slot > 0 else 15)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)

    # 2) OPEN: 수직/수평 선 아티팩트(그리드 선)를 제거한다.
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(8, h // 40)))
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(8, w // 40), 1))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, v_kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, h_kernel, iterations=1)

    # 헤더 마스킹
    mask[:header_y, :] = 0

    # ── contour 추출 및 1차 필터 ────────────────────────────────────────────
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    raw_blocks: List[DetectedBlock] = []
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw < 20 or bh < 15:
            continue
        if x + bw // 2 <= gutter_x + 5:
            continue
        if y + bh // 2 < header_y:
            continue
        cx = x + bw // 2
        raw_blocks.append(DetectedBlock(
            bbox=(x, y, x + bw, y + bh),
            center_x=cx,
            top_y=y,
            bottom_y=y + bh,
            ocr_text="",
        ))

    # ── contour merge ────────────────────────────────────────────────────────
    step = grid.pixels_per_slot if grid.pixels_per_slot > 0 else max(
        float(np.median(np.diff(grid.row_bounds))) if len(grid.row_bounds) >= 2 else 30.0,
        1.0,
    )
    blocks = _merge_blocks(raw_blocks, step)

    logger.debug(
        "detect_blocks: raw=%d merged=%d (header_y=%d gutter_x=%d step=%.1f)",
        len(raw_blocks), len(blocks), header_y, gutter_x, step,
    )
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


def _snap_end_to_row(y: int, row_bounds: List[int]) -> int:
    """
    블록 bottom_y → end row 인덱스.
    슬롯 간격의 30% 이상 걸쳐있으면 다음 슬롯으로 올림(ceiling).
    1:00~2:30 블록이 2:00 row에 약간 못 미쳐도 2:30으로 올바르게 스냅.
    """
    if not row_bounds:
        return 0
    if len(row_bounds) < 2:
        return _snap_to_row(y, row_bounds)

    step = int(np.median(np.diff(row_bounds))) if len(row_bounds) >= 2 else 40
    threshold = step * 0.30  # 슬롯의 30% 이상 걸치면 올림

    for i, ry in enumerate(row_bounds):
        if y <= ry + threshold:
            return i

    return len(row_bounds) - 1


def _row_to_time(idx: int, grid: GridModel) -> str:
    """
    row_bounds 인덱스 → "HH:MM".

    time(idx) = start_hour * 60 + start_minute + idx * minutes_per_step
    """
    minutes = grid.start_hour * 60 + grid.start_minute + idx * grid.minutes_per_step
    h = max(0, min(23, minutes // 60))
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


def slot_to_time(slot: int) -> str:
    """slot 0=09:00, slot 1=09:30, …, slot 25=21:30"""
    total = 9 * 60 + slot * 30
    return f"{min(total // 60, 23):02d}:{total % 60:02d}"


def _px_to_slot(y: int, grid: GridModel) -> int:
    """
    (y - grid_origin_y) / pixels_per_slot → nearest slot.
    grid_origin_y = 9:00 라인의 실제 y픽셀 (header_bottom과 다를 수 있음).
    int(raw + 0.5) 로 banker's rounding 없이 표준 반올림.
    """
    if grid.pixels_per_slot > 0:
        return max(0, int((y - grid.grid_origin_y) / grid.pixels_per_slot + 0.5))
    return _snap_to_row(y, grid.row_bounds)


def _height_to_slots(top_y: int, bottom_y: int, grid: GridModel) -> int:
    """block_height / pixels_per_slot → slot 수 (최소 1)."""
    if grid.pixels_per_slot > 0:
        return max(1, int((bottom_y - top_y) / grid.pixels_per_slot + 0.5))
    return max(1, _snap_end_to_row(bottom_y, grid.row_bounds) - _px_to_slot(top_y, grid))


def infer_weekday_time(block: DetectedBlock, grid: GridModel) -> Tuple[int, str, str]:
    raw_col_idx = _column_for_x(block.center_x, grid.column_bounds)
    day_idx = max(0, min(6, raw_col_idx - 1))

    start_slot    = _px_to_slot(block.top_y, grid)
    duration_slots = _height_to_slots(block.top_y, block.bottom_y, grid)
    end_slot      = start_slot + duration_slots

    start_time = slot_to_time(start_slot)
    end_time   = slot_to_time(end_slot)

    logger.debug(
        "infer_weekday_time: dow=%d top_y=%d→slot%d(%s) h=%dpx→%dslots end_slot%d(%s)",
        day_idx, block.top_y, start_slot, start_time,
        block.bottom_y - block.top_y, duration_slots, end_slot, end_time,
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
