"""Add a base font size to company brand identities.

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-08-06
"""

from alembic import op
import sqlalchemy as sa


revision = "g2b3c4d5e6f7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("base_font_size", sa.Integer(), nullable=False, server_default="16"),
    )
    op.alter_column("companies", "base_font_size", server_default=None)


def downgrade() -> None:
    op.drop_column("companies", "base_font_size")
