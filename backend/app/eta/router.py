"""
Everytime 등에서 캡처한 시간표 이미지를 파싱하고 결과를 일정으로 저장하는 엔드포인트.

POST /eta/parse-image    : 이미지 업로드 → LLM Vision 파싱 결과 반환
POST /eta/save-schedules : 확정된 항목을 Schedule DB에 저장
POST /eta/parse-image-v2 : 위치 기반 파서 결과 반환
"""

import json
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
    call_llm_vision,
)
from app.schedule.service import stage_schedule_record
from app.utils.text_validation import normalize_korean_field
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


# ── 시간 파싱 유틸 ────────────────────────────────────────────────────────────

_KR_AM = ("오전", "am", "AM")
_KR_PM = ("오후", "pm", "PM")


def _to_hhmm(h: int, m: int) -> str:
    if m < 15:
        m = 0
    elif m < 45:
        m = 30
    else:
        m = 0
        h += 1
    h = max(0, min(23, h))
    return f"{h:02d}:{m:02d}"


def parse_time_token(token: str) -> Optional[str]:
    if not token:
        return None
    t = token.strip()
    t = re.sub(r"\s+", " ", t)

    am = any(k in t for k in _KR_AM)
    pm = any(k in t for k in _KR_PM)

    m = re.search(r"(\d{1,2})\s*[:\.]\s*(\d{1,2})", t)
    if not m:
        m2 = re.search(r"\b(\d{1,2})\b", t)
        if not m2:
            return None
        h = int(m2.group(1))
        mm = 0
    else:
        h = int(m.group(1))
        mm = int(m.group(2))

    if mm < 15:
        mm = 0
    elif mm < 45:
        mm = 30
    else:
        mm = 0
        h += 1

    if pm and not am:
        hh = 12 if h == 12 else h + 12
    elif am and not pm:
        hh = 0 if h == 12 else h
    else:
        # 에브리타임 축 레이블: 1..8 은 오후(13..20), 9..12 는 오전
        hh = h + 12 if 1 <= h <= 8 else h

    return _to_hhmm(hh, mm)


def parse_time_range(text: str) -> Tuple[Optional[str], Optional[str]]:
    if not text:
        return None, None
    s = text.strip()
    parts = re.split(r"\s*(?:~|\-|~|–|—|to)\s*", s)
    if len(parts) == 2:
        return parse_time_token(parts[0]), parse_time_token(parts[1])

    tokens = re.findall(r"(?:오전|오후)?\s*\d{1,2}\s*[:\.]\s*\d{1,2}\s*(?:AM|PM|am|pm)?", s)
    if len(tokens) >= 2:
        return parse_time_token(tokens[0]), parse_time_token(tokens[1])

    single = re.search(r"(?:오전|오후)?\s*\d{1,2}\s*[:\.]\s*\d{1,2}\s*(?:AM|PM|am|pm)?", s)
    if single:
        t = parse_time_token(single.group(0))
        return t, None

    return None, None

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eta", tags=["eta"])

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB


_PARSE_PROMPT = """
IMPORTANT TEXT RULES:
- 한국어 텍스트는 그대로 보존한다.
- 한국어를 번역하지 않는다.
- 한국어를 한자()로 치환하지 않는다.
- 원문이 한국어라면 결과도 한국어로 작성한다.
- 과목명/장소 등 고유명사는 원문 그대로 유지한다.

입력은 Everytime 등 대학 시간표 스크린샷이다.
전체 모바일 화면 캡처일 수 있으므로 상단 앱바/학기 탭/하단 여백/플로팅 버튼은 무시하고,
요일 헤더와 왼쪽 시간 숫자 칸이 있는 실제 시간표 격자를 먼저 찾는다. 화면 특징:
- 위쪽에 요일 컬럼(월~일)이 가로로 표시됨.
- 왼쪽에 시간대(9,10,11,12,1,2,3,4,5,6,7,8)가 세로로 표시됨.
- 24시간 표기. 예: 2:30 → 14:30 으로 정규화.

출력: JSON 배열. 각 항목은 다음 필드를 포함한다.
- subject_name: string (과목/제목)
- day_of_week: integer (0=월, 1=화, …, 6=일)
- start_time: "HH:MM" (24h)
- end_time:   "HH:MM" (24h)
- location:   강의실/장소. 읽을 수 없으면 빈 문자열
- raw_text:   원본에서 읽은 한 줄(가능하면)
- requires_review: boolean

규칙:
- 시간은 반드시 HH:MM(24h)로 표준화한다.
- 동일 제목이 여러 요일/시간에 반복되면 각 항목으로 분리한다.
- 강의실은 원문을 보존하되, 한글 건물명+숫자 형식에 임의 영문자를 끼워넣지 않는다.
  예: 소프트102는 소프트102로 출력하고, 소프트E102로 출력하지 않는다.
- 모호하거나 해석이 어려우면 requires_review=true 로 표시한다.
- JSON 배열만 출력한다. 마크다운 코드블록은 사용하지 않는다.
"""


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


def _time_edge_distance(text: ParsedEntry, geom: ParsedEntry) -> float:
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
    # OCR/LLM이 줄바꿈 조각만 뽑은 경우: "강의)", "(영어" 같은 파편 제거.
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
    """정교한 LLM Vision 파서를 사용해 과목명/강의실 후보를 추출한다."""
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


def _parse_via_easyocr_text(image_bytes: bytes) -> list[ParsedEntry]:
    """EasyOCR + 위치 파서 결과를 ParsedEntry로 변환한다."""
    from app.eta.easyocr_parser import parse_timetable_easyocr

    out: list[ParsedEntry] = []
    for item in parse_timetable_easyocr(image_bytes):
        subject = str(item.get("subject_name", "")).strip()
        dow = int(item.get("day_of_week", 0))
        st = str(item.get("start_time", ""))
        et = str(item.get("end_time", ""))
        if not (0 <= dow <= 6) or not st or not et or st >= et:
            continue
        if subject:
            subject, review_flag = normalize_korean_field(subject, "")
        else:
            review_flag = True
        out.append(
            ParsedEntry(
                subject_name=subject,
                day_of_week=dow,
                start_time=st,
                end_time=et,
                location=normalize_location(str(item.get("location") or "").strip()) or None,
                raw_text=None,
                source="eta_easyocr",
                requires_review=review_flag or not bool(subject),
            )
        )
    return out


def _best_text_match(base: ParsedEntry, candidates: list[ParsedEntry], used: set[int]) -> tuple[int, ParsedEntry] | None:
    best_idx = -1
    best_score = -1
    for idx, cand in enumerate(candidates):
        if idx in used or cand.day_of_week != base.day_of_week:
            continue
        overlap_mins = _ranges_overlap(base.start_time, base.end_time, cand.start_time, cand.end_time)
        if overlap_mins <= 0:
            continue
        score = overlap_mins
        if base.start_time == cand.start_time:
            score += 30
        if base.end_time == cand.end_time:
            score += 30
        if cand.subject_name.strip():
            score += 10
        if score > best_score:
            best_idx = idx
            best_score = score
    if best_idx < 0:
        return None
    return best_idx, candidates[best_idx]


def _merge_geometry_and_text(
    geometry_entries: list[ParsedEntry],
    text_entries: list[ParsedEntry],
) -> list[ParsedEntry]:
    """
    위치 기반 요일/시간을 기준으로 삼고, LLM/OCR 결과에서는 과목명/강의실만 가져온다.
    위치 파서가 놓친 LLM/OCR 항목은 review 필요 상태로 함께 반환한다.
    """
    if not geometry_entries:
        return [_to_review(e, e.source) for e in text_entries]
    if not text_entries:
        return [_to_review(e, "eta_image_positional") for e in geometry_entries]

    used: set[int] = set()
    merged: list[ParsedEntry] = []

    for base in geometry_entries:
        match = _best_text_match(base, text_entries, used)
        if not match:
            merged.append(_to_review(base, "eta_image_positional"))
            continue

        idx, text = match
        used.add(idx)
        text_time_mismatch = base.start_time != text.start_time or base.end_time != text.end_time
        subject = text.subject_name.strip() or base.subject_name.strip()
        location = normalize_location(text.location or base.location)
        merged.append(
            ParsedEntry(
                subject_name=subject,
                day_of_week=base.day_of_week,
                start_time=base.start_time,
                end_time=base.end_time,
                location=location,
                raw_text=text.raw_text or base.raw_text,
                source=f"eta_hybrid:{base.source}+{text.source}",
                requires_review=text.requires_review or text_time_mismatch or not bool(subject),
            )
        )

    for idx, text in enumerate(text_entries):
        if idx not in used:
            merged.append(_to_review(text, text.source))

    return _dedup_entries(merged)


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
    정교한 LLM 파서가 과목명은 잘 읽지만 블록 높이를 짧게 잡는 경우가 있다.
    위치 기반 블록과 전역 1:1 매칭하여 요일/시간을 보정한다.

    같은 요일 매칭을 우선하지만, LLM이 요일을 잘못 잡은 경우도 있으므로
    아직 매칭되지 않은 색상 블록에는 시간 유사도 기준으로 교정한다.
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
                # LLM이 요일을 잘못 읽으면 시간이 한 칸(30분~1시간) 밀린 후보가 남는다.
                # 이 경우 색상 블록 좌표를 더 신뢰하되, 전혀 먼 블록과는 매칭하지 않는다.
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
                        location=normalize_location(e.get("location") or ""),
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


def _parse_via_llm(image_bytes: bytes, content_type: str) -> List[ParsedEntry]:
    """LLM Vision으로 이미지에서 시간표 항목을 추출한다."""
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
                    location=normalize_location(str(item.get("location") or "").strip()) or None,
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
    이미지 기반 시간표 파싱.

    - 1순위: 정교한 LLM Vision 파서
    - 2순위: 위치 기반 색상 블록 파서 + EasyOCR 병합
    - 3순위: 기존 간단 LLM 프롬프트 fallback
    """
    image_bytes, content_type = await _read_image_file(file)

    text_entries: list[ParsedEntry] = []
    try:
        text_entries = _filter_entries(_parse_via_refined_llm(image_bytes, content_type))
    except (LLMRateLimitedError, LLMProviderUnavailableError, LLMEmptyResponseError) as exc:
        logger.warning(f"ETA parse: refined LLM unavailable: {exc}")
    except Exception as exc:
        logger.warning(f"ETA parse: refined LLM failed (user={current_user.id}): {exc}", exc_info=True)

    if text_entries:
        geometry_entries: list[ParsedEntry] = []
        try:
            geometry_entries = _filter_entries(_parse_via_positional(image_bytes), allow_empty_subject=True)
            text_entries = _correct_text_with_geometry(text_entries, geometry_entries)
        except Exception as exc:
            logger.warning(f"ETA parse: time correction failed (user={current_user.id}): {exc}")
        logger.info(
            "ETA refined LLM parse: geometry=%d returned=%d user=%s",
            len(geometry_entries), len(text_entries), current_user.id,
        )
        return text_entries

    geometry_entries: list[ParsedEntry] = []
    try:
        geometry_entries = _filter_entries(_parse_via_positional(image_bytes), allow_empty_subject=True)
    except Exception as exc:
        logger.warning(f"ETA parse: positional parser failed (user={current_user.id}): {exc}")

    entries = _merge_geometry_and_text(geometry_entries, text_entries)
    needs_text_fallback = not text_entries or any(not e.subject_name.strip() for e in entries)
    if needs_text_fallback:
        try:
            ocr_entries = _filter_entries(_parse_via_easyocr_text(image_bytes))
            if ocr_entries:
                text_entries = text_entries + ocr_entries
                entries = _merge_geometry_and_text(geometry_entries, text_entries)
        except ImportError as exc:
            logger.info(f"ETA parse: EasyOCR unavailable: {exc}")
        except Exception as exc:
            logger.warning(f"ETA parse: EasyOCR fallback failed (user={current_user.id}): {exc}", exc_info=True)

    if entries:
        logger.info(
            "ETA hybrid parse: geometry=%d text=%d returned=%d user=%s",
            len(geometry_entries), len(text_entries), len(entries), current_user.id,
        )
        return entries

    # 마지막 안전망: 기존 간단 LLM 프롬프트를 유지해 예외 케이스를 흡수한다.
    try:
        legacy_entries = _parse_via_llm(image_bytes, content_type)
        if legacy_entries:
            return legacy_entries
    except Exception as exc:
        logger.warning(f"ETA parse: legacy LLM fallback failed: {exc}")

    return []


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


@router.post("/parse-image-easyocr", response_model=List[ParsedEntry])
async def parse_eta_image_easyocr(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    EasyOCR + OpenCV 위치 기반 파서.
    API 키 없이 동작. 첫 호출 시 모델 로딩으로 수 초 소요될 수 있음.
    """
    image_bytes, _ = await _read_image_file(file)

    try:
        from app.eta.easyocr_parser import parse_timetable_easyocr
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="easyocr가 설치되지 않았습니다. 서버 관리자에게 문의하세요.",
        )

    try:
        entries_raw = parse_timetable_easyocr(image_bytes)
    except Exception as exc:
        logger.error(f"EasyOCR parse error (user={current_user.id}): {exc}", exc_info=True)
        fb = _fallback_positional(image_bytes)
        return fb if fb else []

    entries: List[ParsedEntry] = []
    for item in entries_raw:
        try:
            subject = str(item.get("subject_name", "")).strip()
            dow = int(item.get("day_of_week", 0))
            st = str(item.get("start_time", ""))
            et = str(item.get("end_time", ""))
            if not (0 <= dow <= 6) or not st or not et or st >= et:
                continue
            if subject:
                subject, _ = normalize_korean_field(subject, "")
            entries.append(
                ParsedEntry(
                    subject_name=subject,
                    day_of_week=dow,
                    start_time=st,
                    end_time=et,
                    location=normalize_location(str(item.get("location") or "").strip()) or None,
                    raw_text=None,
                    source="eta_easyocr",
                    requires_review=not bool(subject),
                )
            )
        except Exception:
            continue

    if not entries:
        fb = _fallback_positional(image_bytes)
        return fb if fb else []

    result = _dedup_entries(entries)
    logger.info(f"EasyOCR: {len(result)} entries for user {current_user.id}")
    return result
