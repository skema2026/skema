from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=300)


class MemberOut(BaseModel):
    user_id: int
    username: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class GroupOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    invite_code: str
    member_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class GroupDetail(GroupOut):
    members: list[MemberOut]


# BeReal 스타일 피드 — 날짜별 멤버 x 기록 매트릭스
class MemberSlot(BaseModel):
    user_id: int
    username: str
    # 오늘 올린 기록 (없으면 None)
    log_id: Optional[int] = None
    photo_url: Optional[str] = None
    caption: Optional[str] = None
    schedule_title: Optional[str] = None
    created_at: Optional[datetime] = None
    reactions: list[dict] = []
    my_reactions: list[str] = []


class GroupFeedDay(BaseModel):
    date: str  # "2026-05-31"
    slots: list[MemberSlot]
