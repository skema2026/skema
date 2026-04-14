from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class Notification(Base):
    """
    사용자 알림.
    type:
      weekly_report  — 주간 수행률 / 미완료 / 다음주 미리보기
      reminder       — 일정 시작 전 / 미완료 재촉
      motivation     — 동기부여 메시지
      comparison     — 사용자 평균 대비 비교
    """
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(30), nullable=False)          # weekly_report | reminder | motivation | comparison
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # 연관 일정 id (reminder 타입에서 사용)
    related_schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True)

    user = relationship("User")
