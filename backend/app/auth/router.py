import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.models import User
from app.auth.schemas import (
    LoginRequest,
    ProfileCreate,
    ProfileResponse,
    ProfileUpdate,
    SignupRequest,
    TokenResponse,
    UserResponse,
)
from app.auth.service import OAUTH_CONFIGS
from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.core.security import create_access_token

router = APIRouter(tags=["auth"])


# ── 회원가입 / 로그인 ──────────────────────────────────────────────────────────

@router.post("/auth/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(data: SignupRequest, db: Session = Depends(get_db)):
    """이메일 + 비밀번호로 신규 계정을 생성합니다."""
    user = service.signup(db, data)
    return user


@router.post("/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """이메일 + 비밀번호 검증 후 Bearer JWT를 발급합니다."""
    token = service.login(db, data.email, data.password)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/users/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """현재 인증된 사용자 정보를 반환합니다."""
    return current_user


# ── 프로필 ────────────────────────────────────────────────────────────────────

@router.get("/profiles", response_model=ProfileResponse)
def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """현재 유저의 프로필을 반환합니다. 없으면 빈 프로필을 자동 생성합니다."""
    return service.get_or_create_profile(db, current_user.id)


@router.post("/profiles", response_model=ProfileResponse, status_code=status.HTTP_201_CREATED)
def create_profile(
    data: ProfileCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로필을 생성합니다. 이미 존재하면 409를 반환합니다."""
    from app.auth import repository
    if repository.get_profile_by_user_id(db, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 프로필이 존재합니다. PUT /profiles 로 수정하세요.",
        )
    from app.auth.repository import create_profile as repo_create
    return repo_create(db, current_user.id, data.model_dump(exclude_none=True))


@router.put("/profiles", response_model=ProfileResponse)
def update_profile(
    data: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로필을 수정합니다. 없으면 자동 생성합니다."""
    return service.update_profile(db, current_user.id, data.model_dump(exclude_unset=True))


# ── OAuth (소셜 로그인) ───────────────────────────────────────────────────────

@router.get("/auth/{provider}/authorize")
def oauth_authorize(provider: str):
    if provider not in OAUTH_CONFIGS:
        raise HTTPException(status_code=404, detail="지원하지 않는 OAuth 공급자입니다.")

    cfg = OAUTH_CONFIGS[provider]
    client_id = getattr(settings, cfg["client_id_key"])
    if not client_id:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/login?error=oauth_not_configured&provider={provider}"
        )

    backend_base = settings.BACKEND_URL.rstrip("/")
    redirect_uri = f"{backend_base}/auth/{provider}/callback"
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": cfg["scope"],
    }
    if provider == "naver":
        params["state"] = secrets.token_hex(8)

    query = "&".join(f"{k}={v}" for k, v in params.items() if v)
    return RedirectResponse(url=f"{cfg['auth_url']}?{query}")


@router.get("/auth/{provider}/callback")
def oauth_callback(
    provider: str,
    code: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    if provider not in OAUTH_CONFIGS:
        raise HTTPException(status_code=404, detail="지원하지 않는 OAuth 공급자입니다.")

    if error or not code:
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error=oauth_denied")

    try:
        social_id, email, display_name = service.exchange_oauth_code(provider, code)
        user = service.get_or_create_social_user(db, provider, social_id, email, display_name)
        token = create_access_token(user.id)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?token={token}")
    except ValueError as exc:
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error={exc}")
    except Exception:
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error=oauth_failed")
