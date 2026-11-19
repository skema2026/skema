"""직접 넣은 일정과 겹친 자동 공부 블록 옮기기 (11/19, POST /reschedule/relocate).

NOW = 2026-11-02(월) 10:05 KST, 수면 23:00~07:00
"""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.auth.models import User
from app.core.time_utils import time_to_minutes as t
from app.schedule import reschedule
from app.schedule.models import DayOfWeek, INT_TO_DAY, Schedule

from .conftest import NOW, TODAY, add_block, add_class, add_exam

TOMORROW = TODAY + timedelta(days=1)


def add_personal(db, user_id, d: date, start: str, end: str, title="동아리 회의"):
    s = Schedule(
        user_id=user_id, course_name=title,
        recurring_day=DayOfWeek(INT_TO_DAY[d.weekday()]), date=d.isoformat(),
        start_time=start, end_time=end, schedule_type="personal", schedule_source="user_created",
    )
    db.add(s)
    db.commit()
    return s


def overlaps(s1, e1, s2, e2):
    return s1 < e2 and s2 < e1


def _blocks_of_exam(db, exam_id):
    db.expire_all()
    return db.query(Schedule).filter(Schedule.linked_exam_id == exam_id).all()


def test_block_moves_away_from_new_schedule(db, user):
    exam_day = TODAY + timedelta(days=3)
    exam = add_exam(db, user.id, exam_day)
    block = add_block(db, user.id, TOMORROW, "20:00", "22:00", exam_id=exam.id)
    meeting = add_personal(db, user.id, TOMORROW, "19:30", "21:00")  # 사용자가 새로 넣은 일정

    out = reschedule.relocate(db, user.id, [block.id], now=NOW)

    assert out["summary"] == {"target": 1, "moved": 1, "unplaced": 0}
    assert out["warning"] is None
    assert out["moved"][0]["from"] == {"date": TOMORROW.isoformat(), "start_time": "20:00", "end_time": "22:00"}

    total = 0
    for s in _blocks_of_exam(db, exam.id):
        d = date.fromisoformat(s.date)
        st, en = t(s.start_time), t(s.end_time)
        total += en - st
        assert TODAY <= d < exam_day, "시험 전날까지"
        assert st % 30 == 0 and en % 30 == 0, "30분 단위"
        assert t("07:00") <= st and en <= t("23:00"), "수면 시간 피함"
        assert not (s.date == TOMORROW.isoformat() and overlaps(st, en, t("19:30"), t("21:00"))), "새 일정과 안 겹침"
        assert s.schedule_source == "ai_generated" and s.is_completed is False
    assert total == 120, "공부 시간은 그대로"

    db.expire_all()
    assert db.get(Schedule, meeting.id).start_time == "19:30", "사용자 일정은 그대로"


def test_same_input_same_result(db, user):
    exam = add_exam(db, user.id, TODAY + timedelta(days=3))
    block = add_block(db, user.id, TOMORROW, "20:00", "21:00", exam_id=exam.id)
    add_personal(db, user.id, TOMORROW, "20:00", "21:00")
    first = reschedule.relocate(db, user.id, [block.id], now=NOW)["moved"][0]["to"]
    # 같은 상태로 되돌려 다시 돌리면 같은 자리
    db.expire_all()
    b = db.get(Schedule, block.id)
    b.date, b.start_time, b.end_time = TOMORROW.isoformat(), "20:00", "21:00"
    db.commit()
    again = reschedule.relocate(db, user.id, [block.id], now=NOW)["moved"][0]["to"]
    assert first == again


def test_no_free_slot_leaves_block_and_warns(db, user):
    # 시험이 내일 → 오늘(월)까지만 넣을 수 있는데 오늘 남은 시간이 수업으로 꽉 참
    exam = add_exam(db, user.id, TOMORROW)
    add_class(db, user.id, "MON", "10:00", "20:00")
    block = add_block(db, user.id, TODAY, "20:00", "21:00", exam_id=exam.id)
    add_personal(db, user.id, TODAY, "20:00", "23:00")

    out = reschedule.relocate(db, user.id, [block.id], now=NOW)

    assert out["summary"] == {"target": 1, "moved": 0, "unplaced": 1}
    assert out["unplaced"][0]["reason"] == "NO_SLOT"
    assert out["warning"] == reschedule.WARNING_NO_SLOT
    db.expire_all()
    b = db.get(Schedule, block.id)
    assert (b.date, b.start_time, b.end_time) == (TODAY.isoformat(), "20:00", "21:00"), "자리가 없으면 그대로 둠"


@pytest.mark.parametrize("kind", ["user_created", "completed", "past", "class"])
def test_only_upcoming_auto_blocks(db, user, kind):
    if kind == "user_created":
        s = add_block(db, user.id, TOMORROW, "20:00", "21:00")
        s.schedule_source = "user_created"
        db.commit()
    elif kind == "completed":
        s = add_block(db, user.id, TOMORROW, "20:00", "21:00", completed=True)
    elif kind == "past":
        s = add_block(db, user.id, TODAY, "09:00", "10:00")  # 10:05 기준 이미 시작
    else:
        s = add_class(db, user.id, "TUE", "20:00", "21:00")
    with pytest.raises(HTTPException) as e:
        reschedule.relocate(db, user.id, [s.id], now=NOW)
    assert e.value.status_code == 409
    assert e.value.detail["code"] == "NOT_AUTO_BLOCK"


def test_other_users_block_is_404(db, user):
    other = User(email="other@skema.dev", username="other")
    db.add(other)
    db.commit()
    s = add_block(db, other.id, TOMORROW, "20:00", "21:00")
    with pytest.raises(HTTPException) as e:
        reschedule.relocate(db, user.id, [s.id], now=NOW)
    assert e.value.status_code == 404


def test_apply_still_works_after_refactor(db, user):
    """apply의 쓰기 부분을 _write_moves로 뺀 뒤에도 조각 나누기가 그대로인지"""
    exam = add_exam(db, user.id, TODAY + timedelta(days=2))
    missed = add_block(db, user.id, TODAY - timedelta(days=1), "19:00", "20:00", exam_id=exam.id)
    preview = reschedule.preview(db, user.id, now=NOW)
    assert preview["summary"]["placed"] == 1
    from types import SimpleNamespace as NS
    moves = [NS(schedule_id=m["schedule_id"], to=[NS(**seg) for seg in m["to"]]) for m in preview["moves"]]
    out = reschedule.apply(db, user.id, moves, now=NOW)
    assert out["applied"] == 1 and out["updated_ids"] == [missed.id]
