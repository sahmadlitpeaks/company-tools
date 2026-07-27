"""Recurring checklists (routine checks): templates, runs and item responses

Revision ID: a1f7c3d92b64
Revises: d0c4a8e2f6b1
Create Date: 2026-07-26

"""
from alembic import op
import sqlalchemy as sa


revision = "a1f7c3d92b64"
down_revision = "d0c4a8e2f6b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "checklist_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("team", sa.String(length=24), nullable=False, server_default="it"),
        sa.Column("schedule", sa.String(length=16), nullable=False, server_default="daily"),
        sa.Column("days_of_week", sa.JSON(), nullable=True),
        sa.Column("day_of_month", sa.Integer(), nullable=True),
        sa.Column("due_time", sa.String(length=5), nullable=True),
        sa.Column("grace_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("assignee_department_id", sa.Uuid(), nullable=True),
        sa.Column("reviewer_id", sa.Uuid(), nullable=True),
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column("requires_verification", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignee_department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_checklist_templates_name", "checklist_templates", ["name"])
    op.create_index("ix_checklist_templates_active", "checklist_templates", ["active"])
    op.create_index("ix_checklist_templates_team", "checklist_templates", ["team"])
    op.create_index("ix_checklist_templates_assignee_id", "checklist_templates", ["assignee_id"])
    op.create_index(
        "ix_checklist_templates_assignee_department_id",
        "checklist_templates",
        ["assignee_department_id"],
    )
    op.create_index("ix_checklist_templates_reviewer_id", "checklist_templates", ["reviewer_id"])
    op.create_index("ix_checklist_templates_company_id", "checklist_templates", ["company_id"])

    op.create_table(
        "checklist_template_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=False),
        sa.Column("section", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_type", sa.String(length=16), nullable=False, server_default="ok_issue"),
        sa.Column("photo_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("asset_id", sa.Uuid(), nullable=True),
        sa.Column("auto_ticket_on_issue", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ticket_priority", sa.String(length=16), nullable=False, server_default="normal"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["template_id"], ["checklist_templates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["tracked_assets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_checklist_template_items_template_id",
        "checklist_template_items",
        ["template_id"],
    )

    # ---- Runs live in `tasks` ----
    op.add_column("tasks", sa.Column("template_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("run_date", sa.Date(), nullable=True))
    op.add_column("tasks", sa.Column("reviewer_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("verified_by_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("review_note", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_tasks_template_id", "tasks", "checklist_templates", ["template_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_tasks_reviewer_id", "tasks", "users", ["reviewer_id"], ["id"], ondelete="SET NULL"
    )
    op.create_foreign_key(
        "fk_tasks_verified_by_id", "tasks", "users", ["verified_by_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tasks_template_id", "tasks", ["template_id"])
    op.create_index("ix_tasks_run_date", "tasks", ["run_date"])
    op.create_index("ix_tasks_reviewer_id", "tasks", ["reviewer_id"])
    # Makes run generation idempotent — the scheduler and the manual
    # "generate now" button can both fire without producing duplicates.
    op.create_unique_constraint(
        "uq_task_template_run_date", "tasks", ["template_id", "run_date"]
    )

    # ---- Item-level responses ----
    op.add_column("task_items", sa.Column("section", sa.String(length=255), nullable=True))
    op.add_column(
        "task_items",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
    )
    op.add_column("task_items", sa.Column("note", sa.Text(), nullable=True))
    op.add_column(
        "task_items",
        sa.Column("response_type", sa.String(length=16), nullable=False, server_default="done"),
    )
    op.add_column("task_items", sa.Column("value", sa.String(length=512), nullable=True))
    op.add_column(
        "task_items",
        sa.Column("photo_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("task_items", sa.Column("asset_id", sa.Uuid(), nullable=True))
    op.add_column(
        "task_items",
        sa.Column("auto_ticket_on_issue", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "task_items",
        sa.Column("ticket_priority", sa.String(length=16), nullable=False, server_default="normal"),
    )
    op.add_column("task_items", sa.Column("ticket_id", sa.Uuid(), nullable=True))
    op.add_column("task_items", sa.Column("responded_by_id", sa.Uuid(), nullable=True))
    op.add_column("task_items", sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_task_items_asset_id", "task_items", "tracked_assets", ["asset_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_task_items_ticket_id", "task_items", "tickets", ["ticket_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_task_items_responded_by_id", "task_items", "users", ["responded_by_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_task_items_status", "task_items", ["status"])

    # Existing ticked subtasks should read as done, not pending.
    op.execute("UPDATE task_items SET status = 'done' WHERE done = true")


def downgrade() -> None:
    op.drop_index("ix_task_items_status", table_name="task_items")
    op.drop_constraint("fk_task_items_responded_by_id", "task_items", type_="foreignkey")
    op.drop_constraint("fk_task_items_ticket_id", "task_items", type_="foreignkey")
    op.drop_constraint("fk_task_items_asset_id", "task_items", type_="foreignkey")
    for col in (
        "responded_at",
        "responded_by_id",
        "ticket_id",
        "ticket_priority",
        "auto_ticket_on_issue",
        "asset_id",
        "photo_required",
        "value",
        "response_type",
        "note",
        "status",
        "section",
    ):
        op.drop_column("task_items", col)

    op.drop_constraint("uq_task_template_run_date", "tasks", type_="unique")
    op.drop_index("ix_tasks_reviewer_id", table_name="tasks")
    op.drop_index("ix_tasks_run_date", table_name="tasks")
    op.drop_index("ix_tasks_template_id", table_name="tasks")
    op.drop_constraint("fk_tasks_verified_by_id", "tasks", type_="foreignkey")
    op.drop_constraint("fk_tasks_reviewer_id", "tasks", type_="foreignkey")
    op.drop_constraint("fk_tasks_template_id", "tasks", type_="foreignkey")
    for col in (
        "started_at",
        "review_note",
        "verified_by_id",
        "verified_at",
        "submitted_at",
        "reviewer_id",
        "run_date",
        "template_id",
    ):
        op.drop_column("tasks", col)

    op.drop_index("ix_checklist_template_items_template_id", table_name="checklist_template_items")
    op.drop_table("checklist_template_items")
    for idx in (
        "ix_checklist_templates_company_id",
        "ix_checklist_templates_reviewer_id",
        "ix_checklist_templates_assignee_department_id",
        "ix_checklist_templates_assignee_id",
        "ix_checklist_templates_team",
        "ix_checklist_templates_active",
        "ix_checklist_templates_name",
    ):
        op.drop_index(idx, table_name="checklist_templates")
    op.drop_table("checklist_templates")
