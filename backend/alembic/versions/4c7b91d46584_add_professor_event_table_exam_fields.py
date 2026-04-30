"""add_professor_event_table_exam_fields

Revision ID: 4c7b91d46584
Revises: 005
Create Date: 2026-04-29 22:12:26.146869

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '4c7b91d46584'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # events 테이블 생성
    op.create_table('events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.String(length=5), nullable=True),
        sa.Column('end_time', sa.String(length=5), nullable=True),
        sa.Column('location', sa.String(length=200), nullable=True),
        sa.Column('color_code', sa.String(length=7), nullable=True),
        sa.Column('memo', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_events_id'), 'events', ['id'], unique=False)
    op.create_index(op.f('ix_events_user_id'), 'events', ['user_id'], unique=False)

    # schedules에 professor 컬럼 추가 (이미 DB에 있으면 무시)
    try:
        op.add_column('schedules', sa.Column('professor', sa.String(length=100), nullable=True))
    except Exception:
        pass

    # exam_schedules에 schedule_id, start_time, end_time, memo 추가 (이미 있으면 무시)
    try:
        op.add_column('exam_schedules', sa.Column('schedule_id', sa.Integer(), nullable=True))
        op.create_index('ix_exam_schedules_schedule_id', 'exam_schedules', ['schedule_id'], unique=False)
        op.create_foreign_key('fk_exam_schedule_id', 'exam_schedules', 'schedules', ['schedule_id'], ['id'], ondelete='SET NULL')
    except Exception:
        pass
    try:
        op.add_column('exam_schedules', sa.Column('start_time', sa.String(length=5), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('exam_schedules', sa.Column('end_time', sa.String(length=5), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('exam_schedules', sa.Column('memo', sa.Text(), nullable=True))
    except Exception:
        pass

    # user_profiles에 nickname, avatar_url, department, semester 추가 (이미 있으면 무시)
    try:
        op.add_column('user_profiles', sa.Column('nickname', sa.String(length=100), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('user_profiles', sa.Column('avatar_url', sa.String(length=512), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('user_profiles', sa.Column('department', sa.String(length=100), nullable=True))
    except Exception:
        pass
    try:
        op.add_column('user_profiles', sa.Column('semester', sa.Integer(), nullable=True))
    except Exception:
        pass


def downgrade() -> None:
    op.drop_column('user_profiles', 'semester')
    op.drop_column('user_profiles', 'department')
    op.drop_column('user_profiles', 'avatar_url')
    op.drop_column('user_profiles', 'nickname')
    op.drop_foreign_key('fk_exam_schedule_id', 'exam_schedules')
    op.drop_index('ix_exam_schedules_schedule_id', table_name='exam_schedules')
    op.drop_column('exam_schedules', 'memo')
    op.drop_column('exam_schedules', 'end_time')
    op.drop_column('exam_schedules', 'start_time')
    op.drop_column('exam_schedules', 'schedule_id')
    op.drop_column('schedules', 'professor')
    op.drop_index(op.f('ix_events_user_id'), table_name='events')
    op.drop_index(op.f('ix_events_id'), table_name='events')
    op.drop_table('events')
