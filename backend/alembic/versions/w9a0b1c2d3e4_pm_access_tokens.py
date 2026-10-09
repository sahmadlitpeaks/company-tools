"""Project tracker: personal access tokens for AI assistants (MCP).

Revision ID: w9a0b1c2d3e4
Revises: v8f9a0b1c2d3
"""
from alembic import op
import sqlalchemy as sa

revision = "w9a0b1c2d3e4"
down_revision = "v8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pm_access_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("can_write", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_pm_access_tokens_user_id", "pm_access_tokens", ["user_id"])
    op.create_index("ix_pm_access_tokens_token_hash", "pm_access_tokens", ["token_hash"], unique=True)


def downgrade():
    op.drop_index("ix_pm_access_tokens_token_hash", table_name="pm_access_tokens")
    op.drop_index("ix_pm_access_tokens_user_id", table_name="pm_access_tokens")
    op.drop_table("pm_access_tokens")
