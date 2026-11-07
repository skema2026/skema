import logging
import secrets

import requests as http_requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth import repository
from app.auth.models import User, UserProfile
from app.auth.schemas import SignupRequest
from app.core.config import settings
from app.core.security import create_access_token, hash_password, is_admin_email, verify_password

logger = logging.getLogger(__name__)


OAUTH_CONFIGS = {
    "google": {
        "client_id_key": "GOOGLE_CLIENT_ID",
        "client_secret_key": "GOOGLE_CLIENT_SECRET",
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
        "scope": "openid email profile",
    },
    "naver": {
        "client_id_key": "NAVER_CLIENT_ID",
        "client_secret_key": "NAVER_CLIENT_SECRET",
        "auth_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "userinfo_url": "https://openapi.naver.com/v1/nid/me",
        "scope": "name email",
    },
    "kakao": {
        "client_id_key": "KAKAO_CLIENT_ID",
        "client_secret_key": "KAKAO_CLIENT_SECRET",
        "auth_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "userinfo_url": "https://kapi.kakao.com/v2/user/me",
        "scope": "profile_nickname talk_message",
    },
}


# ── 회원가입 / 로그인 ──────────────────────────────────────────────────────────

def _reject_reserved_admin_email(db: Session, email: str | None, current_user_id: int | None = None) -> None:
    """관리자 목록(ADMIN_EMAILS)에 있는 이메일은 가입·이메일 변경으로 가져갈 수 없다 (11/7).

    관리자는 이메일 문자열로 판정하는데 이메일 인증이 없어서, 아직 가입되지 않은 관리자 주소로
    가입하거나 내 이메일을 그 주소로 바꾸면 관리자 권한을 얻을 수 있었다.
    이미 그 주소를 쓰는 본인 계정의 수정은 막지 않는다.
    """
    if not is_admin_email(email):
        return
    owner = repository.get_user_by_email(db, email)
    if owner is not None and owner.id == current_user_id:
        return
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="사용할 수 없는 이메일입니다.")


def signup(db: Session, data: SignupRequest) -> User:
    _reject_reserved_admin_email(db, data.email)
    if repository.get_user_by_email(db, data.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 이메일입니다.")
    if data.username and repository.get_user_by_username(db, data.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디입니다.")
    user = User(
        email=data.email,
        username=data.username,
        hashed_password=hash_password(data.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _record_login_attempt(
    db: Session,
    *,
    user_id: int | None,
    identifier: str,
    method: str,
    success: bool,
    failure_reason: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    try:
        repository.create_login_log(
            db,
            user_id=user_id,
            login_identifier=identifier,
            login_method=method,
            success=success,
            failure_reason=failure_reason,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except Exception:
        db.rollback()
        logger.exception("failed to write login log")


def login(
    db: Session,
    email: str,
    password: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> str:
    identifier = email.strip()
    method = "email" if "@" in identifier else "username"
    candidates = repository.get_users_by_username_or_email(db, identifier)
    user = next(
        (c for c in candidates if c.hashed_password and verify_password(password, c.hashed_password)),
        None,
    )
    if not user:
        _record_login_attempt(
            db,
            user_id=candidates[0].id if len(candidates) == 1 else None,
            identifier=identifier,
            method=method,
            success=False,
            failure_reason="invalid_credentials",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다.",
        )
    if user.is_active is False:
        _record_login_attempt(
            db,
            user_id=user.id,
            identifier=identifier,
            method=method,
            success=False,
            failure_reason="inactive_user",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다.")
    _record_login_attempt(
        db, user_id=user.id, identifier=identifier, method=method, success=True,
        ip_address=ip_address, user_agent=user_agent,
    )
    return create_access_token(user.id)


# ── 프로필 ────────────────────────────────────────────────────────────────────

def get_or_create_profile(db: Session, user_id: int) -> UserProfile:
    profile = repository.get_profile_by_user_id(db, user_id)
    if not profile:
        profile = repository.create_profile(db, user_id, {})
    return profile


def update_profile(db: Session, user_id: int, updates: dict) -> UserProfile:
    profile = get_or_create_profile(db, user_id)
    return repository.update_profile_record(db, profile, updates)


def update_user_account(db: Session, user: User, updates: dict) -> User:
    email = updates.get("email")
    if email and email != user.email:
        _reject_reserved_admin_email(db, email, current_user_id=user.id)
        existing = repository.get_user_by_email(db, email)
        if existing and existing.id != user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 이메일입니다.")

    username = updates.get("username")
    if username and username != user.username:
        existing = repository.get_user_by_username(db, username)
        if existing and existing.id != user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 이름입니다.")

    return repository.update_user_record(db, user, updates)


# ── OAuth (소셜 로그인) ───────────────────────────────────────────────────────

class SocialEmailExists(Exception):
    """소셜 로그인 이메일이 이미 다른 방식으로 가입된 계정의 이메일과 같다 (자동 연결하지 않음)."""


def exchange_oauth_code(
    provider: str, code: str, state: str = ""
) -> tuple[str, str, str, str | None, str | None, bool]:
    """반환: (social_id, email, display_name, kakao_access_token, kakao_refresh_token, email_verified)

    email_verified: 공급자가 '이 이메일은 본인 확인됨'이라고 알려 준 경우만 True.
    네이버는 확인 여부를 주지 않으므로 False로 본다.
    """
    cfg = OAUTH_CONFIGS[provider]
    client_id = getattr(settings, cfg["client_id_key"])
    client_secret = getattr(settings, cfg["client_secret_key"])
    redirect_uri = f"{settings.BACKEND_URL}/auth/{provider}/callback"

    token_data_req: dict = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
    }
    if provider == "naver" and state:
        token_data_req["state"] = state
    if client_secret:
        token_data_req["client_secret"] = client_secret

    token_resp = http_requests.post(
        cfg["token_url"],
        data=token_data_req,
        headers={"Accept": "application/json"},
        timeout=10,
    )
    logger.info("OAuth token provider=%s status=%s", provider, token_resp.status_code)

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise ValueError("token_exchange_failed")

    userinfo = http_requests.get(
        cfg["userinfo_url"],
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    ).json()

    kakao_access_token: str | None = None
    kakao_refresh_token: str | None = None

    email_verified = False
    if provider == "google":
        social_id = userinfo.get("id", "")
        email = userinfo.get("email", "")
        display_name = userinfo.get("name", "")
        email_verified = bool(userinfo.get("verified_email") or userinfo.get("email_verified"))
    elif provider == "naver":
        resp = userinfo.get("response", {})
        social_id = resp.get("id", "")
        email = resp.get("email", "")
        display_name = resp.get("nickname", resp.get("name", ""))
    elif provider == "kakao":
        social_id = str(userinfo.get("id", ""))
        kakao_account = userinfo.get("kakao_account", {})
        email = kakao_account.get("email", "")
        email_verified = bool(kakao_account.get("is_email_verified") and kakao_account.get("is_email_valid", True))
        display_name = userinfo.get("properties", {}).get("nickname", "")
        kakao_access_token = access_token
        kakao_refresh_token = token_data.get("refresh_token")
    else:
        raise ValueError("unsupported_provider")

    if not social_id:
        raise ValueError("userinfo_failed")

    return social_id, email, display_name, kakao_access_token, kakao_refresh_token, email_verified


def get_or_create_social_user(
    db: Session,
    provider: str,
    social_id: str,
    email: str,
    display_name: str,
    kakao_access_token: str | None = None,
    kakao_refresh_token: str | None = None,
    email_verified: bool = False,
) -> User:
    user = repository.get_user_by_social(db, provider, social_id)
    if user:
        if kakao_access_token:
            repository.update_kakao_tokens(db, user, kakao_access_token, kakao_refresh_token)
        return user

    # 11/7: 같은 이메일의 기존 계정에 자동으로 연결하지 않는다.
    # 가입·이메일 변경에 이메일 인증이 없어서, 남의 이메일로 먼저 가입해 두면 그 사람이 나중에
    # 소셜 로그인할 때 공격자 계정에 연결되어 공격자가 비밀번호로 계속 들어올 수 있었다(계정 선점).
    if email and repository.get_user_by_email(db, email):
        raise SocialEmailExists(email)

    # 공급자가 확인하지 않은 이메일이 관리자 주소면 쓰지 않는다 (관리자 권한 탈취 방지)
    if email and is_admin_email(email) and not email_verified:
        email = ""

    fallback_email = email or f"{provider}_{social_id}@social.skema"
    # display_name을 username 후보로 사용하되 중복이면 소셜 ID 뒤 8자 추가
    candidate = display_name.strip() if display_name else None
    if candidate:
        if repository.get_user_by_username(db, candidate):
            candidate = f"{candidate}_{social_id[:8]}"
        if repository.get_user_by_username(db, candidate):
            candidate = None  # 그래도 충돌하면 None으로
    return repository.create_social_user(
        db,
        email=fallback_email,
        username=candidate,
        provider=provider,
        social_id=social_id,
        hashed_password=hash_password(secrets.token_hex(32)),
        kakao_access_token=kakao_access_token,
        kakao_refresh_token=kakao_refresh_token,
    )
