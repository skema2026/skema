# backend/routers/recommend.py

import os, json
import requests
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from database import SessionLocal
from .auth import get_current_user_token  # JWT 인증 (user_id)
import models
import google.generativeai as genai
import datetime as dt
from zoneinfo import ZoneInfo
from .search import google_search_cse
from utils.personalization import recent_feedback_summaries
from utils.cse_slim import slim_cse_item

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

router = APIRouter(prefix="/recommend", tags=["recommend"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def extract_movie_keyword(user_query: str) -> str:
    """
    사용자 문장을 TMDB 검색에 유효한 간단 키워드로 치환.
    여긴 아주 단순 예시로, '개봉' '볼만한' 등 빼고 '영화'만 남기거나,
    혹은 '최근 개봉' 정도만 유지.
    """
    # 예: "최근에 개봉한 영화 중에 볼만한 영화를 추천해줘."
    # -> "최근 개봉 영화"
    # 실제론 더 정교하게 처리 가능
    if not user_query.strip():
        return "영화"
    # 간단히:
    if "개봉" in user_query:
        return "최근 개봉 영화"
    return user_query  # fallback

def search_tmdb_and_create_cards(
    db: Session,
    user_query: str,
    rec_type: str = "movie"
):
    """
    1) TMDB 검색
    2) 결과를 rec_cards 테이블에 저장
    """
    tmdb_api_key = os.getenv("TMDB_API_KEY", "")  # 환경변수
    if not tmdb_api_key:
        print("TMDB_API_KEY not set!")
        return

    # TMDB /search/movie 예시
    # 문서: https://developers.themoviedb.org/3/search/search-movies
    keyword = extract_movie_keyword(user_query)

    if keyword == "최근 개봉 영화":
        now = dt.date.today()
        start_date = (now - dt.timedelta(days=30)).isoformat()  # 30일 전
        end_date   = now.isoformat()

        # GET /discover/movie?primary_release_date.gte=YYYY-MM-DD&primary_release_date.lte=YYYY-MM-DD
        params = {
            "api_key": tmdb_api_key,
            "language": "ko-KR",
            "region": "KR",                    # 한국 기준
            "with_release_type": "2|3",        # theatrical
            "sort_by": "release_date.desc",    # 로컬 릴리즈 날짜 기준 정렬
            "release_date.gte": start_date,    # 이 지역(kr)의 개봉일이 start_date ~ end_date
            "release_date.lte": end_date,
            "page": 1,
            "include_adult": "false"
        }
        url = "https://api.themoviedb.org/3/discover/movie"
    else:
        params = {
            "api_key": tmdb_api_key,
            "query": keyword,
            "language": "ko-KR",
            "page": 1,
            "include_adult": "false",
            "watch_region": "KR"
        }
        print(params)
        url = "https://api.themoviedb.org/3/search/movie"
    print("[TMDB] Request params:", params)
    resp = requests.get(url, params=params)
    if resp.status_code != 200:
        print(f"TMDB search error: {resp.text}")
        return

    data = resp.json()
    results = data.get("results", [])
    print("[TMDB] results:", results)
    print(results)
    if not results:
        return

    for i, r in enumerate(results):
        # ID, title, overview, release_date ...
        movie_title = r.get("title") or "(no title)"
        overview = r.get("overview") or ""
        movie_id = r.get("id")

        # TMDB 사이트 링크
        link = f"https://www.themoviedb.org/movie/{movie_id}"

        # RecCard 생성
        card_id = f"{rec_type}_{i}_{int(dt.datetime.utcnow().timestamp())}"
        new_card = models.RecCard(
            id       = card_id,
            type     = rec_type,
            title    = movie_title,
            subtitle = overview,
            url      = link,
            reason   = f"TMDB 검색: '{user_query}'",
            tags     = [rec_type, "tmdb_search"]
        )
        db.add(new_card)
    db.commit()

def filter_recent_content_with_llm(
        items: list[dict],
        user_query: str | None = None,
        content_type: str = "general",  # 'movie', 'news', 'learn', 'content' 등
        recency_days: int = 30  # 기본 30일, 조정 가능
) -> list[dict]:
    # 현재 날짜
    current_date = dt.datetime.now().strftime("%Y-%m-%d")
    
    # 컨텐츠 타입에 따른 특화 지침
    type_specific_instructions = {
        "movie": "영화 정보만 필터링하고, 개봉일, 감독, 배우 정보에 주목하세요.",
        "learn": "학습 자료, 튜토리얼, 강의 등 교육 관련 컨텐츠를 필터링하세요.",
        "content": "뉴스 기사, 블로그 포스트 등 일반 컨텐츠를 필터링하세요.",
        "general": "모든 종류의 컨텐츠를 필터링하되, 사용자 쿼리와의 관련성을 중점적으로 판단하세요."
    }
    
    # 1) 컨텐츠 타입과 사용자 쿼리에 맞는 프롬프트 구성
    system_prompt = (
        "You are a content filtering API that selects the most relevant and recent items.\n\n"
        f"Today's date: {current_date}\n\n"
        f"Content type: {content_type}\n"
        f"User query: \"{user_query or '(not specified)'}\"\n\n"
        "Task: From the provided search results, filter and keep only items that:\n"
        f"1. Were published within the last {recency_days} days\n"
        "2. Are highly relevant to the user's query\n"
        f"3. {type_specific_instructions.get(content_type, type_specific_instructions['general'])}\n\n"
        "For each item, carefully analyze:\n"
        "- Publication date (if available)\n"
        "- Title and snippet relevance to query\n"
        "- Quality and usefulness of the content\n"
        "- Source credibility (if determinable)\n\n"
        "Respond with valid JSON object:\n"
        '{"keep": [indices of items to keep], "confidence": [0-1 score for each kept item]}\n'
    )

    # 2) 페이로드 처리 - 날짜 정보 강화
    enhanced_items = []
    for idx, item in enumerate(items):
        snippet = item.get("snippet", "")[:200]  # 적절한 길이로 제한
        
        # 메타데이터 처리
        enhanced_item = {
            "idx": idx,
            "title": item.get("title", ""),
            "snippet": snippet,
            "link": item.get("link", ""),
            "raw_date": extract_date_from_metadata(item)  # 메타데이터에서 날짜 추출
        }
        enhanced_items.append(enhanced_item)

    # 3) Gemini 호출 - JSON 응답 모드 사용
    try:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0,
                max_output_tokens=512,
            ),
        )
        response = model.generate_content(
            json.dumps(
                {"query": user_query, "content_type": content_type, "results": enhanced_items},
                ensure_ascii=False,
            )
        )

        # 4) 결과 파싱 및 신뢰도 처리
        raw = json.loads(response.text)
        keep_idx = raw.get("keep", [])
        confidence_scores = raw.get("confidence", [1.0] * len(keep_idx))

        filtered_items = []
        for i, idx in enumerate(keep_idx):
            if idx >= 0 and idx < len(items) and (i >= len(confidence_scores) or confidence_scores[i] >= 0.6):
                filtered_items.append(items[idx])

        return filtered_items

    except Exception as e:
        print(f"LLM filtering error: {e}")
        return items[:5]

# 헬퍼 함수: 메타데이터에서 날짜 추출
def extract_date_from_metadata(item):
    # 날짜 정보가 있는 다양한 필드 확인
    for field in ["publishedDate", "date", "pubDate", "publishTime", "created"]:
        if field in item and item[field]:
            return item[field]
    
    # 스니펫이나 제목에서 날짜 패턴 찾기
    text = item.get("title", "") + " " + item.get("snippet", "")
    # 여기에 정규식 또는 날짜 추출 로직 구현
    
    return None

def search_cse_and_create_cards(
    db: Session,
    query: str,               # 실제 구글 검색에 쓸 문장 (사용자 입력)
    rec_type: str,
    client_tz: dt.tzinfo = None,
    user_query: str = ""      # LLM 필터에 '원본 질문'으로 넘길 문장
):
    """
    1) Google Custom Search (페이징 + 최대 50개, 최근 3개월)
    2) LLM 필터 -> '최근 개봉 영화'에 진짜 부합하는 항목만
    3) RecCard DB 생성
    """

    print(query)
    print(user_query)
    date_restrict = "m3"  # 최근 3개월
    sort_method   = "date"
    items = google_search_cse(
        query=user_query,    # ← 사용자가 입력한 문장 전체로 검색
        num=50,
        date_restrict=date_restrict,
        sort=sort_method
    )
    print(items)
    if not items:
        return

    # --- NEW ----------------------------------------------------
    # LLM에 넘길 때는 ‘다이어트’된 item만 사용
    slimmed = [slim_cse_item(it) for it in items]
    # token 폭발을 막기 위해 snippet 길이가 큰 뉴스류면 150자로 더 자르는 것도 OK
    # ------------------------------------------------------------

    # 2) LLM 필터
    chunks = [slimmed[i:i+8] for i in range(0, len(slimmed), 8)]  # 8개씩만
    final_items = []
    for chunk in chunks:
        partial_filtered = filter_recent_content_with_llm(chunk, user_query=user_query, content_type=rec_type)
        final_items.extend(partial_filtered)
    print(final_items)
    if not final_items:
        return

    # 3) RecCard DB 저장
    for i, it in enumerate(final_items):
        # 만약 it가 dict가 아니면 스킵
        if not isinstance(it, dict):
            continue
        
        title = it.get("title","(no title)")
        snippet = it.get("snippet","")
        link = it.get("link","")

        card_id = f"{rec_type}_{i}_{int(dt.datetime.utcnow().timestamp())}"
        new_card = models.RecCard(
            id       = card_id,
            type     = rec_type,
            title    = title,
            subtitle = snippet,
            url      = link,
            reason   = f"'{query}' -> LLM 필터 통과",
            tags     = [rec_type, "google_cse", "recent"]
        )
        db.add(new_card)
    db.commit()

@router.get("/")
def get_recommendations(
    types: Optional[str] = Query(None, description="예: content,learn,movie"),
    limit: int = Query(5, description="결과 최대 개수"),
    tz: Optional[str] = Query(None),
    user_query: Optional[str] = Query(None, description="사용자 질문(예: 최근에 개봉한 영화 중에 볼만한거.. )"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token),
):
    """
    GET /recommend?types=content,learn,movie&user_query=...
      - movie일 땐 TMDB 검색 / 그 외는 기존 구글CSE+ChatGPT
      - 결과 중복제거 후 limit개 반환
    """

    # 1) tzinfo
    if tz:
        try:
            client_tz = ZoneInfo(tz)
        except Exception:
            client_tz = dt.timezone.utc
    else:
        client_tz = dt.timezone.utc

    # 2) 파라미터 처리
    type_list = []
    if types:
        type_list = [t.strip() for t in types.split(",") if t.strip()]
    print(type_list)

    # 3) 만약 "movie"가 포함되어 있으면 -> TMDB 검색
    #    (만약 "movie" 외 다른 것도 있으면? -> 여기서는 우선 movie 우선)
    if "movie" in type_list:
        search_txt = user_query if user_query else "최근 개봉한 영화"
        # TMDB 검색으로 rec_cards 추가
        search_tmdb_and_create_cards(
            db=db,
            user_query=search_txt,
            rec_type="movie"
        )

    # 4) 남아있는 type_list (content, learn 등) -> 구글+ChatGPT
    #    예) "content, movie"면 위에서 "movie" 처리 -> 남은건 "content"
    elif type_list:
        # 하나 이상 남았다면 -> ex) "content"
        # 만약 여러개(learn, wellness...)라면 -> 구글+ChatGPT 처리
        for t in type_list:
            # ex) user_query="백엔드 학습자료"
            #    search_cse_and_create_cards(..., rec_type=t)
            search_txt = user_query if user_query else t
            search_cse_and_create_cards(
                db=db,
                query=search_txt,
                rec_type=t,
                client_tz=client_tz,
                user_query=search_txt
            )
            break

    # 5) DB에서 최종 후보 쿼리 (movie, content, etc)
    q = db.query(models.RecCard)
    # 만약 types==None, or types=="movie" only -> we've inserted "movie" cards
    # 만약 types=="content,movie", etc
    # -> we call "in_" for the original types
    all_types = [t.strip() for t in (types or "").split(",") if t.strip()]
    if all_types:
        q = q.filter(models.RecCard.type.in_(all_types))

    # 최신순 20개
    candidates = q.order_by(models.RecCard.created_at.desc()).limit(20).all()
    if not candidates:
        return []

    # ==== 1) 개인화 스코어 계산 ========================================
    fb = recent_feedback_summaries(db, current_user, 50)
    like_ids    = {x["id"] for x in fb["likes"]}
    dislike_ids = {x["id"] for x in fb["dislikes"]}

    tag_weights = { t.tag: t.weight for t in current_user.pref_tags }

    def score(card:models.RecCard)->float:
        # 기본 = 최신일수록 +0.01 (timestamp)
        s = card.created_at.timestamp()*1e-13               # 0~1 범위 조정
        # 장르 점수
        for g in card.tags:
            s += tag_weights.get(g,0)*0.5
        # 피드백 반영
        if card.id   in like_ids:    s += 3
        if card.id   in dislike_ids: s -= 3
        return s

    # ==== 2) 스코어로 소트 후 중복제거 =================================
    result = []
    seen_titles = set()
    count = 0
    for c in sorted(candidates, key=score, reverse=True):
        if c.title not in seen_titles:
            # feedback_logs 찾아본다
            fb = db.query(models.FeedbackLog).filter_by(
                user_id = current_user.id,
                category="recommend",
                reference_id=f"card_id={c.id}"   # or just c.id
            ).first()

            feedback_info = None
            if fb:
                feedback_info = {
                    "feedback_id": fb.id,
                    "feedback_score": fb.feedback_score,
                    "feedback_label": fb.feedback_label,
                    "details": fb.details
                }

            result.append({
                "card_id": c.id,
                "type": c.type,
                "title": c.title,
                "subtitle": c.subtitle,
                "link": c.url,
                "reason": c.reason,
                "feedback": feedback_info
            })
            seen_titles.add(c.title)
            count += 1
            if count >= limit:
                break

    return result


@router.post("/feedback")
def post_feedback(
    card_id: str,
    action: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_token)
):
    """
    POST /recommend/feedback
    - { card_id, action }을 받아 rec_impressions 테이블에 기록
    - action: "clicked"/"accepted"/"dismissed" 등
    """
    # 카드 존재하는지 체크 (생략 가능)
    card = db.query(models.RecCard).filter_by(id=card_id).first()
    if not card:
        raise HTTPException(404, detail="Card not found")

    imp = models.RecImpression(
        user_id=current_user.id,
        card_id=card_id,
        action=action
    )
    db.add(imp)
    db.commit()
    return {"message": f"Feedback logged: {card_id} -> {action}"}


@router.get("/models")
def get_models():
    """
    GET /recommend/models
    - 현재 사용 중인 추천 모델들(또는 버전 정보) 간단히 반환
    """
    # 실제로는 DB 또는 config 에서 읽어올 수 있음
    return {
        "candidate_model": "basic_sql_filter_v1",
        "rerank_model": "gemini-2.0-flash",
        "version": "2025-04-01"
    }
