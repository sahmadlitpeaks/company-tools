"""Leads hub: every source a lead came from, and a phone key for de-duplication.

Each existing lead gets one source row from its own origin, so the history is
complete from the start. Existing duplicates are not merged automatically.

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
"""
import re
import uuid

from alembic import op
import sqlalchemy as sa

revision = "a9b0c1d2e3f4"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def _phone_key(phone):
    digits = re.sub(r"\D", "", phone or "")
    return digits[-9:] if len(digits) >= 7 else None


def upgrade():
    op.add_column("crm_leads", sa.Column("phone_key", sa.String(16), nullable=True))
    op.create_index("ix_crm_leads_phone_key", "crm_leads", ["phone_key"])
    sources = op.create_table(
        "crm_lead_sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("lead_id", sa.Uuid(), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("source_detail", sa.String(255), nullable=True),
        sa.Column("origin_type", sa.String(32), nullable=True),
        sa.Column("origin_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for column in ("lead_id", "source", "origin_id", "created_at"):
        op.create_index(f"ix_crm_lead_sources_{column}", "crm_lead_sources", [column])

    bind = op.get_bind()
    leads = sa.table("crm_leads", sa.column("id", sa.Uuid), sa.column("phone", sa.String),
                     sa.column("phone_key", sa.String), sa.column("source", sa.String),
                     sa.column("source_detail", sa.String), sa.column("origin_type", sa.String),
                     sa.column("origin_id", sa.String), sa.column("created_at", sa.DateTime(timezone=True)))
    rows = bind.execute(sa.select(leads.c.id, leads.c.phone, leads.c.source, leads.c.source_detail,
                                  leads.c.origin_type, leads.c.origin_id, leads.c.created_at)).all()
    batch = []
    for lead_id, phone, source, detail, origin_type, origin_id, created_at in rows:
        key = _phone_key(phone)
        if key:
            bind.execute(leads.update().where(leads.c.id == lead_id).values(phone_key=key))
        batch.append({"id": uuid.uuid4(), "lead_id": lead_id, "source": source or "manual",
                      "source_detail": (detail or None) and detail[:255], "origin_type": origin_type or "manual",
                      "origin_id": origin_id, "created_at": created_at})
        if len(batch) >= 500:
            op.bulk_insert(sources, batch)
            batch = []
    if batch:
        op.bulk_insert(sources, batch)


def downgrade():
    for column in ("created_at", "origin_id", "source", "lead_id"):
        op.drop_index(f"ix_crm_lead_sources_{column}", table_name="crm_lead_sources")
    op.drop_table("crm_lead_sources")
    op.drop_index("ix_crm_leads_phone_key", table_name="crm_leads")
    op.drop_column("crm_leads", "phone_key")
