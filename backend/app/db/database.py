from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

# MySQL 연결 엔진 (pymysql 드라이버)
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,   # 연결 유효성 사전 확인 (DB 재시작 시 자동 복구)
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,    # MySQL 8h 기본 타임아웃 대응
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 모든 ORM 모델의 공통 Base
Base = declarative_base()
