from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class User(Base):
    """
    사용자 계정. 이메일을 고유 식별자로 사용.
    소셜 로그인 사용자는 hashed_password 없이 생성될 수 있음.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=True)              # 표시 이름 (선택)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=True)       # 소셜 로그인 시 null 허용
    is_active = Column(Boolean, default=True, nullable=True, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    # 소셜 로그인 정보
    social_provider = Column(String(50), nullable=True)        # "google" | "naver" | "kakao"
    social_id = Column(String(255), nullable=True)
    kakao_access_token = Column(String(512), nullable=True)    # 카카오톡 메시지 발송용
    kakao_refresh_token = Column(String(512), nullable=True)

    # Relationships
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
    """
    사용자 프로필. USER와 1:1 관계.
    수면 시간(sleep_start/sleep_end)은 AI 일정 최적화에 사용됨.
    """
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    # 사용자 유형 및 목표
    user_type = Column(String(50), nullable=True)     # student | exam_prep | civil_service | worker | other
    occupation = Column(String(100), nullable=True)
    goal_tasks = Column(String(500), nullable=True)

    # AI 일정 최적화에 사용되는 수면 시간
    sleep_start = Column(String(5), nullable=True, default="23:00")  # HH:MM
    sleep_end = Column(String(5), nullable=True, default="07:00")    # HH:MM

    is_college_student = Column(Boolean, nullable=True, default=False)
    semester_start_date = Column(String(10), nullable=True)      # YYYY-MM-DD (학기 시작일)
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
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="login_logs")
