"""LLM 호출 헬퍼 — ai_chat 전용."""
import json
import logging

from openai import OpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)


def call_llm(prompt: str, temperature: float = 0.2) -> str:
    """OpenAI 텍스트 모델 호출."""
    from app.core.llm import call_llm as _call_llm
    result = _call_llm(prompt, temperature=temperature)
    return result.content


def create_chat_completion(messages: list, tools: list):
    """OpenAI function/tool calling 채팅 completion을 생성한다."""
    from app.core.llm import OPENAI_MODEL

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다.")

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    return client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )


def extract_json_array(text: str) -> list:
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        return []
    return json.loads(text[start:end])
