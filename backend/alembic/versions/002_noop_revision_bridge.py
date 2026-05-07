"""Bridge missing 002 revision

Revision ID: 002
Revises: 001
Create Date: 2026-04-10 00:00:00.000000

This revision intentionally contains no schema changes. It preserves the
Alembic revision chain expected by 003_current_schema.py.
"""
from typing import Sequence, Union


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
