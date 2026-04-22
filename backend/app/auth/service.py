import re
import secrets

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
        "scope": "profile_nickname account_email",
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
    return repository.create_user(db, data.email, hash_password(data.password))


def login(db: Session, email: str, password: str) -> str:
    """
    이메일 + 비밀번호 검증 후 JWT 발급.
    비활성 계정도 여기서 차단 (deps.py의 get_current_user와 이중 방어).
    """
    user = repository.get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다.",
        )
    if not user.hashed_password or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다.",
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

def exchange_oauth_code(provider: str, code: str) -> tuple[str, str, str]:
    """
    Authorization code를 교환해 (social_id, email, display_name) 반환.
    실패 시 ValueError 발생.
    """
    cfg = OAUTH_CONFIGS[provider]
    client_id = getattr(settings, cfg["client_id_key"])
    client_secret = getattr(settings, cfg["client_secret_key"])
    backend_base = settings.BACKEND_URL.rstrip("/")
    redirect_uri = f"{backend_base}/auth/{provider}/callback"

    token_resp = http_requests.post(
        cfg["token_url"],
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"Accept": "application/json"},
        timeout=10,
    )
    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise ValueError("token_exchange_failed")

    userinfo = http_requests.get(
        cfg["userinfo_url"],
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    ).json()

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
    else:
        raise ValueError("unsupported_provider")

    if not social_id:
        raise ValueError("userinfo_failed")

    return social_id, email, display_name


def get_or_create_social_user(
    db: Session, provider: str, social_id: str, email: str, display_name: str
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
