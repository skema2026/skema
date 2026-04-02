import re
from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator

from app.schedule.models import DayOfWeek

_COLOR_RE = re.compile(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_time(v: Optional[str]) -> Optional[str]:
    if v is not None and not _TIME_RE.match(v):
        raise ValueError("시간 형식은 HH:MM 이어야 합니다. (예: 09:00)")
    return v


# ── Schedule ──────────────────────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    course_name: str
    professor: Optional[str] = None
    location: Optional[str] = None
    day_of_week: DayOfWeek
    start_time: str   # "HH:MM"
    end_time: str     # "HH:MM"
    color_code: Optional[str] = "#6366F1"

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        return _validate_time(v)  # type: ignore[return-value]

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        # start_time < end_time 검증
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("시작 시간은 종료 시간보다 이전이어야 합니다.")


class ScheduleUpdate(BaseModel):
    course_name: Optional[str] = None
    professor: Optional[str] = None
    location: Optional[str] = None
    day_of_week: Optional[DayOfWeek] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    color_code: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    @field_validator("color_code")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v


class ScheduleResponse(BaseModel):
    id: int
    user_id: int
    course_name: str
    professor: Optional[str] = None
    location: Optional[str] = None
    day_of_week: DayOfWeek
    start_time: str
    end_time: str
    color_code: str

    model_config = {"from_attributes": True}


# ── ExamSchedule ──────────────────────────────────────────────────────────────

class ExamScheduleCreate(BaseModel):
    schedule_id: Optional[int] = None   # null = 독립 시험 (수업과 무관)
    title: str
    exam_date: date
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("시작 시간은 종료 시간보다 이전이어야 합니다.")


class ExamScheduleUpdate(BaseModel):
    schedule_id: Optional[int] = None
    title: Optional[str] = None
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
