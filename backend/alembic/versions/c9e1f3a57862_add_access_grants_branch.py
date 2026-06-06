"""access grants + journey branch (sub-company)

Revision ID: c9e1f3a57862
Revises: b8d0f2a46751
Create Date: 2026-06-05 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9e1f3a57862"
down_revision: Union[str, None] = "b8d0f2a46751"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "onboarding_journeys", sa.Column("brand_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_onboarding_journeys_brand_id_brands"),
        "onboarding_journeys",
        "brands",
        ["brand_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_onboarding_journeys_brand_id", "onboarding_journeys", ["brand_id"]
    )

    op.create_table(
        "access_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("journey_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("system", sa.String(length=64), nullable=True),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("granted_by_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_by_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["journey_id"], ["onboarding_journeys.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["granted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revoked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_grants_user_id", "access_grants", ["user_id"])
    op.create_index("ix_access_grants_status", "access_grants", ["status"])


def downgrade() -> None:
    op.drop_table("access_grants")
    op.drop_index("ix_onboarding_journeys_brand_id", table_name="onboarding_journeys")
    op.drop_constraint(
        op.f("fk_onboarding_journeys_brand_id_brands"),
        "onboarding_journeys",
        type_="foreignkey",
    )
    op.drop_column("onboarding_journeys", "brand_id")
