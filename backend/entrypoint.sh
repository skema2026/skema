#!/bin/sh
set -e

# DB가 완전히 준비될 때까지 대기 (depends_on healthcheck 이후에도 약간의 여유 필요)
echo "[entrypoint] Waiting for MySQL to be ready..."
MAX_TRIES=30
COUNT=0
until python -c "
import pymysql, os, sys
url = os.environ.get('DATABASE_URL', '')
# mysql+pymysql://user:pass@host:port/db 파싱
import re
m = re.match(r'mysql\+pymysql://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(.+)', url)
if not m:
    sys.exit(0)  # SQLite 등 다른 DB는 그냥 통과
user, pwd, host, port, db = m.groups()
port = int(port or 3306)
try:
    conn = pymysql.connect(host=host, port=port, user=user, password=pwd, database=db, connect_timeout=3)
    conn.close()
    sys.exit(0)
except Exception as e:
    print(f'  DB not ready: {e}')
    sys.exit(1)
" 2>/dev/null; do
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_TRIES ]; then
        echo "[entrypoint] ERROR: DB not ready after ${MAX_TRIES} attempts. Aborting."
        exit 1
    fi
    echo "[entrypoint] DB not ready yet, retrying ($COUNT/$MAX_TRIES)..."
    sleep 2
done

echo "[entrypoint] DB is ready. Running Alembic migrations..."
# 11/7: 실패하면 배포를 멈춘다. 예전에는 실패 시 'alembic stamp head'로 실행하지 않은 마이그레이션까지
# 적용된 것으로 표시해서, 서버는 뜨지만 DB 스키마가 코드와 어긋난 채로 남을 수 있었다.
# 정말 필요할 때(테이블은 이미 있고 버전 기록만 빠진 DB)만 ALEMBIC_STAMP_ON_FAILURE=1 로 예전 동작을 켠다.
if ! alembic upgrade head; then
    if [ "${ALEMBIC_STAMP_ON_FAILURE:-0}" = "1" ]; then
        echo "[entrypoint] WARNING: migration failed, ALEMBIC_STAMP_ON_FAILURE=1 -> stamping head (schema may not match code)"
        alembic stamp head
    else
        echo "[entrypoint] ERROR: migration failed. Fix the migration or DB, then redeploy."
        exit 1
    fi
fi

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
