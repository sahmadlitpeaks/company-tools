"""HR documents

Revision ID: b2d6f8a1c3e7
Revises: a1c4e7f0b2d5
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "b2d6f8a1c3e7"
down_revision = "a1c4e7f0b2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hr_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("file_path", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hr_documents_user_id", "hr_documents", ["user_id"])
    op.create_index("ix_hr_documents_category", "hr_documents", ["category"])
    op.create_index("ix_hr_documents_expiry_date", "hr_documents", ["expiry_date"])


def downgrade() -> None:
    op.drop_table("hr_documents")
