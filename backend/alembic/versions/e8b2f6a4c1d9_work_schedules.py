"""Attendance depth: work schedules + user schedule link

Revision ID: e8b2f6a4c1d9
Revises: d7a1e5c9b3f2
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "e8b2f6a4c1d9"
down_revision = "d7a1e5c9b3f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_schedules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("daily_minutes", sa.Integer(), nullable=False, server_default="480"),
        sa.Column("workdays", sa.JSON(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_work_schedules_name", "work_schedules", ["name"])
    op.create_index("ix_work_schedules_is_default", "work_schedules", ["is_default"])
    op.create_index("ix_work_schedules_active", "work_schedules", ["active"])

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("schedule_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_users_schedule_id", "work_schedules", ["schedule_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_schedule_id", type_="foreignkey")
        batch.drop_column("schedule_id")
    op.drop_index("ix_work_schedules_active", table_name="work_schedules")
    op.drop_index("ix_work_schedules_is_default", table_name="work_schedules")
    op.drop_index("ix_work_schedules_name", table_name="work_schedules")
    op.drop_table("work_schedules")
