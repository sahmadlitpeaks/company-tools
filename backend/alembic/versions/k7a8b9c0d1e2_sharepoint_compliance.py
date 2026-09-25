"""Document compliance ownership, workflow, versions and audit events."""

from alembic import op
import sqlalchemy as sa

revision = "k7a8b9c0d1e2"
down_revision = "j6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sharepoint_documents", sa.Column("compliance", sa.JSON(), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("compliance_status", sa.String(32), nullable=False, server_default="pending"))
    op.add_column("sharepoint_documents", sa.Column("company_id", sa.Uuid(), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("reviewed_by", sa.Uuid(), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("uploaded_by_oid", sa.String(64), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("uploaded_by_email", sa.String(320), nullable=True))
    op.add_column("sharepoint_documents", sa.Column("uploaded_at", sa.String(64), nullable=True))
    op.create_index("ix_sharepoint_documents_compliance_status", "sharepoint_documents", ["compliance_status"])
    op.create_index("ix_sharepoint_documents_company_id", "sharepoint_documents", ["company_id"])
    op.execute("UPDATE sharepoint_sources SET policy = 'auto', rules_cipher = NULL")
    op.execute("UPDATE sharepoint_documents SET status = 'queued' WHERE status IN ('awaiting_approval', 'approved')")
    op.create_foreign_key("fk_sp_document_company", "sharepoint_documents", "companies", ["company_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_sp_document_reviewer", "sharepoint_documents", "users", ["reviewed_by"], ["id"], ondelete="SET NULL")

    op.create_table("sharepoint_owner_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id", ondelete="CASCADE")),
        sa.Column("document_type", sa.String(80)),
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("owner_department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="CASCADE")),
        sa.Column("reminder_leads", sa.JSON()),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.CheckConstraint("(owner_user_id IS NOT NULL) <> (owner_department_id IS NOT NULL)", name="ck_sp_rule_one_owner"),
    )
    op.create_index("ix_sharepoint_owner_rules_company_id", "sharepoint_owner_rules", ["company_id"])
    op.create_index("ix_sharepoint_owner_rules_document_type", "sharepoint_owner_rules", ["document_type"])

    op.create_table("sharepoint_compliance_tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("source_id", sa.Uuid(), sa.ForeignKey("sharepoint_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("sharepoint_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action_key", sa.String(64), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("basis", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("owner_department_id", sa.Uuid(), sa.ForeignKey("departments.id", ondelete="SET NULL")),
        sa.Column("assignment_source", sa.String(32), nullable=False),
        sa.Column("completed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("superseded_by_id", sa.Uuid(), sa.ForeignKey("sharepoint_documents.id", ondelete="SET NULL")),
        sa.UniqueConstraint("document_id", "action_key", name="uq_sharepoint_task_action"),
    )
    for col in ("source_id", "document_id", "due_date", "status", "owner_user_id", "owner_department_id"):
        op.create_index(f"ix_sharepoint_compliance_tasks_{col}", "sharepoint_compliance_tasks", [col])
    op.add_column("sharepoint_reminders", sa.Column("task_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_sp_reminder_task", "sharepoint_reminders", "sharepoint_compliance_tasks", ["task_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_sharepoint_reminders_task_id", "sharepoint_reminders", ["task_id"])

    op.create_table("sharepoint_document_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("sharepoint_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_version", sa.Text(), nullable=False),
        sa.Column("modified_at", sa.String(64)),
        sa.Column("extracted", sa.JSON()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.UniqueConstraint("document_id", "source_version", name="uq_sharepoint_document_version"),
    )
    op.create_index("ix_sharepoint_document_versions_document_id", "sharepoint_document_versions", ["document_id"])
    op.create_table("sharepoint_compliance_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("sharepoint_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("sharepoint_compliance_tasks.id", ondelete="SET NULL")),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("details", sa.JSON()),
    )
    op.create_index("ix_sharepoint_compliance_events_document_id", "sharepoint_compliance_events", ["document_id"])
    op.create_index("ix_sharepoint_compliance_events_action", "sharepoint_compliance_events", ["action"])


def downgrade():
    op.drop_table("sharepoint_compliance_events")
    op.drop_table("sharepoint_document_versions")
    op.drop_index("ix_sharepoint_reminders_task_id", table_name="sharepoint_reminders")
    op.drop_constraint("fk_sp_reminder_task", "sharepoint_reminders", type_="foreignkey")
    op.drop_column("sharepoint_reminders", "task_id")
    op.drop_table("sharepoint_compliance_tasks")
    op.drop_table("sharepoint_owner_rules")
    op.drop_constraint("fk_sp_document_reviewer", "sharepoint_documents", type_="foreignkey")
    op.drop_constraint("fk_sp_document_company", "sharepoint_documents", type_="foreignkey")
    op.drop_index("ix_sharepoint_documents_company_id", table_name="sharepoint_documents")
    op.drop_index("ix_sharepoint_documents_compliance_status", table_name="sharepoint_documents")
    for col in ("uploaded_at", "uploaded_by_email", "uploaded_by_oid", "reviewed_at", "reviewed_by", "company_id", "compliance_status", "compliance"):
        op.drop_column("sharepoint_documents", col)
