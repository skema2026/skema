FROM python:3.11-slim

WORKDIR /app

# 시스템 패키지 (pymysql은 순수 Python이므로 별도 빌드 의존성 불필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Alembic 마이그레이션 실행 후 서버 시작
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
