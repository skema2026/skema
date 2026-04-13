from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.schedule.models import ExamSchedule, Schedule


# ── Schedule CRUD ─────────────────────────────────────────────────────────────

# soft-delete 공통 조건식 (함수가 아닌 표현식으로 정의)
# → get_schedules / get_schedule / 오늘 할 일 / 충돌 감지 전부 동일 정책 적용
_NOT_DELETED = or_(
    Schedule.deleted_by_user.is_(None),
    Schedule.deleted_by_user == False,
)


def get_schedules(db: Session, user_id: int, include_deleted: bool = False) -> list[Schedule]:
    q = db.query(Schedule).filter(Schedule.user_id == user_id)
    if not include_deleted:
        q = q.filter(_NOT_DELETED)
    return q.all()


def get_schedule(
    db: Session,
    schedule_id: int,
    user_id: int,
    include_deleted: bool = False,
) -> Schedule | None:
    """단건 조회. 기본적으로 soft-deleted 항목은 반환하지 않는다."""
    q = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.user_id == user_id,
    )
    if not include_deleted:
        q = q.filter(_NOT_DELETED)
    return q.first()


def create_schedule(db: Session, user_id: int, data: dict) -> Schedule:
    schedule = Schedule(user_id=user_id, **data)
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def update_schedule(db: Session, schedule: Schedule, updates: dict) -> Schedule:
    for key, value in updates.items():
        setattr(schedule, key, value)
    db.commit()
    db.refresh(schedule)
    return schedule


def delete_schedule(db: Session, schedule: Schedule) -> None:
    db.delete(schedule)
    db.commit()


# ── ExamSchedule CRUD ─────────────────────────────────────────────────────────

def get_exams(db: Session, user_id: int) -> list[ExamSchedule]:
    return db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()


def get_exam(db: Session, exam_id: int, user_id: int) -> ExamSchedule | None:
    return (
        db.query(ExamSchedule)
        .filter(ExamSchedule.id == exam_id, ExamSchedule.user_id == user_id)
        .first()
    )


def create_exam(db: Session, user_id: int, data: dict) -> ExamSchedule:
    exam = ExamSchedule(user_id=user_id, **data)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


def update_exam(db: Session, exam: ExamSchedule, updates: dict) -> ExamSchedule:
    for key, value in updates.items():
        setattr(exam, key, value)
    db.commit()
    db.refresh(exam)
    return exam


def delete_exam(db: Session, exam: ExamSchedule) -> None:
    db.delete(exam)
    db.commit()
