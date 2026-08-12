"""Intake forms, field mapping, routing rules, blocklist and spam learning.

Adds per-form identity and mapping for website form submissions (Contact Form 7
and friends), raw payload retention so a mapping can be re-applied later,
provenance on submissions and CRM leads, admin-managed allow/deny entries, and
token statistics for the learning spam filter.

Revision ID: h3c4d5e6f7a8
Revises: g2b3c4d5e6f7
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa


revision = "h3c4d5e6f7a8"
down_revision = "g2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intake_forms",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("form_key", sa.String(length=191), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default="Untitled form"),
        sa.Column("provider", sa.String(length=16), nullable=False, server_default="cf7"),
        sa.Column("site_url", sa.String(length=512), nullable=True),
        sa.Column("schema_hash", sa.String(length=64), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=True),
        sa.Column("mapping", sa.JSON(), nullable=True),
        sa.Column("mapping_status", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("destination", sa.String(length=16), nullable=False, server_default="crm_lead"),
        sa.Column("default_type", sa.String(length=16), nullable=True),
        sa.Column("auto_convert", sa.Boolean(), nullable=True),
        sa.Column("notify_user_id", sa.Uuid(), nullable=True),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("submission_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_submission_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["intake_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["notify_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["job_openings.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("source_id", "form_key", name="uq_intake_form_key"),
    )
    op.create_index("ix_intake_forms_source_id", "intake_forms", ["source_id"])
    op.create_index("ix_intake_forms_form_key", "intake_forms", ["form_key"])
    op.create_index("ix_intake_forms_mapping_status", "intake_forms", ["mapping_status"])
    op.create_index("ix_intake_forms_active", "intake_forms", ["active"])

    op.create_table(
        "intake_routing_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("form_id", sa.Uuid(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("conditions", sa.JSON(), nullable=True),
        sa.Column("outcome", sa.JSON(), nullable=True),
        sa.Column("match_count", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["source_id"], ["intake_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["form_id"], ["intake_forms.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_intake_routing_rules_source_id", "intake_routing_rules", ["source_id"])
    op.create_index("ix_intake_routing_rules_form_id", "intake_routing_rules", ["form_id"])
    op.create_index("ix_intake_routing_rules_priority", "intake_routing_rules", ["priority"])
    op.create_index("ix_intake_routing_rules_active", "intake_routing_rules", ["active"])

    op.create_table(
        "intake_blocklist",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("value", sa.String(length=320), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False, server_default="block"),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("hit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["intake_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_intake_blocklist_kind", "intake_blocklist", ["kind"])
    op.create_index("ix_intake_blocklist_value", "intake_blocklist", ["value"])
    op.create_index("ix_intake_blocklist_source_id", "intake_blocklist", ["source_id"])

    op.create_table(
        "spam_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("spam_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ham_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_spam_tokens_token", "spam_tokens", ["token"], unique=True)

    with op.batch_alter_table("intake_sources") as batch:
        batch.add_column(sa.Column("site_url", sa.String(length=512), nullable=True))
        batch.add_column(sa.Column("signature_ttl_sec", sa.Integer(), nullable=False, server_default="300"))
        batch.add_column(sa.Column("require_timestamp", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("auto_create_forms", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column("captcha_mode", sa.String(length=16), nullable=False, server_default="off"))
        # Widened to hold the Fernet-encrypted form of the signing secret.
        batch.alter_column("signing_secret", type_=sa.String(length=512), existing_nullable=True)

    with op.batch_alter_table("submissions") as batch:
        batch.add_column(sa.Column("converted_candidate_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("form_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("form_key", sa.String(length=191), nullable=True))
        batch.add_column(sa.Column("form_name", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("site_url", sa.String(length=512), nullable=True))
        batch.add_column(sa.Column("raw_payload", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("mapping_status", sa.String(length=16), nullable=False, server_default="none"))
        batch.add_column(sa.Column("utm", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("referrer", sa.String(length=1024), nullable=True))
        batch.add_column(sa.Column("user_agent", sa.String(length=512), nullable=True))
        batch.add_column(sa.Column("content_hash", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("external_id", sa.String(length=128), nullable=True))
        batch.create_foreign_key(
            "fk_submissions_form_id", "intake_forms", ["form_id"], ["id"], ondelete="SET NULL"
        )
        # NULLs compare distinct on both Postgres and SQLite, so submissions
        # without an external id are unaffected by this constraint.
        batch.create_unique_constraint(
            "uq_submission_external", ["source_id", "external_id"]
        )
    op.create_index("ix_submissions_form_id", "submissions", ["form_id"])
    op.create_index("ix_submissions_site_url", "submissions", ["site_url"])
    op.create_index("ix_submissions_content_hash", "submissions", ["content_hash"])
    op.create_index("ix_submissions_external_id", "submissions", ["external_id"])
    op.create_index("ix_submissions_mapping_status", "submissions", ["mapping_status"])

    # Existing rows predate mapping; treat them as already-final so a remap
    # never rewrites data whose original body we no longer have.
    op.execute("UPDATE submissions SET mapping_status = 'mapped'")

    with op.batch_alter_table("crm_leads") as batch:
        batch.add_column(sa.Column("intake_form_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("page_url", sa.String(length=1024), nullable=True))
        batch.add_column(sa.Column("fields", sa.JSON(), nullable=True))
        batch.create_foreign_key(
            "fk_crm_leads_intake_form_id", "intake_forms", ["intake_form_id"], ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_crm_leads_intake_form_id", "crm_leads", ["intake_form_id"])

    # Drop the server defaults now the backfill is done; the models own them.
    with op.batch_alter_table("intake_sources") as batch:
        batch.alter_column("signature_ttl_sec", server_default=None)
        batch.alter_column("require_timestamp", server_default=None)
        batch.alter_column("auto_create_forms", server_default=None)
        batch.alter_column("captcha_mode", server_default=None)
    with op.batch_alter_table("submissions") as batch:
        batch.alter_column("mapping_status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_crm_leads_intake_form_id", table_name="crm_leads")
    with op.batch_alter_table("crm_leads") as batch:
        batch.drop_constraint("fk_crm_leads_intake_form_id", type_="foreignkey")
        batch.drop_column("fields")
        batch.drop_column("page_url")
        batch.drop_column("intake_form_id")

    for name in (
        "ix_submissions_mapping_status",
        "ix_submissions_external_id",
        "ix_submissions_content_hash",
        "ix_submissions_site_url",
        "ix_submissions_form_id",
    ):
        op.drop_index(name, table_name="submissions")
    with op.batch_alter_table("submissions") as batch:
        batch.drop_constraint("uq_submission_external", type_="unique")
        batch.drop_constraint("fk_submissions_form_id", type_="foreignkey")
        for col in (
            "external_id", "content_hash", "user_agent", "referrer", "utm",
            "mapping_status", "raw_payload", "site_url", "form_name", "form_key",
            "form_id", "converted_candidate_id",
        ):
            batch.drop_column(col)

    with op.batch_alter_table("intake_sources") as batch:
        batch.alter_column("signing_secret", type_=sa.String(length=128), existing_nullable=True)
        for col in (
            "captcha_mode", "auto_create_forms", "require_timestamp",
            "signature_ttl_sec", "site_url",
        ):
            batch.drop_column(col)

    op.drop_index("ix_spam_tokens_token", table_name="spam_tokens")
    op.drop_table("spam_tokens")
    for name in (
        "ix_intake_blocklist_source_id",
        "ix_intake_blocklist_value",
        "ix_intake_blocklist_kind",
    ):
        op.drop_index(name, table_name="intake_blocklist")
    op.drop_table("intake_blocklist")
    for name in (
        "ix_intake_routing_rules_active",
        "ix_intake_routing_rules_priority",
        "ix_intake_routing_rules_form_id",
        "ix_intake_routing_rules_source_id",
    ):
        op.drop_index(name, table_name="intake_routing_rules")
    op.drop_table("intake_routing_rules")
    for name in (
        "ix_intake_forms_active",
        "ix_intake_forms_mapping_status",
        "ix_intake_forms_form_key",
        "ix_intake_forms_source_id",
    ):
        op.drop_index(name, table_name="intake_forms")
    op.drop_table("intake_forms")
