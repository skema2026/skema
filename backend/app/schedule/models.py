import enum
import re
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import (
    Boolean, Column, Date, Enum as SAEnum,
    ForeignKey, Integer, String, Text,
    case,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship

from app.db.database import Base


# ── 요일 Enum / 유틸 ──────────────────────────────────────────────────────────

class DayOfWeek(str, enum.Enum):
    MON = "MON"
    TUE = "TUE"
    WED = "WED"
    THU = "THU"
    FRI = "FRI"
    SAT = "SAT"
    SUN = "SUN"


DAY_TO_INT = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
INT_TO_DAY = {v: k for k, v in DAY_TO_INT.items()}


# ── ORM 모델 ──────────────────────────────────────────────────────────────────

class Schedule(Base):
    """수업 시간표. 매주 반복되는 강의를 저장."""
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_name = Column(String(200), nullable=False)
    professor = Column(String(100), nullable=True)
    location = Column(String(200), nullable=True)
    recurring_day = Column(SAEnum(DayOfWeek), nullable=False)
    start_time = Column(String(5), nullable=False)
    end_time = Column(String(5), nullable=False)
    color_code = Column(String(7), default="#6366F1")
    date = Column(String(10), nullable=True, index=True)
    priority = Column(Integer, nullable=True, default=0, server_default="0")
    is_completed = Column(Boolean, nullable=True, default=False, server_default="0")
    schedule_type = Column(String(30), nullable=True, default="class", server_default="class")
    schedule_source = Column(String(30), nullable=True, default="user_created", server_default="user_created")

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
    """시험 일정. schedule_id가 null이면 수업과 무관한 독립 시험 일정."""
    __tablename__ = "exam_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    subject = Column(String(200), nullable=True)
    exam_date = Column(Date, nullable=False)
    exam_time = Column(String(5), nullable=True)
    start_time = Column(String(5), nullable=True)
    end_time = Column(String(5), nullable=True)
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
    start_time = Column(String(5), nullable=True)
    end_time = Column(String(5), nullable=True)
    location = Column(String(200), nullable=True)
    color_code = Column(String(7), default="#F59E0B")
    memo = Column(Text, nullable=True)

    user = relationship("User", back_populates="events")


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

_COLOR_RE = re.compile(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_VALID_DAYS = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
_DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def _validate_time(v: Optional[str]) -> Optional[str]:
    if v is not None and not _TIME_RE.match(v):
        raise ValueError("시간 형식은 HH:MM 이어야 합니다. (예: 09:00)")
    return v


def _validate_color(v: Optional[str]) -> Optional[str]:
    if v and not _COLOR_RE.match(v):
        raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
    return v


def _normalize_day(v: str | int) -> str:
    if isinstance(v, int):
        if not 0 <= v <= 6:
            raise ValueError("요일 숫자는 0~6이어야 합니다. (0=월요일)")
        return _DAY_CODES[v]
    day = str(v).upper()
    if day not in _VALID_DAYS:
        raise ValueError(f"유효하지 않은 요일: {v}. MON~SUN 중 선택하세요.")
    return day


def _date_to_day(date_str: str) -> str:
    try:
        return _DAY_CODES[datetime.strptime(date_str, "%Y-%m-%d").date().weekday()]
    except ValueError as exc:
        raise ValueError("날짜 형식은 YYYY-MM-DD 이어야 합니다.") from exc


class ScheduleCreate(BaseModel):
    course_name: Optional[str] = None
    title: Optional[str] = None
    professor: Optional[str] = None
    location: Optional[str] = None
    days: Optional[list[str | int]] = None
    recurring_day: Optional[str] = None
    day_of_week: Optional[int] = None
    date: Optional[str] = None
    start_time: str
    end_time: str
    schedule_type: Optional[str] = "class"
    color_code: Optional[str] = "#6366F1"
    color: Optional[str] = None
    priority: Optional[int] = 0
    is_completed: Optional[bool] = False

    @field_validator("days")
    @classmethod
    def validate_days(cls, v):
        if v is None:
            return v
        days = [_normalize_day(d) for d in v]
        if len(days) == 0:
            raise ValueError("요일을 최소 1개 이상 선택해야 합니다.")
        return days

    @field_validator("recurring_day")
    @classmethod
    def validate_day(cls, v):
        return _normalize_day(v) if v is not None else v

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        return _validate_time(v)  # type: ignore[return-value]

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v):
        return _validate_color(v)

    @model_validator(mode="after")
    def normalize_legacy_fields(self):
        if not self.course_name and self.title:
            self.course_name = self.title
        if not self.course_name:
            raise ValueError("course_name 또는 title을 입력해야 합니다.")
        if self.color:
            self.color_code = self.color
        if self.days is None:
            if self.date:
                self.days = [_date_to_day(self.date)]
            elif self.recurring_day is not None:
                self.days = [_normalize_day(self.recurring_day)]
            elif self.day_of_week is not None:
                self.days = [_normalize_day(self.day_of_week)]
            else:
                self.days = ["MON"]
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("시작 시간은 종료 시간보다 이전이어야 합니다.")
        return self


class ScheduleUpdate(BaseModel):
    course_name: Optional[str] = None
    title: Optional[str] = None
    professor: Optional[str] = None
    location: Optional[str] = None
    recurring_day: Optional[str] = None
    day_of_week: Optional[int] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    color_code: Optional[str] = None
    color: Optional[str] = None
    priority: Optional[int] = None
    is_completed: Optional[bool] = None
    schedule_type: Optional[str] = None

    @field_validator("recurring_day")
    @classmethod
    def validate_day(cls, v):
        return _normalize_day(v) if v is not None else v

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v):
        return _validate_color(v)

    @model_validator(mode="after")
    def normalize_legacy_fields(self):
        if not self.course_name and self.title:
            self.course_name = self.title
        if self.color:
            self.color_code = self.color
        if self.recurring_day is None and self.day_of_week is not None:
            self.recurring_day = _normalize_day(self.day_of_week)
        if self.recurring_day is None and self.date:
            self.recurring_day = _date_to_day(self.date)
        return self


class ScheduleResponse(BaseModel):
    id: int
    user_id: int
    course_name: str
    title: str
    professor: Optional[str] = None
    location: Optional[str] = None
    recurring_day: str
    date: Optional[str] = None
    start_time: str
    end_time: str
    color_code: str = "#6366F1"
    color: str = "#6366F1"
    priority: int = 0
    is_completed: bool = False
    schedule_type: str = "class"
    schedule_source: Optional[str] = None

    model_config = {"from_attributes": True}


class ExamScheduleCreate(BaseModel):
    title: str
    schedule_id: Optional[int] = None
    subject: Optional[str] = None
    exam_date: date
    exam_time: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None
    exam_duration_minutes: Optional[int] = 120

    @field_validator("exam_time", "start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)


class ExamScheduleUpdate(BaseModel):
    title: Optional[str] = None
    schedule_id: Optional[int] = None
    subject: Optional[str] = None
    exam_date: Optional[date] = None
    exam_time: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None
    exam_duration_minutes: Optional[int] = None

    @field_validator("exam_time", "start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)


class ExamScheduleResponse(BaseModel):
    id: int
    user_id: int
    schedule_id: Optional[int] = None
    title: str
    subject: Optional[str] = None
    exam_date: date
    exam_time: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None
    exam_duration_minutes: Optional[int] = None

    model_config = {"from_attributes": True}


class EventCreate(BaseModel):
    title: str
    date: date
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    color_code: Optional[str] = "#F59E0B"
    memo: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v):
        return _validate_color(v)


class EventUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    color_code: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v):
        return _validate_color(v)


class EventResponse(BaseModel):
    id: int
    user_id: int
    title: str
    date: date
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    color_code: str = "#F59E0B"
    memo: Optional[str] = None

    model_config = {"from_attributes": True}
