"""add ad sync columns, partial indexes and ad_sync_runs

Revision ID: i4d5e6f7a8b9
Revises: h3c4d5e6f7a8
"""
import sqlalchemy as sa
from alembic import op

revision = "i4d5e6f7a8b9"
down_revision = "h3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("provider", sa.String(16), nullable=True))
    op.add_column("campaigns", sa.Column("external_id", sa.String(64), nullable=True))
    op.create_index("ix_campaigns_provider", "campaigns", ["provider"])
    op.create_index(
        "uq_campaigns_provider_external",
        "campaigns",
        ["provider", "external_id"],
        unique=True,
        postgresql_where=sa.text("provider IS NOT NULL"),
    )

    op.add_column(
        "campaign_metrics",
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
    )
    op.create_index("ix_campaign_metrics_source", "campaign_metrics", ["source"])
    op.add_column("campaign_metrics", sa.Column("currency", sa.String(3), nullable=True))
    op.add_column(
        "campaign_metrics", sa.Column("spend_original", sa.Numeric(14, 2), nullable=True)
    )
    op.add_column(
        "campaign_metrics", sa.Column("revenue_original", sa.Numeric(14, 2), nullable=True)
    )
    op.add_column(
        "campaign_metrics", sa.Column("fx_rate", sa.Numeric(18, 8), nullable=True)
    )
    op.create_index(
        "uq_campaign_metrics_sync_row",
        "campaign_metrics",
        ["campaign_id", "channel", "date"],
        unique=True,
        postgresql_where=sa.text("source = 'sync'"),
    )

    op.create_table(
        "ad_sync_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("campaigns_synced", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metrics_upserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_ad_sync_runs_provider", "ad_sync_runs", ["provider"])


def downgrade() -> None:
    op.drop_index("ix_ad_sync_runs_provider", table_name="ad_sync_runs")
    op.drop_table("ad_sync_runs")
    op.drop_index("uq_campaign_metrics_sync_row", table_name="campaign_metrics")
    op.drop_column("campaign_metrics", "fx_rate")
    op.drop_column("campaign_metrics", "revenue_original")
    op.drop_column("campaign_metrics", "spend_original")
    op.drop_column("campaign_metrics", "currency")
    op.drop_index("ix_campaign_metrics_source", table_name="campaign_metrics")
    op.drop_column("campaign_metrics", "source")
    op.drop_index("uq_campaigns_provider_external", table_name="campaigns")
    op.drop_index("ix_campaigns_provider", table_name="campaigns")
    op.drop_column("campaigns", "external_id")
    op.drop_column("campaigns", "provider")
