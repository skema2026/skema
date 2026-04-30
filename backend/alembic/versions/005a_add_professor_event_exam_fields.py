"""add professor, event table, exam fields

Revision ID: 005a
Revises: 005
Create Date: 2026-04-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "005a"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
    op.create_index(op.f("ix_events_id"), "events", ["id"], unique=False)
    op.create_index(op.f("ix_events_user_id"), "events", ["user_id"], unique=False)

    try:
        op.add_column("schedules", sa.Column("professor", sa.String(length=100), nullable=True))
    except Exception:
        pass

    try:
        op.add_column("exam_schedules", sa.Column("schedule_id", sa.Integer(), nullable=True))
        op.create_index("ix_exam_schedules_schedule_id", "exam_schedules", ["schedule_id"], unique=False)
        op.create_foreign_key("fk_exam_schedule_id", "exam_schedules", "schedules", ["schedule_id"], ["id"], ondelete="SET NULL")
    except Exception:
        pass
    for col in [
        ("start_time", sa.String(length=5)),
        ("end_time", sa.String(length=5)),
        ("memo", sa.Text()),
    ]:
        try:
            op.add_column("exam_schedules", sa.Column(col[0], col[1], nullable=True))
        except Exception:
            pass

    for col in [
        ("nickname", sa.String(length=100)),
        ("avatar_url", sa.String(length=512)),
        ("department", sa.String(length=100)),
        ("semester", sa.Integer()),
    ]:
        try:
            op.add_column("user_profiles", sa.Column(col[0], col[1], nullable=True))
        except Exception:
            pass


def downgrade() -> None:
    for col in ["semester", "department", "avatar_url", "nickname"]:
        try:
            op.drop_column("user_profiles", col)
        except Exception:
            pass

    try:
        op.drop_constraint("fk_exam_schedule_id", "exam_schedules", type_="foreignkey")
        op.drop_index("ix_exam_schedules_schedule_id", table_name="exam_schedules")
    except Exception:
        pass
    for col in ["memo", "end_time", "start_time", "schedule_id"]:
        try:
            op.drop_column("exam_schedules", col)
        except Exception:
            pass

    try:
        op.drop_column("schedules", "professor")
    except Exception:
        pass

    op.drop_index(op.f("ix_events_user_id"), table_name="events")
    op.drop_index(op.f("ix_events_id"), table_name="events")
    op.drop_table("events")
