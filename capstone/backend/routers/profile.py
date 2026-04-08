# backend/routers/profile.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, constr, conint
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from .auth import get_current_user_token  # JWT 인증 함수

router = APIRouter(prefix="/profile", tags=["profile"])

# ── 공통 DB Dependency ─────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── Pydantic 스키마 ────────────────────────────────────────────
GenreStr = constr(strip_whitespace=True, to_lower=True, min_length=1, max_length=20)
TagTypeStr = constr(strip_whitespace=True, to_lower=True, min_length=1, max_length=20)

class GenrePref(BaseModel):
    genre: GenreStr
    score: conint(ge=1, le=5)

class TagPref(BaseModel):
    tag_type: TagTypeStr = Field(..., example="learning")   # learning / interest / tool …
    tag: constr(min_length=1, max_length=50)
    weight: float = 1.0

class ProfileCreate(BaseModel):
    locale: constr(min_length=2, max_length=5) = "ko"
    consent: bool = True
    genres: Optional[List[GenrePref]] = None
    tags:   Optional[List[TagPref]]   = None

class ProfileUpdate(ProfileCreate):
    """모든 필드 옵션(Partial Update)"""
    locale: Optional[constr(min_length=2, max_length=5)]
    consent: Optional[bool]

# ── Helper ─────────────────────────────────────────────────────
def upsert_genres(db: Session, user_id: int, genres: List[GenrePref]):
    db.query(models.UserPrefGenre).filter_by(user_id=user_id).delete()
    for g in genres:
        db.add(models.UserPrefGenre(
            user_id=user_id,
            genre=g.genre,
            score=g.score
        ))

def upsert_tags(db: Session, user_id: int, tags: List[TagPref]):
    db.query(models.UserPrefTag).filter_by(user_id=user_id).delete()
    for t in tags:
        db.add(models.UserPrefTag(
            user_id=user_id,
            tag_type=t.tag_type,
            tag=t.tag,
            weight=t.weight
        ))

# ── API ────────────────────────────────────────────────────────
@router.post("/", status_code=status.HTTP_201_CREATED)
def create_profile(
    payload: ProfileCreate,
    db: Session = Depends(get_db),
    me: models.User = Depends(get_current_user_token)
):
    if db.query(models.UserProfile).filter_by(user_id=me.id).first():
        raise HTTPException(400, "Profile already exists – use PATCH to update")

    profile = models.UserProfile(
        user_id=me.id,
        locale=payload.locale,
        consent=payload.consent
    )
    db.add(profile)

    if payload.genres:
        upsert_genres(db, me.id, payload.genres)
    if payload.tags:
        upsert_tags(db, me.id, payload.tags)

    db.commit()
    return {"message": "Profile created"}

@router.get("/", response_model=ProfileCreate)
def get_profile(
    db: Session = Depends(get_db),
    me: models.User = Depends(get_current_user_token)
):
    prof = db.query(models.UserProfile).filter_by(user_id=me.id).first()
    if not prof:
        raise HTTPException(404, "Profile not found")

    genres = [GenrePref(genre=g.genre, score=g.score) for g in me.pref_genres]
    tags   = [TagPref(tag_type=t.tag_type, tag=t.tag, weight=t.weight) for t in me.pref_tags]

    return ProfileCreate(
        locale = prof.locale,
        consent = prof.consent,
        genres = genres or None,
        tags = tags or None
    )

@router.patch("/")
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    me: models.User = Depends(get_current_user_token)
):
    prof = db.query(models.UserProfile).filter_by(user_id=me.id).first()
    if not prof:
        raise HTTPException(404, "Profile not found – create first")

    # 필드별로 부분 업데이트
    if payload.locale is not None:
        prof.locale = payload.locale
    if payload.consent is not None:
        prof.consent = payload.consent
    if payload.genres is not None:
        upsert_genres(db, me.id, payload.genres)
    if payload.tags is not None:
        upsert_tags(db, me.id, payload.tags)

    db.commit()
    return {"message": "Profile updated"}

@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(
    db: Session = Depends(get_db),
    me: models.User = Depends(get_current_user_token)
):
    """
    GDPR ‘사용자 데이터 삭제’ 용도
    - 프로필 및 선호 테이블 전부 제거
    """
    db.query(models.UserPrefGenre).filter_by(user_id=me.id).delete()
    db.query(models.UserPrefTag).filter_by(user_id=me.id).delete()
    db.query(models.UserProfile).filter_by(user_id=me.id).delete()
    db.commit()
