from __future__ import annotations
import re
from typing import Tuple

# CJK Unified Ideographs ranges (basic + extensions commonly seen)
_CJK_RANGES = [
    (0x3400, 0x4DBF),  # Ext A
    (0x4E00, 0x9FFF),  # Basic
    (0xF900, 0xFAFF),  # Compatibility Ideographs
]

def _has_in_ranges(s: str, ranges) -> bool:
    for ch in s or "":
        cp = ord(ch)
        for a, b in ranges:
            if a <= cp <= b:
                return True
    return False

def contains_cjk_ideograph(s: str) -> bool:
    return _has_in_ranges(s or "", _CJK_RANGES)

def contains_hangul(s: str) -> bool:
    return _has_in_ranges(s or "", [(0x1100,0x11FF), (0x3130,0x318F), (0xAC00,0xD7A3)])

def contains_unexpected_cjk(text: str, raw_text: str) -> bool:
    """Return True if output has CJK ideographs but raw_text does not, and raw_text looks Korean."""
    if not text:
        return False
    has_cjk = contains_cjk_ideograph(text)
    raw_has_cjk = contains_cjk_ideograph(raw_text or "")
    raw_has_ko = contains_hangul(raw_text or "")
    return has_cjk and (not raw_has_cjk) and raw_has_ko

def normalize_korean_field(text: str, raw_text: str) -> Tuple[str, bool]:
    """If suspicious CJK mixed into Korean field, try restoring from raw_text.
    Returns (normalized_text, requires_review).
    """
    original = (text or "").strip()
    if not original:
        return original, False
    if not contains_unexpected_cjk(original, raw_text):
        return original, False

    # Try to pick the longest Hangul-dominant span from raw_text
    candidates = re.findall(r"[\uAC00-\uD7A3\sA-Za-z0-9\-_/()]+", raw_text or "")
    candidates = [c.strip() for c in candidates if c.strip()]
    candidates.sort(key=len, reverse=True)
    for cand in candidates:
        # Prefer candidates with Hangul
        if contains_hangul(cand):
            return cand, True  # mark for review but auto-restored

    # Could not restore — keep original but flag review
    return original, True
