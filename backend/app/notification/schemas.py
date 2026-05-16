from datetime import datetime

from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: str
    title: str
    body: str
    is_read: bool
    created_at: datetime
    related_schedule_id: int | None = None

    model_config = {"from_attributes": True}


class NotificationUnreadCount(BaseModel):
    unread: int


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=512)
    keys: PushKeys
