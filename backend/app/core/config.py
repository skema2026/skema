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
    GEMINI_MODEL: str = "gemini-2.5-flash"
    OPENAI_API_KEY: str = ""

    # ── OAuth ─────────────────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""
    KAKAO_CLIENT_ID: str = ""
    KAKAO_CLIENT_SECRET: str = ""

    # ── 프론트엔드 ─────────────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"

    # ── CORS (배포) ────────────────────────────────────────────────────────────
    # 쉼표로 구분한 브라우저 출처. 비우면 로컬 개발용 기본 출처만 사용.
    # 예: https://your-app.vercel.app,https://www.example.com
    CORS_ORIGINS: str = ""

    model_config = {"env_file": ".env"}


settings = Settings()
