"""Rename Brand -> Company (table + all brand_id FKs -> company_id)

Revision ID: a7c1e9f3b5d2
Revises: f6b0d2e8a4c1
Create Date: 2026-06-10

"""
from alembic import op


revision = "a7c1e9f3b5d2"
down_revision = "f6b0d2e8a4c1"
branch_labels = None
depends_on = None

# Tables that carry a brand_id FK to the company entity.
_TABLES = [
    "crm_leads",
    "landing_pages",
    "products",
    "tasks",
    "approval_requests",
    "tickets",
    "announcements",
    "knowledge_articles",
    "subscriptions",
    "tracked_assets",
    "brand_documents",
    "phone_lines",
    "campaigns",
    "short_links",
    "onboarding_journeys",
    "digital_cards",
    "qr_codes",
]


def upgrade() -> None:
    op.rename_table("brands", "companies")
    op.rename_table("user_brands", "user_companies")
    op.alter_column("user_companies", "brand_id", new_column_name="company_id")
    for t in _TABLES:
        op.alter_column(t, "brand_id", new_column_name="company_id")


def downgrade() -> None:
    for t in _TABLES:
        op.alter_column(t, "company_id", new_column_name="brand_id")
    op.alter_column("user_companies", "company_id", new_column_name="brand_id")
    op.rename_table("user_companies", "user_brands")
    op.rename_table("companies", "brands")
