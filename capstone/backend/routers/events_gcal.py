# routers/events_gcal.py
import datetime as dt
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import SessionLocal
import models
from .auth import get_current_user_token
from .gcal import build_gcal_service          # <- gcal.py 의 서비스 빌더

router = APIRouter(prefix="/events", tags=["events"])

# --------------------------------------------------
# helper: DB session
# --------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --------------------------------------------------
# helper: RFC‑3339 정규화 (UTC → ‘Z’)
# --------------------------------------------------
def to_rfc3339(t: dt.datetime) -> str:
    """datetime → RFC‑3339 (끝을 Z 로)"""
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    else:
        t = t.astimezone(dt.timezone.utc)
    return t.replace(tzinfo=None, microsecond=0).isoformat() + "Z"

# --------------------------------------------------
# Pydantic models
# --------------------------------------------------
class When(BaseModel):
    dateTime: Optional[dt.datetime] = None       # timed event
    date:     Optional[str]         = None       # all‑day (YYYY‑MM‑DD)

class EventCreate(BaseModel):
    summary:     str
    description: str = ""
    start:       dt.datetime = Field(..., example="2025-05-01T09:00:00Z")
    end:         dt.datetime = Field(..., example="2025-05-01T10:00:00Z")
    timezone:    str = "UTC"

class EventOut(BaseModel):
    id:          str
    summary:     str = ""
    description: str = ""
    start:       When
    end:         When
    htmlLink:    Optional[str] = None
    class Config:
        orm_mode = False
        extra = "allow"            # Google 이 돌려주는 기타 필드 허용

# --------------------------------------------------
# ① CREATE
# --------------------------------------------------
@router.post("/", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    service = build_gcal_service(db, current_user.id)

    body = {
        "summary":     payload.summary,
        "description": payload.description,
        "start": {"dateTime": to_rfc3339(payload.start), "timeZone": payload.timezone},
        "end":   {"dateTime": to_rfc3339(payload.end),   "timeZone": payload.timezone},
    }

    return service.events().insert(calendarId="primary", body=body).execute()

# --------------------------------------------------
# ② LIST
# --------------------------------------------------
@router.get("/", response_model=List[EventOut])
def list_events(
    start: Optional[dt.datetime] = None,
    end:   Optional[dt.datetime] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    service = build_gcal_service(db, current_user.id)

    params = {
        "calendarId":   "primary",
        "singleEvents": True,
        "orderBy":      "startTime",
        "timeMin":      to_rfc3339(start or dt.datetime.utcnow()),
    }
    if end:
        params["timeMax"] = to_rfc3339(end)

    resp = service.events().list(**params).execute()
    return resp.get("items", [])

# --------------------------------------------------
# ③ GET ONE
# --------------------------------------------------
@router.get("/{event_id}", response_model=EventOut)
def get_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    service = build_gcal_service(db, current_user.id)
    try:
        return service.events().get(calendarId="primary", eventId=event_id).execute()
    except Exception:
        raise HTTPException(404, "Event not found")

# --------------------------------------------------
# ④ UPDATE
# --------------------------------------------------
@router.put("/{event_id}", response_model=EventOut)
def update_event(
    event_id: str,
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    service = build_gcal_service(db, current_user.id)

    body = {
        "summary":     payload.summary,
        "description": payload.description,
        "start": {"dateTime": to_rfc3339(payload.start), "timeZone": payload.timezone},
        "end":   {"dateTime": to_rfc3339(payload.end),   "timeZone": payload.timezone},
    }

    return service.events().update(
        calendarId="primary", eventId=event_id, body=body
    ).execute()

# --------------------------------------------------
# ⑤ DELETE
# --------------------------------------------------
@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    service = build_gcal_service(db, current_user.id)
    service.events().delete(calendarId="primary", eventId=event_id).execute()
