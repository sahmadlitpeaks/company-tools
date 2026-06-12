import uuid

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


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

    # card | landing | manual | import | facebook | google | instagram | tiktok | other
    source: Mapped[str] = mapped_column(String(32), default="manual", index=True)
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
