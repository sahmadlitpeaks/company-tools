"""add user roles and brand scoping

Revision ID: a7d3e9f15c20
Revises: f6c2a9b41d70
Create Date: 2026-06-02 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7d3e9f15c20"
down_revision: Union[str, None] = "f6c2a9b41d70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(length=16), nullable=False, server_default="member"),
    )
    op.execute("UPDATE users SET role = 'admin' WHERE is_admin = true")

    op.create_table(
        "user_brands",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("brand_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "brand_id"),
    )


def downgrade() -> None:
    op.drop_table("user_brands")
    op.drop_column("users", "role")
