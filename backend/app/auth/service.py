import secrets
import logging

import requests as http_requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth import repository
from app.auth.models import User, UserProfile
from app.auth.schemas import SignupRequest
from app.core.config import settings
from app.core.security import (
    create_access_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger(__name__)

# ── OAuth provider config ─────────────────────────────────────────────────────

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

def signup(db: Session, data: SignupRequest) -> User:
    """이메일 중복 확인 후 신규 계정 생성."""
    if repository.get_user_by_email(db, data.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 이메일입니다.",
        )
    if data.username and repository.get_user_by_username(db, data.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 아이디입니다.",
        )
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
    """
    username 또는 이메일 + 비밀번호 검증 후 JWT 발급.
    비활성 계정도 여기서 차단.
    """
    identifier = email.strip()
    method = "email" if "@" in identifier else "username"
    candidates = repository.get_users_by_username_or_email(db, identifier)
    user = next(
        (
            candidate
            for candidate in candidates
            if candidate.hashed_password and verify_password(password, candidate.hashed_password)
        ),
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
    if user.is_active is False:  # None treated as active (legacy rows)
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다.",
        )
    _record_login_attempt(
        db,
        user_id=user.id,
        identifier=identifier,
        method=method,
        success=True,
        ip_address=ip_address,
        user_agent=user_agent,
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
    return repository.update_profile(db, profile, updates)


# ── OAuth ─────────────────────────────────────────────────────────────────────

def exchange_oauth_code(provider: str, code: str, state: str = "") -> tuple[str, str, str, str | None, str | None]:
    """
    Authorization code를 교환해 (social_id, email, display_name, kakao_access_token, kakao_refresh_token) 반환.
    Kakao 이외 공급자의 마지막 두 값은 None.
    실패 시 ValueError 발생.
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

    import logging
    logger = logging.getLogger(__name__)

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

    if provider == "google":
        social_id = userinfo.get("id", "")
        email = userinfo.get("email", "")
        display_name = userinfo.get("name", "")
    elif provider == "naver":
        resp = userinfo.get("response", {})
        social_id = resp.get("id", "")
        email = resp.get("email", "")
        display_name = resp.get("nickname", resp.get("name", ""))
    elif provider == "kakao":
        social_id = str(userinfo.get("id", ""))
        kakao_account = userinfo.get("kakao_account", {})
        email = kakao_account.get("email", "")
        display_name = userinfo.get("properties", {}).get("nickname", "")
        kakao_access_token = access_token
        kakao_refresh_token = token_data.get("refresh_token")
    else:
        raise ValueError("unsupported_provider")

    if not social_id:
        raise ValueError("userinfo_failed")

    return social_id, email, display_name, kakao_access_token, kakao_refresh_token


def get_or_create_social_user(
    db: Session,
    provider: str,
    social_id: str,
    email: str,
    display_name: str,
) -> User:
    """소셜 계정으로 유저를 찾거나 새로 생성."""
    user = repository.get_user_by_social(db, provider, social_id)
    if user:
        return user

    if email:
        user = repository.get_user_by_email(db, email)
        if user:
            return repository.link_social(db, user, provider, social_id)

    fallback_email = email or f"{provider}_{social_id}@social.skema"
    return repository.create_social_user(
        db,
        email=fallback_email,
        provider=provider,
        social_id=social_id,
        hashed_password=hash_password(secrets.token_hex(32)),
    )
