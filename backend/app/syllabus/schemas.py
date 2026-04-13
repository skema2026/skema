import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator, model_validator


class SyllabusResponse(BaseModel):
    id: int
    user_id: int
    subject_name: str
    original_filename: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    source: Optional[str] = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


# ── AI 분석 내부 페이로드 (analyzer → router 전달용) ─────────────────────────

class AnalysisPayload(BaseModel):
    """
    analyzer.py가 파싱한 구조화 데이터를 router.py에 전달하는 내부 모델.
    DB 컬럼 매핑:
      weekly_plan      → weekly_topics  (JSON)
      exam_schedule    → exam_dates     (JSON)
      assignments      → assignment_dates (JSON)
      important_notes  → important_factors (JSON)
    """
    weekly_plan: List[Dict] = []              # [{week, topic, subtopics, difficulty, keywords}]
    midterm_weight: Optional[int] = None
    final_weight: Optional[int] = None
    assignment_weight: Optional[int] = None
    attendance_weight: Optional[int] = None
    presentation_weight: Optional[int] = None
    has_presentation: bool = False
    midterm_week: Optional[int] = None       # 중간고사 주차 (날짜 미상 시)
    final_week: Optional[int] = None         # 기말고사 주차 (날짜 미상 시)
    exam_schedule: List[Dict] = []            # [{type, date}]
    assignments: List[Dict] = []              # [{title, due_date}]
    important_notes: List[str] = []
    study_mapping: Optional[Dict] = None     # {midterm_scope_weeks: [...], final_scope_weeks: [...]}


# ── SyllabusAnalysis API 응답 ─────────────────────────────────────────────────

def _parse_json_field(v: Any) -> Any:
    """DB에 저장된 JSON 문자열을 Python 객체로 변환."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (json.JSONDecodeError, ValueError):
            return []
    return v or []


def _to_weekly_plan(raw: Any) -> List[Dict]:
    """
    DB의 weekly_topics 값을 [{week, topic, subtopics, difficulty, keywords}] 형식으로 정규화.
    기존 문자열 포맷 ["1주차: ..."] 도 처리.
    """
    items = _parse_json_field(raw)
    if not isinstance(items, list):
        return []
    result = []
    for i, item in enumerate(items):
        if isinstance(item, dict):
            result.append({
                "week": int(item.get("week", i + 1)),
                "topic": str(item.get("topic", "")),
                "subtopics": item.get("subtopics") if isinstance(item.get("subtopics"), list) else [],
                "difficulty": item.get("difficulty", "medium"),
                "keywords": item.get("keywords") if isinstance(item.get("keywords"), list) else [],
            })
        elif isinstance(item, str):
            result.append({"week": i + 1, "topic": item, "subtopics": [], "difficulty": "medium", "keywords": []})
    return result


class SyllabusAnalysisResponse(BaseModel):
    id: int
    syllabus_id: int
    user_id: int
    subject_name: str

    # ── 구조화 응답 (신규 포맷) ──────────────────────────────────────────────
    weekly_plan: Optional[List[Dict]] = None       # [{week, topic}]
    evaluation: Optional[Dict] = None              # {midterm, final, assignment, attendance, presentation}
    exam_schedule: Optional[List[Dict]] = None     # [{type, date}]
    assignments: Optional[List[Dict]] = None       # [{title, due_date}]
    presentation: Optional[bool] = None
    important_notes: Optional[List[str]] = None

    # ── 원시 DB 필드 (하위 호환) ─────────────────────────────────────────────
    midterm_weight: Optional[int] = None
    final_weight: Optional[int] = None
    assignment_weight: Optional[int] = None
    attendance_weight: Optional[int] = None
    presentation_weight: Optional[int] = None
    has_presentation: Optional[bool] = None
    midterm_week: Optional[int] = None
    final_week: Optional[int] = None
    weekly_topics: Optional[Any] = None        # raw DB value
    exam_dates: Optional[Any] = None
    assignment_dates: Optional[Any] = None
    important_factors: Optional[Any] = None
    study_mapping: Optional[Dict] = None       # {midterm_scope_weeks, final_scope_weeks}
    raw_text: Optional[str] = None
    analysis_status: str
    analysis_reason: Optional[str] = None
    analyzed_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("weekly_topics", "exam_dates", "assignment_dates", "important_factors", mode="before")
    @classmethod
    def parse_json_fields(cls, v: Any) -> Any:
        return _parse_json_field(v)

    @field_validator("study_mapping", mode="before")
    @classmethod
    def parse_study_mapping(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                return None
        return v

    @model_validator(mode="after")
    def build_structured_fields(self) -> "SyllabusAnalysisResponse":
        """raw DB 필드에서 구조화 응답 필드를 계산한다."""
        # weekly_plan: DB의 weekly_topics 사용
        if self.weekly_plan is None:
            self.weekly_plan = _to_weekly_plan(self.weekly_topics)

        # evaluation dict
        if self.evaluation is None:
            self.evaluation = {
                "midterm": self.midterm_weight,
                "final": self.final_weight,
                "assignment": self.assignment_weight,
                "attendance": self.attendance_weight,
                "presentation": self.presentation_weight,
            }

        # exam_schedule: DB의 exam_dates 사용
        if self.exam_schedule is None:
            raw = self.exam_dates
            self.exam_schedule = raw if isinstance(raw, list) else []

        # assignments: DB의 assignment_dates 사용
        if self.assignments is None:
            raw = self.assignment_dates
            self.assignments = raw if isinstance(raw, list) else []

        # presentation: DB의 has_presentation 사용
        if self.presentation is None:
            self.presentation = self.has_presentation

        # important_notes: DB의 important_factors 사용
        if self.important_notes is None:
            raw = self.important_factors
            self.important_notes = [str(x) for x in raw] if isinstance(raw, list) else []

        return self
