"""Leave depth: accrual schedule, half-day support

Revision ID: d7a1e5c9b3f2
Revises: c6f0d4b8e2a7
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "d7a1e5c9b3f2"
down_revision = "c6f0d4b8e2a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "leave_types",
        sa.Column("accrual_period", sa.String(length=12), nullable=False, server_default="annual"),
    )
    op.add_column(
        "leave_types",
        sa.Column("allow_half_day", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "approval_requests",
        sa.Column("half_day", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("approval_requests", "half_day")
    op.drop_column("leave_types", "allow_half_day")
    op.drop_column("leave_types", "accrual_period")
