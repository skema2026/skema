"""
Everytime 등에서 캡처한 시간표 이미지를 파싱하고 결과를 일정으로 저장하는 엔드포인트.

POST /eta/parse-image    : 이미지 업로드 → Gemini Vision 파싱 결과 반환
POST /eta/save-schedules : 확정된 항목을 Schedule DB에 저장
POST /eta/parse-image-v2 : 위치 기반 파서 결과 반환
"""

import json
import logging
import os
import re
import tempfile
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.core.llm import (
    LLMEmptyResponseError,
    LLMProviderUnavailableError,
    LLMRateLimitedError,
    call_llm_vision,
)
from app.schedule.models import Schedule
from app.utils.text_validation import normalize_korean_field

from .positional_parser import parse_image_positional
from .time_utils import parse_time_range, parse_time_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eta", tags=["eta"])


class ParsedEntry(BaseModel):
    subject_name: str
    day_of_week: int  # 0=월 ... 6=일
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    raw_text: Optional[str] = None
    source: str = "eta_image"
    requires_review: bool = False


class SaveSchedulesRequest(BaseModel):
    entries: List[ParsedEntry]


class NormalizedEntryModel(BaseModel):
    title: str
    day: str
    startTime: str
    endTime: str
    location: str = ""
    bbox: tuple[int, int, int, int]


KR_DAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB


_PARSE_PROMPT = """
IMPORTANT TEXT RULES:
- 한국어 텍스트는 그대로 보존한다.
- 한국어를 번역하지 않는다.
- 한국어를 한자()로 치환하지 않는다.
- 원문이 한국어라면 결과도 한국어로 작성한다.
- 과목명/장소 등 고유명사는 원문 그대로 유지한다.

입력은 Everytime 등 대학 시간표 스크린샷이다. 화면 특징:
- 위쪽에 시간대(9,10,11,12,1,2,3,4,5,6,7,8)가 가로로 표시됨.
- 왼쪽에 요일 컬럼(월~일)이 세로로 표시됨.
- 24시간 표기. 예: 2:30 → 14:30 으로 정규화.

출력: JSON 배열. 각 항목은 다음 필드를 포함한다.
- subject_name: string (과목/제목)
- day_of_week: integer (0=월, 1=화, …, 6=일)
- start_time: "HH:MM" (24h)
- end_time:   "HH:MM" (24h)
- raw_text:   원본에서 읽은 한 줄(가능하면)
- requires_review: boolean

규칙:
- 시간은 반드시 HH:MM(24h)로 표준화한다.
- 동일 제목이 여러 요일/시간에 반복되면 각 항목으로 분리한다.
- 모호하거나 해석이 어려우면 requires_review=true 로 표시한다.
- JSON 배열만 출력한다. 마크다운 코드블록은 사용하지 않는다.
"""


def _fallback_positional(image_bytes: bytes) -> list[ParsedEntry]:
    try:
        _grid, norm = parse_image_positional(image_bytes)

        out: list[ParsedEntry] = []
        for e in norm:
            try:
                day_map = {
                    "MONDAY": 0,
                    "TUESDAY": 1,
                    "WEDNESDAY": 2,
                    "THURSDAY": 3,
                    "FRIDAY": 4,
                    "SATURDAY": 5,
                    "SUNDAY": 6,
                }
                dow = day_map.get(e["day"], 0)
                subj = (e.get("title") or "").strip()
                if subj == "수업":
                    subj = ""

                rt = f"{KR_DAYS[dow]} {e['startTime']}~{e['endTime']}"

                out.append(
                    ParsedEntry(
                        subject_name=subj,
                        day_of_week=dow,
                        start_time=e["startTime"],
                        end_time=e["endTime"],
                        raw_text=rt,
                        source="eta_image_positional",
                    )
                )
            except Exception:
                continue

        return out
    except Exception as exc:
        logger.warning(f"ETA positional fallback failed: {exc}")
        return []


def _apply_everytime_pm(t: str) -> str:
    """
    Everytime 스타일 시간 표기 보정:
    1~8시는 오후 시간으로 해석해 +12 처리한다.
    """
    if not t:
        return t

    t = t.strip()
    parts = t.split(":")
    if len(parts) < 2:
        return t

    try:
        h = int(parts[0])
        m = int(parts[1][:2])
    except ValueError:
        return t

    if 1 <= h <= 8:
        h += 12

    return f"{h:02d}:{m:02d}"


def _normalize_time(t: str) -> str:
    """
    시간 문자열을 HH:MM 24시간제 + 30분 단위로 정규화.
    """
    if not t:
        return "00:00"

    t = t.strip()

    range_m = re.match(r"(\d{1,2}:\d{2})\s*[~\-]\s*\d{1,2}:\d{2}", t)
    if range_m:
        t = range_m.group(1)

    parts = t.split(":")
    if len(parts) >= 2:
        try:
            h, m = int(parts[0]), int(parts[1])
            if not (0 <= h <= 23 and 0 <= m <= 59):
                return "00:00"

            if m < 15:
                m = 0
            elif m < 45:
                m = 30
            else:
                m = 0
                h += 1

            if h > 23:
                return "23:30"

            return f"{h:02d}:{m:02d}"
        except ValueError:
            pass

    return "00:00"


def _dedup_entries(entries: List[ParsedEntry]) -> List[ParsedEntry]:
    seen: set = set()
    result: List[ParsedEntry] = []

    for e in entries:
        key = (e.subject_name.strip(), e.day_of_week, e.start_time, e.end_time)
        if key not in seen:
            seen.add(key)
            result.append(e)

    return result


def _extract_json(text: str) -> list:
    """
    모델 응답 텍스트에서 JSON 배열만 추출한다.
    """
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = text.replace("```", "").strip()

    start = text.find("[")
    end = text.rfind("]") + 1

    if start == -1 or end == 0:
        return []

    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError as exc:
        logger.warning(f"ETA JSON decode error: {exc} | snippet={text[start:start+300]}")
        return []


def _parse_via_gemini(image_bytes: bytes, content_type: str) -> List[ParsedEntry]:
    """
    Gemini Vision(또는 fallback provider)으로 이미지에서 시간표 항목을 추출한다.
    """
    suffix = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(content_type, ".jpg")

    tmp_path = None
    llm_result = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        llm_result = call_llm_vision(
            tmp_path,
            content_type,
            _PARSE_PROMPT,
            temperature=0.1,
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    if llm_result is None or not llm_result.content:
        logger.warning("ETA: vision LLM returned empty response")
        return []

    raw_text = llm_result.content

    if llm_result.status == "fallback_used":
        logger.info(
            f"ETA vision used fallback: provider={llm_result.provider} model={llm_result.model}"
        )

    logger.debug(f"ETA vision response ({len(raw_text)} chars) via {llm_result.provider}")

    data = _extract_json(raw_text)

    if not data and raw_text.strip():
        logger.info("ETA: no entries on first parse, attempting re-extract")
        try:
            cleaned = re.sub(r"```(?:json)?", "", raw_text).strip()
            data = _extract_json(cleaned)
        except Exception as exc:
            logger.warning(f"ETA re-extract failed: {exc}")

    entries: List[ParsedEntry] = []

    for item in data:
        try:
            subject = str(item.get("subject_name", "")).strip()
            subject, review_flag = normalize_korean_field(
                subject,
                str(item.get("raw_text", "")),
            )

            dow = int(item.get("day_of_week", -1))
            if not (0 <= dow <= 6):
                logger.debug(f"ETA: invalid day_of_week={dow} for '{subject}', skipping")
                continue

            st = parse_time_token(str(item.get("start_time", ""))) or (
                parse_time_range(str(item.get("raw_text", "")))[0] or ""
            )
            et = parse_time_token(str(item.get("end_time", ""))) or (
                parse_time_range(str(item.get("raw_text", "")))[1] or ""
            )

            st = _apply_everytime_pm(st)
            et = _apply_everytime_pm(et)

            st = _normalize_time(st)
            et = _normalize_time(et)

            if st == "00:00" and et == "00:00":
                logger.debug(f"ETA: could not parse times for '{subject}', skipping")
                continue

            if st >= et:
                logger.debug(f"ETA: start_time >= end_time for '{subject}' ({st}~{et}), skipping")
                continue

            entries.append(
                ParsedEntry(
                    subject_name=subject,
                    day_of_week=dow,
                    start_time=st,
                    end_time=et,
                    raw_text=item.get("raw_text") or None,
                    source="eta_image",
                    requires_review=bool(item.get("requires_review", False) or review_flag),
                )
            )
        except (ValueError, TypeError) as exc:
            logger.debug(f"ETA: malformed entry {item} | {exc}")
            continue

    result = _dedup_entries(entries)
    logger.info(f"ETA: extracted {len(result)} unique entries from image")
    return result


@router.post("/parse-image", response_model=List[ParsedEntry])
async def parse_eta_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    이미지 기반 시간표를 LLM Vision으로 파싱.
    실패 또는 결과 없음이면 위치 기반 파서로 폴백.
    """
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"지원하지 않는 파일 형식: {content_type}",
        )

    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 20MB)")
    if len(image_bytes) == 0:
        raise HTTPException(status_code=422, detail="Empty file")

    try:
        entries = _parse_via_gemini(image_bytes, content_type)
    except HTTPException:
        raise
    except (LLMRateLimitedError, LLMProviderUnavailableError, LLMEmptyResponseError) as exc:
        logger.warning(f"ETA parse: LLM unavailable, falling back: {exc}")
        fb = _fallback_positional(image_bytes)
        if fb:
            return fb
        return []
    except Exception as exc:
        logger.error(
            f"ETA image parse unexpected error (user={current_user.id}): {exc}",
            exc_info=True,
        )
        return []

    if not entries:
        fb2 = _fallback_positional(image_bytes)
        if fb2:
            return fb2

    return entries


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

    for entry in body.entries:
        if not entry.subject_name.strip():
            continue
        if not entry.start_time or not entry.end_time:
            continue
        if entry.start_time >= entry.end_time:
            continue
        if not (0 <= entry.day_of_week <= 6):
            continue

        sch = Schedule(
            user_id=current_user.id,
            title=entry.subject_name.strip(),
            day_of_week=entry.day_of_week,
            date=None,
            start_time=entry.start_time,
            end_time=entry.end_time,
            color="#1a4db2",
            schedule_type="class",
            schedule_source="eta_import",
            priority=0,
            is_completed=False,
        )
        db.add(sch)
        saved_count += 1

    db.commit()
    logger.info(f"ETA: saved {saved_count} schedules for user {current_user.id}")
    return {"saved": saved_count}


@router.post("/parse-image-v2", response_model=List[NormalizedEntryModel])
async def parse_eta_image_v2(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    위치 기반 파서 결과를 반환한다.
    제목/위치는 텍스트를 쓰고, 요일/시간은 위치 기반으로 계산한다.
    """
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {content_type}",
        )

    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 20MB)")
    if len(image_bytes) == 0:
        raise HTTPException(status_code=422, detail="Empty file")

    _grid, entries = parse_image_positional(image_bytes)

    if not entries:
        return []

    return entries