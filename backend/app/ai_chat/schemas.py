from datetime import datetime
from typing import List

from pydantic import BaseModel

from app.ai_chat.models import ChatRole


# ── 채팅 로그 CRUD ─────────────────────────────────────────────────────────────

class AIChatLogCreate(BaseModel):
    role: ChatRole
    message: str


class AIChatLogResponse(BaseModel):
    id: int
    user_id: int
    role: ChatRole
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── AI 채팅 요청/응답 (Gemini 에이전트용) ─────────────────────────────────────

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    messages: List[ChatMessage] = []   # 대화 히스토리


class ChatResponse(BaseModel):
    reply: str


class ReadinessSummaryRequest(BaseModel):
    exam_title: str
    readiness_pct: int
    days_left: int
    available_hrs: float
    remaining: int


class ReadinessSummaryResponse(BaseModel):
    summary: str
