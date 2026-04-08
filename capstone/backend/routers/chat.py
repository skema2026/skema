# backend/routers/chat.py

import os, json
import datetime as dt
from zoneinfo import ZoneInfo
import google.generativeai as genai
from typing import Literal
from pydantic import BaseModel, constr
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from models import Message, MessageRecommendationMap, RecCard
from .auth import get_current_user_token  # JWT 인증 함수
from .gcal  import build_gcal_service                  # Google service 헬퍼
from utils.personalization import recent_feedback_summaries, make_persona_prompt
from fastapi.responses import Response
import base64
from agent import build_agent, run_lcel_once

HISTORY_CUTOFF = 12

# 1) 로컬 타임존 결정
try:
    local_tz: ZoneInfo | dt.tzinfo = dt.datetime.now().astimezone().tzinfo  # ZoneInfo or timezone
except Exception:
    local_tz = dt.timezone.utc   # 극단적인 fallback

# 2) 사람이 읽을 이름 얻기 (ZoneInfo.key 가 있으면 그걸, 없으면 tzname)
def tz_label(tz: dt.tzinfo) -> str:
    return getattr(tz, "key", None) or tz.tzname(None) or "UTC"

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

router = APIRouter(prefix="/chat", tags=["chat"])

# ────────────────────────────── Pydantic ───────────────────────────────
class ChatRequest(BaseModel):
    conversation_id: int | None = None
    question:        str
    timezone:        str | None = None    # ex. "Europe/Berlin"
    plan_mode:       bool = True

class ToolResponse(BaseModel):
    """GPT function‑call 이 내려올 경우 파라미터 스키마"""
    action : Literal["create_event","delete_event"]
    title  : str | None = None
    start  : str | None = None     # ISO datetime
    end    : str | None = None
    event_id: str | None = None

class TitleUpdate(BaseModel):
    title: constr(strip_whitespace=True, min_length=1, max_length=60)

# ────────────────────────────── helpers ────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def append_and_commit(db, convo, role, content):
    msg = Message(
        conversation_id=convo.id,
        role=role,
        content=content
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg

@router.post("/", status_code=201)
def chat(req: ChatRequest,
         db: Session = Depends(get_db),
         me: models.User = Depends(get_current_user_token)):

    # 0) 대화 객체
    convo = (db.query(models.Conversation)
               .filter_by(id=req.conversation_id, user_id=me.id).first()
             if req.conversation_id else None)
    if not convo:
        convo = models.Conversation(user_id=me.id, title="Untitled chat")
        db.add(convo); db.commit(); db.refresh(convo)

    # 1) user 메시지 저장
    append_and_commit(db, convo, "user", req.question)

    # 2) Agent 실행
    tz  = ZoneInfo(req.timezone) if req.timezone else local_tz
    if req.plan_mode:
        res = run_lcel_once(db, me, tz, user_input=req.question)
    else:
        # 기존 단일-스텝 에이전트
        res = build_agent(db, me, tz, convo.messages).invoke({"input": req.question})

    # 3) 결과 해석 ────────────────◆ 여기부터 수정 ◆───────────────
    payload: dict | None = None   # 최종 카드/이미지 JSON
    answer, cards = "", []
    if isinstance(res["output"], str):
        try:
            payload = json.loads(res["output"])
        except json.JSONDecodeError:
            answer = res["output"]    

    # (1) 이미지
    if payload and {"original_b64", "thumb_b64"} <= payload.keys():
        assistant_msg = append_and_commit(
            db, convo, "assistant",
            f"📷 요청하신 이미지를 생성했습니다.\n\nprompt: {payload.get('prompt','')}"
        )
        db.add(models.MessageImage(
            message_id   = assistant_msg.id,
            prompt       = payload.get("prompt",""),
            original_b64 = payload["original_b64"],
            thumb_b64    = payload["thumb_b64"],
        ))
        db.commit()
        answer = "(image_created)"

    # (2) 추천 카드
    elif payload and "cards" in payload:
        cards = payload["cards"]                # [{card_id, title, …}, …]

        # ── 1) 사람이 읽을 답변용 텍스트 ────────────────────────
        if cards:
            lines = [f"• {c['title']} ({c['type']})" for c in cards]
            answer = "아래와 같은 추천 결과를 찾았습니다:\n\n" + "\n".join(lines)
        else:
            answer = "추천할 카드가 없네요!"

        # ── 2) assistant 메시지 row ────────────────────────────
        assistant_msg = append_and_commit(db, convo, "assistant", answer)

        # ── 3) RecCard 존재 → 없으면 INSERT, 그리고 매핑 INSERT ─
        for idx, c in enumerate(cards):
            card_row = db.query(RecCard).filter_by(id=c["card_id"]).first()
            if not card_row:
                card_row = RecCard(
                    id       = c["card_id"],
                    type     = c.get("type", "content"),
                    title    = c.get("title", "Untitled"),
                    subtitle = c.get("subtitle", ""),
                    url      = c.get("link", ""),
                    reason   = c.get("reason", ""),
                    tags     = c.get("tags", []),
                )
                db.add(card_row)
                db.flush()                      # id 보장

            db.add(MessageRecommendationMap(
                message_id  = assistant_msg.id,
                rec_card_id = card_row.id,
                sort_order  = idx,
            ))

        db.commit()

    else:                                                                            # 일반 텍스트
        append_and_commit(db, convo, "assistant", answer)

    # 4) Untitled 일 때 제목 요약
    if convo.title == "Untitled chat":
        summarize_conversation_title(db, convo)

    return {"conversation_id": convo.id, "answer": answer, "cards": cards}

@router.get("/conversations")
def get_conversations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    - 현재 로그인 사용자(user_id) 소유의 conversation 목록 반환
    """
    convo_list = db.query(models.Conversation)\
                   .filter_by(user_id=current_user.id)\
                   .all()
    results = []
    for c in convo_list:
        results.append({
            "conversation_id": c.id,
            "title": c.title,
            "created_at": c.created_at
        })
    return results

@router.get("/conversations/{conversation_id}")
def get_conversation_detail(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    - 특정 대화 상세(메시지 목록)를 불러온다
    """
    convo = db.query(models.Conversation).filter_by(
        id=conversation_id,
        user_id=current_user.id
    ).first()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found or not yours")

    messages = []
    for m in convo.messages:
        # ↘ 추천 카드가 있으면, 관계를 통해 가져옴
        card_list = []
        for mr in m.recommendations:
            c = mr.rec_card
            # DB의 RecCard 정보를 JSON 형태로 변환
            card_fb = db.query(models.FeedbackLog).filter_by(
                user_id = current_user.id,
                category="recommend",
                reference_id=f"card_id={c.id}"   # or just c.id
            ).first()

            card_feedback_info = None
            if card_fb:
                card_feedback_info = {
                    "feedback_id": card_fb.id,
                    "feedback_score": card_fb.feedback_score,
                    "feedback_label": card_fb.feedback_label,
                    "details": card_fb.details
                }

            card_list.append({
                "card_id"  : c.id,
                "type"     : c.type,
                "title"    : c.title,
                "subtitle" : c.subtitle,
                "link"     : c.url,
                "reason"   : c.reason,
                "feedback" : card_feedback_info,
                "tags"     : c.tags,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "sort_order": mr.sort_order  # 혹은 필요 없다면 생략
            })

        # ----- (2) 메시지에 대한 피드백 로딩
        # category="chat", reference_id=f"message_{m.id}", user_id=current_user.id
        fb = db.query(models.FeedbackLog).filter_by(
            user_id=current_user.id,
            category="chat",
            reference_id=f"message_{m.id}"
        ).first()
        if fb:
            feedback_info = {
                "feedback_id": fb.id,
                "feedback_score": fb.feedback_score,
                "feedback_label": fb.feedback_label,
                "details": fb.details
            }
        else:
            feedback_info = None

        thumbs = [ {"image_id": im.id, "thumb": im.thumb_b64} for im in m.images ]

        messages.append({
            "message_id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at,
            "cards": card_list,
            "images": thumbs,
            "feedback": feedback_info   # ← ★ 메시지별 피드백 정보
        })

    return {
        "conversation_id": convo.id,
        "title": convo.title,
        "messages": messages
    }

# ★ 추가: 요약해서 convo.title 로 설정하는 함수
def summarize_conversation_title(db: Session, convo: models.Conversation):
    """
    대화 내용(Message)을 간략히 요약하여 conversation.title 로 설정
    """
    # 1) 대화 내용을 하나의 문자열로 합침
    text_parts = []
    print(convo.messages)
    for m in convo.messages:
        # role: system, user, assistant
        # 일단 user/assistant 메시지만 포함
        if m.role in ("user", "assistant"):
            text_parts.append(f"{m.role}: {m.content}")
    joined_text = "\n".join(text_parts)
    print(text_parts)
    if not joined_text.strip():
        return  # 대화가 비어있으면 그냥 둠

    # 2) OpenAI 요청: "이 대화를 한 줄짜리 짧은 제목으로 요약"
    system_prompt = (
        "You are a helpful assistant. The user and assistant messages are shown. "
        "Please create a concise conversation title in Korean, under 30 characters. "
        "If there's no meaningful content, just return something like '메시지 없음'."
    )
    try:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=30,
                temperature=0.6,
            ),
        )
        resp = model.generate_content(joined_text)
        new_title = resp.text.strip()
    except Exception:
        new_title = "(Untitled)"

    # 제목 길이가 너무 길면 잘라냄 (30자)
    if len(new_title) > 30:
        new_title = new_title[:30].rstrip()

    # DB 반영
    convo.title = new_title
    db.commit()


@router.patch("/conversations/{conversation_id}", status_code=200)
def rename_conversation(
    conversation_id: int,
    payload: TitleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    """
    PATCH /chat/conversations/{id}
    바디: { "title": "새 제목" }
    """
    convo = (
        db.query(models.Conversation)
        .filter_by(id=conversation_id, user_id=current_user.id)
        .first()
    )
    if not convo:
        raise HTTPException(404, "Conversation not found or not yours")

    convo.title = payload.title
    db.commit()
    return {"conversation_id": convo.id, "title": convo.title}


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    """
    DELETE /chat/conversations/{id}
    대화 · 메시지 · 추천맵 전부 삭제 (SQLAlchemy cascade)
    """
    convo = (
        db.query(models.Conversation)
        .filter_by(id=conversation_id, user_id=current_user.id)
        .first()
    )
    if not convo:
        raise HTTPException(404, "Conversation not found or not yours")

    db.delete(convo)
    db.commit()
    # 204 No Content


@router.get("/images/{image_id}", status_code=200)
def get_original_image(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    """
    원본 WebP 바이너리를 그대로 돌려준다.
    (Auth 적용 → 내 대화의 이미지만 볼 수 있게)
    """
    img_row = (
        db.query(models.MessageImage)
        .join(models.Message, models.Message.id == models.MessageImage.message_id)
        .join(models.Conversation, models.Conversation.id == models.Message.conversation_id)
        .filter(
            models.MessageImage.id == image_id,
            models.Conversation.user_id == current_user.id,
        )
        .first()
    )
    if not img_row:
        raise HTTPException(404, "Image not found or not yours")

    return Response(
        content=base64.b64decode(img_row.original_b64),
        media_type="image/webp",          # ↔ PIL 의 .save(format="WEBP")
        headers={"Cache-Control": "public,max-age=31536000"},
    )