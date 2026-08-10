"""purchase requests

Revision ID: e7a8b9c0d1e2
Revises: e6f7a8b9c0d1
"""
from alembic import op
import sqlalchemy as sa
revision="e7a8b9c0d1e2";down_revision="e6f7a8b9c0d1";branch_labels=None;depends_on=None
def upgrade():
 op.create_table("purchase_requests",
 sa.Column("requester_id",sa.Uuid(),nullable=False),sa.Column("approval_id",sa.Uuid(),nullable=False),sa.Column("item",sa.String(255),nullable=False),sa.Column("reason",sa.Text(),nullable=False),sa.Column("vendor",sa.String(255)),sa.Column("department",sa.String(255)),sa.Column("estimated_cost",sa.Numeric(12,2)),sa.Column("final_cost",sa.Numeric(12,2)),sa.Column("target_type",sa.String(20),nullable=False),sa.Column("purchased_at",sa.DateTime(timezone=True)),sa.Column("result_type",sa.String(20)),sa.Column("result_id",sa.Uuid()),sa.Column("company_id",sa.Uuid()),sa.Column("id",sa.Uuid(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),
 sa.ForeignKeyConstraint(["requester_id"],["users.id"],ondelete="CASCADE"),sa.ForeignKeyConstraint(["approval_id"],["approval_requests.id"],ondelete="RESTRICT"),sa.ForeignKeyConstraint(["company_id"],["companies.id"],ondelete="SET NULL"),sa.UniqueConstraint("approval_id"))
 for c in("requester_id","approval_id","item","result_id","company_id"):op.create_index(f"ix_purchase_requests_{c}","purchase_requests",[c],unique=c=="approval_id")
def downgrade():op.drop_table("purchase_requests")
