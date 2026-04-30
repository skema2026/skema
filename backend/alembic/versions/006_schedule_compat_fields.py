"""add compatibility fields for schedule and exam models

Revision ID: 006
Revises: 005b
Create Date: 2026-04-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006"
down_revision: Union[str, None] = "005b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("schedules", schema=None) as batch_op:
        try:
            batch_op.add_column(sa.Column("date", sa.String(length=10), nullable=True))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("priority", sa.Integer(), nullable=True, server_default="0"))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("is_completed", sa.Boolean(), nullable=True, server_default="0"))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("schedule_type", sa.String(length=30), nullable=True, server_default="class"))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("schedule_source", sa.String(length=30), nullable=True, server_default="user_created"))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("linked_exam_id", sa.Integer(), nullable=True))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("user_override", sa.Boolean(), nullable=True, server_default="0"))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("deleted_by_user", sa.Boolean(), nullable=True, server_default="0"))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("original_generated_title", sa.String(length=250), nullable=True))
        except Exception:
            pass

    try:
        with op.batch_alter_table("schedules", schema=None) as batch_op:
            batch_op.create_index("ix_schedules_date", ["date"], unique=False)
    except Exception:
        pass

    try:
        with op.batch_alter_table("schedules", schema=None) as batch_op:
            batch_op.create_index("ix_schedules_linked_exam_id", ["linked_exam_id"], unique=False)
    except Exception:
        pass

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
        pass

    with op.batch_alter_table("exam_schedules", schema=None) as batch_op:
        try:
            batch_op.add_column(sa.Column("subject", sa.String(length=200), nullable=True))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("exam_time", sa.String(length=5), nullable=True))
        except Exception:
            pass
        try:
            batch_op.add_column(
                sa.Column("exam_duration_minutes", sa.Integer(), nullable=True, server_default="120")
            )
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("source", sa.String(length=50), nullable=True))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("progress_note", sa.Text(), nullable=True))
        except Exception:
            pass
        try:
            batch_op.add_column(sa.Column("weak_parts", sa.Text(), nullable=True))
        except Exception:
            pass


def downgrade() -> None:
    with op.batch_alter_table("exam_schedules", schema=None) as batch_op:
        try:
            batch_op.drop_column("weak_parts")
        except Exception:
            pass
        try:
            batch_op.drop_column("progress_note")
        except Exception:
            pass
        try:
            batch_op.drop_column("source")
        except Exception:
            pass
        try:
            batch_op.drop_column("exam_duration_minutes")
        except Exception:
            pass
        try:
            batch_op.drop_column("exam_time")
        except Exception:
            pass
        try:
            batch_op.drop_column("subject")
        except Exception:
            pass

    try:
        with op.batch_alter_table("schedules", schema=None) as batch_op:
            batch_op.drop_constraint("fk_schedules_linked_exam_id", type_="foreignkey")
    except Exception:
        pass

    try:
        with op.batch_alter_table("schedules", schema=None) as batch_op:
            batch_op.drop_index("ix_schedules_linked_exam_id")
    except Exception:
        pass

    try:
        with op.batch_alter_table("schedules", schema=None) as batch_op:
            batch_op.drop_index("ix_schedules_date")
    except Exception:
        pass

    with op.batch_alter_table("schedules", schema=None) as batch_op:
        for col in [
            "original_generated_title",
            "deleted_by_user",
            "user_override",
            "linked_exam_id",
            "schedule_source",
            "schedule_type",
            "is_completed",
            "priority",
            "date",
        ]:
            try:
                batch_op.drop_column(col)
            except Exception:
                pass
