"""
시간표 블록 안 글자(과목명·강의실) 읽기 — 외부 AI API 없이 우리 서버에서.

11/4 결정: 시간표 인식은 "AI API에 통째로 맡기지 않고 우리가 만든 것"으로 간다.
  - 위치(요일·시간): positional_parser (OpenCV, 우리가 만든 격자·블록 알고리즘)
  - 글자(과목명·강의실): 이 모듈. 오픈소스 OCR 엔진 Tesseract를 서버에 설치해서 쓰고,
    에브리타임 블록 모양에 맞춘 전처리·보정은 우리가 만든다.
  - OpenAI는 기본으로 쓰지 않는다 (설정으로만 켤 수 있음).

처리 순서 (블록 하나):
  1. 블록 crop → 흑백 → 어두운 블록(흰 글씨)이면 뒤집기 → 3배 확대 → 이진화
  2. Tesseract(kor+eng)로 줄 단위 글자와 확신도 읽기
  3. 잡음 줄 제거("oO", "| |" 같은 선·테두리 조각)
  4. 마지막 줄이 "건물+호수"(소프트516, AI관-408, 2공105) 모양이면 강의실로 분리
  5. 나머지 줄을 이어 붙여 과목명 (에타는 글자 단위로 줄바꿈하므로 공백 없이 잇는다)
그리고 시간표 전체에서:
  6. 같은 수업(같은 색 + 비슷한 이름)은 주 2회 나오니 더 확신도 높은 읽기로 통일
"""
from __future__ import annotations

import logging
import os
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Sequence

import cv2
import numpy as np

from .location_utils import normalize_location

try:  # 로컬 개발 환경에 없을 수 있다 → available()이 False가 되고 위치만 돌려준다
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None

logger = logging.getLogger(__name__)

LANG = "kor+eng"
SCALE = 3
# 이보다 확신도가 낮거나 과목명이 비면 확인 화면에서 "확인 필요"로 표시
MIN_CONFIDENCE = 70.0
OCR_WORKERS = int(os.environ.get("ETA_OCR_WORKERS", "4"))

# 건물+호수: 소프트516, AI관-408, 2공105, 미디어509, 상경418, 사범201
_LOCATION_RE = re.compile(r"^[가-힣A-Za-z0-9]{1,6}?[\s\-]?\d{2,4}[A-Za-z]?$")
# 과목명에 쓰일 수 있는 글자만 남긴다
_KEEP_RE = re.compile(r"[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9()\[\]\-+&·.,/ ]")


@dataclass
class BlockText:
    subject: str
    location: str
    confidence: float  # 0~100, 과목명 줄들의 평균

    @property
    def requires_review(self) -> bool:
        return not self.subject or self.confidence < MIN_CONFIDENCE


def _tessdata_dir() -> str | None:
    return os.environ.get("ETA_TESSDATA_DIR") or None


def _config(psm: int = 6) -> str:
    cfg = f"--psm {psm} --oem 1"
    d = _tessdata_dir()
    if d:
        cfg += f' --tessdata-dir "{d}"'
    return cfg


@lru_cache(maxsize=1)
def available() -> bool:
    """서버에 Tesseract와 한국어 모델이 있는지."""
    if pytesseract is None or shutil.which("tesseract") is None:
        return False
    try:
        cfg = f'--tessdata-dir "{_tessdata_dir()}"' if _tessdata_dir() else ""
        langs = pytesseract.get_languages(config=cfg)
    except Exception:  # noqa: BLE001
        logger.warning("block_ocr: tesseract 언어 목록을 못 읽음", exc_info=True)
        return False
    ok = "kor" in langs and "eng" in langs
    if not ok:
        logger.warning("block_ocr: tesseract 한국어/영어 모델 없음 (langs=%s)", langs)
    return ok


# ── 1. 전처리 ─────────────────────────────────────────────────────────────────

def preprocess(crop_bgr: np.ndarray) -> np.ndarray:
    """블록 crop → OCR하기 좋은 흑백(흰 바탕·검은 글씨) 이미지."""
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # 글씨는 항상 블록 면적의 일부다. 검은 쪽이 절반을 넘으면 흰 글씨·색 바탕(다크 모드,
    # 진한 색 블록)이라는 뜻이니 뒤집어서 '흰 바탕·검은 글씨'로 맞춘다.
    # (밝기 기준(140)으로 판단했을 때는 회색 150쯤인 진한 블록에서 반대로 뒤집혔다)
    if float((binary < 128).mean()) > 0.5:
        binary = 255 - binary
    # 가장자리 흰 여백 (Tesseract는 글자가 테두리에 붙어 있으면 약하다)
    return cv2.copyMakeBorder(binary, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)


def crop_block(img_bgr: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
    """블록 안쪽만 자른다 (격자 선·옆 블록이 섞이지 않게 테두리를 조금 깎음)."""
    h, w = img_bgr.shape[:2]
    x0, y0, x1, y1 = bbox
    pad_x = max(4, int((x1 - x0) * 0.02))
    pad_y = 4
    return img_bgr[max(0, y0 + pad_y):min(h, y1 - pad_y), max(0, x0 + pad_x):min(w, x1 - pad_x)]


# ── 2. OCR ────────────────────────────────────────────────────────────────────

def _ocr_lines(binary: np.ndarray) -> list[tuple[str, float]]:
    """줄 단위 (글자, 확신도)."""
    data = pytesseract.image_to_data(
        binary, lang=LANG, config=_config(6), output_type=pytesseract.Output.DICT
    )
    lines: dict[tuple[int, int, int], list[tuple[str, float]]] = {}
    for i, word in enumerate(data["text"]):
        word = (word or "").strip()
        conf = float(data["conf"][i])
        if not word or conf < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append((word, conf))
    out = []
    for key in sorted(lines):
        words = lines[key]
        text = " ".join(wd for wd, _ in words)
        conf = sum(c for _, c in words) / len(words)
        out.append((text, conf))
    return out


# ── 3~5. 보정 ─────────────────────────────────────────────────────────────────

def clean_line(text: str) -> str:
    text = _KEEP_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


# 과목명에 혼자 한 줄로 떨어질 수 있는 영어 약어 ("캡스톤디자인(산학-" / "SW)")
_ABBREVIATIONS = {"SW", "DB", "AI", "IT", "UI", "UX", "VR", "AR", "OS", "HW"}


def is_junk(text: str) -> bool:
    """선·테두리 조각이 글자로 잡힌 줄 ("oO", "| |", ">)" 등)."""
    meaningful = re.findall(r"[가-힣A-Za-z0-9]", text)
    if "".join(meaningful) in _ABBREVIATIONS:
        return False
    if len(meaningful) == 0:
        return True
    if len(meaningful) == 1 and not re.search(r"[가-힣]", text):
        return True  # 영문/숫자 한 글자 (한글 한 글자는 줄바꿈된 과목명 끝일 수 있어 남김)
    if not re.search(r"[가-힣0-9]", text) and len(meaningful) <= 2:
        return True  # "oO" 같은 영문 2글자 조각
    return False


# OCR이 자주 헷갈리는 건물 이름
_BUILDING_FIXES = (
    (re.compile(r"^(?:A[Il1|]|시|Al|Ai)\s*(?:관|zt|zl|ZE|Zt|간)\s*-?\s*(\d{3,4})$"), r"AI관-\1"),
)


def fix_location(text: str) -> str:
    value = re.sub(r"\s+", "", text)
    for pattern, repl in _BUILDING_FIXES:
        value = pattern.sub(repl, value)
    return normalize_location(value)


def looks_like_location(text: str) -> bool:
    value = re.sub(r"\s+", "", text)
    if not _LOCATION_RE.match(value):
        return False
    return bool(re.search(r"\d{2,4}[A-Za-z]?$", value))


# ── 과목명 보정 (우리가 만든 규칙) ─────────────────────────────────────────────
#
# 1) 과목명에 자주 나오는 단어 사전과 비교해서, 자모 하나만 다른 단어는 사전 단어로 고친다.
#    OCR이 '플랫폼'을 '폴랫폼'(ㅡ↔ㅗ), '플랫포'(받침 ㅁ 빠짐)처럼 읽는 실수가 대부분 이 유형이다.
# 2) 한글 사이 영어 약어(SW, DB, AI)를 숫자·기호로 읽는 실수를 고친다.
# 3) 한글에 붙은 짧은 소문자 영어 조각(테두리·그림자 잡음) 제거, 괄호 짝 맞추기, 공백 정리.

COURSE_WORDS = (
    "프로그래밍", "플랫폼", "클라우드", "빅데이터", "데이터", "마이닝", "알고리즘", "운영체제",
    "네트워크", "컴퓨터", "컴퓨팅", "소프트웨어", "보안", "개론", "설계", "분석", "시스템",
    "인공지능", "프로젝트", "방법론", "캡스톤디자인", "산학협력", "실무중심", "확률", "통계학",
    "영상정보처리", "정보처리", "모바일", "공학", "응용", "개발", "오픈소스", "비즈니스",
    "정신건강", "문해력", "이해", "스마트카", "자료구조", "이산수학", "선형대수", "미적분학",
    "머신러닝", "딥러닝", "자연어처리", "컴퓨터비전", "데이터베이스", "그래픽스", "임베디드",
    "객체지향", "컴파일러", "수치해석", "통신", "회로", "전자", "기초", "실습", "세미나", "창의",
    "융합", "글쓰기", "영어", "회화", "경제학", "경영학", "심리학", "교양", "리더십", "진로",
)

_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"


def _jamo(ch: str) -> tuple[int, int, int] | None:
    code = ord(ch) - 0xAC00
    if not 0 <= code < 11172:
        return None
    return code // 588, (code % 588) // 28, code % 28


def _syllable_close(a: str, b: str) -> bool:
    """두 글자가 자모 하나만 다른지 (같으면 True)."""
    if a == b:
        return True
    ja, jb = _jamo(a), _jamo(b)
    if ja is None or jb is None:
        return False
    return sum(x != y for x, y in zip(ja, jb)) <= 1


def fix_course_words(subject: str) -> str:
    """사전 단어와 길이가 같고 딱 한 글자가 '자모 하나 차이'인 부분을 사전 단어로 바꾼다."""
    out = subject
    for word in sorted(COURSE_WORDS, key=len, reverse=True):
        n = len(word)
        # 두 글자 단어는 멀쩡한 단어를 바꿔 버리기 쉬워서('강의'→'창의') 세 글자 이상만 고친다
        if n < 3 or word in out:
            continue
        for i in range(0, len(out) - n + 1):
            seg = out[i:i + n]
            diffs = [k for k in range(n) if seg[k] != word[k]]
            if len(diffs) == 1 and _syllable_close(seg[diffs[0]], word[diffs[0]]):
                out = out[:i] + word + out[i + n:]
                break
    return out


_LATIN_FIXES = (
    # SW: '5/', '5)', '5W', 'S/' 등 (한글·하이픈·괄호 옆)
    (re.compile(r"(?<![A-Za-z0-9])(?:5|S|\$)(?:/|\\|W|VV)(?=[가-힣)\s]|$)"), "SW"),
    (re.compile(r"-\s*5\s*\)?$"), "-SW)"),
    # 한글 사이에 낀 숫자 5 ("오픈소스5분석") — 과목명에서 한글 사이 숫자는 거의 없다
    (re.compile(r"(?<=[가-힣])5(?=[가-힣])"), "SW"),
    # DB: '08', 'ㅁ8', 'D8', '0B' (한글 사이)
    (re.compile(r"(?<=[가-힣])\s*(?:08|ㅁ\s*8|D8|0B|DE)\s*(?=[가-힣])"), "DB"),
)


def fix_latin(subject: str) -> str:
    out = subject
    for pattern, repl in _LATIN_FIXES:
        out = pattern.sub(repl, out)
    return out


def tidy(subject: str) -> str:
    out = re.sub(r"(?<=[가-힣])[a-z]{1,3}(?=[가-힣]|$)|^[a-z]{1,3}(?=[가-힣])", "", subject)
    out = re.sub(r"\(\s+", "(", out)
    out = re.sub(r"\s+\)", ")", out)
    out = re.sub(r"\s*-\s*", "-", out)
    out = re.sub(r"(?<=[가-힣0-9])\s+(?=\()", " ", out)
    if out.count("(") > out.count(")"):
        out += ")"
    return out.strip()


def correct_subject(subject: str) -> str:
    return fix_course_words(tidy(fix_latin(subject)))


def assemble(lines: Sequence[tuple[str, float]]) -> BlockText:
    """줄들 → 과목명 + 강의실."""
    cleaned = [(clean_line(t), c) for t, c in lines]
    cleaned = [(t, c) for t, c in cleaned if t and not is_junk(t)]
    location = ""
    if cleaned and looks_like_location(cleaned[-1][0]):
        location = fix_location(cleaned[-1][0])
        cleaned = cleaned[:-1]
    # 에타는 글자 단위로 줄을 바꾸므로 줄 사이에 공백을 넣지 않는다
    subject = "".join(t for t, _ in cleaned).strip()
    subject = re.sub(r"\s+", " ", subject)
    # OCR이 음절 사이에 넣은 공백 제거 ("클 라 우 드" → "클라우드"). "알고리즘 (영어" 같은 공백은 유지
    subject = re.sub(r"(?<=[가-힣A-Za-z0-9]) (?=[가-힣])|(?<=[가-힣]) (?=[A-Za-z0-9])", "", subject)
    subject = correct_subject(subject)
    conf = sum(c for _, c in cleaned) / len(cleaned) if cleaned else 0.0
    return BlockText(subject=subject, location=location, confidence=conf)


def split_lines(binary: np.ndarray) -> list[np.ndarray]:
    """블록 이미지를 글자 줄 단위로 자른다 (가로로 잉크가 있는 행들의 묶음).

    Tesseract에 블록 전체를 맡기면 한 글자만 남은 마지막 줄("폼", "닝")을 자주 놓쳐서,
    줄을 우리가 직접 나눠 한 줄씩 읽게 한다.
    """
    ink = (binary < 128).sum(axis=1)
    rows = ink > max(2, binary.shape[1] * 0.004)
    runs: list[list[int]] = []
    start = None
    for y, on in enumerate(list(rows) + [False]):
        if on and start is None:
            start = y
        elif not on and start is not None:
            runs.append([start, y])
            start = None
    if not runs:
        return []
    # 받침·점처럼 작은 조각은 가까운 줄에 붙인다
    heights = sorted(e - s for s, e in runs)
    typical = heights[len(heights) // 2]
    merged: list[list[int]] = []
    for s_, e_ in runs:
        if merged and (e_ - s_ < typical * 0.45 or s_ - merged[-1][1] < typical * 0.15):
            merged[-1][1] = e_
        else:
            merged.append([s_, e_])
    out = []
    for s_, e_ in merged:
        if e_ - s_ < 8:
            continue
        line = binary[max(0, s_ - 6):min(binary.shape[0], e_ + 6), :]
        cols = np.where((line < 128).any(axis=0))[0]
        if cols.size == 0:
            continue
        line = line[:, max(0, cols[0] - 10):min(line.shape[1], cols[-1] + 10)]
        out.append(cv2.copyMakeBorder(line, 15, 15, 15, 15, cv2.BORDER_CONSTANT, value=255))
    return out


def _ocr_try(img: np.ndarray, psm: int) -> tuple[str, float]:
    data = pytesseract.image_to_data(
        img, lang=LANG, config=_config(psm), output_type=pytesseract.Output.DICT
    )
    words = [((t or "").strip(), float(c)) for t, c in zip(data["text"], data["conf"]) if (t or "").strip() and float(c) >= 0]
    if not words:
        return "", 0.0
    return " ".join(wd for wd, _ in words), sum(c for _, c in words) / len(words)


def _ocr_one_line(line_img: np.ndarray) -> tuple[str, float]:
    """한 줄 읽기. 비거나 확신이 낮으면 모드·크기를 바꿔 다시 읽고 가장 확신 높은 결과를 쓴다.

    (굵은 글씨의 짧은 줄 "방법론", "해"를 Tesseract가 통째로 빈칸으로 돌려준 사례가 있었다)
    """
    h, w = line_img.shape[:2]
    first_psm = 8 if w < h * 2.2 else 7  # 한두 글자짜리 줄은 '단어 하나' 모드
    best = _ocr_try(line_img, first_psm)
    if best[0] and best[1] >= 75:
        return best
    half = cv2.resize(line_img, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    for img, psm in ((line_img, 13), (half, first_psm), (half, 7), (line_img, 10 if w < h * 1.4 else 6)):
        cand = _ocr_try(img, psm)
        if cand[0] and cand[1] > best[1]:
            best = cand
        if best[0] and best[1] >= 75:
            break
    return best


def read_block(img_bgr: np.ndarray, bbox: tuple[int, int, int, int]) -> BlockText:
    crop = crop_block(img_bgr, bbox)
    if crop.size == 0:
        return BlockText("", "", 0.0)
    binary = preprocess(crop)
    lines = [_ocr_one_line(li) for li in split_lines(binary)]
    lines = [(t, c) for t, c in lines if t]
    if not lines:  # 줄 나누기가 실패하면 블록 전체를 한 번에
        lines = _ocr_lines(binary)
    return assemble(lines)


# ── 6. 같은 수업끼리 맞추기 ─────────────────────────────────────────────────────

def _block_color(img_bgr: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
    crop = crop_block(img_bgr, bbox)
    if crop.size == 0:
        return np.zeros(3)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    colored = hsv[hsv[:, 1] >= 9]
    return np.median(colored if len(colored) else hsv, axis=0)


def _same_course(a: BlockText, b: BlockText, ca: np.ndarray, cb: np.ndarray) -> bool:
    hue = min(abs(ca[0] - cb[0]), 180 - abs(ca[0] - cb[0]))
    if hue > 6 or abs(ca[1] - cb[1]) > 20:
        return False
    if not a.subject or not b.subject:
        return False
    return SequenceMatcher(None, a.subject, b.subject).ratio() >= 0.6


def unify_repeats(texts: list[BlockText], colors: list[np.ndarray]) -> list[BlockText]:
    """같은 색·비슷한 이름의 블록은 확신도가 가장 높은 읽기로 맞춘다."""
    out = list(texts)
    for i in range(len(texts)):
        group = [j for j in range(len(texts)) if _same_course(texts[i], texts[j], colors[i], colors[j])]
        if len(group) < 2:
            continue
        best = max(group, key=lambda j: (texts[j].confidence, len(texts[j].subject)))
        loc = next((texts[j].location for j in sorted(group, key=lambda j: -texts[j].confidence) if texts[j].location), "")
        out[i] = BlockText(texts[best].subject, loc or texts[i].location, texts[best].confidence)
    return out


def read_blocks(image_bytes: bytes, bboxes: Sequence[tuple[int, int, int, int]]) -> list[BlockText]:
    """시간표 이미지의 블록들 글자를 읽는다. Tesseract가 없으면 RuntimeError."""
    if not available():
        raise RuntimeError("tesseract(kor) not available")
    img = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image bytes")
    # 블록마다 Tesseract를 따로 돌리므로 병렬로 읽는다 (시간표 1장 ~7초 → ~2초)
    with ThreadPoolExecutor(max_workers=OCR_WORKERS) as pool:
        texts = list(pool.map(lambda bb: read_block(img, bb), bboxes))
    colors = [_block_color(img, bb) for bb in bboxes]
    return unify_repeats(texts, colors)
