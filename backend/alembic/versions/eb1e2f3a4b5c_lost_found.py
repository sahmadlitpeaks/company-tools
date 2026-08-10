"""lost and found

Revision ID: eb1e2f3a4b5c
Revises: ea0d1e2f3a4b
"""
from alembic import op
import sqlalchemy as sa
revision="eb1e2f3a4b5c";down_revision="ea0d1e2f3a4b";branch_labels=None;depends_on=None
def upgrade():
 op.create_table("lost_found_reports",sa.Column("kind",sa.String(12),nullable=False),sa.Column("description",sa.Text(),nullable=False),sa.Column("location",sa.String(255),nullable=False),sa.Column("item_date",sa.DateTime(timezone=True),nullable=False),sa.Column("status",sa.String(16),nullable=False),sa.Column("reporter_id",sa.Uuid(),nullable=False),sa.Column("claimant_id",sa.Uuid()),sa.Column("company_id",sa.Uuid()),sa.Column("id",sa.Uuid(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.ForeignKeyConstraint(["reporter_id"],["users.id"],ondelete="CASCADE"),sa.ForeignKeyConstraint(["claimant_id"],["users.id"],ondelete="SET NULL"),sa.ForeignKeyConstraint(["company_id"],["companies.id"],ondelete="SET NULL"))
 for c in("kind","location","item_date","status","reporter_id","claimant_id","company_id"):op.create_index(f"ix_lost_found_reports_{c}","lost_found_reports",[c])
def downgrade():op.drop_table("lost_found_reports")
