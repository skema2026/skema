from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    social_provider = Column(String, nullable=True)   # "google" | "naver" | "kakao"
    social_id = Column(String, nullable=True)          # provider's user ID

    schedules = relationship("Schedule", back_populates="user", cascade="all, delete-orphan")
    share_tokens = relationship("ShareToken", back_populates="user", cascade="all, delete-orphan")
    profile = relationship("UserProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    exam_schedules = relationship("ExamSchedule", back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    user_type = Column(String, nullable=True)                       # "exam_prep" | "civil_service" | "student" | "worker" | "other"
    occupation = Column(String, nullable=True)
    sleep_start = Column(String, nullable=True, default="23:00")   # HH:MM (bedtime)
    sleep_end = Column(String, nullable=True, default="07:00")     # HH:MM (wake-up)
    goal_tasks = Column(String, nullable=True)                      # 목표 작업 (자유 텍스트)
    onboarding_completed = Column(Boolean, default=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="profile")


class ExamSchedule(Base):
    __tablename__ = "exam_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    subject = Column(String, nullable=True)
    exam_date = Column(String, nullable=False)   # YYYY-MM-DD
    exam_time = Column(String, nullable=True)    # HH:MM
    location = Column(String, nullable=True)

    user = relationship("User", back_populates="exam_schedules")
