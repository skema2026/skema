"""
공부 인증 피드 API

POST   /study-logs                  — 기록 업로드 (그룹 지정 가능)
GET    /study-logs/feed             — 그룹 없는 사람용 글로벌 피드
GET    /study-logs/me               — 내 기록 목록
GET    /study-logs/streak           — 내 스트릭
GET    /study-logs/today-stats      — 오늘 현황
DELETE /study-logs/{id}            — 내 기록 삭제
POST   /study-logs/{id}/reactions  — 이모지 반응 추가/토글
"""

import os
import uuid
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.auth.models import User
from app.core.security import get_current_user, get_db
from app.schedule.models import Schedule

from .models import StudyGroup, StudyGroupMember, StudyLog, StudyLogReaction
from .schemas import FeedResponse, ReactionToggleRequest, StudyLogOut
from .streak import compute_streak

router = APIRouter(prefix="/study-logs", tags=["study-logs"])

UPLOAD_DIR = "/app/uploads/studylogs"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


def _ensure_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def _photo_url(photo_path: str) -> str:
    return f"/uploads/studylogs/{os.path.basename(photo_path)}"


def _build_log_out(log: StudyLog, current_user_id: int, db: Session | None = None) -> StudyLogOut:
    reaction_counts = Counter(r.emoji for r in log.reactions)
    my_reactions = [r.emoji for r in log.reactions if r.user_id == current_user_id]
    reactions_out = [{"emoji": e, "count": c} for e, c in reaction_counts.items()]

    username = log.user.username if log.user else "unknown"

    schedule_title_val = None
    if log.schedule_id and db:
        sched = db.query(Schedule).filter(Schedule.id == log.schedule_id).first()
        schedule_title_val = sched.title if sched else None

    return StudyLogOut(
        id=log.id,
        user_id=log.user_id,
        username=username,
        schedule_id=log.schedule_id,
        schedule_title=schedule_title_val,
        photo_url=_photo_url(log.photo_path) if log.photo_path else None,
        caption=log.caption,
        is_public=log.is_public,
        created_at=log.created_at,
        reactions=reactions_out,
        my_reactions=my_reactions,
    )


@router.post("", status_code=201, response_model=StudyLogOut)
async def create_study_log(
    photo: Optional[UploadFile] = File(None),
    caption: Optional[str] = Form(None),
    group_id: Optional[int] = Form(None),
    schedule_id: Optional[int] = Form(None),
    is_public: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not photo and not caption:
        raise HTTPException(status_code=400, detail="사진 또는 텍스트 중 하나는 필요합니다.")

    # 그룹 멤버 검증
    if group_id:
        is_member = db.query(StudyGroupMember).filter(
            StudyGroupMember.group_id == group_id,
            StudyGroupMember.user_id == current_user.id,
        ).first()
        if not is_member:
            raise HTTPException(status_code=403, detail="해당 그룹의 멤버가 아닙니다.")

    photo_path = None
    if photo and photo.filename:
        if photo.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=415, detail="jpeg/png/webp 이미지만 업로드 가능합니다.")
        content = await photo.read()
        if len(content) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="파일 크기는 10MB 이하여야 합니다.")
        _ensure_upload_dir()
        ext = photo.filename.rsplit(".", 1)[-1] if "." in photo.filename else "jpg"
        filename = f"{uuid.uuid4().hex}.{ext}"
        photo_path = os.path.join(UPLOAD_DIR, filename)
        with open(photo_path, "wb") as f:
            f.write(content)

    if schedule_id:
        sched = db.query(Schedule).filter(Schedule.id == schedule_id, Schedule.user_id == current_user.id).first()
        if not sched:
            schedule_id = None

    # 그룹에 올리는 기록은 그룹 내 공개가 기본, 별도 is_public로 글로벌 피드 노출 제어
    log = StudyLog(
        user_id=current_user.id,
        group_id=group_id,
        schedule_id=schedule_id,
        photo_path=photo_path,
        caption=caption[:200] if caption else None,
        is_public=is_public,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    log.user  # trigger load

    # 그룹 기록 알림: 같은 그룹 멤버에게 푸시
    if group_id:
        _notify_group_members(db, group_id, current_user.id, current_user.username)

    return _build_log_out(log, current_user.id, db)


def _notify_group_members(db: Session, group_id: int, poster_id: int, poster_name: str) -> None:
    from app.notification.service import send_push_to_user
    from app.notification.scheduler import _is_notif_enabled
    members = db.query(StudyGroupMember).filter(
        StudyGroupMember.group_id == group_id,
        StudyGroupMember.user_id != poster_id,
    ).all()
    for m in members:
        if _is_notif_enabled(db, m.user_id, "group_member_post"):
            send_push_to_user(
                db, m.user_id,
                title="새 기록",
                body=f"{poster_name}님이 기록을 올렸어요",
                url="/log",
                ntype="group_member_post",
            )


@router.get("/today-stats")
def get_today_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    today_start = datetime.now(ZoneInfo("Asia/Seoul")).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
    today_logs = db.query(StudyLog).filter(
        StudyLog.created_at >= today_start_utc,
        StudyLog.group_id == None,  # noqa: E711 — 그룹 없는 글로벌 로그만
    ).all()
    user_count = len({log.user_id for log in today_logs})
    return {"today_users": user_count, "today_logs": len(today_logs)}


@router.get("/streak")
def get_streak(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return compute_streak(db, current_user.id)


@router.get("/feed", response_model=FeedResponse)
def get_feed(
    offset: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """그룹에 속하지 않은 글로벌 공개 피드 (is_public=True만)."""
    limit = min(limit, 50)
    q = (
        db.query(StudyLog)
        .filter(StudyLog.group_id == None, StudyLog.is_public == True)  # noqa: E711,E712
        .options(joinedload(StudyLog.user), joinedload(StudyLog.reactions))
        .order_by(StudyLog.created_at.desc())
    )
    total = q.count()
    logs = q.offset(offset).limit(limit).all()
    return FeedResponse(
        items=[_build_log_out(log, current_user.id, db) for log in logs],
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
        .options(joinedload(StudyLog.user), joinedload(StudyLog.reactions))
        .order_by(StudyLog.created_at.desc())
    )
    total = q.count()
    logs = q.offset(offset).limit(limit).all()
    return FeedResponse(
        items=[_build_log_out(log, current_user.id, db) for log in logs],
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
    if log.photo_path and os.path.exists(log.photo_path):
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

    # 그룹 기록이면 멤버만 반응 가능
    if log.group_id:
        is_member = db.query(StudyGroupMember).filter(
            StudyGroupMember.group_id == log.group_id,
            StudyGroupMember.user_id == current_user.id,
        ).first()
        if not is_member:
            raise HTTPException(status_code=403, detail="그룹 멤버만 반응할 수 있습니다.")

    existing = db.query(StudyLogReaction).filter(
        StudyLogReaction.log_id == log_id,
        StudyLogReaction.user_id == current_user.id,
        StudyLogReaction.emoji == body.emoji,
    ).first()

    is_new = existing is None
    if existing:
        db.delete(existing)
    else:
        db.add(StudyLogReaction(log_id=log_id, user_id=current_user.id, emoji=body.emoji))
    db.commit()

    # 👍 새로 달렸을 때 큐에 적재 (5분 주기 배치 발송)
    if is_new and body.emoji == '👍' and log.user_id != current_user.id:
        from app.notification.scheduler import _is_notif_enabled
        from app.notification.models import LikeNotificationQueue
        if _is_notif_enabled(db, log.user_id, "log_like"):
            db.add(LikeNotificationQueue(
                target_user_id=log.user_id,
                liker_name=current_user.username,
                content_type='log',
                content_id=log_id,
            ))
            db.commit()

    reactions = db.query(StudyLogReaction).filter(StudyLogReaction.log_id == log_id).all()
    counts = Counter(r.emoji for r in reactions)
    return [{"emoji": e, "count": c} for e, c in counts.items()]
