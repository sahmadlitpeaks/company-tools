import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SessionOut(BaseModel):
    """A live device session. The token itself is never exposed."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_label: str | None = None
    platform: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime


class PushDeviceIn(BaseModel):
    token: str
    platform: str | None = None
    device: str | None = None


class PushDeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform: str
    device_label: str | None = None
    active: bool
    created_at: datetime
    last_seen_at: datetime | None = None
