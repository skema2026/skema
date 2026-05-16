"""AI 에이전트 tool executor.

service.py의 LLM 루프가 AI의 tool 호출 결과를 받으면
_execute_tool(tool_name, tool_input, db, user_id)를 호출한다.

_execute_tool은 tool_name에 따라 분기해 실제 DB 작업을 수행하고
결과 문자열을 반환한다. 반환값은 그대로 LLM에게 다시 전달된다.

tool 종류:
  일정 관리  — add/update/delete/list_schedules, find_free_slots,
               check_conflicts, complete_schedule, postpone_schedule,
               reschedule_incomplete
  시험 관리  — add/list/update/delete_exam_schedule
  학습 계획  — generate_study_schedule, generate_exam_prep_schedule

schedule_source 값의 의미:
  "user_created"  — 사용자가 직접 추가한 일정 → 삭제 시 DB에서 완전 삭제
  "ai_generated"  — AI가 생성한 학습 블록  → 삭제 시 deleted_by_user=True로 소프트 삭제
                    소프트 삭제 이유: original_generated_title을 DB에 보존해야
                    재계획 시 같은 task가 다시 생성되는 것을 막을 수 있음
"""
import json
import logging
import re
import threading
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.auth.models import UserProfile
from app.core.config import settings
from app.schedule.models import ExamSchedule, Schedule
from app.schedule.service import create_exam_record, create_schedule_record, stage_exam_record, stage_schedule_record
from app.ai_chat.study_planner import (
    analyze_exam_requirements,
    get_subject_study_tasks,
    get_personalized_study_tasks,
    pick_phase,
    validate_task_quality,
)
from app.utils.time_utils import DAY_NAMES, DAY_NAMES_SHORT, minutes_to_time, overlap, time_to_minutes

logger = logging.getLogger(__name__)


# ── 상수 ──────────────────────────────────────────────────────────────────────

# 학습 블록 배치 기준
_MAX_BLOCK_MINS = 180    # 한 블록 최대 학습 시간 (분)
_BLOCK_BUFFER_MINS = 60  # 일정과 일정 사이 최소 여유 시간 (분)
_MIN_BLOCK_MINS = 30     # 배치 가능한 최소 블록 길이 (분)
_DEFAULT_START_HOUR = 8  # 사용자 기상 시간 미설정 시 기본값 (시)
_FREE_SLOT_END_HOUR = 22 # 빈 시간 탐색 종료 시각 (시)

# 시험 D-day 기준 학습 단계 — study_planner.pick_phase()와 동기화
_PHASE_TYPE = {"early": "study", "mid": "practice", "late": "review"}
_PHASE_PRIO = {"early": 1,       "mid": 1,          "late": 2}

# 과목명 해시 기반 색상 팔레트 (프론트엔드와 동일 알고리즘으로 결정론적 배색)
_SUBJECT_PALETTE = [
    "#4F46E5", "#0891B2", "#059669", "#D97706",
    "#DC2626", "#7C3AED", "#DB2777", "#0284C7",
    "#16A34A", "#EA580C", "#9333EA", "#0E7490",
    "#B45309", "#0F766E", "#C026D3",
]


# ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────

def _m2t(m: int) -> str:
    """분(int) → 'HH:MM' 문자열."""
    return minutes_to_time(m)


def _get_user_wake_sleep(db: Session, user_id: int) -> tuple[int, int]:
    """사용자 기상/취침 시간을 분 단위로 반환. 설정 없으면 07:00/23:00."""
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    wake = time_to_minutes(profile.sleep_end if profile and profile.sleep_end else "07:00")
    sleep = time_to_minutes(profile.sleep_start if profile and profile.sleep_start else "23:00")
    return wake, sleep


def _subject_color(title: str) -> str:
    """과목명 해시 → 결정론적 색상. 같은 과목명은 항상 같은 색상 (프론트와 동일 알고리즘)."""
    h = 5381
    for c in title:
        h = ((h << 5) + h) ^ ord(c)
        h &= 0xFFFFFFFF
    return _SUBJECT_PALETTE[h % len(_SUBJECT_PALETTE)]


def _dow(date_str: str) -> int:
    """YYYY-MM-DD → 요일 숫자 (0=월 ~ 6=일)."""
    return datetime.strptime(date_str, "%Y-%m-%d").weekday()


def _not_deleted_filter():
    """사용자가 소프트 삭제하지 않은 일정만 조회하는 SQLAlchemy 필터."""
    from sqlalchemy import or_
    return or_(Schedule.deleted_by_user.is_(None), Schedule.deleted_by_user == False)


def _day_schedules(db: Session, user_id: int, dow: int, date_str: str | None) -> list:
    """특정 날짜의 일정 목록 반환.

    매주 반복되는 일정(date=None, day_of_week만 있는 것)과
    날짜가 고정된 일정을 합산해 반환한다.
    """
    _nd = _not_deleted_filter()
    # 매주 반복 일정
    recurring = (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.day_of_week == dow, Schedule.date.is_(None), _nd)
        .all()
    )
    if date_str:
        # 해당 날짜 고정 일정 추가 (중복 ID 제거)
        specific = (
            db.query(Schedule)
            .filter(Schedule.user_id == user_id, Schedule.date == date_str, _nd)
            .all()
        )
        seen = {s.id for s in recurring}
        for s in specific:
            if s.id not in seen:
                recurring.append(s)
    return recurring


# "09:00~10:30" 또는 "09:00-10:30" 같은 시간 범위 표현을 파싱하는 정규식
_TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})")


def _parse_time_arg(val: str) -> str:
    """시간 문자열을 'HH:MM' 형식으로 정규화. 범위 표현이면 시작 시간만 추출."""
    if not val:
        return "00:00"
    val = val.strip()
    m = _TIME_RANGE_RE.match(val)
    if m:
        val = m.group(1)
    parts = val.split(":")
    if len(parts) == 2:
        try:
            h, mn = int(parts[0]), int(parts[1])
            return f"{h:02d}:{mn:02d}"
        except ValueError:
            pass
    return val


def _parse_time_range(start_val: str, end_val: str) -> tuple[str, str]:
    """시작/종료 시간을 'HH:MM' 쌍으로 반환.

    start_val이 '09:00~10:30' 같은 범위 표현이면 시작/종료를 모두 파싱한다.
    """
    start_val = (start_val or "").strip()
    end_val = (end_val or "").strip()
    m = _TIME_RANGE_RE.match(start_val)
    if m:
        # start_val 자체가 "09:00~10:30" 형태인 경우
        return _parse_time_arg(m.group(1)), _parse_time_arg(m.group(2))
    return _parse_time_arg(start_val), _parse_time_arg(end_val)


# ── tool 실행 디스패처 ────────────────────────────────────────────────────────

def _execute_tool(tool_name: str, tool_input: dict, db: Session, user_id: int) -> str:
    """AI가 선택한 tool을 실행하고 결과 문자열을 반환한다.

    반환값은 그대로 LLM 메시지에 추가되어 AI가 다음 응답을 만드는 데 사용된다.
    """
    today = date.today()

    # ── 일정 관리 ─────────────────────────────────────────────────────────────

    if tool_name == "add_schedule":
        date_str = tool_input.get("date")
        dow = tool_input.get("day_of_week")
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            dow = 0
        start_time, end_time = _parse_time_range(
            tool_input.get("start_time", ""),
            tool_input.get("end_time", ""),
        )

        # 충돌이 있어도 저장은 하되 경고 메시지를 함께 반환
        existing_day = _day_schedules(db, user_id, dow, date_str)
        conflict_titles = [
            f"[ID:{s.id}] {s.title} ({s.start_time}~{s.end_time})"
            for s in existing_day
            if overlap(start_time, end_time, s.start_time, s.end_time)
        ]

        title_str = tool_input["title"]
        s = create_schedule_record(db, user_id, {
            "title": title_str,
            "day_of_week": dow,
            "date": date_str,
            "start_time": start_time,
            "end_time": end_time,
            "location": tool_input.get("location"),
            "color": tool_input.get("color") or _subject_color(title_str),
            "priority": tool_input.get("priority", 0),
            "schedule_type": tool_input.get("schedule_type", "event"),
            "schedule_source": "user_created",
        })
        label = date_str if date_str else f"매주 {DAY_NAMES[dow]}"
        loc = f"  📍 {s.location}" if s.location else ""
        result = f"✅ '{s.title}' 추가 완료!\n📅 {label}  ⏰ {s.start_time}~{s.end_time}{loc}\n🆔 ID: {s.id}"
        if conflict_titles:
            result += "\n⚠️ 시간 충돌 경고:\n" + "\n".join(f"  • {t}" for t in conflict_titles)
        return result

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
        # user_override=True: 이후 AI 재계획 시 이 일정을 덮어쓰지 않음
        s.user_override = True
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
        if s.schedule_source == "ai_generated":
            # AI 생성 일정: 소프트 삭제 — original_generated_title을 보존해야
            # 재계획 시 같은 task가 다시 만들어지는 것을 막을 수 있음
            s.deleted_by_user = True
            db.commit()
        else:
            db.delete(s)
            db.commit()
        return f"🗑️ '{title}' 삭제 완료!"

    elif tool_name == "list_schedules":
        schedules = db.query(Schedule).filter(
            Schedule.user_id == user_id, _not_deleted_filter()
        ).all()
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
        # 기존 일정을 시간순 정렬 후 일정 사이 빈 구간 탐색
        busy = sorted((time_to_minutes(s.start_time), time_to_minutes(s.end_time)) for s in existing)
        free, cursor = [], _DEFAULT_START_HOUR * 60
        for bs, be in busy:
            if cursor + duration <= bs:
                free.append((_m2t(cursor), _m2t(bs)))
            cursor = max(cursor, be + _BLOCK_BUFFER_MINS)
        if cursor + duration <= _FREE_SLOT_END_HOUR * 60:
            free.append((_m2t(cursor), _m2t(_FREE_SLOT_END_HOUR * 60)))
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
        exclude_id = tool_input.get("exclude_id")  # 수정 시 자기 자신 제외
        if date_str:
            dow = _dow(date_str)
        elif dow is None:
            return "❌ 날짜 또는 요일을 지정해 주세요."
        existing = _day_schedules(db, user_id, dow, date_str)
        conflicts = [
            s for s in existing
            if (exclude_id is None or s.id != exclude_id)
            and overlap(start_time, end_time, s.start_time, s.end_time)
        ]
        label = date_str if date_str else DAY_NAMES[dow]
        if not conflicts:
            return f"✅ {label} {start_time}~{end_time} 시간대에 충돌이 없습니다."
        result = f"⚠️ 충돌 발견 ({label} {start_time}~{end_time}):\n"
        for s in conflicts:
            result += f"  • [ID:{s.id}] {s.title} ({s.start_time}~{s.end_time})\n"
        return result

    elif tool_name == "complete_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        s.is_completed = True
        db.commit()
        # 완료 처리된 task는 generate_exam_prep_schedule 재실행 시 재생성하지 않음
        return f"✅ '{s.title}' 완료 처리! 이 task는 이후 재계획에서 다시 생성되지 않습니다."

    elif tool_name == "postpone_schedule":
        sid = tool_input["schedule_id"]
        days_to_postpone = int(tool_input.get("days", 1))
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        if not s.date:
            return "❌ 반복 일정(매주 수업)은 연기할 수 없습니다. 특정 날짜가 있는 일정만 연기 가능합니다."
        from datetime import datetime as _dt2
        old_date = _dt2.strptime(s.date, "%Y-%m-%d").date()
        new_date = old_date + timedelta(days=days_to_postpone)
        new_date_str = new_date.strftime("%Y-%m-%d")
        s.date = new_date_str
        s.day_of_week = new_date.weekday()
        s.user_override = True  # 연기한 일정도 이후 재계획에서 덮어쓰지 않음
        db.commit()
        return f"📅 '{s.title}' → {new_date_str}({DAY_NAMES[s.day_of_week]})로 연기 완료!"

    elif tool_name == "reschedule_incomplete":
        target_days = tool_input.get("target_days", 7)
        wake, sleep = _get_user_wake_sleep(db, user_id)

        # 오늘 이전 날짜에 미완료 상태로 남아있는 일정 조회
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
            duration = time_to_minutes(s.end_time) - time_to_minutes(s.start_time)
            for offset in range(target_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")
                dow = tdate.weekday()
                existing = _day_schedules(db, user_id, dow, date_str)
                busy = sorted((time_to_minutes(x.start_time), time_to_minutes(x.end_time)) for x in existing if x.id != s.id)
                cursor = max(_DEFAULT_START_HOUR * 60, wake)
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
                    cursor = max(cursor, be + _BLOCK_BUFFER_MINS)
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

    # ── 시험 관리 ─────────────────────────────────────────────────────────────

    elif tool_name == "add_exam_schedule":
        from datetime import datetime as _dt
        exam_date_str = tool_input.get("exam_date", "")
        try:
            exam_date_obj = _dt.strptime(exam_date_str, "%Y-%m-%d").date()
        except ValueError:
            return f"❌ 날짜 형식이 올바르지 않습니다: {exam_date_str} (YYYY-MM-DD 형식으로 입력하세요)"

        e = create_exam_record(db, user_id, {
            "title": tool_input["title"],
            "exam_date": exam_date_obj,
            "subject": tool_input.get("subject"),
            "exam_time": tool_input.get("exam_time"),
            "location": tool_input.get("location"),
        })
        days_left = (exam_date_obj - today).days
        status_str = f"D-{days_left}" if days_left > 0 else ("오늘!" if days_left == 0 else "종료")
        result = (
            f"✅ 시험 일정 '{e.title}' 추가 완료!\n"
            f"📅 {exam_date_str} ({status_str})"
            + (f"  과목: {e.subject}" if e.subject else "")
            + f"\n🆔 ID: {e.id}"
        )

        # 시험 등록 즉시 학습 일정을 백그라운드에서 자동 생성
        # (사용자 응답을 블로킹하지 않도록 별도 스레드에서 실행)
        if days_left > 0 and settings.OPENAI_API_KEY:
            exam_id_bg = e.id
            target_days_bg = min(days_left, 14)
            _uid = user_id

            def _bg_generate():
                from app.db.database import SessionLocal
                bg_db = SessionLocal()
                try:
                    _execute_tool(
                        "generate_exam_prep_schedule",
                        {"exam_id": exam_id_bg, "target_days": target_days_bg, "daily_study_hours": 2.0},
                        bg_db,
                        _uid,
                    )
                except Exception as _e:
                    logger.warning(f"bg generate_exam_prep_schedule failed: {_e}")
                finally:
                    bg_db.close()

            threading.Thread(target=_bg_generate, daemon=True).start()
            result += "\n\n🔄 AI가 학습 준비 일정을 백그라운드에서 생성 중입니다. 잠시 후 시간표를 확인하세요."

        return result

    elif tool_name == "list_exam_schedules":
        exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
        if not exams:
            return "📭 등록된 시험 일정이 없습니다."
        lines = ["📝 시험 일정 목록:\n"]
        for e in sorted(exams, key=lambda x: x.exam_date):
            days_left = (e.exam_date - today).days
            if days_left > 0:
                status = f"D-{days_left}"
            elif days_left == 0:
                status = "오늘!"
            else:
                status = "종료"
            exam_date_str = e.exam_date.strftime("%Y-%m-%d") if hasattr(e.exam_date, "strftime") else e.exam_date
            line = f"  [ID:{e.id}] 📝 {e.title}  {exam_date_str} ({status})"
            if e.subject:
                line += f"  과목: {e.subject}"
            if e.exam_time:
                line += f"  {e.exam_time}"
            lines.append(line)
        return "\n".join(lines)

    elif tool_name == "update_exam":
        from datetime import datetime as _dt3
        eid = tool_input["exam_id"]
        e = db.query(ExamSchedule).filter(ExamSchedule.id == eid, ExamSchedule.user_id == user_id).first()
        if not e:
            return f"❌ ID {eid} 시험 일정을 찾을 수 없습니다."
        for f in ["title", "subject", "exam_time", "location"]:
            if f in tool_input:
                setattr(e, f, tool_input[f])
        if "exam_date" in tool_input:
            try:
                e.exam_date = _dt3.strptime(tool_input["exam_date"], "%Y-%m-%d").date()
            except ValueError:
                return f"❌ 날짜 형식이 올바르지 않습니다: {tool_input['exam_date']} (YYYY-MM-DD)"
        db.commit()
        db.refresh(e)
        exam_date_str = e.exam_date.strftime("%Y-%m-%d") if hasattr(e.exam_date, "strftime") else e.exam_date
        return f"✅ 시험 '{e.title}' 수정 완료!\n📅 {exam_date_str}" + (f"  과목: {e.subject}" if e.subject else "")

    elif tool_name == "delete_exam":
        eid = tool_input["exam_id"]
        e = db.query(ExamSchedule).filter(ExamSchedule.id == eid, ExamSchedule.user_id == user_id).first()
        if not e:
            return f"❌ ID {eid} 시험 일정을 찾을 수 없습니다."
        exam_title = e.title
        # 이 시험을 위해 AI가 생성한 학습 일정도 함께 소프트 삭제
        linked_study = db.query(Schedule).filter(
            Schedule.user_id == user_id,
            Schedule.linked_exam_id == eid,
            Schedule.schedule_source == "ai_generated",
        ).all()
        cleaned = 0
        for ls in linked_study:
            if not ls.deleted_by_user:
                ls.deleted_by_user = True
                cleaned += 1
        db.delete(e)
        db.commit()
        cleaned_msg = f"\n🧹 연관 학습 일정 {cleaned}개 자동 정리" if cleaned > 0 else ""
        return f"🗑️ 시험 '{exam_title}' 삭제 완료!{cleaned_msg}"

    # ── 학습 계획 ─────────────────────────────────────────────────────────────

    elif tool_name == "generate_study_schedule":
        """시험 없이 특정 과목 학습 일정을 기간 내 빈 슬롯에 자동 배치."""
        subject = tool_input["subject"]
        target_days = tool_input.get("target_days", 7)
        daily_hours = tool_input.get("daily_study_hours", 2)
        wake, sleep = _get_user_wake_sleep(db, user_id)

        # AI로 과목에 맞는 구체적 task 목록 생성
        task_pool: list[dict] = []
        if settings.OPENAI_API_KEY:
            task_pool = get_subject_study_tasks(subject=subject, daily_hours=float(daily_hours))

        created = 0
        task_idx = 0
        for offset in range(target_days):
            tdate = today + timedelta(days=offset)
            date_str = tdate.strftime("%Y-%m-%d")
            dow = tdate.weekday()
            existing = _day_schedules(db, user_id, dow, date_str)
            # 기존 일정을 busy 구간으로 잡고 사이 빈 슬롯에 학습 블록 배치
            busy = sorted((time_to_minutes(s.start_time), time_to_minutes(s.end_time)) for s in existing)
            remaining = int(daily_hours * 60)
            cursor = max(_DEFAULT_START_HOUR * 60, wake)
            blocks = []
            for bs, be in busy:
                if cursor + _MIN_BLOCK_MINS <= bs and remaining > 0:
                    b = min(bs - cursor, remaining, _MAX_BLOCK_MINS)
                    blocks.append((cursor, cursor + b))
                    remaining -= b
                cursor = max(cursor, be + _BLOCK_BUFFER_MINS)
            if remaining >= _MIN_BLOCK_MINS and cursor + _MIN_BLOCK_MINS <= sleep:
                b = min(sleep - cursor, remaining, _MAX_BLOCK_MINS)
                blocks.append((cursor, cursor + b))
            for sm, em in blocks:
                if task_pool:
                    task = task_pool[task_idx % len(task_pool)]
                    raw_task_title = task["title"]
                    title = f"📚 {raw_task_title}"
                    priority = task.get("priority", 1)
                    # 같은 날 동일 task가 이미 있으면 skip (중복 방지)
                    _already = db.query(Schedule).filter(
                        Schedule.user_id == user_id,
                        Schedule.date == date_str,
                        Schedule.schedule_type == "study",
                        Schedule.original_generated_title == raw_task_title,
                        Schedule.deleted_by_user != True,
                    ).first()
                    if _already:
                        task_idx += 1
                        continue
                else:
                    raw_task_title = None
                    title = f"📚 {subject} — 강의 내용 정리 및 예제 풀기"
                    priority = 1
                task_idx += 1
                stage_schedule_record(db, user_id, {
                    "title": title,
                    "day_of_week": dow,
                    "date": date_str,
                    "start_time": _m2t(sm),
                    "end_time": _m2t(em),
                    "color": _subject_color(subject),
                    "priority": priority,
                    "schedule_type": "study",
                    "schedule_source": "ai_generated",
                    "original_generated_title": raw_task_title,
                })
                created += 1
        db.commit()
        end_date = (today + timedelta(days=target_days - 1)).strftime("%Y-%m-%d")
        if created:
            return (
                f"📚 '{subject}' 구체적 학습 일정 {created}개 생성 완료!\n"
                f"📅 {today.strftime('%Y-%m-%d')} ~ {end_date}  ⏰ 하루 {daily_hours}시간 목표"
            )
        return "😅 여유 시간이 부족하여 학습 일정을 생성하지 못했습니다."

    elif tool_name == "generate_exam_prep_schedule":
        """시험 D-day 역산으로 학습 일정을 자동 생성.

        흐름:
          1. 기존 미완료 AI 학습 블록 삭제 (재생성 전 초기화)
          2. AI로 시험 종류 분석 → early/mid/late phase별 task 목록 생성
          3. task를 early/mid/late 버킷으로 분류
          4. 날짜별로 D-day까지 빈 슬롯에 배치
             - D-3 이내 → 빨강, 학습량 1.5배 (late phase task)
             - D-7 이내 → 주황, 학습량 1.2배 (mid phase task)
             - 그 외    → 보라, 기본 학습량 (early phase task)
        """
        exam_id = tool_input.get("exam_id")
        target_days = tool_input.get("target_days", 14)
        daily_hours = tool_input.get("daily_study_hours", 2.0)
        sessions_per_week: int | None = tool_input.get("sessions_per_week")
        preferred_start_time: str | None = tool_input.get("preferred_start_time")

        exams = db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id).all()
        if exam_id:
            exams = [e for e in exams if e.id == exam_id]

        upcoming = [e for e in exams if e.exam_date >= today]
        if not upcoming:
            return "📭 예정된 시험이 없습니다. 먼저 시험 일정을 등록해 주세요."

        wake, sleep = _get_user_wake_sleep(db, user_id)
        created = 0
        results = []

        for exam in sorted(upcoming, key=lambda e: e.exam_date):
            exam_date_obj = exam.exam_date
            days_until_exam = (exam_date_obj - today).days
            study_days = min(days_until_exam, target_days)

            # 1. 기존 미완료·미삭제 AI 학습 블록 제거 (재생성 전 초기화)
            #    완료(is_completed=True)나 사용자가 직접 삭제(deleted_by_user=True)한 것은 건드리지 않음
            today_str = today.isoformat()
            old_blocks = db.query(Schedule).filter(
                Schedule.user_id == user_id,
                Schedule.linked_exam_id == exam.id,
                Schedule.schedule_source == "ai_generated",
                Schedule.is_completed == False,
                Schedule.deleted_by_user.isnot(True),
                Schedule.date >= today_str,
            ).all()
            for blk in old_blocks:
                db.delete(blk)
            db.commit()

            if study_days <= 0:
                continue

            subject = exam.subject or exam.title
            exam_created = 0

            # 2. 시험 종류 AI 분석 → phase별 task 컴포넌트 생성 (루프 밖에서 한 번만 호출)
            exam_components: list[dict] = []
            if settings.OPENAI_API_KEY:
                exam_components = analyze_exam_requirements(
                    exam_title=exam.title,
                    subject=subject,
                    days_until_exam=days_until_exam,
                )

            # 3. 컴포넌트를 early / mid / late 버킷으로 분류
            phase_buckets: dict[str, list[dict]] = {"early": [], "mid": [], "late": []}
            for comp in exam_components:
                p = comp.get("phase", "mid")
                if p not in phase_buckets:
                    p = "mid"
                t_type = _PHASE_TYPE.get(p, "study")
                t_prio = _PHASE_PRIO.get(p, 1)
                for task_item in comp.get("tasks", []):
                    if isinstance(task_item, str):
                        title = task_item.strip()
                        estimated_minutes = 60
                        reason = ""
                    elif isinstance(task_item, dict):
                        title = task_item.get("title", "").strip()
                        estimated_minutes = int(task_item.get("estimated_minutes") or 60)
                        reason = str(task_item.get("reason") or "")
                    else:
                        continue
                    if not title or not validate_task_quality(title):
                        continue
                    phase_buckets[p].append({
                        "title": title,
                        "task_type": t_type,
                        "priority": t_prio,
                        "estimated_minutes": estimated_minutes,
                        "reason": reason,
                    })

            # 컴포넌트가 없으면 (AI 호출 실패 등) personalized tasks로 fallback
            if not any(phase_buckets.values()):
                existing_study = db.query(Schedule).filter(
                    Schedule.user_id == user_id, Schedule.schedule_type == "study"
                ).all()
                total_blocks = len(existing_study)
                completed_blocks = sum(1 for s in existing_study if s.is_completed)
                fallback_tasks = get_personalized_study_tasks(
                    exam_title=exam.title,
                    subject=subject,
                    days_until_exam=days_until_exam,
                    completed_blocks=completed_blocks,
                    total_blocks=total_blocks,
                )
                for t in fallback_tasks:
                    phase_buckets["mid"].append(t)

            # 4. 날짜별 일정 배치
            task_idx = 0
            week_placed_counts: dict[int, int] = {}  # iso_week → 실제 배치된 날짜 수

            pref_start: int | None = None
            if preferred_start_time:
                try:
                    pref_start = time_to_minutes(preferred_start_time)
                except Exception:
                    pass

            for offset in range(study_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")

                # sessions_per_week: 이번 주에 이미 충분히 배치했으면 skip
                if sessions_per_week and 1 <= sessions_per_week <= 7:
                    iso_week = tdate.isocalendar()[1]
                    if week_placed_counts.get(iso_week, 0) >= sessions_per_week:
                        continue

                dow = tdate.weekday()
                days_left = (exam_date_obj - tdate).days

                # D-day까지 남은 일수에 따라 학습량·색상·우선순위 조정
                if days_left <= 3:
                    day_hours = daily_hours * 1.5
                    color = "#EF4444"   # 빨강 — 긴급
                    default_priority = 2
                elif days_left <= 7:
                    day_hours = daily_hours * 1.2
                    color = "#F59E0B"   # 주황 — 높음
                    default_priority = 1
                else:
                    day_hours = daily_hours
                    color = "#8B5CF6"   # 보라 — 보통
                    default_priority = 1

                current_phase = pick_phase(days_left)
                current_bucket = phase_buckets.get(current_phase, [])
                if not current_bucket:
                    # 현재 phase bucket이 비어있으면 전체 task 합산 사용
                    current_bucket = [t for bucket in phase_buckets.values() for t in bucket]

                existing = _day_schedules(db, user_id, dow, date_str)
                busy = sorted((time_to_minutes(s.start_time), time_to_minutes(s.end_time)) for s in existing)
                remaining = int(day_hours * 60)
                cursor = pref_start if pref_start is not None else wake
                blocks = []

                for bs, be in busy:
                    if cursor + _MIN_BLOCK_MINS <= bs and remaining > 0:
                        block_len = min(bs - cursor, remaining, _MAX_BLOCK_MINS)
                        blocks.append((cursor, cursor + block_len))
                        remaining -= block_len
                    cursor = max(cursor, be + _BLOCK_BUFFER_MINS)
                if remaining >= _MIN_BLOCK_MINS and cursor + _MIN_BLOCK_MINS <= sleep:
                    block_len = min(sleep - cursor, remaining, _MAX_BLOCK_MINS)
                    blocks.append((cursor, cursor + block_len))

                day_placed = 0
                for sm, em in blocks:
                    # 같은 날·시간·과목 study 일정이 이미 있으면 skip
                    sm_str = _m2t(sm)
                    already_exists = db.query(Schedule).filter(
                        Schedule.user_id == user_id,
                        Schedule.date == date_str,
                        Schedule.start_time == sm_str,
                        Schedule.schedule_type == "study",
                        Schedule.title.ilike(f"%{subject}%"),
                    ).first()
                    if already_exists:
                        task_idx += 1
                        continue

                    if current_bucket:
                        task = current_bucket[task_idx % len(current_bucket)]
                        raw_task_title = task["title"]
                        title = f"📚 {raw_task_title}"
                        block_priority = task.get("priority", default_priority)
                        # estimated_minutes 값이 있으면 블록 길이에 반영
                        task_mins = task.get("estimated_minutes")
                        if task_mins and 20 <= task_mins <= _MAX_BLOCK_MINS:
                            task_em = min(sm + task_mins, em, sm + _MAX_BLOCK_MINS)
                            em = max(task_em, sm + 20)

                        # 사용자가 삭제하거나 완료한 task는 재생성 금지
                        already_blocked = db.query(Schedule).filter(
                            Schedule.user_id == user_id,
                            Schedule.linked_exam_id == exam.id,
                            Schedule.original_generated_title == raw_task_title,
                            Schedule.deleted_by_user == True,
                        ).first()
                        if already_blocked:
                            task_idx += 1
                            continue
                        already_done = db.query(Schedule).filter(
                            Schedule.user_id == user_id,
                            Schedule.linked_exam_id == exam.id,
                            Schedule.original_generated_title == raw_task_title,
                            Schedule.is_completed == True,
                        ).first()
                        if already_done:
                            task_idx += 1
                            continue
                    else:
                        raw_task_title = None
                        # task pool이 없을 때 D-day 기반 기본 제목 생성
                        stage = (
                            f"{subject} 실전 모의고사 1회분 풀기 + 오답 분석" if days_left <= 3
                            else f"{subject} 기출문제 취약 단원 오답 분석 + 재정리" if days_left <= 7
                            else f"{subject} 핵심 개념 정리 + 기본 문제 3개 풀기"
                        )
                        title = f"📚 {stage}"
                        block_priority = default_priority
                    task_idx += 1

                    stage_schedule_record(db, user_id, {
                        "title": title,
                        "day_of_week": dow,
                        "date": date_str,
                        "start_time": _m2t(sm),
                        "end_time": _m2t(em),
                        "color": color,
                        "priority": block_priority,
                        "schedule_type": "study",
                        "schedule_source": "ai_generated",
                        "linked_exam_id": exam.id,
                        "original_generated_title": raw_task_title,
                    })
                    day_placed += 1
                    exam_created += 1
                    created += 1

                # 실제로 배치된 날짜만 sessions_per_week 카운트에 반영
                if sessions_per_week and 1 <= sessions_per_week <= 7 and day_placed > 0:
                    iso_week = tdate.isocalendar()[1]
                    week_placed_counts[iso_week] = week_placed_counts.get(iso_week, 0) + 1

            if exam_created > 0:
                component_summary = f" ({len(exam_components)}개 준비영역 분석)" if exam_components else ""
                results.append(
                    f"  • {subject} ({exam.exam_date} D-{days_until_exam}): {exam_created}개 생성{component_summary}"
                )

        db.commit()

        if created == 0:
            return "😅 여유 시간이 부족하여 시험 준비 일정을 생성하지 못했습니다."

        summary = "\n".join(results)
        return (
            f"📚 시험 준비 일정 총 {created}개 생성 완료!\n\n"
            f"{summary}\n\n"
            f"🔴 D-3 이내: 빨강 (긴급, 모의고사·오답 위주)\n"
            f"🟡 D-7 이내: 주황 (높음, 문제풀이·심화 위주)\n"
            f"🟣 그 외: 보라 (보통, 개념·기초 위주)"
        )

    return f"❌ 알 수 없는 도구: {tool_name}"
