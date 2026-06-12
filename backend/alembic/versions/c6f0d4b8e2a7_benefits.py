"""Benefits administration: plans, enrollments, dependents

Revision ID: c6f0d4b8e2a7
Revises: b5e9c3a7d1f6
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "c6f0d4b8e2a7"
down_revision = "b5e9c3a7d1f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "benefit_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="health"),
        sa.Column("carrier", sa.String(length=160), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("employee_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("employer_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("enrollment_open", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_benefit_plans_name", "benefit_plans", ["name"])
    op.create_index("ix_benefit_plans_category", "benefit_plans", ["category"])
    op.create_index("ix_benefit_plans_active", "benefit_plans", ["active"])

    op.create_table(
        "benefit_enrollments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="enrolled"),
        sa.Column("coverage_level", sa.String(length=24), nullable=False, server_default="employee"),
        sa.Column("elected_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["benefit_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_benefit_enrollments_plan_id", "benefit_enrollments", ["plan_id"])
    op.create_index("ix_benefit_enrollments_user_id", "benefit_enrollments", ["user_id"])
    op.create_index("ix_benefit_enrollments_status", "benefit_enrollments", ["status"])

    op.create_table(
        "dependents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("relationship_type", sa.String(length=24), nullable=False, server_default="child"),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dependents_user_id", "dependents", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_dependents_user_id", table_name="dependents")
    op.drop_table("dependents")
    op.drop_index("ix_benefit_enrollments_status", table_name="benefit_enrollments")
    op.drop_index("ix_benefit_enrollments_user_id", table_name="benefit_enrollments")
    op.drop_index("ix_benefit_enrollments_plan_id", table_name="benefit_enrollments")
    op.drop_table("benefit_enrollments")
    op.drop_index("ix_benefit_plans_active", table_name="benefit_plans")
    op.drop_index("ix_benefit_plans_category", table_name="benefit_plans")
    op.drop_index("ix_benefit_plans_name", table_name="benefit_plans")
    op.drop_table("benefit_plans")
