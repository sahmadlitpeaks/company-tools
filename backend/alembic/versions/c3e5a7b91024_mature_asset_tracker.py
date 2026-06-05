"""asset tracker: condition, maintenance schedule, disposal, categories,
locations, attachments

Revision ID: c3e5a7b91024
Revises: b2d4f6a80931
Create Date: 2026-06-05 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3e5a7b91024"
down_revision: Union[str, None] = "b2d4f6a80931"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tracked_assets", sa.Column("condition", sa.String(length=16), nullable=True))
    op.add_column("tracked_assets", sa.Column("next_maintenance_date", sa.Date(), nullable=True))
    op.add_column("tracked_assets", sa.Column("maintenance_interval_days", sa.Integer(), nullable=True))
    op.add_column("tracked_assets", sa.Column("disposal_date", sa.Date(), nullable=True))
    op.add_column("tracked_assets", sa.Column("salvage_value", sa.Numeric(12, 2), nullable=True))
    op.add_column("tracked_assets", sa.Column("disposal_notes", sa.Text(), nullable=True))

    op.create_table(
        "asset_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_categories_name", "asset_categories", ["name"], unique=True)

    op.create_table(
        "asset_locations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_locations_name", "asset_locations", ["name"], unique=True)

    op.create_table(
        "asset_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="document"),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("file_path", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("uploaded_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["tracked_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_attachments_asset_id", "asset_attachments", ["asset_id"])


def downgrade() -> None:
    op.drop_index("ix_asset_attachments_asset_id", table_name="asset_attachments")
    op.drop_table("asset_attachments")
    op.drop_index("ix_asset_locations_name", table_name="asset_locations")
    op.drop_table("asset_locations")
    op.drop_index("ix_asset_categories_name", table_name="asset_categories")
    op.drop_table("asset_categories")
    op.drop_column("tracked_assets", "disposal_notes")
    op.drop_column("tracked_assets", "salvage_value")
    op.drop_column("tracked_assets", "disposal_date")
    op.drop_column("tracked_assets", "maintenance_interval_days")
    op.drop_column("tracked_assets", "next_maintenance_date")
    op.drop_column("tracked_assets", "condition")
