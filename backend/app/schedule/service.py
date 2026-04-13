from datetime import date, datetime, timedelta
from typing import List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.timezone import today_kst
from app.schedule import repository
from app.schedule.repository import _NOT_DELETED
from app.schedule.models import ExamSchedule, Schedule
from app.schedule.schemas import (
    ConflictItem,
    ExamScheduleCreate,
    ExamScheduleUpdate,
    ScheduleCreate,
    ScheduleResponse,
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


def complete_schedule(db: Session, schedule_id: int, user_id: int) -> Schedule:
    """일정을 완료 처리한다. 이후 AI 재계획에서 재생성되지 않는다."""
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    schedule.is_completed = True
    db.commit()
    db.refresh(schedule)
    return schedule


def postpone_schedule(db: Session, schedule_id: int, user_id: int, days: int = 1) -> Schedule:
    """
    특정 날짜 일정을 days일 뒤로 연기한다.
    반복 일정(date=None)은 연기할 수 없다.
    user_override=True 로 마킹해 AI 재계획 시 덮어쓰지 않도록 한다.
    """
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    if not schedule.date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="반복 일정은 연기할 수 없습니다. 특정 날짜 일정만 연기 가능합니다.",
        )
    old_date = datetime.strptime(schedule.date, "%Y-%m-%d").date()
    new_date = old_date + timedelta(days=days)
    schedule.date = new_date.strftime("%Y-%m-%d")
    schedule.day_of_week = new_date.weekday()
    schedule.user_override = True
    db.commit()
    db.refresh(schedule)
    return schedule


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


# ── 오늘 할 일 ────────────────────────────────────────────────────────────────

def get_today_schedules(db: Session, user_id: int) -> list[Schedule]:
    """
    오늘 날짜에 해당하는 모든 일정을 반환한다.
    - 특정 날짜 일정: date == today
    - 반복 일정: date IS NULL AND day_of_week == today.weekday()
    시작 시간 오름차순 정렬.
    """
    today = today_kst()          # UTC가 아닌 KST 기준 오늘 날짜
    today_str = today.isoformat()
    dow = today.weekday()

    specific = (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.date == today_str, _NOT_DELETED)
        .all()
    )
    recurring = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user_id,
            Schedule.day_of_week == dow,
            Schedule.date.is_(None),
            _NOT_DELETED,
        )
        .all()
    )
    seen_ids = {s.id for s in specific}
    merged = list(specific) + [s for s in recurring if s.id not in seen_ids]
    return sorted(merged, key=lambda s: s.start_time)


# ── 충돌 감지 ─────────────────────────────────────────────────────────────────

def _t2m(t: str) -> int:
    """HH:MM → 분 단위 정수."""
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _overlap(s1: str, e1: str, s2: str, e2: str) -> bool:
    return _t2m(s1) < _t2m(e2) and _t2m(s2) < _t2m(e1)


def detect_conflicts(db: Session, user_id: int) -> list[ConflictItem]:
    """
    유저의 모든 일정에서 시간이 겹치는 쌍을 찾아 반환한다.
    같은 요일의 반복 일정끼리 / 특정 날짜 일정끼리 비교.
    """
    schedules = repository.get_schedules(db, user_id)
    conflicts: list[ConflictItem] = []
    seen: set[tuple[int, int]] = set()

    for i, a in enumerate(schedules):
        for b in schedules[i + 1:]:
            pair = (min(a.id, b.id), max(a.id, b.id))
            if pair in seen:
                continue

            same_day = False
            day_label = ""

            # 둘 다 특정 날짜
            if a.date and b.date:
                if a.date == b.date:
                    same_day = True
                    day_label = a.date
            # 둘 다 반복
            elif a.date is None and b.date is None:
                if a.day_of_week == b.day_of_week:
                    same_day = True
                    day_names = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
                    day_label = f"매주 {day_names[a.day_of_week]}"
            # 한쪽은 특정 날짜, 한쪽은 반복
            elif a.date and b.date is None:
                date_dow = datetime.strptime(a.date, "%Y-%m-%d").weekday()
                if date_dow == b.day_of_week:
                    same_day = True
                    day_label = a.date
            elif b.date and a.date is None:
                date_dow = datetime.strptime(b.date, "%Y-%m-%d").weekday()
                if date_dow == a.day_of_week:
                    same_day = True
                    day_label = b.date

            if same_day and _overlap(a.start_time, a.end_time, b.start_time, b.end_time):
                seen.add(pair)
                conflicts.append(ConflictItem(
                    schedule_a=ScheduleResponse.model_validate(a),
                    schedule_b=ScheduleResponse.model_validate(b),
                    day_label=day_label,
                ))

    return conflicts
