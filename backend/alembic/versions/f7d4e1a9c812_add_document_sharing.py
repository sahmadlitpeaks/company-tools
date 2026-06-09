"""add public document sharing (brochures + assets)

Revision ID: f7d4e1a9c812
Revises: e1b3d7f60a24
Create Date: 2026-06-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7d4e1a9c812"
down_revision: Union[str, None] = "e1b3d7f60a24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("brochures", "assets"):
        op.add_column(
            table,
            sa.Column(
                "is_public",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
        op.add_column(table, sa.Column("short_link_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            op.f(f"fk_{table}_short_link_id_short_links"),
            table,
            "short_links",
            ["short_link_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in ("brochures", "assets"):
        op.drop_constraint(
            op.f(f"fk_{table}_short_link_id_short_links"), table, type_="foreignkey"
        )
        op.drop_column(table, "short_link_id")
        op.drop_column(table, "is_public")
