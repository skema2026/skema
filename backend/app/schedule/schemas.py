import re
from datetime import date as Date, datetime

from pydantic import BaseModel, field_validator, model_validator

_COLOR_RE = re.compile(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_VALID_DAYS = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
_DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
_VALID_VIEW_SCOPES = {
    "day",
    "week",
    "month",
    "day_week",
    "day_month",
    "week_month",
    "all",
}


def _validate_time(v: str | None) -> str | None:
    if v is not None and not _TIME_RE.match(v):
        raise ValueError("시간 형식은 HH:MM 이어야 합니다. (예: 09:00)")
    return v


def _validate_color(v: str | None) -> str | None:
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


def _default_view_scope(date_str: str | None) -> str:
    return "day_month" if date_str else "day_week"


def _validate_view_scope(v: str | None) -> str | None:
    if v is None:
        return v
    scope = v.strip().lower()
    if scope not in _VALID_VIEW_SCOPES:
        raise ValueError("표시 위치는 day, week, month 조합이어야 합니다.")
    return scope


# ── Schedule ──────────────────────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    course_name: str | None = None
    title: str | None = None
    professor: str | None = None
    location: str | None = None
    days: list[str | int] | None = None
    recurring_day: str | None = None
    day_of_week: int | None = None
    date: str | None = None
    start_time: str
    end_time: str
    schedule_type: str | None = "class"
    color_code: str | None = "#6366F1"
    color: str | None = None
    priority: int | None = 0
    is_completed: bool | None = False
    view_scope: str | None = None

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

    @field_validator("view_scope")
    @classmethod
    def validate_view_scope(cls, v):
        return _validate_view_scope(v)

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
        if not self.view_scope:
            self.view_scope = _default_view_scope(self.date)
        return self


class ScheduleUpdate(BaseModel):
    course_name: str | None = None
    title: str | None = None
    professor: str | None = None
    location: str | None = None
    recurring_day: str | None = None
    day_of_week: int | None = None
    date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    color_code: str | None = None
    color: str | None = None
    priority: int | None = None
    is_completed: bool | None = None
    schedule_type: str | None = None
    view_scope: str | None = None

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

    @field_validator("view_scope")
    @classmethod
    def validate_view_scope(cls, v):
        return _validate_view_scope(v)

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
    professor: str | None = None
    location: str | None = None
    recurring_day: str
    date: str | None = None
    start_time: str
    end_time: str
    color_code: str = "#6366F1"
    color: str = "#6366F1"
    priority: int = 0
    is_completed: bool = False
    schedule_type: str = "class"
    schedule_source: str | None = None
    view_scope: str = "day_week"

    model_config = {"from_attributes": True}


# ── ExamSchedule ──────────────────────────────────────────────────────────────

class ExamScheduleCreate(BaseModel):
    title: str
    schedule_id: int | None = None
    subject: str | None = None
    exam_date: Date
    exam_time: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    memo: str | None = None
    exam_duration_minutes: int | None = 120

    @field_validator("exam_time", "start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)


class ExamScheduleUpdate(BaseModel):
    title: str | None = None
    schedule_id: int | None = None
    subject: str | None = None
    exam_date: Date | None = None
    exam_time: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    memo: str | None = None
    exam_duration_minutes: int | None = None

    @field_validator("exam_time", "start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)


class ExamScheduleResponse(BaseModel):
    id: int
    user_id: int
    schedule_id: int | None = None
    title: str
    subject: str | None = None
    exam_date: Date
    exam_time: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    memo: str | None = None
    exam_duration_minutes: int | None = None

    model_config = {"from_attributes": True}


# ── Event ─────────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    title: str
    date: Date
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    color_code: str | None = "#F59E0B"
    memo: str | None = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v):
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v):
        return _validate_color(v)


class EventUpdate(BaseModel):
    title: str | None = None
    date: Date | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    color_code: str | None = None
    memo: str | None = None

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
    date: Date
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    color_code: str = "#F59E0B"
    memo: str | None = None

    model_config = {"from_attributes": True}
