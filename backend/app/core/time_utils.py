"""공통 시간·요일 유틸리티."""

DAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
DAY_NAMES_SHORT = ["월", "화", "수", "목", "금", "토", "일"]


def time_to_minutes(t: str, default: int = 0) -> int:
    """HH:MM 문자열을 분 단위 정수로 변환. 파싱 실패 시 default 반환."""
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return default


def minutes_to_time(m: int) -> str:
    """분 단위 정수를 HH:MM 문자열로 변환."""
    return f"{m // 60:02d}:{m % 60:02d}"


def overlap(s1: str, e1: str, s2: str, e2: str) -> bool:
    """두 시간 범위 [s1, e1), [s2, e2) 가 겹치면 True."""
    return time_to_minutes(s1) < time_to_minutes(e2) and time_to_minutes(s2) < time_to_minutes(e1)
