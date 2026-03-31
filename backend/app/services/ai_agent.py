from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.schedule import Schedule
from app.models.user import ExamSchedule, UserProfile

DAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
DAY_NAMES_SHORT = ["월", "화", "수", "목", "금", "토", "일"]

# ─── Tool definitions (OpenAPI-style, converted to Gemini format) ─────────────

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


# ─── helpers ──────────────────────────────────────────────────────────────────

def _t2m(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _m2t(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _overlap(s1: str, e1: str, s2: str, e2: str) -> bool:
    return _t2m(s1) < _t2m(e2) and _t2m(s2) < _t2m(e1)


def _dow(date_str: str) -> int:
    return datetime.strptime(date_str, "%Y-%m-%d").weekday()


def _day_schedules(db: Session, user_id: int, dow: int, date_str: str | None) -> list:
    recurring = (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.day_of_week == dow, Schedule.date.is_(None))
        .all()
    )
    if date_str:
        specific = (
            db.query(Schedule)
            .filter(Schedule.user_id == user_id, Schedule.date == date_str)
            .all()
        )
        seen = {s.id for s in recurring}
        for s in specific:
            if s.id not in seen:
                recurring.append(s)
    return recurring


# ─── tool execution ───────────────────────────────────────────────────────────

def _execute_tool(tool_name: str, tool_input: dict, db: Session, user_id: int) -> str:
    today = date.today()

    if tool_name == "add_schedule":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            dow = 0
        s = Schedule(
            user_id=user_id,
            title=tool_input["title"],
            day_of_week=dow,
            date=date_str,
            start_time=tool_input["start_time"],
            end_time=tool_input["end_time"],
            location=tool_input.get("location"),
            color=tool_input.get("color", "#6366F1"),
            priority=tool_input.get("priority", 0),
            schedule_type=tool_input.get("schedule_type", "event"),
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        label = date_str if date_str else f"매주 {DAY_NAMES[dow]}"
        loc = f"  📍 {s.location}" if s.location else ""
        return f"✅ '{s.title}' 추가 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}{loc}\n🆔 ID: {s.id}"

    elif tool_name == "update_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        for f in ["title", "day_of_week", "date", "start_time", "end_time", "location", "color", "priority", "is_completed"]:
            if f in tool_input:
                setattr(s, f, tool_input[f])
        if "date" in tool_input and tool_input["date"]:
            s.day_of_week = _dow(tool_input["date"])
        db.commit()
        db.refresh(s)
        label = s.date if s.date else f"매주 {DAY_NAMES[s.day_of_week]}"
        return f"✅ '{s.title}' 수정 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}"

    elif tool_name == "delete_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        title = s.title
        db.delete(s)
        db.commit()
        return f"🗑️ '{title}' 삭제 완료!"

    elif tool_name == "list_schedules":
        schedules = db.query(Schedule).filter(Schedule.user_id == user_id).all()
        ft = tool_input.get("filter_type", "all")
        fd = tool_input.get("filter_date")
        if ft and ft != "all":
            schedules = [s for s in schedules if s.schedule_type == ft]
        if fd:
            fd_dow = _dow(fd)
            schedules = [s for s in schedules if s.date == fd or (s.date is None and s.day_of_week == fd_dow)]
        if not schedules:
            return "📭 등록된 일정이 없습니다."
        picons = {0: "", 1: "🟡", 2: "🔴"}
        lines = [f"📋 일정 목록 ({len(schedules)}개):\n"]
        for s in sorted(schedules, key=lambda x: (x.day_of_week, x.start_time)):
            lbl = s.date if s.date else DAY_NAMES[s.day_of_week]
            icon = picons.get(s.priority or 0, "")
            line = f"  [ID:{s.id}] {icon} {s.title}  {lbl} {s.start_time}~{s.end_time}"
            if s.location:
                line += f"  ({s.location})"
            lines.append(line)
        return "\n".join(lines)

    elif tool_name == "find_free_slots":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        duration = tool_input.get("duration_minutes", 60)
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."
        existing = _day_schedules(db, user_id, dow, date_str)
        busy = sorted((_t2m(s.start_time), _t2m(s.end_time)) for s in existing)
        free, cursor = [], 8 * 60
        for bs, be in busy:
            if cursor + duration <= bs:
                free.append((_m2t(cursor), _m2t(bs)))
            cursor = max(cursor, be)
        if cursor + duration <= 22 * 60:
            free.append((_m2t(cursor), _m2t(22 * 60)))
        label = date_str if date_str else DAY_NAMES[dow]
        if not free:
            return f"😅 {label}에는 {duration}분 이상의 빈 시간이 없습니다."
        result = f"🕐 {label} 빈 시간대 ({duration}분 이상):\n"
        for s, e in free:
            result += f"  • {s} ~ {e}\n"
        return result

    elif tool_name == "check_conflicts":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        start_time = tool_input["start_time"]
        end_time = tool_input["end_time"]
        exclude_id = tool_input.get("exclude_id")
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."
        existing = _day_schedules(db, user_id, dow, date_str)
        conflicts = [
            s for s in existing
            if (exclude_id is None or s.id != exclude_id)
            and _overlap(start_time, end_time, s.start_time, s.end_time)
        ]
        label = date_str if date_str else DAY_NAMES[dow]
        if not conflicts:
            return f"✅ {label} {start_time}~{end_time} 시간대에 충돌이 없습니다."
        result = f"⚠️ 충돌 발견 ({label} {start_time}~{end_time}):\n"
        for s in conflicts:
            result += f"  • [ID:{s.id}] {s.title} ({s.start_time}~{s.end_time})\n"
        return result

    elif tool_name == "generate_study_schedule":
        subject = tool_input["subject"]
        target_days = tool_input.get("target_days", 7)
        daily_hours = tool_input.get("daily_study_hours", 2)
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        wake = _t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
        sleep = _t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")
        created = 0
        for offset in range(target_days):
            tdate = today + timedelta(days=offset)
            date_str = tdate.strftime("%Y-%m-%d")
            dow = tdate.weekday()
            existing = _day_schedules(db, user_id, dow, date_str)
            busy = sorted((_t2m(s.start_time), _t2m(s.end_time)) for s in existing)
            remaining = int(daily_hours * 60)
            cursor = max(8 * 60, wake)
            blocks = []
            for bs, be in busy:
                if cursor + 30 <= bs and remaining > 0:
                    b = min(bs - cursor, remaining, 120)
                    blocks.append((cursor, cursor + b))
                    remaining -= b
                cursor = max(cursor, be)
            if remaining >= 30 and cursor + 30 <= sleep:
                b = min(sleep - cursor, remaining, 120)
                blocks.append((cursor, cursor + b))
            for sm, em in blocks:
                db.add(Schedule(
                    user_id=user_id, title=f"📚 {subject} 학습",
                    day_of_week=dow, date=date_str,
                    start_time=_m2t(sm), end_time=_m2t(em),
                    color="#8B5CF6", priority=1, schedule_type="study",
                ))
                created += 1
        db.commit()
        end_date = (today + timedelta(days=target_days - 1)).strftime("%Y-%m-%d")
        if created:
            return (f"📚 '{subject}' 학습 일정 {created}개 생성 완료!\n"
                    f"📅 {today.strftime('%Y-%m-%d')} ~ {end_date}  ⏰ 하루 {daily_hours}시간 목표")
        return "😅 여유 시간이 부족하여 학습 일정을 생성하지 못했습니다."

    elif tool_name == "reschedule_incomplete":
        target_days = tool_input.get("target_days", 7)
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        wake = _t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
        sleep = _t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")

        # 미완료 날짜 지정 일정 중 오늘 이전 것만 대상
        incomplete = db.query(Schedule).filter(
            Schedule.user_id == user_id,
            Schedule.is_completed == False,
            Schedule.date.isnot(None),
            Schedule.date < today.isoformat(),
        ).all()

        if not incomplete:
            return "✅ 재배치할 미완료 일정이 없습니다."

        moved = []
        for s in incomplete:
            duration = _t2m(s.end_time) - _t2m(s.start_time)
            # 오늘부터 target_days일 내 빈 슬롯 탐색
            for offset in range(target_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")
                dow = tdate.weekday()
                existing = _day_schedules(db, user_id, dow, date_str)
                busy = sorted((_t2m(x.start_time), _t2m(x.end_time)) for x in existing if x.id != s.id)
                cursor = max(8 * 60, wake)
                placed = False
                for bs, be in busy:
                    if cursor + duration <= bs:
                        s.date = date_str
                        s.day_of_week = dow
                        s.start_time = _m2t(cursor)
                        s.end_time = _m2t(cursor + duration)
                        s.is_completed = False
                        db.commit()
                        moved.append(f"  • {s.title} → {date_str} {s.start_time}~{s.end_time}")
                        placed = True
                        break
                    cursor = max(cursor, be)
                if not placed and cursor + duration <= sleep:
                    s.date = date_str
                    s.day_of_week = dow
                    s.start_time = _m2t(cursor)
                    s.end_time = _m2t(cursor + duration)
                    s.is_completed = False
                    db.commit()
                    moved.append(f"  • {s.title} → {date_str} {s.start_time}~{s.end_time}")
                    placed = True
                if placed:
                    break

        if not moved:
            return f"😅 {target_days}일 내에 재배치 가능한 빈 시간을 찾지 못했습니다."
        return f"🔄 미완료 일정 {len(moved)}개를 재배치했습니다:\n" + "\n".join(moved)

    elif tool_name == "list_exam_schedules":
        exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
        if not exams:
            return "📭 등록된 시험 일정이 없습니다."
        lines = ["📝 시험 일정 목록:\n"]
        for e in sorted(exams, key=lambda x: x.exam_date):
            days_left = (datetime.strptime(e.exam_date, "%Y-%m-%d").date() - today).days
            if days_left > 0:
                status = f"D-{days_left}"
            elif days_left == 0:
                status = "오늘!"
            else:
                status = "종료"
            line = f"  [ID:{e.id}] 📝 {e.title}  {e.exam_date} ({status})"
            if e.subject:
                line += f"  과목: {e.subject}"
            if e.exam_time:
                line += f"  {e.exam_time}"
            lines.append(line)
        return "\n".join(lines)

    elif tool_name == "generate_exam_prep_schedule":
        exam_id = tool_input.get("exam_id")
        target_days = tool_input.get("target_days", 14)
        daily_hours = tool_input.get("daily_study_hours", 2.0)

        exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
        if exam_id:
            exams = [e for e in exams if e.id == exam_id]

        upcoming = [e for e in exams if e.exam_date >= today.isoformat()]
        if not upcoming:
            return "📭 예정된 시험이 없습니다. 먼저 시험 일정을 등록해 주세요."

        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        wake = _t2m(profile.sleep_end if profile and profile.sleep_end else "07:00")
        sleep = _t2m(profile.sleep_start if profile and profile.sleep_start else "23:00")

        created = 0
        results = []

        for exam in sorted(upcoming, key=lambda e: e.exam_date):
            exam_date_obj = datetime.strptime(exam.exam_date, "%Y-%m-%d").date()
            days_until_exam = (exam_date_obj - today).days
            study_days = min(days_until_exam, target_days)
            if study_days <= 0:
                continue

            subject = exam.title
            exam_created = 0

            for offset in range(study_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")
                dow = tdate.weekday()
                days_left = (exam_date_obj - tdate).days

                # 시험 임박할수록 학습 강도 증가
                if days_left <= 3:
                    day_hours = daily_hours * 1.5
                    color = "#EF4444"   # 빨강 - 긴급
                    priority = 2
                elif days_left <= 7:
                    day_hours = daily_hours * 1.2
                    color = "#F59E0B"   # 주황 - 높음
                    priority = 1
                else:
                    day_hours = daily_hours
                    color = "#8B5CF6"   # 보라 - 보통
                    priority = 1

                existing = _day_schedules(db, user_id, dow, date_str)
                busy = sorted((_t2m(s.start_time), _t2m(s.end_time)) for s in existing)
                remaining = int(day_hours * 60)
                cursor = max(8 * 60, wake)
                blocks = []

                for bs, be in busy:
                    if cursor + 30 <= bs and remaining > 0:
                        block_len = min(bs - cursor, remaining, 120)
                        blocks.append((cursor, cursor + block_len))
                        remaining -= block_len
                    cursor = max(cursor, be)

                if remaining >= 30 and cursor + 30 <= sleep:
                    block_len = min(sleep - cursor, remaining, 120)
                    blocks.append((cursor, cursor + block_len))

                label = "복습" if days_left <= 1 else "시험 준비"
                for sm, em in blocks:
                    db.add(Schedule(
                        user_id=user_id,
                        title=f"📚 {subject} {label}",
                        day_of_week=dow,
                        date=date_str,
                        start_time=_m2t(sm),
                        end_time=_m2t(em),
                        color=color,
                        priority=priority,
                        schedule_type="study",
                    ))
                    exam_created += 1
                    created += 1

            if exam_created > 0:
                results.append(
                    f"  • {subject} ({exam.exam_date} D-{days_until_exam}): {exam_created}개 생성"
                )

        db.commit()

        if created == 0:
            return "😅 여유 시간이 부족하여 시험 준비 일정을 생성하지 못했습니다."

        summary = "\n".join(results)
        return (
            f"📚 시험 준비 일정 총 {created}개 생성 완료!\n\n"
            f"{summary}\n\n"
            f"🔴 D-3 이내: 빨강 (긴급)\n"
            f"🟡 D-7 이내: 주황 (높음)\n"
            f"🟣 그 외: 보라 (보통)"
        )

    return f"❌ 알 수 없는 도구: {tool_name}"


# ─── Gemini tool builder (google-genai SDK) ───────────────────────────────────

def _build_genai_tool():
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


# ─── main agent entry point ───────────────────────────────────────────────────

def run_ai_agent(
    db: Session,
    user_id: int,
    user_message: str,
    conversation_history: list | None = None,
) -> str:
    from google import genai
    from google.genai import types

    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    today = date.today()
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)

    system_prompt = f"""당신은 AI 시간표 및 일정 관리 어시스턴트입니다. 한국어로 친절하게 응답합니다.

## 현재 날짜
- 오늘: {today.strftime("%Y년 %m월 %d일")} ({DAY_NAMES[today.weekday()]})  ISO: {today.isoformat()}
- 내일: {tomorrow.isoformat()} ({DAY_NAMES[tomorrow.weekday()]})
- 모레: {day_after.isoformat()} ({DAY_NAMES[day_after.weekday()]})

## 날짜 표현 변환
"내일"→{tomorrow.isoformat()}, "모레"→{day_after.isoformat()}, "오늘"→{today.isoformat()}

## 일정 관리 규칙
1. 추가/수정/삭제 요청을 정확히 인식합니다.
2. 특정 날짜("내일 3시" 등) → date=YYYY-MM-DD 사용
3. 반복 수업("매주 월요일") → day_of_week 사용
4. 일정 추가/수정 전에 check_conflicts로 충돌 확인
5. 제목·날짜·시간 중 필수 정보 누락 시 사용자에게 질문
6. 긴급 일정은 priority=2
7. 수정 대상 모호 시 list_schedules로 목록 확인 후 ID 특정

## 시험 기반 학습 계획 (최우선)
사용자가 학습 계획·시간표 생성을 요청하면:
1. 먼저 list_exam_schedules로 시험 일정 확인
2. 시험이 있으면 → generate_exam_prep_schedule 사용
   - 시험 날짜 역산으로 학습 강도 자동 조절
   - 기존 수업·고정 일정 사이의 빈 슬롯에만 배치
   - D-7 이내: 강도 증가 / D-3 이내: 최고 강도 (빨강)
   - 시험 전날: 복습 위주
3. 시험이 없으면 → generate_study_schedule 사용

작업 완료 후 결과를 간결하게 안내하세요."""

    genai_tool = _build_genai_tool()

    # 대화 히스토리 변환
    history = []
    for msg in (conversation_history or []):
        role = "model" if msg["role"] == "assistant" else "user"
        history.append(
            types.Content(role=role, parts=[types.Part.from_text(text=msg["content"])])
        )

    chat = client.chats.create(
        model="gemini-2.5-flash",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=[genai_tool],
        ),
        history=history,
    )

    response = chat.send_message(user_message)

    for _ in range(15):
        # 이번 응답에서 function call 수집
        fn_calls = [
            part.function_call
            for part in response.candidates[0].content.parts
            if part.function_call is not None
        ]

        if not fn_calls:
            # 텍스트 응답 반환
            return "".join(
                part.text
                for part in response.candidates[0].content.parts
                if part.text
            )

        # 모든 tool 실행 후 결과 전달
        result_parts = []
        for fc in fn_calls:
            tool_input = dict(fc.args) if fc.args else {}
            result = _execute_tool(fc.name, tool_input, db, user_id)
            result_parts.append(
                types.Part.from_function_response(
                    name=fc.name,
                    response={"result": result},
                )
            )

        response = chat.send_message(result_parts)

    return "응답 생성 중 문제가 발생했습니다. 다시 시도해 주세요."
