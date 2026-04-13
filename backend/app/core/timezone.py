"""
KST(Asia/Seoul, UTC+9) 기준 날짜/시간 유틸리티.

Docker 컨테이너의 시스템 시간이 UTC이더라도
한국 유저 기준 "오늘" 날짜를 올바르게 반환한다.

사용:
    from app.core.timezone import today_kst, now_kst

    today = today_kst()   # date 객체, KST 기준
    now   = now_kst()     # datetime 객체, KST 기준 (timezone-aware)
"""
from datetime import date, datetime, timedelta, timezone

# UTC+9 고정 오프셋 (pytz 의존성 없이 사용)
KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    """현재 시각을 KST timezone-aware datetime으로 반환."""
    return datetime.now(KST)


def today_kst() -> date:
    """KST 기준 오늘 날짜(date)를 반환."""
    return now_kst().date()


def dow_kst() -> int:
    """KST 기준 오늘 요일 (0=월 … 6=일, Python weekday() 규칙)."""
    return today_kst().weekday()
