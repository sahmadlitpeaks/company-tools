import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WebhookCreate(BaseModel):
    url: str
    description: str | None = None
    events: list[str] = []
    active: bool = True


class WebhookUpdate(BaseModel):
    url: str | None = None
    description: str | None = None
    events: list[str] | None = None
    active: bool | None = None


class WebhookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    description: str | None = None
    events: list[str] = []
    active: bool
    has_secret: bool = False
    created_at: datetime


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    webhook_id: uuid.UUID
    event: str
    status_code: int | None = None
    success: bool
    error: str | None = None
    created_at: datetime
