"""re-add is_public to study_logs

Revision ID: 018
Revises: 017
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '018'
down_revision = '017'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('study_logs', sa.Column(
        'is_public', sa.Boolean(), nullable=False, server_default='1',
    ))


def downgrade():
    op.drop_column('study_logs', 'is_public')
