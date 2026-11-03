"""다시 짜기 (#11) 테스트.

실행: cd backend && python -m pytest tests/schedule -q
"""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.time_utils import time_to_minutes as t
from app.schedule import reschedule
from app.schedule.models import Schedule
from app.schedule.reschedule import Target, plan_moves

from .conftest import NOW, TODAY, add_block, add_class, add_exam

YESTERDAY = TODAY - timedelta(days=1)


def _target(sid, deadline, minutes=60, has_exam=True):
    return Target(
        schedule_id=sid, title=f"블록{sid}", schedule_type="study", linked_exam_id=1 if has_exam else None,
        deadline=deadline, minutes=minutes, from_date=YESTERDAY.isoformat(),
        from_start="19:00", from_end="20:00", has_exam=has_exam,
    )


def _moves_as_request(moves):
    return [
        SimpleNamespace(schedule_id=m["schedule_id"], to=[SimpleNamespace(**seg) for seg in m["to"]])
        for m in moves
    ]


def _class_intervals(db, user_id, d: date):
    rows = db.query(Schedule).filter(Schedule.user_id == user_id, Schedule.schedule_type == "class").all()
    return [
        (t(s.start_time), t(s.end_time)) for s in rows
        if (s.date == d.isoformat()) or (s.date is None and s.day_of_week == d.weekday())
    ]


# ── 순수 계산 ─────────────────────────────────────────────────────────────────

def test_nearest_deadline_goes_first():
    d1, d2 = TODAY, TODAY + timedelta(days=1)
    free = {d1: [t("20:00"), t("20:30")], d2: [t("09:00"), t("09:30")]}
    later, sooner = _target(1, d2), _target(2, d1)
    moves, unplaced = plan_moves([later, sooner], free, TODAY)
    by_id = {m["schedule_id"]: m for m in moves}
    assert by_id[2]["to"] == [{"date": d1.isoformat(), "start_time": "20:00", "end_time": "21:00"}]
    assert by_id[1]["to"] == [{"date": d2.isoformat(), "start_time": "09:00", "end_time": "10:00"}]
    assert unplaced == []


def test_never_past_deadline_and_warns():
    free = {TODAY: [t("20:00")], TODAY + timedelta(days=1): [t("09:00"), t("09:30")]}
    moves, unplaced = plan_moves([_target(1, TODAY)], free, TODAY)  # 오늘까지인데 30분밖에 없음
    assert moves == []
    assert unplaced[0]["reason"] == "NO_SLOT"


def test_deadline_already_passed():
    moves, unplaced = plan_moves([_target(1, YESTERDAY)], {TODAY: [t("20:00"), t("20:30")]}, TODAY)
    assert moves == [] and unplaced[0]["reason"] == "DEADLINE_PASSED"


def test_split_and_no_split():
    free = {TODAY: [t("10:00"), t("12:00")]}
    moves, _ = plan_moves([_target(1, TODAY)], free, TODAY, split=True)
    assert [s["start_time"] for s in moves[0]["to"]] == ["10:00", "12:00"]
    moves, unplaced = plan_moves([_target(1, TODAY)], free, TODAY, split=False)
    assert moves == [] and unplaced[0]["reason"] == "NO_SLOT"


def test_exam_blocks_before_unlinked_blocks():
    free = {TODAY: [t("20:00"), t("20:30")]}
    moves, unplaced = plan_moves(
        [_target(1, TODAY, has_exam=False), _target(2, TODAY + timedelta(days=3))], free, TODAY
    )
    assert [m["schedule_id"] for m in moves] == [2]
    assert [u["schedule_id"] for u in unplaced] == [1]


def test_same_input_same_output():
    free = {TODAY + timedelta(days=i): [t("09:00") + 30 * k for k in range(10)] for i in range(4)}
    targets = [_target(i, TODAY + timedelta(days=i % 4), minutes=30 * (i % 3 + 1)) for i in range(1, 9)]
    assert plan_moves(targets, free, TODAY) == plan_moves(list(reversed(targets)), free, TODAY)


# ── DB: 완료 기준 ─────────────────────────────────────────────────────────────

def test_two_missed_blocks_preview_then_apply(db, user):
    """블록 2개를 안 하고 다시 짜기 → 미리보기 → 적용하면
    시험 전날까지 빈 시간에 30분 단위로 다시 배치되고 수업과 겹치지 않는다."""
    exam_day = TODAY + timedelta(days=3)  # 목요일
    exam = add_exam(db, user.id, exam_day)
    # 월·화·수 낮 시간을 수업으로 꽉 채워서 저녁에만 자리가 남게
    for day in ("MON", "TUE", "WED"):
        add_class(db, user.id, day, "09:00", "18:00")
    a = add_block(db, user.id, YESTERDAY, "19:00", "20:00", exam_id=exam.id)
    b = add_block(db, user.id, YESTERDAY, "20:00", "21:30", exam_id=exam.id, schedule_type="assignment")
    done = add_block(db, user.id, YESTERDAY, "21:30", "22:00", exam_id=exam.id, completed=True)
    future = add_block(db, user.id, TODAY, "18:00", "19:00", exam_id=exam.id)  # 아직 시작 전 → 대상 아님

    result = reschedule.preview(db, user.id, now=NOW)
    assert result["summary"] == {"target": 2, "placed": 2, "unplaced": 0}
    assert result["warning"] is None
    assert {m["schedule_id"] for m in result["moves"]} == {a.id, b.id}

    # 미리보기는 DB를 바꾸지 않음
    db.expire_all()
    assert db.get(Schedule, a.id).date == YESTERDAY.isoformat()

    out = reschedule.apply(db, user.id, _moves_as_request(result["moves"]), now=NOW)
    assert out["applied"] == 2

    db.expire_all()
    moved = db.query(Schedule).filter(Schedule.linked_exam_id == exam.id, Schedule.id.notin_([done.id, future.id])).all()
    total = 0
    for s in moved:
        d = date.fromisoformat(s.date)
        st, en = t(s.start_time), t(s.end_time)
        total += en - st
        assert TODAY <= d < exam_day, "시험 전날을 넘으면 안 됨"
        assert st % 30 == 0 and en % 30 == 0, "30분 단위"
        assert t("07:00") <= st and en <= t("23:00"), "수면 시간 피함"
        assert all(not (cs < en and st < ce) for cs, ce in _class_intervals(db, user.id, d)), "수업과 겹치면 안 됨"
        assert not (s.date == TODAY.isoformat() and cs_overlap(st, en, t("18:00"), t("19:00"))), "다른 공부 블록과 겹치면 안 됨"
        assert s.linked_exam_id == exam.id
        assert s.recurring_day.value == ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][d.weekday()]
    assert total == 60 + 90


def cs_overlap(s1, e1, s2, e2):
    return s1 < e2 and s2 < e1


def test_split_creates_new_row_with_same_exam(db, user):
    exam = add_exam(db, user.id, TODAY + timedelta(days=2))  # 수요일 시험 → 화요일까지
    add_class(db, user.id, "MON", "11:00", "23:00")  # 월: 10:30~11:00만 빔
    add_class(db, user.id, "TUE", "07:30", "23:00")  # 화: 07:00~07:30만 빔
    blk = add_block(db, user.id, YESTERDAY, "19:00", "20:00", exam_id=exam.id)

    result = reschedule.preview(db, user.id, now=NOW)
    assert result["moves"][0]["to"] == [
        {"date": TODAY.isoformat(), "start_time": "10:30", "end_time": "11:00"},
        {"date": (TODAY + timedelta(days=1)).isoformat(), "start_time": "07:00", "end_time": "07:30"},
    ]
    out = reschedule.apply(db, user.id, _moves_as_request(result["moves"]), now=NOW)
    assert out["updated_ids"] == [blk.id] and len(out["created_ids"]) == 1

    db.expire_all()
    new = db.get(Schedule, out["created_ids"][0])
    assert new.linked_exam_id == exam.id and new.course_name == blk.course_name
    assert new.schedule_type == "study" and new.is_completed is False


def test_apply_conflict_when_slot_taken(db, user):
    exam = add_exam(db, user.id, TODAY + timedelta(days=2))
    blk = add_block(db, user.id, YESTERDAY, "19:00", "20:00", exam_id=exam.id)
    result = reschedule.preview(db, user.id, now=NOW)
    seg = result["moves"][0]["to"][0]

    # 미리보기 뒤에 그 자리에 다른 일정이 생김
    add_block(db, user.id, date.fromisoformat(seg["date"]), seg["start_time"], seg["end_time"],
              title="개인 일정", schedule_type="personal")

    with pytest.raises(HTTPException) as e:
        reschedule.apply(db, user.id, _moves_as_request(result["moves"]), now=NOW)
    assert e.value.status_code == 409 and e.value.detail["code"] == "SLOT_TAKEN"
    db.expire_all()
    assert db.get(Schedule, blk.id).date == YESTERDAY.isoformat()  # 아무것도 안 바뀜


def test_apply_conflict_when_block_completed(db, user):
    exam = add_exam(db, user.id, TODAY + timedelta(days=2))
    blk = add_block(db, user.id, YESTERDAY, "19:00", "20:00", exam_id=exam.id)
    result = reschedule.preview(db, user.id, now=NOW)
    blk.is_completed = True
    db.commit()
    with pytest.raises(HTTPException) as e:
        reschedule.apply(db, user.id, _moves_as_request(result["moves"]), now=NOW)
    assert e.value.detail["code"] == "ALREADY_CHANGED"


def test_no_targets(db, user):
    result = reschedule.preview(db, user.id, now=NOW)
    assert result["moves"] == [] and result["summary"]["target"] == 0 and result["warning"] is None


# ── 저녁 우선 (11/2 결정) ─────────────────────────────────────────────────────

def test_free_day_prefers_evening_over_morning():
    """수업 없는 날: 아침 7시가 아니라 저녁 19시부터 넣는다."""
    free = {TODAY: [t("07:00") + 30 * k for k in range(32)]}  # 07:00~22:30 전부 빔
    moves, _ = plan_moves([_target(1, TODAY + timedelta(days=2))], free, TODAY)
    assert moves[0]["to"] == [{"date": TODAY.isoformat(), "start_time": "19:00", "end_time": "20:00"}]


def test_sooner_day_still_comes_before_later_evening():
    """가까운 날이 먼저: 오늘 오후 자리가 있으면 내일 저녁보다 오늘 오후."""
    d2 = TODAY + timedelta(days=1)
    free = {TODAY: [t("15:00"), t("15:30")], d2: [t("19:00"), t("19:30")]}
    moves, _ = plan_moves([_target(1, d2)], free, TODAY)
    assert moves[0]["to"] == [{"date": TODAY.isoformat(), "start_time": "15:00", "end_time": "16:00"}]


def test_evening_full_spills_to_afternoon_same_day():
    free = {TODAY: [t("10:00"), t("16:00"), t("16:30"), t("22:30")]}
    moves, _ = plan_moves([_target(1, TODAY, minutes=90)], free, TODAY)
    # 저녁 22:30 한 칸 + 오후 16:00, 16:30 → 시간순으로 묶어서 돌려줌
    assert moves[0]["to"] == [
        {"date": TODAY.isoformat(), "start_time": "16:00", "end_time": "17:00"},
        {"date": TODAY.isoformat(), "start_time": "22:30", "end_time": "23:00"},
    ]
