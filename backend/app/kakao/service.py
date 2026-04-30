"""
카카오톡 "나에게 보내기" 서비스

Kakao REST API: POST https://kapi.kakao.com/v2/api/talk/memo/default/send
필요 scope: talk_message (로그인 시 부여됨)
"""
import requests as http_requests
from app.auth.models import User
from sqlalchemy.orm import Session


KAKAO_MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"


def send_kakao_memo(db: Session, user: User, text: str) -> dict:
    """
    카카오톡 나에게 보내기.
    반환: {"success": bool, "error": str | None}
    """
    access_token = getattr(user, "kakao_access_token", None)
    if not access_token:
        return {"success": False, "error": "kakao_not_connected"}

    template = {
        "object_type": "text",
        "text": text,
        "link": {
            "web_url": "http://localhost:3000",
            "mobile_web_url": "http://localhost:3000",
        },
    }

    def _post(token: str) -> http_requests.Response:
        import json
        return http_requests.post(
            KAKAO_MEMO_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"template_object": json.dumps(template, ensure_ascii=False)},
            timeout=10,
        )

    resp = _post(access_token)

    if resp.status_code == 200 and resp.json().get("result_code") == 0:
        return {"success": True, "error": None}

    return {"success": False, "error": resp.json().get("msg", f"http_{resp.status_code}")}


def get_kakao_status(user: User) -> dict:
    """카카오 연동 상태 확인."""
    return {
        "connected": bool(getattr(user, "kakao_access_token", None)),
        "provider": user.social_provider,
    }
