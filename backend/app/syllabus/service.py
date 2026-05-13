import json
import logging
import os
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schedule.models import ExamSchedule
from app.schedule.service import stage_exam_record
from app.syllabus.analyzer import analyze_syllabus
from app.syllabus.models import SyllabusAnalysis
from app.syllabus import repository

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "syllabi")
ALLOWED_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp",
}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB

_DONE_STATUSES = {"success", "partial"}
_FAILED_STATUSES = {"failed", "rate_limited", "provider_unavailable", "empty_response"}


def save_uploaded_file(content: bytes, user_id: int, original_filename: str) -> tuple[str, str]:
    """파일을 디스크에 저장하고 (file_path, stored_name)을 반환."""
    ext = os.path.splitext(original_filename)[1].lower() or ".bin"
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"허용되지 않는 파일 확장자입니다: {ext}",
        )
    user_dir = os.path.join(UPLOAD_DIR, str(user_id))
    os.makedirs(user_dir, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(user_dir, stored_name)
    with open(file_path, "wb") as f:
        f.write(content)
    return file_path, stored_name


def get_syllabus_or_404(db: Session, syllabus_id: int, user_id: int):
    s = repository.get_syllabus(db, syllabus_id, user_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="강의계획서를 찾을 수 없습니다.")
    return s


def reset_analysis_status(db: Session, syllabus_id: int, user_id: int) -> None:
    """재분석 전 분석 상태를 pending으로 초기화."""
    s = get_syllabus_or_404(db, syllabus_id, user_id)
    if s.analysis:
        s.analysis.analysis_status = "pending"
        db.commit()


def delete_syllabus_with_file(db: Session, syllabus_id: int, user_id: int) -> None:
    """강의계획서 DB 레코드와 첨부 파일을 함께 삭제."""
    s = get_syllabus_or_404(db, syllabus_id, user_id)
    if os.path.exists(s.file_path):
        os.remove(s.file_path)
    repository.delete_syllabus(db, s)


def _auto_create_exams(db: Session, user_id: int, record, payload) -> None:
    """분석 완료 후 exam_schedule / midterm_week / final_week → ExamSchedule 자동 생성."""
    from app.auth.models import UserProfile

    try:
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        sem_start: Optional[date] = None
        if profile and profile.semester_start_date:
            try:
                sem_start = date.fromisoformat(profile.semester_start_date)
            except ValueError:
                pass

        exam_dates_raw: list = []
        if record.exam_dates:
            try:
                raw = record.exam_dates if isinstance(record.exam_dates, list) else json.loads(record.exam_dates)
                exam_dates_raw = raw if isinstance(raw, list) else []
            except Exception:
                pass

        has_midterm = any(str(e.get("type", "")).lower() == "midterm" for e in exam_dates_raw)
        has_final = any(str(e.get("type", "")).lower() == "final" for e in exam_dates_raw)
        if not has_midterm and payload.midterm_week:
            exam_dates_raw.append({"type": "midterm", "date": ""})
        if not has_final and payload.final_week:
            exam_dates_raw.append({"type": "final", "date": ""})

        for exam in exam_dates_raw:
            exam_type = str(exam.get("type", "")).lower()
            exam_date_str = str(exam.get("date", "")).strip()

            exam_date_obj: Optional[date] = None
            if exam_date_str:
                try:
                    exam_date_obj = date.fromisoformat(exam_date_str)
                except ValueError:
                    pass

            if not exam_date_obj and sem_start:
                week_num: Optional[int] = None
                if exam_type == "midterm":
                    week_num = payload.midterm_week
                elif exam_type == "final":
                    week_num = payload.final_week
                if week_num and 1 <= week_num <= 20:
                    exam_date_obj = sem_start + timedelta(weeks=week_num - 1)

            if not exam_date_obj:
                continue

            type_label = {"midterm": "중간고사", "final": "기말고사"}.get(exam_type, "시험")
            title = f"{record.subject_name} {type_label}"

            exists = db.query(ExamSchedule).filter(
                ExamSchedule.user_id == user_id,
                ExamSchedule.title == title,
                ExamSchedule.exam_date == exam_date_obj,
            ).first()
            if exists:
                continue

            stage_exam_record(db, user_id, {
                "title": title,
                "subject": record.subject_name,
                "exam_date": exam_date_obj,
            })

        db.commit()
    except Exception as e:
        logger.warning(f"_auto_create_exams failed for syllabus {record.syllabus_id}: {e}")


def run_analysis(
    syllabus_id: int,
    file_path: str,
    content_type: str,
    subject_name: str,
    user_id: int,
    force: bool = False,
) -> None:
    """백그라운드에서 AI 분석 실행 → SyllabusAnalysis 저장."""
    from app.db.database import SessionLocal

    db = SessionLocal()
    record = None
    try:
        record = repository.get_or_create_analysis(db, syllabus_id, user_id, subject_name)

        if not force and record.analysis_status in _DONE_STATUSES:
            logger.info(f"Syllabus {syllabus_id}: 이미 분석 완료 (status={record.analysis_status}) — 생략")
            return

        result = analyze_syllabus(file_path, content_type, subject_name)
        if result is None:
            logger.error(f"Syllabus {syllabus_id}: analyze_syllabus returned None")
            record.analysis_status = "failed"
            record.analysis_reason = "analyzer returned None"
            db.commit()
            return

        payload, status_str, raw_text, reason = result
        record.analysis_status = status_str
        record.analysis_reason = reason or None
        record.raw_text = raw_text[:8000] if raw_text else None

        if status_str in _FAILED_STATUSES:
            db.commit()
            logger.warning(f"Syllabus {syllabus_id}: 분석 실패 status={status_str} reason={reason}")
            return

        record.midterm_weight = payload.midterm_weight
        record.final_weight = payload.final_weight
        record.assignment_weight = payload.assignment_weight
        record.attendance_weight = payload.attendance_weight
        record.presentation_weight = payload.presentation_weight
        record.has_presentation = payload.has_presentation
        record.midterm_week = payload.midterm_week
        record.final_week = payload.final_week
        record.weekly_topics = json.dumps(payload.weekly_plan, ensure_ascii=False)
        record.exam_dates = json.dumps(payload.exam_schedule, ensure_ascii=False)
        record.assignment_dates = json.dumps(payload.assignments, ensure_ascii=False)
        record.important_factors = json.dumps(payload.important_notes, ensure_ascii=False)

        all_weeks = [item.get("week") for item in payload.weekly_plan if isinstance(item, dict)]
        study_mapping: dict = {}
        if payload.midterm_week and all_weeks:
            study_mapping["midterm_scope_weeks"] = [w for w in all_weeks if w < payload.midterm_week]
        if payload.final_week and payload.midterm_week and all_weeks:
            study_mapping["final_scope_weeks"] = [w for w in all_weeks if payload.midterm_week < w < payload.final_week]
        elif payload.final_week and all_weeks:
            study_mapping["final_scope_weeks"] = [w for w in all_weeks if w < payload.final_week]
        if study_mapping:
            record.study_mapping = json.dumps(study_mapping, ensure_ascii=False)
        db.commit()

        _auto_create_exams(db, user_id, record, payload)

    except Exception as e:
        logger.error(f"Background analysis error: {e}", exc_info=True)
        try:
            if record is not None and record.id:
                record.analysis_status = "failed"
                record.analysis_reason = str(e)[:200]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def auto_create_exam_from_analysis(
    db: Session,
    syllabus_id: int,
    user_id: int,
    semester_start_date: Optional[str] = None,
) -> dict:
    """분석 결과에서 시험 일정을 ExamSchedule에 등록하고 결과를 반환."""
    from app.auth.models import UserProfile

    s = get_syllabus_or_404(db, syllabus_id, user_id)
    analysis = s.analysis
    if not analysis:
        raise HTTPException(status_code=422, detail="분석 결과가 없습니다. 먼저 분석을 완료하세요.")
    if analysis.analysis_status == "pending":
        raise HTTPException(status_code=422, detail="분석이 아직 진행 중입니다. 잠시 후 다시 시도하세요.")

    sem_start: Optional[date] = None
    if semester_start_date:
        try:
            sem_start = date.fromisoformat(semester_start_date)
        except ValueError:
            pass
    if not sem_start:
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        if profile and profile.semester_start_date:
            try:
                sem_start = date.fromisoformat(profile.semester_start_date)
            except ValueError:
                pass

    exam_dates_raw = []
    if analysis.exam_dates:
        try:
            raw = analysis.exam_dates if isinstance(analysis.exam_dates, list) else json.loads(analysis.exam_dates)
            exam_dates_raw = raw if isinstance(raw, list) else []
        except Exception:
            pass

    created_exams = []
    skipped = 0

    for exam in exam_dates_raw:
        exam_type = str(exam.get("type", "")).lower()
        exam_date_str = str(exam.get("date", "")).strip()

        exam_date_obj: Optional[date] = None
        if exam_date_str:
            try:
                exam_date_obj = date.fromisoformat(exam_date_str)
            except ValueError:
                pass

        if not exam_date_obj and sem_start:
            week_num: Optional[int] = None
            if exam_type == "midterm":
                week_num = analysis.midterm_week
            elif exam_type == "final":
                week_num = analysis.final_week
            if week_num and 1 <= week_num <= 20:
                exam_date_obj = sem_start + timedelta(weeks=week_num - 1)

        if not exam_date_obj:
            skipped += 1
            continue

        type_label = {"midterm": "중간고사", "final": "기말고사"}.get(exam_type, "시험")
        title = f"{analysis.subject_name} {type_label}"

        existing = db.query(ExamSchedule).filter(
            ExamSchedule.user_id == user_id,
            ExamSchedule.title == title,
            ExamSchedule.exam_date == exam_date_obj,
        ).first()
        if existing:
            created_exams.append({"id": existing.id, "title": title, "exam_date": str(exam_date_obj), "already_existed": True})
            continue

        rec = stage_exam_record(db, user_id, {
            "title": title,
            "subject": analysis.subject_name,
            "exam_date": exam_date_obj,
        })
        db.flush()
        created_exams.append({"id": rec.id, "title": title, "exam_date": str(exam_date_obj), "already_existed": False})

    db.commit()
    new_count = sum(1 for e in created_exams if not e.get("already_existed"))
    return {"created": new_count, "skipped": skipped, "exams": created_exams}
