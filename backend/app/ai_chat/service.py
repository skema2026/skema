import json
import logging
import re
import threading
from datetime import date, datetime, timedelta

from openai import OpenAI
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.schedule.models import ExamSchedule, Schedule
from app.auth.models import UserProfile

DAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
DAY_NAMES_SHORT = ["월", "화", "수", "목", "금", "토", "일"]

# ─── Tool definitions ─────────────────────────────────────────────────────────

TOOLS_SPEC = [
    {
        "name": "add_schedule",
        "description": (
            "새 일정을 추가합니다. 반복 수업이면 day_of_week 사용, "
            "특정 날짜 이벤트이면 date(YYYY-MM-DD) 사용합니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "일정 제목"},
                "day_of_week": {"type": "integer", "description": "요일 0=월~6=일. date 있으면 자동 계산"},
                "date": {"type": "string", "description": "특정 날짜 YYYY-MM-DD"},
                "start_time": {"type": "string", "description": "시작 시간 HH:MM"},
                "end_time": {"type": "string", "description": "종료 시간 HH:MM"},
                "location": {"type": "string", "description": "장소 (선택)"},
                "color": {"type": "string", "description": "색상 hex (선택)"},
                "priority": {"type": "integer", "description": "우선순위 0=보통 1=높음 2=긴급"},
                "schedule_type": {"type": "string", "description": "class/event/study"},
            },
            "required": ["title", "start_time", "end_time"],
        },
    },
    {
        "name": "update_schedule",
        "description": "기존 일정을 수정합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "수정할 일정 ID"},
                "title": {"type": "string"},
                "day_of_week": {"type": "integer"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "start_time": {"type": "string", "description": "HH:MM"},
                "end_time": {"type": "string", "description": "HH:MM"},
                "location": {"type": "string"},
                "color": {"type": "string"},
                "priority": {"type": "integer"},
                "is_completed": {"type": "boolean"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "delete_schedule",
        "description": "일정을 삭제합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "삭제할 일정 ID"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "list_schedules",
        "description": "등록된 일정 목록을 조회합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "filter_date": {"type": "string", "description": "특정 날짜 YYYY-MM-DD 필터"},
                "filter_type": {"type": "string", "description": "all/class/event/study"},
            },
        },
    },
    {
        "name": "find_free_slots",
        "description": "특정 날짜 또는 요일의 빈 시간대를 찾습니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "day_of_week": {"type": "integer", "description": "요일 0=월~6=일"},
                "date": {"type": "string", "description": "특정 날짜 YYYY-MM-DD"},
                "duration_minutes": {"type": "integer", "description": "최소 시간(분), 기본 60"},
            },
        },
    },
    {
        "name": "check_conflicts",
        "description": "일정 추가/수정 전 시간 충돌 여부를 확인합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "day_of_week": {"type": "integer"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "start_time": {"type": "string", "description": "HH:MM"},
                "end_time": {"type": "string", "description": "HH:MM"},
                "exclude_id": {"type": "integer", "description": "수정 시 자기 자신 제외"},
            },
            "required": ["start_time", "end_time"],
        },
    },
    {
        "name": "generate_study_schedule",
        "description": "기존 일정·수면 시간·시험 일정을 고려해 학습 시간표를 자동 생성합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "학습 과목/내용"},
                "target_days": {"type": "integer", "description": "생성 기간(일수), 기본 7"},
                "daily_study_hours": {"type": "number", "description": "하루 목표 학습 시간(시간 단위), 기본 2"},
            },
            "required": ["subject"],
        },
    },
    {
        "name": "reschedule_incomplete",
        "description": "미완료 상태인 일정을 오늘 이후 빈 시간대에 자동으로 재배치합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "target_days": {"type": "integer", "description": "재배치 탐색 기간(일수), 기본 7"},
            },
        },
    },
    {
        "name": "add_exam_schedule",
        "description": (
            "시험 일정을 추가합니다. 사용자가 시험 날짜/과목을 언급하면 이 툴을 사용하세요. "
            "일반 일정(add_schedule)이 아닌 시험 전용 테이블에 저장되어 학습 계획 생성에 활용됩니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "시험 제목 (예: '알고리즘 중간고사')"},
                "exam_date": {"type": "string", "description": "시험 날짜 YYYY-MM-DD"},
                "subject": {"type": "string", "description": "과목명 (선택)"},
                "exam_time": {"type": "string", "description": "시험 시작 시간 HH:MM (선택)"},
                "location": {"type": "string", "description": "시험 장소 (선택)"},
            },
            "required": ["title", "exam_date"],
        },
    },
    {
        "name": "list_exam_schedules",
        "description": "등록된 시험 일정 목록을 조회합니다. 학습 계획 생성 전에 항상 먼저 호출하세요.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "generate_exam_prep_schedule",
        "description": (
            "시험 일정을 기준으로 역산하여 기존 수업·일정 사이의 빈 슬롯에 학습 일정을 자동 생성합니다. "
            "시험이 가까울수록 학습 강도가 높아지며, 색상으로 긴급도를 표시합니다. "
            "사용자가 시험 대비 또는 전반적인 시간표 생성을 요청하면 이 도구를 우선 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "exam_id": {"type": "integer", "description": "특정 시험 ID (미지정 시 모든 예정 시험 대상)"},
                "target_days": {"type": "integer", "description": "학습 일정 생성 기간(일수), 기본 14"},
                "daily_study_hours": {"type": "number", "description": "기본 하루 학습 시간(시간), 기본 2. 시험 임박 시 자동 증가"},
                "sessions_per_week": {"type": "integer", "description": "주당 학습 횟수(1~7). 사용자가 '주 N일' 또는 '주 N회'를 언급하면 반드시 설정. 미지정 시 매일 생성"},
                "preferred_start_time": {"type": "string", "description": "선호 시작 시간 HH:MM (예: '07:00'). 사용자가 '몇 시부터'를 언급하면 반드시 설정"},
            },
        },
    },
    {
        "name": "list_syllabus_analyses",
        "description": (
            "업로드된 강의계획서의 AI 분석 결과를 조회합니다. "
            "과목별 평가 비율(중간/기말/과제/출석), 시험 일정, 과제 마감일, 주차별 주제를 확인할 수 있습니다. "
            "학습 계획 생성 전에 반드시 호출하여 강의계획서 데이터가 있는지 확인하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "특정 과목명 필터 (선택, 미지정 시 전체)"},
            },
        },
    },
    {
        "name": "import_syllabus_exams",
        "description": (
            "강의계획서 분석 결과에 있는 시험·과제 일정을 exam_schedules에 자동 등록합니다. "
            "사용자가 '강의계획서 일정 등록', '시험 일정 가져오기' 등을 요청할 때 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "가져올 과목명"},
            },
            "required": ["subject"],
        },
    },
    {
        "name": "complete_schedule",
        "description": (
            "일정을 완료 처리합니다. '완료했어', '다 했어', '끝냈어' 등의 표현에 사용하세요. "
            "완료된 일정은 이후 AI 재계획에서 다시 생성되지 않습니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "완료할 일정 ID"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "postpone_schedule",
        "description": (
            "특정 날짜 일정을 지정한 일수만큼 연기합니다. "
            "'내일로 연기', '하루 미뤄', '3일 뒤로' 등의 표현에 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "연기할 일정 ID"},
                "days": {"type": "integer", "description": "연기할 일수, 기본 1"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "update_exam",
        "description": "시험 일정의 날짜·제목·과목·시간·장소를 수정합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "exam_id": {"type": "integer", "description": "수정할 시험 ID"},
                "title": {"type": "string", "description": "새 제목"},
                "exam_date": {"type": "string", "description": "새 날짜 YYYY-MM-DD"},
                "subject": {"type": "string", "description": "새 과목명"},
                "exam_time": {"type": "string", "description": "새 시작 시간 HH:MM"},
                "location": {"type": "string", "description": "새 장소"},
            },
            "required": ["exam_id"],
        },
    },
    {
        "name": "delete_exam",
        "description": (
            "시험 일정을 삭제합니다. 해당 시험을 위해 AI가 생성한 학습 일정도 함께 정리됩니다. "
            "'시험 삭제', '시험 일정 지워줘' 등의 표현에 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "exam_id": {"type": "integer", "description": "삭제할 시험 ID"},
            },
            "required": ["exam_id"],
        },
    },
]


# ─── helpers ──────────────────────────────────────────────────────────────────

def _t2m(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _m2t(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


_SUBJECT_PALETTE = [
    "#4F46E5", "#0891B2", "#059669", "#D97706",
    "#DC2626", "#7C3AED", "#DB2777", "#0284C7",
    "#16A34A", "#EA580C", "#9333EA", "#0E7490",
    "#B45309", "#0F766E", "#C026D3",
]


def _subject_color(title: str) -> str:
    """djb2-style hash → 과목/제목 기반 결정론적 색상 (프론트와 동일 알고리즘)."""
    h = 5381
    for c in title:
        h = ((h << 5) + h) ^ ord(c)
        h &= 0xFFFFFFFF
    return _SUBJECT_PALETTE[h % len(_SUBJECT_PALETTE)]


def _overlap(s1: str, e1: str, s2: str, e2: str) -> bool:
    return _t2m(s1) < _t2m(e2) and _t2m(s2) < _t2m(e1)


def _dow(date_str: str) -> int:
    return datetime.strptime(date_str, "%Y-%m-%d").weekday()


def _not_deleted_filter():
    """소프트 삭제 제외 조건 (SQLAlchemy or_ 표현식)."""
    from sqlalchemy import or_
    return or_(Schedule.deleted_by_user.is_(None), Schedule.deleted_by_user == False)


def _day_schedules(db: Session, user_id: int, dow: int, date_str: str | None) -> list:
    _nd = _not_deleted_filter()
    recurring = (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.day_of_week == dow, Schedule.date.is_(None), _nd)
        .all()
    )
    if date_str:
        specific = (
            db.query(Schedule)
            .filter(Schedule.user_id == user_id, Schedule.date == date_str, _nd)
            .all()
        )
        seen = {s.id for s in recurring}
        for s in specific:
            if s.id not in seen:
                recurring.append(s)
    return recurring


# ─── AI-powered task title generation ────────────────────────────────────────

def _get_syllabus_context(db: Session, user_id: int, subject: str) -> str:
    """SyllabusAnalysis에서 과목 관련 컨텍스트를 추출해 프롬프트용 문자열로 반환."""
    try:
        from app.syllabus.models import SyllabusAnalysis as _SA
        analysis = (
            db.query(_SA)
            .filter(
                _SA.user_id == user_id,
                _SA.subject_name.ilike(f"%{subject}%"),
                _SA.analysis_status != "failed",
            )
            .first()
        )
        if not analysis:
            return ""
        parts = []
        # 주차별 학습 주제 — [{week, topic, subtopics, difficulty, keywords}]
        if analysis.weekly_topics:
            try:
                topics_raw = json.loads(analysis.weekly_topics)
                if isinstance(topics_raw, list) and topics_raw:
                    topic_lines = []
                    for i, item in enumerate(topics_raw[:16]):
                        if isinstance(item, dict):
                            w = item.get('week', i+1)
                            t = item.get('topic', '').strip()
                            subtopics = item.get('subtopics') or []
                            keywords = item.get('keywords') or []
                            difficulty = item.get('difficulty', '')
                            line = f"  {w}주차: {t}"
                            if subtopics:
                                line += f" / 세부: {', '.join(str(s) for s in subtopics[:3])}"
                            if keywords:
                                line += f" / 키워드: {', '.join(str(k) for k in keywords[:3])}"
                            if difficulty:
                                line += f" [{difficulty}]"
                            topic_lines.append(line)
                        elif isinstance(item, str):
                            topic_lines.append(f"  {item.strip()}")
                    if topic_lines:
                        parts.append("주차별 학습 주제:\n" + "\n".join(topic_lines))
            except Exception:
                pass
        # 시험 일정
        if analysis.exam_dates:
            try:
                exam_dates = json.loads(analysis.exam_dates)
                if isinstance(exam_dates, list) and exam_dates:
                    exam_lines = []
                    for e in exam_dates:
                        if isinstance(e, dict):
                            etype = {"midterm": "중간고사", "final": "기말고사"}.get(
                                e.get("type", ""), e.get("type", "시험")
                            )
                            exam_lines.append(f"{etype}: {e.get('date', '?')}")
                    if exam_lines:
                        parts.append("시험 일정: " + ", ".join(exam_lines))
            except Exception:
                pass
        # 과제
        if analysis.assignment_dates:
            try:
                assignments = json.loads(analysis.assignment_dates)
                if isinstance(assignments, list) and assignments:
                    assign_lines = []
                    for a in assignments[:4]:
                        if isinstance(a, dict):
                            assign_lines.append(
                                f"{a.get('title', '과제')} (마감: {a.get('due_date', '?')})"
                            )
                    if assign_lines:
                        parts.append("과제: " + ", ".join(assign_lines))
            except Exception:
                pass
        # 중요 사항
        if analysis.important_factors:
            try:
                factors = json.loads(analysis.important_factors)
                if factors:
                    parts.append("중요 사항: " + " / ".join(str(f) for f in factors[:4]))
            except Exception:
                pass
        # 평가 비율
        weights = []
        if analysis.midterm_weight:
            weights.append(f"중간고사 {analysis.midterm_weight}%")
        if analysis.final_weight:
            weights.append(f"기말고사 {analysis.final_weight}%")
        if analysis.assignment_weight:
            weights.append(f"과제 {analysis.assignment_weight}%")
        if analysis.attendance_weight:
            weights.append(f"출석 {analysis.attendance_weight}%")
        if weights:
            parts.append("평가 비율: " + " / ".join(weights))
        return "\n".join(parts)
    except Exception as e:
        logger.warning(f"_get_syllabus_context failed: {e}")
        return ""


def _get_weekly_scope(db: Session, user_id: int, subject: str, exam_type: str) -> list[dict]:
    """
    강의계획서 study_mapping에서 exam_type(midterm/final)의 범위 주차를 읽어
    해당 weekly_topics 항목만 반환한다.

    exam_type: "midterm" | "final"
    Returns: [{week, topic, subtopics, difficulty, keywords}, ...] (빈 리스트 가능)
    """
    try:
        from app.syllabus.models import SyllabusAnalysis as _SA
        analysis = (
            db.query(_SA)
            .filter(
                _SA.user_id == user_id,
                _SA.subject_name.ilike(f"%{subject}%"),
                _SA.analysis_status != "failed",
            )
            .first()
        )
        if not analysis or not analysis.weekly_topics or not analysis.study_mapping:
            return []
        mapping = json.loads(analysis.study_mapping) if isinstance(analysis.study_mapping, str) else analysis.study_mapping
        if not isinstance(mapping, dict):
            return []
        key = "midterm_scope_weeks" if exam_type == "midterm" else "final_scope_weeks"
        scope_weeks = set(mapping.get(key) or [])
        if not scope_weeks:
            return []
        topics_raw = json.loads(analysis.weekly_topics) if isinstance(analysis.weekly_topics, str) else analysis.weekly_topics
        if not isinstance(topics_raw, list):
            return []
        return [item for item in topics_raw if isinstance(item, dict) and item.get("week") in scope_weeks]
    except Exception as e:
        logger.warning(f"_get_weekly_scope failed: {e}")
        return []


def _weekly_topics_to_tasks(
    weekly_topics: list[dict],
    subject: str,
) -> list[dict]:
    """
    weekly_topics JSON → action + 범위(주차/챕터) + 수량이 포함된 구체적 study task 목록.
    LLM 없이 직접 생성. 추상 task 금지.
    """
    _ACTION = {
        "high":   ("심화 개념 정리 + 문제 5개 풀기", 2),
        "medium": ("핵심 개념 정리 + 예제 3개 풀기", 1),
        "low":    ("기본 개념 학습 + 예제 2개 확인", 1),
    }
    tasks = []
    for item in (weekly_topics or []):
        if not isinstance(item, dict):
            continue
        week = item.get("week")
        topic = (item.get("topic") or "").strip()
        subtopics: list = item.get("subtopics") or []
        difficulty = item.get("difficulty") or "medium"
        if difficulty not in _ACTION:
            difficulty = "medium"
        if not topic or week is None:
            continue
        action, priority = _ACTION[difficulty]
        sub_part = f" ({', '.join(str(s) for s in subtopics[:2])})" if subtopics else ""
        title = f"{subject} {week}주차 {topic}{sub_part} — {action}"
        tasks.append({
            "title": title,
            "task_type": "study",
            "priority": priority,
            "estimated_minutes": 75 if difficulty == "high" else 60,
            "reason": f"{week}주차 {topic}",
        })
    return tasks


def _scope_to_syllabus_context(scope_items: list[dict], exam_type: str) -> str:
    """scope weekly_topics 항목을 AI 프롬프트용 문자열로 변환."""
    if not scope_items:
        return ""
    label = "중간고사" if exam_type == "midterm" else "기말고사"
    lines = [f"[{label} 범위 — 아래 주차/주제를 기반으로 task 생성 필수]"]
    for item in scope_items:
        w = item.get("week", "?")
        t = item.get("topic", "")
        subtopics = item.get("subtopics") or []
        keywords = item.get("keywords") or []
        difficulty = item.get("difficulty", "")
        line = f"  {w}주차: {t}"
        if subtopics:
            line += f" — {', '.join(str(s) for s in subtopics[:4])}"
        if keywords:
            line += f" (키워드: {', '.join(str(k) for k in keywords[:4])})"
        if difficulty:
            line += f" [{difficulty}]"
        lines.append(line)
    return "\n".join(lines)


_FORBIDDEN_TASK_WORDS = frozenset([
    "공부", "학습", "복습하기", "준비하기", "시험 준비", "공부하기", "학습하기",
    "복습", "준비", "공부 및 복습", "시험공부",
])
_VAGUE_PATTERN = re.compile(
    r"^[^\d]{0,12}(공부|학습|복습|준비)(하기|하다)?$",
    re.UNICODE,
)


def _validate_task_quality(title: str) -> bool:
    """
    True = 구체적 task (통과) / False = 너무 추상적 (거부).

    통과 조건 (하나라도 충족):
    - 숫자 포함 (주차, 문제 수, 범위 등)
    - 30자 이상 (충분히 구체적인 설명)
    - 행동어 + 구체적 대상 + 범위가 있다고 판단되는 경우

    거부 조건:
    - 15자 이하 + 금지어 포함
    - 짧은 "과목명 + 공부/학습/준비" 패턴
    """
    t = re.sub(r"^📚\s*", "", title.strip())  # 이모지 제거 후 검사
    if len(t) < 6:
        return False
    # 짧고 금지어만 있는 경우 거부
    if len(t) <= 16 and any(w in t for w in _FORBIDDEN_TASK_WORDS):
        return False
    # 짧은 "XX 공부/학습/복습" 패턴 거부
    if _VAGUE_PATTERN.match(t):
        return False
    # 숫자 포함 → 통과 (범위, 문제수 등 구체성 있음)
    if re.search(r"\d", t):
        return True
    # 30자 이상 → 통과
    if len(t) >= 25:
        return True
    return False


def _pick_phase(days_until_exam: int) -> str:
    """시험까지 남은 일수 → 학습 단계 반환."""
    if days_until_exam <= 3:
        return "late"
    if days_until_exam <= 10:
        return "mid"
    return "early"


_PHASE_TYPE  = {"early": "study",   "mid": "practice", "late": "review"}
_PHASE_PRIO  = {"early": 1,         "mid": 1,          "late": 2}
_PHASE_LABEL = {
    "early": "초반 — 개념/기초 이해",
    "mid":   "중반 — 문제풀이/심화/패턴 분석",
    "late":  "말기 — 실전 모의고사/오답 총정리/약점 보완",
}


def _call_gemini(prompt: str, temperature: float = 0.2) -> str:
    """LLM 텍스트 호출. Gemini 실패 시 gpt-4.1 fallback 자동 사용."""
    from app.core.llm import call_llm
    result = call_llm(prompt, temperature=temperature)
    if result.status == "fallback_used":
        logger.info(f"ai_chat used fallback: provider={result.provider} model={result.model}")
    return result.content


def _create_chat_completion(messages: list, tools: list):
    """
    Gemini (OpenAI-compat endpoint) 우선 호출, 실패 시 OpenAI gpt-4.1 fallback.
    tool_calls 지원. 둘 다 실패 시 RuntimeError.
    """
    from app.core.llm import OPENAI_MODEL
    if settings.GEMINI_API_KEY:
        try:
            _gclient = OpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=settings.GEMINI_API_KEY,
            )
            return _gclient.chat.completions.create(
                model="gemini-2.5-flash",
                messages=messages,
                tools=tools,
                tool_choice="auto",
            )
        except Exception as _exc:
            logger.warning(f"Gemini chat completion failed, falling back to gpt-4.1: {_exc}")
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY와 OPENAI_API_KEY가 모두 설정되지 않았습니다.")
    _oclient = OpenAI(api_key=settings.OPENAI_API_KEY)
    return _oclient.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )


def _extract_json_array(text: str) -> list:
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        return []
    return json.loads(text[start:end])


# ─── 시험 종류 분석 → 준비 컴포넌트 생성 ─────────────────────────────────────

def _analyze_exam_requirements(
    exam_title: str,
    subject: str,
    syllabus_context: str = "",
    days_until_exam: int = 14,
) -> list[dict]:
    """
    시험 종류를 AI로 분석해 phase별 구체적 준비 컴포넌트와 task 목록을 반환.

    Returns:
        [{"component": str, "phase": "early"|"mid"|"late", "tasks": [str]}, ...]
    """
    syllabus_section = f"\n\n강의계획서 정보 (주차별 주제 등 활용 필수):\n{syllabus_context}" if syllabus_context else ""

    prompt = f"""당신은 학습 계획 전문가입니다.

시험 정보:
- 시험명: {exam_title}
- 과목/분야: {subject}
- 시험까지 남은 일수: {days_until_exam}일{syllabus_section}

【시험 종류별 전략 — 반드시 아래 기준 적용】
- 토익(TOEIC): LC Part1(사진묘사10)/Part2(질응답25)/Part3(짧은대화39)/Part4(담화30), RC Part5(단문공란)/Part6(장문공란)/Part7(독해), 어휘암기, 실전모의고사 단위로 분리
- IELTS/TOEFL: Listening/Reading/Writing/Speaking 영역별 분리 + 각 섹션 유형 기반 task
- 정보처리기사/컴활 등 자격증: 과목별 체계 분석 → 단원별 기출문제 + 개념 정리로 분리
- 대학교 중간/기말고사: 강의계획서 주차/챕터를 최우선 참조 → 각 주차 주제를 구체적 task로 변환
  - 예) "3주차: CPU Scheduling" → "CPU Scheduling 선점·비선점 알고리즘 개념 정리 + 연습문제 5개 풀기"
- 기타 외부시험: 준비 영역을 논리적으로 분해 후 각 영역별 task

【task 제목 필수 규칙 — 위반 시 유효하지 않은 응답으로 처리】
✅ 필수: "구체적 행동 + 범위/챕터/문제수"
  - "LC Part 2 질응답 문제 25개 풀기 + 오답 스크립트 확인"
  - "운영체제 3~4주차 CPU Scheduling 강의노트 정리"
  - "정보처리기사 1과목 소프트웨어설계 기출 2023년 1회 1~20번"
❌ 절대 금지: "{subject} 공부", "{exam_title} 준비", "복습하기", "시험 공부", "학습하기"

【phase 분류】
- early: 개념 이해 + 기초 학습 (D-11 이상)
- mid  : 문제풀이 + 심화 + 오답 분석 (D-4 ~ D-10)
- late : 실전 모의고사 + 총정리 + 약점 집중 보완 (D-3 이내)

각 component당 tasks 3~5개. JSON 배열만 반환 (설명·주석 없이):
[
  {{
    "component": "LC Part 1-2 사진묘사·질응답",
    "phase": "early",
    "tasks": [
      {{
        "title": "LC Part 1 사진 묘사 문제 10개 풀기 + 오답 스크립트 확인",
        "estimated_minutes": 50,
        "reason": "사진 묘사 유형 10문항으로 기초 청해력 확인 및 오답 원인 파악"
      }},
      {{
        "title": "LC Part 2 질응답 문제 25개 풀기 + 반복 패턴 정리",
        "estimated_minutes": 60,
        "reason": "질응답 패턴 숙달로 Part 2 정답률 향상"
      }}
    ]
  }},
  {{
    "component": "RC Part 5-6 문법/어휘·장문완성",
    "phase": "mid",
    "tasks": [
      {{
        "title": "RC Part 5 문법 문제 30개 + 틀린 유형 분류",
        "estimated_minutes": 45,
        "reason": "문법 취약 유형 파악 후 집중 보완"
      }},
      {{
        "title": "빈출 어휘 50개 암기 (YBM 기출 기반)",
        "estimated_minutes": 30,
        "reason": "RC 어휘 문제 정답률 향상을 위한 핵심 어휘 확보"
      }}
    ]
  }},
  {{
    "component": "실전 모의고사 + 총정리",
    "phase": "late",
    "tasks": [
      {{
        "title": "실전 모의고사 1회분 (LC+RC 200문항) 시간 맞춰 풀기",
        "estimated_minutes": 120,
        "reason": "실전 시간 관리 훈련 및 전체 실력 점검"
      }},
      {{
        "title": "오답 분석 — 취약 파트 집중 재정리",
        "estimated_minutes": 60,
        "reason": "틀린 문항 유형 집중 보완으로 점수 상승"
      }}
    ]
  }}
]"""

    try:
        content = _call_gemini(prompt, temperature=0.2)
        components = _extract_json_array(content)
        if isinstance(components, list) and components:
            # tasks 필드를 [{title, estimated_minutes, reason}] 형식으로 정규화
            normalized = []
            for comp in components:
                if not isinstance(comp, dict):
                    continue
                raw_tasks = comp.get("tasks", [])
                norm_tasks = []
                for t in raw_tasks:
                    if isinstance(t, str) and t.strip():
                        norm_tasks.append({"title": t.strip(), "estimated_minutes": 60, "reason": ""})
                    elif isinstance(t, dict) and t.get("title"):
                        norm_tasks.append({
                            "title": t["title"].strip(),
                            "estimated_minutes": int(t.get("estimated_minutes") or 60),
                            "reason": str(t.get("reason") or ""),
                        })
                comp["tasks"] = norm_tasks
                normalized.append(comp)
            return normalized
    except Exception as e:
        logger.warning(f"_analyze_exam_requirements failed: {e}")
    return []


# ─── 과목 학습 일정 task 풀 생성 (general study) ──────────────────────────────

def _get_subject_study_tasks(
    subject: str,
    syllabus_context: str = "",
    daily_hours: float = 2.0,
) -> list[dict]:
    """
    특정 과목에 대한 구체적인 학습 task 풀을 AI로 생성한다.
    강의계획서가 있으면 주차/챕터 기반, 없으면 과목명 분석 기반.

    Returns: [{title, task_type, priority}, ...]
    """
    syllabus_section = (
        f"\n\n강의계획서 정보 (주차별 주제 기반으로 task 생성 — 필수):\n{syllabus_context}"
        if syllabus_context
        else ""
    )
    prompt = f"""당신은 학습 계획 전문가입니다.

과목: {subject}
하루 학습 목표: {daily_hours}시간{syllabus_section}

위 과목의 구체적인 학습 task 15개를 생성하세요.

【규칙】
1. 강의계획서(주차별 주제)가 있으면:
   - 각 주차 주제를 구체적인 task로 변환
   - ✅ "운영체제 3주차 CPU Scheduling 선점/비선점 개념 정리 + 예제 3개 풀기"
   - ✅ "자료구조 4주차 트리 순회 3종류(전위/중위/후위) 구현 및 비교"
2. 강의계획서가 없으면: 과목명을 분석해 단원·유형 기반으로 구체화
   - ✅ "미적분 극한·연속 기본 문제 10개 풀기"
   - ✅ "영어 독해 주제 찾기 전략 5문단 연습"
3. ❌ 절대 금지: "{subject} 공부", "{subject} 학습", "복습하기", "문제풀기"(너무 광범위)
4. task_type: study(개념)/practice(문제풀이)/review(복습)/assignment(과제)
5. priority: 1(기본), 2(중요 단원)

JSON 배열만 반환:
[
  {{
    "title": "...",
    "task_type": "study",
    "priority": 1,
    "estimated_minutes": 60,
    "reason": "이 task를 선택한 이유"
  }},
  ...
]"""

    try:
        content = _call_gemini(prompt, temperature=0.3)
        tasks = _extract_json_array(content)
        if isinstance(tasks, list) and tasks:
            filtered = []
            for t in tasks:
                if not isinstance(t, dict):
                    continue
                title = t.get("title", "")
                if not _validate_task_quality(title):
                    continue
                filtered.append({
                    "title": title.strip(),
                    "task_type": t.get("task_type", "study"),
                    "priority": int(t.get("priority") or 1),
                    "estimated_minutes": int(t.get("estimated_minutes") or 60),
                    "reason": str(t.get("reason") or ""),
                })
            return filtered or tasks
    except Exception as e:
        logger.warning(f"_get_subject_study_tasks failed: {e}")
    return []


# ─── 시험 준비 task 선택 (phase-aware) ────────────────────────────────────────

def _get_personalized_study_tasks(
    exam_title: str,
    subject: str,
    days_until_exam: int,
    completed_blocks: int,
    total_blocks: int,
    syllabus_context: str = "",
    exam_components: list[dict] | None = None,
) -> list[dict]:
    """
    학습 task 목록 반환.

    exam_components가 있으면 현재 phase에 맞는 tasks를 선택.
    없으면 AI에 직접 요청 (fallback).

    Returns: [{title, task_type, priority}, ...]
    """
    phase = _pick_phase(days_until_exam)

    # ── component 기반 (권장 경로) ────────────────────────────────────────────
    if exam_components:
        # 현재 phase 컴포넌트 우선, 없으면 전체 순환
        target = [c for c in exam_components if c.get("phase") == phase] or exam_components
        tasks = []
        for comp in target:
            for t in comp.get("tasks", []):
                if isinstance(t, str) and t.strip():
                    tasks.append({
                        "title": t.strip(),
                        "task_type": _PHASE_TYPE[phase],
                        "priority": _PHASE_PRIO[phase],
                    })
        if tasks:
            return tasks

    # ── AI 직접 생성 (fallback) ───────────────────────────────────────────────
    progress_pct = int(completed_blocks / total_blocks * 100) if total_blocks > 0 else 0
    syllabus_section = f"\n강의계획서 정보 (주차/범위 기반 task 생성에 활용):\n{syllabus_context}" if syllabus_context else ""

    prompt = f"""당신은 학습 계획 전문가입니다.

시험: {exam_title} / 과목: {subject}
D-{days_until_exam} / 진행률: {progress_pct}% / 현재 단계: {_PHASE_LABEL[phase]}{syllabus_section}

【필수 규칙 — 위반 시 응답 전체 무효】
✅ task 제목 = "구체적 행동 + 범위 또는 문제수 또는 챕터"
  - "LC Part 3 짧은 대화 기출 1세트(13문항) + 오답 분석"
  - "운영체제 4주차 메모리 관리 개념 정리 + 연습문제 3개"
  - "정보처리기사 2과목 기출 2023년 2회 1~20번 풀기"
❌ 절대 금지 (이 중 하나라도 포함 시 해당 item 삭제):
  "{subject} 공부", "{subject} 학습", "{exam_title} 준비", "복습하기", "시험 공부", "공부하기"

현재 단계({_PHASE_LABEL[phase]})에 맞는 task 12개를 JSON 배열로만 반환:
[
  {{
    "title": "...",
    "task_type": "study|practice|review|mock",
    "priority": 0|1|2,
    "estimated_minutes": 60,
    "reason": "이 task를 선택한 이유 (한 줄)"
  }},
  ...
]"""

    try:
        content = _call_gemini(prompt, temperature=0.25)
        tasks = _extract_json_array(content)
        if isinstance(tasks, list) and tasks:
            # 품질 필터: 금지어 + 구체성 검사
            filtered = []
            for t in tasks:
                if not isinstance(t, dict):
                    continue
                title = t.get("title", "")
                if not _validate_task_quality(title):
                    continue
                filtered.append({
                    "title": title.strip(),
                    "task_type": t.get("task_type", _PHASE_TYPE[phase]),
                    "priority": int(t.get("priority") or _PHASE_PRIO[phase]),
                    "estimated_minutes": int(t.get("estimated_minutes") or 60),
                    "reason": str(t.get("reason") or ""),
                })
            return filtered or tasks
    except Exception as e:
        logger.warning(f"_get_personalized_study_tasks failed: {e}")
    return []


# ─── tool execution ───────────────────────────────────────────────────────────

_TIME_RANGE_RE = re.compile(
    r"(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})"
)


def _parse_time_arg(val: str) -> str:
    """
    'HH:MM' 또는 'HH:MM~HH:MM' 범위에서 첫 번째 시간만 반환.
    '9:00' → '09:00', '13:00~14:30' → '13:00'
    """
    if not val:
        return "00:00"
    val = val.strip()
    # 범위 포맷 "HH:MM~HH:MM"
    m = _TIME_RANGE_RE.match(val)
    if m:
        val = m.group(1)
    # 정규화: 9:30 → 09:30
    parts = val.split(":")
    if len(parts) == 2:
        try:
            h, mn = int(parts[0]), int(parts[1])
            return f"{h:02d}:{mn:02d}"
        except ValueError:
            pass
    return val


def _parse_time_range(start_val: str, end_val: str) -> tuple[str, str]:
    """
    start_val이 범위('13:00~14:30')이면 start/end 모두 분리해 반환.
    그렇지 않으면 각각을 독립적으로 정규화.
    """
    start_val = (start_val or "").strip()
    end_val = (end_val or "").strip()

    # start_val이 범위 포맷인 경우 — end_val은 무시하고 범위에서 추출
    m = _TIME_RANGE_RE.match(start_val)
    if m:
        st = _parse_time_arg(m.group(1))
        et = _parse_time_arg(m.group(2))
        return st, et

    st = _parse_time_arg(start_val)
    et = _parse_time_arg(end_val)
    return st, et


def _execute_tool(tool_name: str, tool_input: dict, db: Session, user_id: int) -> str:
    today = date.today()

    if tool_name == "add_schedule":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            dow = 0
        start_time, end_time = _parse_time_range(
            tool_input.get("start_time", ""),
            tool_input.get("end_time", ""),
        )

        # 내장 충돌 검사 — 충돌 있어도 저장하되 경고 반환
        existing_day = _day_schedules(db, user_id, dow, date_str)
        conflict_titles = [
            f"[ID:{s.id}] {s.title} ({s.start_time}~{s.end_time})"
            for s in existing_day
            if _overlap(start_time, end_time, s.start_time, s.end_time)
        ]

        title_str = tool_input["title"]
        s = Schedule(
            user_id=user_id,
            title=title_str,
            day_of_week=dow,
            date=date_str,
            start_time=start_time,
            end_time=end_time,
            location=tool_input.get("location"),
            color=tool_input.get("color") or _subject_color(title_str),
            priority=tool_input.get("priority", 0),
            schedule_type=tool_input.get("schedule_type", "event"),
            schedule_source="user_created",
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        label = date_str if date_str else f"매주 {DAY_NAMES[dow]}"
        loc = f"  📍 {s.location}" if s.location else ""
        result = f"✅ '{s.title}' 추가 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}{loc}\n🆔 ID: {s.id}"
        if conflict_titles:
            result += f"\n⚠️ 시간 충돌 경고:\n" + "\n".join(f"  • {t}" for t in conflict_titles)
        return result

    elif tool_name == "update_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        for f in ["title", "day_of_week", "date", "start_time", "end_time", "location", "color", "priority", "is_completed"]:
            if f in tool_input:
                setattr(s, f, tool_input[f])
        if "date" in tool_input and tool_input["date"]:
            s.day_of_week = _dow(tool_input["date"])
        # 사용자가 수정한 일정은 user_override=True — 이후 재계획에서 덮어쓰지 않음
        s.user_override = True
        db.commit()
        db.refresh(s)
        label = s.date if s.date else f"매주 {DAY_NAMES[s.day_of_week]}"
        return f"✅ '{s.title}' 수정 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}"

    elif tool_name == "delete_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        title = s.title
        if s.schedule_source == "ai_generated":
            # 소프트 삭제 — original_generated_title 보존으로 동일 task 재생성 방지
            s.deleted_by_user = True
            db.commit()
        else:
            db.delete(s)
            db.commit()
        return f"🗑️ '{title}' 삭제 완료!"

    elif tool_name == "list_schedules":
        schedules = db.query(Schedule).filter(
            Schedule.user_id == user_id, _not_deleted_filter()
        ).all()
        ft = tool_input.get("filter_type", "all")
        fd = tool_input.get("filter_date")
        if ft and ft != "all":
            schedules = [s for s in schedules if s.schedule_type == ft]
        if fd:
            fd_dow = _dow(fd)
            schedules = [s for s in schedules if s.date == fd or (s.date is None and s.day_of_week == fd_dow)]
        if not schedules:
            return "📭 등록된 일정이 없습니다."
        picons = {0: "", 1: "🟡", 2: "🔴"}
        lines = [f"📋 일정 목록 ({len(schedules)}개):\n"]
        for s in sorted(schedules, key=lambda x: (x.day_of_week, x.start_time)):
            lbl = s.date if s.date else DAY_NAMES[s.day_of_week]
            icon = picons.get(s.priority or 0, "")
            line = f"  [ID:{s.id}] {icon} {s.title}  {lbl} {s.start_time}~{s.end_time}"
            if s.location:
                line += f"  ({s.location})"
            lines.append(line)
        return "\n".join(lines)

    elif tool_name == "find_free_slots":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        duration = tool_input.get("duration_minutes", 60)
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."
        existing = _day_schedules(db, user_id, dow, date_str)
        busy = sorted((_t2m(s.start_time), _t2m(s.end_time)) for s in existing)
        free, cursor = [], 8 * 60
        for bs, be in busy:
            if cursor + duration <= bs:
                free.append((_m2t(cursor), _m2t(bs)))
            cursor = max(cursor, be + 60)  # +1시간 버퍼
        if cursor + duration <= 22 * 60:
            free.append((_m2t(cursor), _m2t(22 * 60)))
        label = date_str if date_str else DAY_NAMES[dow]
        if not free:
            return f"😅 {label}에는 {duration}분 이상의 빈 시간이 없습니다."
        result = f"🕐 {label} 빈 시간대 ({duration}분 이상):\n"
        for s, e in free:
            result += f"  • {s} ~ {e}\n"
        return result

    elif tool_name == "check_conflicts":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        start_time = tool_input["start_time"]
        end_time = tool_input["end_time"]
        exclude_id = tool_input.get("exclude_id")
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."
        existing = _day_schedules(db, user_id, dow, date_str)
        conflicts = [
            s for s in existing
            if (exclude_id is None or s.id != exclude_id)
            and _overlap(start_time, end_time, s.start_time, s.end_time)
        ]
        label = date_str if date_str else DAY_NAMES[dow]
        if not conflicts:
            return f"✅ {label} {start_time}~{end_time} 시간대에 충돌이 없습니다."
        result = f"⚠️ 충돌 발견 ({label} {start_time}~{end_time}):\n"
        for s in conflicts:
            result += f"  • [ID:{s.id}] {s.title} ({s.start_time}~{s.end_time})\n"
        return result

    elif tool_name == "generate_study_schedule":
        subject = tool_input["subject"]
        target_days = tool_input.get("target_days", 7)
        daily_hours = tool_input.get("daily_study_hours", 2)
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        wake = _t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
        sleep = _t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")

        # 강의계획서 주차별 데이터 → 구체적 task 풀 생성
        syllabus_ctx = _get_syllabus_context(db, user_id, subject)
        task_pool: list[dict] = []

        # 1순위: weekly_topics 직접 변환 (LLM 없이 구체적 task 생성)
        try:
            from app.syllabus.models import SyllabusAnalysis as _SA
            _sa = (
                db.query(_SA)
                .filter(
                    _SA.user_id == user_id,
                    _SA.subject_name.ilike(f"%{subject}%"),
                    _SA.analysis_status != "failed",
                )
                .first()
            )
            if _sa and _sa.weekly_topics:
                _raw = json.loads(_sa.weekly_topics) if isinstance(_sa.weekly_topics, str) else _sa.weekly_topics
                if isinstance(_raw, list) and _raw:
                    task_pool = _weekly_topics_to_tasks(_raw, subject)
        except Exception as _e:
            logger.warning(f"_weekly_topics_to_tasks failed: {_e}")

        # 2순위: LLM 기반 task 생성 (weekly_topics 없는 경우)
        if not task_pool and (settings.GEMINI_API_KEY or settings.OPENAI_API_KEY):
            task_pool = _get_subject_study_tasks(
                subject=subject,
                syllabus_context=syllabus_ctx,
                daily_hours=float(daily_hours),
            )

        created = 0
        task_idx = 0
        for offset in range(target_days):
            tdate = today + timedelta(days=offset)
            date_str = tdate.strftime("%Y-%m-%d")
            dow = tdate.weekday()
            existing = _day_schedules(db, user_id, dow, date_str)
            busy = sorted((_t2m(s.start_time), _t2m(s.end_time)) for s in existing)
            remaining = int(daily_hours * 60)
            cursor = max(8 * 60, wake)
            blocks = []
            for bs, be in busy:
                if cursor + 30 <= bs and remaining > 0:
                    b = min(bs - cursor, remaining, 180)
                    blocks.append((cursor, cursor + b))
                    remaining -= b
                cursor = max(cursor, be + 60)  # +1시간 버퍼
            if remaining >= 30 and cursor + 30 <= sleep:
                b = min(sleep - cursor, remaining, 180)
                blocks.append((cursor, cursor + b))
            for sm, em in blocks:
                if task_pool:
                    task = task_pool[task_idx % len(task_pool)]
                    raw_task_title = task["title"]
                    title = f"📚 {raw_task_title}"
                    priority = task.get("priority", 1)
                    # dedup: 동일 task title이 같은 날 이미 존재하면 skip
                    _already = db.query(Schedule).filter(
                        Schedule.user_id == user_id,
                        Schedule.date == date_str,
                        Schedule.schedule_type == "study",
                        Schedule.original_generated_title == raw_task_title,
                        Schedule.deleted_by_user != True,
                    ).first()
                    if _already:
                        task_idx += 1
                        continue
                else:
                    raw_task_title = None
                    title = f"📚 {subject} — 강의 내용 정리 및 예제 풀기"
                    priority = 1
                task_idx += 1
                db.add(Schedule(
                    user_id=user_id,
                    title=title,
                    day_of_week=dow,
                    date=date_str,
                    start_time=_m2t(sm),
                    end_time=_m2t(em),
                    color=_subject_color(subject),
                    priority=priority,
                    schedule_type="study",
                    schedule_source="ai_generated",
                    original_generated_title=raw_task_title,
                ))
                created += 1
        db.commit()
        end_date = (today + timedelta(days=target_days - 1)).strftime("%Y-%m-%d")
        if created:
            return (
                f"📚 '{subject}' 구체적 학습 일정 {created}개 생성 완료!\n"
                f"📅 {today.strftime('%Y-%m-%d')} ~ {end_date}  ⏰ 하루 {daily_hours}시간 목표\n"
                + (f"📋 강의계획서 기반 {len(task_pool)}개 task 풀 사용" if task_pool else "")
            )
        return "😅 여유 시간이 부족하여 학습 일정을 생성하지 못했습니다."

    elif tool_name == "reschedule_incomplete":
        target_days = tool_input.get("target_days", 7)
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        wake = _t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
        sleep = _t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")

        incomplete = db.query(Schedule).filter(
            Schedule.user_id == user_id,
            Schedule.is_completed == False,
            Schedule.date.isnot(None),
            Schedule.date < today.isoformat(),
        ).all()

        if not incomplete:
            return "✅ 재배치할 미완료 일정이 없습니다."

        moved = []
        for s in incomplete:
            duration = _t2m(s.end_time) - _t2m(s.start_time)
            for offset in range(target_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")
                dow = tdate.weekday()
                existing = _day_schedules(db, user_id, dow, date_str)
                busy = sorted((_t2m(x.start_time), _t2m(x.end_time)) for x in existing if x.id != s.id)
                cursor = max(8 * 60, wake)
                placed = False
                for bs, be in busy:
                    if cursor + duration <= bs:
                        s.date = date_str
                        s.day_of_week = dow
                        s.start_time = _m2t(cursor)
                        s.end_time = _m2t(cursor + duration)
                        s.is_completed = False
                        db.commit()
                        moved.append(f"  • {s.title} → {date_str} {s.start_time}~{s.end_time}")
                        placed = True
                        break
                    cursor = max(cursor, be + 60)  # +1시간 버퍼
                if not placed and cursor + duration <= sleep:
                    s.date = date_str
                    s.day_of_week = dow
                    s.start_time = _m2t(cursor)
                    s.end_time = _m2t(cursor + duration)
                    s.is_completed = False
                    db.commit()
                    moved.append(f"  • {s.title} → {date_str} {s.start_time}~{s.end_time}")
                    placed = True
                if placed:
                    break

        if not moved:
            return f"😅 {target_days}일 내에 재배치 가능한 빈 시간을 찾지 못했습니다."
        return f"🔄 미완료 일정 {len(moved)}개를 재배치했습니다:\n" + "\n".join(moved)

    elif tool_name == "add_exam_schedule":
        from datetime import datetime as _dt
        exam_date_str = tool_input.get("exam_date", "")
        try:
            exam_date_obj = _dt.strptime(exam_date_str, "%Y-%m-%d").date()
        except ValueError:
            return f"❌ 날짜 형식이 올바르지 않습니다: {exam_date_str} (YYYY-MM-DD 형식으로 입력하세요)"

        e = ExamSchedule(
            user_id=user_id,
            title=tool_input["title"],
            exam_date=exam_date_obj,
            subject=tool_input.get("subject"),
            exam_time=tool_input.get("exam_time"),
            location=tool_input.get("location"),
        )
        db.add(e)
        db.commit()
        db.refresh(e)
        days_left = (exam_date_obj - today).days
        status_str = f"D-{days_left}" if days_left > 0 else ("오늘!" if days_left == 0 else "종료")
        result = (
            f"✅ 시험 일정 '{e.title}' 추가 완료!\n"
            f"📅 {exam_date_str} ({status_str})"
            + (f"  과목: {e.subject}" if e.subject else "")
            + f"\n🆔 ID: {e.id}"
        )

        # ── 자동 학습 일정 생성 (백그라운드 스레드) ──────────────────────────
        if days_left > 0 and (settings.GEMINI_API_KEY or settings.OPENAI_API_KEY):
            exam_id_bg = e.id
            target_days_bg = min(days_left, 14)
            _uid = user_id

            def _bg_generate():
                from app.db.database import SessionLocal
                bg_db = SessionLocal()
                try:
                    _execute_tool(
                        "generate_exam_prep_schedule",
                        {"exam_id": exam_id_bg, "target_days": target_days_bg, "daily_study_hours": 2.0},
                        bg_db,
                        _uid,
                    )
                except Exception as _e:
                    logger.warning(f"bg generate_exam_prep_schedule failed: {_e}")
                finally:
                    bg_db.close()

            threading.Thread(target=_bg_generate, daemon=True).start()
            result += "\n\n🔄 AI가 학습 준비 일정을 백그라운드에서 생성 중입니다. 잠시 후 시간표를 확인하세요."

        return result

    elif tool_name == "list_exam_schedules":
        exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
        if not exams:
            return "📭 등록된 시험 일정이 없습니다."
        lines = ["📝 시험 일정 목록:\n"]
        for e in sorted(exams, key=lambda x: x.exam_date):
            days_left = (e.exam_date - today).days
            if days_left > 0:
                status = f"D-{days_left}"
            elif days_left == 0:
                status = "오늘!"
            else:
                status = "종료"
            exam_date_str = e.exam_date.strftime("%Y-%m-%d") if hasattr(e.exam_date, "strftime") else e.exam_date
            line = f"  [ID:{e.id}] 📝 {e.title}  {exam_date_str} ({status})"
            if e.subject:
                line += f"  과목: {e.subject}"
            if e.exam_time:
                line += f"  {e.exam_time}"
            lines.append(line)
        return "\n".join(lines)

    elif tool_name == "generate_exam_prep_schedule":
        exam_id = tool_input.get("exam_id")
        target_days = tool_input.get("target_days", 14)
        daily_hours = tool_input.get("daily_study_hours", 2.0)
        sessions_per_week: int | None = tool_input.get("sessions_per_week")
        preferred_start_time: str | None = tool_input.get("preferred_start_time")

        exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
        if exam_id:
            exams = [e for e in exams if e.id == exam_id]

        upcoming = [e for e in exams if e.exam_date >= today]
        if not upcoming:
            return "📭 예정된 시험이 없습니다. 먼저 시험 일정을 등록해 주세요."

        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        wake = _t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
        sleep = _t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")

        created = 0
        results = []

        for exam in sorted(upcoming, key=lambda e: e.exam_date):
            exam_date_obj = exam.exam_date
            days_until_exam = (exam_date_obj - today).days
            study_days = min(days_until_exam, target_days)

            # ── 0. 기존 미완료·미삭제 AI 자율학습 블록 제거 ─────────────────
            # 완료(is_completed=True)나 사용자가 직접 삭제(deleted_by_user=True)한 것은 유지
            today_str_del = today.isoformat()
            old_blocks = db.query(Schedule).filter(
                Schedule.user_id == user_id,
                Schedule.linked_exam_id == exam.id,
                Schedule.schedule_source == "ai_generated",
                Schedule.is_completed == False,
                Schedule.deleted_by_user.isnot(True),
                Schedule.date >= today_str_del,
            ).all()
            for blk in old_blocks:
                db.delete(blk)
            db.commit()

            if study_days <= 0:
                continue

            subject = exam.subject or exam.title
            exam_created = 0

            # ── 1. 중간/기말 구분 → 범위 주차 기반 컨텍스트 로드 ────────────
            title_lower = exam.title.lower()
            if "중간" in exam.title or "midterm" in title_lower:
                detected_exam_type = "midterm"
            elif "기말" in exam.title or "final" in title_lower:
                detected_exam_type = "final"
            else:
                detected_exam_type = None

            scope_items = []
            if detected_exam_type and (exam.subject or exam.title):
                scope_items = _get_weekly_scope(db, user_id, subject, detected_exam_type)

            if scope_items:
                syllabus_ctx = _scope_to_syllabus_context(scope_items, detected_exam_type)
            else:
                syllabus_ctx = _get_syllabus_context(db, user_id, subject)

            # ── 2. 시험 종류 분석 → phase별 구체적 컴포넌트 생성 ─────────────
            #    (한 번만 호출, 결과를 day 루프에서 재사용)
            exam_components: list[dict] = []
            if settings.GEMINI_API_KEY or settings.OPENAI_API_KEY:
                exam_components = _analyze_exam_requirements(
                    exam_title=exam.title,
                    subject=subject,
                    syllabus_context=syllabus_ctx,
                    days_until_exam=days_until_exam,
                )

            # ── 3. phase별 task 버킷 구성 ────────────────────────────────────
            phase_buckets: dict[str, list[dict]] = {"early": [], "mid": [], "late": []}
            for comp in exam_components:
                p = comp.get("phase", "mid")
                if p not in phase_buckets:
                    p = "mid"
                t_type = _PHASE_TYPE.get(p, "study")
                t_prio = _PHASE_PRIO.get(p, 1)
                for task_item in comp.get("tasks", []):
                    # task_item은 str(구버전) 또는 {title, estimated_minutes, reason}(신버전)
                    if isinstance(task_item, str):
                        title = task_item.strip()
                        estimated_minutes = 60
                        reason = ""
                    elif isinstance(task_item, dict):
                        title = task_item.get("title", "").strip()
                        estimated_minutes = int(task_item.get("estimated_minutes") or 60)
                        reason = str(task_item.get("reason") or "")
                    else:
                        continue
                    if not title or not _validate_task_quality(title):
                        continue
                    phase_buckets[p].append({
                        "title": title,
                        "task_type": t_type,
                        "priority": t_prio,
                        "estimated_minutes": estimated_minutes,
                        "reason": reason,
                    })

            # component 없으면 personalized tasks로 fallback
            if not any(phase_buckets.values()):
                existing_study = db.query(Schedule).filter(
                    Schedule.user_id == user_id, Schedule.schedule_type == "study"
                ).all()
                total_blocks = len(existing_study)
                completed_blocks = sum(1 for s in existing_study if s.is_completed)
                fallback_tasks = _get_personalized_study_tasks(
                    exam_title=exam.title,
                    subject=subject,
                    days_until_exam=days_until_exam,
                    completed_blocks=completed_blocks,
                    total_blocks=total_blocks,
                    syllabus_context=syllabus_ctx,
                )
                for t in fallback_tasks:
                    phase_buckets["mid"].append(t)

            # ── 4. 날짜별 일정 배치 ──────────────────────────────────────────
            task_idx = 0

            # sessions_per_week: 실제 배치된 날짜만 카운트 (빈 시간 없어 스킵된 날 제외)
            week_placed_counts: dict[int, int] = {}  # iso_week → 실제 배치된 날짜 수

            # 선호 시작 시간 파싱
            pref_start: int | None = None
            if preferred_start_time:
                try:
                    pref_start = _t2m(preferred_start_time)
                except Exception:
                    pass

            for offset in range(study_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")

                # sessions_per_week 체크: 이번 주에 이미 충분히 배치했으면 skip
                if sessions_per_week and 1 <= sessions_per_week <= 7:
                    iso_week = tdate.isocalendar()[1]
                    if week_placed_counts.get(iso_week, 0) >= sessions_per_week:
                        continue
                dow = tdate.weekday()
                days_left = (exam_date_obj - tdate).days

                # 긴급도별 시간·색상
                if days_left <= 3:
                    day_hours = daily_hours * 1.5
                    color = "#EF4444"
                    default_priority = 2
                elif days_left <= 7:
                    day_hours = daily_hours * 1.2
                    color = "#F59E0B"
                    default_priority = 1
                else:
                    day_hours = daily_hours
                    color = "#8B5CF6"
                    default_priority = 1

                # 현재 days_left 기반 phase 결정
                current_phase = _pick_phase(days_left)

                # 현재 phase bucket 선택 (없으면 전체 합산)
                current_bucket = phase_buckets.get(current_phase, [])
                if not current_bucket:
                    current_bucket = [t for bucket in phase_buckets.values() for t in bucket]

                existing = _day_schedules(db, user_id, dow, date_str)
                busy = sorted((_t2m(s.start_time), _t2m(s.end_time)) for s in existing)
                remaining = int(day_hours * 60)
                # 선호 시작 시간 또는 기상 시간 사용 (하드코딩 8시 제거)
                cursor = pref_start if pref_start is not None else wake
                blocks = []

                for bs, be in busy:
                    if cursor + 30 <= bs and remaining > 0:
                        block_len = min(bs - cursor, remaining, 180)
                        blocks.append((cursor, cursor + block_len))
                        remaining -= block_len
                    cursor = max(cursor, be + 60)  # +1시간 버퍼

                if remaining >= 30 and cursor + 30 <= sleep:
                    block_len = min(sleep - cursor, remaining, 180)
                    blocks.append((cursor, cursor + block_len))

                day_placed = 0
                for sm, em in blocks:
                    # ── 중복 방지: 이미 같은 날·시간·과목 study 일정 있으면 skip ──
                    sm_str = _m2t(sm)
                    already_exists = db.query(Schedule).filter(
                        Schedule.user_id == user_id,
                        Schedule.date == date_str,
                        Schedule.start_time == sm_str,
                        Schedule.schedule_type == "study",
                        Schedule.title.ilike(f"%{subject}%"),
                    ).first()
                    if already_exists:
                        task_idx += 1
                        continue

                    if current_bucket:
                        task = current_bucket[task_idx % len(current_bucket)]
                        raw_task_title = task['title']
                        title = f"📚 {raw_task_title}"
                        block_priority = task.get("priority", default_priority)
                        # task의 estimated_minutes가 있으면 블록 크기에 반영
                        task_mins = task.get("estimated_minutes")
                        if task_mins and 20 <= task_mins <= 180:
                            task_em = min(sm + task_mins, em, sm + 180)
                            em = max(task_em, sm + 20)

                        # ── dedup: 이미 삭제하거나 완료한 동일 task 재생성 금지 ──
                        _nd = _not_deleted_filter()
                        already_blocked = db.query(Schedule).filter(
                            Schedule.user_id == user_id,
                            Schedule.linked_exam_id == exam.id,
                            Schedule.original_generated_title == raw_task_title,
                            Schedule.deleted_by_user == True,
                        ).first()
                        if already_blocked:
                            task_idx += 1
                            continue
                        already_done = db.query(Schedule).filter(
                            Schedule.user_id == user_id,
                            Schedule.linked_exam_id == exam.id,
                            Schedule.original_generated_title == raw_task_title,
                            Schedule.is_completed == True,
                        ).first()
                        if already_done:
                            task_idx += 1
                            continue
                    else:
                        raw_task_title = None
                        # fallback: 구체적이지만 최소한의 맥락 포함
                        stage = (
                            f"{subject} 실전 모의고사 1회분 풀기 + 오답 분석" if days_left <= 3
                            else f"{subject} 기출문제 취약 단원 오답 분석 + 재정리"
                            if days_left <= 7
                            else f"{subject} 핵심 개념 정리 + 기본 문제 3개 풀기"
                        )
                        title = f"📚 {stage}"
                        block_priority = default_priority
                    task_idx += 1

                    db.add(Schedule(
                        user_id=user_id,
                        title=title,
                        day_of_week=dow,
                        date=date_str,
                        start_time=_m2t(sm),
                        end_time=_m2t(em),
                        color=color,
                        priority=block_priority,
                        schedule_type="study",
                        schedule_source="ai_generated",
                        linked_exam_id=exam.id,
                        original_generated_title=raw_task_title,
                    ))
                    day_placed += 1
                    exam_created += 1
                    created += 1

                # 실제 배치된 날짜만 sessions_per_week 카운트에 반영
                if sessions_per_week and 1 <= sessions_per_week <= 7 and day_placed > 0:
                    iso_week = tdate.isocalendar()[1]
                    week_placed_counts[iso_week] = week_placed_counts.get(iso_week, 0) + 1

            if exam_created > 0:
                component_summary = f" ({len(exam_components)}개 준비영역 분석)" if exam_components else ""
                results.append(
                    f"  • {subject} ({exam.exam_date} D-{days_until_exam}): {exam_created}개 생성{component_summary}"
                )

        db.commit()

        if created == 0:
            return "😅 여유 시간이 부족하여 시험 준비 일정을 생성하지 못했습니다."

        summary = "\n".join(results)
        return (
            f"📚 시험 준비 일정 총 {created}개 생성 완료!\n\n"
            f"{summary}\n\n"
            f"🔴 D-3 이내: 빨강 (긴급, 모의고사·오답 위주)\n"
            f"🟡 D-7 이내: 주황 (높음, 문제풀이·심화 위주)\n"
            f"🟣 그 외: 보라 (보통, 개념·기초 위주)"
        )

    elif tool_name == "complete_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        s.is_completed = True
        db.commit()
        return f"✅ '{s.title}' 완료 처리! 이 task는 이후 재계획에서 다시 생성되지 않습니다."

    elif tool_name == "postpone_schedule":
        sid = tool_input["schedule_id"]
        days_to_postpone = int(tool_input.get("days", 1))
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        if not s.date:
            return "❌ 반복 일정(매주 수업)은 연기할 수 없습니다. 특정 날짜가 있는 일정만 연기 가능합니다."
        from datetime import datetime as _dt2
        old_date = _dt2.strptime(s.date, "%Y-%m-%d").date()
        new_date = old_date + timedelta(days=days_to_postpone)
        new_date_str = new_date.strftime("%Y-%m-%d")
        s.date = new_date_str
        s.day_of_week = new_date.weekday()
        s.user_override = True  # 이후 재계획에서 덮어쓰지 않음
        db.commit()
        return f"📅 '{s.title}' → {new_date_str}({DAY_NAMES[s.day_of_week]})로 연기 완료!"

    elif tool_name == "update_exam":
        from datetime import datetime as _dt3
        eid = tool_input["exam_id"]
        e = db.query(ExamSchedule).filter(ExamSchedule.id == eid, ExamSchedule.user_id == user_id).first()
        if not e:
            return f"❌ ID {eid} 시험 일정을 찾을 수 없습니다."
        for f in ["title", "subject", "exam_time", "location"]:
            if f in tool_input:
                setattr(e, f, tool_input[f])
        if "exam_date" in tool_input:
            try:
                e.exam_date = _dt3.strptime(tool_input["exam_date"], "%Y-%m-%d").date()
            except ValueError:
                return f"❌ 날짜 형식이 올바르지 않습니다: {tool_input['exam_date']} (YYYY-MM-DD)"
        db.commit()
        db.refresh(e)
        exam_date_str = e.exam_date.strftime("%Y-%m-%d") if hasattr(e.exam_date, "strftime") else e.exam_date
        return f"✅ 시험 '{e.title}' 수정 완료!\n📅 {exam_date_str}" + (f"  과목: {e.subject}" if e.subject else "")

    elif tool_name == "delete_exam":
        eid = tool_input["exam_id"]
        e = db.query(ExamSchedule).filter(ExamSchedule.id == eid, ExamSchedule.user_id == user_id).first()
        if not e:
            return f"❌ ID {eid} 시험 일정을 찾을 수 없습니다."
        exam_title = e.title
        # 연관된 AI 생성 학습 일정 소프트 삭제
        linked_study = db.query(Schedule).filter(
            Schedule.user_id == user_id,
            Schedule.linked_exam_id == eid,
            Schedule.schedule_source == "ai_generated",
        ).all()
        cleaned = 0
        for ls in linked_study:
            if not ls.deleted_by_user:
                ls.deleted_by_user = True
                cleaned += 1
        db.delete(e)
        db.commit()
        cleaned_msg = f"\n🧹 연관 학습 일정 {cleaned}개 자동 정리" if cleaned > 0 else ""
        return f"🗑️ 시험 '{exam_title}' 삭제 완료!{cleaned_msg}"

    elif tool_name == "list_syllabus_analyses":
        from app.syllabus.models import SyllabusAnalysis as _SyllabusAnalysis
        analyses = (
            db.query(_SyllabusAnalysis)
            .filter(
                _SyllabusAnalysis.user_id == user_id,
                _SyllabusAnalysis.analysis_status != "failed",
            )
            .all()
        )
        subject_filter = (tool_input.get("subject") or "").strip().lower()
        if subject_filter:
            analyses = [a for a in analyses if subject_filter in a.subject_name.lower()]
        if not analyses:
            return "📭 분석된 강의계획서가 없습니다. 먼저 강의계획서를 업로드하세요."
        lines = ["📋 강의계획서 분석 결과:\n"]
        for a in analyses:
            lines.append(f"\n📚 **{a.subject_name}** (분석상태: {a.analysis_status})")
            weights = []
            if a.midterm_weight is not None:
                weights.append(f"중간고사 {a.midterm_weight}%")
            if a.final_weight is not None:
                weights.append(f"기말고사 {a.final_weight}%")
            if a.assignment_weight is not None:
                weights.append(f"과제 {a.assignment_weight}%")
            if a.attendance_weight is not None:
                weights.append(f"출석 {a.attendance_weight}%")
            if a.presentation_weight is not None:
                weights.append(f"발표 {a.presentation_weight}%")
            if weights:
                lines.append(f"  평가비율: {' / '.join(weights)}")
            if a.exam_dates:
                try:
                    for e in json.loads(a.exam_dates):
                        etype = {"midterm": "중간고사", "final": "기말고사"}.get(e.get("type", ""), e.get("type", "시험"))
                        lines.append(f"  📝 {etype}: {e.get('date', '?')} {e.get('title', '')}")
                except Exception:
                    pass
            if a.assignment_dates:
                try:
                    for ad in json.loads(a.assignment_dates):
                        lines.append(f"  📌 과제: {ad.get('date', '?')} {ad.get('title', '')}")
                except Exception:
                    pass
            if a.weekly_topics:
                try:
                    topics = json.loads(a.weekly_topics)
                    if topics:
                        preview_strs = []
                        for _t in topics[:4]:
                            if isinstance(_t, dict):
                                preview_strs.append(f"{_t.get('week','')}주차 {_t.get('topic','')}")
                            elif isinstance(_t, str):
                                preview_strs.append(_t)
                        suffix = " ..." if len(topics) > 4 else ""
                        lines.append(f"  주차별: {', '.join(preview_strs)}{suffix}")
                except Exception:
                    pass
        return "\n".join(lines)

    elif tool_name == "import_syllabus_exams":
        from app.syllabus.models import SyllabusAnalysis as _SyllabusAnalysis
        from datetime import datetime as _dt
        subject = (tool_input.get("subject") or "").strip()
        if not subject:
            return "❌ 과목명을 지정해 주세요."
        analysis = (
            db.query(_SyllabusAnalysis)
            .filter(
                _SyllabusAnalysis.user_id == user_id,
                _SyllabusAnalysis.subject_name.ilike(f"%{subject}%"),
                _SyllabusAnalysis.analysis_status != "failed",
            )
            .first()
        )
        if not analysis:
            return f"❌ '{subject}' 강의계획서 분석 결과가 없습니다."
        imported = []
        if analysis.exam_dates:
            try:
                for e in json.loads(analysis.exam_dates):
                    date_str = e.get("date")
                    if not date_str:
                        continue
                    try:
                        exam_date_obj = _dt.strptime(date_str, "%Y-%m-%d").date()
                    except ValueError:
                        continue
                    etype = e.get("type", "exam")
                    title = e.get("title") or f"{analysis.subject_name} {'중간고사' if etype == 'midterm' else '기말고사' if etype == 'final' else '시험'}"
                    # 중복 확인
                    exists = db.query(ExamSchedule).filter(
                        ExamSchedule.user_id == user_id,
                        ExamSchedule.exam_date == exam_date_obj,
                        ExamSchedule.subject == analysis.subject_name,
                    ).first()
                    if not exists:
                        exam = ExamSchedule(
                            user_id=user_id,
                            title=title,
                            exam_date=exam_date_obj,
                            subject=analysis.subject_name,
                            exam_time=e.get("time"),
                        )
                        db.add(exam)
                        imported.append(f"  📝 {title} ({date_str})")
            except Exception as ex:
                logger.warning(f"import_syllabus_exams exam error: {ex}")
        db.commit()
        if not imported:
            return f"ℹ️ '{subject}' 강의계획서에서 새로 가져올 시험 일정이 없습니다 (이미 등록됐거나 날짜 정보 없음)."
        return f"✅ '{subject}' 강의계획서에서 시험 {len(imported)}개 등록 완료!\n" + "\n".join(imported)

    return f"❌ 알 수 없는 도구: {tool_name}"


# ─── OpenAI-format tool list ─────────────────────────────────────────────────

def _build_tools() -> list:
    return [
        {"type": "function", "function": spec}
        for spec in TOOLS_SPEC
    ]


# ─── main agent entry point ───────────────────────────────────────────────────

def run_ai_agent(
    db: Session,
    user_id: int,
    user_message: str,
    conversation_history: list | None = None,
) -> str:
    if not settings.GEMINI_API_KEY and not settings.OPENAI_API_KEY:
        return "AI 서비스 키가 설정되지 않았습니다. 관리자에게 문의하세요."

    today = date.today()
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)

    system_prompt = f"""당신은 AI 시간표 및 일정 관리 어시스턴트입니다. 한국어로 친절하게 응답합니다.

## 현재 날짜
- 오늘: {today.strftime("%Y년 %m월 %d일")} ({DAY_NAMES[today.weekday()]})  ISO: {today.isoformat()}
- 내일: {tomorrow.isoformat()} ({DAY_NAMES[tomorrow.weekday()]})
- 모레: {day_after.isoformat()} ({DAY_NAMES[day_after.weekday()]})

## 날짜 표현 변환
"내일"→{tomorrow.isoformat()}, "모레"→{day_after.isoformat()}, "오늘"→{today.isoformat()}

## ⛔ 원문 보존 (최우선 — 절대 위반 금지)
- 사용자가 입력한 과목명/시험명/일정 제목은 절대 수정하지 마라.
- Do NOT modify user-provided subject names or schedule titles.
- title 필드에는 사용자가 말한 원문을 그대로 사용할 것.
- 예: "운영체제 스터디" → title="운영체제 스터디" (단어 변형·번역·생략 금지)

## 일정 관리 규칙
1. 추가/수정/삭제 요청을 정확히 인식합니다.
2. 특정 날짜("내일 3시" 등) → date=YYYY-MM-DD 사용
3. 반복 수업("매주 월요일") → day_of_week 사용
4. 일정 추가/수정 전에 check_conflicts로 충돌 확인
5. 제목·날짜·시간 중 필수 정보 누락 시 사용자에게 질문
6. 긴급 일정은 priority=2
7. 수정 대상 모호 시 list_schedules로 목록 확인 후 ID 특정

## 시험 일정 등록
- 사용자가 시험(중간/기말/자격증/토익 등)을 언급하면 반드시 add_exam_schedule 사용
- add_schedule이 아닌 add_exam_schedule로 저장해야 학습 계획 생성에 활용됨

## 학습 계획 생성 프로토콜 (순서 필수 준수)
사용자가 학습 계획·시간표 생성을 요청하면 아래 순서를 따르라:

1. **컨텍스트 수집** (반드시 먼저 호출)
   - list_syllabus_analyses → 강의계획서 분석 결과 확인 (주차별 주제, 평가 비율)
   - list_exam_schedules → 등록된 시험 일정 확인

2. **시험 연동**
   - 강의계획서에 시험 날짜가 있고 exam_schedules에 없으면 → import_syllabus_exams 제안

3. **일정 생성 방식 결정**
   - 시험이 있으면 → generate_exam_prep_schedule
     * 내부적으로 시험 종류를 분석해 토익이면 LC/RC 파트별, 자격증이면 과목별, 대학 과목이면 주차별 구체적 task를 생성
   - 시험이 없으면 → generate_study_schedule
     * 내부적으로 강의계획서 주차 기반 또는 과목 분석 기반 구체적 task를 생성

## ⛔ 학습 태스크 제목 금지 규칙 (절대 위반 금지)
아래 패턴은 어떤 상황에서도 생성하면 안 된다:
- ❌ "[과목명] 공부", "[과목명] 학습", "[과목명] 복습"
- ❌ "[시험명] 준비", "[시험명] 시험 공부"
- ❌ "복습하기", "공부하기", "정리하기" (단독 사용)

모든 학습 일정 제목은 반드시:
✅ "구체적 행동 + 범위/챕터/문제수" 형식이어야 함
- "LC Part 2 질응답 문제 25개 풀기 + 오답 분석"
- "운영체제 3~4주차 CPU Scheduling 선점·비선점 개념 정리"
- "자료구조 4장 트리 순회(전위/중위/후위) 구현 연습"
- "정보처리기사 1과목 기출 2023년 1회 1~25번 풀기"
- "토익 RC Part 5 문법 문제 30개 + 틀린 유형 분류"

작업 완료 후 결과를 간결하게 안내하세요."""

    # 대화 히스토리 구성
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for msg in (conversation_history or []):
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    tools = _build_tools()

    for _ in range(15):
        try:
            response = _create_chat_completion(messages, tools)
        except Exception as _exc:
            logger.error(f"run_ai_agent completion error: {_exc}")
            return "AI 응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."

        assistant_msg = response.choices[0].message

        # tool call 없으면 최종 텍스트 반환
        if not assistant_msg.tool_calls:
            return assistant_msg.content or "응답을 생성하지 못했습니다."

        # assistant 메시지를 히스토리에 추가
        messages.append({
            "role": "assistant",
            "content": assistant_msg.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in assistant_msg.tool_calls
            ],
            "reasoning_details": getattr(assistant_msg, "reasoning_details", None),
        })

        # 각 tool 실행 후 결과 추가
        for tc in assistant_msg.tool_calls:
            try:
                tool_input = json.loads(tc.function.arguments) if tc.function.arguments else {}
            except json.JSONDecodeError:
                tool_input = {}
            result = _execute_tool(tc.function.name, tool_input, db, user_id)
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    return "응답 생성 중 문제가 발생했습니다. 다시 시도해 주세요."
