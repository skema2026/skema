"""add study_groups and study_group_members, add group_id to study_logs

Revision ID: 014
Revises: 013
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'study_groups',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('invite_code', sa.String(16), nullable=False, unique=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'study_group_members',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('study_groups.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('joined_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('group_id', 'user_id', name='uq_group_member'),
    )

    op.add_column('study_logs', sa.Column(
        'group_id', sa.Integer(),
        sa.ForeignKey('study_groups.id', ondelete='SET NULL'),
        nullable=True, index=True,
    ))

    # is_public 컬럼 제거 (그룹 멤버십으로 접근 제어)
    op.drop_column('study_logs', 'is_public')


def downgrade():
    op.add_column('study_logs', sa.Column('is_public', sa.Boolean(), nullable=False, server_default='true'))
    op.drop_column('study_logs', 'group_id')
    op.drop_table('study_group_members')
    op.drop_table('study_groups')
