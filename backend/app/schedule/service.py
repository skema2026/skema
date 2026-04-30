from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schedule import repository
from app.schedule.models import DayOfWeek, Event, ExamSchedule, Schedule
from app.schedule.schemas import (
    EventCreate,
    EventUpdate,
    ExamScheduleCreate,
    ExamScheduleUpdate,
    ScheduleCreate,
    ScheduleUpdate,
)


# ── Schedule (수업 시간표) ────────────────────────────────────────────────────

def list_schedules(db: Session, user_id: int) -> list[Schedule]:
    return repository.get_schedules(db, user_id)


def get_schedule_or_404(db: Session, schedule_id: int, user_id: int) -> Schedule:
    schedule = repository.get_schedule(db, schedule_id, user_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="수업을 찾을 수 없습니다.")
    return schedule


def _overlap(s1: str, e1: str, s2: str, e2: str) -> bool:
    """두 시간 범위가 겹치는지 확인."""
    def t2m(t: str) -> int:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    return t2m(s1) < t2m(e2) and t2m(s2) < t2m(e1)


def _check_no_conflict(
    db: Session,
    user_id: int,
    start_time: str,
    end_time: str,
    recurring_day: str,
    exclude_id: int | None = None,
) -> None:
    """같은 요일에 시간이 겹치는 수업이 있으면 409."""
    existing = repository.get_schedules(db, user_id)
    for s in existing:
        if exclude_id is not None and s.id == exclude_id:
            continue
        if s.recurring_day.value == recurring_day and _overlap(start_time, end_time, s.start_time, s.end_time):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{s.course_name}' 수업과 시간이 겹칩니다. ({s.recurring_day.value} {s.start_time}~{s.end_time})",
            )


def create_schedule(db: Session, user_id: int, data: ScheduleCreate) -> list[Schedule]:
    """
    수업을 생성한다. days에 포함된 각 요일마다 하나씩 생성.
    """
    created = []
    base = data.model_dump(exclude={"days", "day_of_week", "title", "color"})

    for day in data.days:
        _check_no_conflict(db, user_id, data.start_time, data.end_time, day)
        row_data = {**base, "recurring_day": DayOfWeek(day)}
        created.append(repository.create_schedule(db, user_id, row_data))

    return created


def update_schedule(db: Session, schedule_id: int, user_id: int, data: ScheduleUpdate) -> Schedule:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    updates = data.model_dump(exclude_unset=True, exclude={"title", "day_of_week", "color"})

    # recurring_day 문자열 → enum 변환
    if "recurring_day" in updates and updates["recurring_day"] is not None:
        updates["recurring_day"] = DayOfWeek(updates["recurring_day"])

    # 시간/요일 변경 시 충돌 검사
    new_start = updates.get("start_time", schedule.start_time)
    new_end = updates.get("end_time", schedule.end_time)
    new_day = updates.get("recurring_day", schedule.recurring_day)
    if isinstance(new_day, DayOfWeek):
        new_day_str = new_day.value
    else:
        new_day_str = new_day

    if any(k in updates for k in ("start_time", "end_time", "recurring_day")):
        _check_no_conflict(db, user_id, new_start, new_end, new_day_str, exclude_id=schedule.id)

    return repository.update_schedule(db, schedule, updates)


def delete_schedule(db: Session, schedule_id: int, user_id: int) -> None:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    repository.delete_schedule(db, schedule)


# ── ExamSchedule ─────────────────────────────────────────────────────────────

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


# ── Event ────────────────────────────────────────────────────────────────────

def list_events(db: Session, user_id: int) -> list[Event]:
    return repository.get_events(db, user_id)


def get_event_or_404(db: Session, event_id: int, user_id: int) -> Event:
    event = repository.get_event(db, event_id, user_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="이벤트를 찾을 수 없습니다.")
    return event


def create_event(db: Session, user_id: int, data: EventCreate) -> Event:
    return repository.create_event(db, user_id, data.model_dump())


def update_event(db: Session, event_id: int, user_id: int, data: EventUpdate) -> Event:
    event = get_event_or_404(db, event_id, user_id)
    updates = data.model_dump(exclude_unset=True)
    return repository.update_event(db, event, updates)


def delete_event(db: Session, event_id: int, user_id: int) -> None:
    event = get_event_or_404(db, event_id, user_id)
    repository.delete_event(db, event)
