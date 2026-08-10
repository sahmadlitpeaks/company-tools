"""dashboard preferences

Revision ID: e2b3c4d5e6f7
Revises: e1a2b3c4d5f6
"""
from alembic import op
import sqlalchemy as sa

revision = "e2b3c4d5e6f7"
down_revision = "e1a2b3c4d5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dashboard_preferences",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("widget_order", sa.JSON(), nullable=False),
        sa.Column("hidden_widgets", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_dashboard_preferences_user_id", "dashboard_preferences", ["user_id"], unique=True)


def downgrade():
    op.drop_table("dashboard_preferences")
