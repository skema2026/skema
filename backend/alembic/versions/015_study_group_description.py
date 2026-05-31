"""add description to study_groups

Revision ID: 015
Revises: 014
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('study_groups', sa.Column('description', sa.String(300), nullable=True))


def downgrade():
    op.drop_column('study_groups', 'description')
