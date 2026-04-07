from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.schedule import service as sched
from app.schedule.models import ExamSchedule, Schedule

DAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]


# ─── tool execution (schedule/service.py 알고리즘을 호출) ─────────────────────

def _execute_tool(tool_name: str, tool_input: dict, db: Session, user_id: int) -> str:
    today = date.today()

    # ── 일정 추가 ──────────────────────────────────────────────────────────────
    if tool_name == "add_schedule":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        date_obj = None

        if date_str:
            date_obj = sched.parse_date(date_str)
            dow = date_obj.weekday()
        elif dow is None:
            dow = 0

        from app.schedule.schemas import ScheduleCreate
        data = ScheduleCreate(
            title=tool_input["title"],
            day_of_week=dow,
            date=date_obj,
            start_time=tool_input["start_time"],
            end_time=tool_input["end_time"],
            location=tool_input.get("location"),
            color=tool_input.get("color", "#6366F1"),
            priority=tool_input.get("priority", 0),
            schedule_type=tool_input.get("schedule_type", "event"),
        )
        s = sched.create_schedule(db, user_id, data)
        label = date_str if date_str else f"매주 {DAY_NAMES[dow]}"
        loc = f"  📍 {s.location}" if s.location else ""
        return f"✅ '{s.title}' 추가 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}{loc}\n🆔 ID: {s.id}"

    # ── 일정 수정 ──────────────────────────────────────────────────────────────
    elif tool_name == "update_schedule":
        sid = tool_input["schedule_id"]
        from app.schedule.schemas import ScheduleUpdate
        updates: dict = {}
        for f in ["title", "day_of_week", "start_time", "end_time", "location", "color", "priority", "is_completed"]:
            if f in tool_input:
                updates[f] = tool_input[f]
        if "date" in tool_input:
            raw = tool_input["date"]
            updates["date"] = sched.parse_date(raw) if raw else None
            if raw:
                updates["day_of_week"] = sched.parse_date(raw).weekday()

        s = sched.update_schedule(db, sid, user_id, ScheduleUpdate(**updates))
        label = s.date.isoformat() if s.date else f"매주 {DAY_NAMES[s.day_of_week]}"
        return f"✅ '{s.title}' 수정 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}"

    # ── 일정 삭제 ──────────────────────────────────────────────────────────────
    elif tool_name == "delete_schedule":
        sid = tool_input["schedule_id"]
        s = sched.get_schedule_or_404(db, sid, user_id)
        title = s.title
        sched.delete_schedule(db, sid, user_id)
        return f"🗑️ '{title}' 삭제 완료!"

    # ── 일정 목록 조회 ─────────────────────────────────────────────────────────
    elif tool_name == "list_schedules":
        schedules = sched.list_schedules(db, user_id)
        ft = tool_input.get("filter_type", "all")
        fd = tool_input.get("filter_date")

        if ft and ft != "all":
            schedules = [s for s in schedules if s.schedule_type == ft]
        if fd:
            fd_dow = sched.parse_date(fd).weekday()
            fd_date = sched.parse_date(fd)
            schedules = [
                s for s in schedules
                if s.date == fd_date or (s.date is None and s.day_of_week == fd_dow)
            ]

        if not schedules:
            return "📭 등록된 일정이 없습니다."

        picons = {0: "", 1: "🟡", 2: "🔴"}
        lines = [f"📋 일정 목록 ({len(schedules)}개):\n"]
        for s in sorted(schedules, key=lambda x: (x.day_of_week, x.start_time)):
            lbl = s.date.isoformat() if s.date else DAY_NAMES[s.day_of_week]
            icon = picons.get(s.priority or 0, "")
            line = f"  [ID:{s.id}] {icon} {s.title}  {lbl} {s.start_time}~{s.end_time}"
            if s.location:
                line += f"  ({s.location})"
            lines.append(line)
        return "\n".join(lines)

    # ── 빈 시간 탐색 ───────────────────────────────────────────────────────────
    elif tool_name == "find_free_slots":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        duration = tool_input.get("duration_minutes", 60)

        date_obj = sched.parse_date(date_str) if date_str else None
        if date_obj is None and dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."

        slots = sched.find_free_slots(db, user_id, date_obj=date_obj, dow=dow, duration_minutes=duration)
        label = date_str if date_str else DAY_NAMES[dow]
        if not slots:
            return f"😅 {label}에는 {duration}분 이상의 빈 시간이 없습니다."
        result = f"🕐 {label} 빈 시간대 ({duration}분 이상):\n"
        for s, e in slots:
            result += f"  • {s} ~ {e}\n"
        return result

    # ── 충돌 확인 ──────────────────────────────────────────────────────────────
    elif tool_name == "check_conflicts":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        start_time = tool_input["start_time"]
        end_time = tool_input["end_time"]
        exclude_id = tool_input.get("exclude_id")

        date_obj = sched.parse_date(date_str) if date_str else None
        if date_obj is None and dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."

        conflicts = sched.check_conflicts(
            db, user_id, start_time, end_time,
            date_obj=date_obj, dow=dow, exclude_id=exclude_id,
        )
        label = date_str if date_str else DAY_NAMES[dow]
        if not conflicts:
            return f"✅ {label} {start_time}~{end_time} 시간대에 충돌이 없습니다."
        result = f"⚠️ 충돌 발견 ({label} {start_time}~{end_time}):\n"
        for c in conflicts:
            result += f"  • [ID:{c.id}] {c.title} ({c.start_time}~{c.end_time})\n"
        return result

    # ── 학습 일정 자동 생성 ────────────────────────────────────────────────────
    elif tool_name == "generate_study_schedule":
        subject = tool_input["subject"]
        target_days = tool_input.get("target_days", 7)
        daily_hours = tool_input.get("daily_study_hours", 2)

        created = sched.generate_study_schedule(
            db, user_id, subject,
            target_days=target_days, daily_hours=daily_hours,
        )
        if created:
            end_date = (today + timedelta(days=target_days - 1)).strftime("%Y-%m-%d")
            return (f"📚 '{subject}' 학습 일정 {created}개 생성 완료!\n"
                    f"📅 {today.isoformat()} ~ {end_date}  ⏰ 하루 {daily_hours}시간 목표")
        return "😅 여유 시간이 부족하여 학습 일정을 생성하지 못했습니다."

    # ── 미완료 일정 재배치 ─────────────────────────────────────────────────────
    elif tool_name == "reschedule_incomplete":
        target_days = tool_input.get("target_days", 7)
        moved = sched.reschedule_incomplete(db, user_id, target_days=target_days)
        if not moved:
            return f"😅 {target_days}일 내에 재배치 가능한 빈 시간을 찾지 못했습니다."
        lines = "\n".join(f"  • {m}" for m in moved)
        return f"🔄 미완료 일정 {len(moved)}개를 재배치했습니다:\n{lines}"

    # ── 시험 일정 목록 ─────────────────────────────────────────────────────────
    elif tool_name == "list_exam_schedules":
        exams = sched.list_exams(db, user_id)
        if not exams:
            return "📭 등록된 시험 일정이 없습니다."
        lines = ["📝 시험 일정 목록:\n"]
        for e in sorted(exams, key=lambda x: x.exam_date):
            days_left = (e.exam_date - today).days
            status_label = f"D-{days_left}" if days_left > 0 else ("오늘!" if days_left == 0 else "종료")
            line = f"  [ID:{e.id}] 📝 {e.title}  {e.exam_date.isoformat()} ({status_label})"
            if e.subject:
                line += f"  과목: {e.subject}"
            if e.exam_time:
                line += f"  {e.exam_time}"
            lines.append(line)
        return "\n".join(lines)

    # ── 시험 대비 학습 일정 자동 생성 ─────────────────────────────────────────
    elif tool_name == "generate_exam_prep_schedule":
        result = sched.generate_exam_prep_schedule(
            db, user_id,
            exam_id=tool_input.get("exam_id"),
            target_days=tool_input.get("target_days", 14),
            daily_hours=tool_input.get("daily_study_hours", 2.0),
        )
        if result["created"] == 0:
            return "😅 여유 시간이 부족하거나 예정된 시험이 없어 일정을 생성하지 못했습니다."
        summary = "\n".join(f"  • {d}" for d in result["details"])
        return (
            f"📚 시험 준비 일정 총 {result['created']}개 생성 완료!\n\n"
            f"{summary}\n\n"
            f"🔴 D-3 이내: 빨강 (긴급)\n"
            f"🟡 D-7 이내: 주황 (높음)\n"
            f"🟣 그 외: 보라 (보통)"
        )

    return f"❌ 알 수 없는 도구: {tool_name}"


# ─── AI 에이전트 (Gemini) ──────────────────────────────────────────────────────

def run_ai_agent(
    db: Session,
    user_id: int,
    user_message: str,
    conversation_history: list | None = None,
) -> str:
    from app.clients.gemini_client import (
        create_chat_session,
        extract_function_calls,
        extract_text,
        history_to_contents,
        make_function_response_parts,
        send_message,
    )

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

    history = history_to_contents(conversation_history or [])
    chat = create_chat_session(system_prompt, history)
    response = send_message(chat, user_message)

    for _ in range(15):
        fn_calls = extract_function_calls(response)

        if not fn_calls:
            return extract_text(response)

        tool_results = [
            _execute_tool(fc.name, dict(fc.args) if fc.args else {}, db, user_id)
            for fc in fn_calls
        ]
        result_parts = make_function_response_parts(fn_calls, tool_results)
        response = send_message(chat, result_parts)

    return "응답 생성 중 문제가 발생했습니다. 다시 시도해 주세요."
