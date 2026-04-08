# utils/cse_slim.py
def slim_cse_item(item: dict, max_snippet_len: int = 300) -> dict:
    """
    구글 CSE result 중 LLM 필터에 꼭 필요한 최소한만 남긴다.
    - title / snippet / link (+ optional published_time)
    - snippet은 너무 길면 잘라낸다.
    """
    meta = (item.get("pagemap", {})
                 .get("metatags", [{}])[0])
    published = (
        meta.get("article:published_time")
        or meta.get("og:pubdate")
        or meta.get("og:published_time")
        or ""
    )

    return {
        "title":   item.get("title", "")[:120],
        "snippet": (item.get("snippet") or "")[:max_snippet_len],
        "link":    item.get("link", ""),
        "date":    published[:10]        # YYYY-MM-DD
    }
