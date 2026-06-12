"""departments (access groups) + per-user grants/revokes

Revision ID: d5f7a9c2e4b8
Revises: c4e6f8b1d3a7
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "d5f7a9c2e4b8"
down_revision = "c4e6f8b1d3a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("permissions", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_departments_name", "departments", ["name"], unique=True)

    op.add_column("users", sa.Column("department_id", sa.Uuid(), nullable=True))
    op.add_column("users", sa.Column("extra_permissions", sa.JSON(), nullable=True))
    op.add_column("users", sa.Column("revoked_permissions", sa.JSON(), nullable=True))
    op.create_index("ix_users_department_id", "users", ["department_id"])
    op.create_foreign_key(
        "fk_users_department_id", "users", "departments", ["department_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_department_id", "users", type_="foreignkey")
    op.drop_index("ix_users_department_id", table_name="users")
    op.drop_column("users", "revoked_permissions")
    op.drop_column("users", "extra_permissions")
    op.drop_column("users", "department_id")
    op.drop_index("ix_departments_name", table_name="departments")
    op.drop_table("departments")
