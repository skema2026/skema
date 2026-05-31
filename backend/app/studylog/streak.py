"""
스트릭 유틸리티.

스트릭 기준: 매일 일정 1개 이상 완료 → 오늘 날짜를 streak_check_ins에 기록.
연속된 날짜를 세어 current_streak / longest_streak 계산.
"""
from datetime import date, timedelta

from sqlalchemy import Column, Date, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Session

from app.db.database import Base


class StreakCheckIn(Base):
    __tablename__ = "streak_check_ins"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    check_date = Column(Date, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "check_date", name="uq_streak_per_user_day"),
    )


def record_check_in(db: Session, user_id: int) -> None:
    """오늘 날짜로 체크인 기록 (이미 있으면 무시)."""
    from sqlalchemy.dialects.mysql import insert as mysql_insert
    today = date.today()
    existing = (
        db.query(StreakCheckIn)
        .filter(StreakCheckIn.user_id == user_id, StreakCheckIn.check_date == today)
        .first()
    )
    if not existing:
        db.add(StreakCheckIn(user_id=user_id, check_date=today))
        db.flush()


def compute_streak(db: Session, user_id: int) -> dict:
    """current_streak, longest_streak 계산."""
    rows = (
        db.query(StreakCheckIn.check_date)
        .filter(StreakCheckIn.user_id == user_id)
        .order_by(StreakCheckIn.check_date.desc())
        .all()
    )
    dates = sorted({r.check_date for r in rows}, reverse=True)

    if not dates:
        return {"current_streak": 0, "longest_streak": 0, "today_checked": False}

    today = date.today()
    today_checked = dates[0] == today

    # current streak: 오늘 또는 어제부터 연속된 날 수
    current = 0
    cursor = today if today_checked else (today - timedelta(days=1))
    if dates[0] >= cursor:
        for d in dates:
            if d == cursor:
                current += 1
                cursor -= timedelta(days=1)
            elif d < cursor:
                break

    # longest streak
    longest = 1
    run = 1
    for i in range(1, len(dates)):
        if (dates[i - 1] - dates[i]).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    return {
        "current_streak": current,
        "longest_streak": max(longest, current),
        "today_checked": today_checked,
    }
