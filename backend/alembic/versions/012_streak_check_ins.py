"""add streak_check_ins table

Revision ID: 012
Revises: 011
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'streak_check_ins',
        sa.Column('id',         sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id',    sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('check_date', sa.Date(),    nullable=False),
        sa.UniqueConstraint('user_id', 'check_date', name='uq_streak_per_user_day'),
    )


def downgrade():
    op.drop_table('streak_check_ins')
