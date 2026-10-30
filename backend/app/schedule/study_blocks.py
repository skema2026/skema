"""시험 공부 블록 자동 배치 (#12, 스펙 3번).

시험 날짜·과목을 넣으면 시험 전날까지 빈 시간에 30분 단위 공부 블록을 넣는다.
빈 시간은 다시 짜기(#11)와 같은 free_slots 모듈로 계산한다.

- 온보딩에서 고르는 값(며칠 전부터, 주 며칠, 하루 몇 시간)을 그대로 받는다.
- 블록 제목은 OpenAI 없이 "📖 {과목} 준비"로 만든다.
- 블록마다 linked_exam_id를 붙인다(시험 준비도 계산, #17).
- 시험이 여러 개면 날짜가 가까운 시험부터 자리를 잡는다.

plan_study_blocks()는 DB 없이 돌아가는 순수 함수라 테스트에서 바로 부른다.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schedule.free_slots import SLOT_MINUTES, fmt, kst_now, load_free_slots, merge_slots
from app.schedule.models import DayOfWeek, ExamSchedule, INT_TO_DAY, Schedule

STUDY_COLOR = "#059669"
# 프론트 scheduleColor.ts가 study + ai_generated + linked_exam_id 조합을 시험 색으로 칠하고,
# 기존 AI 재생성 로직도 이 값으로 지울 블록을 찾는다. 프론트 타입에 새 값이 없어서 그대로 쓴다.
STUDY_SOURCE = "ai_generated"


@dataclass
class ExamIn:
    id: int
    name: str
    exam_date: date


def study_title(name: str) -> str:
    return f"📖 {name} 준비"


def candidate_days(exam_date: date, today: date, start_days_before: int) -> list[date]:
    """공부할 수 있는 날들. 시험 전날까지. start_days_before=0이면 오늘부터."""
    last = exam_date - timedelta(days=1)
    first = today if start_days_before <= 0 else max(today, exam_date - timedelta(days=start_days_before))
    days = []
    d = first
    while d <= last:
        days.append(d)
        d += timedelta(days=1)
    return days


def choose_days(days: list[date], free: dict[date, list[int]], days_per_week: int) -> list[date]:
    """7일씩 끊어서 빈 칸이 많은 날을 days_per_week개 고른다(같으면 앞 날짜)."""
    if days_per_week >= 7:
        return list(days)
    chosen: list[date] = []
    for i in range(0, len(days), 7):
        week = days[i:i + 7]
        ranked = sorted(week, key=lambda d: (-len(free.get(d, [])), d))
        chosen.extend(sorted(ranked[:days_per_week]))
    return chosen


def plan_study_blocks(
    exams: list[ExamIn],
    free: dict[date, list[int]],
    today: date,
    start_days_before: int,
    days_per_week: int,
    minutes_per_day: int,
) -> tuple[list[dict], list[dict]]:
    """(blocks, results). free는 바꾸지 않는다.

    blocks: [{exam_id, title, date, start_time, end_time}]
    results: 시험별 {exam_id, title, planned_minutes, placed_minutes, block_count}
    """
    free = {d: list(v) for d, v in free.items()}
    per_day = max(1, minutes_per_day // SLOT_MINUTES)
    blocks: list[dict] = []
    results: list[dict] = []

    for ex in sorted(exams, key=lambda e: (e.exam_date, e.id)):
        days = candidate_days(ex.exam_date, today, start_days_before)
        chosen = choose_days(days, free, days_per_week)
        placed = 0
        count = 0
        for d in chosen:
            take = free.get(d, [])[:per_day]
            for s in take:
                free[d].remove(s)
            for s, e in merge_slots(take):
                blocks.append({
                    "exam_id": ex.id,
                    "title": study_title(ex.name),
                    "date": d.isoformat(),
                    "start_time": fmt(s),
                    "end_time": fmt(e),
                })
                count += 1
            placed += len(take) * SLOT_MINUTES
        results.append({
            "exam_id": ex.id,
            "title": ex.name,
            "planned_minutes": len(chosen) * per_day * SLOT_MINUTES,
            "placed_minutes": placed,
            "block_count": count,
        })
    return blocks, results


def generate(
    db: Session,
    user_id: int,
    exam_ids: list[int],
    start_days_before: int,
    days_per_week: int,
    minutes_per_day: int,
    replace: bool = True,
    now: datetime | None = None,
) -> dict:
    now = now or kst_now()
    today = now.date()

    rows = (
        db.query(ExamSchedule)
        .filter(ExamSchedule.user_id == user_id, ExamSchedule.id.in_(exam_ids))
        .all()
    ) if exam_ids else []
    found = {r.id for r in rows}
    missing = [i for i in exam_ids if i not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": f"시험 {missing}을 찾을 수 없습니다."})

    exams = [ExamIn(id=r.id, name=r.subject or r.title, exam_date=r.exam_date) for r in rows]

    removed = 0
    if replace and exams:
        # 다시 만들 때: 아직 안 한(미완료·미삭제) 오늘 이후 자동 블록만 지운다
        old = db.query(Schedule).filter(
            Schedule.user_id == user_id,
            Schedule.linked_exam_id.in_(found),
            Schedule.schedule_source == STUDY_SOURCE,
            Schedule.schedule_type == "study",
            Schedule.is_completed.isnot(True),
            Schedule.deleted_by_user.isnot(True),
            Schedule.date >= today.isoformat(),
        ).all()
        for blk in old:
            db.delete(blk)
        removed = len(old)
        db.flush()

    blocks: list[dict] = []
    results: list[dict] = []
    if exams:
        last = max(e.exam_date for e in exams) - timedelta(days=1)
        free = load_free_slots(db, user_id, today, last, now=now)
        blocks, results = plan_study_blocks(exams, free, today, start_days_before, days_per_week, minutes_per_day)

    new_rows = []
    for b in blocks:
        row = Schedule(
            user_id=user_id,
            course_name=b["title"],
            recurring_day=DayOfWeek(INT_TO_DAY[date.fromisoformat(b["date"]).weekday()]),
            date=b["date"],
            start_time=b["start_time"],
            end_time=b["end_time"],
            color_code=STUDY_COLOR,
            schedule_type="study",
            schedule_source=STUDY_SOURCE,
            linked_exam_id=b["exam_id"],
            priority=1,
            is_completed=False,
        )
        db.add(row)
        new_rows.append(row)
    db.flush()
    for b, row in zip(blocks, new_rows):
        b["schedule_id"] = row.id
    db.commit()

    short = [r for r in results if r["placed_minutes"] < r["planned_minutes"]]
    return {
        "created": len(new_rows),
        "removed": removed,
        "blocks": blocks,
        "exams": results,
        "warning": "자리가 부족해요" if short else None,
    }
