"""Push devices: per-device registration tokens for push notifications

Revision ID: c5f0d3a8b129
Revises: b4e8c2f6a017
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa


revision = "c5f0d3a8b129"
down_revision = "b4e8c2f6a017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=False, server_default="web"),
        sa.Column("device_label", sa.String(length=120), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])
    op.create_index("ix_push_devices_token", "push_devices", ["token"], unique=True)
    op.create_index("ix_push_devices_active", "push_devices", ["active"])


def downgrade() -> None:
    op.drop_index("ix_push_devices_active", table_name="push_devices")
    op.drop_index("ix_push_devices_token", table_name="push_devices")
    op.drop_index("ix_push_devices_user_id", table_name="push_devices")
    op.drop_table("push_devices")
