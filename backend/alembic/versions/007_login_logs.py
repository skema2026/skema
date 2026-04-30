"""add login_logs table and username unique constraint

Revision ID: 007
Revises: 006
Create Date: 2026-04-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "login_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("login_identifier", sa.String(length=255), nullable=False),
        sa.Column("login_method", sa.String(length=20), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("failure_reason", sa.String(length=100), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_logs_id", "login_logs", ["id"], unique=False)
    op.create_index("ix_login_logs_user_id", "login_logs", ["user_id"], unique=False)
    op.create_index("ix_login_logs_created_at", "login_logs", ["created_at"], unique=False)

    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")

    op.drop_index("ix_login_logs_created_at", table_name="login_logs")
    op.drop_index("ix_login_logs_user_id", table_name="login_logs")
    op.drop_index("ix_login_logs_id", table_name="login_logs")
    op.drop_table("login_logs")
