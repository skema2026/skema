"""
AI 기반 개인 일정 관리 플랫폼 - FastAPI 애플리케이션 진입점.

실행:
    uvicorn app.main:app --reload

Swagger UI:  http://localhost:8000/docs
ReDoc:       http://localhost:8000/redoc
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── 모든 모델을 metadata에 등록 (Alembic autogenerate 및 create_all 용) ───────
import app.db.base  # noqa: F401

from app.core.config import settings
from app.api.v1.router import api_router


# ── FastAPI 앱 생성 ───────────────────────────────────────────────────────────

app = FastAPI(
    title="Skema API",
    description="AI 기반 개인 시간표 & 일정 관리 플랫폼",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)


# ── CORS ─────────────────────────────────────────────────────────────────────

_default_cors = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
_extra = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
_allow_origins = list(dict.fromkeys(_default_cors + [settings.FRONTEND_URL] + _extra))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 라우터 등록 ───────────────────────────────────────────────────────────────

app.include_router(api_router)


# ── 헬스체크 ──────────────────────────────────────────────────────────────────

@app.get("/", tags=["health"])
def root():
    return {"status": "ok", "message": "Skema API is running", "docs": "/docs"}


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
