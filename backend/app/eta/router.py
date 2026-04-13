"""
ETA(Everytime Timetable Assistant) — 시간표 이미지 파싱 및 일정 저장 라우터

엔드포인트:
  POST /eta/parse-image      : 이미지 업로드 → LLM Vision 파싱 (fallback: positional)
  POST /eta/save-schedules   : 파싱된 항목을 Schedule DB에 저장
  POST /eta/parse-image-v2   : 위치기반 파서의 NormalizedEntry 반환 (레거시/디버그)

파이프라인 (parse-image):
  1. LLM Vision (parser.py)
     → flat JSON → 과목명·요일·시간 추출 → ParsedEntry[]
  2. LLM 실패 or 결과 없음 → positional parser (positional_parser.py)
     → 블록 감지 → 요일/시간 추론 → ParsedEntry[] (과목명 비어있을 수 있음)
"""
from __future__ import annotations

import logging
import os
import tempfile
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.schedule.models import Schedule

from .parser import parse_timetable_image as _llm_parse
from .positional_parser import parse_image_positional
from .positional_types import NormalizedEntry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eta", tags=["eta"])


# ── 스키마 ────────────────────────────────────────────────────────────────────

class ParsedEntry(BaseModel):
    subject_name: str
    requires_review: bool = False
    day_of_week: int          # 0=월 … 6=일
    start_time: str           # HH:MM
    end_time: str             # HH:MM
    location: str = ""        # 강의실 (선택)
    raw_text: Optional[str] = None
    source: str = "eta_image"


class SaveSchedulesRequest(BaseModel):
    entries: List[ParsedEntry]


class NormalizedEntryModel(BaseModel):
    title: str
    day: str
    startTime: str
    endTime: str
    location: str
    bbox: tuple[int, int, int, int]


# ── 상수 ─────────────────────────────────────────────────────────────────────

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB

_EXT_MAP = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

_DAY_MAP = {
    'MONDAY': 0, 'TUESDAY': 1, 'WEDNESDAY': 2,
    'THURSDAY': 3, 'FRIDAY': 4, 'SATURDAY': 5, 'SUNDAY': 6,
}
_KR_DAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']


# ── 내부 유틸 ─────────────────────────────────────────────────────────────────

def _llm_entries_to_parsed(entries) -> List[ParsedEntry]:
    """LLM NormalizedEntry 목록 → ParsedEntry 목록."""
    result = []
    for e in entries:
        dow = e.day_of_week  # 0-based
        day_label = _KR_DAYS[dow] if 0 <= dow <= 6 else "?"
        raw = f"{day_label} {e.start_time}~{e.end_time} {e.title}".strip()
        result.append(ParsedEntry(
            subject_name=e.title,
            day_of_week=dow,
            start_time=e.start_time,
            end_time=e.end_time,
            location=e.location,
            raw_text=raw,
            source="eta_llm",
        ))
    return result


def _positional_entries_to_parsed(norm_entries: list) -> List[ParsedEntry]:
    """positional parser NormalizedEntry TypedDict 목록 → ParsedEntry 목록."""
    result = []
    for e in norm_entries:
        try:
            dow = _DAY_MAP.get(e['day'], 0)
            title = (e.get('title') or '').strip()
            # positional fallback: 과목명 없는 경우 requires_review=True
            needs_review = not title
            day_label = _KR_DAYS[dow]
            raw = f"{day_label} {e['startTime']}~{e['endTime']}"
            result.append(ParsedEntry(
                subject_name=title,
                requires_review=needs_review,
                day_of_week=dow,
                start_time=e['startTime'],
                end_time=e['endTime'],
                location=e.get('location', ''),
                raw_text=raw,
                source="eta_positional",
            ))
        except Exception as ex:
            logger.debug("_positional_entries_to_parsed: skipping entry: %s", ex)
            continue
    return result


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/parse-image", response_model=List[ParsedEntry])
async def parse_eta_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    에브리타임 시간표 이미지 → ParsedEntry 목록.

    1단계: LLM Vision (Gemini) 파싱 시도
    2단계: LLM 실패 or 결과 없음 → positional parser fallback
    """
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported content type: {content_type}")
    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 20MB)")
    if not image_bytes:
        raise HTTPException(status_code=422, detail="Empty file")

    suffix = _EXT_MAP.get(content_type, ".jpg")
    entries: List[ParsedEntry] = []

    # ── 1. LLM Vision 파싱 ────────────────────────────────────────────────
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name
        try:
            llm_entries, _, provider = _llm_parse(tmp_path, content_type)
            if llm_entries:
                entries = _llm_entries_to_parsed(llm_entries)
                logger.info(
                    "parse_eta_image: LLM returned %d entries (provider=%s)",
                    len(entries), provider,
                )
        finally:
            os.unlink(tmp_path)
    except Exception as exc:
        logger.warning("parse_eta_image: LLM parse failed: %s", exc)

    # ── 2. Positional parser fallback ────────────────────────────────────
    if not entries:
        logger.info("parse_eta_image: LLM returned no results, using positional fallback")
        try:
            _, pos_norm = parse_image_positional(image_bytes)
            entries = _positional_entries_to_parsed(pos_norm)
            logger.info("parse_eta_image: positional fallback returned %d entries", len(entries))
        except Exception as exc:
            logger.warning("parse_eta_image: positional fallback failed: %s", exc)

    return entries


@router.post("/save-schedules")
def save_eta_schedules(
    body: SaveSchedulesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ParsedEntry 목록을 Schedule DB에 저장한다."""
    saved = 0
    skipped = 0
    for entry in body.entries:
        if not entry.subject_name.strip():
            skipped += 1
            continue
        if not entry.start_time or not entry.end_time:
            skipped += 1
            continue
        if entry.start_time >= entry.end_time:
            skipped += 1
            continue
        if not (0 <= entry.day_of_week <= 6):
            skipped += 1
            continue
        sch = Schedule(
            user_id=current_user.id,
            title=entry.subject_name.strip(),
            day_of_week=entry.day_of_week,
            date=None,
            start_time=entry.start_time,
            end_time=entry.end_time,
            location=entry.location or None,
            color="#1a4db2",
            schedule_type="class",
            schedule_source="eta_import",
            priority=0,
            is_completed=False,
        )
        db.add(sch)
        saved += 1
    db.commit()
    logger.info("save_eta_schedules: saved=%d skipped=%d for user %d", saved, skipped, current_user.id)
    return {"saved": saved, "skipped": skipped}


@router.post("/parse-image-v2", response_model=List[NormalizedEntryModel])
async def parse_eta_image_v2(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    레거시/디버그용: LLM Vision → NormalizedEntryModel (camelCase).
    프론트 온보딩에서 이 엔드포인트를 사용함.
    """
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported content type: {content_type}")
    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 20MB)")
    if not image_bytes:
        raise HTTPException(status_code=422, detail="Empty file")

    suffix = _EXT_MAP.get(content_type, ".jpg")
    result: List[NormalizedEntryModel] = []

    # ── 1. LLM Vision ────────────────────────────────────────────────────
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name
        try:
            llm_entries, _, provider = _llm_parse(tmp_path, content_type)
            if llm_entries:
                result = [
                    NormalizedEntryModel(
                        title=e.title,
                        day=e.day,
                        startTime=e.start_time,
                        endTime=e.end_time,
                        location=e.location,
                        bbox=(0, 0, 0, 0),
                    )
                    for e in llm_entries
                ]
                logger.info("parse_eta_image_v2: LLM returned %d entries (provider=%s)", len(result), provider)
        finally:
            os.unlink(tmp_path)
    except Exception as exc:
        logger.warning("parse_eta_image_v2: LLM parse failed: %s", exc)

    # ── 2. Positional fallback ────────────────────────────────────────────
    if not result:
        logger.info("parse_eta_image_v2: using positional fallback")
        try:
            _, pos_entries = parse_image_positional(image_bytes)
            result = [
                NormalizedEntryModel(
                    title=e.get('title', ''),
                    day=e['day'],
                    startTime=e['startTime'],
                    endTime=e['endTime'],
                    location=e.get('location', ''),
                    bbox=e.get('bbox', (0, 0, 0, 0)),
                )
                for e in pos_entries
            ]
            logger.info("parse_eta_image_v2: positional fallback returned %d entries", len(result))
        except Exception as exc:
            logger.warning("parse_eta_image_v2: positional fallback failed: %s", exc)

    return result
