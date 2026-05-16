from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


# ── ORM ──────────────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(30), nullable=False)          # weekly_report | reminder | motivation | comparison
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    related_schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True)

    user = relationship("User")


class PushSubscription(Base):
    """Web Push 구독 정보. 브라우저/기기별로 1건씩 저장한다."""
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String(512), nullable=False, unique=True, index=True)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    user_agent = Column(String(512), nullable=True)
    fail_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_success_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: str
    title: str
    body: str
    is_read: bool
    created_at: datetime
    related_schedule_id: Optional[int] = None

    model_config = {"from_attributes": True}


class NotificationUnreadCount(BaseModel):
    unread: int


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=512)
    keys: PushKeys
