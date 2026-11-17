"""Product roadmap: modules per project and roadmap fields on requirements.

Existing requirements get no module or horizon, and a roadmap status mapped from
their current status (draft -> proposed, ready -> approved, in_progress ->
in_progress, delivered -> done, archived -> parked). Starter project roles gain
the roadmap permissions (BRD 9A.4): Project Admin all three, Contributor and
Viewer roadmap.view.

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None

ROLE_ADDITIONS = {
    "admin": ["roadmap.view", "roadmap.edit", "roadmap.decide"],
    "member": ["roadmap.view"],
    "viewer": ["roadmap.view"],
}
STATUS_MAP = {"draft": "proposed", "ready": "approved", "in_progress": "in_progress",
              "delivered": "done", "archived": "parked"}


def _roles(add: bool):
    bind = op.get_bind()
    roles = sa.table("roles", sa.column("key", sa.String), sa.column("permissions", sa.JSON))
    for key, perms in bind.execute(sa.select(roles.c.key, roles.c.permissions)
                                   .where(roles.c.key.in_(list(ROLE_ADDITIONS)))).all():
        current = json.loads(perms) if isinstance(perms, str) else list(perms or [])
        extra = ROLE_ADDITIONS[key]
        updated = current + [p for p in extra if p not in current] if add else [p for p in current if p not in extra]
        if updated != current:
            bind.execute(roles.update().where(roles.c.key == key).values(permissions=updated))


def upgrade():
    op.create_table(
        "pm_modules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "name", name="uq_pm_module_name"),
    )
    op.create_index("ix_pm_modules_project_id", "pm_modules", ["project_id"])
    with op.batch_alter_table("pm_requirements") as batch:
        batch.add_column(sa.Column("module_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("priority", sa.String(8), nullable=True))
        batch.add_column(sa.Column("horizon", sa.String(8), nullable=True))
        batch.add_column(sa.Column("roadmap_status", sa.String(16), nullable=False, server_default="proposed"))
        batch.add_column(sa.Column("target_quarter", sa.String(7), nullable=True))
        batch.create_foreign_key("fk_pm_requirements_module_id", "pm_modules", ["module_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_pm_requirements_module_id", "pm_requirements", ["module_id"])
    op.create_index("ix_pm_requirements_horizon", "pm_requirements", ["horizon"])
    op.create_index("ix_pm_requirements_roadmap_status", "pm_requirements", ["roadmap_status"])
    requirements = sa.table("pm_requirements", sa.column("status", sa.String), sa.column("roadmap_status", sa.String))
    for old, new in STATUS_MAP.items():
        op.get_bind().execute(requirements.update().where(requirements.c.status == old).values(roadmap_status=new))
    _roles(True)


def downgrade():
    _roles(False)
    op.drop_index("ix_pm_requirements_roadmap_status", table_name="pm_requirements")
    op.drop_index("ix_pm_requirements_horizon", table_name="pm_requirements")
    op.drop_index("ix_pm_requirements_module_id", table_name="pm_requirements")
    with op.batch_alter_table("pm_requirements") as batch:
        batch.drop_constraint("fk_pm_requirements_module_id", type_="foreignkey")
        for column in ("target_quarter", "roadmap_status", "horizon", "priority", "module_id"):
            batch.drop_column(column)
    op.drop_index("ix_pm_modules_project_id", table_name="pm_modules")
    op.drop_table("pm_modules")
