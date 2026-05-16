"""AI 채팅 API 엔드포인트 + 채팅 로그 DB 조작.

흐름: HTTP 요청 → 엔드포인트 → run_ai_agent(service.py) → 응답 + 로그 저장
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.ai_chat.models import (
    AIChatLog, AIChatLogCreate, AIChatLogResponse,
    ChatRequest, ChatResponse, ChatRole,
    ReadinessSummaryRequest, ReadinessSummaryResponse,
)
from app.ai_chat.service import run_ai_agent
from app.auth.models import User
from app.core.config import settings
from app.core.deps import get_current_user, get_db

router = APIRouter(tags=["ai"])


# ── 채팅 로그 DB 조작 ─────────────────────────────────────────────────────────

def _get_logs(db: Session, user_id: int, limit: int = 100) -> list[AIChatLog]:
    return (
        db.query(AIChatLog)
        .filter(AIChatLog.user_id == user_id)
        .order_by(AIChatLog.created_at.desc())
        .limit(limit)
        .all()
    )


def _get_log(db: Session, log_id: int, user_id: int) -> AIChatLog | None:
    return db.query(AIChatLog).filter(AIChatLog.id == log_id, AIChatLog.user_id == user_id).first()


def _save_logs(db: Session, user_id: int, entries: list[dict]) -> list[AIChatLog]:
    logs = [AIChatLog(user_id=user_id, **entry) for entry in entries]
    db.add_all(logs)
    db.commit()
    for log in logs:
        db.refresh(log)
    return logs


def _delete_log(db: Session, log: AIChatLog) -> None:
    db.delete(log)
    db.commit()


def _delete_all_logs(db: Session, user_id: int) -> int:
    count = db.query(AIChatLog).filter(AIChatLog.user_id == user_id).delete()
    db.commit()
    return count


# ── API 엔드포인트 ────────────────────────────────────────────────────────────

@router.post("/ai/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI 에이전트와 대화. 대화 내용은 ai_chat_logs에 자동 저장."""
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 서비스가 설정되지 않았습니다. OPENAI_API_KEY를 확인하세요.",
        )

    history = [{"role": m.role, "content": m.content} for m in request.messages]
    reply = run_ai_agent(db, current_user.id, request.message, conversation_history=history)

    _save_logs(db, current_user.id, [
        {"role": ChatRole.USER, "message": request.message},
        {"role": ChatRole.ASSISTANT, "message": reply},
    ])
    return {"reply": reply}


@router.post("/ai/readiness-summary", response_model=ReadinessSummaryResponse)
def readiness_summary(
    request: ReadinessSummaryRequest,
    current_user: User = Depends(get_current_user),
):
    """시험 준비도 AI 진단 피드백 (2문장 이내)."""
    from app.core.llm import call_llm
    prompt = (
        f"시험 준비 상태를 분석해서 2문장 이내로 자연스럽게 한국어로 피드백해줘. "
        f"숫자 나열 말고 행동 가능한 조언을 포함해줘.\n\n"
        f"시험: {request.exam_title}\n"
        f"시험까지 남은 일수: {request.days_left}일\n"
        f"연결 일정 수행률: {request.readiness_pct}%\n"
        f"남은 일정: {request.remaining}개\n"
        f"확보 가능한 공부 시간: 약 {request.available_hrs:.1f}시간"
    )
    result = call_llm(prompt, temperature=0.4)
    return {"summary": result.text}


@router.get("/ai-chat-logs", response_model=List[AIChatLogResponse])
def list_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI 채팅 로그를 최신 순으로 반환. limit 최대 500."""
    if limit > 500:
        limit = 500
    return _get_logs(db, current_user.id, limit=limit)


@router.post("/ai-chat-logs", response_model=AIChatLogResponse, status_code=status.HTTP_201_CREATED)
def create_log(
    data: AIChatLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """채팅 로그 수동 추가. (테스트 또는 외부 연동용)"""
    logs = _save_logs(db, current_user.id, [{"role": data.role, "message": data.message}])
    return logs[0]


@router.delete("/ai-chat-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 채팅 로그 삭제."""
    log = _get_log(db, log_id, current_user.id)
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="로그를 찾을 수 없습니다.")
    _delete_log(db, log)


@router.delete("/ai-chat-logs", status_code=status.HTTP_200_OK)
def delete_all_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 채팅 로그 전체 삭제."""
    count = _delete_all_logs(db, current_user.id)
    return {"deleted": count}
