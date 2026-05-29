from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.security import get_current_user, get_db
from app.schedule import repository, service
from app.schedule.models import Schedule
from app.schedule.schemas import (
    EventCreate, EventResponse, EventUpdate,
    ExamScheduleCreate, ExamScheduleResponse, ExamScheduleUpdate,
    ScheduleCreate, ScheduleResponse, ScheduleUpdate,
)

router = APIRouter(tags=["schedules"])


# ── 수업 시간표 ───────────────────────────────────────────────────────────────

@router.get("/schedules", response_model=list[ScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return repository.get_schedules(db, current_user.id)


@router.post("/schedules", response_model=list[ScheduleResponse], status_code=status.HTTP_201_CREATED)
def create_schedule(
    data: ScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.create_schedule(db, current_user.id, data)


@router.get("/schedules/{schedule_id}", response_model=ScheduleResponse)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.get_schedule_or_404(db, schedule_id, current_user.id)


@router.put("/schedules/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: int,
    data: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.update_schedule(db, schedule_id, current_user.id, data)


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service.delete_schedule(db, schedule_id, current_user.id)


@router.post("/schedules/collect-incomplete", status_code=status.HTTP_200_OK)
def collect_incomplete_to_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """미완료된 과거 날짜 일정을 오늘 날짜로 이동하고, 오늘 일정 중 미완료된 것을 목록으로 반환."""
    today = str(date.today())

    past_incomplete = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == current_user.id,
            Schedule.is_completed == False,
            Schedule.date.isnot(None),
            Schedule.date < today,
        )
        .all()
    )

    moved = 0
    for s in past_incomplete:
        s.date = today
        moved += 1

    if moved:
        db.commit()

    today_incomplete = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == current_user.id,
            Schedule.is_completed == False,
            Schedule.date == today,
        )
        .all()
    )

    return {
        "moved": moved,
        "today_tasks": [{"id": s.id, "title": s.course_name} for s in today_incomplete],
    }


# ── 시험 일정 ─────────────────────────────────────────────────────────────────

@router.get("/exam-schedules", response_model=list[ExamScheduleResponse])
def list_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return repository.get_exams(db, current_user.id)


@router.post("/exam-schedules", response_model=ExamScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    data: ExamScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return repository.create_exam(db, current_user.id, data.model_dump())


@router.get("/exam-schedules/{exam_id}", response_model=ExamScheduleResponse)
def get_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.get_exam_or_404(db, exam_id, current_user.id)


@router.put("/exam-schedules/{exam_id}", response_model=ExamScheduleResponse)
def update_exam(
    exam_id: int,
    data: ExamScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.update_exam(db, exam_id, current_user.id, data)


@router.delete("/exam-schedules/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service.delete_exam(db, exam_id, current_user.id)


# ── 이벤트 ───────────────────────────────────────────────────────────────────

@router.get("/events", response_model=list[EventResponse])
def list_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return repository.get_events(db, current_user.id)


@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    data: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return repository.create_event(db, current_user.id, data.model_dump())


@router.get("/events/{event_id}", response_model=EventResponse)
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.get_event_or_404(db, event_id, current_user.id)


@router.put("/events/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    data: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.update_event(db, event_id, current_user.id, data)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service.delete_event(db, event_id, current_user.id)
