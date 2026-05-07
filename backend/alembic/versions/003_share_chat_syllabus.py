"""create share chat and syllabus tables

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

    op.create_table(
        "syllabi",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subject_name", sa.String(length=200), nullable=False),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("stored_filename", sa.String(length=500), nullable=False),
        sa.Column("file_path", sa.String(length=1000), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_syllabi_id", "syllabi", ["id"], unique=False)
    op.create_index("ix_syllabi_user_id", "syllabi", ["user_id"], unique=False)

    op.create_table(
        "syllabus_analyses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subject_name", sa.String(length=200), nullable=False),
        sa.Column("midterm_weight", sa.Integer(), nullable=True),
        sa.Column("final_weight", sa.Integer(), nullable=True),
        sa.Column("assignment_weight", sa.Integer(), nullable=True),
        sa.Column("attendance_weight", sa.Integer(), nullable=True),
        sa.Column("presentation_weight", sa.Integer(), nullable=True),
        sa.Column("has_presentation", sa.Boolean(), nullable=True),
        sa.Column("midterm_week", sa.Integer(), nullable=True),
        sa.Column("final_week", sa.Integer(), nullable=True),
        sa.Column("weekly_topics", sa.Text(), nullable=True),
        sa.Column("exam_dates", sa.Text(), nullable=True),
        sa.Column("assignment_dates", sa.Text(), nullable=True),
        sa.Column("important_factors", sa.Text(), nullable=True),
        sa.Column("study_mapping", sa.Text(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("analysis_status", sa.String(length=30), nullable=False),
        sa.Column("analysis_reason", sa.String(length=200), nullable=True),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["syllabus_id"], ["syllabi.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("syllabus_id"),
    )
    op.create_index("ix_syllabus_analyses_id", "syllabus_analyses", ["id"], unique=False)
    op.create_index("ix_syllabus_analyses_syllabus_id", "syllabus_analyses", ["syllabus_id"], unique=True)
    op.create_index("ix_syllabus_analyses_user_id", "syllabus_analyses", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_table("syllabus_analyses")
    op.drop_table("syllabi")
    op.drop_table("ai_chat_logs")
    op.drop_table("share_tokens")
    op.execute("DROP TYPE IF EXISTS chatrole")
