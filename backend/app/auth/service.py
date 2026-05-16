"""auth 비즈니스 로직 + DB 쿼리.

흐름:
  회원가입  — signup()           : 중복 확인 → User 생성
  로그인    — login()            : 비밀번호 검증 → JWT 발급 → 로그인 로그 기록
  소셜 로그인 — exchange_oauth_code() → get_or_create_social_user()
  프로필    — get_or_create_profile() / update_profile()
"""
import logging
import secrets

import requests as http_requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth.models import LoginLog, SignupRequest, User, UserProfile
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password

logger = logging.getLogger(__name__)


# ── OAuth provider 설정 ───────────────────────────────────────────────────────

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


# ── DB 쿼리 ───────────────────────────────────────────────────────────────────

def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_users_by_username_or_email(db: Session, identifier: str) -> list[User]:
    """로그인 후보 유저 목록. 이메일 형태면 이메일만, 아니면 username만 조회."""
    identifier = identifier.strip()
    if "@" in identifier:
        return db.query(User).filter(User.email == identifier).all()
    return db.query(User).filter(User.username == identifier).order_by(User.id.desc()).all()


def get_user_by_social(db: Session, provider: str, social_id: str) -> User | None:
    return db.query(User).filter(
        User.social_provider == provider,
        User.social_id == social_id,
    ).first()


def create_user(db: Session, email: str, hashed_password: str) -> User:
    user = User(email=email, hashed_password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_social_user(
    db: Session,
    email: str,
    provider: str,
    social_id: str,
    hashed_password: str,
    kakao_access_token: str | None = None,
    kakao_refresh_token: str | None = None,
) -> User:
    user = User(
        email=email,
        hashed_password=hashed_password,
        social_provider=provider,
        social_id=social_id,
        kakao_access_token=kakao_access_token,
        kakao_refresh_token=kakao_refresh_token,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def link_social(db: Session, user: User, provider: str, social_id: str) -> User:
    user.social_provider = provider
    user.social_id = social_id
    db.commit()
    db.refresh(user)
    return user


def update_kakao_tokens(
    db: Session, user: User, access_token: str, refresh_token: str | None
) -> User:
    user.kakao_access_token = access_token
    if refresh_token:
        user.kakao_refresh_token = refresh_token
    db.commit()
    db.refresh(user)
    return user


def create_login_log(
    db: Session,
    *,
    user_id: int | None,
    login_identifier: str,
    login_method: str,
    success: bool,
    failure_reason: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> LoginLog:
    log = LoginLog(
        user_id=user_id,
        login_identifier=login_identifier[:255],
        login_method=login_method,
        success=success,
        failure_reason=failure_reason,
        ip_address=ip_address[:64] if ip_address else None,
        user_agent=user_agent[:512] if user_agent else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def list_login_logs(db: Session, limit: int = 100, offset: int = 0) -> list[LoginLog]:
    return (
        db.query(LoginLog)
        .outerjoin(User)
        .order_by(LoginLog.created_at.desc(), LoginLog.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def list_users(db: Session, limit: int = 100, offset: int = 0) -> list[User]:
    return (
        db.query(User)
        .order_by(User.created_at.desc(), User.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def deactivate_user(db: Session, user: User) -> User:
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    db.query(LoginLog).filter(LoginLog.user_id == user.id).update(
        {LoginLog.user_id: None},
        synchronize_session=False,
    )
    db.delete(user)
    db.commit()


def get_profile_by_user_id(db: Session, user_id: int) -> UserProfile | None:
    return db.query(UserProfile).filter(UserProfile.user_id == user_id).first()


def create_profile(db: Session, user_id: int, data: dict) -> UserProfile:
    profile = UserProfile(user_id=user_id, **data)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def _update_profile_record(db: Session, profile: UserProfile, updates: dict) -> UserProfile:
    for field, value in updates.items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


# ── 회원가입 / 로그인 ──────────────────────────────────────────────────────────

def signup(db: Session, data: SignupRequest) -> User:
    """이메일 중복 확인 후 신규 계정 생성."""
    if get_user_by_email(db, data.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 이메일입니다.",
        )
    if data.username and get_user_by_username(db, data.username):
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
        create_login_log(
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
    """username 또는 이메일 + 비밀번호 검증 후 JWT 발급. 비활성 계정도 여기서 차단."""
    identifier = email.strip()
    method = "email" if "@" in identifier else "username"
    candidates = get_users_by_username_or_email(db, identifier)
    user = next(
        (
            c for c in candidates
            if c.hashed_password and verify_password(password, c.hashed_password)
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
    if user.is_active is False:  # None은 활성으로 취급 (레거시 row)
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
    profile = get_profile_by_user_id(db, user_id)
    if not profile:
        profile = create_profile(db, user_id, {})
    return profile


def update_profile(db: Session, user_id: int, updates: dict) -> UserProfile:
    profile = get_or_create_profile(db, user_id)
    return _update_profile_record(db, profile, updates)


# ── OAuth (소셜 로그인) ───────────────────────────────────────────────────────

def exchange_oauth_code(
    provider: str, code: str, state: str = ""
) -> tuple[str, str, str, str | None, str | None]:
    """Authorization code를 교환해 (social_id, email, display_name, kakao_access_token, kakao_refresh_token) 반환.
    Kakao 이외 공급자의 마지막 두 값은 None. 실패 시 ValueError 발생.
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
    kakao_access_token: str | None = None,
    kakao_refresh_token: str | None = None,
) -> User:
    """소셜 계정으로 유저를 찾거나 새로 생성. Kakao는 토큰도 저장."""
    user = get_user_by_social(db, provider, social_id)
    if user:
        if kakao_access_token:
            update_kakao_tokens(db, user, kakao_access_token, kakao_refresh_token)
        return user

    if email:
        user = get_user_by_email(db, email)
        if user:
            user = link_social(db, user, provider, social_id)
            if kakao_access_token:
                update_kakao_tokens(db, user, kakao_access_token, kakao_refresh_token)
            return user

    fallback_email = email or f"{provider}_{social_id}@social.skema"
    return create_social_user(
        db,
        email=fallback_email,
        provider=provider,
        social_id=social_id,
        hashed_password=hash_password(secrets.token_hex(32)),
        kakao_access_token=kakao_access_token,
        kakao_refresh_token=kakao_refresh_token,
    )
