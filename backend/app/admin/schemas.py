from datetime import datetime

from pydantic import BaseModel


class LoginLogUserResponse(BaseModel):
    id: int
    username: str | None = None
    email: str

    model_config = {"from_attributes": True}


class LoginLogResponse(BaseModel):
    id: int
    user_id: int | None = None
    login_identifier: str
    login_method: str
    success: bool
    failure_reason: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime
    user: LoginLogUserResponse | None = None

    model_config = {"from_attributes": True}


class AdminUserResponse(BaseModel):
    id: int
    username: str | None = None
    email: str
    is_active: bool | None = True
    social_provider: str | None = None
    social_id: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
