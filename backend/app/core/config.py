import logging
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings

_cfg_logger = logging.getLogger(__name__)

_DEFAULT_SECRET = "change-this-secret-key-in-production"
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


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
    OPENAI_API_KEY: str = ""

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

    # ── Uploads ───────────────────────────────────────────────────────────────
    # Docker/Railway: /app/uploads, local: backend/uploads
    UPLOAD_DIR: str = str(_BACKEND_ROOT / "uploads")

    # ── 영상 저장소 ───────────────────────────────────────────────────────────
    # local: UPLOAD_DIR 폴더에 저장하고 /uploads 로 공개 (로컬 개발 기본값)
    # r2   : Cloudflare R2 비공개 버킷에 저장하고, 응답마다 서명 주소(기본 1시간)를 만들어 준다
    STORAGE: str = "local"
    R2_ENDPOINT_URL: str = ""  # https://<계정ID>.r2.cloudflarestorage.com
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET: str = ""
    R2_URL_EXPIRES_SECONDS: int = 3600

    model_config = {"env_file": ".env", "extra": "ignore"}

    @model_validator(mode="after")
    def _check_storage(self):
        self.STORAGE = self.STORAGE.strip().lower()
        if self.STORAGE not in ("local", "r2"):
            raise ValueError(f"STORAGE 는 'local' 또는 'r2' 여야 합니다. (현재: {self.STORAGE!r})")
        if self.STORAGE == "r2":
            missing = [
                name
                for name in ("R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
                if not getattr(self, name)
            ]
            if missing:
                # 설정이 빠진 채로 뜨면 업로드가 조용히 로컬 디스크로 가거나 나중에 터진다. 시작할 때 막는다.
                raise ValueError(f"STORAGE=r2 인데 다음 환경변수가 비어 있습니다: {', '.join(missing)}")
        return self

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
