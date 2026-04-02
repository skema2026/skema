"""
Alembic 마이그레이션 환경 설정.
- DATABASE_URL은 app/core/config.py의 Settings에서 읽어옴
- autogenerate를 위해 app/db/base.py를 import해 모든 모델을 등록
"""
import sys
import os

# 프로젝트 루트(backend/)를 sys.path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
import app.db.base  # noqa: F401 — 모든 모델 metadata 등록
from app.db.database import Base

# Alembic Config 객체
config = context.config

# .ini 파일의 로깅 설정 적용
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate 대상 metadata
target_metadata = Base.metadata

# settings에서 실제 DB URL 덮어쓰기
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)


def run_migrations_offline() -> None:
    """오프라인 모드: DB 연결 없이 SQL 스크립트만 생성."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """온라인 모드: 실제 DB에 연결해 마이그레이션 실행."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,        # 컬럼 타입 변경도 감지
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
