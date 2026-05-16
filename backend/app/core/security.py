"""인증/보안 유틸리티 + FastAPI 의존성 주입.

보안 함수:
  hash_password / verify_password  — bcrypt 비밀번호 해시
  create_access_token              — JWT 발급 (sub = user_id)
  decode_access_token              — JWT 검증 → user_id 반환

FastAPI 의존성:
  get_db              — 요청마다 DB 세션을 열고 종료 시 닫는다
  get_current_user    — Bearer 토큰 검증 → User ORM 반환 (401/403)
  is_admin_email      — 이메일이 관리자 목록에 있는지 확인
  get_current_admin_user — 관리자 전용 엔드포인트 보호
"""
from datetime import datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import SessionLocal

# tokenUrl은 Swagger UI 로그인 버튼이 호출하는 엔드포인트 경로
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ── 비밀번호 해시 ──────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(user_id: int) -> str:
    """JWT 발급. sub = str(user_id)."""
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> int | None:
    """JWT 디코드. 유효하면 user_id(int) 반환, 실패하면 None."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub: str | None = payload.get("sub")
        if sub is None:
            return None
        return int(sub)
    except (JWTError, ValueError):
        return None


# ── FastAPI 의존성 ─────────────────────────────────────────────────────────────

def get_db():
    """요청마다 새 DB 세션을 열고, 요청 종료 시 자동으로 닫는다."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """Bearer 토큰을 검증하고 User ORM 객체를 반환.
    - 토큰 만료/위변조: 401
    - 계정 비활성화: 403
    """
    from app.auth.models import User  # 순환 임포트 방지

    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보를 확인할 수 없습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_exc

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exc

    # None은 활성으로 간주 — 레거시 계정 호환
    if user.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다. 관리자에게 문의하세요.",
        )

    return user


def is_admin_email(email: str | None) -> bool:
    if not email:
        return False
    admin_emails = {
        item.strip().lower()
        for item in settings.ADMIN_EMAILS.split(",")
        if item.strip()
    }
    return email.lower() in admin_emails


def get_current_admin_user(current_user=Depends(get_current_user)):
    if not is_admin_email(current_user.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다.",
        )
    return current_user
