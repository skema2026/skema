"""create users and profiles

Revision ID: 001
Revises:
Create Date: 2026-05-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("social_provider", sa.String(length=50), nullable=True),
        sa.Column("social_id", sa.String(length=255), nullable=True),
        sa.Column("kakao_access_token", sa.String(length=512), nullable=True),
        sa.Column("kakao_refresh_token", sa.String(length=512), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_id", "users", ["id"], unique=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("user_type", sa.String(length=50), nullable=True),
        sa.Column("occupation", sa.String(length=100), nullable=True),
        sa.Column("goal_tasks", sa.String(length=500), nullable=True),
        sa.Column("sleep_start", sa.String(length=5), nullable=True),
        sa.Column("sleep_end", sa.String(length=5), nullable=True),
        sa.Column("is_college_student", sa.Boolean(), nullable=True),
        sa.Column("semester_start_date", sa.String(length=10), nullable=True),
        sa.Column("onboarding_completed", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_user_profiles_id", "user_profiles", ["id"], unique=False)


def downgrade() -> None:
    op.drop_table("user_profiles")
    op.drop_table("users")
