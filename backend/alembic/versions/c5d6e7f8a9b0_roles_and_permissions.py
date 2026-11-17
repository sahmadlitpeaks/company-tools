"""Editable roles, platform role grants and per-person permission overrides.

Starter project roles reuse the legacy member role values as their keys
(admin, member, viewer), so every existing project membership keeps exactly
the access it had. No user gains or loses access in this migration.

Revision ID: c5d6e7f8a9b0
Revises: b4f5a6b7c8d9
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "c5d6e7f8a9b0"
down_revision = "b4f5a6b7c8d9"
branch_labels = None
depends_on = None

PROJECT_ALL = [
    "project.view", "project.settings", "project.archive", "members.manage", "issue.create",
    "issue.edit", "issue.edit_own", "issue.delete", "issue.assign", "issue.transition",
    "issue.comment", "comment.delete_any", "sprint.manage", "workflow.configure", "reports.view",
    "decisions.create", "decisions.approve", "requirements.manage", "share_links.manage", "import.run",
]
STARTER = [
    ("admin", "project", "Project Admin",
     "Runs the project: settings, members, sprints and every issue.", PROJECT_ALL),
    ("member", "project", "Contributor",
     "Creates, edits, assigns and moves issues; records decisions and requirements.",
     ["project.view", "issue.create", "issue.edit", "issue.assign", "issue.transition",
      "issue.comment", "reports.view", "decisions.create", "requirements.manage"]),
    ("viewer", "project", "Viewer",
     "Reads the project and comments, for stakeholders and requesters.",
     ["project.view", "issue.comment", "reports.view"]),
    ("project_creator", "platform", "Project Creator",
     "Can create new projects without being a platform administrator.", ["projects.create"]),
]


def _time(name):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade():
    roles = op.create_table(
        "roles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        _time("created_at"), _time("updated_at"),
    )
    op.create_index("ix_roles_key", "roles", ["key"], unique=True)
    op.create_index("ix_roles_scope", "roles", ["scope"])
    op.create_table(
        "user_platform_roles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", sa.Uuid(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "department_roles",
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("role_id", sa.Uuid(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "user_permission_overrides",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission", sa.String(64), nullable=False),
        sa.Column("allow", sa.Boolean(), nullable=False),
        _time("created_at"), _time("updated_at"),
        sa.UniqueConstraint("user_id", "permission", name="uq_user_permission_override"),
    )
    op.create_index("ix_user_permission_overrides_user_id", "user_permission_overrides", ["user_id"])

    with op.batch_alter_table("pm_project_members") as batch:
        batch.alter_column("role", type_=sa.String(64), existing_type=sa.String(16),
                           existing_nullable=False)
        batch.add_column(sa.Column("allow_permissions", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("deny_permissions", sa.JSON(), nullable=True))

    op.bulk_insert(roles, [
        {"id": uuid.uuid4(), "key": key, "scope": scope, "name": name, "description": description,
         "permissions": permissions, "is_system": True}
        for key, scope, name, description, permissions in STARTER
    ])


def downgrade():
    # Custom project roles do not exist before this revision.
    op.execute(
        "UPDATE pm_project_members SET role = 'member' "
        "WHERE role NOT IN ('admin', 'member', 'viewer')"
    )
    with op.batch_alter_table("pm_project_members") as batch:
        batch.drop_column("deny_permissions")
        batch.drop_column("allow_permissions")
        batch.alter_column("role", type_=sa.String(16), existing_type=sa.String(64),
                           existing_nullable=False)
    op.drop_index("ix_user_permission_overrides_user_id", table_name="user_permission_overrides")
    op.drop_table("user_permission_overrides")
    op.drop_table("department_roles")
    op.drop_table("user_platform_roles")
    op.drop_index("ix_roles_scope", table_name="roles")
    op.drop_index("ix_roles_key", table_name="roles")
    op.drop_table("roles")
