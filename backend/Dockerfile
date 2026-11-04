FROM python:3.11-slim

WORKDIR /app

# 시스템 패키지 (OpenCV headless 의존성 + 시간표 글자 인식용 Tesseract OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libglib2.0-0 \
    libgl1 \
    tesseract-ocr \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tesseract 정확도 높은 모델(tessdata_best 4.1.0) 한국어+영어. 체크섬으로 고정한다.
# 기본 모델보다 시간표 과목명 정확도가 높았다 (시간표 5장 53개 블록 기준 91% → 98%, 11/4 측정)
# 블록을 4개씩 병렬로 읽으므로 Tesseract 내부 스레드는 1개로 (CPU 과부하 방지)
ENV ETA_TESSDATA_DIR=/opt/tessdata \
    OMP_THREAD_LIMIT=1
RUN mkdir -p /opt/tessdata \
    && curl -fsSL -o /opt/tessdata/kor.traineddata https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/4.1.0/kor.traineddata \
    && curl -fsSL -o /opt/tessdata/eng.traineddata https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/4.1.0/eng.traineddata \
    && echo "f888d4038348a0c3d25151e7f452bda0d74ca275b18cab146798bcbb94084fff  /opt/tessdata/kor.traineddata" | sha256sum -c - \
    && echo "8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba  /opt/tessdata/eng.traineddata" | sha256sum -c -

# 의존성 먼저 설치 (레이어 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 복사
COPY . .

# entrypoint 실행 권한 + CRLF 제거 (Windows 클론 대비)
RUN sed -i 's/\r//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
