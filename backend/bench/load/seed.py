"""부하 테스트용 가짜 학생 계정 만들기 (로컬 서버 전용).

학생마다: 가입 → 프로필(수면 시간) → 매주 수업 8~14개 → 시험 2개 → 공부 블록 자동 배치.
만든 계정 목록은 같은 폴더 accounts.json에 저장한다(로컬 테스트 DB 전용 값, git에 안 올림).

    python seed.py --host http://127.0.0.1:8100 --n 300
"""
from __future__ import annotations

import argparse
import json
import random
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import requests

PASSWORD = "LoadTest!2026"
DAYS = ["MON", "TUE", "WED", "THU", "FRI"]
COURSES = ["자료구조", "운영체제", "데이터베이스", "컴퓨터네트워크", "알고리즘", "소프트웨어공학", "선형대수", "확률과통계", "캡스톤디자인", "웹프로그래밍"]


def make_student(host: str, i: int, seed: int) -> dict | None:
    r = random.Random(seed * 100_000 + i)
    s = requests.Session()
    email = f"load{i:04d}@loadtest.example.com"
    res = s.post(f"{host}/auth/signup", json={"email": email, "password": PASSWORD, "username": f"load{i:04d}"}, timeout=30)
    if res.status_code not in (200, 201, 400, 409):
        return None
    tok = s.post(f"{host}/auth/login", json={"email": email, "password": PASSWORD}, timeout=30).json()["access_token"]
    s.headers["Authorization"] = f"Bearer {tok}"
    s.post(f"{host}/profiles", json={"user_type": "student", "sleep_start": r.choice(["23:00", "00:00", "01:00"]),
                                     "sleep_end": r.choice(["07:00", "08:00"]), "is_college_student": True}, timeout=30)
    # 수업: 과목 5~7개, 주 1~2회
    used: dict[str, list[tuple[int, int]]] = {d: [] for d in DAYS}
    n_cls = 0
    for name in r.sample(COURSES, r.randint(5, 7)):
        start = r.choice([9, 10, 12, 13, 15, 16]) * 60 + r.choice([0, 30])
        length = r.choice([75, 90, 150])
        days = r.sample(DAYS, r.choice([1, 2, 2]))
        if any(a < start + length and start < b for d in days for a, b in used[d]):
            continue
        for d in days:
            used[d].append((start, start + length))
        s.post(f"{host}/schedules", json={
            "course_name": name, "days": days, "start_time": f"{start // 60:02d}:{start % 60:02d}",
            "end_time": f"{(start + length) // 60:02d}:{(start + length) % 60:02d}", "schedule_type": "class",
            "location": f"{r.randint(1, 5)}공{r.randint(100, 520)}",
        }, timeout=30)
        n_cls += len(days)
    # 시험 2개 → 공부 블록 배치
    today = date.today()
    exam_ids = []
    for k in range(2):
        res = s.post(f"{host}/exam-schedules", json={
            "title": f"{COURSES[k]} 기말", "subject": COURSES[k],
            "exam_date": (today + timedelta(days=r.randint(5, 20))).isoformat(),
            "start_time": "10:00", "end_time": "11:30",
        }, timeout=30)
        if res.ok:
            exam_ids.append(res.json()["id"])
    g = s.post(f"{host}/study-blocks/generate", json={"exam_ids": exam_ids, "start_days_before": 14,
                                                      "days_per_week": 3, "minutes_per_day": 120}, timeout=60)
    return {"email": email, "classes": n_cls, "exams": len(exam_ids), "blocks": g.json().get("created", 0) if g.ok else -1}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="http://127.0.0.1:8100")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=20261113)
    a = ap.parse_args()
    if not a.host.startswith(("http://127.0.0.1", "http://localhost")):
        raise SystemExit("로컬 서버에만 씁니다")
    with ThreadPoolExecutor(8) as ex:
        out = [x for x in ex.map(lambda i: make_student(a.host, i, a.seed), range(a.n)) if x]
    json.dump({"password": PASSWORD, "accounts": [o["email"] for o in out]},
              open(Path(__file__).parent / "accounts.json", "w"), ensure_ascii=False)
    print(f"accounts={len(out)} classes/학생 평균={sum(o['classes'] for o in out)/len(out):.1f} "
          f"blocks/학생 평균={sum(o['blocks'] for o in out)/len(out):.1f} 실패={sum(1 for o in out if o['blocks'] < 0)}")
