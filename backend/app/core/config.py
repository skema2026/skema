from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── JWT ───────────────────────────────────────────────────────────────────
    SECRET_KEY: str = "change-this-secret-key-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24시간

    # ── DB ────────────────────────────────────────────────────────────────────
    DATABASE_URL: str = "mysql+pymysql://skema:skemapassword@localhost:3306/skema_db"

    # ── AI ────────────────────────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""

    # ── OAuth ─────────────────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""
    KAKAO_CLIENT_ID: str = ""
    KAKAO_CLIENT_SECRET: str = ""

    # ── 프론트엔드 / CORS ──────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"
    # 쉼표로 구분된 허용 Origin 목록 (비어있으면 FRONTEND_URL 단독 사용)
    CORS_ORIGINS: str = ""

    # ── 백엔드 공개 URL (OAuth redirect_uri 등) ───────────────────────────────
    # 로컬: http://localhost:8000  / 배포: https://api.yourdomain.com
    BACKEND_URL: str = "http://localhost:8000"

    model_config = {"env_file": ".env"}


settings = Settings()
