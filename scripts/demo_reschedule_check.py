"""#11·#12 완료 기준을 실제 서버(MySQL)에 HTTP로 확인하는 스크립트.

새 계정 → 에타 시간표 → 시험 2개 → 공부 블록 자동 배치(#12)
→ 지난 블록 2개를 안 한 상태로 두고 다시 짜기 미리보기 → 적용(#11)
→ 결과가 30분 단위·수업과 안 겹침·수면 시간 피함·시험 전날까지인지 검사.

실행 (백엔드가 떠 있는 상태에서):
    python scripts/demo_reschedule_check.py               # 기본 http://localhost:8000
    python scripts/demo_reschedule_check.py http://localhost:8000
"""
from __future__ import annotations

import sys
import time
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
KST = ZoneInfo("Asia/Seoul")
NOW = datetime.now(KST)
TODAY = NOW.date()
DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
SLEEP_START, SLEEP_END = "23:30", "07:30"

failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("  ✅ " if ok else "  ❌ ") + msg)
    if not ok:
        failures.append(msg)


def m(t: str) -> int:
    h, mm = t.split(":")
    return int(h) * 60 + int(mm)


def call(s: requests.Session, method: str, path: str, **kw):
    r = s.request(method, BASE + path, timeout=30, **kw)
    if r.status_code >= 400:
        print(f"  ! {method} {path} → {r.status_code} {r.text[:300]}")
    r.raise_for_status()
    return r.json() if r.content else None


def next_weekday(d: date, wd: int) -> date:
    return d + timedelta(days=(wd - d.weekday()) % 7 or 7)


def main() -> int:
    s = requests.Session()
    email = f"demo-{uuid.uuid4().hex[:8]}@skema.dev"
    print(f"기준 시각 {NOW:%Y-%m-%d %H:%M} KST, 서버 {BASE}")

    print("\n1) 새 계정·수면 시간·에타 시간표")
    call(s, "POST", "/auth/signup", json={"email": email, "password": "Demo1234!", "username": "demo"})
    token = call(s, "POST", "/auth/login", json={"email": email, "password": "Demo1234!"})["access_token"]
    s.headers["Authorization"] = f"Bearer {token}"
    call(s, "POST", "/profiles", json={"sleep_start": SLEEP_START, "sleep_end": SLEEP_END, "is_college_student": True})
    timetable = [  # (요일, 시작, 끝, 과목)
        (0, "09:00", "12:00", "자료구조"), (0, "13:00", "15:00", "확률통계"),
        (1, "10:30", "13:30", "운영체제"), (1, "15:00", "18:00", "캡스톤디자인"),
        (2, "09:00", "12:00", "자료구조"), (2, "13:00", "21:00", "알고리즘 실습"),
        (3, "10:30", "13:30", "운영체제"), (4, "09:00", "11:00", "확률통계"),
    ]
    call(s, "POST", "/eta/save-schedules", json={"entries": [
        {"subject_name": n, "day_of_week": d, "start_time": a, "end_time": b} for d, a, b, n in timetable
    ]})
    print(f"  수업 {len(timetable)}개 등록, 수면 {SLEEP_START}~{SLEEP_END}")

    print("\n2) 시험 2개 등록")
    exam1_day = next_weekday(TODAY, 4)          # 다가오는 금요일
    exam2_day = exam1_day + timedelta(days=4)   # 그다음 화요일
    e1 = call(s, "POST", "/exam-schedules", json={"title": "자료구조", "subject": "자료구조", "exam_date": exam1_day.isoformat(), "start_time": "10:00", "end_time": "12:00"})
    e2 = call(s, "POST", "/exam-schedules", json={"title": "운영체제", "subject": "운영체제", "exam_date": exam2_day.isoformat()})
    print(f"  자료구조 {exam1_day}, 운영체제 {exam2_day}")

    print("\n3) #12 공부 블록 자동 배치")
    t0 = time.monotonic()
    gen = call(s, "POST", "/study-blocks/generate", json={
        "exam_ids": [e1["id"], e2["id"]], "start_days_before": 14, "days_per_week": 7, "minutes_per_day": 120,
    })
    elapsed = time.monotonic() - t0
    print(f"  블록 {gen['created']}개 생성, {elapsed:.2f}초, warning={gen['warning']}")
    for ex in gen["exams"]:
        print(f"    {ex['title']}: {ex['placed_minutes']}/{ex['planned_minutes']}분, 블록 {ex['block_count']}개")
    check(gen["created"] > 0, "공부 블록이 1개 이상 생김")
    check(elapsed < 60, f"1분 안에 끝남 ({elapsed:.2f}초)")

    exams = {e1["id"]: exam1_day, e2["id"]: exam2_day}
    verify(s, exams, "배치 결과", only_source="ai_generated")

    print("\n4) 지난 블록 2개를 안 한 상태로 만들기")
    yesterday = TODAY - timedelta(days=1)
    missed = [
        (yesterday, "19:00", "20:00", "📖 자료구조 준비", "study"),
        (yesterday, "20:00", "21:30", "자료구조 과제", "assignment"),
    ]
    missed_ids = []
    for d, a, b, title, typ in missed:
        row = call(s, "POST", "/schedules", json={
            "title": title, "recurring_day": DAYS[d.weekday()], "date": d.isoformat(),
            "start_time": a, "end_time": b, "schedule_type": typ, "linked_exam_id": e1["id"],
        })[0]
        missed_ids.append(row["id"])
        print(f"  {d} {a}~{b} {title} (id {row['id']}, 미완료)")

    print("\n5) #11 다시 짜기 미리보기")
    before = {x["id"]: x for x in call(s, "GET", "/schedules")}
    pv = call(s, "POST", "/reschedule/preview")
    print(f"  summary={pv['summary']} warning={pv['warning']}")
    for mv in pv["moves"]:
        to = ", ".join(f"{t['date']} {t['start_time']}~{t['end_time']}" for t in mv["to"])
        print(f"    {mv['title']}: {mv['from']['date']} {mv['from']['start_time']} → {to}")
    check(set(missed_ids) <= {mv["schedule_id"] for mv in pv["moves"]}, "안 한 블록 2개가 미리보기에 나옴")
    after_pv = {x["id"]: x for x in call(s, "GET", "/schedules")}
    check(all(after_pv[i]["date"] == before[i]["date"] for i in missed_ids), "미리보기만으로는 DB가 안 바뀜")

    print("\n6) #11 적용")
    ap = call(s, "POST", "/reschedule/apply", json={"moves": [{"schedule_id": mv["schedule_id"], "to": mv["to"]} for mv in pv["moves"]]})
    print(f"  {ap}")
    check(ap["applied"] == len(pv["moves"]), "미리보기에 나온 블록이 모두 적용됨")

    rows = verify(s, exams, "적용 후 전체")
    moved = [r for r in rows if r["id"] in set(ap["updated_ids"]) | set(ap["created_ids"])]
    check(all(r["linked_exam_id"] == e1["id"] for r in moved), "옮긴 블록도 linked_exam_id 유지")
    check(all(r["date"] >= TODAY.isoformat() for r in moved), "옮긴 블록은 오늘 이후")

    print("\n7) 같은 상태에서 다시 미리보기 → 옮길 게 없어야 함")
    pv2 = call(s, "POST", "/reschedule/preview")
    check(pv2["summary"]["target"] == 0, f"두 번째 미리보기 대상 0개 (실제 {pv2['summary']['target']})")

    print("\n" + ("모두 통과 ✅" if not failures else f"실패 {len(failures)}개 ❌"))
    return 1 if failures else 0


def verify(s, exams: dict[int, date], label: str, only_source: str | None = None) -> list[dict]:
    rows = call(s, "GET", "/schedules")
    classes = [r for r in rows if r["schedule_type"] == "class"]
    blocks = [r for r in rows if r["schedule_type"] in ("study", "assignment") and r.get("date")]
    if only_source:
        blocks = [r for r in blocks if r.get("schedule_source") == only_source]
    future = [r for r in blocks if r["date"] >= TODAY.isoformat()]
    print(f"  [{label}] 공부·과제 블록 {len(future)}개 검사")

    def day_classes(d: date):
        return [(m(c["start_time"]), m(c["end_time"])) for c in classes
                if (c.get("date") is None and c["recurring_day"] == DAYS[d.weekday()]) or c.get("date") == d.isoformat()]

    bad_unit = bad_class = bad_sleep = bad_exam = bad_now = 0
    by_day: dict[str, list[tuple[int, int]]] = {}
    overlaps = 0
    for r in future:
        d = date.fromisoformat(r["date"])
        st, en = m(r["start_time"]), m(r["end_time"])
        if st % 30 or en % 30:
            bad_unit += 1
        if any(cs < en and st < ce for cs, ce in day_classes(d)):
            bad_class += 1
        if st < m(SLEEP_END) or en > m(SLEEP_START):
            bad_sleep += 1
        if r.get("linked_exam_id") in exams and d >= exams[r["linked_exam_id"]]:
            bad_exam += 1
        if d == TODAY and st < NOW.hour * 60 + NOW.minute:
            bad_now += 1
        for a, b in by_day.get(r["date"], []):
            if a < en and st < b:
                overlaps += 1
        by_day.setdefault(r["date"], []).append((st, en))

    check(bad_unit == 0, "30분 단위")
    check(bad_class == 0, "수업과 겹치지 않음")
    check(bad_sleep == 0, f"수면 시간({SLEEP_START}~{SLEEP_END}) 피함")
    check(bad_exam == 0, "시험 전날까지만")
    check(bad_now == 0, "오늘은 지금 이후에만")
    check(overlaps == 0, "블록끼리 겹치지 않음")

    for d in sorted(by_day)[:7]:
        segs = ", ".join(f"{a // 60:02d}:{a % 60:02d}~{b // 60:02d}:{b % 60:02d}" for a, b in sorted(by_day[d]))
        print(f"    {d}({'월화수목금토일'[date.fromisoformat(d).weekday()]}) {segs}")
    return rows


if __name__ == "__main__":
    sys.exit(main())
