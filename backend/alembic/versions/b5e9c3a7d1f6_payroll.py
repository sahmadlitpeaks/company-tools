"""Payroll runs and payslips

Revision ID: b5e9c3a7d1f6
Revises: a4d8f2c6b0e3
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "b5e9c3a7d1f6"
down_revision = "a4d8f2c6b0e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period", name="uq_payroll_period"),
    )
    op.create_index("ix_payroll_runs_period", "payroll_runs", ["period"])
    op.create_index("ix_payroll_runs_status", "payroll_runs", ["status"])

    op.create_table(
        "payslips",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("base_salary", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("items", sa.JSON(), nullable=True),
        sa.Column("gross", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("deductions", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("net", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["payroll_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "user_id", name="uq_payslip_user"),
    )
    op.create_index("ix_payslips_run_id", "payslips", ["run_id"])
    op.create_index("ix_payslips_user_id", "payslips", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_payslips_user_id", table_name="payslips")
    op.drop_index("ix_payslips_run_id", table_name="payslips")
    op.drop_table("payslips")
    op.drop_index("ix_payroll_runs_status", table_name="payroll_runs")
    op.drop_index("ix_payroll_runs_period", table_name="payroll_runs")
    op.drop_table("payroll_runs")
