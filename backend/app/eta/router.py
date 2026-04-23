"""
ETA(Everytime Timetable Assistant) — 시간표 이미지 파싱 및 일정 저장 라우터

엔드포인트:
  POST /eta/parse-image      : 이미지 업로드 → LLM Vision 파싱 (fallback: bbox, positional)
  POST /eta/save-schedules   : 파싱된 항목을 Schedule DB에 저장
  POST /eta/parse-image-v2   : 위치기반 파서의 NormalizedEntry 반환 (레거시/디버그)

파이프라인 (parse-image):
  1. LLM Vision (parser.py) — Gemini primary / OpenAI(gpt-4o) fallback
     → flat JSON → 과목명·요일·시간 추출 → ParsedEntry[]
  2. LLM 실패 or 결과 없음 → bbox parser (bbox_parser.py, Google Vision OCR)
     → 좌표 기반 블록 감지 → ParsedEntry[]
  3. bbox 실패 → positional parser (positional_parser.py)
     → 블록 감지 → 요일/시간 추론 → ParsedEntry[] (과목명 비어있을 수 있음)
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
from typing import List, Optional

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _normalize_time(t: str) -> str:
    """
    "HH:MM" 정규화. zero-pad 없는 "9:30" → "09:30".
    유효하지 않으면 원본 반환.
    """
    if not t:
        return t
    t = t.strip()
    if _TIME_RE.match(t):
        return t
    # zero-pad 없는 경우 시도: "9:30" → "09:30"
    m = re.match(r"^(\d{1,2}):(\d{1,2})$", t)
    if m:
        h, mn = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mn <= 59:
            return f"{h:02d}:{mn:02d}"
    return t

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.schedule.models import Schedule

from .bbox_parser import parse_timetable_bbox
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

_DAY_MAP = {
    'MONDAY': 0, 'TUESDAY': 1, 'WEDNESDAY': 2,
    'THURSDAY': 3, 'FRIDAY': 4, 'SATURDAY': 5, 'SUNDAY': 6,
}
_KR_DAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']


# ── 내부 유틸 ─────────────────────────────────────────────────────────────────

def _llm_entries_to_parsed(entries: list) -> List[ParsedEntry]:
    """parser.py NormalizedEntry 목록 → ParsedEntry 목록."""
    result = []
    for e in entries:
        try:
            start_time = _normalize_time(e.start_time)
            end_time   = _normalize_time(e.end_time)
            day_label  = _KR_DAYS[e.day_of_week] if 0 <= e.day_of_week <= 6 else "?"
            raw        = f"{day_label} {start_time}~{end_time} {e.title}".strip()
            result.append(ParsedEntry(
                subject_name=e.title,
                day_of_week=e.day_of_week,
                start_time=start_time,
                end_time=end_time,
                location=getattr(e, 'location', '') or '',
                raw_text=raw,
                source="eta_llm",
            ))
        except Exception as ex:
            logger.debug("_llm_entries_to_parsed: skipping entry: %s", ex)
            continue
    return result


def _bbox_entries_to_parsed(entries: list) -> List[ParsedEntry]:
    """bbox_parser 결과 → ParsedEntry 목록."""
    result = []
    for e in entries:
        dow        = e["day_of_week"]
        start_time = _normalize_time(e["start_time"])
        end_time   = _normalize_time(e["end_time"])
        day_label  = _KR_DAYS[dow] if 0 <= dow <= 6 else "?"
        raw        = f"{day_label} {start_time}~{end_time} {e['subject_name']}".strip()
        result.append(ParsedEntry(
            subject_name=e["subject_name"],
            day_of_week=dow,
            start_time=start_time,
            end_time=end_time,
            location=e.get("location", ""),
            raw_text=raw,
            source="eta_bbox",
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
                start_time=_normalize_time(e['startTime']),
                end_time=_normalize_time(e['endTime']),
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

    entries: List[ParsedEntry] = []

    # ── 1. LLM Vision 파싱 (Gemini primary / OpenAI gpt-4o fallback) ─────
    tmp_path = None
    try:
        suffix = "." + (content_type.split("/")[-1] if "/" in content_type else "jpg")
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name
        llm_entries, _, _ = _llm_parse(tmp_path, content_type)
        if llm_entries:
            entries = _llm_entries_to_parsed(llm_entries)
            logger.info("parse_eta_image: LLM Vision returned %d entries", len(entries))
    except Exception as exc:
        logger.warning("parse_eta_image: LLM Vision failed: %s", exc)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    # ── 2. bbox 파싱 fallback (Google Cloud Vision OCR 좌표 기반) ─────────
    if not entries:
        logger.info("parse_eta_image: LLM returned no results, trying bbox fallback")
        try:
            bbox_result = parse_timetable_bbox(image_bytes)
            if bbox_result:
                entries = _bbox_entries_to_parsed(bbox_result)
                logger.info("parse_eta_image: bbox_parser returned %d entries", len(entries))
        except Exception as exc:
            logger.warning("parse_eta_image: bbox parse failed: %s", exc)

    # ── 3. Positional parser fallback ────────────────────────────────────
    if not entries:
        logger.info("parse_eta_image: using positional fallback")
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
    """ParsedEntry 목록을 Schedule DB에 저장한다. 기존 eta_import 수업을 모두 교체한다."""
    # 기존 eta_import 수업 전체 삭제 → 재업로드 시 중복 누적 방지
    deleted = db.query(Schedule).filter(
        Schedule.user_id == current_user.id,
        Schedule.schedule_source == "eta_import",
    ).delete(synchronize_session=False)
    logger.info("save_eta_schedules: deleted %d existing eta_import rows for user %d", deleted, current_user.id)

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

    _DAY_NAME = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    result: List[NormalizedEntryModel] = []

    # ── 1. LLM Vision 파싱 (Gemini primary / OpenAI gpt-4o fallback) ─────
    tmp_path = None
    try:
        suffix = "." + (content_type.split("/")[-1] if "/" in content_type else "jpg")
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name
        llm_entries, _, _ = _llm_parse(tmp_path, content_type)
        if llm_entries:
            result = [
                NormalizedEntryModel(
                    title=e.title,
                    day=e.day,
                    startTime=_normalize_time(e.start_time),
                    endTime=_normalize_time(e.end_time),
                    location=getattr(e, 'location', '') or '',
                    bbox=(0, 0, 0, 0),
                )
                for e in llm_entries
            ]
            logger.info("parse_eta_image_v2: LLM Vision returned %d entries", len(result))
    except Exception as exc:
        logger.warning("parse_eta_image_v2: LLM Vision failed: %s", exc)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    # ── 2. bbox 파싱 fallback ─────────────────────────────────────────────
    if not result:
        logger.info("parse_eta_image_v2: trying bbox fallback")
        try:
            bbox_result = parse_timetable_bbox(image_bytes)
            if bbox_result:
                result = [
                    NormalizedEntryModel(
                        title=e["subject_name"],
                        day=_DAY_NAME[e["day_of_week"]],
                        startTime=_normalize_time(e["start_time"]),
                        endTime=_normalize_time(e["end_time"]),
                        location=e.get("location", ""),
                        bbox=(0, 0, 0, 0),
                    )
                    for e in bbox_result
                ]
                logger.info("parse_eta_image_v2: bbox_parser returned %d entries", len(result))
        except Exception as exc:
            logger.warning("parse_eta_image_v2: bbox parse failed: %s", exc)

    # ── 3. Positional fallback ────────────────────────────────────────────
    if not result:
        logger.info("parse_eta_image_v2: using positional fallback")
        try:
            _, pos_entries = parse_image_positional(image_bytes)
            result = [
                NormalizedEntryModel(
                    title=e.get('title', ''),
                    day=e['day'],
                    startTime=_normalize_time(e['startTime']),
                    endTime=_normalize_time(e['endTime']),
                    location=e.get('location', ''),
                    bbox=e.get('bbox', (0, 0, 0, 0)),
                )
                for e in pos_entries
            ]
            logger.info("parse_eta_image_v2: positional fallback returned %d entries", len(result))
        except Exception as exc:
            logger.warning("parse_eta_image_v2: positional fallback failed: %s", exc)

    return result
