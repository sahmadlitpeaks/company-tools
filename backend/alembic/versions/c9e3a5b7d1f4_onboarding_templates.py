"""Onboarding templates (packets)

Revision ID: c9e3a5b7d1f4
Revises: b8d2f4a6c0e1
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa


revision = "c9e3a5b7d1f4"
down_revision = "b8d2f4a6c0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "onboarding_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="onboarding"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onboarding_templates_name", "onboarding_templates", ["name"])
    op.create_index("ix_onboarding_templates_kind", "onboarding_templates", ["kind"])
    op.create_index("ix_onboarding_templates_active", "onboarding_templates", ["active"])

    op.create_table(
        "onboarding_template_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["template_id"], ["onboarding_templates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onboarding_template_items_template_id", "onboarding_template_items", ["template_id"])


def downgrade() -> None:
    op.drop_table("onboarding_template_items")
    op.drop_table("onboarding_templates")
