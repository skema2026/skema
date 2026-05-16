# backend/app/notification/router.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user, get_db
from app.auth.models import User
from app.notification.models import (
    Notification, PushSubscription,
    NotificationResponse, NotificationUnreadCount,
    PushSubscriptionIn, PushKeys,
)
from app.notification import service as push_service

router = APIRouter()


# ── /notifications/* ──────────────────────────────────────────

@router.get("/notifications", response_model=list[NotificationResponse])
def list_notifications(
    skip: int = 0, limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .offset(skip).limit(limit)
        .all()
    )


@router.get("/notifications/unread-count", response_model=NotificationUnreadCount)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)
        .count()
    )
    return {"unread_count": count}


@router.patch("/notifications/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.patch("/notifications/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    db.delete(n)
    db.commit()
    return {"ok": True}


# ── /push/* ───────────────────────────────────────────────────

@router.get("/push/public-key", response_model=PushKeys)
def get_public_key():
    if not push_service.push_enabled():
        raise HTTPException(status_code=503, detail="Push not configured")
    return {"public_key": push_service.public_key()}


@router.post("/push/subscribe")
def upsert_subscription(
    body: PushSubscriptionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(PushSubscription).filter(
        PushSubscription.user_id == current_user.id,
        PushSubscription.endpoint == body.endpoint,
    ).first()
    if sub:
        sub.p256dh     = body.p256dh
        sub.auth       = body.auth
        sub.user_agent = body.user_agent
        sub.fail_count = 0
    else:
        sub = PushSubscription(
            user_id    = current_user.id,
            endpoint   = body.endpoint,
            p256dh     = body.p256dh,
            auth       = body.auth,
            user_agent = body.user_agent,
        )
        db.add(sub)
    db.commit()
    return {"ok": True}


@router.delete("/push/subscribe")
def delete_subscription(
    endpoint: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(PushSubscription).filter(
        PushSubscription.user_id == current_user.id,
        PushSubscription.endpoint == endpoint,
    ).delete()
    db.commit()
    return {"ok": True}


@router.post("/push/test")
async def test_push(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not push_service.push_enabled():
        raise HTTPException(status_code=503, detail="Push not configured")
    await push_service.send_push_to_user(
        db, current_user.id,
        title="테스트 알림",
        body="푸시 알림이 정상 작동합니다.",
    )
    return {"ok": True}