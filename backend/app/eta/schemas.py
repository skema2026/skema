
from typing import Literal

from pydantic import BaseModel

# 11/4: 시간표 가져오기에서 고를 수 있는 일정 종류. 알바·스터디 같은 개인 일정은 'personal'
EtaScheduleType = Literal["class", "personal"]


class ParsedEntry(BaseModel):
    subject_name: str
    day_of_week: int  # 0=월 ... 6=일
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    location: str | None = None
    raw_text: str | None = None
    source: str = "eta_image"
    requires_review: bool = False
    # 파싱 때는 '추천' 종류(강의실 없는 알바·스터디 등은 personal), 저장 때는 사용자가 고른 종류
    schedule_type: EtaScheduleType = "class"


class SaveSchedulesRequest(BaseModel):
    entries: list[ParsedEntry]


class NormalizedEntryModel(BaseModel):
    title: str
    day: str
    startTime: str
    endTime: str
    location: str = ""
    bbox: tuple[int, int, int, int]
