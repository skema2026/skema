"""add study_logs and study_log_reactions tables

Revision ID: 011
Revises: 010
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'study_logs',
        sa.Column('id',          sa.Integer(),     primary_key=True, index=True),
        sa.Column('user_id',     sa.Integer(),     sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('schedule_id', sa.Integer(),     sa.ForeignKey('schedules.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('photo_path',  sa.String(512),   nullable=False),
        sa.Column('caption',     sa.String(200),   nullable=True),
        sa.Column('is_public',   sa.Boolean(),     nullable=False, server_default=sa.true()),
        sa.Column('created_at',  sa.DateTime(),    nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'study_log_reactions',
        sa.Column('id',         sa.Integer(),    primary_key=True, index=True),
        sa.Column('log_id',     sa.Integer(),    sa.ForeignKey('study_logs.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id',    sa.Integer(),    sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('emoji',      sa.String(10),   nullable=False),
        sa.Column('created_at', sa.DateTime(),   nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('log_id', 'user_id', 'emoji', name='uq_reaction_per_user_emoji'),
    )


def downgrade():
    op.drop_table('study_log_reactions')
    op.drop_table('study_logs')
