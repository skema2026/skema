from datetime import datetime
from typing import Optional

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, field_validator


# ── 회원가입 / 로그인 ──────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str
    username: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_signup_email(cls, value: str) -> str:
        try:
            result = validate_email(value.strip(), check_deliverability=True)
        except EmailNotValidError as exc:
            raise ValueError("올바른 이메일 형식이 아닙니다.") from exc
        return result.normalized

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("비밀번호는 6자 이상이어야 합니다.")
        return value


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── 유저 응답 ─────────────────────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: int
    username: Optional[str] = None
    email: str
    is_active: Optional[bool] = True
    is_admin: bool = False

    model_config = {"from_attributes": True}


# ── 프로필 ────────────────────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    user_type: Optional[str] = None       # student | exam_prep | civil_service | worker | other
    occupation: Optional[str] = None
    goal_tasks: Optional[str] = None
    sleep_start: Optional[str] = "23:00"  # HH:MM
    sleep_end: Optional[str] = "07:00"    # HH:MM
    is_college_student: Optional[bool] = None
    semester_start_date: Optional[str] = None  # YYYY-MM-DD


class ProfileUpdate(ProfileCreate):
    onboarding_completed: Optional[bool] = None


class ProfileResponse(BaseModel):
    id: int
    user_id: int
    user_type: Optional[str] = None
    occupation: Optional[str] = None
    goal_tasks: Optional[str] = None
    sleep_start: Optional[str] = None
    sleep_end: Optional[str] = None
    is_college_student: Optional[bool] = None
    semester_start_date: Optional[str] = None
    onboarding_completed: bool = False
    updated_at: datetime

    model_config = {"from_attributes": True}
