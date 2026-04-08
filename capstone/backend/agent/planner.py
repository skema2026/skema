# backend/agent/planner.py

from textwrap import dedent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

__all__ = ["create_planner_prompt", "plan_output_parser"]

# 도구 설명 (이 부분은 오류가 없으므로 그대로 유지)
_TOOL_SPEC = dedent("""
1.  **web_search**: 최신 정보, 뉴스, 사실 등 일반적인 웹 검색이 필요할 때 사용합니다.
    - args: {% raw %}{{"query": "<검색어>"}}{% endraw %}
2.  **fetch_recommendations**: 사용자에게 콘텐츠(영화, 음악, 전시 등)를 추천해달라고 명시적으로 요청할 때 사용합니다.
    - args: {% raw %}{{"types": "<movie|music|exhibition>", "limit": 5}}{% endraw %}
3.  **create_event**: 사용자의 캘린더에 새 일정을 '등록'합니다. **실제 티켓 예매가 아닌, 스케줄 관리가 목적입니다.**
    - args: {% raw %}{{"title": "<일정 제목>", "start": "<ISO 형식 시작 시간>", "end": "<ISO 형식 종료 시간>"}}{% endraw %}
4.  **summarize_text**: 주어진 긴 텍스트를 요약합니다.
    - args: {% raw %}{{"text": "<요약할 텍스트>"}}{% endraw %}
5.  **translate_text**: 텍스트를 다른 언어로 번역합니다.
    - args: {% raw %}{{"text": "<번역할 텍스트>", "target_lang": "<목표 언어 코드>"}}{% endraw %}
6.  **generate_image**: DALL-E를 사용해 이미지를 생성합니다.
    - args: {% raw %}{{"prompt": "<이미지 생성 프롬프트>"}}{% endraw %}
7.  **extract_best_title**: 검색 결과에서 가장 적절한 제목 하나만 깔끔하게 추출합니다. 일정 제목을 만들 때 사용하세요.
    - args: {% raw %}{{"text_to_process": "<이전 단계의 텍스트 결과>"}}{% endraw %}
8.  **get_weather**: 지정한 도시의 현재 기온과 날씨 코드를 JSON 으로 반환합니다.
    - args: {"location": "<도시명>", "units": "metric"}
""").strip()

# ‼️ [수정] .format()을 사용하지 않고 안전하게 프롬프트를 조립하는 함수
def create_planner_prompt(current_time_str: str) -> ChatPromptTemplate:
    """
    현재 시간을 인자로 받아 동적으로 프롬프트를 생성합니다.
    .format()과 Jinja2의 문법 충돌을 원천적으로 방지하기 위해 f-string과 문자열 결합을 사용합니다.
    """

    # 파트 1: 동적 컨텍스트 (f-string으로 안전하게 시간 주입)
    part1_dynamic_context = dedent(f"""
    You are an expert task-planner. Your goal is to create a JSON plan of tool calls to fulfill the user's request.

    ## CONTEXT
    - **Your most important context is the current time: {current_time_str}**

    ## AVAILABLE TOOLS
    """)

    # 파트 2: 정적 규칙 및 예시 (Jinja2 문법 포함)
    part2_static_rules_and_example = dedent("""
    ## RULES
    1.  **Your top priority is to resolve relative dates and times (e.g., "this weekend", "tomorrow") into absolute ISO-8601 timestamps based on the current time provided above.**
    2.  Interpret requests to 'book' or 'reserve' (e.g., "예약해줘") as a request to SCHEDULE an event on the calendar using `create_event`. This does not book tickets.
    3.  For multi-part requests (e.g., "find X and schedule it"), first use a search tool, then use `create_event`.
    4.  If an argument's value depends on a previous step's output, use the placeholder `{% raw %}{{step_N_output}}{% endraw %}`.
    5.  You must respond **only** with the JSON object.
    6. If the user asks to schedule an outdoor / weather-dependent event (keywords: "야외","날씨","기상","비 올","우천"), you MUST first call `get_weather` (if available). Only create the calendar event AFTER obtaining weather info. If `get_weather` tool is unavailable, use `web_search` with a weather query first.
    7. Never create an event before gathering mandatory context (e.g., weather) required to decide feasibility.
    8. If user gives a Korean city name (예: "서울"), convert to its standard English form (Seoul) before calling `get_weather`.
    9.  **`extract_best_title` MUST NEVER appear as the first step or be used alone.** It can ONLY be used *immediately after* a `web_search` or `fetch_recommendations` step, consuming that direct output via {% raw %}{{step_N_output}}{% endraw %}.  
        - If the user asks a simple factual / definitional / explanatory / translation / yes-no question that does **not** require selecting a single title, DO NOT use `extract_best_title`.  
        - If you only need to schedule an event with an explicitly given title (e.g., "내일 3시에 팀 회의 잡아줘"), DO NOT use `extract_best_title`.  
        - INVALID patterns: `[{"tool":"extract_best_title", ...}]`, or having it after `create_event`, or separated from the search by unrelated steps.
        - VALID pattern: `web_search` -> `extract_best_title` -> `create_event`.

    ## EXAMPLE
    USER: "이번 주말에 볼만한 액션 영화를 찾아서, 토요일 저녁 8시에 보도록 일정에 추가해줘."
    ASSISTANT SHOULD output:
    {% raw %}
    {
      "steps": [
        {
          "tool": "web_search",
          "args": {"query": "추천 최신 액션 영화"}
        },
        {
          "tool": "extract_best_title",
          "args": {"text_to_process": "{{step_1_output}}"}
        },
        {
          "tool": "create_event",
          "args": {
            "title": "{{step_2_output}}",
            "start": "<CALCULATED_WEEKEND_DATETIME_START>",
            "end": "<CALCULATED_WEEKEND_DATETIME_END>"
          }
        }
      ]
    }
    {% endraw %}
    """)

    # 최종 시스템 메시지를 안전하게 결합
    final_system_message = f"{part1_dynamic_context}\n{_TOOL_SPEC}\n{part2_static_rules_and_example}"

    # ChatPromptTemplate을 생성하여 반환
    return ChatPromptTemplate.from_messages(
        [("system", final_system_message), ("human", "{{input}}")],
        template_format="jinja2",
    )

# JSON 파서
plan_output_parser: JsonOutputParser = JsonOutputParser()