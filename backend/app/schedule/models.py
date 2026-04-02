import enum

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Enum as SAEnum,
    ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class DayOfWeek(str, enum.Enum):
    """요일 Enum. 0=월요일 기준 문자열로 저장."""
    MON = "MON"
    TUE = "TUE"
    WED = "WED"
    THU = "THU"
    FRI = "FRI"
    SAT = "SAT"
    SUN = "SUN"


class Schedule(Base):
    """
    수업 시간표. 매주 반복되는 강의를 저장.
    day_of_week + start_time + end_time 조합으로 시간 범위를 표현.
    """
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_name = Column(String(200), nullable=False)
    professor = Column(String(100), nullable=True)
    location = Column(String(200), nullable=True)
    day_of_week = Column(SAEnum(DayOfWeek), nullable=False)
    start_time = Column(String(5), nullable=False)   # "HH:MM"
    end_time = Column(String(5), nullable=False)     # "HH:MM"
    color_code = Column(String(7), default="#6366F1")  # hex: #RRGGBB

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
    # 수업과 연결된 시험이면 schedule_id를 설정; 독립 시험이면 null
    schedule_id = Column(
        Integer, ForeignKey("schedules.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    title = Column(String(200), nullable=False)
    exam_date = Column(Date, nullable=False)         # YYYY-MM-DD
    start_time = Column(String(5), nullable=True)    # "HH:MM"
    end_time = Column(String(5), nullable=True)      # "HH:MM"
    location = Column(String(200), nullable=True)
    memo = Column(Text, nullable=True)

    user = relationship("User")
    schedule = relationship("Schedule", back_populates="exam_schedules")
