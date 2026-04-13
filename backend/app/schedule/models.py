from sqlalchemy import Boolean, Column, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.database import Base


class Schedule(Base):
    """
    일정. 매주 반복되는 수업(date=null)이거나 특정 날짜 이벤트/학습(date=YYYY-MM-DD).

    day_of_week: 0=월 … 6=일 (date가 있으면 자동 계산, 없으면 반복 요일)
    schedule_type: "class" | "event" | "study"
    priority: 0=보통 1=높음 2=긴급
    schedule_source: eta_import | syllabus_based | ai_generated | user_created
    """
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    location = Column(String(200), nullable=True)
    day_of_week = Column(Integer, nullable=False, default=0)   # 0=Mon … 6=Sun
    date = Column(String(10), nullable=True)                    # YYYY-MM-DD (null = 매주 반복)
    start_time = Column(String(5), nullable=False)              # HH:MM
    end_time = Column(String(5), nullable=False)                # HH:MM
    color = Column(String(7), default="#6366F1")                # #RRGGBB
    priority = Column(Integer, default=0)                       # 0 | 1 | 2
    is_completed = Column(Boolean, default=False)
    schedule_type = Column(String(20), default="class")         # class | event | study

    # ── Phase 5: AI 일관성 추적 필드 ────────────────────────────────────────────
    schedule_source = Column(String(30), nullable=True, default="user_created")
    # eta_import | syllabus_based | ai_generated | user_created
    linked_exam_id = Column(Integer, ForeignKey("exam_schedules.id", ondelete="SET NULL"), nullable=True)
    # AI가 어떤 시험을 위해 생성했는지 추적
    user_override = Column(Boolean, default=False)
    # True = 사용자가 AI 생성 일정을 직접 수정 → 재계획 시 건드리지 않음
    deleted_by_user = Column(Boolean, default=False)
    # True = 소프트 삭제 → 목록 조회에서 제외, AI 재생성 방지
    original_generated_title = Column(String(250), nullable=True)
    # AI가 생성한 원본 제목 (이모지 제거 버전) — 재생성 dedup 키

    user = relationship("User", back_populates="schedules")


class ExamSchedule(Base):
    """
    시험 일정. 독립적으로 존재하며 user에 연결됨.
    exam_time: 시험 시작 시간 HH:MM (선택)
    """
    __tablename__ = "exam_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    subject = Column(String(200), nullable=True)      # 과목명 (AI 일정 생성에 사용)
    exam_date = Column(Date, nullable=False)           # YYYY-MM-DD
    exam_time = Column(String(5), nullable=True)       # HH:MM (시험 시작 시간)
    location = Column(String(200), nullable=True)
    # 온보딩 외부 시험 입력용 추가 필드
    source = Column(String(50), nullable=True)         # onboarding_external_exam | syllabus | user_created
    progress_note = Column(Text, nullable=True)        # 현재 어디까지 했는지
    weak_parts = Column(Text, nullable=True)           # 약한 파트

    exam_duration_minutes = Column(Integer, nullable=True, default=120)   # 시험 시간(분), 기본 120분

    user = relationship("User")
