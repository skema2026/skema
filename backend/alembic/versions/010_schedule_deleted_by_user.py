"""add deleted_by_user to schedules

Revision ID: 010
Revises: 009
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('schedules', sa.Column('deleted_by_user', sa.Boolean(), nullable=True, server_default='0'))


def downgrade():
    op.drop_column('schedules', 'deleted_by_user')
