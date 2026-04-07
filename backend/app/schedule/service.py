from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schedule import repository
from app.schedule.models import ExamSchedule, Schedule
from app.schedule.schemas import (
    ExamScheduleCreate,
    ExamScheduleUpdate,
    ScheduleCreate,
    ScheduleUpdate,
)


# ── Schedule ──────────────────────────────────────────────────────────────────

def list_schedules(db: Session, user_id: int) -> list[Schedule]:
    return repository.get_schedules(db, user_id)


def get_schedule_or_404(db: Session, schedule_id: int, user_id: int) -> Schedule:
    schedule = repository.get_schedule(db, schedule_id, user_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시간표를 찾을 수 없습니다.")
    return schedule


def create_schedule(db: Session, user_id: int, data: ScheduleCreate) -> Schedule:
    return repository.create_schedule(db, user_id, data.model_dump())


def update_schedule(db: Session, schedule_id: int, user_id: int, data: ScheduleUpdate) -> Schedule:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    updates = data.model_dump(exclude_unset=True)

    new_start = updates.get("start_time", schedule.start_time)
    new_end = updates.get("end_time", schedule.end_time)
    if new_start and new_end and new_start >= new_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="시작 시간은 종료 시간보다 이전이어야 합니다.",
        )

    return repository.update_schedule(db, schedule, updates)


def delete_schedule(db: Session, schedule_id: int, user_id: int) -> None:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    repository.delete_schedule(db, schedule)


# ── ExamSchedule ──────────────────────────────────────────────────────────────

def list_exams(db: Session, user_id: int) -> list[ExamSchedule]:
    return repository.get_exams(db, user_id)


def get_exam_or_404(db: Session, exam_id: int, user_id: int) -> ExamSchedule:
    exam = repository.get_exam(db, exam_id, user_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험 일정을 찾을 수 없습니다.")
    return exam


def create_exam(db: Session, user_id: int, data: ExamScheduleCreate) -> ExamSchedule:
    return repository.create_exam(db, user_id, data.model_dump())


def update_exam(db: Session, exam_id: int, user_id: int, data: ExamScheduleUpdate) -> ExamSchedule:
    exam = get_exam_or_404(db, exam_id, user_id)
    updates = data.model_dump(exclude_unset=True)
    return repository.update_exam(db, exam, updates)


def delete_exam(db: Session, exam_id: int, user_id: int) -> None:
    exam = get_exam_or_404(db, exam_id, user_id)
    repository.delete_exam(db, exam)
