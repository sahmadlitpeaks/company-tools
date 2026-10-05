"""Add path to sharepoint_documents and create sharepoint_reminders table.

Revision ID: i5e6f7a8b9c0
Revises: i4d5e6f7a8b9
Create Date: 2026-09-16 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "i5e6f7a8b9c0"
down_revision = "i4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sharepoint_documents", sa.Column("path", sa.Text(), nullable=True, server_default=""))
    op.create_table(
        "sharepoint_reminders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False, server_default="expiry"),
        sa.Column("target_date", sa.String(length=10), nullable=False),
        sa.Column("reminder_date", sa.String(length=10), nullable=False),
        sa.Column("lead_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("responsible_name", sa.String(length=255), nullable=True),
        sa.Column("recipient_email", sa.String(length=320), nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("dedup_key", sa.String(length=128), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["sharepoint_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["sharepoint_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "dedup_key", name="uq_sharepoint_reminder_dedup"),
    )
    op.create_index("ix_sharepoint_reminders_source_id", "sharepoint_reminders", ["source_id"])
    op.create_index("ix_sharepoint_reminders_document_id", "sharepoint_reminders", ["document_id"])
    op.create_index("ix_sharepoint_reminders_reminder_date", "sharepoint_reminders", ["reminder_date"])
    op.create_index("ix_sharepoint_reminders_status", "sharepoint_reminders", ["status"])


def downgrade():
    op.drop_index("ix_sharepoint_reminders_status", table_name="sharepoint_reminders")
    op.drop_index("ix_sharepoint_reminders_reminder_date", table_name="sharepoint_reminders")
    op.drop_index("ix_sharepoint_reminders_document_id", table_name="sharepoint_reminders")
    op.drop_index("ix_sharepoint_reminders_source_id", table_name="sharepoint_reminders")
    op.drop_table("sharepoint_reminders")
    op.drop_column("sharepoint_documents", "path")
