from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.security import get_current_user, get_db
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
    text = service.build_schedule_summary(db, current_user.id)
    return service.send_kakao_memo(db, current_user, text)
