"""AI 채팅 DB 모델 + API 스키마."""
import enum
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


# ── DB 모델 ───────────────────────────────────────────────────────────────────

class ChatRole(str, enum.Enum):
    USER = "USER"
    ASSISTANT = "ASSISTANT"
    SYSTEM = "SYSTEM"


class AIChatLog(Base):
    __tablename__ = "ai_chat_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(SAEnum(ChatRole), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="ai_chat_logs")


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

class AIChatLogCreate(BaseModel):
    role: ChatRole
    message: str = Field(max_length=10000)


class AIChatLogResponse(BaseModel):
    id: int
    user_id: int
    role: ChatRole
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


# 11/7: 클라이언트가 보내는 대화 기록은 user/assistant 만 허용한다.
# 예전에는 role 이 자유 문자열이라 {"role": "system"} 으로 서비스 지시문을 덮어쓸 수 있었다.
# 길이·개수 제한은 OpenAI 비용이 한 요청에 끝없이 커지지 않게 하기 위함.
CHAT_MESSAGE_MAX_CHARS = 2000      # 사용자가 이번에 보내는 메시지
CHAT_HISTORY_ITEM_MAX_CHARS = 4000  # 기록 속 한 메시지 (AI 답변이 길 수 있음)
CHAT_HISTORY_KEEP = 20              # 모델에 넘길 최근 기록 수 (프론트는 전체를 보내므로 서버에서 자른다)
CHAT_HISTORY_MAX_ITEMS = 200        # 요청 자체가 지나치게 크면 거절


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=CHAT_HISTORY_ITEM_MAX_CHARS)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=CHAT_MESSAGE_MAX_CHARS)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=CHAT_HISTORY_MAX_ITEMS)  # 대화 히스토리

    @field_validator("messages")
    @classmethod
    def keep_recent_history(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        return v[-CHAT_HISTORY_KEEP:]


class ChatResponse(BaseModel):
    reply: str


class ReadinessSummaryRequest(BaseModel):
    exam_title: str = Field(max_length=100)
    readiness_pct: int
    days_left: int
    available_hrs: float
    remaining: int


class ReadinessSummaryResponse(BaseModel):
    summary: str
