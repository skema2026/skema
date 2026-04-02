from sqlalchemy.orm import Session

from app.ai_chat.models import AIChatLog, ChatRole


def get_logs_by_user(db: Session, user_id: int, limit: int = 100) -> list[AIChatLog]:
    """최신 순으로 limit개의 채팅 로그를 반환."""
    return (
        db.query(AIChatLog)
        .filter(AIChatLog.user_id == user_id)
        .order_by(AIChatLog.created_at.desc())
        .limit(limit)
        .all()
    )


def get_log_by_id(db: Session, log_id: int, user_id: int) -> AIChatLog | None:
    return (
        db.query(AIChatLog)
        .filter(AIChatLog.id == log_id, AIChatLog.user_id == user_id)
        .first()
    )


def create_log(db: Session, user_id: int, role: ChatRole, message: str) -> AIChatLog:
    log = AIChatLog(user_id=user_id, role=role, message=message)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def bulk_create_logs(db: Session, user_id: int, entries: list[dict]) -> list[AIChatLog]:
    """대화 한 쌍(user + assistant)을 한 트랜잭션으로 저장."""
    logs = [AIChatLog(user_id=user_id, **entry) for entry in entries]
    db.add_all(logs)
    db.commit()
    for log in logs:
        db.refresh(log)
    return logs


def delete_log(db: Session, log: AIChatLog) -> None:
    db.delete(log)
    db.commit()


def delete_all_logs(db: Session, user_id: int) -> int:
    """유저의 모든 채팅 로그를 삭제하고 삭제 건수를 반환."""
    count = db.query(AIChatLog).filter(AIChatLog.user_id == user_id).delete()
    db.commit()
    return count
