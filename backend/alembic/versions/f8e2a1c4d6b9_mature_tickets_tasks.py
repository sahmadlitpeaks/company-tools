"""mature tickets & tasks: SLA, numbers, internal notes, subtasks, comments

Revision ID: f8e2a1c4d6b9
Revises: e2a4c6b80a15
Create Date: 2026-06-06

"""
from alembic import op
import sqlalchemy as sa


revision = "f8e2a1c4d6b9"
down_revision = "e2a4c6b80a15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- Tickets: number, SLA targets, milestones, resolution note ----
    op.add_column("tickets", sa.Column("number", sa.Integer(), nullable=True))
    op.add_column("tickets", sa.Column("sla_response_due", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tickets", sa.Column("sla_resolution_due", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tickets", sa.Column("first_responded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tickets", sa.Column("resolution_note", sa.Text(), nullable=True))
    op.create_index("ix_tickets_number", "tickets", ["number"], unique=True)

    # Backfill sequential numbers for existing tickets (oldest first), from 1001.
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM tickets ORDER BY created_at ASC")).fetchall()
    for i, row in enumerate(rows, start=1001):
        bind.execute(
            sa.text("UPDATE tickets SET number = :n WHERE id = :id"),
            {"n": i, "id": row[0]},
        )

    # ---- Ticket comments: internal flag ----
    op.add_column(
        "ticket_comments",
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # ---- Tasks: recurrence ----
    op.add_column("tasks", sa.Column("recurrence", sa.String(length=12), nullable=True))

    # ---- Task checklist items (subtasks) ----
    op.create_table(
        "task_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_items_task_id", "task_items", ["task_id"])

    # ---- Task comments ----
    op.create_table(
        "task_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_comments_task_id", "task_comments", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_comments_task_id", table_name="task_comments")
    op.drop_table("task_comments")
    op.drop_index("ix_task_items_task_id", table_name="task_items")
    op.drop_table("task_items")
    op.drop_column("tasks", "recurrence")
    op.drop_column("ticket_comments", "is_internal")
    op.drop_index("ix_tickets_number", table_name="tickets")
    op.drop_column("tickets", "resolution_note")
    op.drop_column("tickets", "first_responded_at")
    op.drop_column("tickets", "sla_resolution_due")
    op.drop_column("tickets", "sla_response_due")
    op.drop_column("tickets", "number")
