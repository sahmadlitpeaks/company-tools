"""Per-provider record of each sync attempt, so the UI can show when data last
arrived and why a provider went quiet."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class AdSyncRun(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "ad_sync_runs"

    provider: Mapped[str] = mapped_column(String(16), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    campaigns_synced: Mapped[int] = mapped_column(Integer, default=0)
    metrics_upserted: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
