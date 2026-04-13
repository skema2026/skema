"""
LLM helper — Gemini primary, OpenAI automatic fallback.

Entry points
  call_llm(prompt, temperature)        → LLMResult  (text / model)
  call_llm_vision(image_path, ...)     → LLMResult  (text / model)

Fallback behaviour
  1. call_gemini()  — tried first; any error triggers fallback
  2. call_openai()  — used when Gemini fails for any reason

LLMResult attributes
  .text     / .content  — response text (aliases)
  .model    — "gemini-2.5-flash" | "gpt-4o-mini"
  .provider — "gemini" | "openai"
  .status   — "success" | "fallback_used"

Raises LLMError (or a subclass) only when BOTH providers fail.
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Model identifiers ─────────────────────────────────────────────────────────
GEMINI_MODEL = "gemini-2.5-flash"
OPENAI_MODEL = "gpt-4o-mini"

# Gemini hard timeout (seconds) — prevents hanging requests
GEMINI_TIMEOUT = 30


# ── Return type ───────────────────────────────────────────────────────────────

@dataclass
class LLMResult:
    """Unified response from call_llm / call_llm_vision."""
    content: str                          # response text
    status: str                           # "success" | "fallback_used"
    provider: str                         # "gemini" | "openai"
    model: str                            # exact model string
    reasoning_details: Optional[Any] = field(default=None)

    # ── spec-compatible aliases ────────────────────────────────────────────
    @property
    def text(self) -> str:
        """Alias for .content — matches {"text": ..., "model": ...} spec."""
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


# ── Gemini ────────────────────────────────────────────────────────────────────

def call_gemini(prompt: str, temperature: float = 0.2) -> str:
    """
    Call Gemini text model. Returns raw response string.
    Raises LLMError subclass on any failure (including timeout).
    """
    if not settings.GEMINI_API_KEY:
        raise LLMProviderUnavailableError("GEMINI_API_KEY not configured")

    def _run() -> str:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        cfg = types.GenerateContentConfig(temperature=temperature)
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[types.Part.from_text(text=prompt)],
            config=cfg,
        )
        return resp.text or ""

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run)
            text = future.result(timeout=GEMINI_TIMEOUT)
    except FuturesTimeout:
        raise LLMProviderUnavailableError(
            f"Gemini timed out after {GEMINI_TIMEOUT}s"
        )
    except Exception as exc:
        raise _classify(exc) from exc

    if not text:
        raise LLMEmptyResponseError("Gemini returned empty text")

    return text


def _call_gemini_vision(
    image_path: str,
    content_type: str,
    prompt: str,
    temperature: float = 0.1,
) -> str:
    """Call Gemini Vision. Returns raw response string."""
    if not settings.GEMINI_API_KEY:
        raise LLMProviderUnavailableError("GEMINI_API_KEY not configured")

    def _run() -> str:
        from google import genai
        from google.genai import types
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        cfg = types.GenerateContentConfig(temperature=temperature)
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=content_type),
                types.Part.from_text(text=prompt),
            ],
            config=cfg,
        )
        return resp.text or ""

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run)
            text = future.result(timeout=GEMINI_TIMEOUT)
    except FuturesTimeout:
        raise LLMProviderUnavailableError(
            f"Gemini Vision timed out after {GEMINI_TIMEOUT}s"
        )
    except Exception as exc:
        raise _classify(exc) from exc

    if not text:
        raise LLMEmptyResponseError("Gemini Vision returned empty text")

    return text


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
                    {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}},
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
    """
    Main text entry point.

    1. Tries Gemini — any error (timeout, quota, auth, network) triggers fallback
    2. Falls back to OpenAI
    3. Raises LLMError if both fail

    Returns LLMResult with:
      .text / .content  — response text
      .model            — exact model used
      .provider         — "gemini" | "openai"
      .status           — "success" | "fallback_used"
    """
    # ── 1. Try Gemini ──────────────────────────────────────────────────────
    try:
        logger.info(f"LLM: calling Gemini ({GEMINI_MODEL})")
        text = call_gemini(prompt, temperature)
        logger.info("LLM: Gemini success")
        return LLMResult(
            content=text,
            status="success",
            provider="gemini",
            model=GEMINI_MODEL,
        )
    except LLMRateLimitedError as exc:
        logger.warning(f"LLM: Gemini rate-limited — falling back to OpenAI: {exc}")
    except LLMEmptyResponseError as exc:
        logger.warning(f"LLM: Gemini empty response — falling back to OpenAI: {exc}")
    except LLMProviderUnavailableError as exc:
        logger.warning(f"LLM: Gemini unavailable — falling back to OpenAI: {exc}")
    except LLMError as exc:
        logger.warning(f"LLM: Gemini error — falling back to OpenAI: {exc}")
    except Exception as exc:
        logger.warning(f"LLM: Gemini unexpected error — falling back to OpenAI: {exc}")

    # ── 2. Fallback: OpenAI ────────────────────────────────────────────────
    try:
        logger.info(f"LLM: calling OpenAI fallback ({OPENAI_MODEL})")
        text = call_openai(prompt, temperature)
        logger.info("LLM: OpenAI fallback success")
        return LLMResult(
            content=text,
            status="fallback_used",
            provider="openai",
            model=OPENAI_MODEL,
        )
    except LLMRateLimitedError as exc:
        logger.error(f"LLM: OpenAI rate-limited: {exc}")
        raise
    except LLMEmptyResponseError as exc:
        logger.error(f"LLM: OpenAI empty response: {exc}")
        raise
    except LLMProviderUnavailableError as exc:
        logger.error(f"LLM: OpenAI unavailable: {exc}")
        raise
    except LLMError as exc:
        logger.error(f"LLM: OpenAI error: {exc}")
        raise
    except Exception as exc:
        logger.error(f"LLM: OpenAI unexpected error: {exc}")
        raise LLMError(str(exc)) from exc


def call_llm_vision(
    image_path: str,
    content_type: str,
    prompt: str,
    temperature: float = 0.1,
) -> LLMResult:
    """
    Main vision entry point.

    1. Tries Gemini Vision — any error triggers fallback
    2. Falls back to OpenAI Vision
    3. Raises LLMError if both fail

    Returns LLMResult (same shape as call_llm).
    """
    # ── 1. Try Gemini Vision ───────────────────────────────────────────────
    try:
        logger.info(f"LLM Vision: calling Gemini ({GEMINI_MODEL})")
        text = _call_gemini_vision(image_path, content_type, prompt, temperature)
        logger.info("LLM Vision: Gemini success")
        return LLMResult(
            content=text,
            status="success",
            provider="gemini",
            model=GEMINI_MODEL,
        )
    except LLMRateLimitedError as exc:
        logger.warning(f"LLM Vision: Gemini rate-limited — falling back to OpenAI: {exc}")
    except LLMEmptyResponseError as exc:
        logger.warning(f"LLM Vision: Gemini empty response — falling back to OpenAI: {exc}")
    except LLMProviderUnavailableError as exc:
        logger.warning(f"LLM Vision: Gemini unavailable — falling back to OpenAI: {exc}")
    except LLMError as exc:
        logger.warning(f"LLM Vision: Gemini error — falling back to OpenAI: {exc}")
    except Exception as exc:
        logger.warning(f"LLM Vision: Gemini unexpected error — falling back to OpenAI: {exc}")

    # ── 2. Fallback: OpenAI Vision ─────────────────────────────────────────
    try:
        logger.info(f"LLM Vision: calling OpenAI fallback ({OPENAI_MODEL})")
        text = _call_openai_vision(image_path, content_type, prompt, temperature)
        logger.info("LLM Vision: OpenAI fallback success")
        return LLMResult(
            content=text,
            status="fallback_used",
            provider="openai",
            model=OPENAI_MODEL,
        )
    except LLMRateLimitedError as exc:
        logger.error(f"LLM Vision: OpenAI rate-limited: {exc}")
        raise
    except LLMEmptyResponseError as exc:
        logger.error(f"LLM Vision: OpenAI empty response: {exc}")
        raise
    except LLMProviderUnavailableError as exc:
        logger.error(f"LLM Vision: OpenAI unavailable: {exc}")
        raise
    except LLMError as exc:
        logger.error(f"LLM Vision: OpenAI error: {exc}")
        raise
    except Exception as exc:
        logger.error(f"LLM Vision: OpenAI unexpected error: {exc}")
        raise LLMError(str(exc)) from exc
