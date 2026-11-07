"""웹 푸시 구독 주소 검사 (11/7).

서버는 구독 주소(endpoint)로 직접 POST를 보낸다. 주소를 아무거나 받으면
http://내부서비스:포트/... 같은 주소를 등록해 서버가 내부망에 요청하게 만들 수 있다(SSRF).
브라우저 푸시 서비스 주소만 허용한다.
"""
from urllib.parse import urlsplit

# 브라우저별 푸시 서비스 (정확히 같은 호스트 또는 그 하위 도메인)
ALLOWED_PUSH_HOSTS: tuple[str, ...] = (
    "fcm.googleapis.com",              # Chrome·Edge(크로미움)·삼성 인터넷·오페라
    "updates.push.services.mozilla.com",  # Firefox
    "push.apple.com",                  # Safari (web.push.apple.com)
    "notify.windows.com",              # 예전 Edge (*.notify.windows.com)
)


def is_allowed_push_endpoint(endpoint: str) -> bool:
    try:
        parts = urlsplit((endpoint or "").strip())
        port = parts.port  # 잘못된 포트면 ValueError
    except ValueError:
        return False
    if parts.scheme != "https" or not parts.hostname:
        return False
    if parts.username or parts.password:
        return False
    if port not in (None, 443):
        return False
    host = parts.hostname.lower().rstrip(".")
    return any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_PUSH_HOSTS)
