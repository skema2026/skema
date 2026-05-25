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
        "name": "add_exam_schedule",
        "description": (
            "시험 일정을 추가합니다. 사용자가 시험 날짜/과목을 언급하면 이 툴을 사용하세요. "
            "일반 일정(add_schedule)이 아닌 시험 전용 테이블에 저장되어 학습 계획 생성에 활용됩니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "시험 제목 (예: '알고리즘 중간고사')"},
                "exam_date": {"type": "string", "description": "시험 날짜 YYYY-MM-DD"},
                "subject": {"type": "string", "description": "과목명 (선택)"},
                "exam_time": {"type": "string", "description": "시험 시작 시간 HH:MM (선택)"},
                "location": {"type": "string", "description": "시험 장소 (선택)"},
            },
            "required": ["title", "exam_date"],
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
        "name": "complete_schedule",
        "description": (
            "일정을 완료 처리합니다. '완료했어', '다 했어', '끝냈어' 등의 표현에 사용하세요. "
            "완료된 일정은 이후 AI 재계획에서 다시 생성되지 않습니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "완료할 일정 ID"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "postpone_schedule",
        "description": (
            "특정 날짜 일정을 지정한 일수만큼 연기합니다. "
            "'내일로 연기', '하루 미뤄', '3일 뒤로' 등의 표현에 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "integer", "description": "연기할 일정 ID"},
                "days": {"type": "integer", "description": "연기할 일수, 기본 1"},
            },
            "required": ["schedule_id"],
        },
    },
    {
        "name": "update_exam",
        "description": "시험 일정의 날짜·제목·과목·시간·장소를 수정합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "exam_id": {"type": "integer", "description": "수정할 시험 ID"},
                "title": {"type": "string", "description": "새 제목"},
                "exam_date": {"type": "string", "description": "새 날짜 YYYY-MM-DD"},
                "subject": {"type": "string", "description": "새 과목명"},
                "exam_time": {"type": "string", "description": "새 시작 시간 HH:MM"},
                "location": {"type": "string", "description": "새 장소"},
            },
            "required": ["exam_id"],
        },
    },
    {
        "name": "delete_exam",
        "description": (
            "시험 일정을 삭제합니다. 해당 시험을 위해 AI가 생성한 학습 일정도 함께 정리됩니다. "
            "'시험 삭제', '시험 일정 지워줘' 등의 표현에 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "exam_id": {"type": "integer", "description": "삭제할 시험 ID"},
            },
            "required": ["exam_id"],
        },
    },
    {
        "name": "generate_review_schedule",
        "description": (
            "에빙하우스 망각 곡선에 기반한 복습 일정을 자동으로 생성합니다. "
            "사용자가 '복습 일정 만들어줘', '복습 계획 짜줘', '에빙하우스', "
            "'복습 스케줄', '망각 곡선' 등을 언급하면 이 툴을 사용하세요. "
            "학습일로부터 1·3·7·14·30일 후에 복습 일정을 배치합니다. "
            "시험일이 있으면 시험 전날까지만 생성합니다."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "과목/주제명 (예: '알고리즘', '운영체제 2단원')"},
                "learn_date": {"type": "string", "description": "최초 학습 날짜 YYYY-MM-DD. 미입력 시 오늘"},
                "exam_date": {"type": "string", "description": "시험 날짜 YYYY-MM-DD (선택). 있으면 시험 전날까지만 복습 생성"},
                "duration_minutes": {"type": "integer", "description": "복습당 소요 시간(분), 기본 60"},
                "preferred_start_time": {"type": "string", "description": "선호 복습 시작 시간 HH:MM (선택). 없으면 빈 시간에 자동 배치"},
            },
            "required": ["subject"],
        },
    },
]


def build_tools() -> list:
    return [{"type": "function", "function": spec} for spec in TOOLS_SPEC]
