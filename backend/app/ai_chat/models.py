import enum

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class ChatRole(str, enum.Enum):
    """AI 채팅 역할. OpenAI/Gemini 컨벤션 준수."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class AIChatLog(Base):
    """
    AI 채팅 로그.
    대화 세션은 별도로 관리하지 않고 created_at 순서로 정렬.
    role: user(사용자 입력) | assistant(AI 응답) | system(시스템 프롬프트)
    """
    __tablename__ = "ai_chat_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(SAEnum(ChatRole), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="ai_chat_logs")
