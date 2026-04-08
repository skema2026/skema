# utils/personalization.py
import json, models
from sqlalchemy.orm import Session

def recent_feedback_summaries(db: Session, user: models.User, limit: int = 20):
    """
    최근 feedback N개를 {likes:[…], dislikes:[…]} 구조로 요약
    - 추천카드 → {id,title,tags}
    - 메시지   → {id,snippet}
    """
    rows = (db.query(models.FeedbackLog)
              .filter(models.FeedbackLog.user_id == user.id,
                      models.FeedbackLog.feedback_label.in_(("like", "dislike")))
              .order_by(models.FeedbackLog.created_at.desc())
              .limit(limit))

    fb = {"likes": [], "dislikes": []}

    for r in rows:
        bucket = "likes" if r.feedback_label == "like" else "dislikes"

        # (1) 추천카드
        if r.category == "recommend" and r.reference_id.startswith("card_id="):
            cid = r.reference_id.split("=")[1]
            card = db.query(models.RecCard).filter_by(id=cid).first()
            if card:
                fb[bucket].append({
                    "id": card.id,
                    "title": card.title,
                    "tags": card.tags[:5]
                })

        # (2) 메시지
        elif r.category == "chat" and r.reference_id.startswith("message_"):
            mid = int(r.reference_id.split("_")[1])
            msg = db.query(models.Message).filter_by(id=mid).first()
            if msg:
                fb[bucket].append({
                    "id": msg.id,
                    "snippet": msg.content[:50]
                })

    return fb

def make_persona_prompt(persona: dict) -> str:
    """
    persona(dict) → 자연어 요약 + RAW JSON 문자열
    """
    liked_genres = ", ".join(
        [g for g, s in persona.get("genres", {}).items() if s >= 4][:3] or ["특정 없음"]
    )
    top_tags = ", ".join(t["tag"] for t in persona.get("tags", [])[:3]) or "없음"

    plain = (
        f"※ 이 사용자는 주로 {liked_genres} 장르를 즐기며 "
        f"{top_tags} 주제에도 관심이 많습니다.\n"
        "최근 좋아요를 누른 카드/메시지를 우선 활용하고, "
        "싫어요를 누른 것은 피하세요.\n"
    )
    return plain + "PERSONA_JSON=" + json.dumps(persona, ensure_ascii=False)
