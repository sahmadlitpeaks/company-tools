"""leave balances (annual entitlement per user)

Revision ID: a7c9e1b35640
Revises: f6b8d0c24539
Create Date: 2026-06-05 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c9e1b35640"
down_revision: Union[str, None] = "f6b8d0c24539"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leave_balances",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("entitlement_days", sa.Integer(), nullable=False, server_default="25"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_leave_balances_user_id", "leave_balances", ["user_id"])
    op.create_index("ix_leave_balances_year", "leave_balances", ["year"])


def downgrade() -> None:
    op.drop_table("leave_balances")
