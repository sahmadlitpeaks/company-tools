"""Two-factor authentication fields

Revision ID: c9a3e7f1d5b8
Revises: b8f2d6a0c4e7
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "c9a3e7f1d5b8"
down_revision = "b8f2d6a0c4e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("mfa_secret", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("mfa_enabled")
        batch.drop_column("mfa_secret")
