"""
Everytime 등에서 캡처한 시간표 이미지를 파싱하고 결과를 일정으로 저장하는 엔드포인트.

POST /eta/parse-image    : 이미지 업로드 → LLM Vision 파싱 결과 반환
POST /eta/save-schedules : 확정된 항목을 Schedule DB에 저장
POST /eta/parse-image-v2 : 위치 기반 파서 결과 반환
"""

import logging
import os
import re
import tempfile
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.core.llm import (
    LLMEmptyResponseError,
    LLMProviderUnavailableError,
    LLMRateLimitedError,
)
from app.schedule.service import stage_schedule_record
from app.utils.time_utils import DAY_NAMES as KR_DAYS

from .location_utils import normalize_location
from .positional_parser import NAME_TO_DOW, parse_image_positional


# ── 스키마 ────────────────────────────────────────────────────────────────────

class ParsedEntry(BaseModel):
    subject_name: str
    day_of_week: int  # 0=월 ... 6=일
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    location: Optional[str] = None
    raw_text: Optional[str] = None
    source: str = "eta_image"
    requires_review: bool = False


class SaveSchedulesRequest(BaseModel):
    entries: list[ParsedEntry]


class NormalizedEntryModel(BaseModel):
    title: str
    day: str
    startTime: str
    endTime: str
    location: str = ""
    bbox: tuple[int, int, int, int]


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eta", tags=["eta"])

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB


def _time_to_minutes(t: str) -> int:
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return -1


def _ranges_overlap(a_start: str, a_end: str, b_start: str, b_end: str) -> int:
    a0, a1, b0, b1 = map(_time_to_minutes, (a_start, a_end, b_start, b_end))
    if min(a0, a1, b0, b1) < 0:
        return 0
    return max(0, min(a1, b1) - max(a0, b0))


def _time_duration(start: str, end: str) -> int:
    s = _time_to_minutes(start)
    e = _time_to_minutes(end)
    if min(s, e) < 0:
        return -1
    return max(0, e - s)


def _time_edge_distance(text: "ParsedEntry", geom: "ParsedEntry") -> float:
    ts = _time_to_minutes(text.start_time)
    te = _time_to_minutes(text.end_time)
    gs = _time_to_minutes(geom.start_time)
    ge = _time_to_minutes(geom.end_time)
    if min(ts, te, gs, ge) < 0:
        return 9999.0
    return (abs(ts - gs) + abs(te - ge)) / 2.0


def _to_review(e: ParsedEntry, source: str | None = None) -> ParsedEntry:
    e.requires_review = True
    if source:
        e.source = source
    return e


def _is_valid_subject_name(subject: str) -> bool:
    s = subject.strip()
    if not s:
        return False
    if s in {"수업", "강의", "class", "CLASS", "Unknown", "unknown", "N/A"}:
        return False
    if re.fullmatch(r"\d+", s):
        return False
    if s.count("(") != s.count(")") or s.count("[") != s.count("]"):
        return False
    if s.startswith((")", "]")) or s.endswith(("(", "[")):
        return False
    return True


def _valid_time_range(start: str, end: str) -> bool:
    sm = _time_to_minutes(start)
    em = _time_to_minutes(end)
    return 9 * 60 <= sm < em <= 22 * 60


def _filter_entries(entries: list[ParsedEntry], *, allow_empty_subject: bool = False) -> list[ParsedEntry]:
    filtered: list[ParsedEntry] = []
    for e in entries:
        if not (0 <= e.day_of_week <= 6):
            continue
        if not _valid_time_range(e.start_time, e.end_time):
            continue
        if not allow_empty_subject and not _is_valid_subject_name(e.subject_name):
            continue
        if allow_empty_subject and e.subject_name and not _is_valid_subject_name(e.subject_name):
            e.subject_name = ""
            e.requires_review = True
        filtered.append(e)
    return _dedup_entries(filtered)


def _parse_via_positional(image_bytes: bytes) -> list[ParsedEntry]:
    """색상 블록 위치로 요일/시간을 추출한다. 과목명은 비어 있을 수 있다."""
    _grid, norm = parse_image_positional(image_bytes)
    out: list[ParsedEntry] = []
    for e in norm:
        dow = NAME_TO_DOW.get(e["day"], 0)
        title = (e.get("title") or "").strip()
        if title == "수업":
            title = ""
        out.append(
            ParsedEntry(
                subject_name=title,
                day_of_week=dow,
                start_time=e["startTime"],
                end_time=e["endTime"],
                location=normalize_location(e.get("location") or ""),
                raw_text=f"{KR_DAYS[dow]} {e['startTime']}~{e['endTime']}",
                source="eta_image_positional",
                requires_review=not bool(title),
            )
        )
    return out


def _parse_via_refined_llm(image_bytes: bytes, content_type: str) -> list[ParsedEntry]:
    """정교한 LLM Vision 파서를 사용해 과목명/강의실을 추출한다."""
    from app.eta.parser import parse_timetable_image

    suffix = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(content_type, ".jpg")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        entries, _grid, provider = parse_timetable_image(tmp_path, content_type)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    out: list[ParsedEntry] = []
    for e in entries:
        out.append(
            ParsedEntry(
                subject_name=e.title,
                day_of_week=e.day_of_week,
                start_time=e.start_time,
                end_time=e.end_time,
                location=normalize_location(e.location) or None,
                raw_text=e.source.ocr_text or None,
                source=f"eta_image_{provider}",
                requires_review=e.source.time_confidence < 0.8 or not bool(e.title.strip()),
            )
        )
    return out


def _time_distance_score(text: ParsedEntry, geom: ParsedEntry) -> float:
    avg_edge_distance = _time_edge_distance(text, geom)
    if avg_edge_distance >= 9999:
        return -1.0
    overlap = _ranges_overlap(text.start_time, text.end_time, geom.start_time, geom.end_time)
    closeness = max(0.0, 90.0 - avg_edge_distance)
    return overlap * 2.0 + closeness


def _correct_text_with_geometry(
    text_entries: list[ParsedEntry],
    geometry_entries: list[ParsedEntry],
) -> list[ParsedEntry]:
    """
    LLM이 과목명은 잘 읽지만 블록 높이를 짧게 잡는 경우,
    위치 기반 블록과 1:1 매칭해 요일/시간을 보정한다.
    """
    if not text_entries or not geometry_entries:
        return text_entries

    candidates: list[tuple[float, int, int]] = []
    for ti, text in enumerate(text_entries):
        for gi, geom in enumerate(geometry_entries):
            base = _time_distance_score(text, geom)
            same_day = text.day_of_week == geom.day_of_week
            overlap = _ranges_overlap(text.start_time, text.end_time, geom.start_time, geom.end_time)
            edge_distance = _time_edge_distance(text, geom)
            duration_delta = abs(
                _time_duration(text.start_time, text.end_time)
                - _time_duration(geom.start_time, geom.end_time)
            )
            if base <= 0:
                if not same_day or edge_distance > 180 or duration_delta > 120:
                    continue
                base = max(1.0, 60.0 - edge_distance / 3.0)

            if not same_day and overlap < 60:
                if edge_distance > 75 or duration_delta > 90:
                    continue

            score = base
            if same_day:
                score += 120
            elif overlap == 0 and edge_distance <= 75 and duration_delta <= 30:
                score += 25
            if text.start_time == geom.start_time:
                score += 25
            if text.end_time == geom.end_time:
                score += 25
            candidates.append((score, ti, gi))

    candidates.sort(reverse=True)
    assigned_text: dict[int, int] = {}
    used_geom: set[int] = set()
    for score, ti, gi in candidates:
        if ti in assigned_text or gi in used_geom:
            continue
        if score < 45:
            continue
        assigned_text[ti] = gi
        used_geom.add(gi)

    corrected: list[ParsedEntry] = []
    for ti, text in enumerate(text_entries):
        gi = assigned_text.get(ti)
        if gi is None:
            corrected.append(text)
            continue

        geom = geometry_entries[gi]
        if (
            text.day_of_week == geom.day_of_week
            and text.start_time == geom.start_time
            and text.end_time == geom.end_time
        ):
            corrected.append(text)
            continue

        corrected.append(
            ParsedEntry(
                subject_name=text.subject_name,
                day_of_week=geom.day_of_week,
                start_time=geom.start_time,
                end_time=geom.end_time,
                location=normalize_location(text.location),
                raw_text=text.raw_text,
                source=f"{text.source}+time_corrected",
                requires_review=True,
            )
        )

    return _dedup_entries(corrected)


async def _read_image_file(file: UploadFile) -> tuple[bytes, str]:
    """이미지 파일 유효성 검사 후 (bytes, content_type) 반환."""
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail=f"지원하지 않는 파일 형식: {content_type}")
    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 20MB)")
    if len(image_bytes) == 0:
        raise HTTPException(status_code=422, detail="Empty file")
    return image_bytes, content_type


def _dedup_entries(entries: List[ParsedEntry]) -> List[ParsedEntry]:
    seen: set = set()
    result: List[ParsedEntry] = []

    for e in entries:
        key = (e.subject_name.strip(), e.day_of_week, e.start_time, e.end_time)
        if key not in seen:
            seen.add(key)
            e.location = normalize_location(e.location)
            result.append(e)

    return result


@router.post("/parse-image", response_model=List[ParsedEntry])
async def parse_eta_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    이미지 기반 시간표 파싱.

    - 1순위: LLM Vision 파서 (과목명 + 시간 추출)
    - 보정: 위치 기반 파서로 LLM 시간 오류 교정
    - fallback: LLM 실패 시 위치 기반 결과만 반환 (requires_review=true)
    """
    image_bytes, content_type = await _read_image_file(file)

    geometry_entries: list[ParsedEntry] = []
    try:
        geometry_entries = _filter_entries(_parse_via_positional(image_bytes), allow_empty_subject=True)
    except Exception as exc:
        logger.warning(f"ETA parse: positional parser failed (user={current_user.id}): {exc}")

    text_entries: list[ParsedEntry] = []
    try:
        text_entries = _filter_entries(_parse_via_refined_llm(image_bytes, content_type))
    except (LLMRateLimitedError, LLMProviderUnavailableError, LLMEmptyResponseError) as exc:
        logger.warning(f"ETA parse: LLM unavailable: {exc}")
    except Exception as exc:
        logger.warning(f"ETA parse: LLM failed (user={current_user.id}): {exc}", exc_info=True)

    if text_entries:
        result = _correct_text_with_geometry(text_entries, geometry_entries)
        logger.info("ETA parse: geometry=%d returned=%d user=%s", len(geometry_entries), len(result), current_user.id)
        return result

    logger.info("ETA parse: LLM failed, positional only: geometry=%d user=%s", len(geometry_entries), current_user.id)
    return [_to_review(e, "eta_image_positional") for e in geometry_entries]


@router.post("/save-schedules")
def save_eta_schedules(
    body: SaveSchedulesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    사용자가 검토 완료한 ETA 시간표 항목들을 반복 일정(date=None)으로 DB에 저장한다.
    """
    saved_count = 0
    skipped_count = 0

    for entry in body.entries:
        if not entry.subject_name.strip():
            skipped_count += 1
            continue
        if not entry.start_time or not entry.end_time:
            skipped_count += 1
            continue
        if entry.start_time >= entry.end_time:
            skipped_count += 1
            continue
        if not (0 <= entry.day_of_week <= 6):
            skipped_count += 1
            continue

        stage_schedule_record(db, current_user.id, {
            "title": entry.subject_name.strip(),
            "day_of_week": entry.day_of_week,
            "date": None,
            "start_time": entry.start_time,
            "end_time": entry.end_time,
            "location": normalize_location(entry.location),
            "color": "#1a4db2",
            "schedule_type": "class",
            "schedule_source": "eta_import",
            "priority": 0,
            "is_completed": False,
        })
        saved_count += 1

    db.commit()
    logger.info(f"ETA: saved {saved_count} schedules for user {current_user.id} (skipped={skipped_count})")
    return {"saved": saved_count, "skipped": skipped_count}


@router.post("/parse-image-v2", response_model=List[NormalizedEntryModel])
async def parse_eta_image_v2(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """위치 기반 파서 결과를 반환한다."""
    image_bytes, _ = await _read_image_file(file)
    _grid, entries = parse_image_positional(image_bytes)

    if not entries:
        return []

    return entries
