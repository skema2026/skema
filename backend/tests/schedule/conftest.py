"""다시 짜기·공부 블록 배치 테스트용 DB (SQLite 메모리).

실행: cd backend && python -m pytest tests/schedule -q
"""
from datetime import date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main  # noqa: F401  모든 모델을 Base에 등록
from app.auth.models import User, UserProfile
from app.db.database import Base
from app.schedule.free_slots import KST
from app.schedule.models import DayOfWeek, ExamSchedule, INT_TO_DAY, Schedule

# 기준 시각: 2026-11-02(월) 10:05 KST
NOW = datetime(2026, 11, 2, 10, 5, tzinfo=KST)
TODAY = NOW.date()


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def user(db):
    u = User(email="test@skema.dev", username="tester")
    db.add(u)
    db.flush()
    db.add(UserProfile(user_id=u.id, sleep_start="23:00", sleep_end="07:00"))
    db.commit()
    return u


def add_class(db, user_id, day: str, start: str, end: str, title="자료구조"):
    s = Schedule(
        user_id=user_id, course_name=title, recurring_day=DayOfWeek(day),
        start_time=start, end_time=end, schedule_type="class", schedule_source="eta_import",
    )
    db.add(s)
    db.commit()
    return s


def add_block(db, user_id, d: date, start: str, end: str, title="📖 자료구조 준비",
              exam_id=None, schedule_type="study", completed=False):
    s = Schedule(
        user_id=user_id, course_name=title,
        recurring_day=DayOfWeek(INT_TO_DAY[d.weekday()]), date=d.isoformat(),
        start_time=start, end_time=end, schedule_type=schedule_type,
        schedule_source="ai_generated", linked_exam_id=exam_id, is_completed=completed,
    )
    db.add(s)
    db.commit()
    return s


def add_exam(db, user_id, d: date, title="자료구조", start=None, end=None):
    e = ExamSchedule(user_id=user_id, title=title, subject=title, exam_date=d, start_time=start, end_time=end)
    db.add(e)
    db.commit()
    return e
