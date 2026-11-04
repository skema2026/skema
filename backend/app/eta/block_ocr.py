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
TARGET_TEXT_PX = 48  # 줄 하나의 글자 높이를 이 정도로 맞춰 읽는다
OCR_WORKERS = int(os.environ.get("ETA_OCR_WORKERS", "4"))

# 건물+호수: 소프트516, AI관-408, 2공105, 미디어509, 상경418, 사범201
_LOCATION_RE = re.compile(r"^[가-힣A-Za-z0-9]{1,6}?[\s\-]?\d{2,4}[A-Za-z]?$")
# 과목명에 쓰일 수 있는 글자만 남긴다
_KEEP_RE = re.compile(r"[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9()\[\]\-+&·.,:/ ]")


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
    # 블록 가장자리에 걸린 세로·가로 선(옆 칸 경계선 등)을 지운다.
    # 남아 있으면 모든 줄이 이 선으로 이어져 줄 나누기가 통째로 실패했다(11/4, 새 캡처).
    ink = binary < 128
    binary[:, ink.mean(axis=0) > 0.6] = 255
    binary[ink.mean(axis=1) > 0.85, :] = 255
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
    if re.fullmatch(r"[-(]?[A-Z]{2,5}[)]?", text.strip()):
        return False  # "(CE)", "SW)", "-IT" 처럼 줄바꿈으로 떨어진 대문자 약어
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
    # "2공105"의 '공'을 숫자(5, 3 등)로 읽어 "25105"가 되는 경우. 강의실 번호는 3자리라
    # 숫자만 5자리면 가운데가 건물 이름 '공'이다 (1공·2공·3공 = 공학관)
    if re.fullmatch(r"\d{5}", value):
        value = value[0] + "공" + value[2:]
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
    "가상화", "프로토콜", "인터넷", "오토마타", "아키텍처", "멀티미디어", "신호처리", "포트폴리오",
    "커리어", "프로페셔널", "서비스", "산업", "실험", "논리회로", "패턴인식", "프로그래밍언어",
)

_WORD_SET = set(COURSE_WORDS)

# 개인 일정에 흔한 짧은 이름. 두 글자라 일부분 고치기는 위험해서 '이름 전체'가 자모 하나 차이일 때만 고친다
# ("갈바" → "알바"). 11/4 새 캡처에서 알바 4개가 모두 "갈바"로 읽혔다.
PERSONAL_WORDS = (
    "알바", "운동", "헬스", "스터디", "학원", "과외", "회의", "동아리", "수영", "요가", "필라테스",
    "출근", "근무", "봉사", "레슨", "약속", "통학", "자습", "복습", "예습", "과제", "식사", "학생회",
)

_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"


def _jamo(ch: str) -> tuple[int, int, int] | None:
    code = ord(ch) - 0xAC00
    if not 0 <= code < 11172:
        return None
    return code // 588, (code % 588) // 28, code % 28


def _syllable_close(a: str, b: str, max_diff: int = 1) -> bool:
    """두 글자가 자모 max_diff개 이하로만 다른지 (같으면 True)."""
    if a == b:
        return True
    ja, jb = _jamo(a), _jamo(b)
    if ja is None or jb is None:
        return False
    return sum(x != y for x, y in zip(ja, jb)) <= max_diff


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
            if seg in _WORD_SET:
                continue  # 이미 다른 사전 단어면 그대로 ('컴퓨터'를 '컴퓨팅'으로 바꾸지 않게)
            diffs = [k for k in range(n) if seg[k] != word[k]]
            # 세 글자 이상 단어는 한 글자 안에서 자모 둘까지 허용 ('가상타'→'가상화': ㅌ/ㅎ, ㅏ/ㅘ)
            if len(diffs) == 1 and _syllable_close(seg[diffs[0]], word[diffs[0]], 2 if n >= 3 else 1):
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
    # 이름 맨 앞 SW ("5아키텍처", "5프로페셔널영어쓰기")와 괄호 속 SW ("(5)")
    (re.compile(r"^5(?=[가-힣])"), "SW"),
    (re.compile(r"\(\s*5\s*\)"), "(SW)"),
    # CE(컴퓨터공학 분반 표시)를 '06', '0E'로 읽는 경우 ("분산처리(06)", "캡스톤디자인-06)")
    (re.compile(r"(?<=[(\-])\s*(?:06|0E|C6|0€|C€)\s*(?=\))"), "CE"),
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


def fix_personal_word(subject: str) -> str:
    """이름 전체가 개인 일정 단어와 한 글자·자모 하나 차이면 그 단어로."""
    for word in PERSONAL_WORDS:
        if len(subject) == len(word) and subject != word:
            diffs = [k for k in range(len(word)) if subject[k] != word[k]]
            if len(diffs) == 1 and _syllable_close(subject[diffs[0]], word[diffs[0]]):
                return word
    return subject


def suggest_schedule_type(subject: str, location: str | None) -> str:
    """확인 화면에서 먼저 골라 둘 일정 종류. 사용자가 바꿀 수 있다.

    강의실이 없고 이름에 개인 일정 단어(알바, 스터디, 회의 …)가 들어 있으면 'personal'.
    강의실 없는 온라인 수업("성공취업과직무분석")도 있어서 강의실만으로는 정하지 않는다.
    """
    if (location or "").strip():
        return "class"
    name = re.sub(r"\s+", "", subject or "")
    if any(word in name for word in PERSONAL_WORDS):
        return "personal"
    return "class"


def correct_subject(subject: str) -> str:
    return fix_personal_word(fix_course_words(tidy(fix_latin(subject))))


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


def _ocr_try(img: np.ndarray, psm: int, lang: str = LANG) -> tuple[str, float]:
    data = pytesseract.image_to_data(
        img, lang=lang, config=_config(psm), output_type=pytesseract.Output.DICT
    )
    words = [((t or "").strip(), float(c)) for t, c in zip(data["text"], data["conf"]) if (t or "").strip() and float(c) >= 0]
    if not words:
        return "", 0.0
    return " ".join(wd for wd, _ in words), sum(c for _, c in words) / len(words)


def _ocr_one_line(line_img: np.ndarray) -> tuple[str, float]:
    """한 줄 읽기. 비거나 확신이 낮으면 모드·크기를 바꿔 다시 읽고 가장 확신 높은 결과를 쓴다.

    (굵은 글씨의 짧은 줄 "방법론", "해"를 Tesseract가 통째로 빈칸으로 돌려준 사례가 있었다)
    """
    # 글자 크기 맞추기: Tesseract는 글자 높이 40~50px 정도에서 가장 잘 읽는다.
    # 해상도가 높은 캡처(1080px 폭 등)는 3배 확대하면 글자가 90px을 넘어 '실'→'닐' 같은 실수가 늘었다.
    ink_rows = np.where((line_img < 128).any(axis=1))[0]
    if ink_rows.size:
        ink_h = int(ink_rows[-1] - ink_rows[0] + 1)
        if ink_h > TARGET_TEXT_PX * 1.4:
            f = TARGET_TEXT_PX / ink_h
            line_img = cv2.resize(line_img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
            _, line_img = cv2.threshold(line_img, 128, 255, cv2.THRESH_BINARY)
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


# 한글 모델이 영어 대문자 약어를 숫자·기호로 읽은 흔적 ("DBMS"→"28115", "OS/NW"→"05/4\\", "SQL"→"50[")
_SUSPICIOUS_RE = re.compile(r"[0-9A-Za-z/\\\[\]&$|?ㄱ-ㅎㅏ-ㅣ]{2,}")

# 과목명에 자주 나오는 영어 약어. 영어 모델 결과("ASFPGAH", "AQISQLA")에는 앞뒤로 한글을
# 잘못 읽은 대문자가 붙어 나오므로, 그 안에서 아는 약어만 골라낸다 (긴 것부터).
LATIN_TERMS = (
    "PYTHON", "JAVA", "DBMS", "FPGA", "LINUX", "UNIX", "IOT", "SQL", "AWS", "API", "GPU", "CPU", "ICT",
    "ERP", "CAD", "MIS", "SW", "HW", "DB", "AI", "IT", "OS", "NW", "CE", "UX", "UI", "VR", "AR", "ML", "PM",
    "OS/NW",
)
_TERMS_SORTED = sorted(LATIN_TERMS, key=len, reverse=True)


def english_terms(en_text: str) -> list[str]:
    """영어 모델 결과에서 아는 약어를 나온 순서대로."""
    found: list[tuple[int, str]] = []
    upper = re.sub(r"[^A-Z/]", " ", en_text.upper())
    taken = [False] * len(upper)
    for term in _TERMS_SORTED:
        start = upper.find(term)
        while start >= 0:
            if not any(taken[start:start + len(term)]):
                found.append((start, term))
                for k in range(start, start + len(term)):
                    taken[k] = True
            start = upper.find(term, start + 1)
    return [t for _, t in sorted(found)]


def _suspicious_segments(text: str) -> list[str]:
    compact = text.replace(" ", "")
    return [
        m for m in _SUSPICIOUS_RE.findall(compact)
        if re.search(r"[0-9/\\\[\]&$|?]", m)
        and not (m.isdigit() and compact.endswith(m))  # 줄 끝 숫자는 강의실 번호 (소프트310)
    ]


def fix_with_english(kor_text: str, en_text: str) -> str:
    """한글+영어 모델 결과의 '수상한 숫자·기호 덩어리'를 영어 전용 모델이 읽은 대문자 약어로 바꾼다.

    영어 모델은 한글 부분을 엉터리로 읽지만 대문자 약어(DBMS, OS/NW, FPGA)는 정확히 읽는다.
    덩어리 수와 약어 수가 같을 때만 순서대로 바꾼다 (엉뚱한 곳을 바꾸지 않게).
    """
    compact = fix_latin(kor_text.replace(" ", ""))  # 규칙으로 고칠 수 있는 것(5/→SW 등)은 먼저 고친다
    bad = _suspicious_segments(compact)
    tokens = english_terms(en_text)
    if not bad or len(bad) != len(tokens):
        return compact
    out = compact
    for seg, tok in zip(bad, tokens):
        if not (len(seg) - 1 <= len(tok) <= len(seg) + 1):
            return compact  # 길이가 많이 다르면 엉뚱한 약어 — 바꾸지 않는다
        out = out.replace(seg, tok, 1)
    return out


def fix_ai(kor_text: str, en_text: str) -> str:
    """'AI'를 한글 '시'로 읽는 실수 (A→ㅅ, I→ㅣ 모양이 비슷). 영어 모델이 그 줄에서 AI를 읽었고
    한글 결과에 AI가 없으면, 영어 결과에서 AI가 있던 위치와 가장 가까운 '시'를 AI로 바꾼다."""
    compact = kor_text.replace(" ", "")
    if "AI" in compact or "시" not in compact or "AI" not in english_terms(en_text):
        return kor_text
    pos = en_text.upper().find("AI") / max(1, len(en_text))
    cands = [i for i, ch in enumerate(compact) if ch == "시" and compact[i + 1:i + 2] != "스"]  # 시스템은 제외
    if not cands:
        return kor_text
    i = min(cands, key=lambda k: abs(k / max(1, len(compact)) - pos))
    return compact[:i] + "AI" + compact[i + 1:]


def _ocr_english(line_img: np.ndarray) -> str:
    try:
        return pytesseract.image_to_string(line_img, lang="eng", config=_config(7))
    except Exception:  # noqa: BLE001
        return ""


def read_block(img_bgr: np.ndarray, bbox: tuple[int, int, int, int]) -> BlockText:
    crop = crop_block(img_bgr, bbox)
    if crop.size == 0:
        return BlockText("", "", 0.0)
    binary = preprocess(crop)
    lines = []
    for li in split_lines(binary):
        text, conf = _ocr_one_line(li)
        if text and not looks_like_location(text) and _suspicious_segments(fix_latin(text.replace(" ", ""))):
            text = fix_with_english(text, _ocr_english(li))
        elif text and "시" in text and not looks_like_location(text):
            text = fix_ai(text, _ocr_english(li))
        elif text and not re.search(r"[가-힣]", text) and len(re.findall(r"[A-Za-z0-9]", text)) <= 4:
            # 짧은 줄을 영어로 읽었는데("맥스)"→"HA)") 아는 약어가 아니면 한글 전용으로 다시 읽어 본다
            if not english_terms(text) and not english_terms(_ocr_english(li)):
                kor = _ocr_try(li, 7, lang="kor")
                if re.search(r"[가-힣]", kor[0]) and kor[1] >= 60:
                    text, conf = kor
        lines.append((text, conf))
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
        # 한 블록에서 마지막 한 글자 줄("어", "콜")을 놓친 경우: 다른 블록이 같은 앞부분에
        # 더 긴 이름을 읽었으면 그쪽을 쓴다 ("프로그래밍언" < "프로그래밍언어")
        for j in group:
            if len(texts[j].subject) > len(texts[best].subject) and texts[j].subject.startswith(texts[best].subject):
                best = j
        # 강의실은 주 2회 수업이 다른 방일 수 있어서 자기 블록에서 읽은 것을 우선한다
        loc = texts[i].location or next(
            (texts[j].location for j in sorted(group, key=lambda j: -texts[j].confidence) if texts[j].location), ""
        )
        out[i] = BlockText(texts[best].subject, loc, texts[best].confidence)
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
