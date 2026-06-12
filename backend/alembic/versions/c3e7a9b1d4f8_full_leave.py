"""Full leave: types, holidays, typed requests & balances

Revision ID: c3e7a9b1d4f8
Revises: b2d6f8a1c3e7
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "c3e7a9b1d4f8"
down_revision = "b2d6f8a1c3e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leave_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False, server_default="#6366f1"),
        sa.Column("paid", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("carryover_max", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_leave_types_name", "leave_types", ["name"])
    op.create_index("ix_leave_types_active", "leave_types", ["active"])

    op.create_table(
        "holidays",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("day"),
    )
    op.create_index("ix_holidays_day", "holidays", ["day"])

    op.add_column("approval_requests", sa.Column("leave_type_id", sa.Uuid(), nullable=True))
    op.create_index("ix_approval_requests_leave_type_id", "approval_requests", ["leave_type_id"])
    op.create_foreign_key(
        "fk_approval_requests_leave_type_id", "approval_requests", "leave_types",
        ["leave_type_id"], ["id"], ondelete="SET NULL",
    )

    op.add_column("leave_balances", sa.Column("leave_type_id", sa.Uuid(), nullable=True))
    op.create_index("ix_leave_balances_leave_type_id", "leave_balances", ["leave_type_id"])
    op.create_foreign_key(
        "fk_leave_balances_leave_type_id", "leave_balances", "leave_types",
        ["leave_type_id"], ["id"], ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_leave_balances_leave_type_id", "leave_balances", type_="foreignkey")
    op.drop_index("ix_leave_balances_leave_type_id", table_name="leave_balances")
    op.drop_column("leave_balances", "leave_type_id")
    op.drop_constraint("fk_approval_requests_leave_type_id", "approval_requests", type_="foreignkey")
    op.drop_index("ix_approval_requests_leave_type_id", table_name="approval_requests")
    op.drop_column("approval_requests", "leave_type_id")
    op.drop_table("holidays")
    op.drop_table("leave_types")
