"""미완료·시작 알림을 누르면 그날 하루 타임라인이 열리는지 (#16).

실행: cd backend && python -m pytest tests/notification -q
"""
from datetime import datetime as real_datetime
from types import SimpleNamespace

import pytest

from app.notification import scheduler


class _FixedDatetime(real_datetime):
    @classmethod
    def now(cls, tz=None):
        return real_datetime(2026, 11, 9, 15, 5, tzinfo=scheduler.KST)  # 월요일 15:05


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, users, schedules):
        self._users = users
        self._schedules = schedules
        self.committed = False

    def query(self, model):
        return _Query(self._users if model.__name__ == "User" else self._schedules)

    def commit(self):
        self.committed = True

    def close(self):
        pass


def _block(**kw):
    base = dict(
        id=7, title="자료구조 복습", date="2026-11-09", day_of_week=None,
        start_time="14:00", end_time="15:00", schedule_type="study", is_completed=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture
def captured(monkeypatch):
    calls = []
    monkeypatch.setattr(scheduler, "datetime", _FixedDatetime)
    monkeypatch.setattr(scheduler, "_get_reminder_minutes", lambda db, uid: 10)
    monkeypatch.setattr(scheduler, "_push", lambda *a, **kw: calls.append((a, kw)))
    return calls


def _run(monkeypatch, schedules):
    db = _FakeDb([SimpleNamespace(id=1)], schedules)
    monkeypatch.setattr(scheduler, "_get_db", lambda: db)
    scheduler.job_reminders()
    assert db.committed


def test_day_timeline_url_matches_dashboard_params():
    # DashboardClient는 view=day, date=YYYY-MM-DD를 읽는다.
    assert scheduler.day_timeline_url("2026-11-09") == "/dashboard?view=day&date=2026-11-09"


def test_incomplete_alert_opens_that_day_timeline(monkeypatch, captured):
    _run(monkeypatch, [_block()])
    assert len(captured) == 1
    args, kw = captured[0]
    assert args[2] == "reminder_incomplete"
    assert kw["url"] == "/dashboard?view=day&date=2026-11-09"
    assert "다시 짜기" in args[4]


def test_recurring_block_uses_today_date(monkeypatch, captured):
    # 매주 반복 일정은 date가 없으니 알림 시점의 오늘 날짜로 연다.
    _run(monkeypatch, [_block(date=None, day_of_week=0)])
    assert captured[0][1]["url"] == "/dashboard?view=day&date=2026-11-09"


def test_start_alert_also_opens_day_timeline(monkeypatch, captured):
    _run(monkeypatch, [_block(start_time="15:15", end_time="16:00")])
    args, kw = captured[0]
    assert args[2] == "reminder_start"
    assert kw["url"] == "/dashboard?view=day&date=2026-11-09"


def test_weekly_report_points_to_reschedule_not_ai_chat():
    import inspect
    src = inspect.getsource(scheduler.job_weekly_report)
    assert "AI 채팅에서 재배치" not in src
    assert "다시 짜기" in src
