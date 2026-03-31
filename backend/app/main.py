from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.database import Base, engine

# Import models to register them with SQLAlchemy BEFORE create_all
import app.models.user      # noqa: F401
import app.models.schedule  # noqa: F401

# Create new tables (won't touch existing ones)
Base.metadata.create_all(bind=engine)


def _migrate():
    """Add new columns to existing tables without dropping data."""
    insp = inspect(engine)

    # users table migrations
    user_cols = {c["name"] for c in insp.get_columns("users")}
    user_migrations = []
    if "social_provider" not in user_cols:
        user_migrations.append("ALTER TABLE users ADD COLUMN social_provider TEXT")
    if "social_id" not in user_cols:
        user_migrations.append("ALTER TABLE users ADD COLUMN social_id TEXT")
    if user_migrations:
        with engine.connect() as conn:
            for stmt in user_migrations:
                conn.execute(text(stmt))
            conn.commit()

    # user_profiles table migrations
    if "user_profiles" in insp.get_table_names():
        profile_cols = {c["name"] for c in insp.get_columns("user_profiles")}
        profile_migrations = []
        if "user_type" not in profile_cols:
            profile_migrations.append("ALTER TABLE user_profiles ADD COLUMN user_type TEXT")
        if "goal_tasks" not in profile_cols:
            profile_migrations.append("ALTER TABLE user_profiles ADD COLUMN goal_tasks TEXT")
        if profile_migrations:
            with engine.connect() as conn:
                for stmt in profile_migrations:
                    conn.execute(text(stmt))
                conn.commit()

    schedule_cols = {c["name"] for c in insp.get_columns("schedules")}
    migrations = []
    if "date" not in schedule_cols:
        migrations.append("ALTER TABLE schedules ADD COLUMN date TEXT")
    if "priority" not in schedule_cols:
        migrations.append("ALTER TABLE schedules ADD COLUMN priority INTEGER DEFAULT 0")
    if "is_completed" not in schedule_cols:
        migrations.append("ALTER TABLE schedules ADD COLUMN is_completed BOOLEAN DEFAULT 0")
    if "schedule_type" not in schedule_cols:
        migrations.append("ALTER TABLE schedules ADD COLUMN schedule_type TEXT DEFAULT 'class'")

    if migrations:
        with engine.connect() as conn:
            for stmt in migrations:
                conn.execute(text(stmt))
            conn.commit()


_migrate()


def _seed_admin():
    """관리자 계정이 없으면 자동 생성한다."""
    from app.database import SessionLocal
    from app.models.user import User
    from app.services.auth import hash_password

    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            admin = User(
                username="admin",
                email="admin@timetable.local",
                hashed_password=hash_password("1234"),
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


_seed_admin()

from app.routers import ai, auth, exams, profile, schedules, share  # noqa: E402

app = FastAPI(
    title="AI Timetable API",
    description="AI-powered timetable management system",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(schedules.router)
app.include_router(share.router)
app.include_router(ai.router)
app.include_router(profile.router)
app.include_router(exams.router)


@app.get("/")
def root():
    return {"message": "AI Timetable API is running", "docs": "/docs"}
