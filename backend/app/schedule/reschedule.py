"""다시 짜기 (#11) — 규칙 v1 (스펙 5번, 10/7 확정).

1. 대상: 시작 시간이 지났는데 완료 안 된 공부·과제 블록
2. 수업·시험·개인 일정은 움직이지 않음
3. 지금 이후 빈 시간을 30분 칸으로 채움. 수면 시간 제외, 여유 시간 없음
4. 블록 길이 30분 단위
5. 시험·마감이 가까운 블록부터
6. 오늘부터 시험 전날까지. 안 들어가면 "자리가 부족해요"
7. 미리보기 → 적용
8. AI 안 씀 (같은 상태면 항상 같은 결과)

plan_moves()는 DB 없이 돌아가는 순수 함수라 테스트에서 바로 부른다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.time_utils import time_to_minutes
from app.schedule.free_slots import (
    SLOT_MINUTES,
    ceil_to_slot,
    fmt,
    kst_now,
    load_free_slots,
    merge_slots,
    minutes_of,
)
from app.schedule.models import DayOfWeek, ExamSchedule, INT_TO_DAY, Schedule

TARGET_TYPES = ("study", "assignment")
# 시험과 연결 안 된 블록은 오늘부터 이 날수 안에서만 자리를 찾는다 (오늘 포함)
NO_EXAM_RANGE_DAYS = 7
# 긴 블록을 여러 자리로 나눠 넣을지. False면 연속된 한 자리에만 넣는다.
ALLOW_SPLIT = True

WARNING_NO_SLOT = "자리가 부족해요"


@dataclass
class Target:
    schedule_id: int
    title: str
    schedule_type: str
    linked_exam_id: int | None
    deadline: date          # 이 날짜까지 넣을 수 있음 (포함)
    minutes: int            # 30분 단위로 올린 길이
    from_date: str
    from_start: str
    from_end: str
    has_exam: bool = field(default=False)

    def sort_key(self):
        # 시험 연결 블록 먼저 → 마감 가까운 순 → 원래 시작 시각 → id
        return (0 if self.has_exam else 1, self.deadline, self.from_date, self.from_start, self.schedule_id)


# ── 순수 계산 ─────────────────────────────────────────────────────────────────

def block_minutes(start: str, end: str) -> int:
    """블록 길이를 30분 단위로 올림. 최소 30분."""
    s, e = time_to_minutes(start), time_to_minutes(end)
    if e <= s:
        e = 24 * 60
    return max(SLOT_MINUTES, ceil_to_slot(e - s))


def _take_slots(free: dict[date, list[int]], deadline: date, need: int, split: bool) -> list[tuple[date, int]] | None:
    """deadline까지의 빈 칸에서 need개를 앞에서부터 고른다. 모자라면 None."""
    days = sorted(d for d in free if d <= deadline)
    if split:
        picked: list[tuple[date, int]] = []
        for d in days:
            for s in free[d]:
                picked.append((d, s))
                if len(picked) == need:
                    return picked
        return None
    # 나누지 않음: 같은 날 연속된 need칸
    for d in days:
        starts = free[d]
        run: list[int] = []
        for s in starts:
            run = run + [s] if run and run[-1] + SLOT_MINUTES == s else [s]
            if len(run) == need:
                return [(d, x) for x in run]
    return None


def plan_moves(
    targets: list[Target],
    free: dict[date, list[int]],
    today: date,
    split: bool = ALLOW_SPLIT,
) -> tuple[list[dict], list[dict]]:
    """targets를 free 칸에 배치. (moves, unplaced)를 돌려준다. free는 바꾸지 않는다."""
    free = {d: list(v) for d, v in free.items()}
    moves: list[dict] = []
    unplaced: list[dict] = []

    for t in sorted(targets, key=Target.sort_key):
        base = {
            "schedule_id": t.schedule_id,
            "title": t.title,
            "deadline": t.deadline.isoformat(),
        }
        if t.deadline < today:
            unplaced.append({**base, "minutes": t.minutes, "reason": "DEADLINE_PASSED"})
            continue
        picked = _take_slots(free, t.deadline, t.minutes // SLOT_MINUTES, split)
        if picked is None:
            unplaced.append({**base, "minutes": t.minutes, "reason": "NO_SLOT"})
            continue

        by_day: dict[date, list[int]] = {}
        for d, s in picked:
            free[d].remove(s)
            by_day.setdefault(d, []).append(s)
        to = [
            {"date": d.isoformat(), "start_time": fmt(s), "end_time": fmt(e)}
            for d in sorted(by_day)
            for s, e in merge_slots(by_day[d])
        ]
        moves.append({
            **base,
            "schedule_type": t.schedule_type,
            "linked_exam_id": t.linked_exam_id,
            "from": {"date": t.from_date, "start_time": t.from_start, "end_time": t.from_end},
            "to": to,
        })
    return moves, unplaced


# ── DB ────────────────────────────────────────────────────────────────────────

def _is_target_row(s: Schedule, now: datetime) -> bool:
    if (s.schedule_type or "class") not in TARGET_TYPES:
        return False
    if s.is_completed or s.deleted_by_user or not s.date:
        return False
    today = now.date().isoformat()
    if s.date < today:
        return True
    return s.date == today and time_to_minutes(s.start_time, default=0) < minutes_of(now)


def _target_rows(db: Session, user_id: int, now: datetime) -> list[Schedule]:
    rows = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user_id,
            Schedule.schedule_type.in_(TARGET_TYPES),
            Schedule.date.isnot(None),
            Schedule.date <= now.date().isoformat(),
            or_(Schedule.is_completed.is_(None), Schedule.is_completed == False),  # noqa: E712
            or_(Schedule.deleted_by_user.is_(None), Schedule.deleted_by_user == False),  # noqa: E712
        )
        .all()
    )
    return [s for s in rows if _is_target_row(s, now)]


def _to_targets(db: Session, user_id: int, rows: list[Schedule], today: date) -> list[Target]:
    exam_ids = {s.linked_exam_id for s in rows if s.linked_exam_id}
    exam_dates: dict[int, date] = {}
    if exam_ids:
        for ex in db.query(ExamSchedule).filter(ExamSchedule.user_id == user_id, ExamSchedule.id.in_(exam_ids)):
            exam_dates[ex.id] = ex.exam_date

    targets = []
    for s in rows:
        exam_date = exam_dates.get(s.linked_exam_id) if s.linked_exam_id else None
        if exam_date:
            deadline, has_exam = exam_date - timedelta(days=1), True
        else:
            deadline, has_exam = today + timedelta(days=NO_EXAM_RANGE_DAYS - 1), False
        targets.append(Target(
            schedule_id=s.id,
            title=s.course_name,
            schedule_type=s.schedule_type,
            linked_exam_id=s.linked_exam_id,
            deadline=deadline,
            minutes=block_minutes(s.start_time, s.end_time),
            from_date=s.date,
            from_start=s.start_time,
            from_end=s.end_time,
            has_exam=has_exam,
        ))
    return targets


def preview(db: Session, user_id: int, now: datetime | None = None) -> dict:
    now = now or kst_now()
    today = now.date()
    rows = _target_rows(db, user_id, now)
    targets = _to_targets(db, user_id, rows, today)

    moves: list[dict] = []
    unplaced: list[dict] = []
    if targets:
        last = max(t.deadline for t in targets)
        free = load_free_slots(db, user_id, today, last, now=now, exclude_schedule_ids={t.schedule_id for t in targets})
        moves, unplaced = plan_moves(targets, free, today)

    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "moves": moves,
        "unplaced": unplaced,
        "warning": WARNING_NO_SLOT if unplaced else None,
        "summary": {"target": len(targets), "placed": len(moves), "unplaced": len(unplaced)},
    }


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": code, "message": message})


def apply(db: Session, user_id: int, moves: list, now: datetime | None = None) -> dict:
    """미리보기에서 받은 moves를 적용. 전부 되거나 전부 안 된다.

    moves: [{schedule_id, to: [{date, start_time, end_time}]}] (pydantic 모델 또는 dict)
    """
    now = now or kst_now()
    today = now.date()

    ids = [m.schedule_id for m in moves]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="같은 schedule_id가 두 번 들어 있습니다.")

    rows = {
        s.id: s
        for s in db.query(Schedule).filter(Schedule.user_id == user_id, Schedule.id.in_(ids)).all()
    } if ids else {}
    for sid in ids:
        if sid not in rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": f"일정 {sid}을 찾을 수 없습니다."})
        if not _is_target_row(rows[sid], now):
            raise _conflict("ALREADY_CHANGED", "옮길 일정이 그새 완료·삭제되었거나 바뀌었어요. 미리보기를 다시 불러와 주세요.")

    # 들어갈 자리가 지금도 비어 있는지 확인
    wanted: list[tuple[date, int, int]] = []
    for m in moves:
        for seg in m.to:
            d = date.fromisoformat(seg.date)
            s, e = time_to_minutes(seg.start_time), time_to_minutes(seg.end_time)
            wanted.append((d, s, e))
    if wanted:
        first = min(d for d, _, _ in wanted)
        last = max(d for d, _, _ in wanted)
        free = load_free_slots(db, user_id, first, last, now=now, exclude_schedule_ids=set(ids))
        used: set[tuple[date, int]] = set()
        for d, s, e in wanted:
            for slot in range(s, e, SLOT_MINUTES):
                if d < today or slot not in free.get(d, []) or (d, slot) in used:
                    raise _conflict("SLOT_TAKEN", "그 시간에 다른 일정이 생겼어요. 미리보기를 다시 불러와 주세요.")
                used.add((d, slot))

    updated_ids: list[int] = []
    created_ids: list[int] = []
    new_rows: list[Schedule] = []
    for m in moves:
        src = rows[m.schedule_id]
        segments = sorted(m.to, key=lambda seg: (seg.date, seg.start_time))
        if not segments:
            continue
        first_seg, rest = segments[0], segments[1:]
        _move(src, first_seg.date, first_seg.start_time, first_seg.end_time)
        updated_ids.append(src.id)
        for seg in rest:
            row = Schedule(
                user_id=user_id,
                course_name=src.course_name,
                professor=src.professor,
                location=src.location,
                color_code=src.color_code,
                priority=src.priority,
                schedule_type=src.schedule_type,
                schedule_source=src.schedule_source,
                linked_exam_id=src.linked_exam_id,
                original_generated_title=src.original_generated_title,
                view_scope=src.view_scope,
                recurring_day=_dow_enum(seg.date),
                date=seg.date,
                start_time=seg.start_time,
                end_time=seg.end_time,
                is_completed=False,
            )
            db.add(row)
            new_rows.append(row)

    db.flush()
    created_ids = [r.id for r in new_rows]
    db.commit()
    return {"applied": len(updated_ids), "updated_ids": updated_ids, "created_ids": created_ids}


def _dow_enum(date_str: str) -> DayOfWeek:
    return DayOfWeek(INT_TO_DAY[date.fromisoformat(date_str).weekday()])


def _move(s: Schedule, date_str: str, start: str, end: str) -> None:
    s.date = date_str
    s.recurring_day = _dow_enum(date_str)
    s.start_time = start
    s.end_time = end
