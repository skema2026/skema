"""auth 도메인 ORM 모델 + Pydantic 스키마.

ORM 모델:
  User         — 사용자 계정 (이메일 로그인 + 소셜 로그인 통합)
  UserProfile  — 사용자 프로필 (수면 시간, 학습 목표 등 AI 최적화에 사용)
  LoginLog     — 로그인 시도 이력

Pydantic 스키마:
  SignupRequest / LoginRequest / TokenResponse
  UserResponse
  ProfileCreate / ProfileUpdate / ProfileResponse
"""
from datetime import datetime
from typing import Optional

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, field_validator
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


# ── ORM 모델 ──────────────────────────────────────────────────────────────────

class User(Base):
    """사용자 계정. 이메일을 고유 식별자로 사용.
    소셜 로그인 사용자는 hashed_password 없이 생성될 수 있음.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=True)       # 소셜 로그인 시 null 허용
    is_active = Column(Boolean, default=True, nullable=True, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    # 소셜 로그인 정보
    social_provider = Column(String(50), nullable=True)        # "google" | "naver" | "kakao"
    social_id = Column(String(255), nullable=True)
    kakao_access_token = Column(String(512), nullable=True)    # 카카오톡 메시지 발송용
    kakao_refresh_token = Column(String(512), nullable=True)

    profile = relationship(
        "UserProfile", back_populates="user",
        uselist=False, cascade="all, delete-orphan",
    )
    schedules = relationship("Schedule", back_populates="user", cascade="all, delete-orphan")
    exam_schedules = relationship("ExamSchedule", back_populates="user", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="user", cascade="all, delete-orphan")
    share_tokens = relationship("ShareToken", back_populates="user", cascade="all, delete-orphan")
    ai_chat_logs = relationship("AIChatLog", back_populates="user", cascade="all, delete-orphan")
    login_logs = relationship("LoginLog", back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    """사용자 프로필. User와 1:1 관계.
    sleep_start/sleep_end는 AI 일정 최적화에서 활동 가능 시간 계산에 사용.
    """
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    user_type = Column(String(50), nullable=True)     # student | exam_prep | civil_service | worker | other
    occupation = Column(String(100), nullable=True)
    goal_tasks = Column(String(500), nullable=True)

    sleep_start = Column(String(5), nullable=True, default="23:00")  # HH:MM
    sleep_end = Column(String(5), nullable=True, default="07:00")    # HH:MM

    is_college_student = Column(Boolean, nullable=True, default=False)
    semester_start_date = Column(String(10), nullable=True)          # YYYY-MM-DD
    onboarding_completed = Column(Boolean, default=False, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="profile")


class LoginLog(Base):
    """로그인 시도 기록. 비밀번호는 저장하지 않습니다."""
    __tablename__ = "login_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    login_identifier = Column(String(255), nullable=False)
    login_method = Column(String(20), nullable=False)  # "email" | "username"
    success = Column(Boolean, nullable=False, default=False, server_default="0")
    failure_reason = Column(String(100), nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    user = relationship("User", back_populates="login_logs")


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str
    username: Optional[str] = None

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


class UserResponse(BaseModel):
    id: int
    username: Optional[str] = None
    email: str
    is_active: Optional[bool] = True
    is_admin: bool = False

    model_config = {"from_attributes": True}


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
