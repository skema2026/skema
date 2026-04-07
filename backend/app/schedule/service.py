from datetime import date, datetime, timedelta

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

DAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]


# ── 시간 유틸리티 ──────────────────────────────────────────────────────────────

def t2m(t: str) -> int:
    """HH:MM 문자열을 분(int)으로 변환."""
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def m2t(m: int) -> str:
    """분(int)을 HH:MM 문자열로 변환."""
    return f"{m // 60:02d}:{m % 60:02d}"


def overlap(s1: str, e1: str, s2: str, e2: str) -> bool:
    """두 시간 구간이 겹치는지 확인."""
    return t2m(s1) < t2m(e2) and t2m(s2) < t2m(e1)


def parse_date(date_str: str) -> date:
    """'YYYY-MM-DD' 문자열을 Python date 객체로 변환."""
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def day_schedules(db: Session, user_id: int, dow: int, date_obj: date | None) -> list[Schedule]:
    """
    특정 요일(반복 수업) + 특정 날짜(이벤트) 일정을 합쳐서 반환.
    중복 ID는 제거한다.
    """
    recurring = (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.day_of_week == dow, Schedule.date.is_(None))
        .all()
    )
    if date_obj:
        specific = (
            db.query(Schedule)
            .filter(Schedule.user_id == user_id, Schedule.date == date_obj)
            .all()
        )
        seen = {s.id for s in recurring}
        for s in specific:
            if s.id not in seen:
                recurring.append(s)
    return recurring


def _get_sleep_bounds(db: Session, user_id: int) -> tuple[int, int]:
    """유저 프로필에서 기상/취침 시간을 분(int)으로 반환. 기본값: 07:00 ~ 23:00."""
    from app.auth.models import UserProfile
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    wake = t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
    sleep = t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")
    return wake, sleep


# ── Schedule CRUD ──────────────────────────────────────────────────────────────

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
    if new_start >= new_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="시작 시간은 종료 시간보다 이전이어야 합니다.",
        )

    return repository.update_schedule(db, schedule, updates)


def delete_schedule(db: Session, schedule_id: int, user_id: int) -> None:
    schedule = get_schedule_or_404(db, schedule_id, user_id)
    repository.delete_schedule(db, schedule)


# ── ExamSchedule CRUD ─────────────────────────────────────────────────────────

def list_exams(db: Session, user_id: int) -> list[ExamSchedule]:
    return repository.get_exams(db, user_id)


def get_exam_or_404(db: Session, exam_id: int, user_id: int) -> ExamSchedule:
    exam = repository.get_exam(db, exam_id, user_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험 일정을 찾을 수 없습니다.")
    return exam


def create_exam(db: Session, user_id: int, data: ExamScheduleCreate) -> ExamSchedule:
    if data.schedule_id is not None:
        schedule = repository.get_schedule(db, data.schedule_id, user_id)
        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="존재하지 않거나 권한이 없는 수업입니다.",
            )
    return repository.create_exam(db, user_id, data.model_dump())


def update_exam(db: Session, exam_id: int, user_id: int, data: ExamScheduleUpdate) -> ExamSchedule:
    exam = get_exam_or_404(db, exam_id, user_id)
    updates = data.model_dump(exclude_unset=True)

    if "schedule_id" in updates and updates["schedule_id"] is not None:
        schedule = repository.get_schedule(db, updates["schedule_id"], user_id)
        if not schedule:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="존재하지 않거나 권한이 없는 수업입니다.",
            )

    new_start = updates.get("start_time", exam.start_time)
    new_end = updates.get("end_time", exam.end_time)
    if new_start and new_end and new_start >= new_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="시작 시간은 종료 시간보다 이전이어야 합니다.",
        )

    return repository.update_exam(db, exam, updates)


def delete_exam(db: Session, exam_id: int, user_id: int) -> None:
    exam = get_exam_or_404(db, exam_id, user_id)
    repository.delete_exam(db, exam)


# ── 알고리즘: 빈 시간 탐색 ────────────────────────────────────────────────────

def find_free_slots(
    db: Session,
    user_id: int,
    *,
    date_obj: date | None = None,
    dow: int | None = None,
    duration_minutes: int = 60,
) -> list[tuple[str, str]]:
    """
    특정 날짜 또는 요일에서 duration_minutes 이상 연속 빈 시간대를 반환.
    반환값: [(start_time, end_time), ...] (HH:MM 형식)
    """
    if date_obj is None and dow is None:
        raise ValueError("date_obj 또는 dow 중 하나는 반드시 지정해야 합니다.")
    if date_obj and dow is None:
        dow = date_obj.weekday()

    existing = day_schedules(db, user_id, dow, date_obj)
    busy = sorted((t2m(s.start_time), t2m(s.end_time)) for s in existing)

    free: list[tuple[str, str]] = []
    cursor = 8 * 60  # 08:00 시작

    for bs, be in busy:
        if cursor + duration_minutes <= bs:
            free.append((m2t(cursor), m2t(bs)))
        cursor = max(cursor, be)

    if cursor + duration_minutes <= 22 * 60:
        free.append((m2t(cursor), m2t(22 * 60)))

    return free


# ── 알고리즘: 충돌 검사 ───────────────────────────────────────────────────────

def check_conflicts(
    db: Session,
    user_id: int,
    start_time: str,
    end_time: str,
    *,
    date_obj: date | None = None,
    dow: int | None = None,
    exclude_id: int | None = None,
) -> list[Schedule]:
    """
    주어진 시간대에 기존 일정과 충돌이 있는지 확인.
    반환값: 충돌하는 Schedule 목록 (빈 리스트면 충돌 없음)
    """
    if date_obj is None and dow is None:
        raise ValueError("date_obj 또는 dow 중 하나는 반드시 지정해야 합니다.")
    if date_obj and dow is None:
        dow = date_obj.weekday()

    existing = day_schedules(db, user_id, dow, date_obj)
    return [
        s for s in existing
        if (exclude_id is None or s.id != exclude_id)
        and overlap(start_time, end_time, s.start_time, s.end_time)
    ]


# ── 알고리즘: 학습 일정 자동 생성 ────────────────────────────────────────────

def generate_study_schedule(
    db: Session,
    user_id: int,
    subject: str,
    *,
    target_days: int = 7,
    daily_hours: float = 2.0,
) -> int:
    """
    오늘부터 target_days일 동안 매일 daily_hours 분량의 학습 일정을 빈 슬롯에 추가.
    반환값: 생성된 일정 수
    """
    today = date.today()
    wake, sleep = _get_sleep_bounds(db, user_id)
    created = 0

    for offset in range(target_days):
        tdate = today + timedelta(days=offset)
        dow = tdate.weekday()
        existing = day_schedules(db, user_id, dow, tdate)
        busy = sorted((t2m(s.start_time), t2m(s.end_time)) for s in existing)

        remaining = int(daily_hours * 60)
        cursor = max(8 * 60, wake)
        blocks: list[tuple[int, int]] = []

        for bs, be in busy:
            if cursor + 30 <= bs and remaining > 0:
                block_len = min(bs - cursor, remaining, 120)
                blocks.append((cursor, cursor + block_len))
                remaining -= block_len
            cursor = max(cursor, be)

        if remaining >= 30 and cursor + 30 <= sleep:
            block_len = min(sleep - cursor, remaining, 120)
            blocks.append((cursor, cursor + block_len))

        for sm, em in blocks:
            db.add(Schedule(
                user_id=user_id,
                title=f"📚 {subject} 학습",
                day_of_week=dow,
                date=tdate,
                start_time=m2t(sm),
                end_time=m2t(em),
                color="#8B5CF6",
                priority=1,
                schedule_type="study",
            ))
            created += 1

    db.commit()
    return created


# ── 알고리즘: 시험 대비 일정 자동 생성 ───────────────────────────────────────

def generate_exam_prep_schedule(
    db: Session,
    user_id: int,
    *,
    exam_id: int | None = None,
    target_days: int = 14,
    daily_hours: float = 2.0,
) -> dict:
    """
    시험 일정을 역산해 빈 슬롯에 학습 일정 자동 생성.
    시험이 가까울수록 학습 강도와 우선순위가 높아짐.
    반환값: {"created": int, "details": [str, ...]}
    """
    today = date.today()
    wake, sleep = _get_sleep_bounds(db, user_id)

    exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
    if exam_id:
        exams = [e for e in exams if e.id == exam_id]

    upcoming = [e for e in exams if e.exam_date >= today]
    if not upcoming:
        return {"created": 0, "details": []}

    total_created = 0
    details: list[str] = []

    for exam in sorted(upcoming, key=lambda e: e.exam_date):
        exam_date = exam.exam_date
        days_until = (exam_date - today).days
        study_days = min(days_until, target_days)
        if study_days <= 0:
            continue

        exam_created = 0

        for offset in range(study_days):
            tdate = today + timedelta(days=offset)
            dow = tdate.weekday()
            days_left = (exam_date - tdate).days

            # 시험 임박도에 따라 강도·색상·우선순위 조정
            if days_left <= 3:
                day_hours, color, priority = daily_hours * 1.5, "#EF4444", 2
            elif days_left <= 7:
                day_hours, color, priority = daily_hours * 1.2, "#F59E0B", 1
            else:
                day_hours, color, priority = daily_hours, "#8B5CF6", 1

            existing = day_schedules(db, user_id, dow, tdate)
            busy = sorted((t2m(s.start_time), t2m(s.end_time)) for s in existing)
            remaining = int(day_hours * 60)
            cursor = max(8 * 60, wake)
            blocks: list[tuple[int, int]] = []

            for bs, be in busy:
                if cursor + 30 <= bs and remaining > 0:
                    block_len = min(bs - cursor, remaining, 120)
                    blocks.append((cursor, cursor + block_len))
                    remaining -= block_len
                cursor = max(cursor, be)

            if remaining >= 30 and cursor + 30 <= sleep:
                block_len = min(sleep - cursor, remaining, 120)
                blocks.append((cursor, cursor + block_len))

            label = "복습" if days_left <= 1 else "시험 준비"
            for sm, em in blocks:
                db.add(Schedule(
                    user_id=user_id,
                    title=f"📚 {exam.title} {label}",
                    day_of_week=dow,
                    date=tdate,
                    start_time=m2t(sm),
                    end_time=m2t(em),
                    color=color,
                    priority=priority,
                    schedule_type="study",
                ))
                exam_created += 1
                total_created += 1

        if exam_created > 0:
            details.append(f"{exam.title} (D-{days_until}): {exam_created}개 생성")

    db.commit()
    return {"created": total_created, "details": details}


# ── 알고리즘: 미완료 일정 재배치 ─────────────────────────────────────────────

def reschedule_incomplete(
    db: Session,
    user_id: int,
    *,
    target_days: int = 7,
) -> list[str]:
    """
    과거 날짜에 미완료 상태로 남은 일정을 오늘 이후 빈 슬롯에 자동 재배치.
    반환값: 재배치된 일정 설명 리스트
    """
    today = date.today()
    wake, sleep = _get_sleep_bounds(db, user_id)

    incomplete = db.query(Schedule).filter(
        Schedule.user_id == user_id,
        Schedule.is_completed == False,
        Schedule.date.isnot(None),
        Schedule.date < today,
    ).all()

    moved: list[str] = []

    for s in incomplete:
        duration = t2m(s.end_time) - t2m(s.start_time)

        for offset in range(target_days):
            tdate = today + timedelta(days=offset)
            dow = tdate.weekday()
            existing = day_schedules(db, user_id, dow, tdate)
            busy = sorted((t2m(x.start_time), t2m(x.end_time)) for x in existing if x.id != s.id)
            cursor = max(8 * 60, wake)
            placed = False

            for bs, be in busy:
                if cursor + duration <= bs:
                    s.date = tdate
                    s.day_of_week = dow
                    s.start_time = m2t(cursor)
                    s.end_time = m2t(cursor + duration)
                    db.commit()
                    moved.append(f"{s.title} → {tdate.isoformat()} {s.start_time}~{s.end_time}")
                    placed = True
                    break
                cursor = max(cursor, be)

            if not placed and cursor + duration <= sleep:
                s.date = tdate
                s.day_of_week = dow
                s.start_time = m2t(cursor)
                s.end_time = m2t(cursor + duration)
                db.commit()
                moved.append(f"{s.title} → {tdate.isoformat()} {s.start_time}~{s.end_time}")
                placed = True

            if placed:
                break

    return moved
