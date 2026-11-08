from datetime import datetime

from pydantic import BaseModel, field_validator


class ShareTokenCreate(BaseModel):
    expires_at: datetime | None = None   # null = 영구 유효


class ShareTokenResponse(BaseModel):
    id: int
    user_id: int
    token: str
    expires_at: datetime | None = None
    is_active: bool
    created_at: datetime
    share_url: str = ""   # 응답 시 서버에서 주입

    model_config = {"from_attributes": True}


# 11/7: 공개 공유 링크 응답. 예전에는 ORM 객체를 그대로 돌려줘서 user_id·삭제 여부·생성 출처 같은
# 내부 칸까지 나갔고, 정작 화면이 쓰는 title·color 는 빠져 있어 공유 화면에 과목명이 안 보였다.
class SharedSchedule(BaseModel):
    id: int
    title: str
    course_name: str
    recurring_day: str
    date: str | None = None
    start_time: str
    end_time: str
    location: str | None = None
    color: str = "#6366F1"
    color_code: str = "#6366F1"
    schedule_type: str = "class"
    view_scope: str = "day_week"
    priority: int = 0
    is_completed: bool = False

    model_config = {"from_attributes": True}

    @field_validator("recurring_day", mode="before")
    @classmethod
    def _day_value(cls, v):
        return getattr(v, "value", v)

    @field_validator("color", "color_code", "view_scope", "schedule_type", mode="before")
    @classmethod
    def _defaults_for_null(cls, v, info):
        if v is None:
            return cls.model_fields[info.field_name].default
        return v


class SharedTimetable(BaseModel):
    schedules: list[SharedSchedule]
    username: str | None = None
