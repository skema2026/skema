from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


# ── 회원가입 / 로그인 ──────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    username: Optional[str] = None

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if len(self.password) < 6:
            raise ValueError("비밀번호는 6자 이상이어야 합니다.")


class LoginRequest(BaseModel):
    email: EmailStr
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
