from typing import List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.schedule import service
from app.schedule.schemas import (
    ConflictItem,
    ExamScheduleCreate,
    ExamScheduleResponse,
    ExamScheduleUpdate,
    ScheduleCreate,
    ScheduleResponse,
    ScheduleUpdate,
)

router = APIRouter(tags=["schedules"])


# ── 수업 시간표 ───────────────────────────────────────────────────────────────

@router.get("/schedules/today", response_model=List[ScheduleResponse])
def today_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """오늘 날짜에 해당하는 모든 일정(특정 날짜 + 반복)을 시작 시간 순으로 반환합니다."""
    return service.get_today_schedules(db, current_user.id)


@router.get("/schedules/conflicts", response_model=List[ConflictItem])
def schedule_conflicts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """시간이 겹치는 일정 쌍을 모두 반환합니다. 충돌이 없으면 빈 배열."""
    return service.detect_conflicts(db, current_user.id)


@router.get("/schedules", response_model=List[ScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 일정 전체 목록을 반환합니다."""
    return service.list_schedules(db, current_user.id)


@router.post("/schedules", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    data: ScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """새 일정을 추가합니다."""
    return service.create_schedule(db, current_user.id, data)


@router.get("/schedules/{schedule_id}", response_model=ScheduleResponse)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 일정 상세 정보를 반환합니다."""
    return service.get_schedule_or_404(db, schedule_id, current_user.id)


@router.put("/schedules/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: int,
    data: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """일정을 수정합니다."""
    return service.update_schedule(db, schedule_id, current_user.id, data)


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """일정을 삭제합니다."""
    service.delete_schedule(db, schedule_id, current_user.id)


@router.post("/schedules/{schedule_id}/complete", response_model=ScheduleResponse)
def complete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """일정을 완료 처리합니다. 이후 AI 재계획에서 재생성되지 않습니다."""
    return service.complete_schedule(db, schedule_id, current_user.id)


@router.post("/schedules/{schedule_id}/postpone", response_model=ScheduleResponse)
def postpone_schedule(
    schedule_id: int,
    days: int = Query(default=1, ge=1, le=30, description="연기할 일수"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 날짜 일정을 days일 뒤로 연기합니다."""
    return service.postpone_schedule(db, schedule_id, current_user.id, days)


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
    """시험 일정을 추가합니다."""
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
