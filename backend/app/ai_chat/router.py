from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.ai_chat import repository
from app.ai_chat.models import AIChatLog, ChatRole
from app.ai_chat.schemas import (
    AIChatLogCreate,
    AIChatLogResponse,
    ChatRequest,
    ChatResponse,
)
from app.ai_chat.service import run_ai_agent
from app.auth.models import User
from app.core.config import settings
from app.core.deps import get_current_user, get_db

router = APIRouter(tags=["ai"])


# ── AI 채팅 (Gemini 에이전트) ─────────────────────────────────────────────────

@router.post("/ai/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    AI 에이전트와 대화합니다.
    대화 내용(user 메시지 + assistant 응답)을 ai_chat_logs에 자동 저장합니다.
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 서비스가 설정되지 않았습니다. GEMINI_API_KEY를 확인하세요.",
        )

    history = [{"role": m.role, "content": m.content} for m in request.messages]
    reply = run_ai_agent(db, current_user.id, request.message, conversation_history=history)

    # 대화 로그 저장
    repository.bulk_create_logs(db, current_user.id, [
        {"role": ChatRole.USER, "message": request.message},
        {"role": ChatRole.ASSISTANT, "message": reply},
    ])

    return {"reply": reply}


# ── AI 채팅 로그 CRUD ─────────────────────────────────────────────────────────

@router.get("/ai-chat-logs", response_model=List[AIChatLogResponse])
def list_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI 채팅 로그를 최신 순으로 반환합니다. limit 최대 500."""
    if limit > 500:
        limit = 500
    return repository.get_logs_by_user(db, current_user.id, limit=limit)


@router.post("/ai-chat-logs", response_model=AIChatLogResponse, status_code=status.HTTP_201_CREATED)
def create_log(
    data: AIChatLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """채팅 로그를 수동으로 추가합니다. (테스트 또는 외부 연동용)"""
    return repository.create_log(db, current_user.id, data.role, data.message)


@router.delete("/ai-chat-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 채팅 로그를 삭제합니다."""
    log = repository.get_log_by_id(db, log_id, current_user.id)
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="로그를 찾을 수 없습니다.")
    repository.delete_log(db, log)


@router.delete("/oai-chat-logs", status_code=status.HTTP_200_OK)
def delete_all_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 채팅 로그를 전부 삭제합니다."""
    count = repository.delete_all_logs(db, current_user.id)
    return {"deleted": count}
