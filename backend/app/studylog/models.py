import secrets
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.database import Base


def _invite_code() -> str:
    return secrets.token_urlsafe(6).upper()[:8]


class StudyGroup(Base):
    __tablename__ = "study_groups"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False)
    description = Column(String(300), nullable=True)
    invite_code = Column(String(16), nullable=False, unique=True, default=_invite_code)
    created_by  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)

    members = relationship("StudyGroupMember", back_populates="group", cascade="all, delete-orphan")
    logs    = relationship("StudyLog", back_populates="group")


class StudyGroupMember(Base):
    __tablename__ = "study_group_members"

    id        = Column(Integer, primary_key=True, index=True)
    group_id  = Column(Integer, ForeignKey("study_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id   = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    group = relationship("StudyGroup", back_populates="members")
    user  = relationship("User")

    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_member"),
    )


class StudyLog(Base):
    __tablename__ = "study_logs"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id    = Column(Integer, ForeignKey("study_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True, index=True)
    photo_path  = Column(String(512), nullable=True)
    caption     = Column(String(200), nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)

    user    = relationship("User", backref="study_logs")
    group   = relationship("StudyGroup", back_populates="logs")
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
