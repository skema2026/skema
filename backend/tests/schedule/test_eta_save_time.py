"""시간표 저장 때 시간 검증 (11/7).

예전에는 문자열로 비교해서 확인 화면에서 '9:00'처럼 고친 항목이 조용히 버려졌다.
"""
import pytest
from pydantic import ValidationError

from app.eta.router import save_eta_schedules
from app.eta.schemas import SaveSchedulesRequest, normalize_hhmm
from app.schedule.models import Schedule


def _body(*entries):
    return SaveSchedulesRequest.model_validate({"entries": [
        {"subject_name": name, "day_of_week": 0, "start_time": st, "end_time": et}
        for name, st, et in entries
    ]})


@pytest.mark.parametrize("raw, expected", [
    ("9:00", "09:00"),
    ("09:00", "09:00"),
    (" 9:30 ", "09:30"),
    ("24:00", "23:59"),
])
def test_normalize_hhmm(raw, expected):
    assert normalize_hhmm(raw) == expected


@pytest.mark.parametrize("raw", ["25:00", "9:60", "9시", "0900", "24:30"])
def test_normalize_hhmm_rejects(raw):
    with pytest.raises(ValueError):
        normalize_hhmm(raw)


def test_single_digit_hour_is_saved(db, user):
    res = save_eta_schedules(_body(("운영체제", "9:00", "10:30")), db=db, current_user=user)
    assert res == {"saved": 1, "skipped": 0, "reset": False}
    row = db.query(Schedule).one()
    assert (row.start_time, row.end_time) == ("09:00", "10:30")


def test_out_of_range_and_empty_are_skipped(db, user):
    res = save_eta_schedules(
        _body(
            ("새벽 일정", "04:00", "05:00"),  # 5시 이전 시작
            ("거꾸로", "11:00", "10:00"),
            ("빈 시간", "", "10:00"),
            ("자료구조", "15:00", "16:30"),
        ),
        db=db, current_user=user,
    )
    assert res["saved"] == 1
    assert res["skipped"] == 3
    assert db.query(Schedule).one().course_name == "자료구조"


def test_midnight_end_is_saved_as_2359(db, user):
    save_eta_schedules(_body(("알바", "21:00", "24:00")), db=db, current_user=user)
    assert db.query(Schedule).one().end_time == "23:59"


def test_bad_time_format_is_422():
    with pytest.raises(ValidationError):
        _body(("자료구조", "25:00", "26:00"))
