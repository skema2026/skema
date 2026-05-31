"""add like_notification_queue table

Revision ID: 017
Revises: 016
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'like_notification_queue',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('target_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('liker_name', sa.String(100), nullable=False),
        sa.Column('content_type', sa.String(10), nullable=False),
        sa.Column('content_id', sa.Integer(), nullable=False),
        sa.Column('queued_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('like_notification_queue')
