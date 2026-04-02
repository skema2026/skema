from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.schedule import service
from app.schedule.schemas import (
    ExamScheduleCreate,
    ExamScheduleResponse,
    ExamScheduleUpdate,
    ScheduleCreate,
    ScheduleResponse,
    ScheduleUpdate,
)

router = APIRouter(tags=["schedules"])


# ── 수업 시간표 ───────────────────────────────────────────────────────────────

@router.get("/schedules", response_model=List[ScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 수업 시간표 전체 목록을 반환합니다."""
    return service.list_schedules(db, current_user.id)


@router.post("/schedules", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    data: ScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """새 수업 시간표를 추가합니다."""
    return service.create_schedule(db, current_user.id, data)


@router.get("/schedules/{schedule_id}", response_model=ScheduleResponse)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 수업 시간표 상세 정보를 반환합니다."""
    return service.get_schedule_or_404(db, schedule_id, current_user.id)


@router.put("/schedules/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: int,
    data: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """수업 시간표를 수정합니다."""
    return service.update_schedule(db, schedule_id, current_user.id, data)


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """수업 시간표를 삭제합니다. 연결된 시험 일정도 함께 삭제됩니다."""
    service.delete_schedule(db, schedule_id, current_user.id)


# ── 시험 일정 ─────────────────────────────────────────────────────────────────

@router.get("/exam-schedules", response_model=List[ExamScheduleResponse])
def list_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 시험 일정 전체 목록을 반환합니다."""
    return service.list_exams(db, current_user.id)


@router.post("/exam-schedules", response_model=ExamScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    data: ExamScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """시험 일정을 추가합니다. schedule_id를 설정하면 특정 수업에 연결됩니다."""
    return service.create_exam(db, current_user.id, data)


@router.get("/exam-schedules/{exam_id}", response_model=ExamScheduleResponse)
def get_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 시험 일정 상세 정보를 반환합니다."""
    return service.get_exam_or_404(db, exam_id, current_user.id)


@router.put("/exam-schedules/{exam_id}", response_model=ExamScheduleResponse)
def update_exam(
    exam_id: int,
    data: ExamScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """시험 일정을 수정합니다."""
    return service.update_exam(db, exam_id, current_user.id, data)


@router.delete("/exam-schedules/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """시험 일정을 삭제합니다."""
    service.delete_exam(db, exam_id, current_user.id)
