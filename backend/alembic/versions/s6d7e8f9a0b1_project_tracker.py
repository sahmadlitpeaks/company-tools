"""Project tracker: projects, members, issues, links, watchers, comments, history.

Revision ID: s6d7e8f9a0b1
Revises: s5c6d7e8f9a0
"""
from alembic import op
import sqlalchemy as sa

revision = "s6d7e8f9a0b1"
down_revision = "s5c6d7e8f9a0"
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def _user_fk(name, ondelete="SET NULL", nullable=True):
    return sa.Column(
        name, sa.Uuid(), sa.ForeignKey("users.id", ondelete=ondelete), nullable=nullable
    )


def upgrade():
    op.create_table(
        "pm_projects",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("key", sa.String(10), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        _user_fk("lead_id"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("issue_seq", sa.Integer(), nullable=False, server_default="0"),
        _user_fk("created_by_id"),
        *_timestamps(),
    )
    op.create_index("ix_pm_projects_key", "pm_projects", ["key"], unique=True)
    op.create_index("ix_pm_projects_lead_id", "pm_projects", ["lead_id"])
    op.create_index("ix_pm_projects_status", "pm_projects", ["status"])

    op.create_table(
        "pm_project_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id", sa.Uuid(),
            sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=False,
        ),
        _user_fk("user_id", ondelete="CASCADE", nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        *_timestamps(),
        sa.UniqueConstraint("project_id", "user_id", name="uq_pm_project_member"),
    )
    op.create_index("ix_pm_project_members_project_id", "pm_project_members", ["project_id"])
    op.create_index("ix_pm_project_members_user_id", "pm_project_members", ["user_id"])

    op.create_table(
        "pm_issues",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id", sa.Uuid(),
            sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("issue_type", sa.String(16), nullable=False, server_default="task"),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="todo"),
        sa.Column("priority", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("story_points", sa.Float(), nullable=True),
        sa.Column("labels", sa.JSON(), nullable=True),
        _user_fk("reporter_id"),
        _user_fk("assignee_id"),
        sa.Column(
            "parent_id", sa.Uuid(),
            sa.ForeignKey("pm_issues.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rank", sa.Float(), nullable=False, server_default="0"),
        _user_fk("created_by_id"),
        *_timestamps(),
        sa.UniqueConstraint("project_id", "number", name="uq_pm_issue_number"),
    )
    for column in ("project_id", "issue_type", "status", "reporter_id", "assignee_id", "parent_id"):
        op.create_index(f"ix_pm_issues_{column}", "pm_issues", [column])

    op.create_table(
        "pm_issue_watchers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "issue_id", sa.Uuid(),
            sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False,
        ),
        _user_fk("user_id", ondelete="CASCADE", nullable=False),
        sa.UniqueConstraint("issue_id", "user_id", name="uq_pm_issue_watcher"),
    )
    op.create_index("ix_pm_issue_watchers_issue_id", "pm_issue_watchers", ["issue_id"])
    op.create_index("ix_pm_issue_watchers_user_id", "pm_issue_watchers", ["user_id"])

    op.create_table(
        "pm_issue_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "source_id", sa.Uuid(),
            sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "target_id", sa.Uuid(),
            sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("link_type", sa.String(16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("source_id", "target_id", "link_type", name="uq_pm_issue_link"),
    )
    op.create_index("ix_pm_issue_links_source_id", "pm_issue_links", ["source_id"])
    op.create_index("ix_pm_issue_links_target_id", "pm_issue_links", ["target_id"])

    op.create_table(
        "pm_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "issue_id", sa.Uuid(),
            sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False,
        ),
        _user_fk("author_id"),
        sa.Column("body", sa.Text(), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_pm_comments_issue_id", "pm_comments", ["issue_id"])

    op.create_table(
        "pm_issue_history",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "issue_id", sa.Uuid(),
            sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False,
        ),
        _user_fk("actor_id"),
        sa.Column("field", sa.String(32), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_pm_issue_history_issue_id", "pm_issue_history", ["issue_id"])
    op.create_index("ix_pm_issue_history_created_at", "pm_issue_history", ["created_at"])


def downgrade():
    # Attachments on tracker issues live in the shared table; drop their rows
    # (files stay on disk) so nothing points at a missing entity type.
    op.execute("DELETE FROM attachments WHERE entity_type = 'pm_issue'")
    for table in (
        "pm_issue_history", "pm_comments", "pm_issue_links", "pm_issue_watchers",
        "pm_issues", "pm_project_members", "pm_projects",
    ):
        op.drop_table(table)
