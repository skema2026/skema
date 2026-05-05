from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

_url = settings.DATABASE_URL

# Cloud Run 환경: DATABASE_URL이 /cloudsql/... 이면 Unix 소켓으로 연결
if _url.startswith("/cloudsql/"):
    engine = create_engine(
        f"mysql+pymysql://{settings.DB_USER}:{settings.DB_PASSWORD}@/{settings.DB_NAME}",
        connect_args={"unix_socket": _url},
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
    )
else:
    # 로컬 개발: Auth Proxy 또는 직접 연결
    engine = create_engine(
        _url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=3600,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
