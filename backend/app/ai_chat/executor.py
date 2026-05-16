"""AI 에이전트 tool executor."""
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

# 학습 블록 관련 상수
_MAX_BLOCK_MINS = 180     # 한 블록 최대 학습 시간 (분)
_BLOCK_BUFFER_MINS = 60  # 일정 사이 최소 여유 시간 (분)
_MIN_BLOCK_MINS = 30      # 배치 가능한 최소 블록 길이 (분)
_DEFAULT_START_HOUR = 8   # 기상 시간 기본값 미설정 시 사용 (시)
_FREE_SLOT_END_HOUR = 22  # 빈 시간 탐색 종료 시각 (시)

_SUBJECT_PALETTE = [
    "#4F46E5", "#0891B2", "#059669", "#D97706",
    "#DC2626", "#7C3AED", "#DB2777", "#0284C7",
    "#16A34A", "#EA580C", "#9333EA", "#0E7490",
    "#B45309", "#0F766E", "#C026D3",
]


def _m2t(m: int) -> str:
    return minutes_to_time(m)


def _get_user_wake_sleep(db: Session, user_id: int) -> tuple[int, int]:
    """사용자 기상/취침 시간을 분 단위로 반환. 설정 없으면 07:00/23:00."""
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    wake = time_to_minutes(profile.sleep_end if profile and profile.sleep_end else "07:00")
    sleep = time_to_minutes(profile.sleep_start if profile and profile.sleep_start else "23:00")
    return wake, sleep


def _subject_color(title: str) -> str:
    """djb2-style hash → 과목/제목 기반 결정론적 색상 (프론트와 동일 알고리즘)."""
    h = 5381
    for c in title:
        h = ((h << 5) + h) ^ ord(c)
        h &= 0xFFFFFFFF
    return _SUBJECT_PALETTE[h % len(_SUBJECT_PALETTE)]


def _dow(date_str: str) -> int:
    return datetime.strptime(date_str, "%Y-%m-%d").weekday()


def _not_deleted_filter():
    from sqlalchemy import or_
    return or_(Schedule.deleted_by_user.is_(None), Schedule.deleted_by_user == False)


def _day_schedules(db: Session, user_id: int, dow: int, date_str: str | None) -> list:
    _nd = _not_deleted_filter()
    recurring = (
        db.query(Schedule)
        .filter(Schedule.user_id == user_id, Schedule.day_of_week == dow, Schedule.date.is_(None), _nd)
        .all()
    )
    if date_str:
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


_TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2})\s*[~\-\u2013]\s*(\d{1,2}:\d{2})")


def _parse_time_arg(val: str) -> str:
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
    start_val = (start_val or "").strip()
    end_val = (end_val or "").strip()
    m = _TIME_RANGE_RE.match(start_val)
    if m:
        st = _parse_time_arg(m.group(1))
        et = _parse_time_arg(m.group(2))
        return st, et
    st = _parse_time_arg(start_val)
    et = _parse_time_arg(end_val)
    return st, et


def _execute_tool(tool_name: str, tool_input: dict, db: Session, user_id: int) -> str:
    today = date.today()

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

        # 내장 충돌 검사 — 충돌 있어도 저장하되 경고 반환
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
            result += f"\n⚠️ 시간 충돌 경고:\n" + "\n".join(f"  • {t}" for t in conflict_titles)
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
        # 사용자가 수정한 일정은 user_override=True — 이후 재계획에서 덮어쓰지 않음
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
            # 소프트 삭제 — original_generated_title 보존으로 동일 task 재생성 방지
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
        exclude_id = tool_input.get("exclude_id")
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

    elif tool_name == "generate_study_schedule":
        subject = tool_input["subject"]
        target_days = tool_input.get("target_days", 7)
        daily_hours = tool_input.get("daily_study_hours", 2)
        wake, sleep = _get_user_wake_sleep(db, user_id)

        task_pool: list[dict] = []

        if settings.OPENAI_API_KEY:
            task_pool = get_subject_study_tasks(
                subject=subject,
                daily_hours=float(daily_hours),
            )

        created = 0
        task_idx = 0
        for offset in range(target_days):
            tdate = today + timedelta(days=offset)
            date_str = tdate.strftime("%Y-%m-%d")
            dow = tdate.weekday()
            existing = _day_schedules(db, user_id, dow, date_str)
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
                    # dedup: 동일 task title이 같은 날 이미 존재하면 skip
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

    elif tool_name == "reschedule_incomplete":
        target_days = tool_input.get("target_days", 7)
        wake, sleep = _get_user_wake_sleep(db, user_id)

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

        # ── 자동 학습 일정 생성 (백그라운드 스레드) ──────────────────────────
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

    elif tool_name == "generate_exam_prep_schedule":
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

            # ── 0. 기존 미완료·미삭제 AI 자율학습 블록 제거 ─────────────────
            # 완료(is_completed=True)나 사용자가 직접 삭제(deleted_by_user=True)한 것은 유지
            today_str_del = today.isoformat()
            old_blocks = db.query(Schedule).filter(
                Schedule.user_id == user_id,
                Schedule.linked_exam_id == exam.id,
                Schedule.schedule_source == "ai_generated",
                Schedule.is_completed == False,
                Schedule.deleted_by_user.isnot(True),
                Schedule.date >= today_str_del,
            ).all()
            for blk in old_blocks:
                db.delete(blk)
            db.commit()

            if study_days <= 0:
                continue

            subject = exam.subject or exam.title
            exam_created = 0

            # ── 1. 시험 종류 분석 → phase별 구체적 컴포넌트 생성 ─────────────
            #    (한 번만 호출, 결과를 day 루프에서 재사용)
            exam_components: list[dict] = []
            if settings.OPENAI_API_KEY:
                exam_components = analyze_exam_requirements(
                    exam_title=exam.title,
                    subject=subject,
                    days_until_exam=days_until_exam,
                )

            # ── 3. phase별 task 버킷 구성 ────────────────────────────────────
            phase_buckets: dict[str, list[dict]] = {"early": [], "mid": [], "late": []}
            for comp in exam_components:
                p = comp.get("phase", "mid")
                if p not in phase_buckets:
                    p = "mid"
                t_type = _PHASE_TYPE.get(p, "study")
                t_prio = _PHASE_PRIO.get(p, 1)
                for task_item in comp.get("tasks", []):
                    # task_item은 str(구버전) 또는 {title, estimated_minutes, reason}(신버전)
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

            # component 없으면 personalized tasks로 fallback
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

            # ── 4. 날짜별 일정 배치 ──────────────────────────────────────────
            task_idx = 0

            # sessions_per_week: 실제 배치된 날짜만 카운트 (빈 시간 없어 스킵된 날 제외)
            week_placed_counts: dict[int, int] = {}  # iso_week → 실제 배치된 날짜 수

            # 선호 시작 시간 파싱
            pref_start: int | None = None
            if preferred_start_time:
                try:
                    pref_start = time_to_minutes(preferred_start_time)
                except Exception:
                    pass

            for offset in range(study_days):
                tdate = today + timedelta(days=offset)
                date_str = tdate.strftime("%Y-%m-%d")

                # sessions_per_week 체크: 이번 주에 이미 충분히 배치했으면 skip
                if sessions_per_week and 1 <= sessions_per_week <= 7:
                    iso_week = tdate.isocalendar()[1]
                    if week_placed_counts.get(iso_week, 0) >= sessions_per_week:
                        continue
                dow = tdate.weekday()
                days_left = (exam_date_obj - tdate).days

                # 긴급도별 시간·색상
                if days_left <= 3:
                    day_hours = daily_hours * 1.5
                    color = "#EF4444"
                    default_priority = 2
                elif days_left <= 7:
                    day_hours = daily_hours * 1.2
                    color = "#F59E0B"
                    default_priority = 1
                else:
                    day_hours = daily_hours
                    color = "#8B5CF6"
                    default_priority = 1

                # 현재 days_left 기반 phase 결정
                current_phase = pick_phase(days_left)

                # 현재 phase bucket 선택 (없으면 전체 합산)
                current_bucket = phase_buckets.get(current_phase, [])
                if not current_bucket:
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
                    # ── 중복 방지: 이미 같은 날·시간·과목 study 일정 있으면 skip ──
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
                        raw_task_title = task['title']
                        title = f"📚 {raw_task_title}"
                        block_priority = task.get("priority", default_priority)
                        # task의 estimated_minutes가 있으면 블록 크기에 반영
                        task_mins = task.get("estimated_minutes")
                        if task_mins and 20 <= task_mins <= _MAX_BLOCK_MINS:
                            task_em = min(sm + task_mins, em, sm + _MAX_BLOCK_MINS)
                            em = max(task_em, sm + 20)

                        # ── dedup: 이미 삭제하거나 완료한 동일 task 재생성 금지 ──
                        _nd = _not_deleted_filter()
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
                        # fallback: 구체적이지만 최소한의 맥락 포함
                        stage = (
                            f"{subject} 실전 모의고사 1회분 풀기 + 오답 분석" if days_left <= 3
                            else f"{subject} 기출문제 취약 단원 오답 분석 + 재정리"
                            if days_left <= 7
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

                # 실제 배치된 날짜만 sessions_per_week 카운트에 반영
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

    elif tool_name == "complete_schedule":
        sid = tool_input["schedule_id"]
        s = db.query(Schedule).filter(Schedule.id == sid, Schedule.user_id == user_id).first()
        if not s:
            return f"❌ ID {sid} 일정을 찾을 수 없습니다."
        s.is_completed = True
        db.commit()
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
        s.user_override = True  # 이후 재계획에서 덮어쓰지 않음
        db.commit()
        return f"📅 '{s.title}' → {new_date_str}({DAY_NAMES[s.day_of_week]})로 연기 완료!"

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
        # 연관된 AI 생성 학습 일정 소프트 삭제
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

    return f"❌ 알 수 없는 도구: {tool_name}"


# ─── OpenAI-format tool list ─────────────────────────────────────────────────
