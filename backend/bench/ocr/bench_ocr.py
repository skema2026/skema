"""시간표 인식률 벤치마크 (결과보고서 6.2절용).

같은 캡처·같은 정답으로 네 가지 방식을 비교한다.
  P0 위치만        : OpenCV 격자·블록 찾기만 (요일·시간만 나옴, 과목명 없음)
  P1 범용 OCR 그대로: 블록 위치는 P0과 같고, 블록 그림을 Tesseract에 그대로 넣음 (전처리·보정 없음)
  P2 전처리만      : 우리 전처리(반전·줄 나누기·크기 맞춤)+Tesseract, 보정 규칙은 끔
  P3 SKEMA 전체    : 운영 코드 그대로 (전처리 + 보정 규칙 + 같은 수업 맞추기)

정답 파일은 <세트>/truth.py 의 TRUTH = {"파일명": [(요일0=월, "시작", "끝"|None, "과목", "강의실"), ...]}
이미지는 <세트>/img/ 안에. 결과는 JSON으로도 저장.

    cd backend && ETA_TESSDATA_DIR=/opt/tessdata OMP_THREAD_LIMIT=1 python bench/ocr/bench_ocr.py <세트폴더> --out result.json [-v]

캡처와 정답은 저장소에 올리지 않는다(남의 시간표). 형식은 truth_template.py 참고.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]  # backend/
sys.path.insert(0, str(BACKEND))
# 운영과 같은 모델(tessdata_best 4.1.0)을 쓰려면 ETA_TESSDATA_DIR 를 그 폴더로 지정 (backend/Dockerfile 참고)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytesseract  # noqa: E402

from app.eta import block_ocr  # noqa: E402
from app.eta.router import _enrich_positional_with_ocr, _parse_positional_items, _split_location_from_subject  # noqa: E402

DAYS = "월화수목금토일"


def norm(s: str | None) -> str:
    return (s or "").replace(" ", "")


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


# ── 네 가지 방식 ──────────────────────────────────────────────────────────────

def p0_geometry(data: bytes):
    items = _parse_positional_items(data)
    return [(e.day_of_week, e.start_time, e.end_time, "", "") for e, _ in items]


def p1_raw_tesseract(data: bytes):
    items = _parse_positional_items(data)
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    out = []
    for e, bb in items:
        crop = block_ocr.crop_block(img, bb)
        text = pytesseract.image_to_string(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), lang="kor+eng",
                                           config=block_ocr._config(6)) if crop.size else ""
        lines = [x.strip() for x in text.splitlines() if x.strip()]
        out.append((e.day_of_week, e.start_time, e.end_time, "".join(lines), ""))
    return out


class _NoCorrections:
    """block_ocr의 보정 규칙을 잠깐 끈다 (전처리·줄 나누기·Tesseract는 그대로)."""
    names = ("correct_subject", "fix_with_english", "fix_ai", "unify_repeats", "fix_location")

    def __enter__(self):
        self.saved = {n: getattr(block_ocr, n) for n in self.names}
        block_ocr.correct_subject = lambda s: s
        block_ocr.fix_with_english = lambda kor, en: kor
        block_ocr.fix_ai = lambda kor, en: kor
        block_ocr.unify_repeats = lambda texts, colors: texts
        block_ocr.fix_location = lambda t: t
        return self

    def __exit__(self, *exc):
        for n, f in self.saved.items():
            setattr(block_ocr, n, f)


def _full(data: bytes):
    items = _parse_positional_items(data)
    ents = _enrich_positional_with_ocr(data, items) if items else []
    return [(e.day_of_week, e.start_time, e.end_time, e.subject_name or "", e.location or "") for e in ents]


def p2_preprocess_only(data: bytes):
    with _NoCorrections():
        return _full(data)


def p3_skema(data: bytes):
    return _full(data)


PIPELINES = {
    "P0 위치만(OpenCV)": p0_geometry,
    "P1 범용 OCR 그대로": p1_raw_tesseract,
    "P2 전처리+Tesseract(보정 끔)": p2_preprocess_only,
    "P3 SKEMA 전체": p3_skema,
}


# ── 채점 ─────────────────────────────────────────────────────────────────────

def score(pred, truth, verbose=False, tag=""):
    used = set()
    r = dict(blocks=len(truth), found=0, time_ok=0, name_ok=0, name_chars=0, name_err=0,
             loc_total=0, loc_ok=0, extra=0)
    for d, s, e, subj, loc in truth:
        cand = [(i, p) for i, p in enumerate(pred) if p[0] == d and i not in used]
        best = min(cand, key=lambda ip: abs(to_min(ip[1][1]) - to_min(s)) + (abs(to_min(ip[1][2]) - to_min(e)) if e else 0),
                   default=None)
        r["name_chars"] += len(norm(subj))
        if best is None or abs(to_min(best[1][1]) - to_min(s)) > 45:
            r["name_err"] += len(norm(subj))
            if verbose:
                print(f"  ✗없음 {tag} {DAYS[d]} {s}-{e} {subj}")
            continue
        i, p = best
        used.add(i)
        r["found"] += 1
        tok = p[1] == s and (e is None or p[2] == e)
        r["time_ok"] += tok
        nok = norm(p[3]) == norm(subj)
        r["name_ok"] += nok
        r["name_err"] += min(len(norm(subj)), lev(norm(p[3]), norm(subj)))
        if loc:
            r["loc_total"] += 1
            r["loc_ok"] += (p[4] or "") == loc
        if verbose and not (tok and nok):
            print(f"  {tag} {DAYS[d]} 정답 {s}-{e} '{subj}' → {p[1]}-{p[2]} '{p[3]}'")
    r["extra"] = len(pred) - len(used)
    return r


def load_truth(folder: Path) -> dict:
    spec = importlib.util.spec_from_file_location("truth_" + folder.name, folder / "truth.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.TRUTH


def run(folders: list[Path], verbose: bool) -> dict:
    result = {"sets": [str(f) for f in folders], "pipelines": {}, "per_image": {}}
    for pname, fn in PIPELINES.items():
        tot = None
        times = []
        for folder in folders:
            truth = load_truth(folder)
            for img_name, t in truth.items():
                data = (folder / "img" / img_name).read_bytes()
                t0 = time.perf_counter()
                pred = fn(data)
                times.append(time.perf_counter() - t0)
                r = score(pred, t, verbose and pname.startswith("P3"), img_name)
                result["per_image"].setdefault(img_name, {})[pname] = r
                tot = {k: (tot or {}).get(k, 0) + v for k, v in r.items()}
        n = tot["blocks"]
        result["pipelines"][pname] = {
            **tot,
            "images": len(times),
            "found_rate": round(tot["found"] / n, 4),
            "time_acc": round(tot["time_ok"] / n, 4),
            "name_exact": round(tot["name_ok"] / n, 4),
            "char_acc": round(1 - tot["name_err"] / tot["name_chars"], 4) if tot["name_chars"] else None,
            "loc_acc": round(tot["loc_ok"] / tot["loc_total"], 4) if tot["loc_total"] else None,
            "sec_per_image": round(sum(times) / len(times), 2),
        }
        p = result["pipelines"][pname]
        print(f"{pname:28s} 캡처 {p['images']:2d} 블록 {n:3d} | 찾음 {p['found_rate']*100:5.1f}% | 시간 {p['time_acc']*100:5.1f}% | "
              f"과목명 {p['name_exact']*100:5.1f}% (글자 {(p['char_acc'] or 0)*100:5.1f}%) | 강의실 {(p['loc_acc'] or 0)*100:5.1f}% | "
              f"없는 블록 {p['extra']:2d} | {p['sec_per_image']:.2f}초/장", flush=True)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--out", default="")
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    res = run([Path(s) for s in a.sets], a.v)
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
