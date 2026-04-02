from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.database import SessionLocal

# tokenUrl은 실제 로그인 엔드포인트 경로와 일치해야 Swagger UI에서 정상 동작
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


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
    """
    Bearer 토큰을 검증하고 User ORM 객체를 반환.
    - 토큰 만료 / 위변조: 401
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

    # 비활성 계정은 인증 차단
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다. 관리자에게 문의하세요.",
        )

    return user
