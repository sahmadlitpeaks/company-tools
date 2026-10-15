"""Project decisions, immutable submissions, links and approval history.

Revision ID: z2d3e4f5a6b7
Revises: y1c2d3e4f5a6
"""
from alembic import op
import sqlalchemy as sa

revision = "z2d3e4f5a6b7"
down_revision = "y1c2d3e4f5a6"
branch_labels = None
depends_on = None


def _user(name):
    return sa.Column(name, sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


def _time(name):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade():
    op.add_column("pm_projects", sa.Column("decision_seq", sa.Integer(), server_default="0", nullable=False))
    op.create_table("pm_decisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("pm_projects.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("approach", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("alternatives", sa.Text(), nullable=False),
        _user("owner_id"), _user("proposed_by_id"), _user("approver_id"),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("approved_revision_number", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("superseded_by_id", sa.Uuid(), sa.ForeignKey("pm_decisions.id", ondelete="RESTRICT"), nullable=True),
        _time("created_at"), _time("updated_at"),
        sa.UniqueConstraint("project_id", "number", name="uq_pm_decision_number"))
    for field in ("project_id", "category", "owner_id", "proposed_by_id", "approver_id", "status"):
        op.create_index(f"ix_pm_decisions_{field}", "pm_decisions", [field])
    op.create_table("pm_decision_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("decision_id", sa.Uuid(), sa.ForeignKey("pm_decisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=False),
        _user("submitted_by_id"),
        sa.Column("submitted_by_name", sa.String(255), nullable=False),
        _time("created_at"),
        sa.UniqueConstraint("decision_id", "number", name="uq_pm_decision_revision"))
    op.create_index("ix_pm_decision_revisions_decision_id", "pm_decision_revisions", ["decision_id"])
    op.create_table("pm_decision_issue_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("decision_id", sa.Uuid(), sa.ForeignKey("pm_decisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issue_id", sa.Uuid(), sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("decision_id", "issue_id", name="uq_pm_decision_issue"))
    for field in ("decision_id", "issue_id"):
        op.create_index(f"ix_pm_decision_issue_links_{field}", "pm_decision_issue_links", [field])
    op.create_table("pm_decision_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("decision_id", sa.Uuid(), sa.ForeignKey("pm_decisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=True),
        _user("actor_id"),
        sa.Column("actor_name", sa.String(255), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        _time("created_at"))
    op.create_index("ix_pm_decision_events_decision_id", "pm_decision_events", ["decision_id"])


def downgrade():
    op.drop_table("pm_decision_events")
    op.drop_table("pm_decision_issue_links")
    op.drop_table("pm_decision_revisions")
    op.drop_table("pm_decisions")
    op.drop_column("pm_projects", "decision_seq")
