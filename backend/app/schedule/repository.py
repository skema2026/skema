from sqlalchemy.orm import Session

from app.schedule.models import ExamSchedule, Schedule


# ── Schedule CRUD ─────────────────────────────────────────────────────────────

def get_schedules(db: Session, user_id: int) -> list[Schedule]:
    return db.query(Schedule).filter(Schedule.user_id == user_id).all()


def get_schedule(db: Session, schedule_id: int, user_id: int) -> Schedule | None:
    return (
        db.query(Schedule)
        .filter(Schedule.id == schedule_id, Schedule.user_id == user_id)
        .first()
    )


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
