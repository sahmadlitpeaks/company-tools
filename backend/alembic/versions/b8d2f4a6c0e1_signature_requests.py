"""E-signature requests on HR documents

Revision ID: b8d2f4a6c0e1
Revises: a7c1e9f3b5d2
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa


revision = "b8d2f4a6c0e1"
down_revision = "a7c1e9f3b5d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "signature_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("typed_name", sa.String(length=255), nullable=True),
        sa.Column("signed_at", sa.Date(), nullable=True),
        sa.Column("audit_ip", sa.String(length=64), nullable=True),
        sa.Column("audit_agent", sa.String(length=512), nullable=True),
        sa.Column("requested_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["hr_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_signature_requests_document_id", "signature_requests", ["document_id"])
    op.create_index("ix_signature_requests_user_id", "signature_requests", ["user_id"])
    op.create_index("ix_signature_requests_status", "signature_requests", ["status"])


def downgrade() -> None:
    op.drop_table("signature_requests")
