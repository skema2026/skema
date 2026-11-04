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
import warnings

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


DARK_MEAN_THRESHOLD = 110


def _to_light_gray(img: np.ndarray) -> np.ndarray:
    """격자 선 찾기용 흑백 이미지. 다크 모드 캡처면 밝게 뒤집는다.

    에브리타임 다크 모드는 검은 바탕(#111)에 어두운 회색 선(#2a)이라, 흰 바탕·연회색 선을
    가정한 선 찾기가 전부 실패했다(11/4 확인: 모든 수업이 1시간 일찍 잡힘).
    뒤집으면 바탕 #ee, 선 #d5가 되어 라이트 모드와 같은 기준으로 찾을 수 있다.
    블록 색 판별(채도)은 원본 컬러로 하므로 여기에 영향받지 않는다.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if float(gray.mean()) < DARK_MEAN_THRESHOLD:
        gray = 255 - gray
    return gray


def _cluster_line_positions(positions: list[int], min_gap: int = 5) -> list[tuple[int, int]]:
    """연속된 픽셀 위치들을 클러스터(start, end)로 묶는다."""
    if not positions:
        return []
    clusters: list[tuple[int, int]] = []
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

    # 전체 화면 캡처에서는 상단 앱바/요일 헤더 아래에 09:00, 10:00
    # 시간선이 함께 search 영역에 들어온다. 마지막 strong line을 쓰면
    # 10:00 라인을 헤더로 오인해 전체 시간이 앞으로 밀린다.
    # 요일 헤더 하단은 보통 이미지 높이의 7~16% 구간에 있으므로 그
    # 구간의 가장 아래 strong line을 우선 사용한다.
    header_candidates = [
        c for c in clusters
        if int(img_h * 0.07) <= (c[0] + c[1]) / 2 <= int(img_h * 0.16)
    ]
    selected = header_candidates[-1] if header_candidates else clusters[-1]
    header_bottom = selected[1] + 2
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
    search_end = min(int(w * 0.30), len(v_proj))
    region = v_proj[:search_end]
    if region.max() <= 0:
        return max(20, int(w * 0.10))

    # The rounded left card border can be much stronger than the actual time
    # gutter separator. Use a lower threshold, then explicitly skip that outer
    # border below instead of letting it hide the gutter line.
    thresh = 0.10 * float(region.max())
    strong_xs = [x for x, val in enumerate(region) if val >= thresh]
    if not strong_xs:
        return max(20, int(w * 0.10))

    clusters = _cluster_line_positions(strong_xs)

    # 에브리타임 격자는 보통 시간 거터 오른쪽 경계가 전체 폭의 10~18%에 있다.
    # 일부 캡처에는 왼쪽 외곽선이 없어서 첫 번째 강한 세로선이 곧 gutter이고,
    # 일부 캡처에는 x≈0 외곽선이 먼저 잡혀 두 번째 선이 gutter다.
    #
    # 11/4: 예전에는 "첫 선이 폭의 6% 안이면 외곽선"으로 봤는데, 시간칸이 좁은
    # 안드로이드형 캡처(시간칸 오른쪽 선이 4% 위치)에서 진짜 시간칸 선을 건너뛰고
    # 월/화 경계를 시간칸으로 잡았다. 그래서 위치 대신 '폭'으로 판단한다:
    # 첫 선~둘째 선 사이가 요일 칸보다 훨씬 좁으면(시간 숫자 칸) 첫 선은 외곽선이다.
    centers = [((c[0] + c[1]) / 2, c) for c in clusters]
    full_clusters = _cluster_line_positions(
        [x for x, val in enumerate(v_proj) if val >= thresh]
    )
    full_centers = [(a + b) / 2 for a, b in full_clusters]
    day_gaps = np.diff(full_centers[1:]) if len(full_centers) >= 3 else np.array([])
    day_w = float(np.median(day_gaps)) if day_gaps.size else (w * 0.85 / 5)
    if len(centers) >= 2 and centers[0][0] <= w * 0.06 and (centers[1][0] - centers[0][0]) < 0.6 * day_w:
        # 왼쪽 외곽선이 먼저 잡히고, 그 오른쪽이 좁은 시간 숫자 칸인 케이스.
        gutter_cluster = centers[1][1]
    else:
        # 왼쪽 외곽선이 없으면 첫 번째 강한 선이 시간칸/월요일 경계다.
        gutter_cluster = centers[0][1]

    gutter_x = gutter_cluster[1] + 1
    if gutter_x < 10 or gutter_x > int(w * 0.30):
        gutter_x = max(20, int(w * 0.10))

    logger.debug("detect_gutter_x: gutter_x=%d (%.1f%% of w=%d)", gutter_x, 100 * gutter_x / w, w)
    return gutter_x


def _determine_start_minute(content_rows: list[int], header_bottom: int, img_h: int) -> int:
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


def _refine_grid_origin(
    solid_centers: list[int],
    grid_origin_y: int,
    pixels_per_slot: float,
) -> int:
    """
    모든 solid(:00) 라인을 이용해 grid_origin_y를 ±2슬롯 범위에서 정밀 보정한다.

    solid line은 매 2슬롯(1시간)마다 나타나므로 잔차는 hour_px 주기.
    잔차 평균이 최소인 정수 y를 반환한다.
    """
    if not solid_centers or pixels_per_slot <= 0:
        return grid_origin_y

    hour_px = pixels_per_slot * 2

    def mean_residual(gy: int) -> float:
        total = 0.0
        for sc in solid_centers:
            diff = (sc - gy) % hour_px
            total += min(diff, hour_px - diff)
        return total / len(solid_centers)

    best_gy = grid_origin_y
    best_res = mean_residual(grid_origin_y)
    search_range = int(pixels_per_slot * 2 + 0.5)

    for delta in range(-search_range, search_range + 1):
        gy_trial = grid_origin_y + delta
        if gy_trial < 0:
            continue
        res = mean_residual(gy_trial)
        if res < best_res - 0.5:
            best_res = res
            best_gy = gy_trial

    logger.debug(
        "_refine_grid_origin: original=%d refined=%d residual=%.2f",
        grid_origin_y, best_gy, best_res,
    )
    return best_gy


def _detect_time_lines_from_gutter(gray: np.ndarray, gutter_x: int) -> list[int]:
    """
    왼쪽 시간 거터에서 시간축 실선을 직접 찾는다.

    수업 블록 내부 색/텍스트는 본문 영역에 있으므로 전체 폭 projection을 쓰면
    색상 블록과 텍스트가 수평선으로 오인될 수 있다. 시간 거터에는 시간 라벨과
    그리드 실선만 있어 9:00, 10:00, ... 라인을 더 안정적으로 찾을 수 있다.
    """
    h, _w = gray.shape[:2]
    if gutter_x <= 20:
        return []

    left = max(0, int(gutter_x * 0.42))
    right = max(left + 8, gutter_x - 2)
    roi = gray[:, left:right]
    if roi.size == 0:
        return []

    # 배경/진한 시간 텍스트를 제외하고 배경보다 조금 어두운 그리드 선만 집계한다.
    # 예전에는 '흰 배경(255)'을 가정해 180~245로 고정했는데, 다크 모드를 뒤집으면 배경이
    # 235쯤이라 배경 전체가 선으로 잡혔다(11/4). 그래서 이 이미지의 배경 밝기 기준으로 잡는다.
    bg = float(np.median(roi))
    lineish = (roi < bg - 12) & (roi > bg - 90)
    scores = lineish.mean(axis=1)
    ys = [int(y) for y, val in enumerate(scores) if val >= 0.55]
    clusters = _cluster_line_positions(ys, min_gap=2)
    centers = [int((s + e) / 2) for s, e in clusters if e - s <= 8]

    if len(centers) < 4:
        return []

    # 11/4: 같은 간격(1시간)으로 가장 길게 이어지는 선들을 시간선으로 고른다.
    # 예전에는 '처음 8개 간격의 중앙값'을 1시간으로 봤는데, 시간칸 위에 학기 탭 밑줄·
    # 글자 조각이 여러 줄 잡힌 캡처(새 9장 중 4장)에서 1시간을 20px로 잘못 잡아
    # 블록이 30분짜리 수십 개로 쪼개졌다.
    centers = _best_hour_chain(centers)
    logger.debug("_detect_time_lines_from_gutter: centers=%s", centers)
    return centers


def _detect_table_top(v_lines: np.ndarray, sep_centers: list[int]) -> int | None:
    """요일 세로 구분선이 시작하는 y (= 시간표 표의 맨 위). 못 찾으면 None."""
    tops: list[int] = []
    h = v_lines.shape[0]
    for x in sep_centers:
        col = v_lines[:, max(0, x - 3):x + 4].max(axis=1) > 0
        run = 0
        for y in range(h):
            run = run + 1 if col[y] else 0
            if run >= 30:
                tops.append(y - run + 1)
                break
    if len(tops) < 2:
        return None
    return int(np.median(tops))


def _best_hour_chain(centers: list[int]) -> list[int]:
    """같은 간격으로 늘어선 선 중 가장 긴 줄(1시간 간격 시간선)을 고른다.

    블록에 가려지지 않는 시간칸 안의 선이라 중간에 빠지는 일은 드물지만,
    한 줄 건너뛴 것(2시간 간격)까지는 같은 줄로 본다.
    """
    if len(centers) < 3:
        return list(centers)
    best: list[int] = []
    gaps = sorted({int(d) for d in np.diff(centers) if d >= 20})
    for g in gaps:
        tol = max(3.0, g * 0.05)
        for i in range(len(centers)):
            chain = [centers[i]]
            for c in centers[i + 1:]:
                gap = c - chain[-1]
                k = int(round(gap / g))
                if k in (1, 2) and abs(gap - k * g) <= tol * k:
                    chain.append(c)
                elif gap > 2 * g + 2 * tol:
                    break
            if len(chain) > len(best):
                best = chain
    return best


def _fit_hour_lines(lines: list[int]) -> tuple[float, float]:
    """시간선들 → (첫 시간선 y, 1시간 픽셀). 직선 맞춤이라 선 하나가 1~2px 틀려도 영향이 작다."""
    g0 = float(np.median(np.diff(lines)))
    idx = [int(round((y - lines[0]) / g0)) for y in lines]
    slope, intercept = np.polyfit(idx, lines, 1)
    return float(intercept), float(slope)


def _ocr_hour_label(gray: np.ndarray, x1: int, y0: int, y1: int) -> int | None:
    """시간칸 숫자(9, 10, 1 …) 하나를 읽는다. Tesseract가 없으면 None."""
    try:
        from . import block_ocr
        if not block_ocr.available():
            return None
        import pytesseract
    except Exception:  # noqa: BLE001
        return None
    crop = gray[max(0, y0):max(0, y1), 0:max(1, x1)]
    if crop.size == 0:
        return None
    # 글자 부분만 잘라낸다 (선·여백이 섞이면 '9'를 못 읽거나 '11'을 '1'로 읽었다)
    ink = crop < (float(np.median(crop)) - 60)
    ys, xs = np.nonzero(ink)
    if ys.size < 8:
        return None
    crop = crop[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    big = cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    _, binary = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = cv2.copyMakeBorder(binary, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
    for psm in (7, 8, 10):
        try:
            text = pytesseract.image_to_string(
                binary, config=block_ocr._config(psm) + " -c tessedit_char_whitelist=0123456789"
            )
        except Exception:  # noqa: BLE001
            return None
        digits = "".join(ch for ch in text if ch.isdigit())
        if digits and len(digits) <= 2 and 1 <= int(digits) <= 12:
            return int(digits)
    return None


def _start_hour_from_labels(gray: np.ndarray, gutter_x: int, lines: list[int], hour_px: float) -> int | None:
    """맨 위 시간선이 몇 시인지 시간칸 숫자로 정한다 (11/4).

    에타는 9시 전 일정(아침 운동 등)이 있으면 시간표가 7시·8시부터 시작한다.
    예전에는 맨 위를 무조건 9시로 봐서 그런 캡처는 전체 시간이 밀렸다.
    숫자는 12시간제(9, 10, 11, 12, 1, 2 …)라서 줄 순서로 오전/오후를 정한다.
    처음 몇 줄을 읽어 다수결로 시작 시각을 고른다.
    """
    votes: dict[int, int] = {}
    y0 = lines[0]
    for y in lines[:5]:
        k = int(round((y - y0) / hour_px))  # 맨 위 선에서 몇 시간 아래인지 (빠진 선 고려)
        n = _ocr_hour_label(gray, gutter_x - 2, int(y + 2), int(y + hour_px * 0.45))
        if n is None:
            continue
        for h24 in {n % 12, n % 12 + 12}:
            start = h24 - k
            if 5 <= start <= 12:
                votes[start] = votes.get(start, 0) + 1
    if not votes:
        return None
    return max(votes.items(), key=lambda kv: (kv[1], kv[0] == 9))[0]


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

    gray = _to_light_gray(img)
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
    day_col_edges: list[tuple[int, int]] = []
    if day_region.max() > 0:
        thresh = 0.35 * float(day_region.max())
        day_xs = [gutter_x + x for x, val in enumerate(day_region) if val >= thresh]
        day_col_edges = _cluster_line_positions(day_xs)
        min_day_edge_x = gutter_x + max(4, int(w * 0.006))
        day_col_edges = [
            e for e in day_col_edges
            if e[0] < w - 5 and (e[0] + e[1]) / 2 >= min_day_edge_x
        ]

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
    column_bounds: list[tuple[int, int]] = [(0, gutter_x)]
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

    gutter_time_lines = _detect_time_lines_from_gutter(gray, gutter_x)
    # 표 위쪽(학기 탭 밑줄 등)에서 잡힌 선은 버린다. 표는 요일 세로선이 시작하는 곳부터다.
    table_top = _detect_table_top(v_lines, sep_centers)
    if table_top is not None:
        gutter_time_lines = [y for y in gutter_time_lines if y >= table_top - 4]
    if len(gutter_time_lines) >= 4:
        first_line_f, hour_px = _fit_hour_lines(gutter_time_lines)
        pixels_per_slot = hour_px / 2.0
        first_line = int(round(first_line_f))

        start_hour = _start_hour_from_labels(gray, gutter_x, gutter_time_lines, hour_px)
        if start_hour is not None:
            # grid_origin_y는 언제나 '9:00 선' 위치. 7시 시작이면 맨 위 선보다 2시간 아래.
            grid_origin_y = int(round(first_line_f + (9 - start_hour) * hour_px))
            skipped_slots = -1
        else:
            # 숫자를 못 읽으면(Tesseract 없음) 맨 위를 9시로 본다. 표 맨 위(요일 줄 위)와
            # 첫 시간선 사이가 1시간 넘게 벌어져 있으면 9:00 선을 못 찾은 것이라 그만큼 올린다.
            ref_top = table_top if table_top is not None else header_bottom
            skipped_hours = max(0, int((first_line - ref_top) / hour_px + 0.3)) if table_top is not None else \
                max(0, int((first_line - header_bottom) / pixels_per_slot + 0.5)) // 2
            skipped_slots = skipped_hours * 2
            grid_origin_y = int(first_line - skipped_hours * hour_px)

        last_y = int(gutter_time_lines[-1] + pixels_per_slot)
        slot_count = max(1, int((last_y - grid_origin_y) / pixels_per_slot + 0.5))
        row_bounds = [
            int(grid_origin_y + idx * pixels_per_slot)
            for idx in range(slot_count + 1)
        ]
        # header_bottom = 표의 맨 위 시간선 (블록은 이 아래에서만 찾는다)
        header_bottom = min(first_line, grid_origin_y)
        logger.debug(
            "detect_grid: gutter lines origin=%d pps=%.2f start_hour=%s skipped_slots=%d",
            grid_origin_y, pixels_per_slot, start_hour, skipped_slots,
        )
        return GridModel(
            column_bounds=column_bounds,
            row_bounds=row_bounds,
            start_hour=9,
            start_minute=0,
            minutes_per_step=30,
            header_bottom=header_bottom,
            pixels_per_slot=pixels_per_slot,
            grid_origin_y=grid_origin_y,
        )

    # ── 행 감지: solid(:00) / dashed(:30) 강도 분리 ──────────────────────
    # solid 실선은 h_proj 강도가 높고, dashed 점선은 낮다.
    # solid 선만으로 hour_px를 계산 → pps = hour_px / 2.
    # 이렇게 하면 :30 선이 일부만 검출돼도 pps가 왜곡되지 않는다.
    content_h_proj = h_proj.copy()
    content_h_proj[:header_bottom] = 0

    proj_max = float(content_h_proj.max()) if content_h_proj.max() > 0 else 1.0

    def _collect_row_centers(thresh_ratio: float) -> list[int]:
        idxs = [int(y) for y, val in enumerate(content_h_proj)
                if val >= thresh_ratio * proj_max]
        centers: list[int] = []
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
    row_bounds: list[int] = []
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
        deduped: list[int] = [row_bounds[0]]
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
        # 모든 solid line으로 grid_origin_y를 정밀 보정 (±2슬롯 탐색)
        grid_origin_y = _refine_grid_origin(solid_centers, grid_origin_y, pixels_per_slot)
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

def _merge_blocks(raw: list[DetectedBlock], step: float) -> list[DetectedBlock]:
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

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    merged: list[DetectedBlock] = []
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


def _row_occupancy(hsv: np.ndarray, y: int, sx0: int, sx1: int) -> float:
    row = hsv[y, sx0:sx1]
    if row.size == 0:
        return 0.0
    return float(np.mean((row[:, 1] >= 9) & (row[:, 2] >= 120)))


def _refine_block_edges(
    hsv: np.ndarray,
    sx0: int,
    sx1: int,
    by0: int,
    by1: int,
    pps: float,
    *,
    refine_top: bool,
    refine_bottom: bool,
) -> tuple[int, int]:
    """30분 칸 단위로 찾은 블록의 위/아래 경계를 실제 색 경계(픽셀)로 다듬는다.

    칸 경계 ±0.6칸 안에서 '색이 칠해진 줄'이 시작/끝나는 y를 찾는다. 못 찾으면 원래 값.
    """
    h = hsv.shape[0]
    win = max(3, int(pps * 0.6))
    if refine_top:
        lo, hi = max(0, by0 - win), min(h - 1, by0 + win)
        for y in range(lo, hi):
            if all(_row_occupancy(hsv, yy, sx0, sx1) >= 0.5 for yy in range(y, min(h, y + 3))):
                by0 = y
                break
    if refine_bottom:
        lo, hi = max(0, by1 - win), min(h - 1, by1 + win)
        for y in range(hi, lo, -1):
            if all(_row_occupancy(hsv, yy, sx0, sx1) >= 0.5 for yy in range(max(0, y - 2), y + 1)):
                by1 = y + 1
                break
    return by0, by1


def _detect_blocks_by_rows(hsv: np.ndarray, grid: GridModel, top_y: int) -> list[DetectedBlock]:
    """요일 칸마다 '색이 칠해진 줄'을 위에서 아래로 훑어 블록을 찾는다 (11/4).

    칸 안쪽(양옆 10px 뺀 부분)이 칠해진 정도와 블록 양옆 여백 띠의 색으로 블록 줄을 가린다.
    - 흰 글자가 많은 줄은 글자가 닿지 않는 블록 양옆 여백 띠로 블록 줄임을 확인한다
    - 위아래로 붙은 두 블록 사이의 흰 틈(1~3px)은 줄 전체가 하얘서 경계가 픽셀 단위로 정확하다
      (예전 30분 칸 방식은 18:00~19:45 다음 20:00 블록을 한 덩어리로 보거나,
       글자가 많은 칸의 색이 달라 보여 긴 블록을 30분씩 쪼갰다)
    - 옆 칸 블록 가장자리가 비치는 것은 양옆 10px를 빼서 피한다
    - 틈 없이 붙은 다른 색 블록은 색이 바뀌는 곳에서 나눈다
    """
    h = hsv.shape[0]
    pps = grid.pixels_per_slot
    out: list[DetectedBlock] = []
    for day_idx in range(min(7, len(grid.column_bounds) - 1)):
        x0, x1 = grid.column_bounds[day_idx + 1]
        if x1 - x0 < 30:
            continue
        def _painted(region: np.ndarray) -> np.ndarray:
            return (region[:, :, 1] >= 9) & (region[:, :, 2] >= 120)

        inner = hsv[:, x0 + 10:x1 - 10]
        paint = _painted(inner)
        occ = paint.mean(axis=1)
        # 블록 왼쪽·오른쪽 여백 띠(글자가 거의 안 오는 몇 px). 글자는 왼쪽 정렬이라
        # 한쪽 여백에 걸릴 수는 있어도 양쪽을 동시에 가리지는 않는다.
        side_on = (_painted(hsv[:, x0 + 3:x0 + 7]).mean(axis=1) >= 0.75) | (
            _painted(hsv[:, x1 - 7:x1 - 3]).mean(axis=1) >= 0.75
        )
        # 블록 줄 = 안쪽이 충분히 칠해졌거나(25%+), 여백 띠가 칠해지고 안쪽도 조금은 칠해진 줄
        # (굵은 흰 글자 줄). 여백 띠만 칠해지고 안쪽이 하얀 줄은 옆 칸 블록 가장자리가 비친 것.
        row_on = (occ >= 0.25) | (side_on & (occ >= 0.05))
        row_on[:max(0, top_y)] = False
        # 줄마다 '블록 바탕색'(흰 글자·번짐을 뺀 진한 픽셀들의 색)을 구한다
        sat_all = inner[:, :, 1].astype(float)
        p90 = np.percentile(sat_all, 90, axis=1)
        bg_hue = np.zeros(h)
        bg_val = np.zeros(h)
        for yy in np.nonzero(row_on)[0]:
            sel = sat_all[yy] >= max(9.0, 0.7 * p90[yy])
            if sel.any():
                bg_hue[yy] = float(np.median(inner[yy, sel, 0]))
                bg_val[yy] = float(np.median(inner[yy, sel, 2]))

        def _differs(a0: int, a1: int, b0: int, b1: int) -> bool:
            """두 줄 묶음의 바탕색이 다른 수업이라고 볼 만큼 다른지."""
            sa, sb = np.median(p90[a0:a1]), np.median(p90[b0:b1])
            ha, hb = np.median(bg_hue[a0:a1]), np.median(bg_hue[b0:b1])
            va, vb = np.median(bg_val[a0:a1]), np.median(bg_val[b0:b1])
            dh = min(abs(ha - hb), 180 - abs(ha - hb))
            return (dh >= 8 and min(sa, sb) >= 20) or abs(sa - sb) >= max(8.0, 0.25 * max(sa, sb)) or abs(va - vb) >= 15

        y = 0
        while y < h:
            if not row_on[y]:
                y += 1
                continue
            start = y
            while y < h and row_on[y]:
                y += 1
            end = y
            # 한 덩어리 안에서 바탕색이 바뀌는 곳(위아래로 붙은 다른 수업)에서 나눈다.
            # 위·아래 5줄씩 비교하고, 바뀐 뒤로도 계속 그 색이어야 경계로 본다(글자 줄 오판 방지).
            cuts = [start]
            margin = max(6, int(pps * 0.4))  # 블록 맨 위·아래 가장자리 번짐은 경계로 보지 않는다
            yy = start + margin
            while yy < end - margin:
                if _differs(yy - 6, yy - 1, yy + 1, yy + 6) and _differs(cuts[-1], yy - 1, yy + 1, min(end, yy + int(pps * 0.4) + 1)):
                    cuts.append(yy)
                    yy += max(6, int(pps * 0.4))
                    continue
                yy += 1
            cuts.append(end)
            for c0, c1 in zip(cuts, cuts[1:]):
                if pps > 0 and c1 - c0 >= pps * 0.4:
                    bx0, bx1 = x0 + 1, x1 - 1
                    out.append(DetectedBlock(
                        bbox=(bx0, c0, bx1, c1),
                        center_x=(bx0 + bx1) // 2,
                        top_y=c0,
                        bottom_y=c1,
                        ocr_text="",
                    ))
    return out


def detect_blocks(image_bytes: bytes, grid: GridModel) -> list[DetectedBlock]:
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

    # ── 우선: 컬럼별 색상 점유율로 블록 감지 ───────────────────────────────
    # 연한 pastel 블록은 기존 contour 방식에서 텍스트 영역만 잡히기 쉽다.
    # 각 요일 컬럼의 30분 슬롯 내부를 샘플링해 색상 채도가 일정 이상인
    # 연속 슬롯을 하나의 수업 블록으로 본다.
    if grid.pixels_per_slot > 0 and len(grid.column_bounds) >= 2:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        row_blocks = _detect_blocks_by_rows(hsv, grid, min(header_y, grid.grid_origin_y) - 2)
        if row_blocks:
            logger.debug("detect_blocks: row-scan blocks=%d", len(row_blocks))
            return row_blocks
        slot_blocks: list[DetectedBlock] = []
        # 11/4: 9:00~22:00(26칸) 고정이던 것을 표 맨 위(7시 시작 등)부터 이미지 끝(최대 24시)까지로.
        # 알바·회의처럼 22시 넘어 끝나는 개인 일정이 잘리던 문제.
        first_slot = int(round((min(header_y, grid.grid_origin_y) - grid.grid_origin_y) / grid.pixels_per_slot))
        first_slot = max(first_slot, -8)  # 05:00보다 위는 보지 않는다
        last_slot = min(int((h - grid.grid_origin_y) / grid.pixels_per_slot), 30)  # 24:00
        slot_ids = list(range(first_slot, max(first_slot + 1, last_slot)))

        for day_idx in range(min(7, len(grid.column_bounds) - 1)):
            x0, x1 = grid.column_bounds[day_idx + 1]
            if x1 <= x0:
                continue

            occupied: list[bool] = []
            ratios: list[float] = []
            colors: list[np.ndarray | None] = []
            for slot in slot_ids:
                y0 = int(grid.grid_origin_y + slot * grid.pixels_per_slot) + 5
                y1 = int(grid.grid_origin_y + (slot + 1) * grid.pixels_per_slot) - 5
                sx0, sx1 = x0 + 8, x1 - 8
                if y1 <= y0 or sx1 <= sx0:
                    occupied.append(False)
                    ratios.append(0.0)
                    colors.append(None)
                    continue
                crop = hsv[max(0, y0):min(h, y1), max(0, sx0):min(w, sx1)]
                if crop.size == 0:
                    ratio = 0.0
                    color = None
                else:
                    # grid/background sat≈0~7. Some JPEG exports darken teal
                    # timetable blocks to V≈175, so keep the value threshold low
                    # and rely primarily on saturation to distinguish blocks.
                    occ_mask = (crop[:, :, 1] >= 9) & (crop[:, :, 2] >= 120)
                    ratio = float(np.mean(occ_mask))
                    color = np.median(crop[occ_mask][:, :3], axis=0) if np.any(occ_mask) else None
                ratios.append(ratio)
                colors.append(color)
                occupied.append(ratio >= 0.35)

            run_start: int | None = None
            prev_color: np.ndarray | None = None
            for idx, is_occ in enumerate(occupied + [False]):
                color_changed = False
                if is_occ and run_start is not None and prev_color is not None and idx < len(colors):
                    cur = colors[idx]
                    if cur is not None:
                        hue_diff = min(abs(float(cur[0]) - float(prev_color[0])), 180 - abs(float(cur[0]) - float(prev_color[0])))
                        sat_diff = abs(float(cur[1]) - float(prev_color[1]))
                        val_diff = abs(float(cur[2]) - float(prev_color[2]))
                        color_changed = hue_diff >= 12 or sat_diff >= 12 or val_diff >= 10

                if is_occ and run_start is None:
                    run_start = idx
                    prev_color = colors[idx] if idx < len(colors) else None
                elif (not is_occ or color_changed) and run_start is not None:
                    run_end = idx
                    if run_end - run_start >= 1:
                        by0 = int(grid.grid_origin_y + slot_ids[run_start] * grid.pixels_per_slot)
                        by1 = int(grid.grid_origin_y + (slot_ids[run_end - 1] + 1) * grid.pixels_per_slot)
                        # 배경과 맞닿은 위/아래 경계는 픽셀 단위로 다시 찾는다
                        # (에타 50분 수업 18:50이 30분 칸에 맞춰 18:30/19:00으로 나오던 문제).
                        # 다른 색 블록과 바로 붙어 있는 경계는 칸 경계를 그대로 쓴다.
                        top_open = run_start == 0 or not occupied[run_start - 1]
                        bottom_open = not is_occ
                        by0, by1 = _refine_block_edges(
                            hsv, x0 + 8, x1 - 8, by0, by1, grid.pixels_per_slot,
                            refine_top=top_open, refine_bottom=bottom_open,
                        )
                        bx0, bx1 = x0 + 1, x1 - 1
                        slot_blocks.append(DetectedBlock(
                            bbox=(bx0, by0, bx1, by1),
                            center_x=(bx0 + bx1) // 2,
                            top_y=by0,
                            bottom_y=by1,
                            ocr_text="",
                        ))
                    run_start = idx if is_occ else None
                    prev_color = colors[idx] if is_occ and idx < len(colors) else None
                elif is_occ and idx < len(colors) and colors[idx] is not None:
                    prev_color = colors[idx]

        if slot_blocks:
            logger.debug("detect_blocks: slot occupancy blocks=%d", len(slot_blocks))
            return slot_blocks

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

    raw_blocks: list[DetectedBlock] = []
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

def _column_for_x(center_x: int, columns: list[tuple[int, int]]) -> int:
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


def _snap_to_row(y: int, row_bounds: list[int]) -> int:
    """y를 가장 가까운 row_bounds 인덱스로 스냅한다."""
    if not row_bounds:
        return 0
    diffs = [abs(y - ry) for ry in row_bounds]
    minv = min(diffs)
    candidates = [i for i, d in enumerate(diffs) if abs(d - minv) < 1e-6]
    return max(candidates)  # 동점 시 더 늦은(아래) 슬롯 선택


def _snap_end_to_row(y: int, row_bounds: list[int]) -> int:
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


TIME_ROUND_MINUTES = 5


def _px_to_time(y: int, grid: GridModel) -> str:
    """y 픽셀 → "HH:MM" (9:00 기준, 5분 단위 반올림)."""
    minutes = 9 * 60 + (y - grid.grid_origin_y) / grid.pixels_per_slot * 30
    minutes = int(round(minutes / TIME_ROUND_MINUTES) * TIME_ROUND_MINUTES)
    minutes = max(0, min(23 * 60 + 59, minutes))  # 24:00 끝은 23:59로 (스키마가 24:00을 못 받음)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _height_to_slots(top_y: int, bottom_y: int, grid: GridModel) -> int:
    """block_height / pixels_per_slot → slot 수 (최소 1)."""
    if grid.pixels_per_slot > 0:
        return max(1, int((bottom_y - top_y) / grid.pixels_per_slot + 0.5))
    return max(1, _snap_end_to_row(bottom_y, grid.row_bounds) - _px_to_slot(top_y, grid))


def infer_weekday_time(block: DetectedBlock, grid: GridModel) -> tuple[int, str, str]:
    raw_col_idx = _column_for_x(block.center_x, grid.column_bounds)
    day_idx = max(0, min(6, raw_col_idx - 1))

    if grid.pixels_per_slot > 0:
        # 11/4: 30분 칸이 아니라 실제 픽셀 위치로 계산하고 5분 단위로 반올림한다.
        # (에타는 50분 수업이 많아 16:00~18:50 같은 시간이 흔함)
        start_time = _px_to_time(block.top_y, grid)
        end_time = _px_to_time(block.bottom_y, grid)
        start_slot = _px_to_slot(block.top_y, grid)
        duration_slots = _height_to_slots(block.top_y, block.bottom_y, grid)
        end_slot = start_slot + duration_slots
        if end_time <= start_time:
            end_time = slot_to_time(end_slot)
    else:
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

def normalize_blocks(blocks: list[DetectedBlock], grid: GridModel) -> list[NormalizedEntry]:
    out: list[NormalizedEntry] = []
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
        # 시간 범위 sanity check. 11/4: 9:00~22:00 → 05:00~24:00 (아침 운동·밤 알바 같은 개인 일정)
        if t2m(start) < 5 * 60 or t2m(end) > 24 * 60:
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
