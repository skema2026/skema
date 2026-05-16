from datetime import datetime

from pydantic import BaseModel


class ShareTokenCreate(BaseModel):
    expires_at: datetime | None = None   # null = 영구 유효


class ShareTokenResponse(BaseModel):
    id: int
    user_id: int
    token: str
    expires_at: datetime | None = None
    is_active: bool
    created_at: datetime
    share_url: str = ""   # 응답 시 서버에서 주입

    model_config = {"from_attributes": True}
