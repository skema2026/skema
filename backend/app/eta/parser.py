"""
에브리타임 시간표 이미지 파싱 — LLM Vision 직접 추출 방식.

파이프라인:
  LLM Vision → flat JSON array → Python 시간정규화·검증·중복제거 → NormalizedEntry[]
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── 상수 ───────────────────────────────────────────────────────────────────────

# 에브리타임 축 레이블 → 24시간 변환표.
# 9..12 는 오전(그대로), 1..8 은 오후 PM (+12).
_EVERYTIME_PM_MAP: dict[int, int] = {
    1: 13, 2: 14, 3: 15, 4: 16,
    5: 17, 6: 18, 7: 19, 8: 20,
}

# 한글 요일 → (영문 요일명, 0-based dow)
_KR_TO_DAY: dict[str, Tuple[str, int]] = {
    "월": ("MONDAY",    0),
    "화": ("TUESDAY",   1),
    "수": ("WEDNESDAY", 2),
    "목": ("THURSDAY",  3),
    "금": ("FRIDAY",    4),
    "토": ("SATURDAY",  5),
    "일": ("SUNDAY",    6),
}

# ── dataclass 정의 ─────────────────────────────────────────────────────────────

@dataclass
class GridModel:
    """API 호환 유지용 빈 스텁."""


@dataclass
class ParseSource:
    ocr_text:           str
    column_index:       int
    weekday_confidence: float
    time_confidence:    float
    correction_notes:   List[str] = field(default_factory=list)


@dataclass
class NormalizedEntry:
    title:       str
    day:         str    # "TUESDAY"
    day_of_week: int    # 0=Mon … 6=Sun
    start_time:  str    # "HH:MM" — :00 또는 :30 보장
    end_time:    str    # "HH:MM" — :00 또는 :30 보장
    location:    str
    source:      ParseSource


# ── LLM 프롬프트 ─────────────────────────────────────────────────────────────

_PARSE_PROMPT = """\
You are analyzing a screenshot of "Everytime" (에브리타임), a Korean university timetable app.

Your task: Extract EVERY class block and return a flat JSON array.
Output ONLY the JSON array — no markdown fences (no ```), no explanation text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL STRUCTURE OF THE TIMETABLE IMAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The image is a GRID:
  • TOP HEADER ROW: weekday column labels  →  월 | 화 | 수 | 목 | 금 [| 토 | 일]
  • LEFT GUTTER COLUMN: time labels  →  9 / 10 / 11 / 12 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8
  • INTERIOR CELLS: colored rectangular blocks, each representing one class session

A CLASS BLOCK is a SINGLE continuous colored rectangle.
  • Text (subject name + room) appears only at the TOP of the block.
  • The rest of the block below the text is the SAME color but empty — this is still part
    of the same block. Do NOT treat the empty lower portion as a separate block.
  • ONE colored rectangle = ONE entry. Never split one rectangle into two entries.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — DETECT WEEKDAY COLUMNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the column headers left-to-right:
  월 → MONDAY   화 → TUESDAY   수 → WEDNESDAY   목 → THURSDAY   금 → FRIDAY
  토 → SATURDAY   일 → SUNDAY

For each class block, determine which COLUMN it visually occupies.
The block's horizontal CENTER determines its weekday column.

If the SAME subject block appears in MULTIPLE columns (e.g. 알고리즘 in both 월 and 수):
→ Create ONE entry per column — do NOT merge into one entry.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — DETECT TIME AXIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The left gutter shows integer labels: 9 10 11 12 1 2 3 4 5 6 7 8

24-HOUR MAPPING (memorize this — do NOT guess):
  9  → 09:00    10 → 10:00    11 → 11:00    12 → 12:00
  1  → 13:00     2 → 14:00     3 → 15:00     4 → 16:00
  5  → 17:00     6 → 18:00     7 → 19:00     8 → 20:00

Between each pair of integer labels there is a SHORT DASHED LINE at the :30 mark.
  e.g. between "1" and "2" → dashed line at 13:30
  e.g. between "2" and "3" → dashed line at 14:30

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — MEASURE EACH BLOCK'S FULL HEIGHT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE MOST IMPORTANT RULE:
  The end_time is determined by WHERE THE COLOR OF THE BLOCK ENDS (bottom edge of
  the colored rectangle), NOT by where the text ends.
  Blocks are tall rectangles. The text is only at the top. The color continues
  all the way down to the end_time boundary.

PROCEDURE for each block:
  1. Locate the TOP EDGE of the colored rectangle → start_time
  2. Locate the BOTTOM EDGE of the colored rectangle → end_time
     (Trace the color downward until it stops. That bottom edge is the end_time.)
  3. Map both edges to grid lines:
       - Edge exactly ON an integer label line → :00
       - Edge exactly ON the dashed line (midpoint between two integers) → :30

GRID LINE TYPES:
  • SOLID line at every integer label → :00  (e.g. the "2" line = 14:00)
  • SHORT DASHED line halfway between integers → :30  (e.g. midpoint of "2"–"3" = 14:30)

ALL times MUST end in :00 or :30.  NEVER output :15, :45, or any other minute value.

HOW TO COUNT BLOCK HEIGHT:
  • 1 full integer-gap = 60 min  (e.g. top at "1", bottom at "2" → 13:00–14:00)
  • 1.5 integer-gaps = 90 min    (e.g. top at "1", bottom at dashed "2.5" → 13:00–14:30)
  • 2 full integer-gaps = 120 min (e.g. top at "1", bottom at "3" → 13:00–15:00)
  • 4 full integer-gaps = 240 min (e.g. top at "1", bottom at "5" → 13:00–17:00)

⚠ FOUR CRITICAL MISTAKES TO AVOID:

  MISTAKE 1 — Stopping at text instead of color bottom:
    ✗ WRONG: Block color goes from "1" down to dashed "2:30" line, but you stop at "2"
             because the text only fills the top → end_time "14:00"
    ✓ RIGHT: Trace the color all the way to where it ends (dashed line) → end_time "14:30"

  MISTAKE 2 — Splitting one tall block into two:
    ✗ WRONG: Block from "1" to "5" (4 hours) → you output TWO entries: "13:00–14:00" + "14:00–17:00"
    ✓ RIGHT: ONE colored rectangle = ONE entry → "13:00–17:00"

  MISTAKE 3 — Snapping :30 to :00:
    ✗ WRONG: Block bottom is at the dashed line between "2" and "3" → you output "14:00" or "15:00"
    ✓ RIGHT: Dashed midpoint line between "2" and "3" → end_time "14:30"

  MISTAKE 4 — Treating a :30 start_time as :00 (especially with no block above for reference):
    Context: When a block is the FIRST block in a column (nothing above it), the LLM tends to
    snap the start_time to the nearest integer (:00) even if the block actually starts at the
    dashed :30 line. This is the single most common error on morning blocks (9:30–12:00 range).

    ✗ WRONG: Block top sits on the dashed line between "10" and "11", no block above →
             you output start_time "10:00"  (mistaking the dashed line for the "10" solid line)
    ✓ RIGHT: The "10" solid line = 10:00. The block top is BELOW "10" and at the midpoint
             between "10" and "11" → start_time "10:30"

    HOW TO DISTINGUISH solid vs dashed line:
      • Solid line  → full-width, thick, aligned exactly with the gutter integer label
      • Dashed line → short, thin, no label, sits HALFWAY between two integer labels
      If the block's TOP EDGE is at a dashed line → start_time MUST end in :30
      If the block's TOP EDGE is at a solid line → start_time MUST end in :00

    VERIFICATION for isolated AM blocks (no adjacent block above):
      1. Find the solid integer line IMMEDIATELY above the block's top edge.
      2. Estimate the visual gap between that solid line and the block's top.
      3. If the gap is roughly HALF of one full integer-gap → start_time is :30.
      4. If the gap is nearly zero (block starts right at the solid line) → start_time is :00.

CONCRETE EXAMPLES:
  Block: top at "1" label, bottom at dashed line between 2–3
    → start_time "13:00",  end_time "14:30"   (90 min, 1.5 gaps)

  Block: top at dashed line between 1–2, bottom at "4" label
    → start_time "13:30",  end_time "16:00"   (150 min, 2.5 gaps)

  Block: top at "1" label, bottom at "5" label
    → start_time "13:00",  end_time "17:00"   (240 min, 4 gaps)

  Block: top at dashed between 10–11, bottom at "12" label
    → start_time "10:30",  end_time "12:00"   (90 min)

  TWO separate blocks in the same column:
    Block A: top at "1", bottom at dashed between 2–3
    Block B: top at dashed between 2–3, bottom at "4"
    → Entry A: start_time "13:00", end_time "14:30"
    → Entry B: start_time "14:30", end_time "16:00"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — EXTRACT SUBJECT NAME AND LOCATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For each block:
  • subject_name = the LARGEST / topmost text inside the block (Korean characters, exact)
  • location = the smaller text below the subject name (room code), or "" if absent
  • PRESERVE Korean text exactly — do NOT translate, romanize, or abbreviate
  • Do NOT use "수업", "class", "강의", "Unknown", or any generic placeholder
  • If you cannot read a block's subject name at all → OMIT that block

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a flat JSON array (no surrounding object, no ``` fences):

[
  {
    "subject_name": "알고리즘",
    "weekday": "MONDAY",
    "start_time": "10:30",
    "end_time": "12:00",
    "location": "소프트306"
  },
  {
    "subject_name": "알고리즘",
    "weekday": "WEDNESDAY",
    "start_time": "10:30",
    "end_time": "12:00",
    "location": "소프트306"
  }
]

weekday values: MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY SUNDAY

Return [] if no class blocks are visible.
"""


# ── 정규화 유틸리티 ───────────────────────────────────────────────────────────

def _time_to_minutes(t: str) -> int:
    """"HH:MM" → 분. 실패 시 -1."""
    parts = t.strip().split(":")
    if len(parts) < 2:
        return -1
    try:
        h, m = int(parts[0]), int(parts[1][:2])
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h * 60 + m
    except ValueError:
        pass
    return -1


def _normalize_time(raw: str) -> Tuple[str, float, str]:
    """
    시간 문자열 → (정규화된 HH:MM, 신뢰도, 보정 메모).

    보정 단계:
      1. 범위 포맷 "10:30~12:00" → 첫 번째 시간 추출
      2. Everytime PM 보정: h ∈ [1,8] → h+12
         근거: 에브리타임 축은 9..12(오전) + 1..8(오후). "2:30" → "14:30"
         h ∈ [9,12] 또는 h ∈ [13,20]이면 보정 불필요 (이미 24h)
      3. 30분 스냅 (nearest-boundary):
           remainder < 15  → 내림 :00
           remainder 15-44 → :30
           remainder 45-59 → 올림 :00 (다음 시간)
    """
    if not raw:
        return "00:00", 0.0, "empty"

    t = raw.strip()

    # 범위 포맷 제거: "10:30~12:00" → "10:30"
    m_range = re.match(r"(\d{1,2}:\d{2})\s*[~\-–]", t)
    if m_range:
        t = m_range.group(1)

    parts = t.split(":")
    if len(parts) < 2:
        return "00:00", 0.0, f"unparseable:{raw!r}"

    try:
        h = int(parts[0])
        m = int(parts[1][:2])
    except ValueError:
        return "00:00", 0.0, f"non-numeric:{raw!r}"

    if not (0 <= h <= 23 and 0 <= m <= 59):
        return "00:00", 0.0, f"out-of-range:{h}:{m}"

    note       = ""
    confidence = 1.0

    # ── Everytime PM 보정 ──────────────────────────────────────────────────
    # LLM가 에브리타임 표시 그대로 "1:00"을 반환했을 때만 적용.
    # 이미 24h("13:00")로 반환했으면 h=13이므로 이 조건에 해당하지 않음.
    if h in _EVERYTIME_PM_MAP:
        old_h = h
        h = _EVERYTIME_PM_MAP[h]
        note = f"pm-corrected({old_h}→{h})"
        confidence = min(confidence, 0.85)
        logger.debug("_normalize_time: PM correction %d→%d for raw=%r", old_h, h, raw)

    # ── 30분 스냅 ──────────────────────────────────────────────────────────
    remainder = m % 30
    if remainder == 0:
        pass  # :00 또는 :30 — 보정 불필요
    elif remainder < 15:
        old_m = m
        m -= remainder  # 내림 → :00
        note += f" snapped-down(:{old_m:02d}→:{m:02d})"
        confidence = min(confidence, 0.80)
        logger.debug("_normalize_time: snap down :%02d→:%02d for raw=%r", old_m, m, raw)
    else:
        old_m = m
        m += (30 - remainder)  # 올림 → :30 또는 :00
        if m >= 60:
            m = 0
            h += 1
        note += f" snapped-up(:{old_m:02d}→:{m:02d})"
        confidence = min(confidence, 0.80)
        logger.debug("_normalize_time: snap up :%02d→:%02d for raw=%r", old_m, m, raw)

    if h > 23:
        return "23:30", 0.5, "overflow-clamped"

    return f"{h:02d}:{m:02d}", confidence, note.strip()


def _dedup(entries: List[NormalizedEntry]) -> List[NormalizedEntry]:
    """(title, day, start_time, end_time) 조합 기준 중복 제거."""
    seen: set[tuple] = set()
    result: List[NormalizedEntry] = []
    for e in entries:
        key = (e.title.strip(), e.day, e.start_time, e.end_time)
        if key not in seen:
            seen.add(key)
            result.append(e)
    return result


# ── JSON 추출 유틸리티 ────────────────────────────────────────────────────────

def _extract_json_array(text: str) -> Optional[list]:
    """LLM 응답 텍스트에서 JSON 배열을 추출한다."""
    cleaned = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
    start = cleaned.find("[")
    end   = cleaned.rfind("]") + 1
    if start == -1 or end == 0:
        return None
    try:
        result = json.loads(cleaned[start:end])
        if isinstance(result, list):
            return result
    except json.JSONDecodeError as e:
        logger.warning("Parser JSON array decode error: %s | snippet=%s", e, cleaned[start:start + 300])
    return None


def _extract_json_object(text: str) -> dict:
    """LLM 응답 텍스트에서 JSON 객체를 추출한다."""
    text = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
    start = text.find("{")
    end   = text.rfind("}") + 1
    if start == -1 or end == 0:
        return {}
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError as e:
        logger.warning("Parser JSON decode error: %s | snippet=%s", e, text[start:start + 300])
        return {}


# ── 요일 해석 유틸 ────────────────────────────────────────────────────────────

_WEEKDAY_MAP: dict[str, tuple[str, int]] = {
    "MONDAY": ("MONDAY", 0), "TUESDAY": ("TUESDAY", 1),
    "WEDNESDAY": ("WEDNESDAY", 2), "THURSDAY": ("THURSDAY", 3),
    "FRIDAY": ("FRIDAY", 4), "SATURDAY": ("SATURDAY", 5), "SUNDAY": ("SUNDAY", 6),
    "MON": ("MONDAY", 0), "TUE": ("TUESDAY", 1), "WED": ("WEDNESDAY", 2),
    "THU": ("THURSDAY", 3), "FRI": ("FRIDAY", 4), "SAT": ("SATURDAY", 5), "SUN": ("SUNDAY", 6),
    "월요일": ("MONDAY", 0), "화요일": ("TUESDAY", 1), "수요일": ("WEDNESDAY", 2),
    "목요일": ("THURSDAY", 3), "금요일": ("FRIDAY", 4), "토요일": ("SATURDAY", 5), "일요일": ("SUNDAY", 6),
}

_GENERIC_SUBJECT_NAMES = frozenset({"수업", "class", "CLASS", "강의", "N/A", "Unknown", "unknown", ""})


def _resolve_weekday(raw: str) -> Optional[tuple[str, int]]:
    """요일 문자열 → (day_name, dow). 인식 실패 시 None."""
    upper = raw.strip().upper()
    if upper in _WEEKDAY_MAP:
        return _WEEKDAY_MAP[upper]
    # 한글 단일 문자 시도
    for ch, (day, dow) in _KR_TO_DAY.items():
        if ch in raw:
            return (day, dow)
    return None


def _parse_llm_array(data: list) -> List[NormalizedEntry]:
    """
    LLM flat array 응답 → 검증된 NormalizedEntry 목록.
    디버그 로그: detected weekday, calculated times, extracted subject_name.
    """
    result: List[NormalizedEntry] = []

    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            logger.debug("LLM[%d]: not a dict, skipping", idx)
            continue

        # 신구 형식 모두 지원
        subject   = str(item.get("subject_name") or item.get("title") or "").strip()
        wday_raw  = str(item.get("weekday") or item.get("day") or "").strip()
        start_raw = str(item.get("start_time", "")).strip()
        end_raw   = str(item.get("end_time", "")).strip()
        location  = str(item.get("location", "")).strip()

        logger.debug(
            "LLM[%d] raw: subject=%r  weekday=%r  start=%r  end=%r  loc=%r",
            idx, subject, wday_raw, start_raw, end_raw, location,
        )

        # 과목명 검증
        if subject in _GENERIC_SUBJECT_NAMES:
            logger.warning("LLM[%d]: skipping generic/empty subject_name=%r", idx, subject)
            continue

        # 요일 해석
        weekday_info = _resolve_weekday(wday_raw)
        if weekday_info is None:
            logger.warning("LLM[%d]: cannot resolve weekday %r for %r, skipping", idx, wday_raw, subject)
            continue
        day_name, dow = weekday_info
        logger.debug("LLM[%d]: detected weekday=%s (dow=%d)", idx, day_name, dow)

        # 시간 정규화
        start_str, start_conf, start_note = _normalize_time(start_raw)
        end_str,   end_conf,   end_note   = _normalize_time(end_raw)

        logger.debug(
            "LLM[%d]: calculated start_time=%s (conf=%.2f, note=%r)  end_time=%s (conf=%.2f, note=%r)",
            idx, start_str, start_conf, start_note, end_str, end_conf, end_note,
        )

        if start_str == "00:00" and end_str == "00:00":
            logger.warning("LLM[%d]: both times 00:00 for %r, skipping", idx, subject)
            continue

        s_mins = _time_to_minutes(start_str)
        e_mins = _time_to_minutes(end_str)
        if s_mins < 0 or e_mins < 0 or s_mins >= e_mins:
            logger.warning(
                "LLM[%d]: invalid time range %s-%s for %r, skipping",
                idx, start_str, end_str, subject,
            )
            continue

        notes: List[str] = []
        if start_note: notes.append(f"start:{start_note}")
        if end_note:   notes.append(f"end:{end_note}")

        logger.info(
            "LLM[%d] OK: subject=%r  weekday=%s(dow=%d)  %s-%s  loc=%r",
            idx, subject, day_name, dow, start_str, end_str, location,
        )

        result.append(NormalizedEntry(
            title=subject,
            day=day_name,
            day_of_week=dow,
            start_time=start_str,
            end_time=end_str,
            location=location,
            source=ParseSource(
                ocr_text=f"{subject} {location}".strip(),
                column_index=dow,
                weekday_confidence=1.0,
                time_confidence=round((start_conf + end_conf) / 2, 3),
                correction_notes=notes,
            ),
        ))

    return result


# ── 공개 진입점 ───────────────────────────────────────────────────────────────

def parse_timetable_image(
    image_path: str,
    content_type: str,
) -> Tuple[List[NormalizedEntry], GridModel, str]:
    """
    에브리타임 시간표 이미지 → NormalizedEntry 목록.

    Returns:
        (entries, grid_stub, llm_provider)
    """
    from app.core.llm import call_llm_vision

    logger.info("Parser: calling LLM Vision for %s (type=%s)", image_path, content_type)
    llm_result = call_llm_vision(image_path, content_type, _PARSE_PROMPT, temperature=0.0)

    if not llm_result or not llm_result.content:
        logger.warning("Parser: LLM returned empty response")
        return [], GridModel(), "none"

    provider = llm_result.provider
    if llm_result.status == "fallback_used":
        logger.info("Parser: using fallback provider=%s model=%s", provider, llm_result.model)
    logger.debug("Parser: LLM response %d chars via %s\n--- snippet ---\n%s\n---",
                 len(llm_result.content), provider, llm_result.content[:500])

    # ── 1. JSON 배열 추출 ─────────────────────────────────────────────────
    raw_data: list = []

    array_result = _extract_json_array(llm_result.content)
    if isinstance(array_result, list):
        raw_data = array_result
        logger.info("Parser: extracted flat array, %d items", len(raw_data))
    else:
        obj = _extract_json_object(llm_result.content)
        if obj:
            raw_data = obj.get("blocks") or obj.get("entries") or []
            if raw_data:
                logger.info("Parser: flat array not found, using object.blocks (%d items)", len(raw_data))
                for item in raw_data:
                    if isinstance(item, dict):
                        if "title" in item and "subject_name" not in item:
                            item["subject_name"] = item["title"]
                        if "day" in item and "weekday" not in item:
                            item["weekday"] = item["day"]

    if not raw_data:
        logger.warning(
            "Parser: could not extract any data from LLM response (snippet=%r)",
            llm_result.content[:300],
        )
        return [], GridModel(), provider

    # ── 2. 파싱·정규화 ─────────────────────────────────────────────────
    entries = _parse_llm_array(raw_data)
    entries = _dedup(entries)

    # ── 3. 신뢰도 경고 로그 ─────────────────────────────────────────
    for e in entries:
        if e.source.time_confidence < 0.80:
            logger.warning(
                "Low time confidence (%.2f) for %r %s %s-%s  notes=%s",
                e.source.time_confidence, e.title, e.day,
                e.start_time, e.end_time, e.source.correction_notes,
            )

    logger.info("Parser: %d normalized entries (provider=%s)", len(entries), provider)
    return entries, GridModel(), provider
