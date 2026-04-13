"""Bring schema up to current model state

Revision ID: 003
Revises: 002
Create Date: 2026-04-12 00:00:00.000000

Changes vs 002:
  users:
    + username (VARCHAR 100, nullable)
  user_profiles:
    + is_college_student (BOOLEAN, default False)
    + semester_start_date (VARCHAR 10, nullable)
  schedules:
    + schedule_source (VARCHAR 30, default 'user_created')
    + linked_exam_id  (INTEGER FK exam_schedules.id, nullable)
    + user_override   (BOOLEAN, default False)
    + deleted_by_user (BOOLEAN, default False)
    + original_generated_title (VARCHAR 250, nullable)
  exam_schedules:
    + exam_time             (VARCHAR 5, nullable)
    + exam_duration_minutes (INTEGER, default 120)
    + source                (VARCHAR 50, nullable)
    + progress_note         (TEXT, nullable)
    + weak_parts            (TEXT, nullable)
  NEW TABLE: syllabi
  NEW TABLE: syllabus_analyses
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users: add username ───────────────────────────────────────────────────
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("username", sa.String(100), nullable=True))

    # ── user_profiles: add is_college_student, semester_start_date ────────────
    with op.batch_alter_table("user_profiles", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_college_student", sa.Boolean(), nullable=True, server_default="0")
        )
        batch_op.add_column(sa.Column("semester_start_date", sa.String(10), nullable=True))

    # ── schedules: add AI-consistency tracking columns ────────────────────────
    with op.batch_alter_table("schedules", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("schedule_source", sa.String(30), nullable=True, server_default="user_created")
        )
        batch_op.add_column(sa.Column("linked_exam_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("user_override", sa.Boolean(), nullable=True, server_default="0")
        )
        batch_op.add_column(
            sa.Column("deleted_by_user", sa.Boolean(), nullable=True, server_default="0")
        )
        batch_op.add_column(
            sa.Column("original_generated_title", sa.String(250), nullable=True)
        )

    # Add FK after column exists (batch_alter handles this atomically on SQLite;
    # on MySQL we add it separately via ALTER TABLE ... ADD CONSTRAINT)
    try:
        with op.batch_alter_table("schedules", schema=None) as batch_op:
            batch_op.create_foreign_key(
                "fk_schedules_linked_exam_id",
                "exam_schedules",
                ["linked_exam_id"],
                ["id"],
                ondelete="SET NULL",
            )
    except Exception:
        # FK optional — skip if dialect doesn't support or already exists
        pass

    # ── exam_schedules: add exam_time, duration, onboarding fields ────────────
    with op.batch_alter_table("exam_schedules", schema=None) as batch_op:
        batch_op.add_column(sa.Column("exam_time", sa.String(5), nullable=True))
        batch_op.add_column(
            sa.Column("exam_duration_minutes", sa.Integer(), nullable=True, server_default="120")
        )
        batch_op.add_column(sa.Column("source", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("progress_note", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("weak_parts", sa.Text(), nullable=True))

    # ── syllabi: create ───────────────────────────────────────────────────────
    op.create_table(
        "syllabi",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subject_name", sa.String(200), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(500), nullable=False),
        sa.Column("file_path", sa.String(1000), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("content_type", sa.String(100), nullable=True),
        sa.Column("source", sa.String(50), nullable=True, server_default="syllabus_upload"),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_syllabi_id", "syllabi", ["id"])
    op.create_index("ix_syllabi_user_id", "syllabi", ["user_id"])

    # ── syllabus_analyses: create ─────────────────────────────────────────────
    op.create_table(
        "syllabus_analyses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subject_name", sa.String(200), nullable=False),
        sa.Column("midterm_weight", sa.Integer(), nullable=True),
        sa.Column("final_weight", sa.Integer(), nullable=True),
        sa.Column("assignment_weight", sa.Integer(), nullable=True),
        sa.Column("attendance_weight", sa.Integer(), nullable=True),
        sa.Column("presentation_weight", sa.Integer(), nullable=True),
        sa.Column("has_presentation", sa.Boolean(), nullable=True),
        sa.Column("midterm_week", sa.Integer(), nullable=True),
        sa.Column("final_week", sa.Integer(), nullable=True),
        sa.Column("weekly_topics", sa.Text(), nullable=True),
        sa.Column("exam_dates", sa.Text(), nullable=True),
        sa.Column("assignment_dates", sa.Text(), nullable=True),
        sa.Column("important_factors", sa.Text(), nullable=True),
        sa.Column("study_mapping", sa.Text(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column(
            "analysis_status",
            sa.String(30),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("analysis_reason", sa.String(200), nullable=True),
        sa.Column(
            "analyzed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["syllabus_id"], ["syllabi.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("syllabus_id"),
    )
    op.create_index("ix_syllabus_analyses_id", "syllabus_analyses", ["id"])
    op.create_index("ix_syllabus_analyses_user_id", "syllabus_analyses", ["user_id"])
    op.create_index(
        "ix_syllabus_analyses_syllabus_id", "syllabus_analyses", ["syllabus_id"], unique=True
    )


def downgrade() -> None:
    op.drop_table("syllabus_analyses")
    op.drop_table("syllabi")

    with op.batch_alter_table("exam_schedules", schema=None) as batch_op:
        batch_op.drop_column("weak_parts")
        batch_op.drop_column("progress_note")
        batch_op.drop_column("source")
        batch_op.drop_column("exam_duration_minutes")
        batch_op.drop_column("exam_time")

    with op.batch_alter_table("schedules", schema=None) as batch_op:
        try:
            batch_op.drop_constraint("fk_schedules_linked_exam_id", type_="foreignkey")
        except Exception:
            pass
        batch_op.drop_column("original_generated_title")
        batch_op.drop_column("deleted_by_user")
        batch_op.drop_column("user_override")
        batch_op.drop_column("linked_exam_id")
        batch_op.drop_column("schedule_source")

    with op.batch_alter_table("user_profiles", schema=None) as batch_op:
        batch_op.drop_column("semester_start_date")
        batch_op.drop_column("is_college_student")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("username")
