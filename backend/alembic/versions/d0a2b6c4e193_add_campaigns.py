"""add campaigns and metrics

Revision ID: d0a2b6c4e193
Revises: c9f1a3b5e082
Create Date: 2026-06-02 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d0a2b6c4e193"
down_revision: Union[str, None] = "c9f1a3b5e082"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("brand_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("objective", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_campaigns_brand_id"), "campaigns", ["brand_id"])
    op.create_index(op.f("ix_campaigns_status"), "campaigns", ["status"])

    op.create_table(
        "campaign_metrics",
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("spend", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("impressions", sa.BigInteger(), nullable=False),
        sa.Column("clicks", sa.BigInteger(), nullable=False),
        sa.Column("conversions", sa.BigInteger(), nullable=False),
        sa.Column("revenue", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_campaign_metrics_campaign_id"), "campaign_metrics", ["campaign_id"])
    op.create_index(op.f("ix_campaign_metrics_channel"), "campaign_metrics", ["channel"])


def downgrade() -> None:
    op.drop_table("campaign_metrics")
    op.drop_table("campaigns")
