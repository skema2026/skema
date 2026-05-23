from datetime import datetime

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, field_validator


class SignupRequest(BaseModel):
    email: str
    password: str
    username: str | None = None

    @field_validator("email")
    @classmethod
    def validate_signup_email(cls, value: str) -> str:
        try:
            result = validate_email(value.strip(), check_deliverability=False)
        except EmailNotValidError as exc:
            raise ValueError("올바른 이메일 형식이 아닙니다.") from exc
        return result.normalized

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str | None) -> str | None:
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


class UserResponse(BaseModel):
    id: int
    username: str | None = None
    email: str
    is_active: bool | None = True
    is_admin: bool = False

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    username: str | None = None
    email: str | None = None

    @field_validator("email")
    @classmethod
    def validate_update_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            result = validate_email(value.strip(), check_deliverability=False)
        except EmailNotValidError as exc:
            raise ValueError("올바른 이메일 형식이 아닙니다.") from exc
        return result.normalized

    @field_validator("username")
    @classmethod
    def normalize_update_username(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ProfileCreate(BaseModel):
    user_type: str | None = None
    occupation: str | None = None
    goal_tasks: str | None = None
    sleep_start: str | None = "23:00"
    sleep_end: str | None = "07:00"
    is_college_student: bool | None = None
    semester_start_date: str | None = None


class ProfileUpdate(ProfileCreate):
    onboarding_completed: bool | None = None


class ProfileResponse(BaseModel):
    id: int
    user_id: int
    user_type: str | None = None
    occupation: str | None = None
    goal_tasks: str | None = None
    sleep_start: str | None = None
    sleep_end: str | None = None
    is_college_student: bool | None = None
    semester_start_date: str | None = None
    onboarding_completed: bool = False
    updated_at: datetime

    model_config = {"from_attributes": True}
