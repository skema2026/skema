from typing import Optional

from pydantic import BaseModel


class ParsedEntry(BaseModel):
    subject_name: str
    day_of_week: int  # 0=월 ... 6=일
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    raw_text: Optional[str] = None
    source: str = "eta_image"
    requires_review: bool = False


class SaveSchedulesRequest(BaseModel):
    entries: list[ParsedEntry]


class NormalizedEntryModel(BaseModel):
    title: str
    day: str
    startTime: str
    endTime: str
    location: str = ""
    bbox: tuple[int, int, int, int]
