"""
Direct SQLite migration — no venv needed.
Uses Python's built-in sqlite3 module only.

Run from backend/ directory:
    python migrate_db.py

This script safely applies the schema changes needed for the AI agent to work.
It preserves existing data.
"""
import sqlite3
import os
import shutil
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "timetable.db")


def get_columns(cursor, table: str) -> list[str]:
    cursor.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cursor.fetchall()]


def migrate(db_path: str) -> None:
    if not os.path.exists(db_path):
        print(f"[WARN] DB not found at {db_path}")
        print("   → Running create_tables instead…")
        create_all_tables(db_path)
        return

    # Backup
    backup = db_path + f".bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(db_path, backup)
    print(f"[BACKUP] Backup created: {backup}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")
    cur = conn.cursor()

    # ── schedules table ───────────────────────────────────────────────────────
    existing = get_columns(cur, "schedules")
    print(f"Current schedules columns: {existing}")

    needs_rebuild = ("course_name" in existing) or ("color_code" in existing)

    if needs_rebuild:
        print("[REBUILD] Rebuilding schedules table…")

        # Add transition columns if not already there
        for col, coldef in [
            ("title", "TEXT"),
            ("date", "TEXT"),
            ("color", "TEXT DEFAULT '#6366F1'"),
            ("priority", "INTEGER DEFAULT 0"),
            ("is_completed", "INTEGER DEFAULT 0"),
            ("schedule_type", "TEXT DEFAULT 'class'"),
            ("day_of_week_int", "INTEGER DEFAULT 0"),
        ]:
            if col not in existing:
                try:
                    cur.execute(f"ALTER TABLE schedules ADD COLUMN {col} {coldef}")
                    print(f"  + Added column: {col}")
                except Exception as e:
                    print(f"  ! Skip {col}: {e}")

        # Populate new columns
        if "course_name" in existing:
            cur.execute("UPDATE schedules SET title = course_name WHERE title IS NULL OR title = ''")

        if "color_code" in existing:
            cur.execute(
                "UPDATE schedules SET color = COALESCE(color_code, '#6366F1') WHERE color IS NULL OR color = ''"
            )

        cur.execute("UPDATE schedules SET priority = 0 WHERE priority IS NULL")
        cur.execute("UPDATE schedules SET is_completed = 0 WHERE is_completed IS NULL")
        cur.execute("UPDATE schedules SET schedule_type = 'class' WHERE schedule_type IS NULL")

        # Convert day_of_week enum → int
        if "day_of_week" in existing:
            cur.execute("""
                UPDATE schedules SET day_of_week_int = CASE day_of_week
                    WHEN 'MON' THEN 0  WHEN 'TUE' THEN 1  WHEN 'WED' THEN 2
                    WHEN 'THU' THEN 3  WHEN 'FRI' THEN 4  WHEN 'SAT' THEN 5
                    WHEN 'SUN' THEN 6  ELSE CAST(day_of_week AS INTEGER)
                END
            """)

        # Create new table
        cur.execute("DROP TABLE IF EXISTS schedules_v2")
        cur.execute("""
            CREATE TABLE schedules_v2 (
                id            INTEGER PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title         TEXT NOT NULL,
                professor     TEXT,
                location      TEXT,
                day_of_week   INTEGER NOT NULL DEFAULT 0,
                date          TEXT,
                start_time    TEXT NOT NULL,
                end_time      TEXT NOT NULL,
                color         TEXT DEFAULT '#6366F1',
                priority      INTEGER DEFAULT 0,
                is_completed  INTEGER DEFAULT 0,
                schedule_type TEXT DEFAULT 'class'
            )
        """)

        cur.execute("""
            INSERT INTO schedules_v2
                (id, user_id, title, professor, location, day_of_week, date,
                 start_time, end_time, color, priority, is_completed, schedule_type)
            SELECT
                id, user_id,
                COALESCE(title, course_name, 'Untitled'),
                professor, location,
                COALESCE(day_of_week_int, 0),
                date, start_time, end_time,
                COALESCE(color, color_code, '#6366F1'),
                COALESCE(priority, 0),
                COALESCE(is_completed, 0),
                COALESCE(schedule_type, 'class')
            FROM schedules
        """)

        cur.execute("DROP TABLE schedules")
        cur.execute("ALTER TABLE schedules_v2 RENAME TO schedules")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_schedules_id ON schedules (id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_schedules_user_id ON schedules (user_id)")
        print("  [OK] schedules table rebuilt")

    else:
        print("  → schedules already migrated, checking for missing columns…")
        for col, coldef in [
            ("date", "TEXT"),
            ("priority", "INTEGER DEFAULT 0"),
            ("is_completed", "INTEGER DEFAULT 0"),
            ("schedule_type", "TEXT DEFAULT 'class'"),
            ("color", "TEXT DEFAULT '#6366F1'"),
        ]:
            if col not in existing:
                cur.execute(f"ALTER TABLE schedules ADD COLUMN {col} {coldef}")
                print(f"  + Added: {col}")

    # ── exam_schedules: add subject ───────────────────────────────────────────
    exam_cols = get_columns(cur, "exam_schedules")
    if "subject" not in exam_cols:
        cur.execute("ALTER TABLE exam_schedules ADD COLUMN subject TEXT")
        print("  + Added: exam_schedules.subject")

    # ── user_profiles: add user_type, occupation, goal_tasks ─────────────────
    profile_cols = get_columns(cur, "user_profiles")
    for col in ["user_type", "occupation", "goal_tasks"]:
        if col not in profile_cols:
            cur.execute(f"ALTER TABLE user_profiles ADD COLUMN {col} TEXT")
            print(f"  + Added: user_profiles.{col}")

    # ── ai_chat_logs: create if missing ──────────────────────────────────────
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_chat_logs'")
    if not cur.fetchone():
        cur.execute("""
            CREATE TABLE ai_chat_logs (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role       TEXT NOT NULL,
                message    TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cur.execute("CREATE INDEX ix_ai_chat_logs_id ON ai_chat_logs (id)")
        cur.execute("CREATE INDEX ix_ai_chat_logs_user_id ON ai_chat_logs (user_id)")
        print("  + Created table: ai_chat_logs")

    # ── share_tokens: create if missing ──────────────────────────────────────
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='share_tokens'")
    if not cur.fetchone():
        cur.execute("""
            CREATE TABLE share_tokens (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token      TEXT UNIQUE NOT NULL,
                expires_at TEXT,
                is_active  INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cur.execute("CREATE INDEX ix_share_tokens_id ON share_tokens (id)")
        cur.execute("CREATE INDEX ix_share_tokens_user_id ON share_tokens (user_id)")
        cur.execute("CREATE UNIQUE INDEX ix_share_tokens_token ON share_tokens (token)")
        print("  + Created table: share_tokens")

    # ── users: add is_active, created_at if missing ───────────────────────────
    user_cols = get_columns(cur, "users")
    if "is_active" not in user_cols:
        cur.execute("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1")
        cur.execute("UPDATE users SET is_active = 1 WHERE is_active IS NULL")
        print("  + Added: users.is_active")
    if "created_at" not in user_cols:
        cur.execute("ALTER TABLE users ADD COLUMN created_at TEXT")
        cur.execute("UPDATE users SET created_at = datetime('now') WHERE created_at IS NULL")
        print("  + Added: users.created_at")

    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")
    conn.close()
    print("\n[OK] Migration complete!")


def create_all_tables(db_path: str) -> None:
    """Fresh DB creation with full new schema."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id               INTEGER PRIMARY KEY,
            email            TEXT UNIQUE NOT NULL,
            hashed_password  TEXT,
            is_active        INTEGER NOT NULL DEFAULT 1,
            social_provider  TEXT,
            social_id        TEXT,
            created_at       TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS ix_users_id    ON users (id);
        CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);

        CREATE TABLE IF NOT EXISTS user_profiles (
            id                   INTEGER PRIMARY KEY,
            user_id              INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            nickname             TEXT,
            avatar_url           TEXT,
            department           TEXT,
            semester             INTEGER,
            user_type            TEXT,
            occupation           TEXT,
            goal_tasks           TEXT,
            sleep_start          TEXT DEFAULT '23:00',
            sleep_end            TEXT DEFAULT '07:00',
            onboarding_completed INTEGER NOT NULL DEFAULT 0,
            updated_at           TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS schedules (
            id            INTEGER PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title         TEXT NOT NULL,
            professor     TEXT,
            location      TEXT,
            day_of_week   INTEGER NOT NULL DEFAULT 0,
            date          TEXT,
            start_time    TEXT NOT NULL,
            end_time      TEXT NOT NULL,
            color         TEXT DEFAULT '#6366F1',
            priority      INTEGER DEFAULT 0,
            is_completed  INTEGER DEFAULT 0,
            schedule_type TEXT DEFAULT 'class'
        );

        CREATE INDEX IF NOT EXISTS ix_schedules_id      ON schedules (id);
        CREATE INDEX IF NOT EXISTS ix_schedules_user_id ON schedules (user_id);

        CREATE TABLE IF NOT EXISTS exam_schedules (
            id          INTEGER PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
            title       TEXT NOT NULL,
            subject     TEXT,
            exam_date   TEXT NOT NULL,
            start_time  TEXT,
            end_time    TEXT,
            location    TEXT,
            memo        TEXT
        );

        CREATE INDEX IF NOT EXISTS ix_exam_schedules_id          ON exam_schedules (id);
        CREATE INDEX IF NOT EXISTS ix_exam_schedules_user_id     ON exam_schedules (user_id);
        CREATE INDEX IF NOT EXISTS ix_exam_schedules_schedule_id ON exam_schedules (schedule_id);

        CREATE TABLE IF NOT EXISTS share_tokens (
            id         INTEGER PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT UNIQUE NOT NULL,
            expires_at TEXT,
            is_active  INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS ix_share_tokens_id      ON share_tokens (id);
        CREATE INDEX IF NOT EXISTS ix_share_tokens_user_id ON share_tokens (user_id);
        CREATE INDEX IF NOT EXISTS ix_share_tokens_token   ON share_tokens (token);

        CREATE TABLE IF NOT EXISTS ai_chat_logs (
            id         INTEGER PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role       TEXT NOT NULL,
            message    TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS ix_ai_chat_logs_id      ON ai_chat_logs (id);
        CREATE INDEX IF NOT EXISTS ix_ai_chat_logs_user_id ON ai_chat_logs (user_id);
    """)

    conn.commit()
    conn.close()
    print(f"[OK] Fresh DB created at {db_path}")


if __name__ == "__main__":
    print(f"[DB] {DB_PATH}")
    migrate(DB_PATH)
