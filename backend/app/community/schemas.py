from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class PostCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class PostOut(BaseModel):
    id: int
    author_id: int
    username: str
    content: str
    image_url: Optional[str] = None
    likes_count: int
    liked: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PostFeed(BaseModel):
    items: list[PostOut]
    total: int
    has_next: bool
