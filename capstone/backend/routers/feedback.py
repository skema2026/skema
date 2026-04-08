# backend/routers/feedback.py

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.orm import Session
from database import SessionLocal
from .auth import get_current_user_token
import models
from typing import List

router = APIRouter(prefix="/feedback", tags=["feedback"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class FeedbackCreate(BaseModel):
    category: str = Field(..., example="recommend")
    reference_id: str = Field(..., example="card_id=c_12903")
    feedback_score: Optional[float] = None
    feedback_label: Optional[str] = None   # like/dislike/neutral...
    details: Optional[dict] = None

@router.post("/")
def upsert_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    POST /feedback
    body:
    {
    "category": "recommend",  # or "event","search","summarize"
    "reference_id": "card_id=c_12903", 
    "feedback_score": 5.0,   # optional
    "feedback_label": "like",
    "details": {...}         # optional
    }

    - 이미 존재하면 UPDATE, 없으면 INSERT
    """
    fb = db.query(models.FeedbackLog).filter_by(
        user_id=current_user.id,
        category=payload.category,
        reference_id=payload.reference_id
    ).first()
    if fb:
        # Update
        fb.feedback_score = payload.feedback_score
        fb.feedback_label = payload.feedback_label
        fb.details = payload.details
    else:
        # Create new
        fb = models.FeedbackLog(
            user_id = current_user.id,
            category= payload.category,
            reference_id= payload.reference_id,
            feedback_score = payload.feedback_score,
            feedback_label = payload.feedback_label,
            details = payload.details
        )
        db.add(fb)
    db.commit()
    db.refresh(fb)

    return {
        "message": "Feedback upserted",
        "feedback_id": fb.id,
        "feedback_label": fb.feedback_label,
        "feedback_score": fb.feedback_score
    }

@router.get("/")
def get_feedback(
    category: str,
    reference_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    GET /feedback?category=recommend&reference_id=card_id=...
    - 한 개의 피드백(또는 없으면 404) 반환
    - or 여러개를 원한다면 user_id+category로 필터
    """
    fb = db.query(models.FeedbackLog).filter_by(
        user_id=current_user.id,
        category=category,
        reference_id=reference_id
    ).first()
    if not fb:
        raise HTTPException(404, "Feedback not found")

    return {
        "feedback_id": fb.id,
        "category": fb.category,
        "reference_id": fb.reference_id,
        "feedback_score": fb.feedback_score,
        "feedback_label": fb.feedback_label,
        "details": fb.details,
        "created_at": fb.created_at
    }