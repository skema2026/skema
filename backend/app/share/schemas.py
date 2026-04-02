from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ShareTokenCreate(BaseModel):
    expires_at: Optional[datetime] = None   # null = 영구 유효


class ShareTokenResponse(BaseModel):
    id: int
    user_id: int
    token: str
    expires_at: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    share_url: str = ""   # 응답 시 서버에서 주입

    model_config = {"from_attributes": True}


class ShareTokenDeactivate(BaseModel):
    """토큰 비활성화 요청 (삭제 없이 is_active=false)."""
    pass
