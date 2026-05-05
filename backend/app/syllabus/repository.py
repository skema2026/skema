from sqlalchemy.orm import Session

from app.syllabus.models import Syllabus, SyllabusAnalysis


def get_syllabus(db: Session, syllabus_id: int, user_id: int) -> Syllabus | None:
    return db.query(Syllabus).filter(Syllabus.id == syllabus_id, Syllabus.user_id == user_id).first()


def list_syllabi(db: Session, user_id: int) -> list[Syllabus]:
    return db.query(Syllabus).filter(Syllabus.user_id == user_id).order_by(Syllabus.uploaded_at.desc()).all()


def list_analyses(db: Session, user_id: int) -> list[SyllabusAnalysis]:
    return (
        db.query(SyllabusAnalysis)
        .filter(SyllabusAnalysis.user_id == user_id)
        .order_by(SyllabusAnalysis.analyzed_at.desc())
        .all()
    )


def create_syllabus(db: Session, **kwargs) -> Syllabus:
    syllabus = Syllabus(**kwargs)
    db.add(syllabus)
    db.commit()
    db.refresh(syllabus)
    return syllabus


def delete_syllabus(db: Session, syllabus: Syllabus) -> None:
    db.delete(syllabus)
    db.commit()


def get_or_create_analysis(
    db: Session, syllabus_id: int, user_id: int, subject_name: str
) -> SyllabusAnalysis:
    record = db.query(SyllabusAnalysis).filter(SyllabusAnalysis.syllabus_id == syllabus_id).first()
    if not record:
        record = SyllabusAnalysis(
            syllabus_id=syllabus_id,
            user_id=user_id,
            subject_name=subject_name,
            analysis_status="pending",
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    return record
