"""
Thin wrapper around the google-genai SDK.
All direct Gemini API calls are isolated here.
"""

from app.core.config import settings

# Tool spec shared with service layer (read-only, defined once here)
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


def build_genai_tool():
    """Convert TOOLS_SPEC into a google-genai Tool object."""
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


def create_chat_session(system_prompt: str, history: list):
    """
    Create and return a Gemini chat session.

    Parameters
    ----------
    system_prompt : str
        The system instruction text.
    history : list
        List of google.genai.types.Content objects for conversation history.
    """
    from google import genai
    from google.genai import types

    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    genai_tool = build_genai_tool()

    return client.chats.create(
        model="gemini-2.5-flash",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=[genai_tool],
        ),
        history=history,
    )


def send_message(chat, message):
    """Send a message (str or list of Parts) to the chat session and return the response."""
    return chat.send_message(message)


def extract_text(response) -> str:
    """Extract plain text from a Gemini response object."""
    return "".join(
        part.text
        for part in response.candidates[0].content.parts
        if part.text
    )


def extract_function_calls(response) -> list:
    """Return a list of function_call objects from the response, or empty list."""
    return [
        part.function_call
        for part in response.candidates[0].content.parts
        if part.function_call is not None
    ]


def make_function_response_parts(fn_calls: list, tool_results: list):
    """
    Build a list of FunctionResponse Part objects.

    Parameters
    ----------
    fn_calls : list
        Function call objects from the model response.
    tool_results : list[str]
        Parallel list of result strings from executing each tool call.
    """
    from google.genai import types

    parts = []
    for fc, result in zip(fn_calls, tool_results):
        parts.append(
            types.Part.from_function_response(
                name=fc.name,
                response={"result": result},
            )
        )
    return parts


def history_to_contents(conversation_history: list) -> list:
    """Convert plain dict conversation history to google-genai Content objects."""
    from google.genai import types

    contents = []
    for msg in conversation_history:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(
            types.Content(role=role, parts=[types.Part.from_text(text=msg["content"])])
        )
    return contents
