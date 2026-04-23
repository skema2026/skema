"""Add kakao_access_token and kakao_refresh_token to users

Revision ID: 005
Revises: 004
Create Date: 2026-04-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("kakao_access_token", sa.String(512), nullable=True))
    op.add_column("users", sa.Column("kakao_refresh_token", sa.String(512), nullable=True))


def downgrade():
    op.drop_column("users", "kakao_refresh_token")
    op.drop_column("users", "kakao_access_token")
