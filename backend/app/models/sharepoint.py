"""Private derived content. No SharePoint file bytes or download URLs are stored."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class SharePointSource(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "sharepoint_sources"
    scope_key: Mapped[str] = mapped_column(String(64), unique=True)
    tenant_id: Mapped[str] = mapped_column(String(64))
    site_id: Mapped[str] = mapped_column(String(255))
    drive_id: Mapped[str] = mapped_column(String(255))
    folder_id: Mapped[str] = mapped_column(String(255))
    policy: Mapped[str] = mapped_column(String(16), default="review")
    rules_cipher: Mapped[str | None] = mapped_column(Text)
    policy_version: Mapped[int] = mapped_column(Integer, default=1)
    delta_link: Mapped[str | None] = mapped_column(Text)
    next_link: Mapped[str | None] = mapped_column(Text)
    generation: Mapped[str | None] = mapped_column(String(36))
    active_run_id: Mapped[str | None] = mapped_column(String(36))
    lease_owner: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SharePointConnection(TimestampMixin, Base):
    __tablename__ = "sharepoint_connections"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64))
    object_id: Mapped[str] = mapped_column(String(64))
    client_id: Mapped[str] = mapped_column(String(64))
    token_cipher: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)


class SharePointDocument(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "sharepoint_documents"
    __table_args__ = (UniqueConstraint("source_id", "item_id", name="uq_sharepoint_source_item"),)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sharepoint_sources.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(String(255))
    parent_id: Mapped[str | None] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(Text, default="")
    path: Mapped[str | None] = mapped_column(Text, default="")
    web_url: Mapped[str] = mapped_column(Text, default="")
    mime_type: Mapped[str] = mapped_column(String(255), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[str] = mapped_column(Text, default="")
    modified_at: Mapped[str | None] = mapped_column(String(64))
    is_folder: Mapped[bool] = mapped_column(Boolean, default=False)
    in_scope: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    seen_generation: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    error_code: Mapped[str | None] = mapped_column(String(80))
    segments: Mapped[list | None] = mapped_column(JSON)
    mapping_cipher: Mapped[str | None] = mapped_column(Text)
    analysis: Mapped[dict | None] = mapped_column(JSON)
    usage: Mapped[dict | None] = mapped_column(JSON)
    languages: Mapped[list | None] = mapped_column(JSON)
    fingerprint: Mapped[str | None] = mapped_column(String(64))
    payload_hash: Mapped[str | None] = mapped_column(String(64))
    approval_hash: Mapped[str | None] = mapped_column(String(64))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SharePointRun(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "sharepoint_runs"
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sharepoint_sources.id", ondelete="CASCADE"), index=True)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(24), default="queued")
    error_code: Mapped[str | None] = mapped_column(String(80))
    discovered: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SharePointReminder(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "sharepoint_reminders"
    __table_args__ = (
        UniqueConstraint("document_id", "dedup_key", name="uq_sharepoint_reminder_dedup"),
    )
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sharepoint_sources.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sharepoint_documents.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(40), default="expiry")
    target_date: Mapped[str] = mapped_column(String(10))
    reminder_date: Mapped[str] = mapped_column(String(10), index=True)
    lead_days: Mapped[int] = mapped_column(Integer, default=30)
    responsible_name: Mapped[str | None] = mapped_column(String(255))
    recipient_email: Mapped[str | None] = mapped_column(String(320))
    amount: Mapped[float | None] = mapped_column(Float, default=None)
    currency: Mapped[str | None] = mapped_column(String(10), default=None)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    dedup_key: Mapped[str] = mapped_column(String(128))
    notes: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(255))
