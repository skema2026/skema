"""SKEMA 서버 부하 테스트 시나리오 (Locust). 로컬 서버 전용.

가짜 학생 한 명 = 실제 사용 흐름 하나:
- 대시보드 열기(가장 많음): /users/me, /profiles, /schedules, /exam-schedules, /notifications/prefs, /groups/me
- 공부 블록 완료 체크: PUT /schedules/{id}
- 다시 짜기 미리보기: POST /reschedule/preview
- 공부 블록 다시 배치: POST /study-blocks/generate
요청 사이에는 사람처럼 3~8초 쉰다(THINK). MODE=login 이면 로그인만 반복한다.

먼저 seed.py(가짜 학생 만들기) → tokens.py(토큰 미리 받기)를 돌린다. 순서는 ../README.md

    MODE=use THINK=3,8 locust -f locustfile.py --host http://127.0.0.1:8100 --headless -u 100 -r 25 -t 75s --csv run/use_u100
"""
from __future__ import annotations

import json
import os
import random
from pathlib import Path

from locust import HttpUser, between, events, task

HERE = Path(__file__).parent
ACC = json.loads((HERE / "accounts.json").read_text())
EMAILS: list[str] = ACC["accounts"]
PASSWORD: str = ACC["password"]


@events.test_start.add_listener
def _local_only(environment, **_kwargs):
    # 운영 서버에 부하를 주지 않도록 로컬 주소만 허용한다
    host = environment.host or ""
    if not host.startswith(("http://127.0.0.1", "http://localhost")):
        raise SystemExit(f"로컬 서버에만 씁니다: {host}")


THINK = os.environ.get("THINK", "3,8")  # "0,0"이면 쉬지 않고 계속 보냄 (최대 처리량 측정)
_lo, _hi = (float(x) for x in THINK.split(","))
MODE = os.environ.get("MODE", "use")    # use: 평소 사용(미리 받은 토큰) / login: 로그인만
_tok_file = HERE / "tokens.json"
TOKENS: list[str] = json.loads(_tok_file.read_text()) if _tok_file.exists() else []


class Student(HttpUser):
    wait_time = between(_lo, _hi)

    def on_start(self) -> None:
        # 실제 사용자는 한 번 로그인하면 토큰(24시간)으로 계속 쓴다 → 미리 받아 둔 토큰을 나눠 씀
        self.token = random.choice(TOKENS)
        self.client.headers["Authorization"] = f"Bearer {self.token}"
        self.study_ids: list[int] = []
        self.exam_ids: list[int] = []
        self.open_dashboard()

    @task(10)
    def open_dashboard(self) -> None:
        self.client.get("/users/me", name="GET /users/me")
        self.client.get("/profiles", name="GET /profiles")
        r = self.client.get("/schedules", name="GET /schedules")
        if r.ok:
            self.study_ids = [s["id"] for s in r.json() if s.get("schedule_type") == "study"]
        e = self.client.get("/exam-schedules", name="GET /exam-schedules")
        if e.ok:
            self.exam_ids = [x["id"] for x in e.json()]
        self.client.get("/notifications/prefs", name="GET /notifications/prefs")
        self.client.get("/groups/me", name="GET /groups/me")

    @task(3)
    def toggle_complete(self) -> None:
        if not self.study_ids:
            return
        sid = random.choice(self.study_ids)
        self.client.put(f"/schedules/{sid}", json={"is_completed": random.random() < 0.7},
                        name="PUT /schedules/{id} (완료 체크)")

    @task(2)
    def reschedule_preview(self) -> None:
        self.client.post("/reschedule/preview", name="POST /reschedule/preview")

    @task(1)
    def regenerate_blocks(self) -> None:
        if not self.exam_ids:
            return
        r = self.client.post("/study-blocks/generate", json={
            "exam_ids": self.exam_ids, "start_days_before": 14, "days_per_week": 3, "minutes_per_day": 120,
        }, name="POST /study-blocks/generate")
        # 다시 배치하면 안 한 블록이 새 id로 바뀐다 → 화면이 새 목록을 받는 것처럼 id를 바꿔 둔다
        if r.ok:
            self.study_ids = [b["schedule_id"] for b in r.json().get("blocks", [])] or self.study_ids


class LoginOnly(HttpUser):
    """로그인만 계속 하는 사용자 (MODE=login 일 때만). 비밀번호 확인(bcrypt)이 얼마나 버티는지."""
    wait_time = between(_lo, _hi)

    @task
    def login(self) -> None:
        self.client.post("/auth/login", json={"email": random.choice(EMAILS), "password": PASSWORD},
                         name="POST /auth/login")


# MODE에 따라 한 종류만 돌린다
if MODE == "login":
    Student.weight = 0
    Student.abstract = True
else:
    LoginOnly.abstract = True
