"""Project tracker: read-only public share links.

Revision ID: v8f9a0b1c2d3
Revises: u7e8f9a0b1c2
"""
from alembic import op
import sqlalchemy as sa

revision = "v8f9a0b1c2d3"
down_revision = "u7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pm_share_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id", sa.Uuid(),
            sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("view", sa.String(16), nullable=False),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_id", sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_pm_share_links_project_id", "pm_share_links", ["project_id"])
    op.create_index("ix_pm_share_links_token_hash", "pm_share_links", ["token_hash"], unique=True)


def downgrade():
    op.drop_index("ix_pm_share_links_token_hash", table_name="pm_share_links")
    op.drop_index("ix_pm_share_links_project_id", table_name="pm_share_links")
    op.drop_table("pm_share_links")
