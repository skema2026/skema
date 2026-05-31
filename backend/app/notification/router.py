from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.security import get_current_user, get_db
from app.auth.models import User
from app.notification.models import Notification, PushSubscription
from app.notification.schemas import NotificationResponse, NotificationUnreadCount, PushSubscriptionIn
from app.notification import service as push_service

router = APIRouter()


# ── /notifications/* ──────────────────────────────────────────

def _get_notification_or_404(db: Session, notification_id: int, user_id: int) -> Notification:
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다.")
    return n


@router.get("/notifications", response_model=list[NotificationResponse])
def list_notifications(
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/notifications/unread-count", response_model=NotificationUnreadCount)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    return {"unread": count}


@router.patch("/notifications/{notification_id}/read", response_model=NotificationResponse)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = _get_notification_or_404(db, notification_id, current_user.id)
    n.is_read = True
    db.commit()
    db.refresh(n)
    return n


@router.patch("/notifications/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.delete("/notifications/{notification_id}", status_code=204)
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = _get_notification_or_404(db, notification_id, current_user.id)
    db.delete(n)
    db.commit()


# ── /notifications/prefs ─────────────────────────────────────

DEFAULT_NOTIF_PREFS = {
    "reminder_start": True,
    "reminder_incomplete": True,
    "reminder_minutes": 30,
    "exam_alert": True,
    "motivation": True,
    "weekly_report": True,
    "comparison": False,
}


@router.get("/notifications/prefs")
def get_notif_prefs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import json
    from app.auth.models import UserProfile
    profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
    if not profile or not profile.notification_prefs:
        return DEFAULT_NOTIF_PREFS
    try:
        # 누락 키는 기본값으로 채워 반환
        return {**DEFAULT_NOTIF_PREFS, **json.loads(profile.notification_prefs)}
    except (json.JSONDecodeError, TypeError):
        return DEFAULT_NOTIF_PREFS


@router.put("/notifications/prefs")
def update_notif_prefs(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import json
    from app.auth.models import UserProfile
    profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="프로필이 없습니다.")
    profile.notification_prefs = json.dumps(body)
    db.commit()
    return {"ok": True}


# ── /push/* ───────────────────────────────────────────────────

@router.get("/push/public-key")
def get_public_key():
    return {
        "enabled": push_service.push_enabled(),
        "publicKey": push_service.public_key(),
    }


@router.post("/push/subscriptions")
def upsert_subscription(
    body: PushSubscriptionIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_agent = request.headers.get("user-agent", "")[:512]
    sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
    ).first()
    if sub:
        sub.user_id = current_user.id
        sub.p256dh = body.keys.p256dh
        sub.auth = body.keys.auth
        sub.user_agent = user_agent
        sub.fail_count = 0
    else:
        sub = PushSubscription(
            user_id=current_user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
            user_agent=user_agent,
        )
        db.add(sub)
    db.commit()
    return {"ok": True}


@router.delete("/push/subscriptions")
def delete_subscription(
    endpoint: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(PushSubscription).filter(
        PushSubscription.user_id == current_user.id,
        PushSubscription.endpoint == endpoint,
    ).first()
    if sub:
        db.delete(sub)
        db.commit()
    return {"ok": True}


@router.post("/push/test")
def send_test_push(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = push_service.send_push_to_user(
        db,
        current_user.id,
        "SKEMA 알림 테스트",
        "휴대폰 푸시 알림이 정상적으로 연결되었습니다.",
        "/dashboard",
        "test",
    )
    db.commit()
    return result
