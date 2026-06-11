from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schedule import repository
from app.schedule.models import DayOfWeek, ExamSchedule, Event, Schedule
from app.schedule.schemas import ExamScheduleUpdate, EventUpdate, ScheduleCreate, ScheduleUpdate
from app.core.time_utils import overlap


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

    if not normalized.get("view_scope"):
        normalized["view_scope"] = "day_month" if normalized.get("date") else "day_week"

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
    schedule = repository.get_schedule(db, schedule_id, user_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="수업을 찾을 수 없습니다.")
    return schedule


def get_exam_or_404(db: Session, exam_id: int, user_id: int) -> ExamSchedule:
    exam = repository.get_exam(db, exam_id, user_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험 일정을 찾을 수 없습니다.")
    return exam


def get_event_or_404(db: Session, event_id: int, user_id: int) -> Event:
    event = repository.get_event(db, event_id, user_id)
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
    date: str | None = None,
) -> None:
    """시간이 겹치는 '수업'이 있으면 409.

    충돌 검사는 수업(class) 간 중복 예약을 막기 위한 것이다. 회의·동아리 등
    개인 활동(activity)·자율학습(study)·과제/시험(assignment)·개인(personal)
    일정은 수업과 겹쳐도 등록을 허용한다(호출부에서 수업일 때만 검사).

    같은 요일에서만 충돌 후보로 보고, 양쪽이 모두 '특정 날짜'면 날짜가 정확히
    같을 때만 충돌(다른 날짜의 같은 요일은 충돌 아님)로 판정한다.
    """
    existing = repository.get_schedules(db, user_id)
    for s in existing:
        if exclude_id is not None and s.id == exclude_id:
            continue
        # 수업끼리만 충돌 검사 (legacy로 type이 비어있으면 수업으로 간주)
        if (s.schedule_type or "class") != "class":
            continue
        s_day = s.recurring_day.value if s.recurring_day else None
        if s_day != recurring_day:
            continue
        # 둘 다 특정 날짜면 날짜가 다를 경우 충돌 아님
        if date and s.date and date != s.date:
            continue
        if overlap(start_time, end_time, s.start_time, s.end_time):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{s.course_name}' 일정과 시간이 겹칩니다. ({s.recurring_day.value} {s.start_time}~{s.end_time})",
            )


def create_schedule(db: Session, user_id: int, data: ScheduleCreate) -> list[Schedule]:
    """days에 포함된 각 요일마다 수업 1개씩 생성."""
    created = []
    base = data.model_dump(exclude={"days", "day_of_week", "title", "color"})

    is_class = (data.schedule_type or "class") == "class"
    for day in data.days:
        if is_class:
            _check_no_conflict(db, user_id, data.start_time, data.end_time, day, date=data.date)
        row_data = {**base, "recurring_day": DayOfWeek(day)}
        created.append(repository.create_schedule(db, user_id, row_data))

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

    # 시간/요일이 실제로 변경됐을 때만 충돌 검사
    time_changed = (
        new_start != schedule.start_time
        or new_end != schedule.end_time
        or new_day_str != (schedule.recurring_day.value if schedule.recurring_day else None)
    )
    new_type = updates.get("schedule_type", schedule.schedule_type) or "class"
    if time_changed and new_day_str and new_type == "class":
        new_date = updates.get("date", schedule.date)
        _check_no_conflict(db, user_id, new_start, new_end, new_day_str, exclude_id=schedule.id, date=new_date)

    return repository.update_schedule(db, schedule, updates)


def delete_schedule(db: Session, schedule_id: int, user_id: int) -> None:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    repository.delete_schedule(db, schedule)


def update_exam(db: Session, exam_id: int, user_id: int, data: ExamScheduleUpdate) -> ExamSchedule:
    exam = get_exam_or_404(db, exam_id, user_id)
    return repository.update_exam(db, exam, data.model_dump(exclude_unset=True))


def delete_exam(db: Session, exam_id: int, user_id: int) -> None:
    repository.delete_exam(db, get_exam_or_404(db, exam_id, user_id))


def update_event(db: Session, event_id: int, user_id: int, data: EventUpdate) -> Event:
    event = get_event_or_404(db, event_id, user_id)
    return repository.update_event(db, event, data.model_dump(exclude_unset=True))


def delete_event(db: Session, event_id: int, user_id: int) -> None:
    repository.delete_event(db, get_event_or_404(db, event_id, user_id))
