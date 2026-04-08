import os
import io
from typing import Annotated

import google.generativeai as genai
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from routers.chat import ChatRequest, chat as chat_endpoint   # ← 기존 /chat 재사용
from .auth   import get_current_user_token                    # JWT 검증
from database import SessionLocal
import models

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

router = APIRouter(prefix="/speech", tags=["speech"])

# ── helpers ─────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def gemini_stt(file: UploadFile):
    if file.content_type.split("/")[0] != "audio":
        raise HTTPException(400, "file must be audio/*")

    audio_bytes = await file.read()
    mime_type = file.content_type or "audio/webm"

    model = genai.GenerativeModel("gemini-2.0-flash")
    response = model.generate_content([
        {"mime_type": mime_type, "data": audio_bytes},
        "이 오디오를 정확히 텍스트로 변환해주세요. 변환된 텍스트만 반환하세요.",
    ])

    return response.text.strip(), None   # (transcript, confidence) – Gemini는 confidence 미제공

# ────────────────────────────────────────────────────
@router.post("/chat", status_code=201)
async def speech_chat(
    conversation_id: int | None = Form(None),
    timezone:        str | None = Form(None),
    audio: UploadFile = File(...),
    db : Session     = Depends(get_db),
    me : models.User = Depends(get_current_user_token)
):
    """
    • 짧은 음성 녹음을 받아 Gemini로 전사
    • /chat 엔드포인트에 그대로 전달해 답변·툴콜 처리까지 한 번에 수행
    • 응답: /chat 결과 + {"stt_confidence": float}
    """
    text, conf = await gemini_stt(audio)
    await audio.close()

    print(f"conversation_id={conversation_id}")
    print(f"timezone={timezone}")

    req = ChatRequest(
        conversation_id = int(conversation_id) if conversation_id else None,
        question        = text,
        timezone        = timezone
    )
    # 기존 chat 로직 호출 (의존성 직접 주입)
    resp = chat_endpoint(req, db=db, me=me)
    resp["stt_confidence"] = conf
    resp["transcript"]     = text
    return JSONResponse(resp)

# STT만 하는 단일 엔드포인트
@router.post("/stt")
async def stt_only(
    audio: Annotated[UploadFile, File(description="≤ 25 MB audio")]
):
    text, conf = await gemini_stt(audio)
    await audio.close()
    return {"text": text, "confidence": conf}
