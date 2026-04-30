"""
강의계획서(실라버스) 분석 v2.

흐름:
  PDF/Word → extract_text() → call_llm_text(...) → parse() → AnalysisPayload
  이미지   → call_llm_vision(...) → parse()         → AnalysisPayload

모든 한국어 텍스트는 그대로 보존하며, 한자()로 치환하지 않습니다.
"""
import json
import logging
import warnings
from app.utils.text_validation import normalize_korean_field

import pdfplumber

# pdfminer FontBBox 경고 억제 (PDF 폰트 파싱 오류가 분석을 중단시키지 않도록)
warnings.filterwarnings("ignore", message=".*FontBBox.*cannot be parsed.*", category=UserWarning)
logging.getLogger("pdfminer").setLevel(logging.ERROR)
logging.getLogger("pdfplumber").setLevel(logging.ERROR)

from app.core.config import settings
from app.syllabus.schemas import AnalysisPayload

logger = logging.getLogger(__name__)

# 지원 MIME 타입
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_PDF_TYPE = "application/pdf"
_WORD_TYPES = {
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


# 섹션 1. 텍스트 추출 (PDF / Word)

def extract_text(file_path: str, content_type: str) -> str:
    """PDF / Word 파일에서 텍스트를 추출한다. 이미지는 빈 문자열 반환."""
    try:
        if content_type == _PDF_TYPE:
            return _extract_pdf(file_path)
        if content_type in _WORD_TYPES:
            return _extract_docx(file_path)
        return ""   # 이미지 입력: Gemini Vision으로 직접 처리
    except Exception as e:
        logger.warning(f"Text extraction failed for {file_path}: {e}")
        return ""


def _extract_pdf(path: str) -> str:
    lines = []
    with pdfplumber.open(path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            try:
                text = page.extract_text()
                if text:
                    lines.append(text)
            except Exception as e:
                # "e cannot be parsed as 4 floats" — bbox 파싱 실패 시 해당 페이지 건너뜀
                logger.warning(f"PDF page {page_num + 1} text extraction failed: {e} ??skipping page")
                try:
                    # bbox ?놁씠 ?⑥닚 몄옄?붿텧 (fallback)
                    words = page.extract_words()
                    if words:
                        lines.append(" ".join(w.get("text", "") for w in words))
                except Exception as e2:
                    logger.warning(f"PDF page {page_num + 1} fallback extraction also failed: {e2}")
    return "\n".join(lines)[:12000]


def _extract_docx(path: str) -> str:
    try:
        import docx
        doc = docx.Document(path)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:12000]
    except Exception as e:
        logger.warning(f"docx extraction failed: {e}")
        return ""


# 섹션 2. LLM 프롬프트 빌드

def _build_prompt(subject_name: str, syllabus_text: str) -> str:
    text_block = (
        syllabus_text.strip()
        if syllabus_text.strip()
        else "(텍스트가 비어 있습니다. 표·항목·평가 기준을 기준으로 주차별 계획과 평가 비율을 합리적으로 추정하세요.)"
    )

    return f"""subject_name: {subject_name}

syllabus_text:
{text_block}

You must return structured JSON only.
Do NOT return explanation, markdown, or any text outside the JSON.
Preserve Korean text exactly as written.\nDo NOT translate Korean.\nDo NOT replace Korean with Chinese characters.\nOutput must remain in Korean if the source is Korean.\nKeep subject names and topics exactly as in the source.

Return this exact JSON structure:

{{
  "subject_name": "{subject_name}",
  "midterm_week": 8,
  "final_week": 15,
  "weekly_plan": [
    {{
      "week": 1,
      "topic": "1주차 주제 (과목명에 맞게 작성)",
      "subtopics": ["세부 주제 1", "세부 주제 2"],
      "difficulty": "low",
      "keywords": ["핵심 개념 1", "핵심 개념 2", "핵심 개념 3"]
    }},
    {{
      "week": 2,
      "topic": "2주차 주제",
      "subtopics": ["세부 주제 1"],
      "difficulty": "medium",
      "keywords": ["키워드 1", "키워드 2"]
    }}
  ],
  "evaluation": {{
    "midterm": 30,
    "final": 40,
    "assignment": 20,
    "attendance": 10,
    "presentation": 0
  }},
  "exam_schedule": [
    {{"type": "midterm", "date": "YYYY-MM-DD"}},
    {{"type": "final",   "date": "YYYY-MM-DD"}}
  ],
  "assignments": [
    {{"title": "과제명", "due_date": "YYYY-MM-DD"}}
  ],
  "presentation": false,
  "important_notes": [
    "중요 사항 1",
    "중요 사항 2"
  ]
}}

Rules:
- All dates in YYYY-MM-DD. If year is missing, assume 2026.
- midterm_week: integer (1-16), the week number when the midterm exam occurs. Extract from "N주차 묎컙좎궗" patterns. If an exact date is available instead, set to null and put the date in exam_schedule.
- final_week: integer (1-16), the week number when the final exam occurs. Same logic as midterm_week.
- weekly_plan: up to 16 weeks. Infer topics from content if not explicitly stated. For each week:
  - topic: the main theme/chapter (Korean OK)
  - subtopics: 2-4 specific sub-items covered that week (e.g., algorithm names, concept names)
  - difficulty: "low" | "medium" | "high" — estimate based on typical university course progression
  - keywords: 3-5 key terms/concepts students must know for exams (English or Korean, as appropriate)
- evaluation weights must sum to 100. Distribute proportionally if some are missing.
- exam_schedule: include entries only when an exact date (YYYY-MM-DD) is known.
- presentation: true if syllabus mentions 발표, 프레젠테이션, presentation.
- important_notes: grading criteria, attendance rules, pass/fail conditions (Korean OK).
- If information is unavailable, use reasonable defaults for a Korean university course.
"""


# 섹션 3. AI 분석 호출


def _call_gemini_text(subject_name: str, raw_text: str) -> str:
    """OpenAI gpt-4.1로 강의계획서 텍스트를 분석한다."""
    from app.core.llm import call_openai
    prompt = _build_prompt(subject_name, raw_text)
    logger.info("Syllabus text analysis: calling OpenAI gpt-4.1 directly")
    return call_openai(prompt, temperature=0.1)


def _call_gemini_vision(image_path: str, content_type: str, subject_name: str) -> str:
    """OpenAI gpt-4.1 Vision으로 강의계획서 이미지를 분석한다."""
    from app.core.llm import _call_openai_vision
    prompt = _build_prompt(subject_name, "(이미지에서 텍스트를 먼저 추출(ocr)한 뒤 분석해 주세요)")
    logger.info("Syllabus vision analysis: calling OpenAI gpt-4.1 directly")
    return _call_openai_vision(image_path, content_type, prompt, temperature=0.1)


# 섹션 4. 응답 파싱


def _parse_response(content: str, subject_name: str) -> tuple["AnalysisPayload", str]:
    """
    AI 응답에서 JSON 추출 후 AnalysisPayload로 파싱.
    Returns (payload, status): status = "success" | "partial" | "failed"
    """
    start = content.find("{")
    end = content.rfind("}") + 1
    if start == -1 or end == 0:
        logger.warning("No JSON object found in AI response")
        return AnalysisPayload(), "failed"

    try:
        data = json.loads(content[start:end])
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse error: {e} | snippet={content[start:start+200]}")
        return AnalysisPayload(), "failed"

    evaluation = data.get("evaluation") or {}

    def _safe_int(val) -> int | None:
        try:
            return int(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    try:
        payload = AnalysisPayload(
            weekly_plan=_ensure_weekly_plan(data.get("weekly_plan") or []),
            midterm_weight=_safe_int(evaluation.get("midterm")),
            final_weight=_safe_int(evaluation.get("final")),
            assignment_weight=_safe_int(evaluation.get("assignment")),
            attendance_weight=_safe_int(evaluation.get("attendance")),
            presentation_weight=_safe_int(evaluation.get("presentation")),
            has_presentation=bool(data.get("presentation", False)),
            midterm_week=_safe_int(data.get("midterm_week")),
            final_week=_safe_int(data.get("final_week")),
            exam_schedule=_ensure_list(data.get("exam_schedule")),
            assignments=_ensure_list(data.get("assignments")),
            important_notes=_ensure_str_list(data.get("important_notes")),
        )
        has_any = any([payload.weekly_plan, payload.midterm_weight is not None, payload.exam_schedule])
        status = "success" if has_any else "partial"
        return payload, status
    except Exception as e:
        logger.warning(f"AnalysisPayload build error: {e}")
        return AnalysisPayload(), "partial"

def _sanitize_payload(payload: AnalysisPayload, raw_text_for_compare: str) -> AnalysisPayload:
    try:
        from app.utils.text_validation import normalize_korean_field
        wp = []
        for it in payload.weekly_plan:
            topic = it.get("topic", "")
            norm, review = normalize_korean_field(topic, raw_text_for_compare)
            it["topic"] = norm
            if review:
                payload.important_notes = (payload.important_notes or []) + [f"topic suspect: {topic}"]
            wp.append(it)
        payload.weekly_plan = wp
        assigns = []
        for it in payload.assignments:
            title = str(it.get("title", ""))
            norm, review = normalize_korean_field(title, raw_text_for_compare)
            it["title"] = norm
            assigns.append(it)
        payload.assignments = assigns
    except Exception:
        pass
    return payload
def _ensure_weekly_plan(raw) -> list:
    """[{week, topic, subtopics, difficulty, keywords}] ?먮뒗 ["1주차: ..."] ⑤몢 ?덉슜 ???뺢퇋??"""
    if not isinstance(raw, list):
        return []
    normalized = []
    for i, item in enumerate(raw):
        if isinstance(item, dict):
            subtopics = item.get("subtopics")
            if not isinstance(subtopics, list):
                subtopics = []
            keywords = item.get("keywords")
            if not isinstance(keywords, list):
                keywords = []
            difficulty = item.get("difficulty", "medium")
            if difficulty not in ("low", "medium", "high"):
                difficulty = "medium"
            normalized.append({
                "week": int(item.get("week", i + 1)),
                "topic": str(item.get("topic", "")),
                "subtopics": [str(s) for s in subtopics[:6]],
                "difficulty": difficulty,
                "keywords": [str(k) for k in keywords[:8]],
            })
        elif isinstance(item, str):
            normalized.append({
                "week": i + 1, "topic": item,
                "subtopics": [], "difficulty": "medium", "keywords": [],
            })
    return normalized[:16]


def _ensure_list(raw) -> list:
    return raw if isinstance(raw, list) else []


def _ensure_str_list(raw) -> list:
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if item]


# 섹션 5. 진입점

def analyze_syllabus(
    file_path: str,
    content_type: str,
    subject_name: str,
) -> tuple["AnalysisPayload", str, str, str]:
    """
    과목꾪쉷???뚯씪??꾩꽍?쒕떎.

    Returns:
        (payload, status, raw_text, reason)
        status : "success" | "partial" | "failed"
                 | "rate_limited" | "provider_unavailable" | "empty_response"
        reason : 실패 원인 메시지 (성공 시 빈 문자열)
    """
    from app.core.llm import (
        LLMEmptyResponseError,
        LLMProviderUnavailableError,
        LLMRateLimitedError,
        LLMError,
    )

    if not settings.GEMINI_API_KEY and not settings.OPENAI_API_KEY:
        logger.warning("GEMINI_API_KEY and OPENAI_API_KEY both not configured — skipping analysis")
        return AnalysisPayload(), "failed", "", "LLM API key not configured"

    # 이미지 입력: Vision 모델로 직접 분석
    if content_type in _IMAGE_TYPES:
        try:
            ai_response = _call_gemini_vision(file_path, content_type, subject_name)
        except LLMRateLimitedError as e:
            logger.warning(f"Vision rate limited: {e}")
            return AnalysisPayload(), "rate_limited", "", str(e)[:200]
        except LLMProviderUnavailableError as e:
            logger.warning(f"Vision provider unavailable: {e}")
            return AnalysisPayload(), "provider_unavailable", "", str(e)[:200]
        except LLMEmptyResponseError as e:
            logger.warning(f"Vision empty response: {e}")
            return AnalysisPayload(), "empty_response", "", str(e)[:200]
        except LLMError as e:
            logger.error(f"Vision LLM error: {e}")
            return AnalysisPayload(), "failed", "", str(e)[:200]
        except Exception as e:
            logger.error(f"Vision analysis failed: {e}")
            return AnalysisPayload(), "failed", "", str(e)[:200]

        payload, status = _parse_response(ai_response, subject_name)
        payload = _sanitize_payload(payload, "")
        return payload, status, "", ""

    # PDF / Word: 텍스트 추출 후 분석
    raw_text = extract_text(file_path, content_type)

    try:
        ai_response = _call_gemini_text(subject_name, raw_text)
    except LLMRateLimitedError as e:
        logger.warning(f"Text LLM rate limited: {e}")
        return AnalysisPayload(), "rate_limited", raw_text, str(e)[:200]
    except LLMProviderUnavailableError as e:
        logger.warning(f"Text LLM provider unavailable: {e}")
        return AnalysisPayload(), "provider_unavailable", raw_text, str(e)[:200]
    except LLMEmptyResponseError as e:
        logger.warning(f"Text LLM empty response: {e}")
        return AnalysisPayload(), "empty_response", raw_text, str(e)[:200]
    except LLMError as e:
        logger.error(f"Text LLM error: {e}")
        return AnalysisPayload(), "failed", raw_text, str(e)[:200]
    except Exception as e:
        logger.error(f"LLM analysis call failed: {e}")
        return AnalysisPayload(), "failed", raw_text, str(e)[:200]

    payload, status = _parse_response(ai_response, subject_name)
    payload = _sanitize_payload(payload, raw_text)
    return payload, status, raw_text, ""
