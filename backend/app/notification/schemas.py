from datetime import datetime
from typing import Optional

from pydantic import BaseModel


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
