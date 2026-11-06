"""시간표 가져오기에서 고른 일정 종류(수업/개인)가 그대로 저장되는지 (11/4)."""
import pytest
from pydantic import ValidationError

from app.eta.block_ocr import suggest_schedule_type
from app.eta.router import save_eta_schedules
from app.eta.schemas import ParsedEntry, SaveSchedulesRequest
from app.schedule.models import Schedule


def _entry(name, day=0, start="15:00", end="18:00", loc="", kind="class"):
    return ParsedEntry(subject_name=name, day_of_week=day, start_time=start, end_time=end,
                       location=loc, schedule_type=kind)


def test_suggest_personal_only_without_room_and_with_personal_word():
    assert suggest_schedule_type("알바", "") == "personal"
    assert suggest_schedule_type("학생회 회의", None) == "personal"
    assert suggest_schedule_type("스터디", "") == "personal"
    # 강의실 없는 온라인 수업은 수업으로
    assert suggest_schedule_type("성공취업과직무분석", "") == "class"
    # 강의실이 있으면 수업
    assert suggest_schedule_type("캡스톤 회의", "소프트516") == "class"


def test_save_keeps_chosen_type(db, user):
    body = SaveSchedulesRequest(entries=[
        _entry("자료구조", loc="소프트332"),
        _entry("알바", day=2, start="20:00", end="23:00", kind="personal"),
    ])
    res = save_eta_schedules(body, db=db, current_user=user)
    assert res["saved"] == 2
    rows = {r.course_name: r for r in db.query(Schedule).filter(Schedule.user_id == user.id)}
    assert rows["자료구조"].schedule_type == "class"
    assert rows["알바"].schedule_type == "personal"
    assert rows["알바"].schedule_source == "eta_import"  # 다시 가져오면 같이 교체된다
    assert rows["알바"].end_time == "23:00"


def test_default_type_is_class_for_old_clients(db, user):
    body = SaveSchedulesRequest.model_validate(
        {"entries": [{"subject_name": "운영체제", "day_of_week": 1, "start_time": "09:00", "end_time": "10:30"}]}
    )
    save_eta_schedules(body, db=db, current_user=user)
    assert db.query(Schedule).one().schedule_type == "class"


def test_unknown_type_rejected():
    with pytest.raises(ValidationError):
        ParsedEntry(subject_name="x", day_of_week=0, start_time="09:00", end_time="10:00", schedule_type="exam")
