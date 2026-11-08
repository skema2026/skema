"""위치 파서가 실패했을 때 마지막 LLM 안전망 결과도 검사를 거치는지 (11/7).

예전에는 legacy 결과가 시간 범위 검사·'검토 필요' 표시 없이 그대로 나갔다.
OpenAI는 부르지 않고 각 단계를 바꿔 끼워서 확인한다.
"""
import asyncio
from types import SimpleNamespace

from app.eta import router as eta_router
from app.eta.schemas import ParsedEntry


def _entry(name, start, end):
    return ParsedEntry(subject_name=name, day_of_week=0, start_time=start, end_time=end)


def test_legacy_fallback_is_filtered_and_marked_for_review(monkeypatch):
    async def fake_read(_file):
        return b"img", "image/png"

    monkeypatch.setattr(eta_router, "_read_image_file", fake_read)
    monkeypatch.setattr(eta_router, "_parse_positional_items", lambda _b: [])
    monkeypatch.setattr(eta_router, "_parse_via_refined_llm", lambda _b, _t: [])
    monkeypatch.setattr(eta_router, "_parse_via_llm", lambda _b, _t: [
        _entry("자료구조", "09:00", "10:30"),
        _entry("새벽 일정", "03:00", "04:00"),  # 5시 이전 → 빠져야 함
        _entry("수업", "11:00", "12:00"),        # 의미 없는 과목명 → 빠져야 함
    ])

    result = asyncio.run(eta_router.parse_eta_image(file=None, current_user=SimpleNamespace(id=1)))

    assert [e.subject_name for e in result] == ["자료구조"]
    assert result[0].requires_review is True
