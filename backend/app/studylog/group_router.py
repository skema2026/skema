"""
스터디 그룹 API

POST   /groups               — 그룹 생성
POST   /groups/join          — 초대코드로 참여
GET    /groups/me            — 내 그룹 목록
GET    /groups/search        — 이름으로 그룹 검색
GET    /groups/{id}          — 그룹 상세 + 멤버
DELETE /groups/{id}/leave    — 그룹 탈퇴
GET    /groups/{id}/feed     — BeReal 스타일 피드 (날짜별 멤버×기록)
"""

import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth.models import User
from app.core.security import get_current_user, get_db
from app.schedule.models import Schedule

from .group_schemas import GroupCreate, GroupDetail, GroupFeedDay, GroupOut, MemberOut, MemberSlot
from .models import StudyGroup, StudyGroupMember, StudyLog, StudyLogReaction

router = APIRouter(prefix="/groups", tags=["groups"])

KST = ZoneInfo("Asia/Seoul")
UPLOAD_BASE = "/proxy"


def _photo_url(path: str) -> str:
    return f"/uploads/studylogs/{os.path.basename(path)}"


def _is_member(db: Session, group_id: int, user_id: int) -> bool:
    return db.query(StudyGroupMember).filter(
        StudyGroupMember.group_id == group_id,
        StudyGroupMember.user_id == user_id,
    ).first() is not None


def _group_or_404(db: Session, group_id: int) -> StudyGroup:
    g = db.query(StudyGroup).filter(StudyGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="그룹을 찾을 수 없습니다.")
    return g


@router.post("", status_code=201, response_model=GroupOut)
def create_group(
    body: GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    group = StudyGroup(name=body.name, description=body.description, created_by=current_user.id)
    db.add(group)
    db.flush()
    db.add(StudyGroupMember(group_id=group.id, user_id=current_user.id))
    db.commit()
    db.refresh(group)
    return GroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        invite_code=group.invite_code,
        member_count=1,
        created_at=group.created_at,
    )


@router.post("/join", status_code=200, response_model=GroupOut)
def join_group(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    code = (body.get("invite_code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="invite_code 필요")
    group = db.query(StudyGroup).filter(StudyGroup.invite_code == code).first()
    if not group:
        raise HTTPException(status_code=404, detail="초대코드가 올바르지 않습니다.")
    if _is_member(db, group.id, current_user.id):
        raise HTTPException(status_code=409, detail="이미 참여 중인 그룹입니다.")
    db.add(StudyGroupMember(group_id=group.id, user_id=current_user.id))
    db.commit()
    count = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == group.id).count()
    return GroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        invite_code=group.invite_code,
        member_count=count,
        created_at=group.created_at,
    )


@router.get("/me", response_model=list[GroupOut])
def my_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    memberships = (
        db.query(StudyGroupMember)
        .filter(StudyGroupMember.user_id == current_user.id)
        .options(joinedload(StudyGroupMember.group))
        .all()
    )
    result = []
    for m in memberships:
        g = m.group
        count = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id).count()
        result.append(GroupOut(
            id=g.id, name=g.name, invite_code=g.invite_code,
            member_count=count, created_at=g.created_at,
        ))
    return result


@router.get("/search", response_model=list[GroupOut])
def search_groups(
    q: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """이름으로 그룹 검색 (최대 20개). 초대코드 직접 입력도 지원."""
    q = q.strip()
    if not q:
        return []
    # 이름 부분 일치 OR 초대코드 완전 일치
    groups = (
        db.query(StudyGroup)
        .filter(
            (StudyGroup.name.ilike(f"%{q}%")) |
            (StudyGroup.invite_code == q.upper())
        )
        .order_by(StudyGroup.created_at.desc())
        .limit(20)
        .all()
    )
    result = []
    for g in groups:
        count = db.query(StudyGroupMember).filter(StudyGroupMember.group_id == g.id).count()
        result.append(GroupOut(
            id=g.id, name=g.name, description=g.description,
            invite_code=g.invite_code, member_count=count, created_at=g.created_at,
        ))
    return result


@router.get("/{group_id}", response_model=GroupDetail)
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    group = _group_or_404(db, group_id)
    if not _is_member(db, group_id, current_user.id):
        raise HTTPException(status_code=403, detail="그룹 멤버만 조회할 수 있습니다.")
    memberships = (
        db.query(StudyGroupMember)
        .filter(StudyGroupMember.group_id == group_id)
        .options(joinedload(StudyGroupMember.user))
        .all()
    )
    members = [
        MemberOut(user_id=m.user_id, username=m.user.username, joined_at=m.joined_at)
        for m in memberships
    ]
    return GroupDetail(
        id=group.id, name=group.name, description=group.description,
        invite_code=group.invite_code, member_count=len(members),
        created_at=group.created_at, members=members,
    )


@router.delete("/{group_id}/leave", status_code=204)
def leave_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = db.query(StudyGroupMember).filter(
        StudyGroupMember.group_id == group_id,
        StudyGroupMember.user_id == current_user.id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="해당 그룹의 멤버가 아닙니다.")
    # 내가 이 그룹에 올린 기록들을 개인 기록으로 전환 (group_id → NULL)
    # 재참여 시 이전 기록이 다시 뜨는 것을 방지
    db.query(StudyLog).filter(
        StudyLog.group_id == group_id,
        StudyLog.user_id == current_user.id,
    ).update({"group_id": None})
    db.delete(m)
    db.commit()


@router.get("/{group_id}/feed", response_model=list[GroupFeedDay])
def get_group_feed(
    group_id: int,
    days: int = 7,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """최근 N일치 BeReal 스타일 피드 반환.

    각 날짜별로 그룹 멤버 전원을 나열하고,
    해당 날에 기록을 올렸으면 기록 정보를, 안 올렸으면 None을 담아 반환.
    """
    _group_or_404(db, group_id)
    if not _is_member(db, group_id, current_user.id):
        raise HTTPException(status_code=403, detail="그룹 멤버만 조회할 수 있습니다.")

    memberships = (
        db.query(StudyGroupMember)
        .filter(StudyGroupMember.group_id == group_id)
        .options(joinedload(StudyGroupMember.user))
        .all()
    )
    members = [(m.user_id, m.user.username) for m in memberships]

    today_kst = datetime.now(KST).date()
    days = min(max(days, 1), 30)

    result: list[GroupFeedDay] = []
    for delta in range(days):
        target_date = today_kst - timedelta(days=delta)
        day_start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=KST).astimezone(timezone.utc).replace(tzinfo=None)
        day_end   = day_start + timedelta(days=1)

        logs = (
            db.query(StudyLog)
            .filter(
                StudyLog.group_id == group_id,
                StudyLog.created_at >= day_start,
                StudyLog.created_at < day_end,
            )
            .options(joinedload(StudyLog.reactions))
            .all()
        )
        # user_id → 가장 최근 log (하루에 여러 개면 최신 1개만)
        log_by_user: dict[int, StudyLog] = {}
        for log in sorted(logs, key=lambda l: l.created_at):
            log_by_user[log.user_id] = log

        # schedule titles
        sched_ids = {l.schedule_id for l in log_by_user.values() if l.schedule_id}
        sched_map: dict[int, str] = {}
        if sched_ids:
            scheds = db.query(Schedule).filter(Schedule.id.in_(sched_ids)).all()
            sched_map = {s.id: s.title for s in scheds}

        slots: list[MemberSlot] = []
        for uid, uname in members:
            log = log_by_user.get(uid)
            if log:
                counts = Counter(r.emoji for r in log.reactions)
                my_r   = [r.emoji for r in log.reactions if r.user_id == current_user.id]
                slot = MemberSlot(
                    user_id=uid, username=uname,
                    log_id=log.id,
                    photo_url=_photo_url(log.photo_path) if log.photo_path else None,
                    caption=log.caption,
                    schedule_title=sched_map.get(log.schedule_id) if log.schedule_id else None,
                    created_at=log.created_at,
                    reactions=[{"emoji": e, "count": c} for e, c in counts.items()],
                    my_reactions=my_r,
                )
            else:
                slot = MemberSlot(user_id=uid, username=uname)
            slots.append(slot)

        result.append(GroupFeedDay(date=target_date.isoformat(), slots=slots))

    return result
