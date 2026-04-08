# backend/routers/summarize.py

import os
import io
import google.generativeai as genai
import pdfplumber
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session
from database import SessionLocal
from .auth import get_current_user_token
import models

router = APIRouter(prefix="/summarize", tags=["summarize"])

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/")
async def summarize_file(
    file: UploadFile = File(...),
    conversation_id: int | None = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    1) 업로드된 파일(PDF/텍스트)을 읽어들여,
    2) 어떤 언어로 되어있든 "한글"로 요약 (Gemini)
    3) DB에 conversation 기록(선택), user/assistant 메시지
    """

    # 1) conversation 핸들링
    conversation_obj = None
    if conversation_id:
        conversation_obj = db.query(models.Conversation).filter_by(
            id=conversation_id,
            user_id=current_user.id
        ).first()
        if not conversation_obj:
            raise HTTPException(status_code=404, detail="Conversation not found or not yours")
    else:
        # 새 대화
        conversation_obj = models.Conversation(
            user_id=current_user.id,
            title="(Summarize) " + file.filename[:20]
        )
        db.add(conversation_obj)
        db.commit()
        db.refresh(conversation_obj)

    # 2) 파일 내용 추출
    content_text = ""
    print(file.content_type)
    try:
        if file.content_type == "application/pdf":
            pdf_bytes = await file.read()
            try:
                with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                    all_pages = []
                    for page in pdf.pages:
                        if page is not None:
                            text = page.extract_text() or ""
                            all_pages.append(text)
                    content_text = "\n".join(all_pages)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"pdfplumber error: {str(e)}")

        elif file.content_type in ["text/plain", "text/markdown", "application/octet-stream"]:
            raw_bytes = await file.read()
            content_text = raw_bytes.decode("utf-8", errors="ignore")
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File read error: {str(e)}")

    if not content_text.strip():
        user_msg = models.Message(
            conversation_id=conversation_obj.id,
            role="user",
            content=f"[파일요약] {file.filename} (empty?)"
        )
        db.add(user_msg)
        db.commit()

        return {
            "conversation_id": conversation_obj.id,
            "filename": file.filename,
            "summary": "(No text extracted)",
        }

    # 3) Gemini를 이용해 "어떤 언어든 한글 요약" 프롬프트
    system_instruction = (
        "You are a helpful assistant. The user has uploaded a document in an unknown language. "
        "Your job is to provide a summary in Korean (regardless of the original document language). "
        "Please keep it concise and clear in Korean."
    )

    try:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_instruction,
        )
        response = model.generate_content(content_text[:8000])
        summary = response.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini error: {str(e)}")

    # 4) DB 저장 (user: "[파일요약] filename", assistant: summary)
    user_msg = models.Message(
        conversation_id=conversation_obj.id,
        role="user",
        content=f"[파일요약] {file.filename}"
    )
    assistant_msg = models.Message(
        conversation_id=conversation_obj.id,
        role="assistant",
        content=summary
    )
    db.add(user_msg)
    db.add(assistant_msg)
    db.commit()

    # 5) 결과 반환
    return {
        "conversation_id": conversation_obj.id,
        "filename": file.filename,
        "summary": summary,
    }
