from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


# ── 회원가입 / 로그인 ──────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다.")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── 유저 응답 ─────────────────────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: int
    email: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── 프로필 ────────────────────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    department: Optional[str] = None
    semester: Optional[int] = None
    sleep_start: Optional[str] = "23:00"
    sleep_end: Optional[str] = "07:00"

    @field_validator("semester")
    @classmethod
    def semester_range(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 12):
            raise ValueError("학기는 1~12 사이여야 합니다.")
        return v


class ProfileUpdate(ProfileCreate):
    onboarding_completed: Optional[bool] = None


class ProfileResponse(BaseModel):
    id: int
    user_id: int
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    department: Optional[str] = None
    semester: Optional[int] = None
    sleep_start: Optional[str] = None
    sleep_end: Optional[str] = None
    onboarding_completed: bool = False
    updated_at: datetime

    model_config = {"from_attributes": True}
