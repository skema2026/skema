FROM python:3.11-slim

WORKDIR /app

# 시스템 패키지 (OpenCV headless 의존성 포함)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# 의존성 먼저 설치 (레이어 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 복사
COPY . .

# 업로드 디렉토리 생성
RUN mkdir -p /app/uploads/syllabi

# entrypoint 실행 권한 + CRLF 제거 (Windows 클론 대비)
RUN sed -i 's/\r//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
