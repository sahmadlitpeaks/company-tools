"""Custom fields & custom tables

Revision ID: f6b0d2e8a4c1
Revises: e5a9c3d7f1b0
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa


revision = "f6b0d2e8a4c1"
down_revision = "e5a9c3d7f1b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_field_defs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity", sa.String(length=24), nullable=False, server_default="employee"),
        sa.Column("section", sa.String(length=64), nullable=False, server_default="custom"),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("field_type", sa.String(length=16), nullable=False, server_default="text"),
        sa.Column("options", sa.JSON(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sensitive", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity", "key", name="uq_custom_field_key"),
    )
    op.create_index("ix_custom_field_defs_entity", "custom_field_defs", ["entity"])
    op.create_index("ix_custom_field_defs_section", "custom_field_defs", ["section"])
    op.create_index("ix_custom_field_defs_key", "custom_field_defs", ["key"])
    op.create_index("ix_custom_field_defs_active", "custom_field_defs", ["active"])

    op.create_table(
        "custom_field_values",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("def_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["def_id"], ["custom_field_defs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("def_id", "user_id", name="uq_custom_value"),
    )
    op.create_index("ix_custom_field_values_def_id", "custom_field_values", ["def_id"])
    op.create_index("ix_custom_field_values_user_id", "custom_field_values", ["user_id"])

    op.create_table(
        "custom_table_defs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("columns", sa.JSON(), nullable=False),
        sa.Column("sensitive", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_custom_table_defs_key", "custom_table_defs", ["key"])
    op.create_index("ix_custom_table_defs_active", "custom_table_defs", ["active"])

    op.create_table(
        "custom_table_rows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("table_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["table_id"], ["custom_table_defs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_custom_table_rows_table_id", "custom_table_rows", ["table_id"])
    op.create_index("ix_custom_table_rows_user_id", "custom_table_rows", ["user_id"])


def downgrade() -> None:
    op.drop_table("custom_table_rows")
    op.drop_table("custom_table_defs")
    op.drop_table("custom_field_values")
    op.drop_table("custom_field_defs")
