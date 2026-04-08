# backend/routers/search.py

import os
import json
import requests
import google.generativeai as genai
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import SessionLocal
from .auth import get_current_user_token  # JWT 인증 함수
from utils.personalization import recent_feedback_summaries, make_persona_prompt
import models

router = APIRouter(prefix="/search", tags=["search"])

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "YOUR_GOOGLE_API_KEY_HERE")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", "YOUR_GOOGLE_CSE_ID_HERE")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class SearchRequest(BaseModel):
    query: str
    conversation_id: int | None = None   # 새로 추가

def google_search_cse(query: str, num=5, date_restrict=None, sort=None) -> List[dict]:
    """
    Google CSE를 호출해 결과 items[]를 합쳐서 반환.
    items[i]는 {"title":..., "snippet":..., "link":...}를 포함.
    만약 num > 10이면, 10개씩 페이징하여 여러 번 호출 후 결과를 합칩니다.
    """
    all_items: List[dict] = []
    max_per_request = 10

    # 페이징 계산
    total_needed = max(num, 1)         # 최소 1
    pages = (total_needed + max_per_request - 1) // max_per_request  # 올림

    for page_index in range(pages):
        # 이번 요청에서 가져올 개수(최대 10)
        remaining = total_needed - len(all_items)
        if remaining <= 0:
            break

        fetch_size = min(remaining, max_per_request)
        start = page_index * max_per_request + 1  # 1-based index

        # 공통 파라미터
        params = {
            "key" : GOOGLE_API_KEY,
            "cx"  : GOOGLE_CSE_ID,
            "q"   : query,
            "lr"  : "lang_ko",
            "num" : fetch_size,    # 이번에 가져올 개수 (최대 10)
            "start": start,        # 다음 페이지 시작
        }
        if date_restrict:
            params["dateRestrict"] = date_restrict
        if sort:
            params["sort"] = sort

        resp = requests.get("https://www.googleapis.com/customsearch/v1", params=params)
        resp.raise_for_status()
        data = resp.json()

        batch = data.get("items", [])
        all_items.extend(batch)

        # 혹시 결과가 실제로 더 적게 나온 경우 중단
        if len(batch) < fetch_size:
            break

    return all_items

@router.post("/")
def search_and_summarize(
    req: SearchRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    1) Google Custom Search로 검색
    2) 검색 결과(타이틀, 요약 등)를 OpenAI API에 넘겨 "정리"된 응답 생성
    3) conversation_id가 있으면 해당 대화, 없으면 새 대화 생성
    4) user(검색 질의), assistant(정리 결과) 메시지 기록
    5) 최종 결과 반환
    """

    # 1) [DB] conversation_id 핸들링
    conversation_obj = None
    if req.conversation_id:
        # 기존 대화 로드
        conversation_obj = db.query(models.Conversation).filter_by(
            id=req.conversation_id,
            user_id=current_user.id
        ).first()
        if not conversation_obj:
            raise HTTPException(status_code=404, detail="Conversation not found or not yours")

    else:
        # 새 대화 생성
        conversation_obj = models.Conversation(
            user_id=current_user.id,
            title="(Search) " + req.query[:20]  # 간단 제목
        )
        db.add(conversation_obj)
        db.commit()
        db.refresh(conversation_obj)

    # 2) Google Search
    try:
        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": GOOGLE_CSE_ID,
            "q": req.query,
            "lr": "lang_ko",
            "num": 3
        }
        resp = requests.get(url, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Google Search Error: {resp.text}")
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    items = data.get("items", [])
    if not items:
        # 검색 결과 없음 -> DB에 user 메시지만 남기고 짧은 응답
        user_msg = models.Message(
            conversation_id=conversation_obj.id,
            role="user",
            content=f"[검색요청] {req.query}"
        )
        db.add(user_msg)
        db.commit()
        return {
            "conversation_id": conversation_obj.id,
            "result": "No search results found.",
            "detail": []
        }

    # 3) Gemini 정리
    content_for_gemini = "다음은 사용자 검색 결과입니다.\n"
    for i, item in enumerate(items):
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        link = item.get("link", "")
        content_for_gemini += f"\n[{i+1}] 제목: {title}\n요약: {snippet}\n링크: {link}\n"

    # ▒▒▒▒▒▒▒▒▒▒▒▒▒ ▒ Personalization Block ▒ ▒▒▒▒▒▒▒▒▒▒▒▒▒
    # ① 유저 프로필 & 피드백 취합 → JSON
    profile_row = db.query(models.UserProfile).filter_by(user_id=current_user.id).first()
    persona = {
        "locale": profile_row.locale if profile_row else "ko",
        "genres": {g.genre: g.score for g in current_user.pref_genres},
        "tags":   [{"type": t.tag_type, "tag": t.tag, "weight": t.weight}
                   for t in current_user.pref_tags],
        "recent_feedback": recent_feedback_summaries(db, current_user, 50)
    }
    persona_prompt = make_persona_prompt(persona)
    print(content_for_gemini)

    try:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=(
                persona_prompt + "\n\n"
                "You are a helpful assistant. Please read the search results and provide an organized explanation (in Korean)."
            ),
        )
        resp = model.generate_content(content_for_gemini)
        final_text = resp.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini error: {str(e)}")

    # 4) 대화 히스토리에 user/assistant 메시지 저장
    # 4.1 user 메시지 (검색 요청)
    user_msg = models.Message(
        conversation_id=conversation_obj.id,
        role="user",
        content=f"[검색요청] {req.query}"
    )
    db.add(user_msg)

    # 4.2 assistant 메시지 (정리 결과)
    assistant_msg = models.Message(
        conversation_id=conversation_obj.id,
        role="assistant",
        content=final_text
    )
    db.add(assistant_msg)
    db.commit()

    # 5) 반환
    return {
        "conversation_id": conversation_obj.id,
        "query": req.query,
        "search_results": items,
        "final_answer": final_text
    }
