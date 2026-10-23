"""Requirement briefs, task/decision traceability and history.

Revision ID: b4f5a6b7c8d9
Revises: a3e4f5a6b7c8
"""
from alembic import op
import sqlalchemy as sa

revision = "b4f5a6b7c8d9"
down_revision = "a3e4f5a6b7c8"
branch_labels = None
depends_on = None


def _user(name):
    return sa.Column(name, sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


def _time(name):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade():
    op.add_column("pm_projects", sa.Column("requirement_seq", sa.Integer(), server_default="0", nullable=False))
    op.create_table("pm_requirements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("pm_projects.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        *(sa.Column(name, sa.Text(), nullable=False) for name in (
            "original_request", "context", "functional_requirements", "technical_requirements", "scope",
            "expected_outcome", "acceptance_criteria", "supporting_information")),
        _user("owner_id"), _user("created_by_id"),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False), _time("created_at"), _time("updated_at"),
        sa.UniqueConstraint("project_id", "number", name="uq_pm_requirement_number"))
    for name in ("project_id", "owner_id", "status"):
        op.create_index(f"ix_pm_requirements_{name}", "pm_requirements", [name])
    for kind, plural in (("issue", "issues"), ("decision", "decisions")):
        table = f"pm_requirement_{kind}_links"
        op.create_table(table,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("requirement_id", sa.Uuid(), sa.ForeignKey("pm_requirements.id", ondelete="CASCADE"), nullable=False),
            sa.Column(f"{kind}_id", sa.Uuid(), sa.ForeignKey(f"pm_{plural}.id", ondelete="CASCADE"), nullable=False),
            _user("added_by_id"), _time("added_at"),
            sa.UniqueConstraint("requirement_id", f"{kind}_id", name=f"uq_pm_requirement_{kind}"))
        for name in ("requirement_id", f"{kind}_id"):
            op.create_index(f"ix_{table}_{name}", table, [name])
    op.create_table("pm_requirement_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("requirement_id", sa.Uuid(), sa.ForeignKey("pm_requirements.id", ondelete="RESTRICT"), nullable=False),
        _user("actor_id"), sa.Column("actor_name", sa.String(255), nullable=False),
        sa.Column("action", sa.String(32), nullable=False), sa.Column("details", sa.JSON(), nullable=False), _time("created_at"))
    op.create_index("ix_pm_requirement_events_requirement_id", "pm_requirement_events", ["requirement_id"])


def downgrade():
    op.drop_table("pm_requirement_events")
    op.drop_table("pm_requirement_decision_links")
    op.drop_table("pm_requirement_issue_links")
    op.drop_table("pm_requirements")
    op.drop_column("pm_projects", "requirement_seq")
