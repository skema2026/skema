import enum

from sqlalchemy import (
    Boolean, Column, Date, Enum as SAEnum,
    ForeignKey, Integer, String, Text,
    case,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship

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


# DayOfWeek ↔ int 변환 유틸
DAY_TO_INT = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
INT_TO_DAY = {v: k for k, v in DAY_TO_INT.items()}


class Schedule(Base):
    """
    수업 시간표. 매주 반복되는 강의를 저장.
    recurring_day + start_time + end_time 조합으로 시간 범위를 표현.
    """
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_name = Column(String(200), nullable=False)
    professor = Column(String(100), nullable=True)
    location = Column(String(200), nullable=True)
    recurring_day = Column(SAEnum(DayOfWeek), nullable=False)
    start_time = Column(String(5), nullable=False)   # "HH:MM"
    end_time = Column(String(5), nullable=False)     # "HH:MM"
    color_code = Column(String(7), default="#6366F1")  # hex: #RRGGBB
    date = Column(String(10), nullable=True, index=True)  # YYYY-MM-DD (AI 일정/이벤트 호환)
    priority = Column(Integer, nullable=True, default=0, server_default="0")
    is_completed = Column(Boolean, nullable=True, default=False, server_default="0")
    schedule_type = Column(String(30), nullable=True, default="class", server_default="class")
    schedule_source = Column(String(30), nullable=True, default="user_created", server_default="user_created")
    linked_exam_id = Column(Integer, ForeignKey("exam_schedules.id", ondelete="SET NULL"), nullable=True, index=True)
    user_override = Column(Boolean, nullable=True, default=False, server_default="0")
    deleted_by_user = Column(Boolean, nullable=True, default=False, server_default="0")
    original_generated_title = Column(String(250), nullable=True)

    user = relationship("User", back_populates="schedules")
    exam_schedules = relationship(
        "ExamSchedule",
        back_populates="schedule",
        cascade="all, delete-orphan",
        foreign_keys="ExamSchedule.schedule_id",
    )

    def __init__(self, **kwargs):
        title = kwargs.get("title")
        course_name = kwargs.get("course_name")
        if course_name is None and title is not None:
            kwargs["course_name"] = title
        elif title is None and course_name is not None:
            kwargs["title"] = course_name

        color = kwargs.get("color")
        color_code = kwargs.get("color_code")
        if color_code is None and color is not None:
            kwargs["color_code"] = color
        elif color is None and color_code is not None:
            kwargs["color"] = color_code

        recurring_day = kwargs.get("recurring_day")
        day_of_week = kwargs.get("day_of_week")
        if recurring_day is None and day_of_week is not None:
            kwargs["recurring_day"] = DayOfWeek(INT_TO_DAY[int(day_of_week)])
        elif day_of_week is None and recurring_day is not None:
            rec = recurring_day.value if isinstance(recurring_day, DayOfWeek) else str(recurring_day)
            kwargs["day_of_week"] = DAY_TO_INT[rec]

        super().__init__(**kwargs)

    @hybrid_property
    def day_of_week(self) -> int | None:
        if self.recurring_day is None:
            return None
        rec = self.recurring_day.value if isinstance(self.recurring_day, DayOfWeek) else str(self.recurring_day)
        return DAY_TO_INT.get(rec)

    @day_of_week.setter
    def day_of_week(self, value: int | None) -> None:
        if value is None:
            self.recurring_day = None
            return
        if value not in INT_TO_DAY:
            raise ValueError("day_of_week must be an integer between 0 and 6.")
        self.recurring_day = DayOfWeek(INT_TO_DAY[value])

    @day_of_week.expression
    def day_of_week(cls):
        return case(
            (cls.recurring_day == DayOfWeek.MON, 0),
            (cls.recurring_day == DayOfWeek.TUE, 1),
            (cls.recurring_day == DayOfWeek.WED, 2),
            (cls.recurring_day == DayOfWeek.THU, 3),
            (cls.recurring_day == DayOfWeek.FRI, 4),
            (cls.recurring_day == DayOfWeek.SAT, 5),
            (cls.recurring_day == DayOfWeek.SUN, 6),
            else_=None,
        )

    @hybrid_property
    def title(self) -> str | None:
        return self.course_name

    @title.setter
    def title(self, value: str | None) -> None:
        self.course_name = value

    @title.expression
    def title(cls):
        return cls.course_name

    @hybrid_property
    def color(self) -> str | None:
        return self.color_code

    @color.setter
    def color(self, value: str | None) -> None:
        self.color_code = value

    @color.expression
    def color(cls):
        return cls.color_code


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
    subject = Column(String(200), nullable=True)
    exam_date = Column(Date, nullable=False)         # YYYY-MM-DD
    exam_time = Column(String(5), nullable=True)
    start_time = Column(String(5), nullable=True)    # "HH:MM"
    end_time = Column(String(5), nullable=True)      # "HH:MM"
    location = Column(String(200), nullable=True)
    memo = Column(Text, nullable=True)
    exam_duration_minutes = Column(Integer, nullable=True, default=120, server_default="120")
    source = Column(String(50), nullable=True)
    progress_note = Column(Text, nullable=True)
    weak_parts = Column(Text, nullable=True)

    user = relationship("User", back_populates="exam_schedules")
    schedule = relationship("Schedule", back_populates="exam_schedules", foreign_keys=[schedule_id])


class Event(Base):
    """이벤트. 특정 날짜의 일회성 일정."""
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    date = Column(Date, nullable=False)
    start_time = Column(String(5), nullable=True)   # "HH:MM"
    end_time = Column(String(5), nullable=True)     # "HH:MM"
    location = Column(String(200), nullable=True)
    color_code = Column(String(7), default="#F59E0B")
    memo = Column(Text, nullable=True)

    user = relationship("User", back_populates="events")
