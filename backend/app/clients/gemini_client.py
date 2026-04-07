"""
Gemini API 클라이언트 모듈.
AI 채팅에 사용할 도구(Tool) 정의 및 API 호출을 담당.
실제 비즈니스 로직은 schedule/service.py에 있으며, 여기서는 API 통신만 처리.
"""
from app.core.config import settings

# ── Function Calling 도구 정의 ────────────────────────────────────────────────
# AI가 호출할 수 있는 도구 목록. 실제 구현은 schedule/service.py에 있음.

TOOLS_SPEC = [
    {
        "name": "add_schedule",
        "description": (
            "새 일정을 추가합니다. 반복 수업이면 day_of_week 사용, "
            "특정 날짜 이벤트이면 date(YYYY-MM-DD) 사용합니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "일정 제목"},
                "day_of_week": {"type": "integer", "description": "요일 0=월~6=일. date 있으면 자동 계산"},
                "date": {"type": "string", "description": "특정 날짜 YYYY-MM-DD"},
                "start_time": {"type": "string", "description": "시작 시간 HH:MM"},
                "end_time": {"type": "string", "description": "종료 시간 HH:MM"},
                "location": {"type": "string", "description": "장소 (선택)"},
                "color": {"type": "string", "description": "색상 hex (선택)"},
                "priority": {"type": "integer", "description": "우선순위 0=보통 1=높음 2=긴급"},
                "schedule_type": {"type": "string", "description": "class/event/study"},
            },
            "required": ["title", "start_time", "end_time"],
        },
    },
    {
        "name": "update_schedule",
        "description": "기존 일정을 수정합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "수정할 일정 ID"},
                "title": {"type": "string"},
                "day_of_week": {"type": "integer"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "start_time": {"type": "string", "description": "HH:MM"},
                "end_time": {"type": "string", "description": "HH:MM"},
                "location": {"type": "string"},
                "color": {"type": "string"},
                "priority": {"type": "integer"},
                "is_completed": {"type": "boolean"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "delete_schedule",
        "description": "일정을 삭제합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "삭제할 일정 ID"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "list_schedules",
        "description": "등록된 일정 목록을 조회합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "filter_date": {"type": "string", "description": "특정 날짜 YYYY-MM-DD 필터"},
                "filter_type": {"type": "string", "description": "all/class/event/study"},
            },
        },
    },
    {
        "name": "find_free_slots",
        "description": "특정 날짜 또는 요일의 빈 시간대를 찾습니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "day_of_week": {"type": "integer", "description": "요일 0=월~6=일"},
                "date": {"type": "string", "description": "특정 날짜 YYYY-MM-DD"},
                "duration_minutes": {"type": "integer", "description": "최소 시간(분), 기본 60"},
            },
        },
    },
    {
        "name": "check_conflicts",
        "description": "일정 추가/수정 전 시간 충돌 여부를 확인합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "day_of_week": {"type": "integer"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "start_time": {"type": "string", "description": "HH:MM"},
                "end_time": {"type": "string", "description": "HH:MM"},
                "exclude_id": {"type": "integer", "description": "수정 시 자기 자신 제외"},
            },
            "required": ["start_time", "end_time"],
        },
    },
    {
        "name": "generate_study_schedule",
        "description": "기존 일정·수면 시간·시험 일정을 고려해 학습 시간표를 자동 생성합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "학습 과목/내용"},
                "target_days": {"type": "integer", "description": "생성 기간(일수), 기본 7"},
                "daily_study_hours": {"type": "number", "description": "하루 목표 학습 시간(시간 단위), 기본 2"},
            },
            "required": ["subject"],
        },
    },
    {
        "name": "reschedule_incomplete",
        "description": "미완료 상태인 일정을 오늘 이후 빈 시간대에 자동으로 재배치합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "target_days": {"type": "integer", "description": "재배치 탐색 기간(일수), 기본 7"},
            },
        },
    },
    {
        "name": "list_exam_schedules",
        "description": "등록된 시험 일정 목록을 조회합니다. 학습 계획 생성 전에 항상 먼저 호출하세요.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "generate_exam_prep_schedule",
        "description": (
            "시험 일정을 기준으로 역산하여 기존 수업·일정 사이의 빈 슬롯에 학습 일정을 자동 생성합니다. "
            "시험이 가까울수록 학습 강도가 높아지며, 색상으로 긴급도를 표시합니다. "
            "사용자가 시험 대비 또는 전반적인 시간표 생성을 요청하면 이 도구를 우선 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "exam_id": {"type": "integer", "description": "특정 시험 ID (미지정 시 모든 예정 시험 대상)"},
                "target_days": {"type": "integer", "description": "학습 일정 생성 기간(일수), 기본 14"},
                "daily_study_hours": {"type": "number", "description": "기본 하루 학습 시간(시간), 기본 2. 시험 임박 시 자동 증가"},
            },
        },
    },
]


# ── Gemini Tool 빌더 ─────────────────────────────────────────────────────────

def build_genai_tool():
    """TOOLS_SPEC을 google-genai Tool 객체로 변환."""
    from google.genai import types

    type_map = {
        "string": "STRING",
        "integer": "INTEGER",
        "number": "NUMBER",
        "boolean": "BOOLEAN",
        "object": "OBJECT",
    }

    function_declarations = []
    for spec in TOOLS_SPEC:
        props = {}
        for prop_name, prop_def in spec["parameters"].get("properties", {}).items():
            props[prop_name] = types.Schema(
                type=type_map.get(prop_def.get("type", "string"), "STRING"),
                description=prop_def.get("description", ""),
            )

        fd = types.FunctionDeclaration(
            name=spec["name"],
            description=spec["description"],
            parameters=types.Schema(
                type="OBJECT",
                properties=props,
                required=spec["parameters"].get("required", []),
            ),
        )
        function_declarations.append(fd)

    return types.Tool(function_declarations=function_declarations)


# ── 채팅 세션 생성 ────────────────────────────────────────────────────────────

def create_chat_session(system_prompt: str, history: list):
    """Gemini 채팅 세션 생성."""
    from google import genai
    from google.genai import types

    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다.")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    return client.chats.create(
        model=settings.GEMINI_MODEL,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=[build_genai_tool()],
        ),
        history=history,
    )


# ── 메시지 송수신 ─────────────────────────────────────────────────────────────

def send_message(chat, message):
    """채팅 세션에 메시지(str 또는 Part 리스트)를 전송하고 응답 반환."""
    return chat.send_message(message)


def extract_text(response) -> str:
    """응답에서 텍스트 파트를 추출해 이어붙인 문자열 반환."""
    return "".join(
        part.text
        for part in response.candidates[0].content.parts
        if part.text
    )


def extract_function_calls(response) -> list:
    """응답에서 function_call 파트 목록 반환. 없으면 빈 리스트."""
    return [
        part.function_call
        for part in response.candidates[0].content.parts
        if part.function_call is not None
    ]


def make_function_response_parts(fn_calls: list, tool_results: list):
    """tool_results 문자열 목록을 FunctionResponse Part 객체 리스트로 변환."""
    from google.genai import types

    return [
        types.Part.from_function_response(
            name=fc.name,
            response={"result": result},
        )
        for fc, result in zip(fn_calls, tool_results)
    ]


def history_to_contents(conversation_history: list) -> list:
    """dict 형태의 대화 히스토리를 google-genai Content 객체 리스트로 변환."""
    from google.genai import types

    return [
        types.Content(
            role="model" if msg["role"] == "assistant" else "user",
            parts=[types.Part.from_text(text=msg["content"])],
        )
        for msg in conversation_history
    ]
