"""phone lines: numbers, assignment history and billing

Revision ID: c4e6f8b1d3a7
Revises: b3d5f7a9c1e4
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa


revision = "c4e6f8b1d3a7"
down_revision = "b3d5f7a9c1e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "phone_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(length=40), nullable=False),
        sa.Column("carrier", sa.String(length=128), nullable=True),
        sa.Column("plan_name", sa.String(length=255), nullable=True),
        sa.Column("sim_number", sa.String(length=64), nullable=True),
        sa.Column("monthly_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("data_allowance", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="available"),
        sa.Column("assigned_to_id", sa.Uuid(), nullable=True),
        sa.Column("brand_id", sa.Uuid(), nullable=True),
        sa.Column("contract_start", sa.Date(), nullable=True),
        sa.Column("contract_end", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_phone_lines_number", "phone_lines", ["number"], unique=True)
    op.create_index("ix_phone_lines_status", "phone_lines", ["status"])
    op.create_index("ix_phone_lines_assigned_to_id", "phone_lines", ["assigned_to_id"])
    op.create_index("ix_phone_lines_brand_id", "phone_lines", ["brand_id"])

    op.create_table(
        "phone_line_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("line_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=24), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("performed_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["line_id"], ["phone_lines.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["performed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_phone_line_events_line_id", "phone_line_events", ["line_id"])

    op.create_table(
        "phone_bills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("line_id", sa.Uuid(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("data_used", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="unpaid"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["line_id"], ["phone_lines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_phone_bills_line_id", "phone_bills", ["line_id"])


def downgrade() -> None:
    op.drop_index("ix_phone_bills_line_id", table_name="phone_bills")
    op.drop_table("phone_bills")
    op.drop_index("ix_phone_line_events_line_id", table_name="phone_line_events")
    op.drop_table("phone_line_events")
    for ix in ("brand_id", "assigned_to_id", "status", "number"):
        op.drop_index(f"ix_phone_lines_{ix}", table_name="phone_lines")
    op.drop_table("phone_lines")
