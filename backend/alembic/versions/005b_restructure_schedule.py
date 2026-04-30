"""restructure schedule models

Revision ID: 005b
Revises: 4c7b91d46584
Create Date: 2026-04-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '005b'
down_revision: Union[str, None] = '4c7b91d46584'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    mysql = conn.dialect.name == "mysql"
    if mysql:
        conn.execute(sa.text("SET FOREIGN_KEY_CHECKS=0"))

    # 기존 exam_schedules 드롭 (schedules FK 참조)
    op.drop_table('exam_schedules')
    # 기존 schedules 드롭
    op.drop_table('schedules')

    # 새 schedules 테이블
    op.create_table('schedules',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('course_name', sa.String(length=200), nullable=False),
        sa.Column('professor', sa.String(length=100), nullable=True),
        sa.Column('location', sa.String(length=200), nullable=True),
        sa.Column('recurring_day', sa.Enum('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', name='dayofweek'), nullable=False),
        sa.Column('start_time', sa.String(length=5), nullable=False),
        sa.Column('end_time', sa.String(length=5), nullable=False),
        sa.Column('color_code', sa.String(length=7), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_schedules_id', 'schedules', ['id'], unique=False)
    op.create_index('ix_schedules_user_id', 'schedules', ['user_id'], unique=False)

    # 새 exam_schedules 테이블
    op.create_table('exam_schedules',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('schedule_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('exam_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.String(length=5), nullable=True),
        sa.Column('end_time', sa.String(length=5), nullable=True),
        sa.Column('location', sa.String(length=200), nullable=True),
        sa.Column('memo', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['schedule_id'], ['schedules.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_exam_schedules_id', 'exam_schedules', ['id'], unique=False)
    op.create_index('ix_exam_schedules_user_id', 'exam_schedules', ['user_id'], unique=False)
    op.create_index('ix_exam_schedules_schedule_id', 'exam_schedules', ['schedule_id'], unique=False)

    if mysql:
        conn.execute(sa.text("SET FOREIGN_KEY_CHECKS=1"))


def downgrade() -> None:
    conn = op.get_bind()
    mysql = conn.dialect.name == "mysql"
    if mysql:
        conn.execute(sa.text("SET FOREIGN_KEY_CHECKS=0"))

    op.drop_table('exam_schedules')
    op.drop_table('schedules')

    if mysql:
        conn.execute(sa.text("SET FOREIGN_KEY_CHECKS=1"))
