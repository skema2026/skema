from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.share.models import ShareToken


def get_tokens_by_user(db: Session, user_id: int) -> list[ShareToken]:
    return db.query(ShareToken).filter(ShareToken.user_id == user_id).all()


def get_token_by_id(db: Session, token_id: int, user_id: int) -> ShareToken | None:
    return (
        db.query(ShareToken)
        .filter(ShareToken.id == token_id, ShareToken.user_id == user_id)
        .first()
    )


def get_active_token(db: Session, token_str: str) -> ShareToken | None:
    """공개 공유 링크 접근용: 활성 + 미만료 토큰 조회."""
    now = datetime.now(timezone.utc)
    return (
        db.query(ShareToken)
        .filter(
            ShareToken.token == token_str,
            ShareToken.is_active == True,
            (ShareToken.expires_at == None) | (ShareToken.expires_at > now),
        )
        .first()
    )


def create_token(db: Session, user_id: int, token_str: str, expires_at: datetime | None) -> ShareToken:
    share_token = ShareToken(user_id=user_id, token=token_str, expires_at=expires_at)
    db.add(share_token)
    db.commit()
    db.refresh(share_token)
    return share_token


def deactivate_token(db: Session, token: ShareToken) -> ShareToken:
    token.is_active = False
    db.commit()
    db.refresh(token)
    return token


def delete_token(db: Session, token: ShareToken) -> None:
    db.delete(token)
    db.commit()
