import re
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

_COLOR_RE = re.compile(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_VALID_DAYS = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
_DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def _validate_time(v: Optional[str]) -> Optional[str]:
    if v is not None and not _TIME_RE.match(v):
        raise ValueError("시간 형식은 HH:MM 이어야 합니다. (예: 09:00)")
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


# ── Schedule (수업 시간표) ────────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    course_name: Optional[str] = None
    title: Optional[str] = None
    professor: Optional[str] = None
    location: Optional[str] = None
    days: Optional[list[str | int]] = None        # ["MON", "WED"] 또는 [0, 2]
    recurring_day: Optional[str] = None           # "MON" ~ "SUN"
    day_of_week: Optional[int] = None             # 레거시 입력 호환
    date: Optional[str] = None                    # YYYY-MM-DD
    start_time: str                              # HH:MM
    end_time: str                                # HH:MM
    schedule_type: Optional[str] = "class"
    color_code: Optional[str] = "#6366F1"
    color: Optional[str] = None
    priority: Optional[int] = 0
    is_completed: Optional[bool] = False

    @field_validator("days")
    @classmethod
    def validate_days(cls, v: Optional[list[str | int]]) -> Optional[list[str]]:
        if v is None:
            return v
        days = [_normalize_day(d) for d in v]
        if len(days) == 0:
            raise ValueError("요일을 최소 1개 이상 선택해야 합니다.")
        return days

    @field_validator("recurring_day")
    @classmethod
    def validate_day(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _normalize_day(v)
        return v

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        return _validate_time(v)  # type: ignore[return-value]

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v

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
    recurring_day: Optional[str] = None          # "MON" ~ "SUN"
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
    def validate_day(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.upper()
            if v not in _VALID_DAYS:
                raise ValueError(f"유효하지 않은 요일: {v}. MON~SUN 중 선택하세요.")
        return v

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v

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
    recurring_day: str                           # "MON" ~ "SUN"
    date: Optional[str] = None
    start_time: str
    end_time: str
    color_code: str = "#6366F1"
    color: str = "#6366F1"
    priority: int = 0
    is_completed: bool = False
    schedule_type: str = "class"
    schedule_source: Optional[str] = None
    linked_exam_id: Optional[int] = None
    user_override: Optional[bool] = None
    deleted_by_user: Optional[bool] = None
    original_generated_title: Optional[str] = None

    model_config = {"from_attributes": True}


# ── ExamSchedule ─────────────────────────────────────────────────────────────

class ExamScheduleCreate(BaseModel):
    title: str
    schedule_id: Optional[int] = None
    exam_date: date
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)


class ExamScheduleUpdate(BaseModel):
    title: Optional[str] = None
    schedule_id: Optional[int] = None
    exam_date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)


class ExamScheduleResponse(BaseModel):
    id: int
    user_id: int
    schedule_id: Optional[int] = None
    title: str
    exam_date: date
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Event ────────────────────────────────────────────────────────────────────

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
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v


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
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v


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
