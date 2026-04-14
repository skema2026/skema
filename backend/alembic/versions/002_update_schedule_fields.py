"""Update schedule fields: rename course_name→title, color_code→color, day_of_week Enum→Int, add new columns

Revision ID: 002
Revises: 001
Create Date: 2026-04-07 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    def _col_exists(table: str, col: str) -> bool:
        return col in {c["name"] for c in insp.get_columns(table)}

    # ── schedules 테이블 변경 ─────────────────────────────────────────────────

    # 1. 새 컬럼 추가 (nullable로 먼저 추가 후 데이터 채움)
    if not _col_exists("schedules", "title"):
        op.add_column("schedules", sa.Column("title", sa.String(200), nullable=True))
    if not _col_exists("schedules", "color"):
        op.add_column("schedules", sa.Column("color", sa.String(7), nullable=True, server_default="#6366F1"))
    if not _col_exists("schedules", "day_of_week_new") and not _col_exists("schedules", "day_of_week"):
        # defensive: if old day_of_week was already dropped in a partial run,
        # we still need a place to store the integer day value.
        op.add_column("schedules", sa.Column("day_of_week_new", sa.Integer(), nullable=True))
    elif not _col_exists("schedules", "day_of_week_new"):
        op.add_column("schedules", sa.Column("day_of_week_new", sa.Integer(), nullable=True))
    if not _col_exists("schedules", "date"):
        op.add_column("schedules", sa.Column("date", sa.Date(), nullable=True))
    if not _col_exists("schedules", "priority"):
        op.add_column("schedules", sa.Column("priority", sa.Integer(), nullable=False, server_default="0"))
    if not _col_exists("schedules", "schedule_type"):
        op.add_column("schedules", sa.Column("schedule_type", sa.String(20), nullable=False, server_default="class"))
    if not _col_exists("schedules", "is_completed"):
        op.add_column("schedules", sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("0")))

    # 2. 기존 데이터 복사 및 변환
    if _col_exists("schedules", "title") and _col_exists("schedules", "course_name"):
        op.execute("UPDATE schedules SET title = course_name WHERE title IS NULL")
    if _col_exists("schedules", "color") and _col_exists("schedules", "color_code"):
        op.execute("UPDATE schedules SET color = COALESCE(color_code, '#6366F1') WHERE color IS NULL")
    if _col_exists("schedules", "day_of_week_new") and _col_exists("schedules", "day_of_week"):
        op.execute(
            """
            UPDATE schedules SET day_of_week_new = CASE day_of_week
                WHEN 'MON' THEN 0
                WHEN 'TUE' THEN 1
                WHEN 'WED' THEN 2
                WHEN 'THU' THEN 3
                WHEN 'FRI' THEN 4
                WHEN 'SAT' THEN 5
                WHEN 'SUN' THEN 6
                ELSE 0
            END
            WHERE day_of_week_new IS NULL
            """
        )

    # 3. NOT NULL 제약 적용
    if _col_exists("schedules", "title"):
        op.alter_column("schedules", "title", existing_type=sa.String(200), nullable=False)
    if _col_exists("schedules", "color"):
        op.alter_column("schedules", "color", existing_type=sa.String(7), nullable=False, server_default=None)
    if _col_exists("schedules", "day_of_week_new"):
        op.alter_column("schedules", "day_of_week_new", existing_type=sa.Integer(), nullable=False)

    # 4. 기존 컬럼 삭제
    if _col_exists("schedules", "course_name"):
        op.drop_column("schedules", "course_name")
    if _col_exists("schedules", "color_code"):
        op.drop_column("schedules", "color_code")
    if _col_exists("schedules", "day_of_week") and _col_exists("schedules", "day_of_week_new"):
        # drop the old enum column only when the new int column exists
        op.drop_column("schedules", "day_of_week")

    # 5. 새 컬럼 이름 변경
    if _col_exists("schedules", "day_of_week_new") and not _col_exists("schedules", "day_of_week"):
        op.alter_column(
            "schedules",
            "day_of_week_new",
            new_column_name="day_of_week",
            existing_type=sa.Integer(),
            nullable=False,
        )

    # ── exam_schedules 테이블 변경 ────────────────────────────────────────────
    if not _col_exists("exam_schedules", "subject"):
        op.add_column("exam_schedules", sa.Column("subject", sa.String(200), nullable=True))
    if not _col_exists("exam_schedules", "exam_time"):
        op.add_column("exam_schedules", sa.Column("exam_time", sa.String(5), nullable=True))


def downgrade() -> None:
    # exam_schedules 복원
    op.drop_column("exam_schedules", "exam_time")
    op.drop_column("exam_schedules", "subject")

    # schedules 복원 (day_of_week는 Enum으로 되돌리기 어려우므로 String으로 대체)
    op.add_column("schedules", sa.Column("course_name", sa.String(200), nullable=True))
    op.add_column("schedules", sa.Column("color_code", sa.String(7), nullable=True))
    op.add_column("schedules", sa.Column("day_of_week_old", sa.String(3), nullable=True))

    op.execute("UPDATE schedules SET course_name = title")
    op.execute("UPDATE schedules SET color_code = color")
    op.execute("""
        UPDATE schedules SET day_of_week_old = CASE day_of_week
            WHEN 0 THEN 'MON'
            WHEN 1 THEN 'TUE'
            WHEN 2 THEN 'WED'
            WHEN 3 THEN 'THU'
            WHEN 4 THEN 'FRI'
            WHEN 5 THEN 'SAT'
            WHEN 6 THEN 'SUN'
            ELSE 'MON'
        END
    """)

    op.alter_column("schedules", "course_name", nullable=False)
    op.drop_column("schedules", "title")
    op.drop_column("schedules", "color")
    op.drop_column("schedules", "day_of_week")
    op.drop_column("schedules", "date")
    op.drop_column("schedules", "priority")
    op.drop_column("schedules", "schedule_type")
    op.drop_column("schedules", "is_completed")
    op.alter_column("schedules", "day_of_week_old", new_column_name="day_of_week",
                    existing_type=sa.String(3), nullable=False)
