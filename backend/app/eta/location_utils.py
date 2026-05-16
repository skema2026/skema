"""
ETA timetable room/location normalization.

OCR/vision models sometimes insert a stray Latin letter between a Korean
building prefix and a numeric room code, e.g. "소프트E102" for "소프트102".
Keep this normalization narrow so legitimate room formats such as "AI관-415"
are preserved.
"""

from __future__ import annotations

import re

_COMPACT_KOREAN_ROOM_PREFIXES = ("소프트", "미디어")
_BUILDING_ONLY_NAMES = ("소프트", "미디어", "상경", "사범", "2공")


def normalize_location(raw: str | None) -> str:
    """Normalize common ETA room-code OCR mistakes."""
    if raw is None:
        return ""

    value = re.sub(r"\s+", "", str(raw).strip())
    if not value:
        return ""

    if value in _BUILDING_ONLY_NAMES:
        return ""

    # Everytime screenshots often render "2공" compactly enough for OCR/Vision to read it incorrectly.
    value = re.sub(r"^(?:2호|이공|공동)(\d{3,4})$", r"2공\1", value)

    prefixes = "|".join(re.escape(prefix) for prefix in _COMPACT_KOREAN_ROOM_PREFIXES)

    # 소프트E102 / 소프트 E 102 / 소프트E-102 -> 소프트102
    value = re.sub(
        rf"^({prefixes})[A-Za-z]+-?(\d{{3,4}})$",
        r"\1\2",
        value,
    )

    # 소프트-102 / 소프트 102 -> 소프트102
    value = re.sub(
        rf"^({prefixes})-?(\d{{3,4}})$",
        r"\1\2",
        value,
    )

    return value
