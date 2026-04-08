"""
DB 초기화 스크립트.
기존 timetable.db를 신규 스키마로 재생성합니다.
(개발 환경 전용 – 기존 데이터가 사라집니다)

실행:
    .venv\Scripts\python.exe init_db.py   (Windows)
    .venv/bin/python init_db.py           (Mac/Linux)
"""
import sys
import os

# backend 디렉터리를 sys.path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.database import engine, Base
import app.db.base  # noqa: F401 – 모든 모델 등록

print("⚠  기존 DB 테이블을 삭제하고 새 스키마로 재생성합니다...")
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
print("✅ DB 초기화 완료!")
print("   → 이제 uvicorn 서버를 시작하세요.")
