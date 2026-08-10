"""projects and task linkage

Revision ID: e3c4d5e6f7a8
Revises: e2b3c4d5e6f7
"""
from alembic import op
import sqlalchemy as sa


revision = "e3c4d5e6f7a8"
down_revision = "e2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_name", "projects", ["name"])
    op.create_index("ix_projects_status", "projects", ["status"])
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
    op.create_index("ix_projects_company_id", "projects", ["company_id"])
    op.add_column("tasks", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    op.create_foreign_key(
        "fk_tasks_project_id", "tasks", "projects", ["project_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("fk_tasks_project_id", "tasks", type_="foreignkey")
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_column("tasks", "project_id")
    op.drop_table("projects")
