"""
공부 인증 피드 API

POST   /study-logs                  — 인증 사진 + 캡션 업로드
GET    /study-logs/feed             — 전체 공개 피드 (최신순, 페이지네이션)
GET    /study-logs/me               — 내 로그 목록
DELETE /study-logs/{id}            — 내 로그 삭제
POST   /study-logs/{id}/reactions  — 이모지 반응 추가/토글
"""

import os
import uuid
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.auth.models import User, UserProfile
from app.core.security import get_current_user, get_db
from app.schedule.models import Schedule

from .models import StudyLog, StudyLogReaction
from .schemas import FeedResponse, ReactionToggleRequest, StudyLogOut

router = APIRouter(prefix="/study-logs", tags=["study-logs"])

UPLOAD_DIR = "/app/uploads/studylogs"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


def _ensure_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def _photo_url(photo_path: str, request_base: str = "") -> str:
    filename = os.path.basename(photo_path)
    return f"/uploads/studylogs/{filename}"


def _build_log_out(log: StudyLog, current_user_id: int) -> StudyLogOut:
    reaction_counts = Counter((r.emoji) for r in log.reactions)
    my_reactions = [r.emoji for r in log.reactions if r.user_id == current_user_id]
    reactions_out = [{"emoji": e, "count": c} for e, c in reaction_counts.items()]

    username = log.user.username if log.user else "unknown"
    schedule_title = None
    if log.schedule_id:
        schedule = log.user  # already loaded via relationship or fallback
    # get schedule title safely
    schedule_title_val = None

    return StudyLogOut(
        id=log.id,
        user_id=log.user_id,
        username=username,
        schedule_id=log.schedule_id,
        schedule_title=schedule_title_val,
        photo_url=_photo_url(log.photo_path),
        caption=log.caption,
        is_public=log.is_public,
        created_at=log.created_at,
        reactions=reactions_out,
        my_reactions=my_reactions,
    )


@router.post("", status_code=201, response_model=StudyLogOut)
async def create_study_log(
    photo: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    is_public: bool = Form(True),
    schedule_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if photo.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="jpeg/png/webp 이미지만 업로드 가능합니다.")

    content = await photo.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="파일 크기는 10MB 이하여야 합니다.")

    _ensure_upload_dir()
    ext = photo.filename.rsplit(".", 1)[-1] if photo.filename and "." in photo.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    photo_path = os.path.join(UPLOAD_DIR, filename)
    with open(photo_path, "wb") as f:
        f.write(content)

    # schedule_id 검증
    if schedule_id:
        sched = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current_user.id).first()
        if not sched:
            schedule_id = None

    log = StudyLog(
        user_id=current_user.id,
        schedule_id=schedule_id,
        photo_path=photo_path,
        caption=caption[:200] if caption else None,
        is_public=is_public,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    # user 관계 로드
    db.refresh(log)
    log.user  # trigger load

    return _build_log_out(log, current_user.id)


@router.get("/feed", response_model=FeedResponse)
def get_feed(
    offset: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = min(limit, 50)
    q = (
        db.query(StudyLog)
        .filter(StudyLog.is_public == True)  # noqa: E712
        .options(
            joinedload(StudyLog.user),
            joinedload(StudyLog.reactions),
        )
        .order_by(StudyLog.created_at.desc())
    )
    total = q.count()
    logs = q.offset(offset).limit(limit).all()
    return FeedResponse(
        items=[_build_log_out(log, current_user.id) for log in logs],
        total=total,
        has_next=(offset + limit) < total,
    )


@router.get("/me", response_model=FeedResponse)
def get_my_logs(
    offset: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = min(limit, 50)
    q = (
        db.query(StudyLog)
        .filter(StudyLog.user_id == current_user.id)
        .options(
            joinedload(StudyLog.user),
            joinedload(StudyLog.reactions),
        )
        .order_by(StudyLog.created_at.desc())
    )
    total = q.count()
    logs = q.offset(offset).limit(limit).all()
    return FeedResponse(
        items=[_build_log_out(log, current_user.id) for log in logs],
        total=total,
        has_next=(offset + limit) < total,
    )


@router.delete("/{log_id}", status_code=204)
def delete_study_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log = db.query(StudyLog).filter(StudyLog.id == log_id, StudyLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="로그를 찾을 수 없습니다.")
    # 파일 삭제
    if os.path.exists(log.photo_path):
        os.remove(log.photo_path)
    db.delete(log)
    db.commit()


@router.post("/{log_id}/reactions", response_model=list[dict])
def toggle_reaction(
    log_id: int,
    body: ReactionToggleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log = db.query(StudyLog).filter(StudyLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="로그를 찾을 수 없습니다.")
    if not log.is_public and log.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="비공개 로그입니다.")

    existing = db.query(StudyLogReaction).filter(
        StudyLogReaction.log_id == log_id,
        StudyLogReaction.user_id == current_user.id,
        StudyLogReaction.emoji == body.emoji,
    ).first()

    if existing:
        db.delete(existing)
    else:
        db.add(StudyLogReaction(log_id=log_id, user_id=current_user.id, emoji=body.emoji))
    db.commit()

    reactions = db.query(StudyLogReaction).filter(StudyLogReaction.log_id == log_id).all()
    counts = Counter(r.emoji for r in reactions)
    return [{"emoji": e, "count": c} for e, c in counts.items()]
