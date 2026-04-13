from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class Syllabus(Base):
    """강의계획서 파일 메타데이터."""
    __tablename__ = "syllabi"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_name = Column(String(200), nullable=False)
    original_filename = Column(String(500), nullable=False)
    stored_filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    source = Column(String(50), nullable=True, default="syllabus_upload")  # syllabus_upload | onboarding
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", backref="syllabi")
    analysis = relationship("SyllabusAnalysis", back_populates="syllabus", uselist=False, cascade="all, delete-orphan")


class SyllabusAnalysis(Base):
    """강의계획서 AI 분석 결과."""
    __tablename__ = "syllabus_analyses"

    id = Column(Integer, primary_key=True, index=True)
    syllabus_id = Column(Integer, ForeignKey("syllabi.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_name = Column(String(200), nullable=False)

    # 평가 비율 (0~100, 합계가 100이 아닐 수 있음 — 부분 추출)
    midterm_weight = Column(Integer, nullable=True)
    final_weight = Column(Integer, nullable=True)
    assignment_weight = Column(Integer, nullable=True)
    attendance_weight = Column(Integer, nullable=True)
    presentation_weight = Column(Integer, nullable=True)

    has_presentation = Column(Boolean, nullable=True)

    # 시험 주차 (날짜 미상 시 week→date 변환에 사용)
    midterm_week = Column(Integer, nullable=True)   # 중간고사 주차 (1-16)
    final_week = Column(Integer, nullable=True)     # 기말고사 주차 (1-16)

    # JSON 배열 (Text로 저장 — SQLite 호환)
    weekly_topics = Column(Text, nullable=True)    # JSON: [{week, topic, subtopics, difficulty, keywords}]
    exam_dates = Column(Text, nullable=True)        # JSON: [{"date": "2026-04-15", "type": "midterm"}]
    assignment_dates = Column(Text, nullable=True)  # JSON: [{"date": "2026-05-01", "title": "과제1"}]
    important_factors = Column(Text, nullable=True) # JSON: ["출석 중요", "팀프로젝트 있음"]
    study_mapping = Column(Text, nullable=True)     # JSON: {"midterm_scope_weeks": [...], "final_scope_weeks": [...]}

    # 원문 (fallback용)
    raw_text = Column(Text, nullable=True)

    # 분석 상태: pending / success / partial / failed / rate_limited / provider_unavailable / empty_response
    analysis_status = Column(String(30), nullable=False, default="pending")
    # 실패 원인 (성공 시 NULL)
    analysis_reason = Column(String(200), nullable=True)
    analyzed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    syllabus = relationship("Syllabus", back_populates="analysis")
    user = relationship("User", backref="syllabus_analyses")
