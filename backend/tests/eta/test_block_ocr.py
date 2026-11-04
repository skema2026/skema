"""시간표 글자 읽기(block_ocr)와 위치 파서 시간 계산 테스트 (11/4, 우리 파서).

순수 함수는 Tesseract 없이 돌아간다.
실제 시간표 이미지로 정확도를 재는 테스트는 ETA_FIXTURE_DIR(이미지 + truth.py)이 있고
Tesseract가 설치된 환경에서만 돈다.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np
import pytest

from app.eta import block_ocr
from app.eta.block_ocr import (
    BlockText,
    assemble,
    fix_course_words,
    fix_latin,
    fix_location,
    is_junk,
    looks_like_location,
    tidy,
    unify_repeats,
)
from app.eta.positional_parser import _px_to_time, _to_light_gray
from app.eta.positional_types import GridModel


# ── 잡음 줄 / 강의실 ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", ["oO", "| |", ">)", "", "a", "7"])
def test_is_junk_drops_border_fragments(text):
    assert is_junk(text)


@pytest.mark.parametrize("text", ["폼", "클라우드", "SW", "516"])
def test_is_junk_keeps_real_text(text):
    assert not is_junk(text)


@pytest.mark.parametrize("text", ["소프트516", "AI관-408", "2공105", "미디어509", "상경 418"])
def test_looks_like_location(text):
    assert looks_like_location(text)


@pytest.mark.parametrize("text", ["클라우드컴퓨팅", "캡스톤디자인", "(영어)"])
def test_not_location(text):
    assert not looks_like_location(text)


@pytest.mark.parametrize("raw", ["Al관-408", "시관408", "A1 zt-408", "AI간 408"])
def test_fix_location_ai_building(raw):
    assert fix_location(raw) == "AI관-408"


# ── 과목명 보정 ───────────────────────────────────────────────────────────────

def test_fix_course_words_one_jamo_off():
    assert fix_course_words("모바일폴랫폼") == "모바일플랫폼"   # ㅡ↔ㅗ
    assert fix_course_words("모바일플랫포") == "모바일플랫폼"   # 받침 빠짐
    assert fix_course_words("데이터마이늉") == "데이터마이닝"


def test_fix_course_words_leaves_two_syllable_words():
    # 두 글자 단어는 멀쩡한 단어를 망가뜨리기 쉬워서 고치지 않는다 ('강의'→'창의' 방지)
    assert fix_course_words("교양강의") == "교양강의"


def test_fix_course_words_no_change_when_correct():
    assert fix_course_words("클라우드컴퓨팅") == "클라우드컴퓨팅"


def test_fix_latin_sw_and_db():
    assert fix_latin("오픈소스5/분석") == "오픈소스SW분석"
    assert fix_latin("오픈소스5분석") == "오픈소스SW분석"
    assert fix_latin("캡스톤디자인(산학-5)") == "캡스톤디자인(산학-SW)"
    assert fix_latin("빅데이터08설계") == "빅데이터DB설계"
    assert fix_latin("빅데이터ㅁ8설계") == "빅데이터DB설계"


def test_tidy_removes_noise_and_balances_paren():
    assert tidy("클라우드ee컴퓨팅") == "클라우드컴퓨팅"
    assert tidy("알고리즘 ( 영어") == "알고리즘 (영어)"
    assert tidy("산학 - SW") == "산학-SW"


# ── 줄 → 과목명 + 강의실 ──────────────────────────────────────────────────────

def test_assemble_joins_lines_and_splits_location():
    out = assemble([("클라우드", 91.0), ("컴퓨팅", 88.0), ("oO", 30.0), ("소프트516", 90.0)])
    assert out.subject == "클라우드컴퓨팅"
    assert out.location == "소프트516"
    assert out.confidence == pytest.approx(89.5)
    assert not out.requires_review


def test_assemble_removes_spaces_between_syllables():
    out = assemble([("클 라 우 드", 90.0), ("컴 퓨 팅", 90.0)])
    assert out.subject == "클라우드컴퓨팅"


def test_assemble_empty_or_low_confidence_needs_review():
    assert assemble([("oO", 20.0)]).requires_review
    assert assemble([("클라우드", 40.0)]).requires_review


def test_unify_repeats_uses_best_reading_for_same_color():
    green = np.array([60, 120, 200], dtype=float)
    blue = np.array([110, 120, 200], dtype=float)
    texts = [
        BlockText("모바일플랫폼", "소프트516", 92.0),
        BlockText("모바일플랫포", "", 71.0),     # 같은 과목 두 번째 블록, 덜 확실하게 읽힘
        BlockText("운영체제", "2공105", 90.0),
    ]
    out = unify_repeats(texts, [green, green, blue])
    assert out[1].subject == "모바일플랫폼"
    assert out[1].location == "소프트516"
    assert out[2].subject == "운영체제"


# ── 위치 파서: 픽셀 → 시간 (5분 단위) ──────────────────────────────────────────

def _grid(ppslot=60.0, origin=100):
    return GridModel(column_bounds=[], row_bounds=[], pixels_per_slot=ppslot, grid_origin_y=origin)


def test_px_to_time_on_grid_lines():
    g = _grid()
    assert _px_to_time(100, g) == "09:00"
    assert _px_to_time(160, g) == "09:30"
    assert _px_to_time(100 + 60 * 8, g) == "13:00"


def test_px_to_time_fifty_minute_class_end():
    # 10:50 끝나는 수업: 30분 칸에 맞추면 11:00으로 틀어지던 것 (11/4 수정)
    g = _grid()
    y = 100 + int(110 / 30 * 60)
    assert _px_to_time(y, g) == "10:50"


def test_to_light_gray_inverts_dark_mode():
    dark = np.full((10, 10, 3), 20, dtype=np.uint8)
    light = np.full((10, 10, 3), 240, dtype=np.uint8)
    assert _to_light_gray(dark).mean() > 200
    assert _to_light_gray(light).mean() > 200


# ── 실제 이미지 정확도 (선택) ─────────────────────────────────────────────────

FIXTURE_DIR = os.environ.get("ETA_FIXTURE_DIR")


@pytest.mark.skipif(not FIXTURE_DIR, reason="ETA_FIXTURE_DIR 없음 (시간표 이미지 + truth.py)")
@pytest.mark.skipif(not block_ocr.available(), reason="Tesseract(kor) 미설치")
def test_real_timetables_accuracy():
    from app.eta.router import _enrich_positional_with_ocr, _parse_positional_items

    root = Path(FIXTURE_DIR)
    spec = importlib.util.spec_from_file_location("truth", root / "truth.py")
    truth_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(truth_mod)

    total = time_ok = name_ok = 0
    for name, rows in truth_mod.TRUTH.items():
        data = (root / "img" / name).read_bytes()
        entries = _enrich_positional_with_ocr(data, _parse_positional_items(data))
        for day, start, end, subject, _loc in rows:
            total += 1
            hit = next(
                (e for e in entries
                 if e.day_of_week == day and e.start_time == start and (end is None or e.end_time == end)),
                None,
            )
            if hit:
                time_ok += 1
                name_ok += hit.subject_name.replace(" ", "") == subject.replace(" ", "")
    assert time_ok == total
    assert name_ok / total >= 0.9


# ── 11/4 두 번째: 새 캡처 9장(개인 일정·토요일·밤 늦은 일정)에서 나온 문제들 ─────────────

import cv2

from app.eta.block_ocr import english_terms, fix_ai, fix_personal_word, fix_with_english
from app.eta.positional_parser import _best_hour_chain, _detect_blocks_by_rows, _fit_hour_lines
from app.eta.router import _valid_time_range


def test_hour_chain_ignores_tab_underline_above_table():
    # 학기 탭 밑줄(207)이 우연히 1시간 간격 위에 있어도, 가장 길게 이어지는 줄을 고른다
    lines = [190, 197, 207, 250, 307, 345, 482, 619, 756, 893, 1030, 1167]
    chain = _best_hour_chain(lines)
    assert chain[-1] == 1167 and 345 in chain and 250 not in chain and 307 not in chain


def test_hour_chain_allows_one_missing_line():
    chain = _best_hour_chain([100, 237, 511, 648, 785])  # 374 하나가 빠짐
    assert chain == [100, 237, 511, 648, 785]


def test_fit_hour_lines_is_robust_to_one_pixel_noise():
    y0, hour = _fit_hour_lines([345, 483, 619, 757, 893])
    assert abs(hour - 137) < 1 and abs(y0 - 345) < 2


def test_time_range_accepts_late_and_early_personal_schedules():
    assert _valid_time_range("20:00", "23:00")
    assert _valid_time_range("07:00", "08:00")
    assert not _valid_time_range("03:00", "04:00")


def _stacked_blocks_image():
    """요일 칸 하나에 틈 없이 붙은 두 블록 + 첫 블록에 굵은 흰 글자 줄."""
    img = np.full((400, 260, 3), 255, np.uint8)
    img[30:150, 52:248] = (120, 140, 240)   # 분홍 블록 (BGR)
    img[150:270, 52:248] = (110, 200, 240)  # 노란 블록, 틈 없이 붙음
    for x in range(62, 240, 20):            # 굵은 흰 글자 줄 (글자 사이로 바탕색이 조금 보임)
        img[40:70, x:x + 17] = 255
    return cv2.cvtColor(img, cv2.COLOR_BGR2HSV)


def test_row_scan_splits_stacked_blocks_by_color_and_survives_text_rows():
    grid = GridModel(column_bounds=[(0, 50), (50, 250)], row_bounds=[], pixels_per_slot=60.0, grid_origin_y=0)
    blocks = _detect_blocks_by_rows(_stacked_blocks_image(), grid, top_y=0)
    tops = sorted((b.top_y, b.bottom_y) for b in blocks)
    assert len(tops) == 2
    assert abs(tops[0][0] - 30) <= 2 and abs(tops[0][1] - 150) <= 8
    assert abs(tops[1][0] - 150) <= 8 and abs(tops[1][1] - 270) <= 2


def test_location_digit_building_name():
    assert fix_location("25105") == "2공105"   # '공'을 5로 읽음
    assert fix_location("33519") == "3공519"


def test_personal_word_whole_name_only():
    assert fix_personal_word("갈바") == "알바"
    assert fix_personal_word("알바") == "알바"
    assert fix_personal_word("갈바천국") == "갈바천국"  # 전체가 같은 길이일 때만


def test_course_words_keep_other_dictionary_words():
    assert fix_course_words("컴퓨터구조") == "컴퓨터구조"   # '컴퓨팅'으로 바꾸지 않는다
    assert fix_course_words("클라우드가상타기술") == "클라우드가상화기술"


def test_latin_rules_for_sw_and_ce():
    assert fix_latin("5아키텍처") == "SW아키텍처"
    assert fix_latin("시스템프로그래밍 (5)") == "시스템프로그래밍 (SW)"
    assert fix_latin("분산처리 (06)") == "분산처리 (CE)"
    assert fix_latin("캡스톤디자인-06)") == "캡스톤디자인-CE)"


def test_english_terms_picks_known_abbreviations_from_noise():
    assert english_terms("ASFPGAH") == ["FPGA"]
    assert english_terms("AQISQLA") == ["SQL"]
    assert english_terms("OS/NWal&") == ["OS/NW"]
    assert english_terms("ZEA") == []


def test_fix_with_english_replaces_misread_abbreviation():
    assert fix_with_english("28115 활 용", "DBMSil®") == "DBMS활용"
    assert fix_with_english("스 와 50[ 실", "AQISQLA") == "스와SQL실"
    # 강의실 번호는 건드리지 않는다
    assert fix_with_english("소 프 트 310", "AZE310") == "소프트310"


def test_fix_ai():
    assert fix_ai("전 공 별 시 활용", "MSHAIEE") == "전공별AI활용"
    assert fix_ai("시 스 템 프 로", "AIZE") == "시 스 템 프 로"  # 시스템은 그대로


def test_is_junk_keeps_split_abbreviation_line():
    assert not is_junk("(CE)")
