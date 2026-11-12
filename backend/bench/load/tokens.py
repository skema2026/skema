"""accounts.json의 계정으로 한 번씩 천천히 로그인해서 토큰을 tokens.json에 저장 (로컬 서버 전용).

    python tokens.py http://127.0.0.1:8100
"""
import json
import sys
from pathlib import Path

import requests

HERE = Path(__file__).parent
host = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"
assert host.startswith(("http://127.0.0.1", "http://localhost")), "로컬 서버에만 씁니다"
acc = json.loads((HERE / "accounts.json").read_text())
toks = []
for e in acc["accounts"]:
    r = requests.post(f"{host}/auth/login", json={"email": e, "password": acc["password"]}, timeout=30)
    r.raise_for_status()
    toks.append(r.json()["access_token"])
(HERE / "tokens.json").write_text(json.dumps(toks))
print("tokens", len(toks))
