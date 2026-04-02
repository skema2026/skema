import secrets

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.share import repository
from app.share.models import ShareToken
from app.share.schemas import ShareTokenCreate


def list_tokens(db: Session, user_id: int) -> list[ShareToken]:
    return repository.get_tokens_by_user(db, user_id)


def create_token(db: Session, user_id: int, data: ShareTokenCreate) -> ShareToken:
    """
    32바이트 cryptographically secure 토큰을 생성.
    URL-safe base64 인코딩으로 43자 문자열 생성.
    """
    token_str = secrets.token_urlsafe(32)
    return repository.create_token(db, user_id, token_str, data.expires_at)


def get_token_or_404(db: Session, token_id: int, user_id: int) -> ShareToken:
    token = repository.get_token_by_id(db, token_id, user_id)
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="공유 토큰을 찾을 수 없습니다.")
    return token


def deactivate_token(db: Session, token_id: int, user_id: int) -> ShareToken:
    token = get_token_or_404(db, token_id, user_id)
    return repository.deactivate_token(db, token)


def delete_token(db: Session, token_id: int, user_id: int) -> None:
    token = get_token_or_404(db, token_id, user_id)
    repository.delete_token(db, token)


def get_schedules_by_share_token(db: Session, token_str: str):
    """
    공개 공유 링크에서 토큰을 검증하고 해당 유저의 수업 목록을 반환.
    비활성 또는 만료 토큰이면 404.
    """
    from app.schedule.models import Schedule

    share_token = repository.get_active_token(db, token_str)
    if not share_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="유효하지 않거나 만료된 공유 링크입니다.",
        )
    return db.query(Schedule).filter(Schedule.user_id == share_token.user_id).all()
