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
    professor: Optional[str] = None
    location: Optional[str] = None
    day_of_week: int                          # 0=월 ~ 6=일
    date: Optional[date] = None               # null = 매주 반복
    start_time: str                           # "HH:MM"
    end_time: str                             # "HH:MM"
    color: Optional[str] = "#6366F1"
    priority: Optional[int] = 0
    schedule_type: Optional[str] = "class"   # class / event / study

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        return _validate_time(v)  # type: ignore[return-value]

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("시작 시간은 종료 시간보다 이전이어야 합니다.")


class ScheduleUpdate(BaseModel):
    title: Optional[str] = None
    professor: Optional[str] = None
    location: Optional[str] = None
    day_of_week: Optional[int] = None
    date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    color: Optional[str] = None
    priority: Optional[int] = None
    schedule_type: Optional[str] = None
    is_completed: Optional[bool] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _COLOR_RE.match(v):
            raise ValueError("색상 코드는 #RRGGBB 또는 #RGB 형식이어야 합니다.")
        return v


class ScheduleResponse(BaseModel):
    id: int
    user_id: int
    title: str
    professor: Optional[str] = None
    location: Optional[str] = None
    day_of_week: int
    date: Optional[date] = None
    start_time: str
    end_time: str
    color: str
    priority: int = 0
    schedule_type: str = "class"
    is_completed: bool = False

    model_config = {"from_attributes": True}


# ── ExamSchedule ──────────────────────────────────────────────────────────────

class ExamScheduleCreate(BaseModel):
    schedule_id: Optional[int] = None
    title: str
    subject: Optional[str] = None
    exam_date: date
    exam_time: Optional[str] = None           # "HH:MM"
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("start_time", "end_time", "exam_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_time(v)

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("시작 시간은 종료 시간보다 이전이어야 합니다.")


class ExamScheduleUpdate(BaseModel):
    schedule_id: Optional[int] = None
    title: Optional[str] = None
    subject: Optional[str] = None
    exam_date: Optional[date] = None
    exam_time: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    memo: Optional[str] = None

    @field_validator("start_time", "end_time", "exam_time")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
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

    model_config = {"from_attributes": True}


# ── 알고리즘 엔드포인트용 스키마 ──────────────────────────────────────────────

class FreeSlot(BaseModel):
    start_time: str
    end_time: str


class FreeSlotQuery(BaseModel):
    date: Optional[date] = None
    day_of_week: Optional[int] = None   # 0=월 ~ 6=일
    duration_minutes: int = 60


class ConflictCheckQuery(BaseModel):
    date: Optional[date] = None
    day_of_week: Optional[int] = None
    start_time: str
    end_time: str
    exclude_id: Optional[int] = None


class StudyScheduleRequest(BaseModel):
    subject: str
    target_days: int = 7
    daily_study_hours: float = 2.0


class ExamPrepRequest(BaseModel):
    exam_id: Optional[int] = None
    target_days: int = 14
    daily_study_hours: float = 2.0


class RescheduleRequest(BaseModel):
    target_days: int = 7


class GenerateResult(BaseModel):
    created: int
    details: list[str] = []


class RescheduleResult(BaseModel):
    moved: int
    details: list[str] = []
