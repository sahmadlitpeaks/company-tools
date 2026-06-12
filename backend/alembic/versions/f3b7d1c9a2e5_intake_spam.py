"""Intake spam screening: scores + auto_convert + quarantine default

Revision ID: f3b7d1c9a2e5
Revises: e2a6c8b4d0f3
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa


revision = "f3b7d1c9a2e5"
down_revision = "e2a6c8b4d0f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("intake_sources", sa.Column("auto_convert", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("submissions", sa.Column("spam_score", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("submissions", sa.Column("spam_reasons", sa.JSON(), nullable=True))
    op.alter_column("submissions", "status", server_default="quarantined")


def downgrade() -> None:
    op.alter_column("submissions", "status", server_default="new")
    op.drop_column("submissions", "spam_reasons")
    op.drop_column("submissions", "spam_score")
    op.drop_column("intake_sources", "auto_convert")
