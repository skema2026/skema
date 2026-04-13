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
alembic upgrade head

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
