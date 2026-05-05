"""강의계획서 컨텍스트 추출 및 학습 task 생성."""
import json
import logging
import re

from sqlalchemy.orm import Session

from app.ai_chat.llm_client import call_llm, extract_json_array

logger = logging.getLogger(__name__)

_FORBIDDEN_TASK_WORDS = frozenset([
    "공부", "학습", "복습하기", "준비하기", "시험 준비", "공부하기", "학습하기",
    "복습", "준비", "공부 및 복습", "시험공부",
])
_VAGUE_PATTERN = re.compile(r"^[^\d]{0,12}(공부|학습|복습|준비)(하기|하다)?$", re.UNICODE)

_PHASE_TYPE  = {"early": "study",   "mid": "practice", "late": "review"}
_PHASE_PRIO  = {"early": 1,         "mid": 1,          "late": 2}
_PHASE_LABEL = {
    "early": "초반 — 개념/기초 이해",
    "mid":   "중반 — 문제풀이/심화/패턴 분석",
    "late":  "말기 — 실전 모의고사/오답 총정리/약점 보완",
}


def get_syllabus_context(db: Session, user_id: int, subject: str) -> str:
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
        if analysis.weekly_topics:
            try:
                topics_raw = json.loads(analysis.weekly_topics)
                if isinstance(topics_raw, list) and topics_raw:
                    topic_lines = []
                    for i, item in enumerate(topics_raw[:16]):
                        if isinstance(item, dict):
                            w = item.get('week', i + 1)
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
        if analysis.assignment_dates:
            try:
                assignments = json.loads(analysis.assignment_dates)
                if isinstance(assignments, list) and assignments:
                    assign_lines = [
                        f"{a.get('title', '과제')} (마감: {a.get('due_date', '?')})"
                        for a in assignments[:4] if isinstance(a, dict)
                    ]
                    if assign_lines:
                        parts.append("과제: " + ", ".join(assign_lines))
            except Exception:
                pass
        if analysis.important_factors:
            try:
                factors = json.loads(analysis.important_factors)
                if factors:
                    parts.append("중요 사항: " + " / ".join(str(f) for f in factors[:4]))
            except Exception:
                pass
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
        logger.warning(f"get_syllabus_context failed: {e}")
        return ""


def get_weekly_scope(db: Session, user_id: int, subject: str, exam_type: str) -> list[dict]:
    """강의계획서 study_mapping에서 시험 범위 주차를 읽어 weekly_topics 항목을 반환."""
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
        logger.warning(f"get_weekly_scope failed: {e}")
        return []


def weekly_topics_to_tasks(weekly_topics: list[dict], subject: str) -> list[dict]:
    """weekly_topics JSON → 구체적 study task 목록. LLM 없이 직접 생성."""
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


def scope_to_syllabus_context(scope_items: list[dict], exam_type: str) -> str:
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


def validate_task_quality(title: str) -> bool:
    """True = 구체적 task / False = 너무 추상적."""
    t = re.sub(r"^📚\s*", "", title.strip())
    if len(t) < 6:
        return False
    if len(t) <= 16 and any(w in t for w in _FORBIDDEN_TASK_WORDS):
        return False
    if _VAGUE_PATTERN.match(t):
        return False
    if re.search(r"\d", t):
        return True
    return len(t) >= 25


def pick_phase(days_until_exam: int) -> str:
    if days_until_exam <= 3:
        return "late"
    if days_until_exam <= 10:
        return "mid"
    return "early"


def analyze_exam_requirements(
    exam_title: str,
    subject: str,
    syllabus_context: str = "",
    days_until_exam: int = 14,
) -> list[dict]:
    """시험 종류를 AI로 분석해 phase별 구체적 준비 컴포넌트와 task 목록을 반환."""
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
- 기타 외부시험: 준비 영역을 논리적으로 분해 후 각 영역별 task

【task 제목 필수 규칙】
✅ 필수: "구체적 행동 + 범위/챕터/문제수"
❌ 절대 금지: "{subject} 공부", "{exam_title} 준비", "복습하기", "시험 공부", "학습하기"

【phase 분류】
- early: 개념 이해 + 기초 학습 (D-11 이상)
- mid  : 문제풀이 + 심화 + 오답 분석 (D-4 ~ D-10)
- late : 실전 모의고사 + 총정리 + 약점 집중 보완 (D-3 이내)

각 component당 tasks 3~5개. JSON 배열만 반환:
[{{"component": "...", "phase": "early|mid|late", "tasks": [{{"title": "...", "estimated_minutes": 60, "reason": "..."}}]}}]"""

    try:
        content = call_llm(prompt, temperature=0.2)
        components = extract_json_array(content)
        if isinstance(components, list) and components:
            normalized = []
            for comp in components:
                if not isinstance(comp, dict):
                    continue
                norm_tasks = []
                for t in comp.get("tasks", []):
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
        logger.warning(f"analyze_exam_requirements failed: {e}")
    return []


def get_subject_study_tasks(
    subject: str,
    syllabus_context: str = "",
    daily_hours: float = 2.0,
) -> list[dict]:
    """특정 과목에 대한 구체적인 학습 task 풀을 AI로 생성."""
    syllabus_section = (
        f"\n\n강의계획서 정보 (주차별 주제 기반으로 task 생성 — 필수):\n{syllabus_context}"
        if syllabus_context else ""
    )
    prompt = f"""당신은 학습 계획 전문가입니다.

과목: {subject}
하루 학습 목표: {daily_hours}시간{syllabus_section}

위 과목의 구체적인 학습 task 15개를 생성하세요.

【규칙】
1. 강의계획서(주차별 주제)가 있으면 각 주차 주제를 구체적인 task로 변환
2. 강의계획서가 없으면: 과목명을 분석해 단원·유형 기반으로 구체화
3. ❌ 절대 금지: "{subject} 공부", "{subject} 학습", "복습하기", "문제풀기"
4. task_type: study(개념)/practice(문제풀이)/review(복습)/assignment(과제)
5. priority: 1(기본), 2(중요 단원)

JSON 배열만 반환:
[{{"title": "...", "task_type": "study", "priority": 1, "estimated_minutes": 60, "reason": "..."}}]"""

    try:
        content = call_llm(prompt, temperature=0.3)
        tasks = extract_json_array(content)
        if isinstance(tasks, list) and tasks:
            filtered = [
                {
                    "title": t["title"].strip(),
                    "task_type": t.get("task_type", "study"),
                    "priority": int(t.get("priority") or 1),
                    "estimated_minutes": int(t.get("estimated_minutes") or 60),
                    "reason": str(t.get("reason") or ""),
                }
                for t in tasks
                if isinstance(t, dict) and validate_task_quality(t.get("title", ""))
            ]
            return filtered or tasks
    except Exception as e:
        logger.warning(f"get_subject_study_tasks failed: {e}")
    return []


def get_personalized_study_tasks(
    exam_title: str,
    subject: str,
    days_until_exam: int,
    completed_blocks: int,
    total_blocks: int,
    syllabus_context: str = "",
    exam_components: list[dict] | None = None,
) -> list[dict]:
    """학습 task 목록 반환. exam_components 있으면 phase-aware 선택, 없으면 AI 직접 생성."""
    phase = pick_phase(days_until_exam)

    if exam_components:
        target = [c for c in exam_components if c.get("phase") == phase] or exam_components
        tasks = [
            {"title": t.strip(), "task_type": _PHASE_TYPE[phase], "priority": _PHASE_PRIO[phase]}
            for comp in target
            for t in comp.get("tasks", [])
            if isinstance(t, str) and t.strip()
        ]
        if tasks:
            return tasks

    progress_pct = int(completed_blocks / total_blocks * 100) if total_blocks > 0 else 0
    syllabus_section = f"\n강의계획서 정보:\n{syllabus_context}" if syllabus_context else ""
    prompt = f"""당신은 학습 계획 전문가입니다.

시험: {exam_title} / 과목: {subject}
D-{days_until_exam} / 진행률: {progress_pct}% / 현재 단계: {_PHASE_LABEL[phase]}{syllabus_section}

【필수 규칙】
✅ task 제목 = "구체적 행동 + 범위 또는 문제수 또는 챕터"
❌ 절대 금지: "{subject} 공부", "{subject} 학습", "{exam_title} 준비", "복습하기", "공부하기"

현재 단계({_PHASE_LABEL[phase]})에 맞는 task 12개를 JSON 배열로만 반환:
[{{"title": "...", "task_type": "study|practice|review|mock", "priority": 0|1|2, "estimated_minutes": 60, "reason": "..."}}]"""

    try:
        content = call_llm(prompt, temperature=0.25)
        tasks = extract_json_array(content)
        if isinstance(tasks, list) and tasks:
            filtered = [
                {
                    "title": t["title"].strip(),
                    "task_type": t.get("task_type", _PHASE_TYPE[phase]),
                    "priority": int(t.get("priority") or _PHASE_PRIO[phase]),
                    "estimated_minutes": int(t.get("estimated_minutes") or 60),
                    "reason": str(t.get("reason") or ""),
                }
                for t in tasks
                if isinstance(t, dict) and validate_task_quality(t.get("title", ""))
            ]
            return filtered or tasks
    except Exception as e:
        logger.warning(f"get_personalized_study_tasks failed: {e}")
    return []
