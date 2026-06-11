"""Configurable approval workflows + step instances

Revision ID: d2b6f8a4c0e1
Revises: c4f8a2d6e1b9
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "d2b6f8a4c0e1"
down_revision = "c4f8a2d6e1b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "approval_workflows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=24), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("steps", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_workflows_type", "approval_workflows", ["type"])
    op.create_index("ix_approval_workflows_active", "approval_workflows", ["active"])

    op.create_table(
        "approval_steps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approver_kind", sa.String(length=16), nullable=False, server_default="manager"),
        sa.Column("approver_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("decided_by_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["approval_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approver_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_steps_request_id", "approval_steps", ["request_id"])
    op.create_index("ix_approval_steps_status", "approval_steps", ["status"])


def downgrade() -> None:
    op.drop_index("ix_approval_steps_status", table_name="approval_steps")
    op.drop_index("ix_approval_steps_request_id", table_name="approval_steps")
    op.drop_table("approval_steps")
    op.drop_index("ix_approval_workflows_active", table_name="approval_workflows")
    op.drop_index("ix_approval_workflows_type", table_name="approval_workflows")
    op.drop_table("approval_workflows")
