"""user status (approval) + per-user module permissions

Revision ID: b2d4f6a80931
Revises: a1c2e3f40581
Create Date: 2026-06-05 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2d4f6a80931"
down_revision: Union[str, None] = "a1c2e3f40581"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing users are treated as already-approved so nobody is locked out.
    op.add_column(
        "users",
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="active"
        ),
    )
    op.add_column("users", sa.Column("permissions", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "permissions")
    op.drop_column("users", "status")
