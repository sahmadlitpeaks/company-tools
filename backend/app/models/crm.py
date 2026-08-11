import uuid

from sqlalchemy import JSON, ForeignKey, Numeric, String, Text
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

    # new | contacted | qualified | won | lost
    status: Mapped[str] = mapped_column(String(32), default="new", index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    value: Mapped[float | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)

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
