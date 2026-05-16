"""create schedules exams and events

Revision ID: 002
Revises: 001
Create Date: 2026-05-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


dayofweek = sa.Enum("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", name="dayofweek")


def upgrade() -> None:
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_name", sa.String(length=200), nullable=False),
        sa.Column("professor", sa.String(length=100), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("recurring_day", dayofweek, nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=False),
        sa.Column("end_time", sa.String(length=5), nullable=False),
        sa.Column("color_code", sa.String(length=7), nullable=True),
        sa.Column("date", sa.String(length=10), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("is_completed", sa.Boolean(), nullable=True, server_default=sa.text("0")),
        sa.Column("schedule_type", sa.String(length=30), nullable=True, server_default="class"),
        sa.Column("schedule_source", sa.String(length=30), nullable=True, server_default="user_created"),
        sa.Column("linked_exam_id", sa.Integer(), nullable=True),
        sa.Column("user_override", sa.Boolean(), nullable=True, server_default=sa.text("0")),
        sa.Column("deleted_by_user", sa.Boolean(), nullable=True, server_default=sa.text("0")),
        sa.Column("original_generated_title", sa.String(length=250), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedules_id", "schedules", ["id"], unique=False)
    op.create_index("ix_schedules_user_id", "schedules", ["user_id"], unique=False)
    op.create_index("ix_schedules_date", "schedules", ["date"], unique=False)
    op.create_index("ix_schedules_linked_exam_id", "schedules", ["linked_exam_id"], unique=False)

    op.create_table(
        "exam_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=True),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("exam_time", sa.String(length=5), nullable=True),
        sa.Column("start_time", sa.String(length=5), nullable=True),
        sa.Column("end_time", sa.String(length=5), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("exam_duration_minutes", sa.Integer(), nullable=True, server_default="120"),
        sa.Column("source", sa.String(length=50), nullable=True),
        sa.Column("progress_note", sa.Text(), nullable=True),
        sa.Column("weak_parts", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["schedule_id"], ["schedules.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exam_schedules_id", "exam_schedules", ["id"], unique=False)
    op.create_index("ix_exam_schedules_user_id", "exam_schedules", ["user_id"], unique=False)
    op.create_index("ix_exam_schedules_schedule_id", "exam_schedules", ["schedule_id"], unique=False)

    op.create_foreign_key(
        "fk_schedules_linked_exam_id",
        "schedules",
        "exam_schedules",
        ["linked_exam_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=True),
        sa.Column("end_time", sa.String(length=5), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("color_code", sa.String(length=7), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_events_id", "events", ["id"], unique=False)
    op.create_index("ix_events_user_id", "events", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_table("events")
    op.drop_constraint("fk_schedules_linked_exam_id", "schedules", type_="foreignkey")
    op.drop_table("exam_schedules")
    op.drop_table("schedules")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS dayofweek")
