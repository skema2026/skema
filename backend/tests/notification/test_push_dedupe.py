"""_push 중복 막기: 알림 설정을 바꾼 뒤의 '곧 시작' (11/14 통합 테스트에서 찾음).

실행: cd backend && python -m pytest tests/notification -q
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main  # noqa: F401  모든 모델을 Base에 등록
from app.auth.models import User
from app.db.database import Base
from app.notification import scheduler, service
from app.notification.models import Notification


@compiles(BigInteger, "sqlite")
def _bigint_as_integer(type_, compiler, **kw):
    # SQLite는 INTEGER PRIMARY KEY만 자동 번호를 매긴다 (notifications.id가 BigInteger)
    return "INTEGER"


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    monkeypatch.setattr(service, "send_push_to_user", lambda *a, **kw: None)
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def user_id(db):
    u = User(email="t@skema.dev", username="t")
    db.add(u)
    db.commit()
    return u.id


def _count(db, user_id):
    return db.query(Notification).filter(Notification.user_id == user_id).count()


def _sent_earlier_today(db, user_id, minutes_ago):
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    from datetime import timedelta
    db.add(Notification(user_id=user_id, type="reminder_start", title="곧 시작: 단어",
                        body="", related_schedule_id=5,
                        created_at=now_utc - timedelta(minutes=minutes_ago)))
    db.commit()


def test_same_setting_is_deduped(db, user_id):
    _sent_earlier_today(db, user_id, minutes_ago=1)
    since = datetime.now(scheduler.KST).replace(microsecond=0)
    from datetime import timedelta
    scheduler._push(db, user_id, "reminder_start", "곧 시작: 단어", "", related_id=5,
                    since=since - timedelta(minutes=5))
    assert _count(db, user_id) == 1


def test_alert_sent_before_setting_change_does_not_block(db, user_id):
    # 20분 전에(30분 전 설정으로) 보낸 알림이 있어도, 지금 설정 기준 시각 이후가 아니면 새로 보낸다
    _sent_earlier_today(db, user_id, minutes_ago=20)
    from datetime import timedelta
    since = datetime.now(scheduler.KST) - timedelta(minutes=2)
    if since.date() != datetime.now(scheduler.KST).date():
        pytest.skip("자정 직후에는 '오늘' 범위가 달라 건너뜀")
    scheduler._push(db, user_id, "reminder_start", "곧 시작: 단어", "", related_id=5, since=since)
    assert _count(db, user_id) == 2


def test_without_since_whole_day_counts(db, user_id):
    _sent_earlier_today(db, user_id, minutes_ago=0)
    scheduler._push(db, user_id, "reminder_start", "곧 시작: 단어", "", related_id=5)
    assert _count(db, user_id) == 1
