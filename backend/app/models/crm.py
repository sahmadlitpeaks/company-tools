import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# The documented set of lead origins. `web` covers anything arriving through the
# intake pipeline (website forms). Kept here so the API can validate writes and
# the UI can build its filter from one place rather than a hardcoded array.
LEAD_SOURCES = {
    "card", "landing", "web", "manual", "import",
    "facebook", "google", "instagram", "tiktok", "other",
}

# Pipeline stages in order. The first five are open; won and lost are closed.
LEAD_STATUSES = ("new", "contacted", "qualified", "proposal", "negotiation", "won", "lost")
OPEN_STATUSES = frozenset(LEAD_STATUSES[:5])
LEAD_PRIORITIES = ("high", "medium", "low")

# Timeline entries people log by hand, and the ones that count as contact.
MANUAL_ACTIVITY_KINDS = ("note", "call", "email", "meeting")
CONTACT_ACTIVITY_KINDS = frozenset({"call", "email", "meeting"})


class CrmLead(UUIDMixin, TimestampMixin, Base):
    """A unified CRM lead/contact.

    Aggregates leads from digital cards and landing-page forms (ingested
    automatically), plus manually-added and CSV-imported contacts, into one
    pipeline with status, owner and value.
    """

    __tablename__ = "crm_leads"

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    phone: Mapped[str | None] = mapped_column(String(64))
    company: Mapped[str | None] = mapped_column(String(255))

    # One of LEAD_SOURCES above.
    source: Mapped[str] = mapped_column(String(32), default="manual", index=True)
    # Human label for the origin, e.g. "Acme Website · Contact form".
    source_detail: Mapped[str | None] = mapped_column(String(255))

    # One of LEAD_STATUSES above.
    status: Mapped[str] = mapped_column(String(32), default="new", index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    value: Mapped[float | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)

    # Qualification and follow-up. `priority` is one of LEAD_PRIORITIES; `tags`
    # is a list of lowercase labels. `lost_reason` is required while lost.
    priority: Mapped[str | None] = mapped_column(String(16), index=True)
    tags: Mapped[list | None] = mapped_column(JSON)
    follow_up_date: Mapped[date | None] = mapped_column(Date, index=True)
    next_step: Mapped[str | None] = mapped_column(String(255))
    expected_close_date: Mapped[date | None] = mapped_column(Date)
    lost_reason: Mapped[str | None] = mapped_column(String(255))
    # Set when a call, email or meeting is logged on the timeline.
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Provenance for de-duped ingestion from card/landing leads.
    origin_type: Mapped[str | None] = mapped_column(String(32))
    origin_id: Mapped[str | None] = mapped_column(String(64), index=True)

    # Which website form produced this lead (intake pipeline only). The site is
    # reachable through the form; `source_detail` is display text, not a key.
    intake_form_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_forms.id", ondelete="SET NULL"), index=True, nullable=True
    )
    page_url: Mapped[str | None] = mapped_column(String(1024))
    # Labelled snapshot of every submitted field that had no column of its own,
    # so an unmapped form still yields a complete lead: [{key, label, value}].
    fields: Mapped[list | None] = mapped_column(JSON)


# Import de-duplication matches emails case-insensitively.
Index("ix_crm_leads_email_lower", func.lower(CrmLead.email))


class CrmActivity(UUIDMixin, TimestampMixin, Base):
    """One entry on a lead's timeline.

    `kind` is a MANUAL_ACTIVITY_KINDS entry someone logged, or a system entry:
    `created`, `change` (stage, owner, value or priority edits) or `import`.
    """

    __tablename__ = "crm_activities"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("crm_leads.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), default="note")
    body: Mapped[str] = mapped_column(Text)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
