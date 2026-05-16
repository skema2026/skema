"""AI 채팅 DB 모델 + API 스키마."""
import enum
from datetime import datetime

from pydantic import BaseModel, Field
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
    message: str


class AIChatLogResponse(BaseModel):
    id: int
    user_id: int
    role: ChatRole
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    messages: list[ChatMessage] = Field(default_factory=list)  # 대화 히스토리


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
