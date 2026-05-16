import os
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.security import get_current_user, get_db
from app.syllabus import repository, service
from app.syllabus.schemas import SyllabusAnalysisResponse, SyllabusResponse

router = APIRouter(tags=["syllabus"])

_DONE_STATUSES = {"success", "partial"}


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
    if file.content_type not in service.ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="지원하지 않는 파일 형식입니다. 허용: PDF, Word, JPG, PNG",
        )

    content = await file.read()
    if len(content) > service.MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="파일 크기는 20MB 이하여야 합니다.",
        )

    file_path, stored_name = service.save_uploaded_file(content, current_user.id, file.filename or "upload")

    syllabus = repository.create_syllabus(
        db,
        user_id=current_user.id,
        subject_name=subject_name.strip(),
        original_filename=file.filename or stored_name,
        stored_filename=stored_name,
        file_path=file_path,
        file_size=len(content),
        content_type=file.content_type,
        source=source or "syllabus_upload",
    )

    background_tasks.add_task(
        service.run_analysis,
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
    return repository.list_syllabi(db, current_user.id)


@router.get("/syllabi/analyses", response_model=List[SyllabusAnalysisResponse])
def list_all_analyses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """유저의 모든 강의계획서 분석 결과 목록 조회."""
    return repository.list_analyses(db, current_user.id)


@router.post("/syllabi/{syllabus_id}/analyze", status_code=status.HTTP_202_ACCEPTED)
def trigger_analysis(
    syllabus_id: int,
    background_tasks: BackgroundTasks,
    force: bool = Query(default=False, description="True면 기존 결과 무시하고 강제 재분석"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = service.get_syllabus_or_404(db, syllabus_id, current_user.id)
    analysis = s.analysis

    if analysis and analysis.analysis_status in _DONE_STATUSES and not force:
        return {"message": "이미 분석이 완료되어 있습니다.", "syllabus_id": syllabus_id, "cached": True}

    if analysis:
        service.reset_analysis_status(db, syllabus_id, current_user.id)

    background_tasks.add_task(
        service.run_analysis,
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
    s = service.get_syllabus_or_404(db, syllabus_id, current_user.id)
    if not s.analysis:
        raise HTTPException(status_code=404, detail="분석 결과가 아직 없습니다. 잠시 후 다시 시도하세요.")
    return s.analysis


@router.delete("/syllabi/{syllabus_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_syllabus(
    syllabus_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service.delete_syllabus_with_file(db, syllabus_id, current_user.id)


@router.post("/syllabi/{syllabus_id}/auto-create-exam")
def auto_create_exam(
    syllabus_id: int,
    semester_start_date: Optional[str] = Body(default=None, embed=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.auto_create_exam_from_analysis(db, syllabus_id, current_user.id, semester_start_date)


@router.get("/syllabi/{syllabus_id}/download")
def download_syllabus(
    syllabus_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = service.get_syllabus_or_404(db, syllabus_id, current_user.id)
    if not os.path.exists(s.file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(
        s.file_path,
        media_type=s.content_type or "application/octet-stream",
        filename=s.original_filename,
    )
