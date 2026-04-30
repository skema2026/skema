"""fix login_logs user_agent column type to String(512)

Revision ID: 008
Revises: 007
Create Date: 2026-04-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "login_logs",
        "user_agent",
        existing_type=sa.Text(),
        type_=sa.String(length=512),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "login_logs",
        "user_agent",
        existing_type=sa.String(length=512),
        type_=sa.Text(),
        existing_nullable=True,
    )
