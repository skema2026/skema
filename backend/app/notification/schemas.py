from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.notification.push_hosts import is_allowed_push_endpoint


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

    @field_validator("endpoint")
    @classmethod
    def endpoint_must_be_push_service(cls, v: str) -> str:
        # 11/7: 브라우저 푸시 서비스 주소만 받는다 (서버가 이 주소로 요청을 보내므로 SSRF 방지)
        if not is_allowed_push_endpoint(v):
            raise ValueError("지원하지 않는 푸시 구독 주소입니다.")
        return v.strip()
