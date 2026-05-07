import logging

from pydantic import model_validator
from pydantic_settings import BaseSettings

_cfg_logger = logging.getLogger(__name__)

_DEFAULT_SECRET = "change-this-secret-key-in-production"


class Settings(BaseSettings):
    # ── JWT ───────────────────────────────────────────────────────────────────
    SECRET_KEY: str = _DEFAULT_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24시간

    # ── DB ────────────────────────────────────────────────────────────────────
    # 로컬: mysql+pymysql://user:pw@127.0.0.1:3306/dbname  (Auth Proxy 사용)
    # Cloud Run: /cloudsql/project:region:instance
    DATABASE_URL: str = "mysql+pymysql://skema:skemapassword@127.0.0.1:3306/skema_db"
    DB_USER: str = "skema"
    DB_PASSWORD: str = "skemapassword"
    DB_NAME: str = "skema_db"

    # ── AI ────────────────────────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    GOOGLE_CLOUD_VISION_API_KEY: str = ""

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
    # 쉼표로 구분된 관리자 이메일 목록
    ADMIN_EMAILS: str = ""

    # ── 백엔드 공개 URL (OAuth redirect_uri 등) ───────────────────────────────
    # 로컬: http://localhost:8000  / 배포: https://api.yourdomain.com
    BACKEND_URL: str = "http://localhost:8000"

    # ── Web Push (PWA 푸시 알림) ──────────────────────────────────────────────
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@example.com"

    model_config = {"env_file": ".env", "extra": "ignore"}

    @model_validator(mode="after")
    def _warn_insecure_defaults(self):
        if self.SECRET_KEY == _DEFAULT_SECRET:
            _cfg_logger.critical(
                "SECRET_KEY is set to the insecure default value. "
                "Set SECRET_KEY in your .env file before deploying to production."
            )
        if "skemapassword" in self.DATABASE_URL:
            _cfg_logger.warning(
                "DATABASE_URL contains the default password 'skemapassword'. "
                "Update your .env file for production use."
            )
        return self


settings = Settings()
