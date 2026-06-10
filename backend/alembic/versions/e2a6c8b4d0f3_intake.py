"""Inbound intake: sources + submissions

Revision ID: e2a6c8b4d0f3
Revises: d1f5b3a7c2e8
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa


revision = "e2a6c8b4d0f3"
down_revision = "d1f5b3a7c2e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intake_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("default_type", sa.String(length=16), nullable=False, server_default="lead"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["notify_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_intake_sources_key", "intake_sources", ["key"])
    op.create_index("ix_intake_sources_active", "intake_sources", ["active"])

    op.create_table(
        "submissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("type", sa.String(length=16), nullable=False, server_default="lead"),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("company", sa.String(length=255), nullable=True),
        sa.Column("subject", sa.String(length=512), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("page_url", sa.String(length=1024), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="new"),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("converted_lead_id", sa.Uuid(), nullable=True),
        sa.Column("converted_ticket_id", sa.Uuid(), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["intake_sources.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_submissions_source_id", "submissions", ["source_id"])
    op.create_index("ix_submissions_type", "submissions", ["type"])
    op.create_index("ix_submissions_status", "submissions", ["status"])
    op.create_index("ix_submissions_email", "submissions", ["email"])
    op.create_index("ix_submissions_assignee_id", "submissions", ["assignee_id"])


def downgrade() -> None:
    op.drop_table("submissions")
    op.drop_table("intake_sources")
