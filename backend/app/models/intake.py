"""Inbound intake — website form submissions (leads, complaints, support,
inquiries, job applications) land here, to be triaged and converted to CRM
leads, recruiting candidates, or tickets.

A source is one connected website; a form is one form on that website. Because
form builders let each site name its fields freely (Contact Form 7 emits
``your-name``, ``tel-123``, ``menu-456``), each form carries its own mapping
from those raw names onto the columns below.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

SUBMISSION_TYPES = {
    "lead", "complaint", "support", "inquiry", "feedback", "job_application", "other",
}
# Inbound items land in `quarantined` for spam screening; clean ones become
# `new` (real leads in the inbox/CRM), likely-spam ones become `spam`.
SUBMISSION_STATUSES = {"quarantined", "new", "in_progress", "resolved", "spam", "archived"}

FORM_PROVIDERS = {"cf7", "gravity", "elementor", "wpforms", "other"}
# How confident we are that a form's fields are correctly mapped:
# none = never mapped, auto = guessed on first sight, mapped = a human saved it,
# partial = mapping ran but some core fields had to be salvaged by shape.
MAPPING_STATUSES = {"none", "auto", "mapped", "partial"}
# Where a submission from this form should end up once it passes screening.
DESTINATIONS = {"crm_lead", "candidate", "ticket", "inbox_only"}

BLOCK_KINDS = {"ip", "cidr", "email", "domain", "keyword", "country", "fingerprint"}
# `allow` always wins over `block`, so a blocked range can be punched through.
BLOCK_ACTIONS = {"block", "quarantine", "allow"}


class IntakeSource(UUIDMixin, TimestampMixin, Base):
    """A connected website. Each has a public key used by its endpoint."""

    __tablename__ = "intake_sources"

    name: Mapped[str] = mapped_column(String(255))
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    default_type: Mapped[str] = mapped_column(String(16), default="lead")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # Auto-create a CRM lead when a clean lead-type submission passes screening.
    auto_convert: Mapped[bool] = mapped_column(Boolean, default=False)
    # Who to notify when this source receives a submission.
    notify_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Optional shared secret: when set, requests must carry a valid
    # X-Signature: sha256=<hex HMAC of the raw body>.
    signing_secret: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Reject more than this many submissions per minute from this source (0=off).
    rate_limit_per_min: Mapped[int] = mapped_column(Integer, default=60)
    # Drop duplicate (same email+message) submissions within this many minutes (0=off).
    dedup_window_min: Mapped[int] = mapped_column(Integer, default=10)
    # Per-source spam thresholds; null falls back to the global defaults.
    spam_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clean_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # The website this source represents, recorded on every lead it produces.
    site_url: Mapped[str | None] = mapped_column(String(512))
    # How far out of date an X-Timestamp may be, in seconds (0 = no window).
    signature_ttl_sec: Mapped[int] = mapped_column(Integer, default=300)
    # Reject requests that carry no X-Timestamp, closing the legacy replay hole.
    require_timestamp: Mapped[bool] = mapped_column(Boolean, default=False)
    # Register unknown form keys automatically on their first submission.
    auto_create_forms: Mapped[bool] = mapped_column(Boolean, default=True)
    # off = ignore any captcha token, score = feed the verdict into the spam
    # score, required = reject outright when verification fails.
    captcha_mode: Mapped[str] = mapped_column(String(16), default="off")


class IntakeForm(UUIDMixin, TimestampMixin, Base):
    """One form on a connected website, with its discovered field catalogue and
    the admin-editable mapping from those fields onto submission columns."""

    __tablename__ = "intake_forms"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("intake_sources.id", ondelete="CASCADE"), index=True
    )
    # Stable per-site identity supplied by the plugin, e.g. "cf7:17".
    form_key: Mapped[str] = mapped_column(String(191), index=True)
    name: Mapped[str] = mapped_column(String(255), default="Untitled form")
    provider: Mapped[str] = mapped_column(String(16), default="cf7")
    site_url: Mapped[str | None] = mapped_column(String(512))
    # Digest of the sorted field-name list; a change means the form was edited.
    schema_hash: Mapped[str | None] = mapped_column(String(64))
    # Discovered fields: [{name, label, type, options, required, sample,
    #                      seen_count, first_seen, last_seen, origin}]
    fields: Mapped[list | None] = mapped_column(JSON)
    # Mapping document: {"version": 1, "rules": [...], "extras": "keep"}
    mapping: Mapped[dict | None] = mapped_column(JSON)
    mapping_status: Mapped[str] = mapped_column(String(16), default="none", index=True)
    destination: Mapped[str] = mapped_column(String(16), default="crm_lead")
    # Per-form overrides; null falls back to the source's setting.
    default_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    auto_convert: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    notify_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Job applications from this form default to this opening.
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("job_openings.id", ondelete="SET NULL"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    submission_count: Mapped[int] = mapped_column(Integer, default=0)
    last_submission_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("source_id", "form_key", name="uq_intake_form_key"),
    )


class IntakeRoutingRule(UUIDMixin, TimestampMixin, Base):
    """An ordered rule deciding what a submission *is* and where it goes.

    Evaluated after mapping and before conversion, so conditions can test both
    the raw field names and the mapped values. First match wins.
    """

    __tablename__ = "intake_routing_rules"

    name: Mapped[str] = mapped_column(String(255))
    # Scope: both null = global; source alone = every form on that site.
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_sources.id", ondelete="CASCADE"), index=True, nullable=True
    )
    form_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_forms.id", ondelete="CASCADE"), index=True, nullable=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # All conditions must match: [{"kind": "page_url", "op": "contains",
    #                              "value": "/careers"}]
    # kind: page_url | form_key | form_name | field | subject | message | type
    conditions: Mapped[list | None] = mapped_column(JSON)
    # Outcome; any key may be omitted to leave that aspect untouched.
    # {"type": "job_application", "destination": "candidate",
    #  "job_id": "...", "job_from_field": "position", "assignee_id": "...",
    #  "auto_convert": true, "tag": "careers"}
    outcome: Mapped[dict | None] = mapped_column(JSON)
    match_count: Mapped[int] = mapped_column(Integer, default=0)


class IntakeBlocklist(UUIDMixin, TimestampMixin, Base):
    """Admin-managed allow/deny entries applied before a submission is stored."""

    __tablename__ = "intake_blocklist"

    kind: Mapped[str] = mapped_column(String(16), index=True)
    value: Mapped[str] = mapped_column(String(320), index=True)
    action: Mapped[str] = mapped_column(String(16), default="block")
    reason: Mapped[str | None] = mapped_column(String(255))
    # Null scope = applies to every source.
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_sources.id", ondelete="CASCADE"), index=True, nullable=True
    )
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SpamToken(UUIDMixin, TimestampMixin, Base):
    """Token statistics learned from the admin's own quarantine decisions.

    Every release (ham) and mark-as-spam updates these counts, so the filter
    adapts to the junk these particular sites attract instead of relying on a
    fixed keyword list.
    """

    __tablename__ = "spam_tokens"

    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    spam_count: Mapped[int] = mapped_column(Integer, default=0)
    ham_count: Mapped[int] = mapped_column(Integer, default=0)


class Submission(UUIDMixin, TimestampMixin, Base):
    """One inbound form submission."""

    __tablename__ = "submissions"

    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_sources.id", ondelete="SET NULL"), index=True, nullable=True
    )
    type: Mapped[str] = mapped_column(String(16), default="lead", index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    phone: Mapped[str | None] = mapped_column(String(64))
    company: Mapped[str | None] = mapped_column(String(255))
    subject: Mapped[str | None] = mapped_column(String(512))
    message: Mapped[str | None] = mapped_column(Text)
    page_url: Mapped[str | None] = mapped_column(String(1024))
    # Any extra form fields not mapped to the columns above.
    payload: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="quarantined", index=True)
    spam_score: Mapped[int] = mapped_column(default=0)
    spam_reasons: Mapped[list | None] = mapped_column(JSON)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    converted_lead_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    converted_ticket_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    converted_candidate_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64))

    # ---- Provenance ------------------------------------------------------
    form_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_forms.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Denormalised so provenance survives the form being deleted or re-keyed.
    form_key: Mapped[str | None] = mapped_column(String(191))
    form_name: Mapped[str | None] = mapped_column(String(255))
    site_url: Mapped[str | None] = mapped_column(String(512), index=True)
    # The complete original body, never mutated. Everything else can be
    # recomputed from this, which is what makes re-mapping safe.
    raw_payload: Mapped[dict | None] = mapped_column(JSON)
    mapping_status: Mapped[str] = mapped_column(String(16), default="none", index=True)
    utm: Mapped[dict | None] = mapped_column(JSON)
    referrer: Mapped[str | None] = mapped_column(String(1024))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    # Digest of the normalised message, for spotting one payload blasted at
    # many sites at once.
    content_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    # Plugin-generated per-submission id; the idempotency/retry key.
    external_id: Mapped[str | None] = mapped_column(String(128), index=True)

    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_submission_external"),
    )
