import re
from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator

_COLOR_RE = re.compile(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_time(v: Optional[str]) -> Optional[str]:
    if v is not None and not _TIME_RE.match(v):
        raise ValueError("시간 형식은 HH:MM 이어야 합니다. (예: 09:00)")
    return v


# ── Schedule ──────────────────────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    title: str
    location: Optional[str] = None
    day_of_week: int = 0                        # 0=월 … 6=일
    date: Optional[str] = None                  # YYYY-MM-DD; null이면 매주 반복
    start_time: str                             # HH:MM
    end_time: str                               # HH:MM
    color: Optional[str] = "#6366F1"            # #RRGGBB
    priority: Optional[int] = 0                 # 0=보통 1=높음 2=긴급
    is_completed: Optional[bool] = False
    schedule_type: Optional[str] = "class"      # class | event | study

    @field_validator("day_of_week")
    @classmethod
    def validate_dow(cls, v: int) -> int:
        if not (0 <= v <= 6):
            raise ValueError("요일은 0(월)~6(일) 사이여야 합니다.")
        return v

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        return _validate_time(v)  # type: ignore[return-value]

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("시작 시간은 종료 시간보다 이전이어야 합니다.")


class ScheduleUpdate(BaseModel):
    title: Optional[str] = None
    location: Optional[str] = None
    day_of_week: Optional[int] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    color: Optional[str] = None
    priority: Optional[int] = None
    is_completed: Optional[bool] = None
    schedule_type: Optional[str] = None

    @field_validator("day_of_week")
    @classmethod
    def validate_dow(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (0 <= v <= 6):
            raise ValueError("요일은 0(월)~6(일) 사이여야 합니다.")
        return v

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v


class ScheduleResponse(BaseModel):
    id: int
    user_id: int
    title: str
    location: Optional[str] = None
    day_of_week: int
    date: Optional[str] = None
    start_time: str
    end_time: str
    color: str = "#6366F1"
    priority: int = 0
    is_completed: bool = False
    schedule_type: str = "class"

    model_config = {"from_attributes": True}


# ── ExamSchedule ──────────────────────────────────────────────────────────────

class ExamScheduleCreate(BaseModel):
    title: str
    subject: Optional[str] = None
    exam_date: date
    exam_time: Optional[str] = None             # HH:MM 시험 시작 시간
    location: Optional[str] = None

    @field_validator("exam_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)


class ExamScheduleUpdate(BaseModel):
    title: Optional[str] = None
    subject: Optional[str] = None
    exam_date: Optional[date] = None
    exam_time: Optional[str] = None
    location: Optional[str] = None

    @field_validator("exam_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)


class ExamScheduleResponse(BaseModel):
    id: int
    user_id: int
    title: str
    subject: Optional[str] = None
    exam_date: date
    exam_time: Optional[str] = None
    location: Optional[str] = None

    model_config = {"from_attributes": True}
