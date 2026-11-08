"""푸시 구독 주소는 브라우저 푸시 서비스만 (11/7 리뷰 #5, SSRF)."""
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.notification import service
from app.notification.models import PushSubscription
from app.notification.push_hosts import is_allowed_push_endpoint
from app.notification.schemas import PushSubscriptionIn

KEYS = {"p256dh": "k", "auth": "a"}


@pytest.mark.parametrize("url", [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://db5p.notify.windows.com/w/?token=x",
])
def test_browser_push_services_allowed(url):
    assert is_allowed_push_endpoint(url)
    PushSubscriptionIn(endpoint=url, keys=KEYS)


@pytest.mark.parametrize("url", [
    "http://fcm.googleapis.com/fcm/send/abc",          # https 아님
    "https://backend.railway.internal/admin",          # 내부망
    "https://169.254.169.254/latest/meta-data",        # 클라우드 메타데이터
    "https://fcm.googleapis.com.evil.com/x",           # 비슷한 도메인
    "https://evilfcm.googleapis.com.attacker.io/x",
    "https://fcm.googleapis.com:8443/x",               # 다른 포트
    "https://user:pw@fcm.googleapis.com/x",
    "not a url",
])
def test_other_endpoints_rejected(url):
    assert not is_allowed_push_endpoint(url)
    with pytest.raises(ValidationError):
        PushSubscriptionIn(endpoint=url, keys=KEYS)


def test_stored_bad_endpoint_is_not_requested():
    sub = PushSubscription(id=1, user_id=1, endpoint="http://10.0.0.1/x", p256dh="k", auth="a")
    with patch("pywebpush.webpush") as webpush:
        assert service._send_one(sub, "t", "b", "/", "n") is False
    webpush.assert_not_called()
