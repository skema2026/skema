from fastapi import APIRouter

from app.auth.router import router as auth_router
from app.schedule.router import router as schedule_router
from app.share.router import router as share_router
from app.ai_chat.router import router as ai_chat_router

api_router = APIRouter()

api_router.include_router(auth_router)      # /auth/*, /users/me, /profiles
api_router.include_router(schedule_router)  # /schedules/*, /exam-schedules/*
api_router.include_router(share_router)     # /share-tokens/*, /share/{token}
api_router.include_router(ai_chat_router)   # /ai/chat, /ai-chat-logs/*
