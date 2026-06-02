"""add crm leads

Revision ID: c9f1a3b5e082
Revises: b8e4f0a26d31
Create Date: 2026-06-02 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9f1a3b5e082"
down_revision: Union[str, None] = "b8e4f0a26d31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crm_leads",
        sa.Column("brand_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("company", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_detail", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("value", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("origin_type", sa.String(length=32), nullable=True),
        sa.Column("origin_id", sa.String(length=64), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_crm_leads_brand_id"), "crm_leads", ["brand_id"])
    op.create_index(op.f("ix_crm_leads_email"), "crm_leads", ["email"])
    op.create_index(op.f("ix_crm_leads_source"), "crm_leads", ["source"])
    op.create_index(op.f("ix_crm_leads_status"), "crm_leads", ["status"])
    op.create_index(op.f("ix_crm_leads_owner_id"), "crm_leads", ["owner_id"])
    op.create_index(op.f("ix_crm_leads_origin_id"), "crm_leads", ["origin_id"])


def downgrade() -> None:
    op.drop_table("crm_leads")
