"""local password login for users

Revision ID: b3d5f7a9c1e4
Revises: a1c3e5d7f9b2
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa


revision = "b3d5f7a9c1e4"
down_revision = "a1c3e5d7f9b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
    op.drop_column("users", "password_hash")
