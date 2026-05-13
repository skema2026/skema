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
                "sessions_per_week": {"type": "integer", "description": "주당 학습 횟수(1~7). 사용자가 '주 N일' 또는 '주 N회'를 언급하면 반드시 설정. 미지정 시 매일 생성"},
                "preferred_start_time": {"type": "string", "description": "선호 시작 시간 HH:MM (예: '07:00'). 사용자가 '몇 시부터'를 언급하면 반드시 설정"},
            },
        },
    },
    {
        "name": "list_syllabus_analyses",
        "description": (
            "업로드된 강의계획서의 AI 분석 결과를 조회합니다. "
            "과목별 평가 비율(중간/기말/과제/출석), 시험 일정, 과제 마감일, 주차별 주제를 확인할 수 있습니다. "
            "학습 계획 생성 전에 반드시 호출하여 강의계획서 데이터가 있는지 확인하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "특정 과목명 필터 (선택, 미지정 시 전체)"},
            },
        },
    },
    {
        "name": "import_syllabus_exams",
        "description": (
            "강의계획서 분석 결과에 있는 시험·과제 일정을 exam_schedules에 자동 등록합니다. "
            "사용자가 '강의계획서 일정 등록', '시험 일정 가져오기' 등을 요청할 때 사용하세요."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "가져올 과목명"},
            },
            "required": ["subject"],
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
]


def build_tools() -> list:
    return [{"type": "function", "function": spec} for spec in TOOLS_SPEC]
