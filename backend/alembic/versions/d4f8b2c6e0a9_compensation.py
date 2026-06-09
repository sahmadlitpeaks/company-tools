"""Compensation records + pay bands

Revision ID: d4f8b2c6e0a9
Revises: c3e7a9b1d4f8
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "d4f8b2c6e0a9"
down_revision = "c3e7a9b1d4f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pay_bands",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("level", sa.String(length=40), nullable=True),
        sa.Column("min_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("max_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pay_bands_name", "pay_bands", ["name"])

    op.create_table(
        "compensation_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("record_type", sa.String(length=16), nullable=False, server_default="salary"),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("pay_period", sa.String(length=12), nullable=False, server_default="annual"),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("band_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["band_id"], ["pay_bands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_compensation_records_user_id", "compensation_records", ["user_id"])
    op.create_index("ix_compensation_records_record_type", "compensation_records", ["record_type"])
    op.create_index("ix_compensation_records_effective_date", "compensation_records", ["effective_date"])


def downgrade() -> None:
    op.drop_table("compensation_records")
    op.drop_table("pay_bands")
