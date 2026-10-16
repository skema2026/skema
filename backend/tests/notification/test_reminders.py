"""job_reminders 판단 로직 테스트.

실행: cd backend && python -m pytest tests/notification -q
"""
from types import SimpleNamespace

import pytest

from app.notification.scheduler import (
    REMINDER_INTERVAL_MINUTES,
    _reminder_kind,
)
from app.core.time_utils import time_to_minutes


def _schedule(start="14:00", end="15:00", schedule_type="study", is_completed=False):
    return SimpleNamespace(
        start_time=start,
        end_time=end,
        schedule_type=schedule_type,
        is_completed=is_completed,
    )


def _ticks():
    """스케줄러가 하루 동안 깨어나는 시각(분)."""
    return range(0, 1440, REMINDER_INTERVAL_MINUTES)


@pytest.mark.parametrize("reminder_min", [5, 10, 15, 30, 60])
@pytest.mark.parametrize("start", ["09:00", "14:00", "14:30", "23:30"])
def test_start_reminder_fires_for_every_user_setting(reminder_min, start):
    """:00·:30에 시작하는 블록은 어떤 알림 설정이든 정확히 그 시점에 한 번은 걸린다."""
    s = _schedule(start=start, end="23:59")
    hits = [
        (now, kind[1])
        for now in _ticks()
        if (kind := _reminder_kind(s, now, reminder_min)) and kind[0] == "start"
    ]
    assert hits, f"{start} 블록에 {reminder_min}분 전 알림이 한 번도 안 걸림"
    first_now, first_diff = hits[0]
    assert first_diff == reminder_min
    assert first_now == (time_to_minutes(start) - reminder_min) % 1440


def test_old_30_minute_interval_missed_short_settings():
    """회귀 확인용: 30분 간격이었다면 10분 전 알림은 영원히 안 걸린다."""
    s = _schedule(start="14:00", end="15:00")
    hits = [now for now in range(0, 1440, 30) if (_reminder_kind(s, now, 10) or ("",))[0] == "start"]
    assert hits == []


def test_completed_schedule_gets_nothing():
    s = _schedule(is_completed=True)
    assert _reminder_kind(s, time_to_minutes("13:55"), 10) is None
    assert _reminder_kind(s, time_to_minutes("16:00"), 10) is None


def test_incomplete_reminder_after_end_for_study():
    s = _schedule(start="14:00", end="15:00", schedule_type="study")
    assert _reminder_kind(s, time_to_minutes("15:05"), 10) == ("incomplete", 0)


def test_no_incomplete_reminder_for_class():
    """수업은 매주 반복이라 끝났다고 '미완료' 알림을 보내지 않는다."""
    s = _schedule(start="09:00", end="10:15", schedule_type="class")
    assert _reminder_kind(s, time_to_minutes("10:20"), 10) is None


def test_class_still_gets_start_reminder():
    s = _schedule(start="09:00", end="10:15", schedule_type="class")
    assert _reminder_kind(s, time_to_minutes("08:50"), 10) == ("start", 10)
