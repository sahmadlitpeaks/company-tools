"""Require an owner on every active compliance task."""

from alembic import op

revision = "l8b9c0d1e2f3"
down_revision = "k7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_check_constraint("ck_sp_active_task_one_owner", "sharepoint_compliance_tasks",
        "status <> 'active' OR (owner_user_id IS NOT NULL) <> (owner_department_id IS NOT NULL)")


def downgrade():
    op.drop_constraint("ck_sp_active_task_one_owner", "sharepoint_compliance_tasks", type_="check")
