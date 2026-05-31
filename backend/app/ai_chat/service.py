"""AI 에이전트 진입점.

전체 흐름:
  1. 시스템 프롬프트 + 대화 히스토리 구성
  2. OpenAI 호출 → tool_calls 있으면 executor로 실행
  3. 실행 결과를 메시지에 추가하고 다시 OpenAI 호출
  4. tool_calls 없는 응답이 오면 최종 텍스트 반환 (최대 15회 반복)
"""
import json
import logging
from datetime import date, timedelta

from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import settings
from app.ai_chat.tools import build_tools
from app.ai_chat.executor import _execute_tool
from app.core.time_utils import DAY_NAMES

logger = logging.getLogger(__name__)


# ── OpenAI 호출 ───────────────────────────────────────────────────────────────

def _chat_completion(messages: list, tools: list):
    """tool calling 방식으로 OpenAI chat completion을 생성한다."""
    from app.core.llm import OPENAI_MODEL
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    return client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )


# ── AI 에이전트 ───────────────────────────────────────────────────────────────

def run_ai_agent(
    db: Session,
    user_id: int,
    user_message: str,
    conversation_history: list | None = None,
) -> str:
    if not settings.OPENAI_API_KEY:
        return "AI 서비스 키가 설정되지 않았습니다. 관리자에게 문의하세요."

    today = date.today()
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)

    system_prompt = f"""당신은 AI 시간표 및 일정 관리 어시스턴트입니다.

## 언어 규칙 (절대 준수)
- 반드시 한국어로만 응답하라. 영어 단어·문장·설명을 절대 사용하지 마라.
- 도구 호출 결과가 영어로 와도 응답은 항상 한국어로 작성하라.


## 현재 날짜
- 오늘: {today.strftime("%Y년 %m월 %d일")} ({DAY_NAMES[today.weekday()]})  ISO: {today.isoformat()}
- 내일: {tomorrow.isoformat()} ({DAY_NAMES[tomorrow.weekday()]})
- 모레: {day_after.isoformat()} ({DAY_NAMES[day_after.weekday()]})

## 날짜 표현 변환
"내일"→{tomorrow.isoformat()}, "모레"→{day_after.isoformat()}, "오늘"→{today.isoformat()}

## 원문 보존 (최우선 — 절대 위반 금지)
- 사용자가 입력한 과목명/시험명/일정 제목은 절대 수정하지 마라.
- title 필드에는 사용자가 말한 원문을 그대로 사용할 것.

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

## 답변 형식 (반드시 준수)
- 중요한 내용은 <<<텍스트>>> 형식으로 감싸라. 예: <<<오늘 오후 3시>>>
- 글머리 기호(•)는 진짜 목록이 필요할 때만 사용하라. 일반 문장에는 쓰지 마라.
- ** 기호는 절대 사용하지 마라.
- 이모지 사용 금지.
- 불필요한 인사말·맺음말 금지."""

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for msg in (conversation_history or []):
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    tools = build_tools()

    for _ in range(15):
        try:
            response = _chat_completion(messages, tools)
        except Exception as exc:
            logger.error(f"run_ai_agent completion error: {exc}")
            return "AI 응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."

        assistant_msg = response.choices[0].message

        if not assistant_msg.tool_calls:
            return assistant_msg.content or "응답을 생성하지 못했습니다."

        messages.append({
            "role": "assistant",
            "content": assistant_msg.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in assistant_msg.tool_calls
            ],
            "reasoning_details": getattr(assistant_msg, "reasoning_details", None),
        })

        for tc in assistant_msg.tool_calls:
            try:
                tool_input = json.loads(tc.function.arguments) if tc.function.arguments else {}
            except json.JSONDecodeError:
                tool_input = {}
            result = _execute_tool(tc.function.name, tool_input, db, user_id)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "응답 생성 중 문제가 발생했습니다. 다시 시도해 주세요."
