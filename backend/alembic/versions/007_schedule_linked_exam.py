"""add linked_exam_id and original_generated_title to schedules

Revision ID: 007
Revises: 006
Branch Labels: None
Depends On: None
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
        sa.Column("linked_exam_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "schedules",
        sa.Column("original_generated_title", sa.String(length=200), nullable=True),
    )
    op.create_foreign_key(
        "fk_schedules_linked_exam_id",
        "schedules",
        "exam_schedules",
        ["linked_exam_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_schedules_linked_exam_id", "schedules", ["linked_exam_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_schedules_linked_exam_id", table_name="schedules")
    op.drop_constraint("fk_schedules_linked_exam_id", "schedules", type_="foreignkey")
    op.drop_column("schedules", "original_generated_title")
    op.drop_column("schedules", "linked_exam_id")
