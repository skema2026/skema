from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.schedule import service
from app.schedule.schemas import (
    ConflictCheckQuery,
    ExamPrepRequest,
    ExamScheduleCreate,
    ExamScheduleResponse,
    ExamScheduleUpdate,
    FreeSlot,
    FreeSlotQuery,
    GenerateResult,
    RescheduleRequest,
    RescheduleResult,
    ScheduleCreate,
    ScheduleResponse,
    ScheduleUpdate,
    StudyScheduleRequest,
)

router = APIRouter(tags=["schedules"])


# ── 수업 시간표 CRUD ──────────────────────────────────────────────────────────

@router.get("/schedules", response_model=List[ScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.list_schedules(db, current_user.id)


@router.post("/schedules", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
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


# ── 시험 일정 CRUD ────────────────────────────────────────────────────────────

@router.get("/exam-schedules", response_model=List[ExamScheduleResponse])
def list_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.list_exams(db, current_user.id)


@router.post("/exam-schedules", response_model=ExamScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    data: ExamScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.create_exam(db, current_user.id, data)


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


# ── 알고리즘 엔드포인트 ───────────────────────────────────────────────────────

@router.post("/schedules/free-slots", response_model=List[FreeSlot])
def free_slots(
    query: FreeSlotQuery,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    특정 날짜 또는 요일의 빈 시간대를 반환합니다.
    date와 day_of_week 중 하나 이상 필수.
    """
    if query.date is None and query.day_of_week is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date 또는 day_of_week 중 하나는 반드시 입력해야 합니다.",
        )
    slots = service.find_free_slots(
        db, current_user.id,
        date_obj=query.date,
        dow=query.day_of_week,
        duration_minutes=query.duration_minutes,
    )
    return [{"start_time": s, "end_time": e} for s, e in slots]


@router.post("/schedules/check-conflicts", response_model=List[ScheduleResponse])
def check_conflicts(
    query: ConflictCheckQuery,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    주어진 시간대에 충돌하는 기존 일정을 반환합니다.
    빈 리스트이면 충돌 없음.
    """
    if query.date is None and query.day_of_week is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date 또는 day_of_week 중 하나는 반드시 입력해야 합니다.",
        )
    conflicts = service.check_conflicts(
        db, current_user.id,
        query.start_time, query.end_time,
        date_obj=query.date,
        dow=query.day_of_week,
        exclude_id=query.exclude_id,
    )
    return conflicts


@router.post("/schedules/generate-study", response_model=GenerateResult, status_code=status.HTTP_201_CREATED)
def generate_study(
    data: StudyScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    오늘부터 target_days일 동안 과목 학습 일정을 빈 슬롯에 자동 생성합니다.
    기존 수업·일정과 겹치지 않게 배치합니다.
    """
    created = service.generate_study_schedule(
        db, current_user.id,
        data.subject,
        target_days=data.target_days,
        daily_hours=data.daily_study_hours,
    )
    return {"created": created, "details": []}


@router.post("/schedules/generate-exam-prep", response_model=GenerateResult, status_code=status.HTTP_201_CREATED)
def generate_exam_prep(
    data: ExamPrepRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    등록된 시험 일정을 기준으로 학습 일정을 역산 생성합니다.
    시험이 가까울수록 강도가 높아지며 색상으로 긴급도를 표시합니다.
    exam_id 미지정 시 모든 예정 시험을 대상으로 합니다.
    """
    result = service.generate_exam_prep_schedule(
        db, current_user.id,
        exam_id=data.exam_id,
        target_days=data.target_days,
        daily_hours=data.daily_study_hours,
    )
    return result


@router.post("/schedules/reschedule-incomplete", response_model=RescheduleResult)
def reschedule_incomplete(
    data: RescheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    과거 날짜에 미완료 상태로 남은 일정을 오늘 이후 빈 슬롯에 자동 재배치합니다.
    """
    moved = service.reschedule_incomplete(
        db, current_user.id,
        target_days=data.target_days,
    )
    return {"moved": len(moved), "details": moved}
