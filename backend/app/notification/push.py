from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.notification.models import PushSubscription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])


# ── 스키마 ────────────────────────────────────────────────────────────────────

class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=512)
    keys: PushKeys


# ── 서비스 ────────────────────────────────────────────────────────────────────

def push_enabled() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def public_key() -> str:
    return settings.VAPID_PUBLIC_KEY


def send_push_to_user(
    db: Session,
    user_id: int,
    title: str,
    body: str,
    url: str = "/dashboard",
    ntype: str = "notification",
) -> dict:
    if not push_enabled():
        return {"sent": 0, "disabled": True}

    subscriptions = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user_id)
        .all()
    )
    sent = 0
    failed = 0
    for sub in subscriptions:
        ok = _send_one(sub, title, body, url, ntype)
        if ok:
            sub.fail_count = 0
            sub.last_success_at = datetime.now(timezone.utc)
            sent += 1
        else:
            sub.fail_count = (sub.fail_count or 0) + 1
            failed += 1
            if sub.fail_count >= 5:
                db.delete(sub)

    return {"sent": sent, "failed": failed, "disabled": False}


def _send_one(sub: PushSubscription, title: str, body: str, url: str, ntype: str) -> bool:
    try:
        from pywebpush import webpush

        payload = {"title": title, "body": body, "url": url, "type": ntype}
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
        )
        return True
    except Exception as exc:
        logger.warning("Web Push failed for subscription %s: %s", sub.id, exc)
        return False


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.get("/public-key")
def get_public_key():
    return {"enabled": push_enabled(), "publicKey": public_key()}


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
    result = send_push_to_user(
        db,
        current_user.id,
        "SKEMA 알림 테스트",
        "휴대폰 푸시 알림이 정상적으로 연결되었습니다.",
        "/dashboard",
        "test",
    )
    db.commit()
    return result
