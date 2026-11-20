"""Move issues between projects: old-key aliases and move permissions.

Adds issue.move_out and issue.move_in to the starter Project Admin (admin) and
Contributor (member) roles, as BRD section 7.3 describes. Custom roles are left
unchanged; grant the permissions to them under Roles & Permissions.

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None

MOVE = ["issue.move_out", "issue.move_in"]


def _permissions(value):
    if isinstance(value, str):
        return json.loads(value)
    return list(value or [])


def _set_move(add: bool):
    bind = op.get_bind()
    roles = sa.table("roles", sa.column("key", sa.String), sa.column("permissions", sa.JSON))
    for key, perms in bind.execute(sa.select(roles.c.key, roles.c.permissions)
                                   .where(roles.c.key.in_(["admin", "member"]))).all():
        current = _permissions(perms)
        updated = current + [p for p in MOVE if p not in current] if add else [p for p in current if p not in MOVE]
        if updated != current:
            bind.execute(roles.update().where(roles.c.key == key).values(permissions=updated))


def upgrade():
    op.create_table(
        "pm_issue_key_aliases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("key", sa.String(24), nullable=False),
        sa.Column("issue_id", sa.Uuid(), sa.ForeignKey("pm_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pm_issue_key_aliases_key", "pm_issue_key_aliases", ["key"], unique=True)
    op.create_index("ix_pm_issue_key_aliases_issue_id", "pm_issue_key_aliases", ["issue_id"])
    _set_move(True)


def downgrade():
    _set_move(False)
    op.drop_index("ix_pm_issue_key_aliases_issue_id", table_name="pm_issue_key_aliases")
    op.drop_index("ix_pm_issue_key_aliases_key", table_name="pm_issue_key_aliases")
    op.drop_table("pm_issue_key_aliases")
