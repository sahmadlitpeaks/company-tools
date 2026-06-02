import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TransferOut(BaseModel):
    """Sender's view of a transfer (no secrets)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str | None = None
    size_bytes: int
    recipient_email: str
    message: str | None = None
    has_password: bool
    one_time: bool
    max_downloads: int
    download_count: int
    expires_at: datetime | None = None
    is_consumed: bool
    email_sent: bool
    created_at: datetime


class TransferCreated(TransferOut):
    """Returned once at creation — includes the share link with the token."""

    share_url: str


class TransferMeta(BaseModel):
    """Public, pre-download metadata for a recipient."""

    filename: str
    size_bytes: int
    requires_password: bool
    sender_name: str | None = None
    message: str | None = None
    expires_at: datetime | None = None
    status: str  # "available" | "expired" | "consumed"


class TransferDownloadRequest(BaseModel):
    password: str | None = None
