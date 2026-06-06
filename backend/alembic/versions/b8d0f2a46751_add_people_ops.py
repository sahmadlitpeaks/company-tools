"""onboarding & offboarding journeys + checklist tasks

Revision ID: b8d0f2a46751
Revises: a7c9e1b35640
Create Date: 2026-06-05 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8d0f2a46751"
down_revision: Union[str, None] = "a7c9e1b35640"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "onboarding_journeys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="in_progress"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onboarding_journeys_kind", "onboarding_journeys", ["kind"])
    op.create_index("ix_onboarding_journeys_status", "onboarding_journeys", ["status"])
    op.create_index("ix_onboarding_journeys_target_user_id", "onboarding_journeys", ["target_user_id"])

    op.create_table(
        "onboarding_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("journey_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("done_by_id", sa.Uuid(), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["journey_id"], ["onboarding_journeys.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["done_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onboarding_tasks_journey_id", "onboarding_tasks", ["journey_id"])
    op.create_index("ix_onboarding_tasks_status", "onboarding_tasks", ["status"])
    op.create_index("ix_onboarding_tasks_owner_id", "onboarding_tasks", ["owner_id"])


def downgrade() -> None:
    op.drop_table("onboarding_tasks")
    op.drop_table("onboarding_journeys")
