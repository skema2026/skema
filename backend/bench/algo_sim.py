"""공부 블록 배치·다시 짜기 알고리즘 시뮬레이션 테스트 (결과보고서 6장용).

운영 코드의 순수 함수(free_slot_starts, plan_study_blocks, plan_moves)를 그대로 불러
무작위 대학생 시간표 N개에서 규칙을 하나라도 어기는지 검사하고, 배치율·속도를 잰다.
DB·서버 없이 돈다. 같은 시드면 항상 같은 결과.

    cd backend && python bench/algo_sim.py --n 10000 --seed 20261113 --out bench/results/algo_result.json
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(BACKEND))

from app.schedule.free_slots import (  # noqa: E402
    DAY_MINUTES,
    SLOT_MINUTES,
    awake_windows,
    ceil_to_slot,
    free_slot_starts,
    preference_rank,
)
from app.schedule.reschedule import Target, plan_moves  # noqa: E402
from app.schedule.study_blocks import ExamIn, plan_study_blocks  # noqa: E402

Interval = tuple[int, int]


def hm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def to_min(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def seg_interval(start: str, end: str) -> Interval:
    s, e = to_min(start), to_min(end)
    if end == "23:59":  # fmt()이 24:00을 23:59로 적는다
        e = DAY_MINUTES
    return s, e


def overlaps(a: Interval, b: Interval) -> bool:
    return a[0] < b[1] and b[0] < a[1]


# ── 무작위 학생 만들기 ─────────────────────────────────────────────────────────

CLASS_LEN = [50, 75, 90, 100, 150, 180]           # 50분·75분 수업, 3시간 실습 등
CLASS_STARTS = [m for m in range(9 * 60, 18 * 60 + 1, 30)]


def random_student(rng: random.Random) -> dict:
    # 수면: 23시 전후 ~ 새벽 2시에 자고, 6~10시에 일어남 (자정 넘겨 자는 사람 포함)
    sleep = rng.choice([22 * 60, 22 * 60 + 30, 23 * 60, 23 * 60 + 30, 0, 30, 60, 90, 120])
    wake = rng.choice([6 * 60, 6 * 60 + 30, 7 * 60, 7 * 60 + 30, 8 * 60, 9 * 60, 10 * 60])
    # 매주 수업 (월~금), 하루 0~4개, 겹치지 않게
    weekly: dict[int, list[Interval]] = {d: [] for d in range(7)}
    for dow in range(5):
        for _ in range(rng.choice([0, 1, 2, 2, 3, 3, 4])):
            for _try in range(10):
                s = rng.choice(CLASS_STARTS)
                iv = (s, min(s + rng.choice(CLASS_LEN), 22 * 60))
                if not any(overlaps(iv, x) for x in weekly[dow]):
                    weekly[dow].append(iv)
                    break
    # 개인 일정: 알바(저녁 3~5시간, 주 0~3일), 동아리·운동(주 0~2회)
    for _ in range(rng.choice([0, 0, 1, 2, 3])):
        dow = rng.randrange(7)
        s = rng.choice([17 * 60, 18 * 60, 19 * 60])
        iv = (s, s + rng.choice([180, 240, 300]))
        if not any(overlaps(iv, x) for x in weekly[dow]):
            weekly[dow].append(iv)
    for _ in range(rng.choice([0, 1, 2])):
        dow = rng.randrange(7)
        s = rng.choice([7 * 60, 12 * 60, 20 * 60, 21 * 60])
        iv = (s, s + rng.choice([60, 90, 120]))
        if not any(overlaps(iv, x) for x in weekly[dow]):
            weekly[dow].append(iv)
    return {"wake": wake, "sleep": sleep, "weekly": weekly}


def random_exams(rng: random.Random, today: date) -> list[dict]:
    exams = []
    for i in range(rng.choice([1, 1, 2, 2, 3, 4])):
        exam_date = today + timedelta(days=rng.randint(1, 21))
        start = rng.choice([9 * 60, 10 * 60 + 30, 13 * 60, 15 * 60, 18 * 60])
        exams.append({"id": i + 1, "name": f"과목{i + 1}", "date": exam_date,
                      "interval": (start, start + rng.choice([60, 75, 90, 120]))})
    return exams


def busy_by_date(st: dict, exams: list[dict], start: date, end: date) -> dict[date, list[Interval]]:
    busy: dict[date, list[Interval]] = {}
    d = start
    while d <= end:
        busy[d] = list(st["weekly"][d.weekday()])
        d += timedelta(days=1)
    for ex in exams:
        if ex["date"] in busy:
            busy[ex["date"]].append(ex["interval"])
    return busy


def free_map(st: dict, busy: dict[date, list[Interval]], today: date, now_min: int) -> dict[date, list[int]]:
    return {
        d: free_slot_starts(iv, st["wake"], st["sleep"], earliest=now_min if d == today else 0)
        for d, iv in busy.items()
    }


def in_awake(seg: Interval, wake: int, sleep: int) -> bool:
    return any(ws <= seg[0] and seg[1] <= we for ws, we in awake_windows(wake, sleep))


# ── 검사 ─────────────────────────────────────────────────────────────────────

class Checker:
    def __init__(self) -> None:
        self.violations: dict[str, int] = {}
        self.examples: dict[str, str] = {}

    def fail(self, rule: str, detail: str) -> None:
        self.violations[rule] = self.violations.get(rule, 0) + 1
        self.examples.setdefault(rule, detail)


def check_study(ck: Checker, st, exams, busy, free, today, now_min, settings, blocks, results, seed) -> dict:
    sdb, dpw, mpd = settings
    per_day = max(1, mpd // SLOT_MINUTES)
    exam_by_id = {e["id"]: e for e in exams}
    placed: list[tuple[date, Interval, int]] = []
    for b in blocks:
        d = date.fromisoformat(b["date"])
        seg = seg_interval(b["start_time"], b["end_time"])
        ex = exam_by_id[b["exam_id"]]
        tag = f"seed={seed} {b}"
        if seg[0] % SLOT_MINUTES or seg[1] % SLOT_MINUTES or seg[1] <= seg[0]:
            ck.fail("S1 30분 칸 단위", tag)
        if any(overlaps(seg, x) for x in busy.get(d, [])):
            ck.fail("S2 수업·개인 일정·시험과 겹치지 않음", tag)
        if not in_awake(seg, st["wake"], st["sleep"]):
            ck.fail("S3 수면 시간에 넣지 않음", tag)
        if any(pd == d and overlaps(seg, ps) for pd, ps, _ in placed):
            ck.fail("S4 블록끼리 겹치지 않음", tag)
        if not (today <= d < ex["date"]):
            ck.fail("S5 오늘~시험 전날 안", tag)
        if sdb > 0 and d < ex["date"] - timedelta(days=sdb):
            ck.fail("S6 '며칠 전부터' 설정 지킴", tag)
        if d == today and seg[0] < ceil_to_slot(now_min):
            ck.fail("S7 오늘은 지금 이후만", tag)
        placed.append((d, seg, b["exam_id"]))

    # 시험별 하루 목표·주 며칠
    for ex in exams:
        mine = [(d, s) for d, s, eid in placed if eid == ex["id"]]
        per: dict[date, int] = {}
        for d, s in mine:
            per[d] = per.get(d, 0) + (s[1] - s[0])
        if any(v > per_day * SLOT_MINUTES for v in per.values()):
            ck.fail("S8 하루 목표 시간 넘지 않음", f"seed={seed} exam={ex['id']} {per}")
        days_used = sorted(per)
        if days_used:
            first = days_used[0]
            # choose_days는 후보 첫날부터 7일씩 끊는다 → 같은 7일 묶음 안 날 수 ≤ dpw
            last = ex["date"] - timedelta(days=1)
            cand_first = today if sdb <= 0 else max(today, ex["date"] - timedelta(days=sdb))
            buckets: dict[int, int] = {}
            for d in days_used:
                k = (d - cand_first).days // 7
                buckets[k] = buckets.get(k, 0) + 1
            if any(v > dpw for v in buckets.values()):
                ck.fail("S9 주 며칠 설정 지킴", f"seed={seed} exam={ex['id']} {buckets}")
            _ = first, last

    # 저녁 우선: 고른 날 안에서, 고른 칸보다 우선순위가 높은 빈 칸이 남아 있으면 안 됨
    #  (시험 순서대로 칸을 소비하므로, 해당 시험 차례에 남아 있던 칸 기준으로 다시 계산)
    remaining = {d: list(v) for d, v in free.items()}
    for ex in sorted(exams, key=lambda e: (e["date"], e["id"])):
        mine_by_day: dict[date, list[int]] = {}
        for d, s, eid in placed:
            if eid == ex["id"]:
                mine_by_day.setdefault(d, []).extend(range(s[0], s[1], SLOT_MINUTES))
        for d, slots in mine_by_day.items():
            worst = max(preference_rank(x) for x in slots)
            better_left = [x for x in remaining.get(d, []) if x not in slots and preference_rank(x) < worst]
            if better_left:
                ck.fail("S10 저녁→오후→오전 순서", f"seed={seed} {d} picked={slots} left={better_left[:3]}")
            for x in slots:
                if x in remaining.get(d, []):
                    remaining[d].remove(x)

    planned = sum(r["planned_minutes"] for r in results)
    got = sum(r["placed_minutes"] for r in results)
    evening = sum(s[1] - s[0] for _, s, _ in placed if s[0] >= 19 * 60)
    return {"planned": planned, "placed": got, "evening": evening, "blocks": len(blocks)}


def check_moves(ck: Checker, st, busy_fixed, free, today, now_min, targets, moves, unplaced, seed) -> dict:
    tmap = {t.schedule_id: t for t in targets}
    used: list[tuple[date, Interval]] = []
    moved_minutes = 0
    for m in moves:
        t = tmap.get(m["schedule_id"])
        tag = f"seed={seed} {m['schedule_id']} {m['to']}"
        if t is None:
            ck.fail("R1 대상 블록만 옮김", tag)
            continue
        total = 0
        for seg in m["to"]:
            d = date.fromisoformat(seg["date"])
            iv = seg_interval(seg["start_time"], seg["end_time"])
            total += iv[1] - iv[0]
            if any(overlaps(iv, x) for x in busy_fixed.get(d, [])):
                ck.fail("R2 수업·개인 일정·시험·남은 블록과 겹치지 않음", tag)
            if not in_awake(iv, st["wake"], st["sleep"]):
                ck.fail("R3 수면 시간에 넣지 않음", tag)
            if any(ud == d and overlaps(iv, us) for ud, us in used):
                ck.fail("R4 옮긴 블록끼리 겹치지 않음", tag)
            if not (today <= d <= t.deadline):
                ck.fail("R5 오늘~마감(시험 전날) 안", tag)
            if d == today and iv[0] < ceil_to_slot(now_min):
                ck.fail("R6 지금 이후 칸만", tag)
            used.append((d, iv))
        if total != t.minutes:
            ck.fail("R7 블록 길이 그대로(30분 단위)", f"{tag} total={total} need={t.minutes}")
        moved_minutes += total
    for u in unplaced:
        t = tmap[u["schedule_id"]]
        # 자리가 없다고 했으면, 그 차례에 정말 칸이 모자랐는지 다시 확인
        if u["reason"] == "NO_SLOT":
            left = sum(1 for d, slots in free.items() if d <= t.deadline for s in slots
                       if not any(ud == d and overlaps((s, s + SLOT_MINUTES), us) for ud, us in used))
            if left >= t.minutes // SLOT_MINUTES and _would_fit_after(t, moves, targets):
                ck.fail("R8 자리 있으면 '자리 부족'이라 하지 않음", f"seed={seed} {u} left={left}")
    return {"targets": len(targets), "moved": len(moves), "unplaced": len(unplaced), "moved_minutes": moved_minutes}


def _would_fit_after(t: Target, moves, targets) -> bool:
    """t보다 뒤 순서 대상이 칸을 가져가서 t가 못 들어간 경우는 규칙 위반이 아니다.
    plan_moves는 순서대로 칸을 가져가므로, t보다 앞 순서 대상만 고려해야 정확하다.
    여기서는 t 뒤 순서가 옮겨진 게 있으면 판단 보류(False)."""
    later = [x for x in targets if x.sort_key() > t.sort_key()]
    later_ids = {x.schedule_id for x in later}
    return not any(m["schedule_id"] in later_ids for m in moves)


# ── 실행 ─────────────────────────────────────────────────────────────────────

def run(n: int, seed: int) -> dict:
    rng = random.Random(seed)
    ck = Checker()
    study_stats = {"planned": 0, "placed": 0, "evening": 0, "blocks": 0, "short_cases": 0}
    move_stats = {"targets": 0, "moved": 0, "unplaced": 0}
    t_study: list[float] = []
    t_move: list[float] = []
    nondeterministic = 0
    base_today = date(2026, 11, 16)

    for i in range(n):
        case_seed = rng.randrange(10**9)
        r = random.Random(case_seed)
        st = random_student(r)
        today = base_today + timedelta(days=r.randrange(7))
        now_min = r.randrange(6 * 60, 24 * 60)
        exams = random_exams(r, today)
        settings = (r.choice([0, 7, 14, 21]), r.choice([2, 3, 4, 5, 7]), r.choice([60, 90, 120, 180, 240]))
        last = max(e["date"] for e in exams) - timedelta(days=1)
        busy = busy_by_date(st, exams, today, max(last, today))
        free = free_map(st, busy, today, now_min)
        exam_in = [ExamIn(id=e["id"], name=e["name"], exam_date=e["date"]) for e in exams]

        t0 = time.perf_counter()
        blocks, results = plan_study_blocks(exam_in, free, today, *settings)
        t_study.append((time.perf_counter() - t0) * 1000)
        again = plan_study_blocks(exam_in, free, today, *settings)
        if again != (blocks, results):
            nondeterministic += 1
        s = check_study(ck, st, exams, busy, free, today, now_min, settings, blocks, results, case_seed)
        for k in ("planned", "placed", "evening", "blocks"):
            study_stats[k] += s[k]
        if s["placed"] < s["planned"]:
            study_stats["short_cases"] += 1

        # ── 다시 짜기: 며칠 뒤로 시간을 보내고, 지난 블록 일부를 '못 함'으로 ──
        if not blocks:
            continue
        later_today = today + timedelta(days=r.randint(1, 5))
        later_now = r.randrange(7 * 60, 23 * 60)
        targets: list[Target] = []
        kept: list[tuple[date, Interval]] = []
        for idx, b in enumerate(blocks):
            d = date.fromisoformat(b["date"])
            iv = seg_interval(b["start_time"], b["end_time"])
            started = d < later_today or (d == later_today and iv[0] < later_now)
            if started and r.random() < 0.6:
                ex = next(e for e in exams if e["id"] == b["exam_id"])
                targets.append(Target(
                    schedule_id=idx + 1, title=b["title"], schedule_type="study", linked_exam_id=ex["id"],
                    deadline=ex["date"] - timedelta(days=1), minutes=max(30, -(-(iv[1] - iv[0]) // 30) * 30),
                    from_date=b["date"], from_start=b["start_time"], from_end=b["end_time"], has_exam=True,
                ))
            elif not started:
                kept.append((d, iv))  # 아직 안 한 미래 블록은 그대로 자리를 차지
        # 시험 없는 과제 블록도 가끔 섞는다 (7일 안)
        if r.random() < 0.3:
            targets.append(Target(
                schedule_id=99_999, title="과제", schedule_type="assignment", linked_exam_id=None,
                deadline=later_today + timedelta(days=6), minutes=r.choice([30, 60, 90, 120]),
                from_date=(later_today - timedelta(days=1)).isoformat(), from_start="20:00", from_end="21:00",
            ))
        if not targets:
            continue
        horizon = max(t.deadline for t in targets)
        if horizon < later_today:
            horizon = later_today
        busy2 = busy_by_date(st, exams, later_today, horizon)
        for d, iv in kept:
            if d in busy2:
                busy2[d].append(iv)
        free2 = free_map(st, busy2, later_today, later_now)

        t0 = time.perf_counter()
        moves, unplaced = plan_moves(targets, free2, later_today)
        t_move.append((time.perf_counter() - t0) * 1000)
        if plan_moves(targets, free2, later_today) != (moves, unplaced):
            nondeterministic += 1
        m = check_moves(ck, st, busy2, free2, later_today, later_now, targets, moves, unplaced, case_seed)
        for k in ("targets", "moved", "unplaced"):
            move_stats[k] += m[k]
        for u in unplaced:
            key = "unplaced_deadline_passed" if u["reason"] == "DEADLINE_PASSED" else "unplaced_no_slot"
            move_stats[key] = move_stats.get(key, 0) + 1

    def pct(xs: list[float], p: float) -> float:
        xs = sorted(xs)
        return round(xs[min(len(xs) - 1, int(p * len(xs)))], 3) if xs else 0.0

    return {
        "cases": n,
        "seed": seed,
        "violations": ck.violations,
        "violation_examples": ck.examples,
        "nondeterministic_runs": nondeterministic,
        "study": {
            **study_stats,
            "fill_rate": round(study_stats["placed"] / study_stats["planned"], 4) if study_stats["planned"] else None,
            "evening_share": round(study_stats["evening"] / study_stats["placed"], 4) if study_stats["placed"] else None,
            "ms_median": round(statistics.median(t_study), 3),
            "ms_p95": pct(t_study, 0.95),
            "ms_max": round(max(t_study), 3),
        },
        "reschedule": {
            "cases": len(t_move),
            **move_stats,
            "placed_rate": round(move_stats["moved"] / move_stats["targets"], 4) if move_stats["targets"] else None,
            # 시험이 이미 지난 블록을 뺀, 옮길 수 있는 블록 중 옮긴 비율
            "placed_rate_feasible": round(
                move_stats["moved"] / (move_stats["targets"] - move_stats.get("unplaced_deadline_passed", 0)), 4
            ) if move_stats["targets"] else None,
            "ms_median": round(statistics.median(t_move), 3) if t_move else None,
            "ms_p95": pct(t_move, 0.95),
            "ms_max": round(max(t_move), 3) if t_move else None,
        },
        "rules": [
            "S1 30분 칸 단위", "S2 수업·개인 일정·시험과 겹치지 않음", "S3 수면 시간에 넣지 않음",
            "S4 블록끼리 겹치지 않음", "S5 오늘~시험 전날 안", "S6 '며칠 전부터' 설정 지킴",
            "S7 오늘은 지금 이후만", "S8 하루 목표 시간 넘지 않음", "S9 주 며칠 설정 지킴",
            "S10 저녁→오후→오전 순서",
            "R1 대상 블록만 옮김", "R2 수업·개인 일정·시험·남은 블록과 겹치지 않음", "R3 수면 시간에 넣지 않음",
            "R4 옮긴 블록끼리 겹치지 않음", "R5 오늘~마감(시험 전날) 안", "R6 지금 이후 칸만",
            "R7 블록 길이 그대로(30분 단위)", "R8 자리 있으면 '자리 부족'이라 하지 않음",
            "결정성: 같은 입력이면 같은 결과",
        ],
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=20261113)
    ap.add_argument("--out", type=str, default="")
    a = ap.parse_args()
    t0 = time.time()
    res = run(a.n, a.seed)
    res["elapsed_s"] = round(time.time() - t0, 1)
    text = json.dumps(res, ensure_ascii=False, indent=2, default=str)
    print(text)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
