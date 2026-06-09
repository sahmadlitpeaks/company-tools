"""share controls, document versions, open analytics

Revision ID: a1c2e3f40581
Revises: f7d4e1a9c812
Create Date: 2026-06-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c2e3f40581"
down_revision: Union[str, None] = "f7d4e1a9c812"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Access controls on the short link that backs a share (also usable by the
    # plain URL shortener).
    op.add_column(
        "short_links",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "short_links", sa.Column("passcode_hash", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "short_links",
        sa.Column(
            "require_lead", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )

    # Brochure: who uploaded it (for "your share was opened" alerts) + version.
    op.add_column("brochures", sa.Column("created_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_brochures_created_by_id_users"),
        "brochures",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "brochures",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )

    # Asset: download counter (for analytics) + version.
    op.add_column(
        "assets",
        sa.Column(
            "download_count", sa.BigInteger(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "assets",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )

    # Version history shared by brochures and assets.
    op.create_table(
        "doc_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("doc_type", sa.String(length=16), nullable=False),
        sa.Column("doc_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_doc_versions_doc_type", "doc_versions", ["doc_type"]
    )
    op.create_index("ix_doc_versions_doc_id", "doc_versions", ["doc_id"])


def downgrade() -> None:
    op.drop_index("ix_doc_versions_doc_id", table_name="doc_versions")
    op.drop_index("ix_doc_versions_doc_type", table_name="doc_versions")
    op.drop_table("doc_versions")
    op.drop_column("assets", "version")
    op.drop_column("assets", "download_count")
    op.drop_column("brochures", "version")
    op.drop_constraint(
        op.f("fk_brochures_created_by_id_users"), "brochures", type_="foreignkey"
    )
    op.drop_column("brochures", "created_by_id")
    op.drop_column("short_links", "require_lead")
    op.drop_column("short_links", "passcode_hash")
    op.drop_column("short_links", "expires_at")
