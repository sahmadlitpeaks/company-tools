"""company announcements + read receipts

Revision ID: f6b8d0c24539
Revises: e5a7c9b13428
Create Date: 2026-06-05 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6b8d0c24539"
down_revision: Union[str, None] = "e5a7c9b13428"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("brand_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_announcements_is_published", "announcements", ["is_published"])
    op.create_index("ix_announcements_brand_id", "announcements", ["brand_id"])

    op.create_table(
        "announcement_reads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("announcement_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_announcement_reads_announcement_id", "announcement_reads", ["announcement_id"])
    op.create_index("ix_announcement_reads_user_id", "announcement_reads", ["user_id"])


def downgrade() -> None:
    op.drop_table("announcement_reads")
    op.drop_table("announcements")
