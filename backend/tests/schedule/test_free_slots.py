"""빈 시간 공용 함수 테스트.

실행: cd backend && python -m pytest tests/schedule -q
"""
from datetime import timedelta

from app.core.time_utils import time_to_minutes as t
from app.schedule.free_slots import awake_windows, free_slot_starts, load_free_slots, merge_slots

from .conftest import NOW, TODAY, add_class, add_exam


def test_slots_are_30_minute_aligned_and_skip_busy():
    starts = free_slot_starts([(t("09:00"), t("10:15"))], wake=t("08:00"), sleep=t("12:00"))
    # 08:00, 08:30 / 09:00~10:15 바쁨 → 10:30부터 (10:00 칸은 10:15까지 겹침)
    assert starts == [t("08:00"), t("08:30"), t("10:30"), t("11:00"), t("11:30")]
    assert all(s % 30 == 0 for s in starts)


def test_sleep_time_excluded():
    starts = free_slot_starts([], wake=t("07:00"), sleep=t("23:00"))
    assert min(starts) == t("07:00")
    assert max(starts) == t("22:30")  # 22:30~23:00 이 마지막


def test_sleep_after_midnight():
    # 01:00에 자고 08:00에 일어남
    assert awake_windows(t("08:00"), t("01:00")) == [(0, t("01:00")), (t("08:00"), 1440)]
    starts = free_slot_starts([], wake=t("08:00"), sleep=t("01:00"))
    assert t("00:30") in starts and t("01:00") not in starts and t("07:30") not in starts


def test_earliest_rounds_up_to_next_slot():
    starts = free_slot_starts([], wake=t("07:00"), sleep=t("23:00"), earliest=t("10:05"))
    assert starts[0] == t("10:30")


def test_merge_slots():
    assert merge_slots([600, 630, 720]) == [(600, 660), (720, 750)]


def test_load_free_slots_uses_classes_exams_and_now(db, user):
    add_class(db, user.id, "MON", "13:00", "15:00")
    add_exam(db, user.id, TODAY + timedelta(days=1), start="09:00", end="11:00")
    free = load_free_slots(db, user.id, TODAY, TODAY + timedelta(days=1), now=NOW)

    mon = free[TODAY]
    assert mon[0] == t("10:30")  # 지금(10:05) 이후
    assert t("13:00") not in mon and t("14:30") not in mon and t("15:00") in mon

    tue = free[TODAY + timedelta(days=1)]
    assert t("09:00") not in tue and t("10:30") not in tue and t("11:00") in tue
    assert t("07:00") in tue  # 다음 날은 기상 시각부터


def test_by_preference_evening_then_afternoon_then_morning_then_late_night():
    from app.schedule.free_slots import by_preference

    starts = [t("00:30"), t("07:00"), t("09:30"), t("14:00"), t("18:30"), t("19:00"), t("22:30")]
    assert by_preference(starts) == [
        t("19:00"), t("22:30"),  # 저녁 (이른 칸부터)
        t("14:00"), t("18:30"),  # 오후
        t("07:00"), t("09:30"),  # 오전
        t("00:30"),              # 자정 넘은 새벽은 맨 뒤
    ]
