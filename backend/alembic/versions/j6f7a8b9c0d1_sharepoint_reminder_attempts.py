"""Add attempts column to sharepoint_reminders table.

Revision ID: j6f7a8b9c0d1
Revises: i5e6f7a8b9c0
Create Date: 2026-09-18 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j6f7a8b9c0d1"
down_revision: str | None = "i5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sharepoint_reminders",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("sharepoint_reminders", "attempts")
