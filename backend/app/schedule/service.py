from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schedule.models import DayOfWeek, Event, ExamSchedule, Schedule, ScheduleCreate, ScheduleUpdate, ExamScheduleUpdate, EventUpdate
from app.utils.time_utils import overlap


# ── DB CRUD (repository) ──────────────────────────────────────────────────────

def get_schedules(db: Session, user_id: int) -> list[Schedule]:
    return db.query(Schedule).filter(Schedule.user_id == user_id).all()


def get_schedule(db: Session, schedule_id: int, user_id: int) -> Schedule | None:
    return db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == user_id).first()


def create_schedule_row(db: Session, user_id: int, data: dict) -> Schedule:
    schedule = Schedule(user_id=user_id, **data)
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def update_schedule_row(db: Session, schedule: Schedule, updates: dict) -> Schedule:
    for key, value in updates.items():
        setattr(schedule, key, value)
    db.commit()
    db.refresh(schedule)
    return schedule


def delete_schedule_row(db: Session, schedule: Schedule) -> None:
    db.delete(schedule)
    db.commit()


def get_exams(db: Session, user_id: int) -> list[ExamSchedule]:
    return db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()


def get_exam(db: Session, exam_id: int, user_id: int) -> ExamSchedule | None:
    return db.query(ExamSchedule).filter(ExamSchedule.id == exam_id, ExamSchedule.user_id == user_id).first()


def create_exam_row(db: Session, user_id: int, data: dict) -> ExamSchedule:
    exam = ExamSchedule(user_id=user_id, **data)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


def update_exam_row(db: Session, exam: ExamSchedule, updates: dict) -> ExamSchedule:
    for key, value in updates.items():
        setattr(exam, key, value)
    db.commit()
    db.refresh(exam)
    return exam


def delete_exam_row(db: Session, exam: ExamSchedule) -> None:
    db.delete(exam)
    db.commit()


def get_events(db: Session, user_id: int) -> list[Event]:
    return db.query(Event).filter(Event.user_id == user_id).all()


def get_event(db: Session, event_id: int, user_id: int) -> Event | None:
    return db.query(Event).filter(Event.id == event_id, Event.user_id == user_id).first()


def create_event_row(db: Session, user_id: int, data: dict) -> Event:
    event = Event(user_id=user_id, **data)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def update_event_row(db: Session, event: Event, updates: dict) -> Event:
    for key, value in updates.items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event


def delete_event_row(db: Session, event: Event) -> None:
    db.delete(event)
    db.commit()


# ── 비즈니스 로직 ─────────────────────────────────────────────────────────────

_DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def _day_to_enum(value: DayOfWeek | str | int) -> DayOfWeek:
    if isinstance(value, DayOfWeek):
        return value
    if isinstance(value, int):
        if not 0 <= value <= 6:
            raise ValueError("day_of_week must be an integer between 0 and 6.")
        return DayOfWeek(_DAY_CODES[value])
    return DayOfWeek(str(value).upper())


def normalize_schedule_record(data: dict[str, Any]) -> dict[str, Any]:
    """AI/ETA/legacy 입력을 schedules 테이블의 canonical 필드로 정규화한다."""
    normalized = dict(data)

    if "course_name" not in normalized and "title" in normalized:
        normalized["course_name"] = normalized.pop("title")
    else:
        normalized.pop("title", None)

    if "color_code" not in normalized and "color" in normalized:
        normalized["color_code"] = normalized.pop("color")
    else:
        normalized.pop("color", None)

    if "recurring_day" not in normalized:
        if "day_of_week" in normalized:
            normalized["recurring_day"] = _day_to_enum(int(normalized.pop("day_of_week")))
        elif normalized.get("date"):
            dow = datetime.strptime(str(normalized["date"]), "%Y-%m-%d").weekday()
            normalized["recurring_day"] = _day_to_enum(dow)
    else:
        normalized["recurring_day"] = _day_to_enum(normalized["recurring_day"])
        normalized.pop("day_of_week", None)

    return normalized


def stage_schedule_record(db: Session, user_id: int, data: dict[str, Any]) -> Schedule:
    schedule = Schedule(user_id=user_id, **normalize_schedule_record(data))
    db.add(schedule)
    return schedule


def create_schedule_record(db: Session, user_id: int, data: dict[str, Any]) -> Schedule:
    schedule = stage_schedule_record(db, user_id, data)
    db.commit()
    db.refresh(schedule)
    return schedule


def stage_exam_record(db: Session, user_id: int, data: dict[str, Any]) -> ExamSchedule:
    exam = ExamSchedule(user_id=user_id, **data)
    db.add(exam)
    return exam


def create_exam_record(db: Session, user_id: int, data: dict[str, Any]) -> ExamSchedule:
    exam = stage_exam_record(db, user_id, data)
    db.commit()
    db.refresh(exam)
    return exam


def get_schedule_or_404(db: Session, schedule_id: int, user_id: int) -> Schedule:
    schedule = get_schedule(db, schedule_id, user_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="수업을 찾을 수 없습니다.")
    return schedule


def get_exam_or_404(db: Session, exam_id: int, user_id: int) -> ExamSchedule:
    exam = get_exam(db, exam_id, user_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험 일정을 찾을 수 없습니다.")
    return exam


def get_event_or_404(db: Session, event_id: int, user_id: int) -> Event:
    event = get_event(db, event_id, user_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="이벤트를 찾을 수 없습니다.")
    return event


def _check_no_conflict(
    db: Session,
    user_id: int,
    start_time: str,
    end_time: str,
    recurring_day: str,
    exclude_id: int | None = None,
) -> None:
    """같은 요일에 시간이 겹치는 수업이 있으면 409."""
    existing = get_schedules(db, user_id)
    for s in existing:
        if exclude_id is not None and s.id == exclude_id:
            continue
        if s.recurring_day.value == recurring_day and overlap(start_time, end_time, s.start_time, s.end_time):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{s.course_name}' 수업과 시간이 겹칩니다. ({s.recurring_day.value} {s.start_time}~{s.end_time})",
            )


def create_schedule(db: Session, user_id: int, data: ScheduleCreate) -> list[Schedule]:
    """days에 포함된 각 요일마다 수업 1개씩 생성."""
    created = []
    base = data.model_dump(exclude={"days", "day_of_week", "title", "color"})

    for day in data.days:
        _check_no_conflict(db, user_id, data.start_time, data.end_time, day)
        row_data = {**base, "recurring_day": DayOfWeek(day)}
        created.append(create_schedule_row(db, user_id, row_data))

    return created


def update_schedule(db: Session, schedule_id: int, user_id: int, data: ScheduleUpdate) -> Schedule:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    updates = data.model_dump(exclude_unset=True, exclude={"title", "day_of_week", "color"})

    if "recurring_day" in updates and updates["recurring_day"] is not None:
        updates["recurring_day"] = DayOfWeek(updates["recurring_day"])

    new_start = updates.get("start_time", schedule.start_time)
    new_end = updates.get("end_time", schedule.end_time)
    new_day = updates.get("recurring_day", schedule.recurring_day)
    new_day_str = new_day.value if isinstance(new_day, DayOfWeek) else new_day

    if any(k in updates for k in ("start_time", "end_time", "recurring_day")):
        _check_no_conflict(db, user_id, new_start, new_end, new_day_str, exclude_id=schedule.id)

    return update_schedule_row(db, schedule, updates)


def delete_schedule(db: Session, schedule_id: int, user_id: int) -> None:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    delete_schedule_row(db, schedule)


def update_exam(db: Session, exam_id: int, user_id: int, data: ExamScheduleUpdate) -> ExamSchedule:
    exam = get_exam_or_404(db, exam_id, user_id)
    updates = data.model_dump(exclude_unset=True)
    return update_exam_row(db, exam, updates)


def delete_exam(db: Session, exam_id: int, user_id: int) -> None:
    exam = get_exam_or_404(db, exam_id, user_id)
    delete_exam_row(db, exam)


def update_event(db: Session, event_id: int, user_id: int, data: EventUpdate) -> Event:
    event = get_event_or_404(db, event_id, user_id)
    updates = data.model_dump(exclude_unset=True)
    return update_event_row(db, event, updates)


def delete_event(db: Session, event_id: int, user_id: int) -> None:
    event = get_event_or_404(db, event_id, user_id)
    delete_event_row(db, event)
