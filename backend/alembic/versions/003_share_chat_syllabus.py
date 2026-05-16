"""create share and chat tables

Revision ID: 003
Revises: 002
Create Date: 2026-05-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


chatrole = sa.Enum("USER", "ASSISTANT", "SYSTEM", name="chatrole")


def upgrade() -> None:
    op.create_table(
        "share_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_share_tokens_id", "share_tokens", ["id"], unique=False)
    op.create_index("ix_share_tokens_user_id", "share_tokens", ["user_id"], unique=False)
    op.create_index("ix_share_tokens_token", "share_tokens", ["token"], unique=True)

    op.create_table(
        "ai_chat_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", chatrole, nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_chat_logs_id", "ai_chat_logs", ["id"], unique=False)
    op.create_index("ix_ai_chat_logs_user_id", "ai_chat_logs", ["user_id"], unique=False)

def downgrade() -> None:
    op.drop_table("ai_chat_logs")
    op.drop_table("share_tokens")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS chatrole")
