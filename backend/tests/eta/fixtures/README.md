# ETA 파서 인식률 측정 - Fixtures

## 파일 추가 방법

이미지와 JSON 파일을 **같은 이름**으로 이 디렉토리에 넣으세요.

```
fixtures/
  내시간표.png    ← 에브리타임 스크린샷
  내시간표.json   ← 정답 데이터 (아래 형식)
```

## 정답 JSON 형식

```json
[
  {
    "subject_name": "알고리즘",
    "day_of_week": 1,
    "start_time": "09:00",
    "end_time": "10:30"
  }
]
```

| 필드 | 설명 |
|------|------|
| `subject_name` | 과목명 (앱에 표시된 그대로) |
| `day_of_week` | 0=월 1=화 2=수 3=목 4=금 5=토 6=일 |
| `start_time` | 시작 시간 HH:MM (24시간제) |
| `end_time` | 종료 시간 HH:MM (24시간제) |

## 측정 실행

```bash
# backend/ 디렉토리에서 실행
cd backend

# 전체 파서 측정
python -m tests.eta.eval_parsers

# 특정 파서만
python -m tests.eta.eval_parsers --parsers opencv easyocr

# LLM Vision 포함 (OpenAI API 키 필요)
python -m tests.eta.eval_parsers --llm

# 다른 fixtures 경로
python -m tests.eta.eval_parsers --fixtures /path/to/images
```

## 파서 종류

| 파서 | API 키 | 과목명 인식 | 속도 |
|------|--------|-------------|------|
| `opencv` | 불필요 | ❌ (위치만) | 매우 빠름 |
| `easyocr` | 불필요 | ✅ | 보통 |
| `google_vision` | Google Vision API | ✅ | 빠름 |
| `llm_vision` | OpenAI API | ✅ | 느림 |

## 출력 예시

```
📷 내시간표.png  (정답 5개)
  파서               검출  매칭  Recall    Prec      F1   과목유사도  과목정확  시작시간  종료시간  속도
  opencv              5     5   100.0%   100.0%  100.0%      0.0%     0.0%    80.0%    60.0%   0.3s
  easyocr             5     5   100.0%   100.0%  100.0%     92.4%    80.0%    80.0%    60.0%   4.2s
  google_vision       6     5   100.0%    83.3%   90.9%     95.1%   100.0%    80.0%    80.0%   1.1s
```

> `opencv`는 과목명 인식 기능이 없어 과목유사도/과목정확은 항상 0%입니다.
> 시간·요일 정확도 측정 기준선(baseline)으로 활용하세요.
