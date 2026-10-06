"""CRM follow-ups, qualification fields and lead timeline.

Revision ID: r4b5c6d7e8f9
Revises: q3a4b5c6d7e8
"""
from alembic import op
import sqlalchemy as sa

revision = "r4b5c6d7e8f9"
down_revision = "q3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("crm_leads", sa.Column("priority", sa.String(16), nullable=True))
    op.add_column("crm_leads", sa.Column("tags", sa.JSON(), nullable=True))
    op.add_column("crm_leads", sa.Column("follow_up_date", sa.Date(), nullable=True))
    op.add_column("crm_leads", sa.Column("next_step", sa.String(255), nullable=True))
    op.add_column("crm_leads", sa.Column("expected_close_date", sa.Date(), nullable=True))
    op.add_column("crm_leads", sa.Column("lost_reason", sa.String(255), nullable=True))
    op.add_column(
        "crm_leads", sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_crm_leads_priority", "crm_leads", ["priority"])
    op.create_index("ix_crm_leads_follow_up_date", "crm_leads", ["follow_up_date"])
    op.create_index("ix_crm_leads_email_lower", "crm_leads", [sa.text("lower(email)")])

    op.create_table(
        "crm_activities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "lead_id", sa.Uuid(), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_crm_activities_lead_id", "crm_activities", ["lead_id"])


def downgrade():
    # Leads in the two new stages have no equivalent in the old pipeline; put
    # them back at "qualified", the last open stage the old pipeline had.
    op.execute(
        "UPDATE crm_leads SET status = 'qualified' WHERE status IN ('proposal', 'negotiation')"
    )
    op.drop_index("ix_crm_activities_lead_id", table_name="crm_activities")
    op.drop_table("crm_activities")
    op.drop_index("ix_crm_leads_email_lower", table_name="crm_leads")
    op.drop_index("ix_crm_leads_follow_up_date", table_name="crm_leads")
    op.drop_index("ix_crm_leads_priority", table_name="crm_leads")
    for column in (
        "last_contacted_at", "lost_reason", "expected_close_date", "next_step",
        "follow_up_date", "tags", "priority",
    ):
        op.drop_column("crm_leads", column)
