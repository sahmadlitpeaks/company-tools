"""company calendar events

Revision ID: e8b9c0d1e2f3
Revises: e7a8b9c0d1e2
"""
from alembic import op
import sqlalchemy as sa
revision="e8b9c0d1e2f3";down_revision="e7a8b9c0d1e2";branch_labels=None;depends_on=None
def upgrade():
 op.create_table("company_events",sa.Column("title",sa.String(255),nullable=False),sa.Column("description",sa.Text()),sa.Column("starts_at",sa.DateTime(timezone=True),nullable=False),sa.Column("ends_at",sa.DateTime(timezone=True)),sa.Column("location",sa.String(255)),sa.Column("company_id",sa.Uuid()),sa.Column("created_by_id",sa.Uuid()),sa.Column("id",sa.Uuid(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.ForeignKeyConstraint(["company_id"],["companies.id"],ondelete="SET NULL"),sa.ForeignKeyConstraint(["created_by_id"],["users.id"],ondelete="SET NULL"))
 for c in("title","starts_at","ends_at","company_id"):op.create_index(f"ix_company_events_{c}","company_events",[c])
def downgrade():op.drop_table("company_events")
