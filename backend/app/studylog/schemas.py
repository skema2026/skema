from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ReactionOut(BaseModel):
    emoji: str
    count: int


class StudyLogOut(BaseModel):
    id: int
    user_id: int
    username: str
    schedule_id: Optional[int] = None
    schedule_title: Optional[str] = None
    photo_url: Optional[str] = None
    caption: Optional[str] = None
    is_public: bool
    created_at: datetime
    reactions: list[ReactionOut] = []
    my_reactions: list[str] = []

    model_config = {"from_attributes": True}


class StudyLogCreate(BaseModel):
    caption: Optional[str] = Field(None, max_length=200)
    is_public: bool = True
    schedule_id: Optional[int] = None


class ReactionToggleRequest(BaseModel):
    emoji: str = Field(..., max_length=10)


class FeedResponse(BaseModel):
    items: list[StudyLogOut]
    total: int
    has_next: bool
