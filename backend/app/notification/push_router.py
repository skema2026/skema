from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.deps import get_current_user, get_db
from app.notification.models import PushSubscription
from app.notification import push_service

router = APIRouter(prefix="/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=512)
    keys: PushKeys


@router.get("/public-key")
def get_public_key():
    return {
        "enabled": push_service.push_enabled(),
        "publicKey": push_service.public_key(),
    }


@router.post("/subscriptions")
def upsert_subscription(
    body: PushSubscriptionIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == body.endpoint)
        .first()
    )
    user_agent = request.headers.get("user-agent", "")[:512]
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


@router.delete("/subscriptions")
def delete_subscription(
    endpoint: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == current_user.id,
            PushSubscription.endpoint == endpoint,
        )
        .first()
    )
    if sub:
        db.delete(sub)
        db.commit()
    return {"ok": True}


@router.post("/test")
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
