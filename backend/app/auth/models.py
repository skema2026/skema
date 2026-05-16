from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class User(Base):
    """사용자 계정. 이메일을 고유 식별자로 사용.
    소셜 로그인 사용자는 hashed_password 없이 생성될 수 있음.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=True, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    social_provider = Column(String(50), nullable=True)
    social_id = Column(String(255), nullable=True)
    kakao_access_token = Column(String(512), nullable=True)
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
    """사용자 프로필. User와 1:1 관계."""
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    user_type = Column(String(50), nullable=True)
    occupation = Column(String(100), nullable=True)
    goal_tasks = Column(String(500), nullable=True)

    sleep_start = Column(String(5), nullable=True, default="23:00")
    sleep_end = Column(String(5), nullable=True, default="07:00")

    is_college_student = Column(Boolean, nullable=True, default=False)
    semester_start_date = Column(String(10), nullable=True)
    onboarding_completed = Column(Boolean, default=False, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="profile")


class LoginLog(Base):
    """로그인 시도 기록."""
    __tablename__ = "login_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    login_identifier = Column(String(255), nullable=False)
    login_method = Column(String(20), nullable=False)
    success = Column(Boolean, nullable=False, default=False, server_default="0")
    failure_reason = Column(String(100), nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    user = relationship("User", back_populates="login_logs")
