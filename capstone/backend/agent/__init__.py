# backend/agent/__init__.py

from __future__ import annotations
import os, json, datetime as dt
from typing import List, Dict, Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.memory import ConversationBufferWindowMemory
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.tools import BaseTool
from langchain_core.tools import tool
from pydantic import BaseModel, Field

from .tools import make_toolset
from .planner import create_planner_prompt, plan_output_parser
from .executor import StepExecutor

import models
from routers.gcal import build_gcal_service
from routers.search import google_search_cse

# ─────────────────────────── Gemini LLM 인스턴스
_llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.2,
)

_planner_llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.2,
)

# ── pydantic 스키마 ───────────────────────────
class CreateEventArgs(BaseModel):
    title: str  = Field(..., description="일정 제목")
    start: str  = Field(..., description="ISO-8601 시작")
    end:   str  = Field(..., description="ISO-8601 종료")

class DeleteEventArgs(BaseModel):
    event_id: str

class WebSearchArgs(BaseModel):
    query: str
    k: int = 5

class GenImgArgs(BaseModel):
    prompt: str = Field(..., description="이미지 생성 프롬프트")

class RecArgs(BaseModel):
    types: str
    limit: int = 5
# ─────────────────────────────────────────────


def tz_label(tz: dt.tzinfo) -> str:
    return getattr(tz, "key", None) or tz.tzname(None) or "UTC"

def _make_time_system_prompt(client_tz: ZoneInfo) -> str:
    now_local     = dt.datetime.now(client_tz)
    now_client    = now_local.isoformat(timespec="seconds")
    today_str     = now_local.date().isoformat()
    tomorrow_str  = (now_local.date() + dt.timedelta(days=1)).isoformat()

    afternoon_example = (now_local.replace(hour=13, minute=0, second=0) +
                     dt.timedelta(days=(0 if now_local.hour < 13 else 1))).isoformat()

    system_prompt = (
        "You are an AI assistant that can also manage the user's Google Calendar.\n"
        f"⏱️ **Current client time ({tz_label(client_tz)}):** {now_client}\n\n"

        "## CALENDAR INSTRUCTIONS\n"
        f"- Today's date is {today_str} in timezone {tz_label(client_tz)}\n"
        f"- Tomorrow's date is {tomorrow_str}\n"
        f"- Current hour is {now_local.hour}\n"
        "- When user mentions '오늘' (today), use today's date\n"
        "- When user mentions '내일' (tomorrow), use tomorrow's date\n"
        "- '오전' means AM, '오후' means PM\n"
        f"- Example: '오늘 오후 1시' should be interpreted as {afternoon_example}\n"
        "- ALWAYS create events in the FUTURE (after current time)\n"
        "- ALWAYS use the create_event tool for calendar requests\n\n"

        "## TOOL USAGE GUIDELINES\n"
        "- Use calendar tools (create_event, delete_event) when the user wants to manage their schedule\n"
        "- Use web_search when the user asks for current information or news\n"
        "- Use generate_image when the user asks to create or visualize an image\n\n"

        "## ABOUT THE RECOMMENDATION TOOL\n"
        "The fetch_recommendations tool should ONLY be used when:\n"
        "1. The user is EXPLICITLY asking for content suggestions, recommendations, or options\n"
        "2. The user is asking what to watch, read, or consume\n"
        "3. The user uses phrases like '추천해줘', '뭐 볼까?', '어떤 게 좋을까?'\n\n"

        "NEVER use fetch_recommendations for:\n"
        "1. Technical explanations (e.g., 'React란 무엇인가?', 'TypeScript의 장점')\n"
        "2. Factual questions (e.g., '파이썬 함수 정의 방법', '한국의 수도는?')\n"
        "3. General conversation or advice\n\n"

        "If no tool is appropriate, just respond with a direct text answer. Most queries should be answered with text, not tools.\n"
    )
    print(system_prompt)
    return system_prompt

def format_tool_to_str(tool) -> str:
    fields = getattr(tool, "args_schema", None)
    sample_args: dict[str, str] = {}
    if fields:
        for name, field in fields.__fields__.items():
            tp = (
                getattr(field, "annotation", None)
                or getattr(field, "outer_type_", None)
                or str
            )
            type_name = getattr(tp, "__name__", str(tp))
            sample_args[name] = f"<{type_name}>"
    return f"{tool.name} – {tool.description or ''}"

def build_prompt(tools: list[BaseTool], tz: ZoneInfo) -> ChatPromptTemplate:
    tool_block  = "\n".join(format_tool_to_str(t) for t in tools)
    system_str  = _make_time_system_prompt(tz)

    system_message = ("system",
             f"{system_str}\n\n"
             "You have access to the following tools:\n"
             f"{tool_block}\n"
             "When handling calendar requests:\n"
             "1. ALWAYS convert relative times to absolute ISO datetime\n"
             "2. ALWAYS check that the time is in the future\n"
             "3. ALWAYS include timezone information\n"
             "4. NEVER respond with natural language for calendar requests - use the tool\n\n"
             "When you need a tool, reply **only** with the JSON shown in the example -- "
             "no markdown, no extra keys, no natural-language."
            )
    print(system_message)

    return ChatPromptTemplate.from_messages(
        [
            system_message,
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ]
    )

def _clean_history(messages: list[models.Message]) -> list[tuple[str,str]]:
    """기능-응답(✅/🗑️/❗/JSON) 제거 후 (role,text) 튜플 반환"""
    cleaned = []
    for m in messages[-15:]:
        if m.role == "assistant":
            t = m.content.strip()
            if t.startswith(("✅", "🗑️", "❗", "📷", '{"card_id', '{"prompt')):
                continue
        cleaned.append((m.role, m.content))
    return cleaned

# ─────────────────────────── 에이전트
def build_agent(
    db: Session,
    user: models.User,
    tz: ZoneInfo = ZoneInfo("UTC"),
    history: list[models.Message] | None = None,
) -> AgentExecutor:
    # 1) Memory – 윈도우 기반 (최근 6 exchanges)
    memory = ConversationBufferWindowMemory(
        memory_key="chat_history",
        input_key="input",
        k=6,
        return_messages=True,
    )
    for role, text in _clean_history(history or []):
        (memory.chat_memory.add_user_message if role == "user"
         else memory.chat_memory.add_ai_message)(text)

    # 2) tools & prompt
    tools  = make_toolset(db, user, tz, _llm)
    prompt = build_prompt(tools, tz)

    # 3) agent → executor
    agent = create_tool_calling_agent(_llm, tools, prompt)
    exec_   = AgentExecutor(
        agent   = agent,
        tools   = tools,
        memory  = memory,
        verbose = True,
        max_iterations      = 4,
        handle_parsing_errors = True,
        early_stopping_method = "force",
    )
    return exec_


# ───────── LCEL 기반 Plan-and-Execute 1-회 실행 ──────────
def run_lcel_once(
    db: Session,
    user: models.User,
    tz: ZoneInfo,
    history: list[models.Message] | None = None,
    user_input: str | None = None,
) -> dict:
    """
    LLM이 계획을 세우고(Plan), 각 단계를 순차적으로 실행(Execute)합니다.
    """
    # ── 0) 입력 확정 ──────────────────────────────────────
    if user_input is None:
        if not history:
            raise ValueError("run_lcel_once: history or user_input is required.")

        last_user_message_content = None
        for message in reversed(history):
            if message.role == 'user':
                last_user_message_content = message.content
                break

        if last_user_message_content is None:
            return {"output": "이전 대화에서 사용자님의 메시지를 찾을 수 없습니다."}
        user_input = last_user_message_content

    # ── 1) 플래너 호출 (계획 수립) ─────────────────────────
    now_in_client_tz = dt.datetime.now(tz)
    plan_prompt = create_planner_prompt(current_time_str=now_in_client_tz.isoformat())

    plan_chain = plan_prompt | _planner_llm | plan_output_parser

    print("\n" + "=" * 70)
    print(f"🕵️ 1. PLANNER INPUT: '{user_input}'")

    prompt_value = plan_prompt.invoke({"input": user_input})
    print("\n" + "-" * 25 + " 💌 FINAL PROMPT TO LLM " + "-" * 25)
    for message in prompt_value.to_messages():
        print(f"[{message.type.upper()}]")
        print(message.content)
        print("---")
    print("-" * 75)

    raw_plan = (plan_prompt | _planner_llm).invoke({"input": user_input})
    print("\n" + "-" * 25 + " 🤖 RAW LLM OUTPUT " + "-" * 26)
    print(raw_plan.content)
    print("-" * 75)

    # 1) JSON 파싱
    try:
        plan = plan_output_parser.parse(raw_plan.content)
    except Exception as e:
        print(f"[WARN] plan_output_parser failed: {e}")
        import re
        txt = raw_plan.content.strip()
        if txt.startswith("```"):
            txt = re.sub(r"^```(?:json)?", "", txt).strip()
            if txt.endswith("```"):
                txt = txt[:-3].strip()
        try:
            plan = json.loads(txt)
        except Exception as e2:
            print(f"\n❌ ERROR: Failed to parse plan JSON. {e2}")
            return {"output": "에이전트가 응답을 생성하는 데 실패했습니다. (plan parse)"}

    # 2) (선택) 플랜 사전 조정
    try:
        from .plan_validate import adjust_plan_if_needed
        adjusted = adjust_plan_if_needed(plan, user_input)
        if adjusted:
            print("[PLAN ADJUST] plan modified (e.g., inserted weather step)")
    except Exception as ve:
        print(f"[VALIDATOR ERROR] {ve}")

    print("\n📝 2. PARSED PLAN:\n", json.dumps(plan, indent=2, ensure_ascii=False))

    # ── 2) 단계별 실행 (Executor 사용) ───────────────────
    step_executor = StepExecutor(db, user, tz, _planner_llm)

    step_outputs: dict[str, str] = {}
    logs: list[dict] = []

    if not plan.get("steps"):
        print("\n🤷 NO STEPS TO EXECUTE. Returning default response.")
    else:
        for idx, step in enumerate(plan.get("steps", [])):
            result = step_executor.execute_step(step, step_outputs)
            step_key = f"step_{idx + 1}_output"
            step_outputs[step_key] = result.get("output", "")
            logs.append(result)

    print("=" * 70 + "\n")

    # ── 3) 최종 출력 ─────────────────────────
    if logs:
        weather_raw = None
        event_raw   = None
        title_raw   = None

        for i, step in enumerate(plan.get("steps", []), start=1):
            if step.get("tool") in ("get_weather", "weather", "mcp_get_weather"):
                weather_raw = step_outputs.get(f"step_{i}_output")

            if step.get("tool") == "create_event":
                event_raw = step_outputs.get(f"step_{i}_output")

            if step.get("tool") == "extract_best_title":
                title_raw = step_outputs.get(f"step_{i}_output")

        weather_summary = None
        if weather_raw:
            try:
                if isinstance(weather_raw, dict):
                    w = weather_raw
                else:
                    w = json.loads(weather_raw) if weather_raw.strip().startswith("{") else {}
                if isinstance(w, dict):
                    temp = w.get("temp")
                    ws   = w.get("windspeed")
                    code = w.get("conditions_code")
                    loc  = w.get("location")
                    weather_summary = f"{loc or '지역'} 현재 예상 기온 {temp}°C, 풍속 {ws} m/s (code {code})"
            except Exception:
                weather_summary = f"날씨 정보: {str(weather_raw)[:120]}"

        if isinstance(title_raw, str):
            clean_title = title_raw.strip().strip('"').splitlines()[0][:80]
        else:
            clean_title = None

        event_msg = event_raw or ""

        parts = []
        if weather_summary:
            parts.append(weather_summary)
        elif weather_raw:
            parts.append(str(weather_raw))

        if clean_title:
            parts.append(f"선택된 추천 제목: {clean_title}")

        if event_msg:
            parts.append(event_msg)

        final_answer = "\n".join(parts) if parts else logs[-1].get("output", "실행은 완료되었지만 결과가 없습니다.")
        return {"output": final_answer}

    return {"output": "알겠습니다. 어떻게 도와드릴까요?"}
