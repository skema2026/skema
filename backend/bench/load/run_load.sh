#!/bin/sh
# 서버 부하 테스트. 서버는 CPU 0번(1코어), Locust는 CPU 1번에 고정해서 서로 CPU를 뺏지 않게 한다.
# 사용: OUT=run HOST=http://127.0.0.1:8100 sh run_load.sh   (Linux taskset 필요, 2코어 이상)
# 서버는 미리 CPU 0번에 띄운다: taskset -c 0 uvicorn app.main:app --port 8100
cd "$(dirname "$0")"
HOST=${HOST:-http://127.0.0.1:8100}
OUT=${OUT:-run}
mkdir -p "$OUT"
L="taskset -c 1 locust -f locustfile.py --host $HOST --headless --only-summary"
for U in 25 50 100 200 300 500; do
  echo "== 평소 사용 $U명 (요청 사이 3~8초) =="
  MODE=use THINK=3,8 $L -u $U -r 25 -t 75s --csv "$OUT/use_u$U" >/dev/null 2>&1
done
for U in 10 30; do
  echo "== 최대 처리량: $U명이 쉬지 않고 요청 =="
  MODE=use THINK=0,0 $L -u $U -r 10 -t 45s --csv "$OUT/max_u$U" >/dev/null 2>&1
done
for U in 2 5 10; do
  echo "== 로그인만: $U명이 1초마다 =="
  MODE=login THINK=1,1 $L -u $U -r 10 -t 40s --csv "$OUT/login_u$U" >/dev/null 2>&1
done
echo done
