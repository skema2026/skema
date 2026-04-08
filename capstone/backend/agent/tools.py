# backend/agent/tools.py

import os, json, datetime as dt, base64, io
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from PIL import Image
import google.generativeai as genai

# 필요한 모델 및 헬퍼 함수 임포트
import models
from routers.gcal import build_gcal_service
from routers.search import google_search_cse
from .mcp_loader import load_mcp_tools

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Pydantic 스키마
class CreateEventArgs(BaseModel):
    title: str  = Field(..., description="일정 제목")
    start: str  = Field(..., description="ISO-8601 시작")
    end:   str  = Field(..., description="ISO-8601 종료")
class DeleteEventArgs(BaseModel):
    event_id: str
class WebSearchArgs(BaseModel):
    query: str
    k: int = 5
class GenImgArgs(BaseModel):
    prompt: str = Field(..., description="이미지 생성 프롬프트")
class RecArgs(BaseModel):
    types: str
    limit: int = 5
class ExtractTitleArgs(BaseModel):
    text_to_process: str = Field(..., description="The raw text from a previous search/recommendation step.")


def _bytes_to_b64_pair(img_bytes: bytes, thumb_size=(128, 128)) -> tuple[str, str]:
    """bytes → (원본 WebP base64, 썸네일 WebP base64)"""
    im = Image.open(io.BytesIO(img_bytes))
    im.thumbnail((512, 512), Image.Resampling.LANCZOS)

    full_io = io.BytesIO()
    im.save(full_io, format="WEBP", quality=90)
    original_b64 = base64.b64encode(full_io.getvalue()).decode()

    im_thumb = im.copy()
    im_thumb.thumbnail(thumb_size, Image.Resampling.LANCZOS)
    thumb_io = io.BytesIO()
    im_thumb.save(thumb_io, format="WEBP", quality=80)
    thumb_b64 = base64.b64encode(thumb_io.getvalue()).decode()

    return original_b64, thumb_b64


# 도구 세트 생성 함수
def make_toolset(db: Session, user: models.User, tz: ZoneInfo, llm_instance: ChatGoogleGenerativeAI):

    @tool(args_schema=CreateEventArgs, return_direct=True)
    def create_event(title: str, start: str, end: str) -> str:
        """Google Calendar 일정 생성. 사용자가 일정, 미팅, 약속 등을 잡아달라고 할 때 항상 사용하세요.

        title: 일정 제목 (예: "팀 회의", "점심 약속")
        start: ISO-8601 시작 시간 (예: "2025-05-26T13:00:00+02:00")
        end: ISO-8601 종료 시간 (예: "2025-05-26T14:00:00+02:00")

        일정 생성은 항상 미래 시간에만 가능합니다.
        """
        print("---------------------------------------")
        print("create_event 호출됨!")
        print(f"매개변수: title={title}, start={start}, end={end}")
        print("---------------------------------------")
        try:
            try:
                dt_start = dt.datetime.fromisoformat(start)
                dt_end = dt.datetime.fromisoformat(end)
            except ValueError as e:
                return f"❗ 날짜 형식이 올바르지 않습니다: {e}"

            if dt_start.tzinfo is None:
                dt_start = dt_start.replace(tzinfo=tz)
            if dt_end.tzinfo is None:
                dt_end = dt_end.replace(tzinfo=tz)

            now = dt.datetime.now(tz)

            if dt_start < now - dt.timedelta(minutes=10):
                return f"❗ 과거 시간({dt_start.strftime('%Y-%m-%d %H:%M')})에는 일정을 추가할 수 없습니다. 현재 시간은 {now.strftime('%Y-%m-%d %H:%M')}입니다."

            svc = build_gcal_service(db, user.id)
            ev = svc.events().insert(
                calendarId="primary",
                body={
                    "summary": title,
                    "start": {"dateTime": dt_start.isoformat(), "timeZone": str(tz)},
                    "end": {"dateTime": dt_end.isoformat(), "timeZone": str(tz)},
                },
            ).execute()

            result = f"✅ 일정 생성 완료 → {dt_start.strftime('%Y-%m-%d %H:%M')} ~ {dt_end.strftime('%H:%M')} {ev.get('htmlLink')}"
            print(result)
            return result
        except Exception as e:
            return f"❗ 일정 생성 중 오류가 발생했습니다: {str(e)}"

    @tool(args_schema=DeleteEventArgs, return_direct=True)
    def delete_event(event_id: str) -> str:
        """event_id 로 Google Calendar 이벤트를 삭제한다."""
        svc = build_gcal_service(db, user.id)
        svc.events().delete(calendarId="primary", eventId=event_id).execute()
        return "🗑️ 일정이 삭제되었습니다."

    @tool(args_schema=WebSearchArgs)
    def web_search(query: str, k: int = 5) -> str:
        """Google CSE 로 웹을 검색하고 상위 k개 링크를 돌려준다."""
        items = google_search_cse(query=query, num=k, date_restrict="m6", sort="date")
        return "\n".join(f"{it['title']} – {it['link']}" for it in items) or "No results"

    @tool(args_schema=GenImgArgs, return_direct=True)
    def generate_image(prompt: str) -> str:
        """Imagen 3 로 이미지를 생성해 base64 JSON 을 돌려준다."""
        try:
            imagen = genai.ImageGenerationModel("imagen-3.0-generate-002")
            result = imagen.generate_images(
                prompt=prompt,
                number_of_images=1,
                safety_filter_level="block_only_high",
                person_generation="allow_adult",
            )
            if not result.images:
                return json.dumps({"error": "이미지 생성 실패: 결과 없음"}, ensure_ascii=False)

            img_bytes = result.images[0]._image_bytes
            orig_b64, thumb_b64 = _bytes_to_b64_pair(img_bytes)
            return json.dumps({
                "prompt": prompt,
                "original_b64": orig_b64,
                "thumb_b64": thumb_b64,
            }, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"error": f"이미지 생성 실패: {e}"}, ensure_ascii=False)

    @tool(args_schema=RecArgs, return_direct=True)
    def fetch_recommendations(types: str, limit: int = 5) -> str:
        """
        ONLY USE THIS TOOL when the user EXPLICITLY asks for content recommendations or suggestions.

        APPROPRIATE USES:
        - User asks "뭐 볼까?" (What should I watch?)
        - User says "영화 추천해줘" (Recommend me a movie)
        - User asks for options or suggestions for content to consume

        DO NOT USE FOR:
        - Technical questions like "React란 무엇인가?"
        - Factual information queries like "TypeScript의 장점은?"
        - General knowledge or explanations

        This tool returns personalized content recommendation cards as JSON.
        """
        from routers.recommend import get_recommendations
        recs = get_recommendations(
            types=types, limit=limit, db=db, current_user=user, tz=tz, user_query=""
        )
        return json.dumps({"cards": recs}, ensure_ascii=False)

    @tool(args_schema=ExtractTitleArgs)
    def extract_best_title(text_to_process: str) -> str:
        """
        Processes raw text from search or recommendation results to extract the single most relevant item title for a calendar event.
        Use this to clean up the output of a search before creating a calendar event.
        """
        prompt = ChatPromptTemplate.from_template(
            "From the following search results, extract the single most relevant movie or event title. "
            "Return ONLY the title itself, with no extra words, explanations, or quotes.\n\n"
            "SEARCH RESULTS:\n{text}\n\n"
            "TITLE:"
        )

        chain = prompt | llm_instance

        try:
            response = chain.invoke({"text": text_to_process})
            extracted_title = response.content.strip().strip('"')
            print(f"      - Extracted Title: '{extracted_title}'")
            return extracted_title
        except Exception as e:
            print(f"      - Title extraction failed: {e}")
            return "선택된 항목"

    base_tools = [
        create_event,
        delete_event,
        web_search,
        generate_image,
        fetch_recommendations,
        extract_best_title,
    ]

    # MCP 로드 (실패해도 base_tools 그대로)
    mcp_tools = load_mcp_tools(host=os.getenv("MCP_HOST", "mcp-weather"),
                               port=int(os.getenv("MCP_PORT", "7001")))
    return base_tools + mcp_tools
