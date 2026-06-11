"""Outbound webhooks + delivery log

Revision ID: c4f8a2d6e1b9
Revises: b3e7c1a9d5f4
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "c4f8a2d6e1b9"
down_revision = "b3e7c1a9d5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("secret", sa.String(length=128), nullable=True),
        sa.Column("events", sa.JSON(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webhooks_active", "webhooks", ["active"])

    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("webhook_id", sa.Uuid(), nullable=False),
        sa.Column("event", sa.String(length=48), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["webhook_id"], ["webhooks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webhook_deliveries_webhook_id", "webhook_deliveries", ["webhook_id"])
    op.create_index("ix_webhook_deliveries_event", "webhook_deliveries", ["event"])
    op.create_index("ix_webhook_deliveries_success", "webhook_deliveries", ["success"])


def downgrade() -> None:
    op.drop_table("webhook_deliveries")
    op.drop_index("ix_webhooks_active", table_name="webhooks")
    op.drop_table("webhooks")
