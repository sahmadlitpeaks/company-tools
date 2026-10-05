"""Task progress and durable assignment email delivery.
Revision ID: p2f3a4b5c6d7
Revises: o1e2f3a4b5c6
"""
from alembic import op
import sqlalchemy as sa

revision = "p2f3a4b5c6d7"
down_revision = "o1e2f3a4b5c6"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("sharepoint_compliance_tasks", sa.Column("work_status", sa.String(24), nullable=False, server_default="todo"))
    op.create_check_constraint("ck_sp_task_work_status", "sharepoint_compliance_tasks", "work_status IN ('todo', 'in_progress', 'blocked')")
    op.create_table("task_assignment_emails",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE")),
        sa.Column("compliance_task_id", sa.Uuid(), sa.ForeignKey("sharepoint_compliance_tasks.id", ondelete="CASCADE")),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("notifications.id", ondelete="SET NULL"), unique=True),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(128)),
        sa.CheckConstraint("(task_id IS NOT NULL) <> (compliance_task_id IS NOT NULL)", name="ck_task_assignment_email_one_task"))
    for column in ("task_id", "compliance_task_id", "status", "next_attempt_at"):
        op.create_index(f"ix_task_assignment_emails_{column}", "task_assignment_emails", [column])

def downgrade():
    op.drop_table("task_assignment_emails")
    op.drop_constraint("ck_sp_task_work_status", "sharepoint_compliance_tasks", type_="check")
    op.drop_column("sharepoint_compliance_tasks", "work_status")
