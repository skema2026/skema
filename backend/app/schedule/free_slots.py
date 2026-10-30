"""빈 시간 계산 공용 모듈.

다시 짜기(#11)와 시험 공부 블록 배치(#12)가 같이 쓴다.

- 하루를 30분 칸(:00, :30 시작)으로 나눠서 비어 있는 칸의 시작 시각(분)을 돌려준다.
- 수면 시간(UserProfile.sleep_start ~ sleep_end)에 걸치는 칸은 뺀다.
- 수업·개인 일정·다른 공부 블록(schedules), 이벤트(events), 시험 시간(exam_schedules)이
  차지한 칸도 뺀다. 블록 사이 여유 시간은 두지 않는다.
- 날짜는 한국 시간 기준이다(Railway 서버는 UTC일 수 있음).

순수 함수(free_slot_starts 등)와 DB를 읽는 함수(load_free_slots)를 나눠 두어서
순수 함수는 DB 없이 테스트할 수 있다.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.models import UserProfile
from app.core.time_utils import minutes_to_time, time_to_minutes
from app.schedule.models import Event, ExamSchedule, Schedule

KST = ZoneInfo("Asia/Seoul")

SLOT_MINUTES = 30
DAY_MINUTES = 24 * 60
DEFAULT_WAKE = "07:00"   # 온보딩에서 수면 시간을 안 넣었을 때
DEFAULT_SLEEP = "23:00"

Interval = tuple[int, int]  # [시작분, 끝분)


# ── 시간 ──────────────────────────────────────────────────────────────────────

def kst_now() -> datetime:
    return datetime.now(KST)


def kst_today() -> date:
    return kst_now().date()


def minutes_of(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def ceil_to_slot(minute: int) -> int:
    """다음 :00/:30 경계로 올림. 이미 경계면 그대로."""
    return -(-minute // SLOT_MINUTES) * SLOT_MINUTES


def daterange(start: date, end: date):
    """start ~ end (양끝 포함)."""
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


# ── 순수 계산 ─────────────────────────────────────────────────────────────────

def awake_windows(wake: int, sleep: int) -> list[Interval]:
    """깨어 있는 구간.

    보통은 wake < sleep (07:00~23:00).
    자정 넘어 자는 경우(sleep 01:00, wake 08:00)는 [00:00, 01:00) + [08:00, 24:00).
    """
    if wake < sleep:
        return [(wake, sleep)]
    return [(0, sleep), (wake, DAY_MINUTES)]


def _to_interval(start: str | None, end: str | None) -> Interval | None:
    if not start or not end:
        return None
    s = time_to_minutes(start, default=-1)
    e = time_to_minutes(end, default=-1)
    if s < 0 or e < 0:
        return None
    if e <= s:  # 자정을 넘기는 일정은 그날 끝까지로 본다
        e = DAY_MINUTES
    return (s, e)


def free_slot_starts(
    busy: list[Interval],
    wake: int,
    sleep: int,
    earliest: int = 0,
) -> list[int]:
    """하루 중 비어 있는 30분 칸들의 시작 시각(분). 오름차순.

    earliest: 이 시각 이전 칸은 버린다(오늘이면 '지금 이후'). 30분 경계로 올려서 쓴다.
    """
    earliest = ceil_to_slot(max(0, earliest))
    starts: list[int] = []
    for ws, we in awake_windows(wake, sleep):
        s = max(ceil_to_slot(ws), earliest)
        while s + SLOT_MINUTES <= we:
            e = s + SLOT_MINUTES
            if not any(bs < e and s < be for bs, be in busy):
                starts.append(s)
            s += SLOT_MINUTES
    return sorted(starts)


def merge_slots(starts: list[int]) -> list[Interval]:
    """붙어 있는 30분 칸을 한 덩어리로 묶는다. [600, 630, 720] → [(600, 660), (720, 750)]"""
    segments: list[Interval] = []
    for s in sorted(starts):
        if segments and segments[-1][1] == s:
            segments[-1] = (segments[-1][0], s + SLOT_MINUTES)
        else:
            segments.append((s, s + SLOT_MINUTES))
    return segments


def fmt(minute: int) -> str:
    """분 → 'HH:MM'. 하루 끝(24:00)은 스키마가 받는 23:59로 적는다."""
    return minutes_to_time(min(minute, DAY_MINUTES - 1))


# ── DB 읽기 ───────────────────────────────────────────────────────────────────

def get_wake_sleep(db: Session, user_id: int) -> tuple[int, int]:
    """기상/취침 시각(분). 설정 없으면 07:00/23:00."""
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    wake = time_to_minutes(profile.sleep_end if profile and profile.sleep_end else DEFAULT_WAKE)
    sleep = time_to_minutes(profile.sleep_start if profile and profile.sleep_start else DEFAULT_SLEEP)
    return wake, sleep


def _not_deleted():
    return or_(Schedule.deleted_by_user.is_(None), Schedule.deleted_by_user == False)  # noqa: E712


def load_busy(
    db: Session,
    user_id: int,
    start: date,
    end: date,
    exclude_schedule_ids: set[int] | frozenset[int] = frozenset(),
) -> dict[date, list[Interval]]:
    """start~end 날짜마다 이미 차 있는 구간."""
    busy: dict[date, list[Interval]] = {d: [] for d in daterange(start, end)}
    if not busy:
        return busy

    # 1) schedules: 매주 반복(date 없음) + 특정 날짜
    rows = db.query(Schedule).filter(Schedule.user_id == user_id, _not_deleted()).all()
    for s in rows:
        if s.id in exclude_schedule_ids:
            continue
        iv = _to_interval(s.start_time, s.end_time)
        if iv is None:
            continue
        if s.date:
            try:
                d = date.fromisoformat(s.date)
            except ValueError:
                continue
            if d in busy:
                busy[d].append(iv)
        else:
            dow = s.day_of_week
            if dow is None:
                continue
            for d in busy:
                if d.weekday() == dow:
                    busy[d].append(iv)

    # 2) events
    events = (
        db.query(Event)
        .filter(Event.user_id == user_id, Event.date >= start, Event.date <= end)
        .all()
    )
    for ev in events:
        iv = _to_interval(ev.start_time, ev.end_time)
        if iv and ev.date in busy:
            busy[ev.date].append(iv)

    # 3) 시험 시간
    exams = (
        db.query(ExamSchedule)
        .filter(ExamSchedule.user_id == user_id, ExamSchedule.exam_date >= start, ExamSchedule.exam_date <= end)
        .all()
    )
    for ex in exams:
        iv = _to_interval(ex.start_time, ex.end_time)
        if iv is None:
            begin = ex.start_time or ex.exam_time
            if begin:
                b = time_to_minutes(begin, default=-1)
                if b >= 0:
                    iv = (b, min(DAY_MINUTES, b + (ex.exam_duration_minutes or 120)))
        if iv and ex.exam_date in busy:
            busy[ex.exam_date].append(iv)

    return busy


def load_free_slots(
    db: Session,
    user_id: int,
    start: date,
    end: date,
    now: datetime | None = None,
    exclude_schedule_ids: set[int] | frozenset[int] = frozenset(),
) -> dict[date, list[int]]:
    """start~end 날짜마다 비어 있는 30분 칸 시작 시각. 오늘은 지금 이후만."""
    now = now or kst_now()
    today = now.date()
    start = max(start, today)
    if end < start:
        return {}
    wake, sleep = get_wake_sleep(db, user_id)
    busy = load_busy(db, user_id, start, end, exclude_schedule_ids)
    return {
        d: free_slot_starts(intervals, wake, sleep, earliest=minutes_of(now) if d == today else 0)
        for d, intervals in busy.items()
    }
