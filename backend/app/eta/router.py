"""
Everytime 등에서 캡처한 시간표 이미지를 파싱하고 결과를 일정으로 저장하는 엔드포인트.

POST /eta/parse-image    : 이미지 업로드 → 위치 알고리즘 + 블록 텍스트 보조 인식 결과 반환
POST /eta/save-schedules : 확정된 항목을 Schedule DB에 저장
POST /eta/parse-image-v2 : 위치 기반 파서 결과 반환
"""

import json
import logging
import os
import re
import tempfile
from collections.abc import Sequence

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.security import get_current_user, get_db
from app.core.llm import (
    LLMEmptyResponseError,
    LLMProviderUnavailableError,
    LLMRateLimitedError,
    call_llm_vision,
)
from app.schedule.service import stage_schedule_record

from app.core.time_utils import DAY_NAMES as KR_DAYS

from .location_utils import normalize_location
from .positional_parser import parse_image_positional
from .positional_types import NAME_TO_DOW
from .schemas import NormalizedEntryModel, ParsedEntry, SaveSchedulesRequest
from .time_utils import parse_time_range, parse_time_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eta", tags=["eta"])

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB

_BLOCK_TEXT_PROMPT = """
You are reading cropped class blocks from a Korean university timetable.

The image is a contact sheet. Each tile has an ID label outside the colored block.
For each ID, read ONLY the text visibly printed inside that same colored block.

Return ONLY a JSON array. No markdown.

Fields:
- id: integer ID shown on the tile
- subject_name: exact Korean class title visible in that crop, or "" if unreadable
- location: room/location visible inside that same crop, or "" if absent
- requires_review: true if uncertain

Rules:
- Do not infer weekday, start time, or end time.
- Do not copy room codes from another ID.
- Do not fill missing rooms from neighboring crops or similar subjects.
- Subject names often wrap across multiple lines. Join all visible title lines completely.
- Do not omit short title suffix lines such as "방법론", "프로젝트", or "분석".
- Do not include instructor/professor names in subject_name. Instructor names are usually
  2-3 Korean syllables below the title and above the room code.
- If the crop shows only a subject name and no separate room text, location must be "".
- A building name alone such as "소프트" without a room number is not a room code.
- Preserve Korean text exactly. Do not translate or romanize.
"""


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
- 같은 색상 블록 안에 강의실 텍스트가 따로 보이지 않으면 location은 빈 문자열로 둔다.
- 옆 칸, 같은 시간대, 비슷한 과목의 강의실을 추측해서 채우지 않는다.
- "소프트"처럼 건물명만 있고 숫자 호수가 없으면 강의실로 보지 않고 빈 문자열로 둔다.
- 모호하거나 해석이 어려우면 requires_review=true 로 표시한다.
- JSON 배열만 출력한다. 마크다운 코드블록은 사용하지 않는다.
"""


def _time_to_minutes(t: str) -> int:
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return -1


def _contains_codepoint_range(text: str, ranges: Sequence[tuple[int, int]]) -> bool:
    for ch in text or "":
        codepoint = ord(ch)
        if any(start <= codepoint <= end for start, end in ranges):
            return True
    return False


def _contains_hangul(text: str) -> bool:
    return _contains_codepoint_range(text, [(0x1100, 0x11FF), (0x3130, 0x318F), (0xAC00, 0xD7A3)])


def _contains_cjk_ideograph(text: str) -> bool:
    return _contains_codepoint_range(text, [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)])


def _normalize_korean_field(text: str, raw_text: str) -> tuple[str, bool]:
    """Restore Korean text when Vision unexpectedly replaces Hangul with CJK ideographs."""
    original = (text or "").strip()
    if not original:
        return original, False

    suspicious_cjk = (
        _contains_cjk_ideograph(original)
        and not _contains_cjk_ideograph(raw_text or "")
        and _contains_hangul(raw_text or "")
    )
    if not suspicious_cjk:
        return original, False

    candidates = re.findall(r"[\uAC00-\uD7A3\sA-Za-z0-9\-_/()]+", raw_text or "")
    candidates = sorted((candidate.strip() for candidate in candidates if candidate.strip()), key=len, reverse=True)
    for candidate in candidates:
        if _contains_hangul(candidate):
            return candidate, True

    return original, True


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


def _parse_positional_items(image_bytes: bytes) -> list[tuple[ParsedEntry, tuple[int, int, int, int]]]:
    """색상 블록 위치로 요일/시간과 bbox를 추출한다. 과목명은 비어 있을 수 있다."""
    _grid, norm = parse_image_positional(image_bytes)
    out: list[tuple[ParsedEntry, tuple[int, int, int, int]]] = []
    seen: set[tuple[int, str, str]] = set()
    for e in norm:
        dow = NAME_TO_DOW.get(e["day"], 0)
        title = (e.get("title") or "").strip()
        if title == "수업":
            title = ""
        start_time = e["startTime"]
        end_time = e["endTime"]
        if not (0 <= dow <= 6) or not _valid_time_range(start_time, end_time):
            continue

        key = (dow, start_time, end_time)
        if key in seen:
            continue
        seen.add(key)

        bbox = tuple(int(v) for v in e.get("bbox", (0, 0, 0, 0)))
        out.append(
            (
                ParsedEntry(
                    subject_name=title,
                    day_of_week=dow,
                    start_time=start_time,
                    end_time=end_time,
                    location=normalize_location(e.get("location") or ""),
                    raw_text=f"{KR_DAYS[dow]} {start_time}~{end_time}",
                    source="eta_image_positional",
                    requires_review=not bool(title),
                ),
                bbox,
            )
        )
    return out


def _build_block_contact_sheet(
    image_bytes: bytes,
    bboxes: Sequence[tuple[int, int, int, int]],
) -> np.ndarray:
    """
    감지된 블록 crop들을 ID가 붙은 contact sheet로 만든다.

    OpenAI에는 전체 시간표가 아니라 이 sheet만 전달해 텍스트 읽기 역할로 제한한다.
    """
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image bytes")

    h, w = img.shape[:2]
    tile_w = 480
    tile_h = 380
    label_h = 34
    pad = 10
    cols = 2
    rows = int(np.ceil(len(bboxes) / cols))
    sheet = np.full((rows * tile_h, cols * tile_w, 3), 255, dtype=np.uint8)

    for idx, bbox in enumerate(bboxes, start=1):
        x0, y0, x1, y1 = bbox
        x0 = max(0, min(w - 1, x0 - 6))
        x1 = max(x0 + 1, min(w, x1 + 6))
        y0 = max(0, min(h - 1, y0 - 6))
        y1 = max(y0 + 1, min(h, y1 + 6))

        block_h = y1 - y0
        # 짧은 블록은 강의실이 하단에 붙는 경우가 있어 전체를 넣는다.
        # 긴 블록만 상단 텍스트 영역 중심으로 잘라 텍스트가 지나치게 작아지는 것을 막는다.
        if block_h <= 260:
            text_y1 = y1
        else:
            text_y1 = min(y1, y0 + max(220, int(block_h * 0.78)))
        crop = img[y0:text_y1, x0:x1]
        if crop.size == 0:
            continue

        max_content_w = tile_w - pad * 2
        max_content_h = tile_h - label_h - pad * 2
        scale = min(max_content_w / crop.shape[1], max_content_h / crop.shape[0])
        scale = min(max(scale, 0.1), 3.0)
        resized = cv2.resize(
            crop,
            (max(1, int(crop.shape[1] * scale)), max(1, int(crop.shape[0] * scale))),
            interpolation=cv2.INTER_CUBIC,
        )

        tile = np.full((tile_h, tile_w, 3), 255, dtype=np.uint8)
        cv2.putText(
            tile,
            f"ID {idx}",
            (pad, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (0, 0, 0),
            2,
            cv2.LINE_AA,
        )
        cy = label_h + pad
        cx = pad + (max_content_w - resized.shape[1]) // 2
        tile[cy:cy + resized.shape[0], cx:cx + resized.shape[1]] = resized
        cv2.rectangle(tile, (pad, label_h), (tile_w - pad, tile_h - pad), (210, 210, 210), 1)

        row = (idx - 1) // cols
        col = (idx - 1) % cols
        sheet[row * tile_h:(row + 1) * tile_h, col * tile_w:(col + 1) * tile_w] = tile

    return sheet


def _coerce_int_id(raw: object) -> int | None:
    if isinstance(raw, int):
        return raw
    match = re.search(r"\d+", str(raw or ""))
    return int(match.group(0)) if match else None


def _split_location_from_subject(subject: str, location: str) -> tuple[str, str]:
    """
    Vision sometimes appends a room line to subject_name even when location is empty.
    If the last title line is a valid room code, move it to location.
    """
    subject = (subject or "").strip()
    location = normalize_location(location)
    if not subject or location:
        return subject, location

    lines = [line.strip() for line in subject.splitlines() if line.strip()]
    if len(lines) < 2:
        return subject, location

    candidate = normalize_location(lines[-1])
    if not candidate:
        return subject, location

    return "\n".join(lines[:-1]).strip(), candidate


def _parse_block_text_via_llm(
    image_bytes: bytes,
    positional_items: Sequence[tuple[ParsedEntry, tuple[int, int, int, int]]],
) -> dict[int, ParsedEntry]:
    """OpenAI Vision으로 crop된 블록 내부 텍스트만 읽는다."""
    if not positional_items:
        return {}

    sheet = _build_block_contact_sheet(image_bytes, [bbox for _entry, bbox in positional_items])
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name
        ok = cv2.imwrite(tmp_path, sheet)
        if not ok:
            raise ValueError("Failed to write block contact sheet")

        llm_result = call_llm_vision(tmp_path, "image/png", _BLOCK_TEXT_PROMPT, temperature=0.0)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    data = _extract_json(llm_result.content)
    parsed: dict[int, ParsedEntry] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        item_id = _coerce_int_id(item.get("id"))
        if item_id is None or item_id < 1 or item_id > len(positional_items):
            continue

        subject = str(item.get("subject_name") or "").strip()
        subject, review_flag = _normalize_korean_field(subject, str(item))
        location = normalize_location(str(item.get("location") or "").strip())
        subject, location = _split_location_from_subject(subject, location)
        base, _bbox = positional_items[item_id - 1]
        parsed[item_id] = ParsedEntry(
            subject_name=subject,
            day_of_week=base.day_of_week,
            start_time=base.start_time,
            end_time=base.end_time,
            location=location or None,
            raw_text=f"{subject} {location}".strip() or base.raw_text,
            source="eta_positional_openai_block_text",
            requires_review=bool(item.get("requires_review", False) or review_flag or not subject),
        )

    return parsed


def _enrich_positional_with_block_text(
    image_bytes: bytes,
    positional_items: Sequence[tuple[ParsedEntry, tuple[int, int, int, int]]],
) -> list[ParsedEntry]:
    text_by_id = _parse_block_text_via_llm(image_bytes, positional_items)
    enriched: list[ParsedEntry] = []
    for idx, (base, _bbox) in enumerate(positional_items, start=1):
        text = text_by_id.get(idx)
        if text is None:
            base.requires_review = True
            enriched.append(base)
            continue
        enriched.append(text)
    return _dedup_entries(enriched)


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


def _dedup_entries(entries: list[ParsedEntry]) -> list[ParsedEntry]:
    seen: set = set()
    result: list[ParsedEntry] = []

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


def _parse_via_llm(image_bytes: bytes, content_type: str) -> list[ParsedEntry]:
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

    entries: list[ParsedEntry] = []

    for item in data:
        try:
            subject = str(item.get("subject_name", "")).strip()
            subject, review_flag = _normalize_korean_field(
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


@router.post("/parse-image", response_model=list[ParsedEntry])
async def parse_eta_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    이미지 기반 시간표 파싱.

    - 1순위: 위치 기반 색상 블록 파서로 요일/시간 확정
    - 2순위: OpenAI Vision은 crop된 블록 내부 텍스트만 보조 추출
    - 3순위: 위치 파서 실패 시에만 기존 전체 이미지 LLM fallback
    """
    image_bytes, content_type = await _read_image_file(file)

    positional_items: list[tuple[ParsedEntry, tuple[int, int, int, int]]] = []
    try:
        positional_items = _parse_positional_items(image_bytes)
    except Exception as exc:
        logger.warning(f"ETA parse: positional parser failed (user={current_user.id}): {exc}", exc_info=True)

    if positional_items:
        try:
            entries = _enrich_positional_with_block_text(image_bytes, positional_items)
            logger.info(
                "ETA algorithm-first parse: geometry=%d returned=%d user=%s",
                len(positional_items), len(entries), current_user.id,
            )
            return entries
        except (LLMRateLimitedError, LLMProviderUnavailableError, LLMEmptyResponseError) as exc:
            logger.warning(f"ETA parse: block text LLM unavailable: {exc}")
        except Exception as exc:
            logger.warning(f"ETA parse: block text LLM failed (user={current_user.id}): {exc}", exc_info=True)

        geometry_entries = [entry for entry, _bbox in positional_items]
        logger.info(
            "ETA positional-only parse: geometry=%d user=%s",
            len(geometry_entries), current_user.id,
        )
        return [_to_review(e, "eta_image_positional") for e in geometry_entries]

    # 위치 파서가 실패한 이미지에서만 전체 이미지 LLM 파서를 마지막 안전망으로 사용한다.
    try:
        text_entries = _filter_entries(_parse_via_refined_llm(image_bytes, content_type))
        if text_entries:
            logger.info("ETA refined LLM fallback returned=%d user=%s", len(text_entries), current_user.id)
            return [_to_review(e, e.source) for e in text_entries]
    except (LLMRateLimitedError, LLMProviderUnavailableError, LLMEmptyResponseError) as exc:
        logger.warning(f"ETA parse: refined LLM fallback unavailable: {exc}")
    except Exception as exc:
        logger.warning(f"ETA parse: refined LLM fallback failed (user={current_user.id}): {exc}", exc_info=True)

    # 마지막 안전망: 기존 간단 LLM 프롬프트를 유지해 예외 케이스를 흡수한다.
    try:
        legacy_entries = _parse_via_llm(image_bytes, content_type)
        if legacy_entries:
            return legacy_entries
    except Exception as exc:
        logger.warning(f"ETA parse: legacy LLM fallback failed: {exc}")

    return []


@router.delete("/schedules", status_code=204)
def delete_eta_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """사용자의 ETA import 강의 시간표를 전체 삭제합니다."""
    from app.schedule.models import Schedule as ScheduleModel
    db.query(ScheduleModel).filter(
        ScheduleModel.user_id == current_user.id,
        ScheduleModel.schedule_source == "eta_import",
    ).delete(synchronize_session=False)
    db.commit()


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


@router.post("/parse-image-v2", response_model=list[NormalizedEntryModel])
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
