from sqlalchemy import (
    Boolean, Column, Date, DateTime, Integer, String, Text,
    ForeignKey,
)
from sqlalchemy.orm import relationship

from app.db.database import Base


class Schedule(Base):
    """
    일정. day_of_week(0=월~6=일) + start_time + end_time으로 반복 수업을 표현.
    date가 있으면 특정 날짜 이벤트(date=None이면 매주 반복).
    """
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)           # 일정 제목
    professor = Column(String(100), nullable=True)
    location = Column(String(200), nullable=True)
    day_of_week = Column(Integer, nullable=False)          # 0=월 ~ 6=일
    date = Column(Date, nullable=True)                     # 특정 날짜 (null = 매주 반복)
    start_time = Column(String(5), nullable=False)         # "HH:MM"
    end_time = Column(String(5), nullable=False)           # "HH:MM"
    color = Column(String(7), default="#6366F1")           # hex: #RRGGBB
    priority = Column(Integer, default=0)                  # 0=보통 1=높음 2=긴급
    schedule_type = Column(String(20), default="class")    # class / event / study
    is_completed = Column(Boolean, default=False)

    user = relationship("User", back_populates="schedules")
    exam_schedules = relationship(
        "ExamSchedule", back_populates="schedule", cascade="all, delete-orphan",
    )


class ExamSchedule(Base):
    """
    시험 일정. 특정 수업(SCHEDULE)과 연결되거나 독립적으로 존재 가능.
    schedule_id가 null이면 수업과 무관한 독립 시험 일정.
    """
    __tablename__ = "exam_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    schedule_id = Column(
        Integer, ForeignKey("schedules.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    title = Column(String(200), nullable=False)
    subject = Column(String(200), nullable=True)           # 시험 과목명 (선택)
    exam_date = Column(Date, nullable=False)               # YYYY-MM-DD
    exam_time = Column(String(5), nullable=True)           # "HH:MM" (선택)
    start_time = Column(String(5), nullable=True)          # "HH:MM"
    end_time = Column(String(5), nullable=True)            # "HH:MM"
    location = Column(String(200), nullable=True)
    memo = Column(Text, nullable=True)

    user = relationship("User")
    schedule = relationship("Schedule", back_populates="exam_schedules")
