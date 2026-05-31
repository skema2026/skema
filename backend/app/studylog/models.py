from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.database import Base


class StudyLog(Base):
    __tablename__ = "study_logs"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True, index=True)
    photo_path = Column(String(512), nullable=False)
    caption    = Column(String(200), nullable=True)
    is_public  = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user      = relationship("User", backref="study_logs")
    reactions = relationship("StudyLogReaction", back_populates="log", cascade="all, delete-orphan")


class StudyLogReaction(Base):
    __tablename__ = "study_log_reactions"

    id         = Column(Integer, primary_key=True, index=True)
    log_id     = Column(Integer, ForeignKey("study_logs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    emoji      = Column(String(10), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    log  = relationship("StudyLog", back_populates="reactions")

    __table_args__ = (
        # 같은 사용자가 같은 로그에 같은 이모지 중복 방지
        UniqueConstraint("log_id", "user_id", "emoji", name="uq_reaction_per_user_emoji"),
    )
