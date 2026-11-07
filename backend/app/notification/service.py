# backend/app/notification/service.py
# Web Push 발송 로직 (VAPID / pywebpush)
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.notification.models import PushSubscription
from app.notification.push_hosts import is_allowed_push_endpoint

logger = logging.getLogger(__name__)


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


def _send_one(
    sub: PushSubscription,
    title: str,
    body: str,
    url: str,
    ntype: str,
) -> bool:
    # 11/7: 검사 도입 전에 저장된 구독도 있으므로 보내기 직전에도 확인한다 (실패로 세어 정리되게)
    if not is_allowed_push_endpoint(sub.endpoint):
        logger.warning("Web Push skipped: endpoint not allowed for subscription %s", sub.id)
        return False
    try:
        from pywebpush import webpush

        payload = {
            "title": title,
            "body": body,
            "url": url,
            "type": ntype,
        }
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {
                    "p256dh": sub.p256dh,
                    "auth": sub.auth,
                },
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
        )
        return True
    except Exception as exc:
        logger.warning("Web Push failed for subscription %s: %s", sub.id, exc)
        return False
