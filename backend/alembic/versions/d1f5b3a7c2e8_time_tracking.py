"""Time tracking: time_entries + timesheets

Revision ID: d1f5b3a7c2e8
Revises: c9e3a5b7d1f4
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa


revision = "d1f5b3a7c2e8"
down_revision = "c9e3a5b7d1f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "time_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("clock_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clock_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="work"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=8), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_time_entries_user_id", "time_entries", ["user_id"])
    op.create_index("ix_time_entries_work_date", "time_entries", ["work_date"])

    op.create_table(
        "timesheets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_timesheets_user_id", "timesheets", ["user_id"])
    op.create_index("ix_timesheets_week_start", "timesheets", ["week_start"])
    op.create_index("ix_timesheets_status", "timesheets", ["status"])


def downgrade() -> None:
    op.drop_table("timesheets")
    op.drop_table("time_entries")
