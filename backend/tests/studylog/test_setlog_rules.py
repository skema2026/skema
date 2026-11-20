"""공부 인증 셋로그 규칙 (11/20): 한 시간에 한 번, 화면에는 오늘 것만."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user, get_db
from app.main import app
from app.studylog.models import StudyGroup, StudyGroupMember, StudyLog
from app.studylog.router import KST, ensure_hourly_slot_free, kst_hour_window, kst_today_window
from tests.schedule.conftest import db, user  # noqa: F401

# 기준: 2026-11-20(금) 14:20 KST = 05:20 UTC
NOW = datetime(2026, 11, 20, 14, 20, tzinfo=KST)


def utc_naive(kst: datetime) -> datetime:
    return kst.astimezone(timezone.utc).replace(tzinfo=None)


def add_log(db, user_id, at_kst: datetime, group_id=None, caption="공부"):  # noqa: F811
    log = StudyLog(user_id=user_id, group_id=group_id, caption=caption, is_public=False, created_at=utc_naive(at_kst))
    db.add(log)
    db.commit()
    return log


@pytest.fixture
def group(db, user):  # noqa: F811
    g = StudyGroup(name="시험 스터디", invite_code="ABC123", created_by=user.id)
    db.add(g)
    db.flush()
    db.add(StudyGroupMember(group_id=g.id, user_id=user.id))
    db.commit()
    return g


@pytest.fixture
def client(db, user):  # noqa: F811
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


# ── 시간 칸 계산 ─────────────────────────────────────────────────────────────

def test_hour_window_is_kst_clock_hour():
    start, end, hour = kst_hour_window(NOW)
    assert hour == 14
    assert start == utc_naive(datetime(2026, 11, 20, 14, 0, tzinfo=KST))
    assert end - start == timedelta(hours=1)


def test_today_window_starts_at_kst_midnight():
    # 새벽 1시(KST)는 UTC로는 전날 16시지만 '오늘'이어야 한다
    start, end = kst_today_window(datetime(2026, 11, 20, 1, 0, tzinfo=KST))
    assert start == utc_naive(datetime(2026, 11, 20, 0, 0, tzinfo=KST))
    assert end == utc_naive(datetime(2026, 11, 21, 0, 0, tzinfo=KST))


# ── 한 시간에 한 번 ──────────────────────────────────────────────────────────

def test_second_post_in_same_hour_is_rejected(db, user):  # noqa: F811
    add_log(db, user.id, datetime(2026, 11, 20, 14, 5, tzinfo=KST))
    with pytest.raises(HTTPException) as e:
        ensure_hourly_slot_free(db, user.id, None, now=NOW)
    assert e.value.status_code == 409
    assert "14시" in e.value.detail and "15시" in e.value.detail


def test_post_in_previous_hour_does_not_block(db, user):  # noqa: F811
    add_log(db, user.id, datetime(2026, 11, 20, 13, 59, tzinfo=KST))
    ensure_hourly_slot_free(db, user.id, None, now=NOW)  # 통과


def test_hour_limit_is_per_group(db, user, group):  # noqa: F811
    add_log(db, user.id, datetime(2026, 11, 20, 14, 5, tzinfo=KST), group_id=group.id)
    ensure_hourly_slot_free(db, user.id, None, now=NOW)  # 그룹 없음 칸은 비어 있음
    with pytest.raises(HTTPException):
        ensure_hourly_slot_free(db, user.id, group.id, now=NOW)


def test_late_night_message_wraps_to_zero(db, user):  # noqa: F811
    late = datetime(2026, 11, 20, 23, 40, tzinfo=KST)
    add_log(db, user.id, datetime(2026, 11, 20, 23, 1, tzinfo=KST))
    with pytest.raises(HTTPException) as e:
        ensure_hourly_slot_free(db, user.id, None, now=late)
    assert "23시" in e.value.detail and "0시부터" in e.value.detail


def test_upload_api_returns_409_in_same_hour(db, user, client):  # noqa: F811
    first = client.post("/study-logs", data={"caption": "첫 인증"})
    assert first.status_code == 201
    second = client.post("/study-logs", data={"caption": "두 번째"})
    assert second.status_code == 409
    assert "다시 올릴 수 있어요" in second.json()["detail"]


# ── 오늘 것만 보이기 ─────────────────────────────────────────────────────────

def test_my_logs_show_only_today(db, user, client):  # noqa: F811
    now = datetime.now(KST)
    add_log(db, user.id, now - timedelta(days=1), caption="어제")
    add_log(db, user.id, now - timedelta(days=3), caption="사흘 전")
    add_log(db, user.id, now.replace(hour=0, minute=1) if now.hour else now, caption="오늘")
    res = client.get("/study-logs/me")
    assert res.status_code == 200
    captions = [i["caption"] for i in res.json()["items"]]
    assert captions == ["오늘"]


def test_group_feed_returns_only_today(db, user, group, client):  # noqa: F811
    now = datetime.now(KST)
    add_log(db, user.id, now - timedelta(days=1), group_id=group.id, caption="어제")
    add_log(db, user.id, now.replace(hour=0, minute=1) if now.hour else now, group_id=group.id, caption="오늘")
    res = client.get(f"/groups/{group.id}/feed", params={"days": 7})  # 옛 클라이언트가 7을 보내도
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1 and body[0]["date"] == now.date().isoformat()
    assert [s["caption"] for s in body[0]["slots"] if s["log_id"]] == ["오늘"]
