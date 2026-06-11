"""Expense claims

Revision ID: a7e1c5d9b3f8
Revises: f6d0a4c8b2e3
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "a7e1c5d9b3f8"
down_revision = "f6d0a4c8b2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expense_claims",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("expense_date", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("receipt_path", sa.String(length=1024), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("approval_request_id", sa.Uuid(), nullable=True),
        sa.Column("reimbursed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reimbursed_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approval_request_id"], ["approval_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reimbursed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_expense_claims_user_id", "expense_claims", ["user_id"])
    op.create_index("ix_expense_claims_category", "expense_claims", ["category"])
    op.create_index("ix_expense_claims_status", "expense_claims", ["status"])


def downgrade() -> None:
    op.drop_index("ix_expense_claims_status", table_name="expense_claims")
    op.drop_index("ix_expense_claims_category", table_name="expense_claims")
    op.drop_index("ix_expense_claims_user_id", table_name="expense_claims")
    op.drop_table("expense_claims")
