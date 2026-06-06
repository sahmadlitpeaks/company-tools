"""work logs + personal workspace (quick docs)

Revision ID: d1f3b5a79864
Revises: c9e1f3a57862
Create Date: 2026-06-05 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1f3b5a79864"
down_revision: Union[str, None] = "c9e1f3a57862"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "work_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("entity_type", sa.String(length=24), nullable=True),
        sa.Column("entity_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_work_logs_user_id", "work_logs", ["user_id"])
    op.create_index("ix_work_logs_work_date", "work_logs", ["work_date"])
    op.create_index("ix_work_logs_kind", "work_logs", ["kind"])
    op.create_index("ix_work_logs_entity_type", "work_logs", ["entity_type"])
    op.create_index("ix_work_logs_entity_id", "work_logs", ["entity_id"])

    op.create_table(
        "workspace_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="note"),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("file_path", sa.String(length=1024), nullable=True),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("tags", sa.String(length=512), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workspace_items_owner_id", "workspace_items", ["owner_id"])
    op.create_index("ix_workspace_items_kind", "workspace_items", ["kind"])
    op.create_index("ix_workspace_items_shared", "workspace_items", ["shared"])


def downgrade() -> None:
    op.drop_table("workspace_items")
    op.drop_table("work_logs")
