"""
LLM helper — OpenAI only.

Entry points
  call_llm(prompt, temperature)        → LLMResult  (text / model)
  call_llm_vision(image_path, ...)     → LLMResult  (text / model)

LLMResult attributes
  .text     / .content  — response text (aliases)
  .model    — "gpt-4.1"
  .provider — "openai"
  .status   — "success"

Raises LLMError (or a subclass) on failure.
"""
import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Model identifiers ─────────────────────────────────────────────────────────
OPENAI_MODEL = "gpt-4.1"


# ── Return type ───────────────────────────────────────────────────────────────

@dataclass
class LLMResult:
    """Unified response from call_llm / call_llm_vision."""
    content: str                          # response text
    status: str                           # "success"
    provider: str                         # "openai"
    model: str                            # exact model string
    reasoning_details: Any | None = field(default=None)

    @property
    def text(self) -> str:
        return self.content


# ── Exception hierarchy ───────────────────────────────────────────────────────

class LLMError(RuntimeError):
    """Base exception for all LLM failures."""

class LLMRateLimitedError(LLMError):
    """429 / quota exhausted / rate-limit."""

class LLMProviderUnavailableError(LLMError):
    """503 / network error / invalid key / model not found."""

class LLMEmptyResponseError(LLMError):
    """HTTP 200 but empty / null choices — model offline."""


# ── Error classification helpers ──────────────────────────────────────────────

def _is_quota(exc: Exception) -> bool:
    s = str(exc)
    return (
        "429" in s
        or "RESOURCE_EXHAUSTED" in s
        or "quota" in s.lower()
        or "PerDay" in s
        or "rate_limit" in s.lower()
        or "rate limit" in s.lower()
    )

def _is_unavailable(exc: Exception) -> bool:
    s = str(exc)
    return "503" in s or "UNAVAILABLE" in s or "unavailable" in s.lower()

def _is_timeout(exc: Exception) -> bool:
    s, t = str(exc), type(exc).__name__
    return (
        "timeout" in s.lower()
        or "Timeout" in t
        or "DeadlineExceeded" in s
        or "timed out" in s.lower()
    )

def _is_auth(exc: Exception) -> bool:
    s = str(exc)
    return (
        "401" in s
        or "403" in s
        or "invalid api key" in s.lower()
        or "API_KEY_INVALID" in s
        or "authentication" in s.lower()
    )

def _is_not_found(exc: Exception) -> bool:
    s = str(exc)
    return "404" in s or "NotFoundError" in type(exc).__name__ or "No endpoints found" in s

def _classify(exc: Exception) -> LLMError:
    """Map any exception to a typed LLMError subclass."""
    if _is_quota(exc):
        return LLMRateLimitedError(str(exc))
    if _is_timeout(exc) or _is_unavailable(exc) or _is_auth(exc) or _is_not_found(exc):
        return LLMProviderUnavailableError(str(exc))
    return LLMError(str(exc))


# ── OpenAI ────────────────────────────────────────────────────────────────────

def call_openai(prompt: str, temperature: float = 0.2) -> str:
    """
    Call OpenAI text model. Returns raw response string.
    Raises LLMError subclass on any failure.
    """
    if not settings.OPENAI_API_KEY:
        raise LLMProviderUnavailableError("OPENAI_API_KEY not configured")

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
        )
    except Exception as exc:
        raise _classify(exc) from exc

    if not resp.choices:
        raise LLMEmptyResponseError("OpenAI returned empty choices")
    msg = resp.choices[0].message
    if msg is None:
        raise LLMEmptyResponseError("OpenAI choice[0].message is None")

    text = msg.content or ""
    if not text:
        raise LLMEmptyResponseError("OpenAI returned empty content")

    return text


def _call_openai_vision(
    image_path: str,
    content_type: str,
    prompt: str,
    temperature: float = 0.1,
) -> str:
    """Call OpenAI Vision model. Returns raw response string."""
    if not settings.OPENAI_API_KEY:
        raise LLMProviderUnavailableError("OPENAI_API_KEY not configured")

    import base64
    try:
        from openai import OpenAI
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}", "detail": "high"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            temperature=temperature,
        )
    except Exception as exc:
        raise _classify(exc) from exc

    if not resp.choices:
        raise LLMEmptyResponseError("OpenAI Vision returned empty choices")
    msg = resp.choices[0].message
    if msg is None:
        raise LLMEmptyResponseError("OpenAI Vision choice[0].message is None")

    text = msg.content or ""
    if not text:
        raise LLMEmptyResponseError("OpenAI Vision returned empty content")

    return text


# ── Public interface ──────────────────────────────────────────────────────────

def call_llm(prompt: str, temperature: float = 0.2) -> LLMResult:
    """OpenAI 텍스트 모델 호출."""
    try:
        text = call_openai(prompt, temperature)
        return LLMResult(content=text, status="success", provider="openai", model=OPENAI_MODEL)
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(str(exc)) from exc


def call_llm_vision(
    image_path: str,
    content_type: str,
    prompt: str,
    temperature: float = 0.1,
) -> LLMResult:
    """OpenAI Vision 모델 호출."""
    try:
        text = _call_openai_vision(image_path, content_type, prompt, temperature)
        return LLMResult(content=text, status="success", provider="openai", model=OPENAI_MODEL)
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(str(exc)) from exc
