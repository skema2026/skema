from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.schedule.models import Event, ExamSchedule, Schedule


# ── Schedule ──────────────────────────────────────────────────────────────────

def get_schedules(db: Session, user_id: int) -> list[Schedule]:
    return (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.deleted_by_user.isnot(True))
        .all()
    )


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


# ── ExamSchedule ──────────────────────────────────────────────────────────────

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


def soft_delete_exam_study_schedules(db: Session, exam: ExamSchedule) -> int:
    """시험에 딸린 학습 일정을 소프트 삭제(deleted_by_user=True)로 숨긴다.

    두 종류를 모두 잡는다:
      1) linked_exam_id로 명시적으로 연결된 일정 (generate_exam_prep_schedule 경로)
      2) 연결 정보 없이 제목에 시험명/과목이 포함된 학습·과제 일정
         (generate_study_schedule 등 linked_exam_id를 남기지 않는 경로 대비)
    정규 수업은 건드리지 않도록 study/assignment 유형으로 제한한다.
    소프트 삭제이므로 완료된 학습 기록은 보존된다.
    """
    keywords = {k.strip() for k in (exam.title, exam.subject) if k and k.strip()}
    condition = Schedule.linked_exam_id == exam.id
    if keywords:
        title_match = or_(*[Schedule.title.ilike(f"%{kw}%") for kw in keywords])
        condition = or_(
            condition,
            and_(Schedule.schedule_type.in_(["study", "assignment"]), title_match),
        )

    linked = (
        db.query(Schedule)
        .filter(Schedule.user_id == exam.user_id, condition)
        .all()
    )
    cleaned = 0
    for s in linked:
        if not s.deleted_by_user:
            s.deleted_by_user = True
            cleaned += 1
    return cleaned


def delete_exam(db: Session, exam: ExamSchedule) -> int:
    cleaned = soft_delete_exam_study_schedules(db, exam)
    db.delete(exam)
    db.commit()
    return cleaned


# ── Event ─────────────────────────────────────────────────────────────────────

def get_events(db: Session, user_id: int) -> list[Event]:
    return db.query(Event).filter(Event.user_id == user_id).all()


def get_event(db: Session, event_id: int, user_id: int) -> Event | None:
    return (
        db.query(Event)
        .filter(Event.id == event_id, Event.user_id == user_id)
        .first()
    )


def create_event(db: Session, user_id: int, data: dict) -> Event:
    event = Event(user_id=user_id, **data)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def update_event(db: Session, event: Event, updates: dict) -> Event:
    for key, value in updates.items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, event: Event) -> None:
    db.delete(event)
    db.commit()
