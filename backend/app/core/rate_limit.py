"""간단한 요청 횟수 제한 (11/7).

서버는 uvicorn 프로세스 하나로 뜨므로(entrypoint.sh) 메모리 안에서 센다.
여러 프로세스·여러 대로 늘리면 프로세스마다 따로 세어지니 그때는 Redis 등으로 옮길 것.

Railway 앞단 프록시 때문에 request.client.host 가 사용자 IP가 아닐 수 있어서
IP 대신 사용자 ID(로그인 후)나 입력한 아이디(로그인 시도)를 키로 쓴다.
"""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, status


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float, name: str):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, q: deque[float], now: float) -> None:
        while q and now - q[0] >= self.window:
            q.popleft()

    def retry_after(self, key: str) -> int:
        """한도에 걸렸으면 몇 초 뒤에 다시 가능한지, 아니면 0."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 0
            self._prune(q, now)
            if len(q) < self.limit:
                return 0
            return max(1, int(self.window - (now - q[0])) + 1)

    def add(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            self._prune(q, now)
            q.append(now)
            # 오래된 키 정리 (메모리 계속 늘지 않게)
            if len(self._hits) > 10_000:
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= self.window]:
                    self._hits.pop(k, None)

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def check(self, key: str) -> None:
        """한도 넘었으면 429."""
        wait = self.retry_after(key)
        if wait:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
                headers={"Retry-After": str(wait)},
            )

    def hit(self, key: str) -> None:
        """한도 확인 후 이번 요청을 센다."""
        self.check(key)
        self.add(key)

    def clear_all(self) -> None:  # 테스트용
        with self._lock:
            self._hits.clear()


# 로그인 실패: 같은 아이디로 15분에 10번 틀리면 잠시 막는다 (성공하면 초기화)
login_failures = SlidingWindowLimiter(limit=10, window_seconds=15 * 60, name="login_failures")
# AI 호출(OpenAI 비용): 사용자당 10분에 30번
ai_requests = SlidingWindowLimiter(limit=30, window_seconds=10 * 60, name="ai_requests")
# 시간표 이미지 인식(Tesseract CPU): 사용자당 10분에 10번
eta_parses = SlidingWindowLimiter(limit=10, window_seconds=10 * 60, name="eta_parses")
