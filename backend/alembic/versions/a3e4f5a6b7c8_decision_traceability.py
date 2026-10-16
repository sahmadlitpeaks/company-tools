"""Auditable issue tracking and revision-specific decision replacement.

Revision ID: a3e4f5a6b7c8
Revises: z2d3e4f5a6b7
"""
from alembic import op
import sqlalchemy as sa

revision = "a3e4f5a6b7c8"
down_revision = "z2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("pm_decision_issue_links", sa.Column("relationship", sa.String(24), nullable=False, server_default="relates_to"))
    op.add_column("pm_decision_issue_links", sa.Column("added_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_pm_decision_link_added_by", "pm_decision_issue_links", "users", ["added_by_id"], ["id"], ondelete="SET NULL")
    op.add_column("pm_decision_issue_links", sa.Column("added_by_name", sa.String(255), nullable=True))
    # Existing links have no reliable creator or creation time. Preserve that
    # uncertainty rather than assigning the migration executor's identity/time.
    op.add_column("pm_decision_issue_links", sa.Column("added_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("pm_decision_issue_links", "added_at", server_default=sa.func.now())
    op.add_column("pm_decisions", sa.Column("superseded_by_revision_number", sa.Integer(), nullable=True))
    # Recover the revision at replacement from the append-only event, not the
    # replacement's latest approval (which may have changed since that event).
    op.execute("""
        UPDATE pm_decisions AS d SET superseded_by_revision_number = (
            SELECT e.revision_number
            FROM pm_decision_events AS e
            WHERE e.decision_id = d.superseded_by_id
              AND e.action = 'replaces_decision'
              AND e.details->>'previous_id' = d.id::text
            ORDER BY e.created_at, e.id LIMIT 1
        ) WHERE d.superseded_by_id IS NOT NULL
    """)


def downgrade():
    op.drop_column("pm_decisions", "superseded_by_revision_number")
    op.drop_column("pm_decision_issue_links", "added_at")
    op.drop_column("pm_decision_issue_links", "added_by_name")
    op.drop_constraint("fk_pm_decision_link_added_by", "pm_decision_issue_links", type_="foreignkey")
    op.drop_column("pm_decision_issue_links", "added_by_id")
    op.drop_column("pm_decision_issue_links", "relationship")
