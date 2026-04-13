from __future__ import annotations

import re
from typing import Optional, Tuple

KR_AM = ("오전", "am", "AM")
KR_PM = ("오후", "pm", "PM")


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

    am = any(k in t for k in KR_AM)
    pm = any(k in t for k in KR_PM)

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
        if h == 12:
            hh = 12
        else:
            hh = h + 12
    elif am and not pm:
        if h == 12:
            hh = 0
        else:
            hh = h
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
        start = parse_time_token(parts[0])
        end = parse_time_token(parts[1])
        return start, end

    tokens = re.findall(r"(?:오전|오후)?\s*\d{1,2}\s*[:\.]\s*\d{1,2}\s*(?:AM|PM|am|pm)?", s)
    if len(tokens) >= 2:
        return parse_time_token(tokens[0]), parse_time_token(tokens[1])

    single = re.search(r"(?:오전|오후)?\s*\d{1,2}\s*[:\.]\s*\d{1,2}\s*(?:AM|PM|am|pm)?", s)
    if single:
        t = parse_time_token(single.group(0))
        return t, None

    return None, None
