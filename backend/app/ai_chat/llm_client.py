"""LLM 호출 헬퍼 — ai_chat 전용."""
import json
import logging

from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)


def call_llm(prompt: str, temperature: float = 0.2) -> str:
    """LLM 텍스트 호출. Gemini 실패 시 gpt-4.1 fallback."""
    from app.core.llm import call_llm as _call_llm
    result = _call_llm(prompt, temperature=temperature)
    return result.content


def create_chat_completion(messages: list, tools: list):
    """
    Gemini(OpenAI-compat) 우선 호출, 실패 시 gpt-4.1 fallback.
    둘 다 실패 시 RuntimeError.
    """
    from app.core.llm import OPENAI_MODEL

    if settings.GEMINI_API_KEY:
        try:
            client = OpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=settings.GEMINI_API_KEY,
            )
            return client.chat.completions.create(
                model="gemini-2.5-flash",
                messages=messages,
                tools=tools,
                tool_choice="auto",
            )
        except Exception as exc:
            logger.warning(f"Gemini chat completion failed, falling back to gpt-4.1: {exc}")

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY와 OPENAI_API_KEY가 모두 설정되지 않았습니다.")

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
