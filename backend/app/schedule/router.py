from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.security import get_current_user, get_db
from app.schedule import repository, reschedule, service, study_blocks
from app.schedule.models import Schedule
from app.studylog.streak import record_check_in
from app.schedule.schemas import (
    EventCreate, EventResponse, EventUpdate,
    ExamScheduleCreate, ExamScheduleResponse, ExamScheduleUpdate,
    RescheduleApplyRequest,
    ScheduleCreate, ScheduleResponse, ScheduleUpdate,
    StudyBlocksGenerateRequest,
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
    result = service.update_schedule(db, schedule_id, current_user.id, data)
    # 완료 처리 시 스트릭 체크인 기록
    if data.is_completed:
        record_check_in(db, current_user.id)
        db.commit()
    return result


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service.delete_schedule(db, schedule_id, current_user.id)


@router.post("/schedules/collect-incomplete", status_code=status.HTTP_200_OK, deprecated=True)
def collect_incomplete_to_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """미완료된 과거 날짜 일정을 오늘 날짜로 이동하고, 오늘 일정 중 미완료된 것을 목록으로 반환.

    deprecated: POST /reschedule/preview → /reschedule/apply 로 대체 (#11).
    프론트가 새 API로 바뀌면 지운다.
    """
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


# ── 다시 짜기 (#11) ───────────────────────────────────────────────────────────

@router.post("/reschedule/preview", status_code=status.HTTP_200_OK)
def reschedule_preview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """못 한 공부·과제 블록을 어디로 옮길지 계산만 한다(DB 안 바뀜)."""
    return reschedule.preview(db, current_user.id)


@router.post("/reschedule/apply", status_code=status.HTTP_200_OK)
def reschedule_apply(
    data: RescheduleApplyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """미리보기의 moves를 그대로 받아 적용. 전부 되거나 전부 안 된다."""
    return reschedule.apply(db, current_user.id, data.moves)


# ── 시험 공부 블록 배치 (#12) ──────────────────────────────────────────────────

@router.post("/study-blocks/generate", status_code=status.HTTP_201_CREATED)
def generate_study_blocks(
    data: StudyBlocksGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """시험 전날까지 빈 시간에 30분 단위 공부 블록을 넣는다."""
    return study_blocks.generate(
        db, current_user.id,
        exam_ids=data.exam_ids,
        start_days_before=data.start_days_before,
        days_per_week=data.days_per_week,
        minutes_per_day=data.minutes_per_day,
        replace=data.replace,
    )


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
