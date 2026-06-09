"""add brands and brand_id links

Revision ID: f6c2a9b41d70
Revises: e5b1c7d39a28
Create Date: 2026-06-02 16:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6c2a9b41d70"
down_revision: Union[str, None] = "e5b1c7d39a28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_BRAND_ID = "b5a4d000-0000-4000-8000-000000000001"
LINK_TABLES = [
    "digital_cards",
    "products",
    "qr_codes",
    "short_links",
    "landing_pages",
    "tracked_assets",
]


def upgrade() -> None:
    op.create_table(
        "brands",
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("logo_url", sa.String(length=1024), nullable=True),
        sa.Column("icon_url", sa.String(length=1024), nullable=True),
        sa.Column("primary_color", sa.String(length=9), nullable=False),
        sa.Column("secondary_color", sa.String(length=9), nullable=True),
        sa.Column("accent_color", sa.String(length=9), nullable=False),
        sa.Column("font_family", sa.String(length=255), nullable=True),
        sa.Column("website", sa.String(length=512), nullable=True),
        sa.Column("email_domain", sa.String(length=255), nullable=True),
        sa.Column("contact_email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("tagline", sa.String(length=512), nullable=True),
        sa.Column("social", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_brands_slug"), "brands", ["slug"], unique=True)

    # Seed the default brand (existing single-brand data rolls up under it).
    op.execute(
        f"""
        INSERT INTO brands (id, slug, name, primary_color, accent_color, website,
                            is_active, is_default, created_at, updated_at)
        VALUES ('{DEFAULT_BRAND_ID}', 'ag-holding', 'AG Holding', '#0b5cab',
                '#0b5cab', 'https://agholding.net', true, true,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """
    )

    for t in LINK_TABLES:
        op.add_column(t, sa.Column("brand_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_{t}_brand", t, "brands", ["brand_id"], ["id"], ondelete="SET NULL"
        )
        op.create_index(f"ix_{t}_brand_id", t, ["brand_id"])
        op.execute(
            f"UPDATE {t} SET brand_id = '{DEFAULT_BRAND_ID}' WHERE brand_id IS NULL"
        )


def downgrade() -> None:
    for t in LINK_TABLES:
        op.drop_index(f"ix_{t}_brand_id", table_name=t)
        op.drop_constraint(f"fk_{t}_brand", t, type_="foreignkey")
        op.drop_column(t, "brand_id")
    op.drop_index(op.f("ix_brands_slug"), table_name="brands")
    op.drop_table("brands")
