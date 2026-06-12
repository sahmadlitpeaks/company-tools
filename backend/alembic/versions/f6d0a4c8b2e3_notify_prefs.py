"""User notification preferences (muted categories)

Revision ID: f6d0a4c8b2e3
Revises: e5c9b3f7a2d6
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "f6d0a4c8b2e3"
down_revision = "e5c9b3f7a2d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("notify_muted", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notify_muted")
