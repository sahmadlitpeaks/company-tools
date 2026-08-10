"""backup status records

Revision ID: e9c0d1e2f3a4
Revises: e8b9c0d1e2f3
"""
from alembic import op
import sqlalchemy as sa
revision="e9c0d1e2f3a4";down_revision="e8b9c0d1e2f3";branch_labels=None;depends_on=None
def upgrade():
 op.create_table("backup_records",sa.Column("status",sa.String(20),nullable=False),sa.Column("filename",sa.String(255)),sa.Column("file_path",sa.String(1024)),sa.Column("size_bytes",sa.BigInteger()),sa.Column("checksum_sha256",sa.String(64)),sa.Column("error",sa.Text()),sa.Column("created_by_id",sa.Uuid()),sa.Column("completed_at",sa.DateTime(timezone=True)),sa.Column("id",sa.Uuid(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.ForeignKeyConstraint(["created_by_id"],["users.id"],ondelete="SET NULL"))
 op.create_index("ix_backup_records_status","backup_records",["status"])
def downgrade():op.drop_table("backup_records")
