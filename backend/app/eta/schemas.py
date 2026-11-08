
import re
from typing import Literal

from pydantic import BaseModel, field_validator

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


_HHMM_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def normalize_hhmm(value: str) -> str:
    """저장할 시간을 HH:MM으로 맞춘다. '9:00' → '09:00', '24:00'(하루 끝) → '23:59'.

    확인 화면에서 사용자가 고친 값은 한 자리 시(9:00)로 올 수 있다. 예전에는 문자열로 비교해서
    "9:00" >= "10:00"이 참이 되어 정상 항목이 조용히 버려졌다(11/7).
    DB 칸이 String(5)이고 위치 파서도 24:00을 23:59로 저장하므로 같은 규칙을 쓴다.
    """
    m = _HHMM_RE.match((value or "").strip())
    if not m:
        raise ValueError(f"시간 형식은 HH:MM 이어야 합니다: {value!r}")
    hour, minute = int(m.group(1)), int(m.group(2))
    if hour == 24 and minute == 0:
        return "23:59"
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"없는 시간입니다: {value!r}")
    return f"{hour:02d}:{minute:02d}"


class SaveSchedulesRequest(BaseModel):
    entries: list[ParsedEntry]

    @field_validator("entries")
    @classmethod
    def normalize_times(cls, entries: list[ParsedEntry]) -> list[ParsedEntry]:
        # 형식이 틀린 시간은 422로 돌려보낸다. 빈 값과 범위(5~24시) 밖은 예전처럼 저장 단계에서 건너뛴다.
        def norm(value: str) -> str:
            return normalize_hhmm(value) if (value or "").strip() else ""

        return [
            e.model_copy(update={"start_time": norm(e.start_time), "end_time": norm(e.end_time)})
            for e in entries
        ]


class NormalizedEntryModel(BaseModel):
    title: str
    day: str
    startTime: str
    endTime: str
    location: str = ""
    bbox: tuple[int, int, int, int]
