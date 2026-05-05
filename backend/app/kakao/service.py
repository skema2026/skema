"""
카카오톡 "나에게 보내기" 서비스

Kakao REST API: POST https://kapi.kakao.com/v2/api/talk/memo/default/send
필요 scope: talk_message (로그인 시 부여됨)
"""
import requests as http_requests
from app.auth.models import User
from app.auth import repository
from app.core.config import settings
from sqlalchemy.orm import Session


KAKAO_MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"


def _refresh_kakao_token(db: Session, user: User) -> str | None:
    """카카오 access_token이 만료됐을 때 refresh_token으로 재발급."""
    from app.core.config import settings
    if not user.kakao_refresh_token:
        return None

    resp = http_requests.post(
        KAKAO_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "client_id": settings.KAKAO_CLIENT_ID,
            "refresh_token": user.kakao_refresh_token,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    data = resp.json()
    new_access = data.get("access_token")
    new_refresh = data.get("refresh_token")
    if not new_access:
        return None

    repository.update_kakao_tokens(db, user, new_access, new_refresh or user.kakao_refresh_token)
    return new_access


def send_kakao_memo(db: Session, user: User, text: str) -> dict:
    """
    카카오톡 나에게 보내기.
    반환: {"success": bool, "error": str | None}
    """
    if not user.kakao_access_token:
        return {"success": False, "error": "kakao_not_connected"}

    template = {
        "object_type": "text",
        "text": text,
        "link": {
            "web_url": settings.FRONTEND_URL,
            "mobile_web_url": settings.FRONTEND_URL,
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

    resp = _post(user.kakao_access_token)

    # 401 → try token refresh once
    if resp.status_code == 401:
        new_token = _refresh_kakao_token(db, user)
        if new_token:
            resp = _post(new_token)

    if resp.status_code == 200 and resp.json().get("result_code") == 0:
        return {"success": True, "error": None}

    return {"success": False, "error": resp.json().get("msg", f"http_{resp.status_code}")}


def get_kakao_status(user: User) -> dict:
    """카카오 연동 상태 확인."""
    return {
        "connected": bool(user.kakao_access_token),
        "provider": user.social_provider,
    }


def build_schedule_summary(db: Session, user_id: int) -> str:
    """오늘 수업 목록을 카카오톡 발송용 텍스트로 조합."""
    from datetime import date
    from app.schedule.models import Schedule, INT_TO_DAY

    today = date.today()
    today_str = today.isoformat()
    today_day = INT_TO_DAY.get(today.weekday(), "MON")

    # 반복 수업 + 오늘 날짜 지정 수업 합산
    recurring = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user_id,
            Schedule.recurring_day == today_day,
            Schedule.date.is_(None),
            Schedule.deleted_by_user.is_not(True),
        )
        .all()
    )
    specific = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user_id,
            Schedule.date == today_str,
            Schedule.deleted_by_user.is_not(True),
        )
        .all()
    )
    schedules = sorted(recurring + specific, key=lambda s: s.start_time)

    if not schedules:
        return f"📅 {today.strftime('%Y년 %m월 %d일')} 오늘 일정이 없습니다. 여유로운 하루 보내세요!"

    lines = [f"📅 {today.strftime('%Y년 %m월 %d일')} 오늘 일정 ({len(schedules)}개)\n"]
    for s in schedules:
        lines.append(f"📚 {s.start_time}–{s.end_time} {s.course_name}")
    return "\n".join(lines)
