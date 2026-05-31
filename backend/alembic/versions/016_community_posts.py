"""add posts and post_likes tables

Revision ID: 016
Revises: 015
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '016'
down_revision = '015'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'posts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('image_url', sa.String(512), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'post_likes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('post_id', sa.Integer(), sa.ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.UniqueConstraint('post_id', 'user_id', name='uq_post_like'),
    )


def downgrade():
    op.drop_table('post_likes')
    op.drop_table('posts')
