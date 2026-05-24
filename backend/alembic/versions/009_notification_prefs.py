"""add notification_prefs to user_profiles

Revision ID: 009
Revises: 008
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'user_profiles',
        sa.Column('notification_prefs', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column('user_profiles', 'notification_prefs')
