"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-01 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("social_provider", sa.String(length=50), nullable=True),
        sa.Column("social_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # ── user_profiles ─────────────────────────────────────────────────────────
    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("nickname", sa.String(length=100), nullable=True),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("department", sa.String(length=100), nullable=True),
        sa.Column("semester", sa.Integer(), nullable=True),
        sa.Column("sleep_start", sa.String(length=5), nullable=True, server_default="23:00"),
        sa.Column("sleep_end", sa.String(length=5), nullable=True, server_default="07:00"),
        sa.Column("onboarding_completed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_user_profiles_id", "user_profiles", ["id"])

    # ── schedules ─────────────────────────────────────────────────────────────
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_name", sa.String(length=200), nullable=False),
        sa.Column("professor", sa.String(length=100), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column(
            "day_of_week",
            sa.Enum("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", name="dayofweek"),
            nullable=False,
        ),
        sa.Column("start_time", sa.String(length=5), nullable=False),
        sa.Column("end_time", sa.String(length=5), nullable=False),
        sa.Column("color_code", sa.String(length=7), nullable=True, server_default="#6366F1"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedules_id", "schedules", ["id"])
    op.create_index("ix_schedules_user_id", "schedules", ["user_id"])

    # ── exam_schedules ────────────────────────────────────────────────────────
    op.create_table(
        "exam_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=True),
        sa.Column("end_time", sa.String(length=5), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["schedule_id"], ["schedules.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exam_schedules_id", "exam_schedules", ["id"])
    op.create_index("ix_exam_schedules_user_id", "exam_schedules", ["user_id"])
    op.create_index("ix_exam_schedules_schedule_id", "exam_schedules", ["schedule_id"])

    # ── share_tokens ──────────────────────────────────────────────────────────
    op.create_table(
        "share_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_share_tokens_id", "share_tokens", ["id"])
    op.create_index("ix_share_tokens_user_id", "share_tokens", ["user_id"])
    op.create_index("ix_share_tokens_token", "share_tokens", ["token"], unique=True)

    # ── ai_chat_logs ──────────────────────────────────────────────────────────
    op.create_table(
        "ai_chat_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("user", "assistant", "system", name="chatrole"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_chat_logs_id", "ai_chat_logs", ["id"])
    op.create_index("ix_ai_chat_logs_user_id", "ai_chat_logs", ["user_id"])


def downgrade() -> None:
    op.drop_table("ai_chat_logs")
    op.drop_table("share_tokens")
    op.drop_table("exam_schedules")
    op.drop_table("schedules")
    op.drop_table("user_profiles")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS dayofweek")
    op.execute("DROP TYPE IF EXISTS chatrole")
