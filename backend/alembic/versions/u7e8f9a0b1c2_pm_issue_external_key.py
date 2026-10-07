"""Project tracker: remember the source key of imported issues.

Revision ID: u7e8f9a0b1c2
Revises: t6d7e8f9a0b1
"""
from alembic import op
import sqlalchemy as sa

revision = "u7e8f9a0b1c2"
down_revision = "t6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("pm_issues", sa.Column("external_key", sa.String(64), nullable=True))
    op.create_unique_constraint(
        "uq_pm_issue_external_key", "pm_issues", ["project_id", "external_key"]
    )


def downgrade():
    op.drop_constraint("uq_pm_issue_external_key", "pm_issues", type_="unique")
    op.drop_column("pm_issues", "external_key")
