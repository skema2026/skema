"""일정 추가·수정에서 시험을 연결할 때는 내 시험만 (11/14).

일정 추가 화면에서 시험을 골라 준비도에 넣을 수 있게 되면서 함께 막는다.
"""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.schedule import service
from app.schedule.schemas import ScheduleCreate, ScheduleUpdate
from tests.schedule.conftest import add_exam


def _create(exam_id):
    return ScheduleCreate(
        title="자료구조 복습", schedule_type="study", date=(date.today() + timedelta(days=1)).isoformat(),
        start_time="19:00", end_time="20:00", linked_exam_id=exam_id,
    )


def test_link_own_exam_on_create(db, user):
    exam = add_exam(db, user.id, date.today() + timedelta(days=5))
    [row] = service.create_schedule(db, user.id, _create(exam.id))
    assert row.linked_exam_id == exam.id


def test_cannot_link_other_users_exam_on_create(db, user, other):
    exam = add_exam(db, other.id, date.today() + timedelta(days=5))
    with pytest.raises(HTTPException) as e:
        service.create_schedule(db, user.id, _create(exam.id))
    assert e.value.status_code == 404


def test_cannot_link_other_users_exam_on_update(db, user, other):
    [row] = service.create_schedule(db, user.id, _create(None))
    exam = add_exam(db, other.id, date.today() + timedelta(days=5))
    with pytest.raises(HTTPException) as e:
        service.update_schedule(db, row.id, user.id, ScheduleUpdate(linked_exam_id=exam.id))
    assert e.value.status_code == 404


def test_link_and_unlink_on_update(db, user):
    exam = add_exam(db, user.id, date.today() + timedelta(days=5))
    [row] = service.create_schedule(db, user.id, _create(None))
    assert service.update_schedule(db, row.id, user.id, ScheduleUpdate(linked_exam_id=exam.id)).linked_exam_id == exam.id
    assert service.update_schedule(db, row.id, user.id, ScheduleUpdate(linked_exam_id=None)).linked_exam_id is None
