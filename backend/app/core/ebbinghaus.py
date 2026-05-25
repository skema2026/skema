"""에빙하우스 망각 곡선 기반 복습 일정 생성 유틸리티.

기억 보존율 R(t) = e^(-t/S) 모델을 기반으로
최적 복습 시점을 계산한다.

기본 복습 간격 (학습 당일 기준):
  1차: +1일, 2차: +3일, 3차: +7일, 4차: +14일, 5차: +30일
각 복습은 이전 복습일 기준이 아닌 최초 학습일 기준으로 계산한다.
시험일이 있으면 시험일 직전까지만 복습 일정을 생성한다.
"""
from __future__ import annotations

from datetime import date, timedelta

# 최초 학습일로부터의 복습 오프셋(일) — Ebbinghaus 실험 기반 표준 간격
_REVIEW_OFFSETS: list[int] = [1, 3, 7, 14, 30]


def review_dates(
    learn_date: date,
    exam_date: date | None = None,
    offsets: list[int] | None = None,
) -> list[date]:
    """에빙하우스 복습 날짜 목록을 반환한다.

    Args:
        learn_date: 최초 학습(수업) 날짜.
        exam_date: 시험 날짜. None이면 제한 없음.
        offsets: 커스텀 복습 간격(일 단위). None이면 기본 간격 사용.

    Returns:
        복습 날짜 리스트 (학습일 이후, 시험일 이전 날짜만 포함).
    """
    gaps = offsets if offsets is not None else _REVIEW_OFFSETS
    today = date.today()
    result: list[date] = []

    for gap in gaps:
        d = learn_date + timedelta(days=gap)
        if d < today:
            continue
        if exam_date is not None and d >= exam_date:
            break
        result.append(d)

    return result


def review_label(index: int) -> str:
    """복습 회차 레이블. 예: '1차 복습', '2차 복습'."""
    return f"{index + 1}차 복습"
