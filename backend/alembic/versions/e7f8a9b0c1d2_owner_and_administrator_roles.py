"""Owner and Administrator platform roles; every platform admin becomes an Owner.

Owner is protected: it always holds every permission and can't be edited,
deleted or granted to a department. Granting it to every account that is a
platform administrator today keeps their access exactly as it was.

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None

SYSTEM = ["users.manage", "roles.manage", "departments.manage", "settings.manage",
          "audit.view", "backups.manage", "api_tokens.manage"]


def upgrade():
    op.add_column("roles", sa.Column("is_protected", sa.Boolean(), nullable=False, server_default=sa.false()))
    bind = op.get_bind()
    roles = sa.table("roles", sa.column("id", sa.Uuid), sa.column("key", sa.String), sa.column("name", sa.String),
                     sa.column("description", sa.Text), sa.column("scope", sa.String), sa.column("permissions", sa.JSON),
                     sa.column("is_system", sa.Boolean), sa.column("is_protected", sa.Boolean))
    owner_id = uuid.uuid4()
    op.bulk_insert(roles, [
        {"id": owner_id, "key": "owner", "name": "Owner", "scope": "platform", "permissions": [],
         "description": "Every permission, always. The platform keeps at least one active Owner.",
         "is_system": True, "is_protected": True},
        {"id": uuid.uuid4(), "key": "administrator", "name": "Administrator", "scope": "platform",
         "permissions": SYSTEM + ["projects.view_all", "projects.create"],
         "description": "Runs the system: people, roles, departments, settings, audit, backups and tokens; sees every project.",
         "is_system": True, "is_protected": False},
    ])
    users = sa.table("users", sa.column("id", sa.Uuid), sa.column("is_admin", sa.Boolean))
    grants = sa.table("user_platform_roles", sa.column("user_id", sa.Uuid), sa.column("role_id", sa.Uuid))
    admin_ids = bind.execute(sa.select(users.c.id).where(users.c.is_admin.is_(True))).scalars().all()
    if admin_ids:
        op.bulk_insert(grants, [{"user_id": uid, "role_id": owner_id} for uid in admin_ids])


def downgrade():
    bind = op.get_bind()
    roles = sa.table("roles", sa.column("id", sa.Uuid), sa.column("key", sa.String))
    ids = bind.execute(sa.select(roles.c.id).where(roles.c.key.in_(["owner", "administrator"]))).scalars().all()
    if ids:
        grants = sa.table("user_platform_roles", sa.column("role_id", sa.Uuid))
        departments = sa.table("department_roles", sa.column("role_id", sa.Uuid))
        bind.execute(grants.delete().where(grants.c.role_id.in_(ids)))
        bind.execute(departments.delete().where(departments.c.role_id.in_(ids)))
        bind.execute(roles.delete().where(roles.c.id.in_(ids)))
    op.drop_column("roles", "is_protected")
