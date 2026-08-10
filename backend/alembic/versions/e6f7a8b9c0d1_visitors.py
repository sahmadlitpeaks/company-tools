"""visitor invitations

Revision ID: e6f7a8b9c0d1
Revises: e5e6f7a8b9c0
"""
from alembic import op
import sqlalchemy as sa
revision="e6f7a8b9c0d1";down_revision="e5e6f7a8b9c0";branch_labels=None;depends_on=None
def upgrade():
    op.create_table("visitors",
      sa.Column("visitor_name",sa.String(255),nullable=False),sa.Column("visitor_email",sa.String(320)),
      sa.Column("host_id",sa.Uuid(),nullable=False),sa.Column("office_location",sa.String(255),nullable=False),
      sa.Column("visit_at",sa.DateTime(timezone=True),nullable=False),sa.Column("purpose",sa.Text()),
      sa.Column("maps_url",sa.String(2048)),sa.Column("token",sa.String(64),nullable=False),
      sa.Column("status",sa.String(20),nullable=False),sa.Column("company_id",sa.Uuid()),
      sa.Column("id",sa.Uuid(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),
      sa.ForeignKeyConstraint(["host_id"],["users.id"],ondelete="CASCADE"),sa.ForeignKeyConstraint(["company_id"],["companies.id"],ondelete="SET NULL"))
    for c in ("visitor_name","host_id","office_location","visit_at","token","status","company_id"):op.create_index(f"ix_visitors_{c}","visitors",[c],unique=c=="token")
def downgrade():op.drop_table("visitors")
