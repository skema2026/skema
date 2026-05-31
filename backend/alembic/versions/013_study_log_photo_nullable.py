"""make study_log photo_path nullable

Revision ID: 013
Revises: 012
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('study_logs', 'photo_path',
                    existing_type=sa.String(512),
                    nullable=True)


def downgrade():
    op.alter_column('study_logs', 'photo_path',
                    existing_type=sa.String(512),
                    nullable=False)
