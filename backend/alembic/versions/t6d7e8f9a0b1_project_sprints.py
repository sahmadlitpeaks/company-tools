"""Project tracker sprints: optional per project, issues belong to one sprint.

Revision ID: t6d7e8f9a0b1
Revises: s6d7e8f9a0b1
"""
from alembic import op
import sqlalchemy as sa

revision = "t6d7e8f9a0b1"
down_revision = "s6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "pm_projects",
        sa.Column("sprints_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "pm_projects", sa.Column("sprint_seq", sa.Integer(), nullable=False, server_default="0")
    )
    op.create_table(
        "pm_sprints",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id", sa.Uuid(),
            sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="future"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_points", sa.Float(), nullable=True),
        sa.Column("committed_points", sa.Float(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_pm_sprints_project_id", "pm_sprints", ["project_id"])
    op.create_index("ix_pm_sprints_status", "pm_sprints", ["status"])
    # One active sprint per project, enforced by the database as well.
    op.create_index(
        "uq_pm_sprints_one_active", "pm_sprints", ["project_id"], unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
    )
    op.add_column(
        "pm_issues",
        sa.Column(
            "sprint_id", sa.Uuid(),
            sa.ForeignKey("pm_sprints.id", ondelete="SET NULL", name="fk_pm_issues_sprint_id"),
            nullable=True,
        ),
    )
    op.create_index("ix_pm_issues_sprint_id", "pm_issues", ["sprint_id"])


def downgrade():
    op.drop_index("ix_pm_issues_sprint_id", table_name="pm_issues")
    op.drop_constraint("fk_pm_issues_sprint_id", "pm_issues", type_="foreignkey")
    op.drop_column("pm_issues", "sprint_id")
    op.drop_index("uq_pm_sprints_one_active", table_name="pm_sprints")
    op.drop_table("pm_sprints")
    op.drop_column("pm_projects", "sprint_seq")
    op.drop_column("pm_projects", "sprints_enabled")
