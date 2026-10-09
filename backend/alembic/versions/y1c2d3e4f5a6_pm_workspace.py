"""Named boards, saved views and project configuration.

Revision ID: y1c2d3e4f5a6
Revises: x0b1c2d3e4f5
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "y1c2d3e4f5a6"
down_revision = "x0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("pm_projects", sa.Column("workspace_config", sa.JSON(), nullable=True))
    op.add_column("pm_issues", sa.Column("workflow_state", sa.String(64), nullable=True))
    op.add_column("pm_issues", sa.Column("component", sa.String(64), nullable=True))
    op.add_column("pm_issues", sa.Column("custom_fields", sa.JSON(), nullable=True))
    op.create_table(
        "pm_views",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("visibility", sa.String(16), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pm_views_project_id", "pm_views", ["project_id"])
    op.create_index("ix_pm_views_owner_id", "pm_views", ["owner_id"])
    db = op.get_bind()
    db.execute(sa.text("UPDATE pm_issues SET workflow_state = status"))
    projects = sa.table("pm_projects", sa.column("id", sa.Uuid()), sa.column("lead_id", sa.Uuid()),
                        sa.column("created_by_id", sa.Uuid()), sa.column("sprints_enabled", sa.Boolean()))
    views = sa.table("pm_views", sa.column("id", sa.Uuid()), sa.column("project_id", sa.Uuid()),
                     sa.column("owner_id", sa.Uuid()), sa.column("name", sa.String()),
                     sa.column("visibility", sa.String()), sa.column("settings", sa.JSON()))
    for row in db.execute(sa.select(projects)).mappings():
        owner = row["lead_id"] or row["created_by_id"]
        if owner:
            db.execute(views.insert().values(
                id=uuid.uuid4(), project_id=row["id"], owner_id=owner, name="Team board",
                visibility="team", settings={"layout": "board", "board_type": "scrum" if row["sprints_enabled"] else "kanban"},
            ))


def downgrade():
    op.drop_index("ix_pm_views_owner_id", table_name="pm_views")
    op.drop_index("ix_pm_views_project_id", table_name="pm_views")
    op.drop_table("pm_views")
    op.drop_column("pm_issues", "custom_fields")
    op.drop_column("pm_issues", "component")
    op.drop_column("pm_issues", "workflow_state")
    op.drop_column("pm_projects", "workspace_config")
