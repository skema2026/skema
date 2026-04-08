# routers/gcal.py  ── state 에 JWT 를 실어 보내는 버전
import os, json, datetime as dt, secrets
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from jose import jwt, JWTError
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

import models
from database import SessionLocal
from .auth import (
    get_current_user_token,              # JWT → current_user
    SECRET_KEY, ALGORITHM                # 기존 auth 모듈의 값
)

router = APIRouter(prefix="/gcal", tags=["gcal"])

CLIENT_CONFIG = json.loads(os.getenv("GOOGLE_OAUTH_JSON", "{}"))
REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI",
                          "http://localhost:8000/gcal/callback")
SCOPES = ["https://www.googleapis.com/auth/calendar"]

# ───────────────── DB helper ─────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _save_tokens(db: Session, user_id: int, creds: Credentials):
    db.merge(
        models.GToken(
            user_id      = user_id,
            access_token = creds.token,
            refresh_token= creds.refresh_token,
            expires_at   = dt.datetime.utcfromtimestamp(creds.expiry.timestamp())
        )
    )
    db.commit()

# ───────────────── ①  동의 화면 URL ──────────────
@router.get("/authorize")
def authorize(current_user: models.User = Depends(get_current_user_token)):
    if not CLIENT_CONFIG:
        raise HTTPException(500, "GOOGLE_OAUTH_JSON env 가 비어 있습니다.")

    flow = Flow.from_client_config(CLIENT_CONFIG, SCOPES, redirect_uri=REDIRECT_URI)

    # ↘ state 로 JWT 자체를 넣는다  (만료 5 분짜리)
    jwt_state = jwt.encode(
        {"sub": str(current_user.id),
         "exp": dt.datetime.utcnow() + dt.timedelta(minutes=5)},
        SECRET_KEY, algorithm=ALGORITHM
    )

    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=jwt_state
    )
    return {"auth_url": auth_url}

# ───────────────── ②  콜백 ──────────────────────
@router.get("/callback")
def oauth_callback(code: str, state: str, db: Session = Depends(get_db)):
    # ▶ state(JWT) → user_id 추출
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except JWTError:
        raise HTTPException(400, "state 검증 실패")

    # ▶ code 로 토큰 교환
    flow = Flow.from_client_config(CLIENT_CONFIG, SCOPES, redirect_uri=REDIRECT_URI)
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials
    _save_tokens(db, user_id, creds)
    return HTMLResponse("""
    <script>
    window.opener && window.opener.postMessage("gcal_success", "*");
    window.close();
    </script>
    """)

# ───────────────── ③  Service 빌더 ───────────────
def build_gcal_service(db: Session, user_id: int):
    tok: models.GToken | None = db.query(models.GToken).filter_by(user_id=user_id).first()
    if not tok or not tok.refresh_token:
        raise HTTPException(400, "Google Calendar 연동 필요")

    creds = Credentials(
        tok.access_token,
        refresh_token = tok.refresh_token,
        token_uri     = "https://oauth2.googleapis.com/token",
        client_id     = CLIENT_CONFIG["web"]["client_id"],
        client_secret = CLIENT_CONFIG["web"]["client_secret"],
        scopes        = SCOPES,
        expiry        = tok.expires_at,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_tokens(db, user_id, creds)

    return build("calendar", "v3", credentials=creds)

# ───────────────────────── 현재 연결 상태 ─────────────────────────
@router.get("/status")
def gcal_status(                       # <── 프런트가 GET /gcal/status 호출
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    connected = bool(
        db.query(models.GToken).filter_by(user_id=current_user.id).first()
    )
    return {"connected": connected}

# ───────────────────────── 연결 해제(Delete) ────────────────────
@router.delete("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
def gcal_disconnect(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    token_row = db.query(models.GToken).filter_by(user_id=current_user.id).first()
    if token_row:
        db.delete(token_row)
        db.commit()