"""시험 공부 블록 배치 (#12) 테스트.

실행: cd backend && python -m pytest tests/schedule -q
"""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.core.time_utils import time_to_minutes as t
from app.schedule import study_blocks
from app.schedule.models import Schedule
from app.schedule.study_blocks import ExamIn, candidate_days, choose_days, plan_study_blocks

from .conftest import NOW, TODAY, add_class, add_exam


def test_candidate_days_stop_day_before_exam():
    exam = TODAY + timedelta(days=5)
    days = candidate_days(exam, TODAY, start_days_before=3)
    assert days == [exam - timedelta(days=3), exam - timedelta(days=2), exam - timedelta(days=1)]
    assert candidate_days(exam, TODAY, 0)[0] == TODAY
    assert candidate_days(TODAY, TODAY, 14) == []  # 시험이 오늘이면 공부할 날 없음


def test_choose_days_prefers_free_days():
    days = [TODAY + timedelta(days=i) for i in range(7)]
    free = {d: [0] * (10 if i in (2, 5) else 3) for i, d in enumerate(days)}
    assert choose_days(days, free, 2) == [days[2], days[5]]


def test_two_exams_do_not_share_slots():
    d = TODAY + timedelta(days=1)
    free = {d: [t("19:00"), t("19:30"), t("20:00"), t("20:30")]}
    exams = [ExamIn(1, "자료구조", TODAY + timedelta(days=2)), ExamIn(2, "운영체제", TODAY + timedelta(days=3))]
    blocks, results = plan_study_blocks(exams, free, TODAY, 1, 7, 60)
    assert [(b["exam_id"], b["start_time"], b["end_time"]) for b in blocks] == [
        (1, "19:00", "20:00"),  # 가까운 시험 먼저
    ]
    assert blocks[0]["title"] == "📖 자료구조 준비"


def _overlaps_class(db, user_id, s: Schedule) -> bool:
    d = date.fromisoformat(s.date)
    st, en = t(s.start_time), t(s.end_time)
    classes = db.query(Schedule).filter(Schedule.user_id == user_id, Schedule.schedule_type == "class").all()
    return any(
        t(c.start_time) < en and st < t(c.end_time)
        for c in classes
        if c.date is None and c.day_of_week == d.weekday()
    )


def test_new_account_timetable_and_two_exams(db, user):
    """완료 기준: 에타 시간표 + 시험 2개 → 30분 단위 공부 블록, 수업과 겹치지 않음."""
    for day, start, end in [("MON", "09:00", "12:00"), ("TUE", "13:00", "18:00"), ("WED", "09:00", "21:00"),
                            ("THU", "10:30", "15:00"), ("FRI", "09:00", "11:00")]:
        add_class(db, user.id, day, start, end)
    e1 = add_exam(db, user.id, TODAY + timedelta(days=6), title="자료구조", start="10:00", end="12:00")
    e2 = add_exam(db, user.id, TODAY + timedelta(days=9), title="운영체제")

    out = study_blocks.generate(db, user.id, [e2.id, e1.id], start_days_before=14, days_per_week=7,
                                minutes_per_day=120, now=NOW)
    assert out["created"] > 0

    rows = db.query(Schedule).filter(Schedule.user_id == user.id, Schedule.schedule_type == "study").all()
    assert len(rows) == out["created"]
    exam_day = {e1.id: e1.exam_date, e2.id: e2.exam_date}
    seen: dict[str, list[tuple[int, int]]] = {}
    for s in rows:
        d = date.fromisoformat(s.date)
        st, en = t(s.start_time), t(s.end_time)
        assert st % 30 == 0 and (en - st) % 30 == 0, "30분 단위"
        assert TODAY <= d < exam_day[s.linked_exam_id], "시험 전날까지"
        assert t("07:00") <= st and en <= t("23:00"), "수면 시간 피함"
        assert not _overlaps_class(db, user.id, s), "수업과 겹치면 안 됨"
        if d == TODAY:
            assert st >= t("10:30"), "지금 이후"
        for a, b in seen.get(s.date, []):
            assert not (a < en and st < b), "공부 블록끼리 겹치면 안 됨"
        seen.setdefault(s.date, []).append((st, en))
        assert s.course_name in ("📖 자료구조 준비", "📖 운영체제 준비")

    # 하루 120분 목표
    per_exam_day: dict[tuple[int, str], int] = {}
    for s in rows:
        per_exam_day[(s.linked_exam_id, s.date)] = per_exam_day.get((s.linked_exam_id, s.date), 0) + t(s.end_time) - t(s.start_time)
    assert all(v <= 120 for v in per_exam_day.values())

    # 다시 만들어도 블록이 두 배로 늘지 않음
    again = study_blocks.generate(db, user.id, [e1.id, e2.id], 14, 7, 120, now=NOW)
    assert again["removed"] == out["created"]
    assert db.query(Schedule).filter(Schedule.schedule_type == "study").count() == again["created"]


def test_unknown_exam_404(db, user):
    with pytest.raises(HTTPException) as e:
        study_blocks.generate(db, user.id, [999], 14, 3, 120, now=NOW)
    assert e.value.status_code == 404


def test_study_blocks_prefer_evening_on_free_day():
    """수업 없는 날 하루 2시간 → 07:00이 아니라 19:00~21:00."""
    d = TODAY + timedelta(days=1)
    free = {d: [t("07:00") + 30 * k for k in range(32)]}  # 07:00~22:30 전부 빔
    blocks, _ = plan_study_blocks([ExamIn(1, "자료구조", TODAY + timedelta(days=2))], free, TODAY, 1, 7, 120)
    assert [(b["date"], b["start_time"], b["end_time"]) for b in blocks] == [(d.isoformat(), "19:00", "21:00")]


def test_study_blocks_after_evening_class_use_late_evening_then_afternoon():
    """저녁 수업(19:00~21:00)이 있으면 21:00 이후 → 모자라면 오후."""
    d = TODAY + timedelta(days=1)
    evening_free = [t("21:00"), t("21:30"), t("22:00"), t("22:30")]
    afternoon_free = [t("13:00") + 30 * k for k in range(12)]  # 13:00~18:30
    free = {d: afternoon_free + evening_free}
    blocks, _ = plan_study_blocks([ExamIn(1, "운영체제", TODAY + timedelta(days=2))], free, TODAY, 1, 7, 180)
    assert [(b["start_time"], b["end_time"]) for b in blocks] == [("13:00", "14:00"), ("21:00", "23:00")]
