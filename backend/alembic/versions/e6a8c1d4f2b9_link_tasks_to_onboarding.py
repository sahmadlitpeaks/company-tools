"""link tasks to onboarding checklist items

Revision ID: e6a8c1d4f2b9
Revises: d5f7a9c2e4b8
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "e6a8c1d4f2b9"
down_revision = "d5f7a9c2e4b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("onboarding_task_id", sa.Uuid(), nullable=True))
    op.create_index("ix_tasks_onboarding_task_id", "tasks", ["onboarding_task_id"])
    op.create_foreign_key(
        "fk_tasks_onboarding_task_id", "tasks", "onboarding_tasks",
        ["onboarding_task_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_tasks_onboarding_task_id", "tasks", type_="foreignkey")
    op.drop_index("ix_tasks_onboarding_task_id", table_name="tasks")
    op.drop_column("tasks", "onboarding_task_id")
