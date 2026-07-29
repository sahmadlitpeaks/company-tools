import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class CafeMenuItem(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "cafe_menu_items"
    name: Mapped[str] = mapped_column(String(180), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    available: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class CafeOrder(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "cafe_orders"
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cafe_menu_items.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="placed", index=True)
    status_history: Mapped[list] = mapped_column(JSON, default=list)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class BookingSpace(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "booking_spaces"
    name: Mapped[str] = mapped_column(String(180), index=True)
    location: Mapped[str] = mapped_column(String(255), index=True)
    capacity: Mapped[int] = mapped_column(Integer, default=1)
    equipment: Mapped[list] = mapped_column(JSON, default=list)
    type: Mapped[str] = mapped_column(String(16), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class SpaceBooking(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "space_bookings"
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booking_spaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(500))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Dubai")
    status: Mapped[str] = mapped_column(String(16), default="confirmed", index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class Visitor(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "visitors"
    visitor_name: Mapped[str] = mapped_column(String(255), index=True)
    visitor_email: Mapped[str | None] = mapped_column(String(320))
    host_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    office_location: Mapped[str] = mapped_column(String(255), index=True)
    visit_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    purpose: Mapped[str | None] = mapped_column(Text)
    maps_url: Mapped[str | None] = mapped_column(String(2048))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="expected", index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class PurchaseRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "purchase_requests"
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    approval_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("approval_requests.id", ondelete="RESTRICT"), unique=True, index=True)
    item: Mapped[str] = mapped_column(String(255), index=True)
    reason: Mapped[str] = mapped_column(Text)
    vendor: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255))
    estimated_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    final_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    target_type: Mapped[str] = mapped_column(String(20))
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result_type: Mapped[str | None] = mapped_column(String(20))
    result_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class CompanyEvent(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "company_events"
    title: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    location: Mapped[str | None] = mapped_column(String(255))
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class BackupRecord(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "backup_records"
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    filename: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str | None] = mapped_column(String(1024))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="created", index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Idea(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "ideas"
    title: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), default="idea", index=True)
    status: Mapped[str] = mapped_column(String(20), default="submitted", index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    submitted_name: Mapped[str | None] = mapped_column(String(255))
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)


class IdeaVote(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "idea_votes"
    idea_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ideas.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class IdeaComment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "idea_comments"
    idea_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ideas.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)


class LostFoundReport(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "lost_found_reports"
    kind: Mapped[str] = mapped_column(String(12), index=True)
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(255), index=True)
    item_date: Mapped[object] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    reporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    claimant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)
