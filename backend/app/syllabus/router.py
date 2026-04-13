import json
import logging
import os
import uuid
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.models import User, UserProfile
from app.core.deps import get_current_user, get_db
from app.schedule.models import ExamSchedule
from app.syllabus.analyzer import analyze_syllabus
from app.syllabus.models import Syllabus, SyllabusAnalysis
from app.syllabus.schemas import SyllabusAnalysisResponse, SyllabusResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["syllabus"])

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "syllabi")
ALLOWED_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


# ─── 백그라운드 분석 작업 ────────────────────────────────────────────────────

# 재분석 없이 캐시 히트로 처리할 상태
_DONE_STATUSES = {"success", "partial"}
# 실패 상태 (재시도 가능)
_FAILED_STATUSES = {"failed", "rate_limited", "provider_unavailable", "empty_response"}


def _run_analysis(syllabus_id: int, file_path: str, content_type: str, subject_name: str, user_id: int, force: bool = False):
    """업로드 후 백그라운드에서 AI 분석 실행 → SyllabusAnalysis 저장.

    force=False(기본): 이미 success/partial이면 Gemini 호출 없이 즉시 종료.
    force=True: 기존 결과 무시하고 강제 재분석.
    """
    from app.db.database import SessionLocal  # 백그라운드에서 별도 세션 사용

    db = SessionLocal()
    try:
        # 기존 분석 레코드 있으면 재사용
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

        # ── 캐시 히트: 이미 완료된 분석은 Gemini 재호출 금지 ──────────────────
        if not force and record.analysis_status in _DONE_STATUSES:
            logger.info(f"Syllabus {syllabus_id}: 이미 분석 완료 (status={record.analysis_status}) — Gemini 생략")
            return

        payload, status_str, raw_text, reason = analyze_syllabus(file_path, content_type, subject_name)

        record.analysis_status = status_str
        record.analysis_reason = reason or None
        record.raw_text = raw_text[:8000] if raw_text else None

        if status_str in _FAILED_STATUSES:
            db.commit()
            logger.warning(f"Syllabus {syllabus_id}: 분석 실패 status={status_str} reason={reason}")
            return

        # 평가 비율
        record.midterm_weight = payload.midterm_weight
        record.final_weight = payload.final_weight
        record.assignment_weight = payload.assignment_weight
        record.attendance_weight = payload.attendance_weight
        record.presentation_weight = payload.presentation_weight
        record.has_presentation = payload.has_presentation

        # 구조화 데이터 — 신규 AnalysisPayload 필드명 사용
        record.midterm_week = payload.midterm_week
        record.final_week = payload.final_week
        record.weekly_topics = json.dumps(payload.weekly_plan, ensure_ascii=False)
        record.exam_dates = json.dumps(payload.exam_schedule, ensure_ascii=False)
        record.assignment_dates = json.dumps(payload.assignments, ensure_ascii=False)
        record.important_factors = json.dumps(payload.important_notes, ensure_ascii=False)

        # study_mapping 자동 계산
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
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Background analysis error: {e}")
        if record.id:
            record.analysis_status = "failed"
            db.commit()
    finally:
        db.close()


# ─── 엔드포인트 ──────────────────────────────────────────────────────────────

@router.post("/syllabi/upload", response_model=SyllabusResponse, status_code=status.HTTP_201_CREATED)
async def upload_syllabus(
    background_tasks: BackgroundTasks,
    subject_name: str = Form(...),
    file: UploadFile = File(...),
    source: str = Form(default="syllabus_upload"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """강의계획서 파일 업로드. 업로드 직후 백그라운드에서 AI 분석 시작."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="지원하지 않는 파일 형식입니다. 허용: PDF, Word, JPG, PNG",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="파일 크기는 20MB 이하여야 합니다.",
        )

    user_dir = os.path.join(UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1].lower() or ".bin"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(user_dir, stored_name)

    with open(file_path, "wb") as f:
        f.write(content)

    syllabus = Syllabus(
        user_id=current_user.id,
        subject_name=subject_name.strip(),
        original_filename=file.filename or stored_name,
        stored_filename=stored_name,
        file_path=file_path,
        file_size=len(content),
        content_type=file.content_type,
        source=source or "syllabus_upload",
    )
    db.add(syllabus)
    db.commit()
    db.refresh(syllabus)

    # 백그라운드에서 AI 분석 시작
    background_tasks.add_task(
        _run_analysis,
        syllabus.id,
        file_path,
        file.content_type,
        subject_name.strip(),
        current_user.id,
    )

    return syllabus


@router.get("/syllabi", response_model=List[SyllabusResponse])
def list_syllabi(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Syllabus)
        .filter(Syllabus.user_id == current_user.id)
        .order_by(Syllabus.uploaded_at.desc())
        .all()
    )


@router.get("/syllabi/analyses", response_model=List[SyllabusAnalysisResponse])
def list_all_analyses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """유저의 모든 강의계획서 분석 결과 목록 조회."""
    return (
        db.query(SyllabusAnalysis)
        .filter(SyllabusAnalysis.user_id == current_user.id)
        .order_by(SyllabusAnalysis.analyzed_at.desc())
        .all()
    )


@router.post("/syllabi/{syllabus_id}/analyze", status_code=status.HTTP_202_ACCEPTED)
def trigger_analysis(
    syllabus_id: int,
    background_tasks: BackgroundTasks,
    force: bool = Query(default=False, description="True면 기존 결과 무시하고 강제 재분석"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    강의계획서 분석을 시작합니다.
    - force=False(기본): 이미 success/partial이면 Gemini 호출 없이 즉시 반환
    - force=True: 강제 재분석 (Gemini 재호출)
    """
    s = db.query(Syllabus).filter(
        Syllabus.id == syllabus_id, Syllabus.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="강의계획서를 찾을 수 없습니다.")

    existing = db.query(SyllabusAnalysis).filter(SyllabusAnalysis.syllabus_id == syllabus_id).first()

    # 캐시 히트: 이미 완료된 분석은 Gemini 재호출 금지
    if existing and existing.analysis_status in _DONE_STATUSES and not force:
        return {"message": "이미 분석이 완료되어 있습니다.", "syllabus_id": syllabus_id, "cached": True}

    # force 재분석 또는 미완료 → pending 리셋 후 백그라운드 실행
    if existing:
        existing.analysis_status = "pending"
        db.commit()

    background_tasks.add_task(
        _run_analysis,
        s.id,
        s.file_path,
        s.content_type or "application/pdf",
        s.subject_name,
        current_user.id,
        force,
    )
    return {"message": "분석을 시작했습니다.", "syllabus_id": syllabus_id, "cached": False}


@router.get("/syllabi/{syllabus_id}/analysis", response_model=SyllabusAnalysisResponse)
def get_syllabus_analysis(
    syllabus_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 강의계획서의 AI 분석 결과 조회."""
    s = db.query(Syllabus).filter(Syllabus.id == syllabus_id, Syllabus.user_id == current_user.id).first()
    if not s:
        raise HTTPException(status_code=404, detail="강의계획서를 찾을 수 없습니다.")
    if not s.analysis:
        raise HTTPException(status_code=404, detail="분석 결과가 아직 없습니다. 잠시 후 다시 시도하세요.")
    return s.analysis


@router.delete("/syllabi/{syllabus_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_syllabus(
    syllabus_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Syllabus).filter(
        Syllabus.id == syllabus_id, Syllabus.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="강의계획서를 찾을 수 없습니다.")
    if os.path.exists(s.file_path):
        os.remove(s.file_path)
    db.delete(s)
    db.commit()


@router.post("/syllabi/{syllabus_id}/auto-create-exam")
def auto_create_exam(
    syllabus_id: int,
    semester_start_date: Optional[str] = Body(default=None, embed=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    강의계획서 분석 결과에서 시험 일정을 자동으로 ExamSchedule에 등록합니다.

    - exam_schedule의 date가 있으면 그대로 사용
    - date가 없고 midterm_week/final_week가 있으면 semester_start_date + (week-1)*7일로 계산
    - semester_start_date: 요청 body 또는 user_profiles에서 읽음 (YYYY-MM-DD)
    """
    s = db.query(Syllabus).filter(
        Syllabus.id == syllabus_id, Syllabus.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="강의계획서를 찾을 수 없습니다.")

    analysis = s.analysis
    if not analysis:
        raise HTTPException(status_code=422, detail="분석 결과가 없습니다. 먼저 분석을 완료하세요.")
    if analysis.analysis_status == "pending":
        raise HTTPException(status_code=422, detail="분석이 아직 진행 중입니다. 잠시 후 다시 시도하세요.")

    # 학기 시작일: body 우선, 없으면 profile에서
    sem_start: Optional[date] = None
    if semester_start_date:
        try:
            sem_start = date.fromisoformat(semester_start_date)
        except ValueError:
            pass
    if not sem_start:
        profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
        if profile and profile.semester_start_date:
            try:
                sem_start = date.fromisoformat(profile.semester_start_date)
            except ValueError:
                pass

    # exam_dates JSON 파싱
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

        # 날짜 결정
        exam_date_obj: Optional[date] = None
        if exam_date_str:
            try:
                exam_date_obj = date.fromisoformat(exam_date_str)
            except ValueError:
                pass

        # 날짜 미상 → 주차 기반 계산
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

        # 시험 제목
        type_label = {"midterm": "중간고사", "final": "기말고사"}.get(exam_type, "시험")
        title = f"{analysis.subject_name} {type_label}"

        # 중복 방지
        existing = db.query(ExamSchedule).filter(
            ExamSchedule.user_id == current_user.id,
            ExamSchedule.title == title,
            ExamSchedule.exam_date == exam_date_obj,
        ).first()
        if existing:
            created_exams.append({
                "id": existing.id, "title": title,
                "exam_date": str(exam_date_obj), "already_existed": True,
            })
            continue

        rec = ExamSchedule(
            user_id=current_user.id,
            title=title,
            subject=analysis.subject_name,
            exam_date=exam_date_obj,
        )
        db.add(rec)
        db.flush()
        created_exams.append({
            "id": rec.id, "title": title,
            "exam_date": str(exam_date_obj), "already_existed": False,
        })

    db.commit()
    new_count = sum(1 for e in created_exams if not e.get("already_existed"))
    return {"created": new_count, "skipped": skipped, "exams": created_exams}


@router.get("/syllabi/{syllabus_id}/download")
def download_syllabus(
    syllabus_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Syllabus).filter(
        Syllabus.id == syllabus_id, Syllabus.user_id == current_user.id
    ).first()
    if not s or not os.path.exists(s.file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(
        s.file_path,
        media_type=s.content_type or "application/octet-stream",
        filename=s.original_filename,
    )
