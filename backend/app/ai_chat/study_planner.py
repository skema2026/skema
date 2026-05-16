"""학습 task 생성 및 phase 분석.

phase 시스템:
  early (D-11~)  → 개념/기초 이해
  mid   (D-4~10) → 문제풀이/심화
  late  (D-0~3)  → 실전 모의고사/총정리
"""
import json
import logging
import re

from openai import OpenAI

from app.core.config import settings


# ── LLM 호출 헬퍼 ─────────────────────────────────────────────────────────────

def call_llm(prompt: str, temperature: float = 0.2) -> str:
    """단순 텍스트 프롬프트 → 응답 문자열."""
    from app.core.llm import call_llm as _call_llm
    result = _call_llm(prompt, temperature=temperature)
    return result.content


def extract_json_array(text: str) -> list:
    """LLM 응답에서 JSON 배열만 파싱해 반환."""
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        return []
    return json.loads(text[start:end])

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
    days_until_exam: int = 14,
) -> list[dict]:
    """시험 종류를 AI로 분석해 phase별 구체적 준비 컴포넌트와 task 목록을 반환."""
    prompt = f"""당신은 학습 계획 전문가입니다.

시험 정보:
- 시험명: {exam_title}
- 과목/분야: {subject}
- 시험까지 남은 일수: {days_until_exam}일

【시험 종류별 전략 — 반드시 아래 기준 적용】
- 토익(TOEIC): LC Part1(사진묘사10)/Part2(질응답25)/Part3(짧은대화39)/Part4(담화30), RC Part5(단문공란)/Part6(장문공란)/Part7(독해), 어휘암기, 실전모의고사 단위로 분리
- IELTS/TOEFL: Listening/Reading/Writing/Speaking 영역별 분리 + 각 섹션 유형 기반 task
- 정보처리기사/컴활 등 자격증: 과목별 체계 분석 → 단원별 기출문제 + 개념 정리로 분리
- 대학교 중간/기말고사: 과목명 분석 → 주차별 주제를 구체적 task로 변환
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
    daily_hours: float = 2.0,
) -> list[dict]:
    """특정 과목에 대한 구체적인 학습 task 풀을 AI로 생성."""
    prompt = f"""당신은 학습 계획 전문가입니다.

과목: {subject}
하루 학습 목표: {daily_hours}시간

위 과목의 구체적인 학습 task 15개를 생성하세요.

【규칙】
1. 과목명을 분석해 단원·유형 기반으로 구체화
2. ❌ 절대 금지: "{subject} 공부", "{subject} 학습", "복습하기", "문제풀기"
3. task_type: study(개념)/practice(문제풀이)/review(복습)/assignment(과제)
4. priority: 1(기본), 2(중요 단원)

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
    prompt = f"""당신은 학습 계획 전문가입니다.

시험: {exam_title} / 과목: {subject}
D-{days_until_exam} / 진행률: {progress_pct}% / 현재 단계: {_PHASE_LABEL[phase]}

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
