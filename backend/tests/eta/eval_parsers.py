#!/usr/bin/env python3
"""
에브리타임 시간표 파서 인식률 측정 스크립트.

사용법:
    cd backend
    python -m tests.eta.eval_parsers                          # 전체 파서
    python -m tests.eta.eval_parsers --parsers opencv easyocr # 특정 파서만
    python -m tests.eta.eval_parsers --fixtures ./my_images   # 다른 fixtures 경로

fixtures 구조:
    tests/eta/fixtures/
        sample1.png   ← 에브리타임 스크린샷
        sample1.json  ← 정답 데이터
        sample2.jpg
        sample2.json

정답 JSON 형식:
    [
        {
            "subject_name": "알고리즘",
            "day_of_week": 1,
            "start_time": "09:00",
            "end_time": "10:30"
        }
    ]
    day_of_week: 0=월 1=화 2=수 3=목 4=금 5=토 6=일
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

# ── 경로 설정: backend/ 를 sys.path에 추가 ─────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_BACKEND_DIR))

# .env 로드 (Google Vision API 키 등 필요 시)
try:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND_DIR / ".env")
    load_dotenv(_BACKEND_DIR.parent / ".env")
except Exception:
    pass

# ── ANSI 색상 ──────────────────────────────────────────────────────────────────
_R = "\033[91m"
_G = "\033[92m"
_Y = "\033[93m"
_B = "\033[94m"
_BOLD = "\033[1m"
_RST = "\033[0m"

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_DAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


# ── 파서 레지스트리 ────────────────────────────────────────────────────────────

ParserFn = Callable[[bytes], List[dict]]
_PARSERS: Dict[str, ParserFn] = {}
_SKIP_REASONS: Dict[str, str] = {}


def _try_register(name: str, fn: Callable[[], ParserFn]) -> None:
    try:
        _PARSERS[name] = fn()
    except Exception as exc:
        _SKIP_REASONS[name] = str(exc)


# 1. OpenCV 위치 기반 (과목명 없음 — 시간·요일 정확도 측정용)
def _make_opencv() -> ParserFn:
    from app.eta.positional_parser import parse_image_positional
    from app.eta.positional_types import NAME_TO_DOW

    def _run(image_bytes: bytes) -> List[dict]:
        _, entries = parse_image_positional(image_bytes)
        return [
            {
                "subject_name": e["title"],
                "day_of_week": NAME_TO_DOW.get(e["day"], 0),
                "start_time": e["startTime"],
                "end_time": e["endTime"],
            }
            for e in entries
        ]
    return _run

_try_register("opencv", _make_opencv)


# 2. EasyOCR + 위치 기반
def _make_easyocr() -> ParserFn:
    from app.eta.easyocr_parser import parse_timetable_easyocr
    return parse_timetable_easyocr

_try_register("easyocr", _make_easyocr)


# 3. Google Vision bbox
def _make_google_vision() -> ParserFn:
    from app.eta.bbox_parser import parse_timetable_bbox
    return parse_timetable_bbox

_try_register("google_vision", _make_google_vision)


# 4. LLM Vision (OpenAI) — API 키 필요, --llm 플래그로 활성화
def _make_llm_vision() -> ParserFn:
    from app.eta.router import _parse_via_llm
    from app.eta.schemas import ParsedEntry

    def _run(image_bytes: bytes) -> List[dict]:
        entries: List[ParsedEntry] = _parse_via_llm(image_bytes, "image/png")
        return [
            {
                "subject_name": e.subject_name,
                "day_of_week": e.day_of_week,
                "start_time": e.start_time,
                "end_time": e.end_time,
            }
            for e in entries
        ]
    return _run


# ── 매칭 & 스코어링 ────────────────────────────────────────────────────────────

def _sim(a: str, b: str) -> float:
    """두 문자열의 유사도 (0~1)."""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _t2m(t: str) -> int:
    """HH:MM → 분."""
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return -1


def _match_entries(
    preds: List[dict],
    gts: List[dict],
    time_tol_min: int = 30,
) -> List[Tuple[dict, dict]]:
    """
    GT 각 항목에 대해 가장 잘 맞는 pred를 greedy 매칭.

    매칭 조건:
      - day_of_week 일치
      - |start_time 차이| ≤ time_tol_min 분
    동점 시 start_time 차이가 작은 것 우선.
    """
    used: set[int] = set()
    pairs: List[Tuple[dict, dict]] = []

    for gt in gts:
        best_idx: Optional[int] = None
        best_diff = time_tol_min + 1

        for i, pred in enumerate(preds):
            if i in used:
                continue
            if pred.get("day_of_week") != gt.get("day_of_week"):
                continue
            diff = abs(_t2m(pred.get("start_time", "")) - _t2m(gt.get("start_time", "")))
            if diff <= time_tol_min and diff < best_diff:
                best_diff = diff
                best_idx = i

        if best_idx is not None:
            used.add(best_idx)
            pairs.append((preds[best_idx], gt))

    return pairs


def _score(preds: List[dict], gts: List[dict]) -> dict:
    """파서 예측과 정답을 비교해 지표를 반환한다."""
    pairs = _match_entries(preds, gts)

    n_gt      = len(gts)
    n_pred    = len(preds)
    n_matched = len(pairs)

    subject_sims: List[float] = []
    n_subject_exact = 0
    n_start_exact   = 0
    n_end_exact     = 0

    for pred, gt in pairs:
        sim = _sim(pred.get("subject_name", ""), gt.get("subject_name", ""))
        subject_sims.append(sim)
        if sim >= 0.9:
            n_subject_exact += 1
        if pred.get("start_time") == gt.get("start_time"):
            n_start_exact += 1
        if pred.get("end_time") == gt.get("end_time"):
            n_end_exact += 1

    recall    = n_matched / n_gt   if n_gt   else 0.0
    precision = n_matched / n_pred if n_pred else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    subj_sim  = sum(subject_sims) / len(subject_sims) if subject_sims else 0.0
    subj_exact = n_subject_exact / n_matched if n_matched else 0.0
    start_acc = n_start_exact / n_matched if n_matched else 0.0
    end_acc   = n_end_exact   / n_matched if n_matched else 0.0

    return {
        "n_gt": n_gt, "n_pred": n_pred, "n_matched": n_matched,
        "recall": recall, "precision": precision, "f1": f1,
        "subj_sim": subj_sim, "subj_exact": subj_exact,
        "start_acc": start_acc, "end_acc": end_acc,
        "pairs": pairs,
    }


def _color_pct(v: float, thresholds=(0.8, 0.5)) -> str:
    """수치에 따라 색상 코드 반환."""
    if v >= thresholds[0]:
        return _G
    if v >= thresholds[1]:
        return _Y
    return _R


def _fmt(v: float) -> str:
    c = _color_pct(v)
    return f"{c}{v:6.1%}{_RST}"


# ── 실행 ───────────────────────────────────────────────────────────────────────

def _discover_pairs(fixtures_dir: Path) -> List[Tuple[Path, Path]]:
    pairs = []
    for json_path in sorted(fixtures_dir.glob("*.json")):
        for ext in _IMAGE_EXTS:
            img_path = json_path.with_suffix(ext)
            if img_path.exists():
                pairs.append((img_path, json_path))
                break
    return pairs


def run(fixtures_dir: Path, parser_names: Optional[List[str]], include_llm: bool = False) -> None:
    pairs = _discover_pairs(fixtures_dir)
    if not pairs:
        print(f"\n{_R}[!] fixtures 디렉토리에 이미지+JSON 쌍이 없습니다: {fixtures_dir}{_RST}")
        print("    sample.png + sample.json 형식으로 파일을 추가하세요.")
        print(f"    예시: {fixtures_dir}/example.json 참고\n")
        sys.exit(1)

    # LLM 파서 선택 시 동적 등록
    if include_llm:
        _try_register("llm_vision", _make_llm_vision)

    target: Dict[str, ParserFn] = {}
    if parser_names:
        for name in parser_names:
            if name in _PARSERS:
                target[name] = _PARSERS[name]
            else:
                reason = _SKIP_REASONS.get(name, "알 수 없는 파서")
                print(f"{_Y}[skip] {name}: {reason}{_RST}")
    else:
        target = _PARSERS.copy()

    if not target:
        print(f"{_R}[!] 사용 가능한 파서가 없습니다.{_RST}")
        if _SKIP_REASONS:
            for name, reason in _SKIP_REASONS.items():
                print(f"    {name}: {reason}")
        sys.exit(1)

    if _SKIP_REASONS and not parser_names:
        for name, reason in _SKIP_REASONS.items():
            print(f"{_Y}[skip] {name}: {reason}{_RST}")

    # ── 헤더 출력 ─────────────────────────────────────────────────────────────
    print(f"\n{_BOLD}{'='*80}{_RST}")
    print(f"{_BOLD}  ETA 파서 인식률 측정{_RST}  |  "
          f"이미지 {len(pairs)}장  |  파서 {len(target)}개")
    print(f"{_BOLD}{'='*80}{_RST}")

    COL = 18
    HDR = (f"  {'파서':<{COL}} {'검출':>4} {'매칭':>4} "
           f"{'Recall':>7} {'Prec':>7} {'F1':>7} "
           f"{'과목유사도':>8} {'과목정확':>8} {'시작시간':>8} {'종료시간':>8} {'속도':>6}")

    # 파서별 누적 결과
    agg: Dict[str, List[dict]] = {name: [] for name in target}
    elapsed_agg: Dict[str, List[float]] = {name: [] for name in target}

    for img_path, json_path in pairs:
        gts: List[dict] = json.loads(json_path.read_text(encoding="utf-8"))
        image_bytes = img_path.read_bytes()

        print(f"\n{_BOLD}📷 {img_path.name}{_RST}  (정답 {len(gts)}개)")
        print(HDR)
        print(f"  {'-'*110}")

        for name, fn in target.items():
            t0 = time.time()
            try:
                preds = fn(image_bytes)
                err = None
            except Exception as exc:
                preds = []
                err = str(exc)
            elapsed = time.time() - t0
            elapsed_agg[name].append(elapsed)

            if err:
                print(f"  {name:<{COL}} {_R}오류: {err[:60]}{_RST}")
                continue

            s = _score(preds, gts)
            agg[name].append(s)

            print(
                f"  {name:<{COL}} "
                f"{s['n_pred']:>4} "
                f"{s['n_matched']:>4} "
                f"{_fmt(s['recall'])} "
                f"{_fmt(s['precision'])} "
                f"{_fmt(s['f1'])} "
                f"{_fmt(s['subj_sim'])} "
                f"{_fmt(s['subj_exact'])} "
                f"{_fmt(s['start_acc'])} "
                f"{_fmt(s['end_acc'])} "
                f"{elapsed:>5.1f}s"
            )

            # 오답 상세: 미검출 GT
            matched_gts = {id(gt) for _, gt in s["pairs"]}
            unmatched   = [gt for gt in gts if id(gt) not in matched_gts]
            if unmatched:
                items = ", ".join(
                    f"{_DAY_KR[g['day_of_week']]} {g['start_time']} {g['subject_name']}"
                    for g in unmatched
                )
                print(f"    {_Y}▶ 미검출: {items}{_RST}")

            # 과목명 오인식 상세
            for pred, gt in s["pairs"]:
                sim = _sim(pred.get("subject_name", ""), gt.get("subject_name", ""))
                if sim < 0.9 and gt.get("subject_name"):
                    print(
                        f"    {_Y}▶ 과목명 불일치 "
                        f"예측={pred.get('subject_name', '(없음)')!r} "
                        f"정답={gt['subject_name']!r} "
                        f"({sim:.0%}){_RST}"
                    )

    # ── 전체 평균 ─────────────────────────────────────────────────────────────
    print(f"\n{_BOLD}{'─'*80}{_RST}")
    print(f"{_BOLD}  전체 평균  (이미지 {len(pairs)}장){_RST}")
    print(HDR)
    print(f"  {'-'*110}")

    best_f1 = max(
        (sum(r["f1"] for r in results) / len(results) for results in agg.values() if results),
        default=0,
    )

    for name, results in agg.items():
        if not results:
            avg_elapsed = sum(elapsed_agg[name]) / len(elapsed_agg[name]) if elapsed_agg[name] else 0
            print(f"  {name:<{COL}} {'─ 결과 없음 ─':>60}  {avg_elapsed:>5.1f}s")
            continue

        def avg(key: str) -> float:
            return sum(r[key] for r in results) / len(results)

        f1_val = avg("f1")
        marker = f" {_G}★{_RST}" if abs(f1_val - best_f1) < 0.001 and len(target) > 1 else ""
        avg_elapsed = sum(elapsed_agg[name]) / len(elapsed_agg[name])

        print(
            f"  {name:<{COL}} "
            f"{'':>4} {'':>4} "
            f"{_fmt(avg('recall'))} "
            f"{_fmt(avg('precision'))} "
            f"{_fmt(f1_val)} "
            f"{_fmt(avg('subj_sim'))} "
            f"{_fmt(avg('subj_exact'))} "
            f"{_fmt(avg('start_acc'))} "
            f"{_fmt(avg('end_acc'))} "
            f"{avg_elapsed:>5.1f}s"
            f"{marker}"
        )

    print(f"{_BOLD}{'='*80}{_RST}\n")
    print("  지표 설명:")
    print("    Recall    = 정답 중 검출된 비율")
    print("    Precision = 예측 중 실제 맞은 비율  (오탐 없을수록 높음)")
    print("    F1        = Recall · Precision 조화평균")
    print("    과목유사도  = 매칭된 쌍에서 과목명 문자열 유사도 평균")
    print("    과목정확   = 유사도 ≥90% 비율  (사실상 정확 매칭)")
    print("    시작/종료  = 정확히 일치하는 비율\n")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="ETA 파서 인식률 측정",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--fixtures",
        default=str(_BACKEND_DIR / "tests" / "eta" / "fixtures"),
        help="테스트 이미지+JSON 쌍이 있는 디렉토리 (기본: tests/eta/fixtures)",
    )
    ap.add_argument(
        "--parsers",
        nargs="+",
        choices=["opencv", "easyocr", "google_vision", "llm_vision"],
        default=None,
        help="측정할 파서 목록 (기본: 설치된 전체)",
    )
    ap.add_argument(
        "--llm",
        action="store_true",
        help="LLM Vision 파서 포함 (OpenAI API 키 필요)",
    )
    args = ap.parse_args()

    fixtures_dir = Path(args.fixtures)
    if not fixtures_dir.exists():
        print(f"{_R}[!] fixtures 디렉토리가 없습니다: {fixtures_dir}{_RST}")
        sys.exit(1)

    run(fixtures_dir, args.parsers, include_llm=args.llm)


if __name__ == "__main__":
    main()
