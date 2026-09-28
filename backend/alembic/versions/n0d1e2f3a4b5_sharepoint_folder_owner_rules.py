"""Add folder-specific SharePoint compliance assignment rules.

Revision ID: n0d1e2f3a4b5
Revises: m9c0d1e2f3a4
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "n0d1e2f3a4b5"
down_revision = "m9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sharepoint_owner_rules", sa.Column("folder_name", sa.String(length=128), nullable=True))
    op.create_index("ix_sharepoint_owner_rules_folder_name", "sharepoint_owner_rules", ["folder_name"])
    op.add_column("sharepoint_reminders", sa.Column("delivery_channels", sa.JSON(), nullable=True))
    bind = op.get_bind()
    existing = bind.execute(sa.text("SELECT 1 FROM departments WHERE lower(name) = 'admin' LIMIT 1")).scalar_one_or_none()
    if not existing:
        bind.execute(sa.text("""
            INSERT INTO departments (id, name, description, permissions, created_at, updated_at)
            VALUES (:id, 'Admin', 'Administrative document and operations ownership.', :permissions,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """).bindparams(sa.bindparam("id", type_=sa.Uuid()),
                        sa.bindparam("permissions", type_=sa.JSON())),
            {"id": uuid.uuid4(), "permissions": ["dashboard", "directory", "tasks", "approvals",
                "service_desk", "knowledge", "announcements", "worklog", "workspace"]})


def downgrade():
    # Preserve Admin membership and permissions if people were assigned to it.
    op.drop_column("sharepoint_reminders", "delivery_channels")
    op.drop_index("ix_sharepoint_owner_rules_folder_name", table_name="sharepoint_owner_rules")
    op.drop_column("sharepoint_owner_rules", "folder_name")
