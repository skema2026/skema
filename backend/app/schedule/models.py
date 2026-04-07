from sqlalchemy import Boolean, Column, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.database import Base


class Schedule(Base):
    """
    일정. 매주 반복되는 수업(date=null)이거나 특정 날짜 이벤트/학습(date=YYYY-MM-DD).

    day_of_week: 0=월 … 6=일 (date가 있으면 자동 계산, 없으면 반복 요일)
    schedule_type: "class" | "event" | "study"
    priority: 0=보통 1=높음 2=긴급
    """
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    location = Column(String(200), nullable=True)
    day_of_week = Column(Integer, nullable=False, default=0)   # 0=Mon … 6=Sun
    date = Column(String(10), nullable=True)                    # YYYY-MM-DD (null = 매주 반복)
    start_time = Column(String(5), nullable=False)              # HH:MM
    end_time = Column(String(5), nullable=False)                # HH:MM
    color = Column(String(7), default="#6366F1")                # #RRGGBB
    priority = Column(Integer, default=0)                       # 0 | 1 | 2
    is_completed = Column(Boolean, default=False)
    schedule_type = Column(String(20), default="class")         # class | event | study

    user = relationship("User", back_populates="schedules")


class ExamSchedule(Base):
    """
    시험 일정. 독립적으로 존재하며 user에 연결됨.
    exam_time: 시험 시작 시간 HH:MM (선택)
    """
    __tablename__ = "exam_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    subject = Column(String(200), nullable=True)      # 과목명 (AI 일정 생성에 사용)
    exam_date = Column(Date, nullable=False)           # YYYY-MM-DD
    exam_time = Column(String(5), nullable=True)       # HH:MM (시험 시작 시간)
    location = Column(String(200), nullable=True)

    user = relationship("User")
