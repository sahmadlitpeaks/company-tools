"""saved filter views for list surfaces

Revision ID: a1c3e5d7f9b2
Revises: f8e2a1c4d6b9
Create Date: 2026-06-06

"""
from alembic import op
import sqlalchemy as sa


revision = "a1c3e5d7f9b2"
down_revision = "f8e2a1c4d6b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("surface", sa.String(length=24), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("params", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "surface", "name", name="uq_saved_view"),
    )
    op.create_index("ix_saved_views_user_id", "saved_views", ["user_id"])
    op.create_index("ix_saved_views_surface", "saved_views", ["surface"])


def downgrade() -> None:
    op.drop_index("ix_saved_views_surface", table_name="saved_views")
    op.drop_index("ix_saved_views_user_id", table_name="saved_views")
    op.drop_table("saved_views")
