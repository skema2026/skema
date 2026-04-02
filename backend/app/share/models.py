from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class ShareToken(Base):
    """
    시간표 공유 토큰.
    - token: cryptographically secure random string (UK)
    - expires_at: null이면 만료 없음
    - is_active: false로 설정해 토큰을 즉시 비활성화 가능
    """
    __tablename__ = "share_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)   # null = 영구 유효
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="share_tokens")
