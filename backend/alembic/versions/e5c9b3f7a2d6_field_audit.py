"""Per-field change audit

Revision ID: e5c9b3f7a2d6
Revises: d2b6f8a4c0e1
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "e5c9b3f7a2d6"
down_revision = "d2b6f8a4c0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "field_changes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False, server_default="user"),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("field", sa.String(length=64), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_field_changes_entity_type", "field_changes", ["entity_type"])
    op.create_index("ix_field_changes_entity_id", "field_changes", ["entity_id"])
    op.create_index("ix_field_changes_field", "field_changes", ["field"])


def downgrade() -> None:
    op.drop_index("ix_field_changes_field", table_name="field_changes")
    op.drop_index("ix_field_changes_entity_id", table_name="field_changes")
    op.drop_index("ix_field_changes_entity_type", table_name="field_changes")
    op.drop_table("field_changes")
