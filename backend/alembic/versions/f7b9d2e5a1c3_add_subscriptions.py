"""subscriptions + per-person seats

Revision ID: f7b9d2e5a1c3
Revises: e6a8c1d4f2b9
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "f7b9d2e5a1c3"
down_revision = "e6a8c1d4f2b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("vendor", sa.String(length=255), nullable=True),
        sa.Column("plan", sa.String(length=255), nullable=True),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("scope", sa.String(length=16), nullable=False, server_default="person"),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column("cost_type", sa.String(length=12), nullable=False, server_default="flat"),
        sa.Column("cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("billing_cycle", sa.String(length=12), nullable=False, server_default="monthly"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("auto_renew", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("brand_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscriptions_name", "subscriptions", ["name"])
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"])
    op.create_index("ix_subscriptions_scope", "subscriptions", ["scope"])
    op.create_index("ix_subscriptions_department_id", "subscriptions", ["department_id"])
    op.create_index("ix_subscriptions_brand_id", "subscriptions", ["brand_id"])

    op.create_table(
        "subscription_seats",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("subscription_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["subscription_id"], ["subscriptions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["revoked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_seats_subscription_id", "subscription_seats", ["subscription_id"])
    op.create_index("ix_subscription_seats_user_id", "subscription_seats", ["user_id"])
    op.create_index("ix_subscription_seats_status", "subscription_seats", ["status"])


def downgrade() -> None:
    op.drop_table("subscription_seats")
    op.drop_table("subscriptions")
