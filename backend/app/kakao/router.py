from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.kakao import service

router = APIRouter(prefix="/kakao", tags=["kakao"])


class NotifyRequest(BaseModel):
    message: str


@router.get("/status")
def kakao_status(current_user: User = Depends(get_current_user)):
    """카카오 연동 여부 및 상태 확인."""
    return service.get_kakao_status(current_user)


@router.post("/notify")
def send_notification(
    body: NotifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """카카오톡 나에게 보내기로 알림 발송."""
    result = service.send_kakao_memo(db, current_user, body.message)
    return result


@router.post("/notify/schedule-summary")
def send_schedule_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """오늘 일정 요약을 카카오톡으로 발송."""
    from datetime import date
    from app.schedule.models import Schedule

    today = date.today()
    day_of_week = today.weekday()  # 0=월, 6=일

    schedules = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == current_user.id,
            (Schedule.date == today.isoformat()) | (Schedule.day_of_week == day_of_week),
        )
        .order_by(Schedule.start_time)
        .all()
    )

    if not schedules:
        text = f"📅 {today.strftime('%Y년 %m월 %d일')} 오늘 일정이 없습니다. 여유로운 하루 보내세요!"
    else:
        lines = [f"📅 {today.strftime('%Y년 %m월 %d일')} 오늘 일정 ({len(schedules)}개)\n"]
        for s in schedules:
            done = "✅" if s.is_completed else "⬜"
            lines.append(f"{done} {s.start_time}–{s.end_time} {s.title}")
        text = "\n".join(lines)

    result = service.send_kakao_memo(db, current_user, text)
    return result
