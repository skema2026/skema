"""
EasyOCR + OpenCV 위치 기반 파서.

파이프라인:
    1. positional_parser → 그리드·색상 블록 감지 (요일·시간 추정)
    2. EasyOCR           → 각 블록 bbox를 크롭해서 텍스트 추출
    3. normalize_blocks  → 요일·시간·과목명 완성

위치 기반 파서 대비 장점 : API 키 없이 과목명 인식
LLM Vision  대비 장점   : 무료, 빠름, 오프라인 동작
"""
from __future__ import annotations

import logging
from typing import List, Tuple

import numpy as np

from .location_utils import normalize_location

logger = logging.getLogger(__name__)

# EasyOCR Reader 싱글톤 — 첫 호출 시 모델 다운로드 (~300 MB)
_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        try:
            import easyocr
        except ImportError:
            raise ImportError(
                "easyocr가 설치되지 않았습니다. "
                "pip install easyocr 를 실행하세요."
            )
        logger.info("EasyOCR Reader 초기화 중 (첫 실행 시 모델 다운로드)…")
        _reader = easyocr.Reader(["ko", "en"], gpu=False, verbose=False)
        logger.info("EasyOCR Reader 준비 완료")
    return _reader


def _ocr_block(
    reader,
    img: np.ndarray,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
) -> Tuple[str, str]:
    """
    블록 bbox를 크롭해서 (subject_name, location)을 반환한다.

    - y 좌표 기준 위쪽 텍스트 = 과목명
    - 아래쪽 텍스트 = 강의실 (있으면)
    - confidence 0.3 미만은 버림
    """
    pad = 4
    h, w = img.shape[:2]
    cx0, cy0 = max(0, x0 - pad), max(0, y0 - pad)
    cx1, cy1 = min(w, x1 + pad), min(h, y1 + pad)
    crop = img[cy0:cy1, cx0:cx1]

    if crop.size == 0 or crop.shape[0] < 8 or crop.shape[1] < 8:
        return "", ""

    # detail=1 → [(bbox_quad, text, conf), ...]
    results = reader.readtext(crop, detail=1, paragraph=False)
    if not results:
        return "", ""

    # y 중심 기준 정렬
    def _y_center(r):
        quad = r[0]
        return sum(pt[1] for pt in quad) / len(quad)

    filtered = [(r[1].strip(), r[2]) for r in sorted(results, key=_y_center)
                if r[2] >= 0.3 and r[1].strip()]

    if not filtered:
        return "", ""

    subject_name = filtered[0][0]
    location = normalize_location(filtered[1][0] if len(filtered) > 1 else "")
    return subject_name, location


def parse_timetable_easyocr(image_bytes: bytes) -> List[dict]:
    """
    EasyOCR + 위치 기반 파서로 시간표를 파싱한다.

    Returns:
        [{"subject_name", "day_of_week", "start_time", "end_time", "location"}, ...]
    """
    from .positional_parser import detect_grid, detect_blocks, normalize_blocks, _load_image
    from .positional_types import NAME_TO_DOW

    # ── 1. 그리드·블록 감지 (OpenCV) ─────────────────────────────────────
    grid = detect_grid(image_bytes)
    blocks = detect_blocks(image_bytes, grid)

    if not blocks:
        logger.info("easyocr_parser: no blocks detected")
        return []

    logger.info("easyocr_parser: %d blocks detected, running OCR…", len(blocks))

    # ── 2. 각 블록에서 EasyOCR 텍스트 추출 ───────────────────────────────
    reader = _get_reader()
    img = _load_image(image_bytes)

    locations: dict[int, str] = {}
    for idx, block in enumerate(blocks):
        x0, y0, x1, y1 = block.bbox
        subject_name, location = _ocr_block(reader, img, x0, y0, x1, y1)
        block.ocr_text = subject_name
        locations[idx] = location

    # ── 3. 요일·시간 정규화 ──────────────────────────────────────────────
    entries_norm = normalize_blocks(blocks, grid)

    # ── 4. 최종 형식으로 변환 ─────────────────────────────────────────────
    result = []
    for idx, e in enumerate(entries_norm):
        dow = NAME_TO_DOW.get(e["day"], 0)
        result.append({
            "subject_name": e["title"],
            "day_of_week": dow,
            "start_time": e["startTime"],
            "end_time": e["endTime"],
            "location": locations.get(idx, ""),
        })

    logger.info("easyocr_parser: %d entries returned", len(result))
    return result
