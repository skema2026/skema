# backend/app/notification/models.py
from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from app.db.database import Base
from pydantic import BaseModel


# ── ORM Models ────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id         = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type            = Column(String(50), nullable=False)
    title           = Column(String(255), nullable=False)
    body            = Column(Text, nullable=True)
    is_read         = Column(Boolean, default=False, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)
    related_schedule_id = Column(BigInteger, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id       = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint      = Column(Text, nullable=False)
    p256dh        = Column(Text, nullable=False)
    auth          = Column(Text, nullable=False)
    user_agent    = Column(String(255), nullable=True)
    fail_count    = Column(Integer, default=0, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_success_at = Column(DateTime, nullable=True)


# ── Pydantic Schemas ──────────────────────────────────────────

class NotificationResponse(BaseModel):
    id:                  int
    type:                str
    title:               str
    body:                str | None
    is_read:             bool
    created_at:          datetime
    related_schedule_id: int | None

    model_config = {"from_attributes": True}


class NotificationUnreadCount(BaseModel):
    unread_count: int


class PushSubscriptionIn(BaseModel):
    endpoint: str
    p256dh:   str
    auth:     str
    user_agent: str | None = None


class PushKeys(BaseModel):
    public_key: str