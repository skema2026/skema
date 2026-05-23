"""add schedule view scope

Revision ID: 007
Revises: 006
Create Date: 2026-05-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "schedules",
        sa.Column("view_scope", sa.String(length=30), nullable=True, server_default="day_week"),
    )
    op.execute("UPDATE schedules SET view_scope = 'day_month' WHERE date IS NOT NULL AND date != ''")
    op.execute("UPDATE schedules SET view_scope = 'day_week' WHERE view_scope IS NULL OR view_scope = ''")


def downgrade() -> None:
    op.drop_column("schedules", "view_scope")
