"""Multiple SharePoint sources and a durable upload notification outbox."""
from alembic import op
import sqlalchemy as sa

revision = "s5c6d7e8f9a0"
down_revision = "r4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sharepoint_sources", sa.Column("name", sa.String(128), nullable=False, server_default="SharePoint source"))
    op.add_column("sharepoint_sources", sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    # Legacy source rows from older environment configurations stay dormant.
    # The configured source is registered by the compatibility bootstrap;
    # administrators explicitly register additional sources through the API.
    op.add_column("sharepoint_sources", sa.Column("registered", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("sharepoint_sources", sa.Column("baseline_completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sharepoint_sources", sa.Column("teams_notify_uploads", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("sharepoint_sources", sa.Column("teams_channel_name", sa.String(128), nullable=True))
    op.add_column("sharepoint_sources", sa.Column("teams_webhook_cipher", sa.Text(), nullable=True))
    op.add_column("sharepoint_sources", sa.Column("notification_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("sharepoint_sources", sa.Column("notify_after", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("upload_notification_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Existing installations must complete one discovery pass as a baseline too.
    # This avoids announcing historical, previously unindexed files after upgrade.
    op.create_table(
        "sharepoint_upload_deliveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("source_id", sa.Uuid(), sa.ForeignKey("sharepoint_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("sharepoint_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notification_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(80), nullable=True),
        sa.Column("lease_owner", sa.String(36), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("source_id", "document_id", name="uq_sharepoint_upload_delivery"),
    )
    op.create_index("ix_sharepoint_upload_deliveries_source_id", "sharepoint_upload_deliveries", ["source_id"])


def downgrade():
    op.drop_table("sharepoint_upload_deliveries")
    op.drop_column("sharepoint_documents", "upload_notification_pending")
    for column in ("notify_after", "notification_version", "teams_webhook_cipher", "teams_channel_name", "teams_notify_uploads",
                   "baseline_completed_at", "registered", "enabled", "name"):
        op.drop_column("sharepoint_sources", column)
