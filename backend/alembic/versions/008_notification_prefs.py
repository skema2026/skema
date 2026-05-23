"""add notification_prefs to user_profiles

Revision ID: 008
Revises: 007
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'user_profiles',
        sa.Column('notification_prefs', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column('user_profiles', 'notification_prefs')
