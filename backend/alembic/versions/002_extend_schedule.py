"""Extend schedule model for AI agent compatibility

Revision ID: 002
Revises: 001
Create Date: 2026-04-07 00:00:00.000000

Changes:
  schedules:
    - Add title (populated from course_name)
    - Add date (YYYY-MM-DD, nullable – specific date events)
    - Add color (populated from color_code)
    - Add priority (int, default 0)
    - Add is_completed (bool, default False)
    - Add schedule_type (str, default 'class')
    - Convert day_of_week from DayOfWeek enum to Integer (0=Mon…6=Sun)
    - Remove course_name, color_code (now redundant)

  exam_schedules:
    - Add subject (nullable)

  user_profiles:
    - Add user_type, occupation, goal_tasks (all nullable)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Add transition columns to schedules ────────────────────────────────
    with op.batch_alter_table("schedules", schema=None) as batch_op:
        batch_op.add_column(sa.Column("title", sa.String(200), nullable=True))
        batch_op.add_column(sa.Column("date", sa.String(10), nullable=True))
        batch_op.add_column(sa.Column("color", sa.String(7), nullable=True))
        batch_op.add_column(sa.Column("priority", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("is_completed", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("schedule_type", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("day_of_week_int", sa.Integer(), nullable=True))

    # ── 2. Populate new columns from old data ─────────────────────────────────
    op.execute("UPDATE schedules SET title = course_name WHERE title IS NULL OR title = ''")
    op.execute(
        "UPDATE schedules SET color = COALESCE(color_code, '#6366F1') WHERE color IS NULL OR color = ''"
    )
    op.execute("UPDATE schedules SET priority = 0 WHERE priority IS NULL")
    op.execute("UPDATE schedules SET is_completed = 0 WHERE is_completed IS NULL")
    op.execute("UPDATE schedules SET schedule_type = 'class' WHERE schedule_type IS NULL")
    # Convert DayOfWeek enum strings → integer
    op.execute(
        """
        UPDATE schedules SET day_of_week_int = CASE day_of_week
            WHEN 'MON' THEN 0
            WHEN 'TUE' THEN 1
            WHEN 'WED' THEN 2
            WHEN 'THU' THEN 3
            WHEN 'FRI' THEN 4
            WHEN 'SAT' THEN 5
            WHEN 'SUN' THEN 6
            ELSE 0
        END WHERE day_of_week_int IS NULL
        """
    )

    # ── 3. Recreate schedules with canonical schema ───────────────────────────
    op.create_table(
        "schedules_v2",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("professor", sa.String(100), nullable=True),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("day_of_week", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("date", sa.String(10), nullable=True),
        sa.Column("start_time", sa.String(5), nullable=False),
        sa.Column("end_time", sa.String(5), nullable=False),
        sa.Column("color", sa.String(7), nullable=True, server_default="#6366F1"),
        sa.Column("priority", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("is_completed", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("schedule_type", sa.String(20), nullable=True, server_default="class"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Copy data (exam_schedules FK still references old table by name – handled below)
    op.execute(
        """
        INSERT INTO schedules_v2
            (id, user_id, title, professor, location, day_of_week, date,
             start_time, end_time, color, priority, is_completed, schedule_type)
        SELECT id, user_id, title, professor, location,
               COALESCE(day_of_week_int, 0), date,
               start_time, end_time, color,
               COALESCE(priority, 0), COALESCE(is_completed, 0), COALESCE(schedule_type, 'class')
        FROM schedules
        """
    )

    op.drop_table("schedules")
    op.rename_table("schedules_v2", "schedules")

    op.create_index("ix_schedules_id", "schedules", ["id"])
    op.create_index("ix_schedules_user_id", "schedules", ["user_id"])

    # ── 4. exam_schedules: add subject ────────────────────────────────────────
    with op.batch_alter_table("exam_schedules", schema=None) as batch_op:
        batch_op.add_column(sa.Column("subject", sa.String(200), nullable=True))

    # ── 5. user_profiles: add user_type, occupation, goal_tasks ──────────────
    with op.batch_alter_table("user_profiles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("user_type", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("occupation", sa.String(100), nullable=True))
        batch_op.add_column(sa.Column("goal_tasks", sa.String(500), nullable=True))


def downgrade() -> None:
    # user_profiles
    with op.batch_alter_table("user_profiles", schema=None) as batch_op:
        batch_op.drop_column("goal_tasks")
        batch_op.drop_column("occupation")
        batch_op.drop_column("user_type")

    # exam_schedules
    with op.batch_alter_table("exam_schedules", schema=None) as batch_op:
        batch_op.drop_column("subject")

    # Recreate schedules with original schema
    op.create_table(
        "schedules_v1",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_name", sa.String(200), nullable=False),
        sa.Column("professor", sa.String(100), nullable=True),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("day_of_week", sa.String(3), nullable=False, server_default="MON"),
        sa.Column("start_time", sa.String(5), nullable=False),
        sa.Column("end_time", sa.String(5), nullable=False),
        sa.Column("color_code", sa.String(7), nullable=True, server_default="#6366F1"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    dow_map = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    for i, name in enumerate(dow_map):
        op.execute(
            f"INSERT INTO schedules_v1 (id, user_id, course_name, professor, location, "
            f"day_of_week, start_time, end_time, color_code) "
            f"SELECT id, user_id, title, professor, location, "
            f"'{name}', start_time, end_time, color "
            f"FROM schedules WHERE day_of_week = {i}"
        )

    op.drop_table("schedules")
    op.rename_table("schedules_v1", "schedules")

    op.create_index("ix_schedules_id", "schedules", ["id"])
    op.create_index("ix_schedules_user_id", "schedules", ["user_id"])
