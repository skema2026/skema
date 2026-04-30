"""
AI 기반 개인 시간표·일정 관리 — FastAPI 진입점

실행:
    uvicorn app.main:app --reload

Swagger UI:  http://localhost:8000/docs
ReDoc:       http://localhost:8000/redoc
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# 모든 ORM 모델 metadata 등록 (Alembic autogenerate / create_all 대상)
import app.db.base  # noqa: F401

from app.auth.router import router as auth_router
from app.admin.router import router as admin_router
from app.schedule.router import router as schedule_router
from app.share.router import router as share_router
from app.ai_chat.router import router as ai_chat_router
from app.syllabus.router import router as syllabus_router
from app.eta.router import router as eta_router
from app.notification.router import router as notification_router
from app.kakao.router import router as kakao_router
from app.core.config import settings


# ── FastAPI 앱 생성 ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.notification.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Skema API",
    description="AI 기반 개인 시간표·일정 관리 백엔드",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# ── 에러 응답 형식 통일 ───────────────────────────────────────────────────────
# 모든 에러를 {"detail": "..."} 단일 구조로 반환.

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if any("email" in error.get("loc", ()) for error in errors):
        return JSONResponse(
            status_code=422,
            content={"detail": "올바른 이메일 형식이 아닙니다."},
        )
    if len(errors) == 1:
        detail = errors[0].get("msg", str(exc))
    else:
        detail = "; ".join(e.get("msg", "") for e in errors)
    return JSONResponse(
        status_code=422,
        content={"detail": detail},
    )


# ── CORS ──────────────────────────────────────────────────────────────────────
# CORS_ORIGINS 환경변수(쉼표 구분) 우선. 없으면 FRONTEND_URL + 로컬 개발 포트.

if settings.CORS_ORIGINS:
    _origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
else:
    _origins = [
        settings.FRONTEND_URL,
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
    ]
# 중복 제거 (순서 유지)
_origins = list(dict.fromkeys(_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 라우터 등록 ───────────────────────────────────────────────────────────────

app.include_router(auth_router)         # /auth/*, /users/me, /profiles
app.include_router(admin_router)        # /admin/*
app.include_router(schedule_router)     # /schedules/*, /exam-schedules/*
app.include_router(share_router)        # /share-tokens/*, /share/{token}
app.include_router(ai_chat_router)      # /ai/chat, /ai-chat-logs/*
app.include_router(syllabus_router)     # /syllabi/*
app.include_router(eta_router)          # /eta/parse-image, /eta/save-schedules
app.include_router(notification_router) # /notifications/*
app.include_router(kakao_router)        # /kakao/status, /kakao/notify


# ── 헬스체크 ──────────────────────────────────────────────────────────────────

@app.get("/", tags=["health"])
def root():
    return {"status": "ok", "message": "Skema API is running", "docs": "/docs"}


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
