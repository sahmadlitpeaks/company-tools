import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _webhook_url(value: str) -> str:
    value = value.strip()
    if not value.lower().startswith(("http://", "https://")):
        raise ValueError("Webhook URL must start with http:// or https://")
    return value


class WebhookCreate(BaseModel):
    url: str = Field(max_length=1024)
    description: str | None = None
    events: list[str] = []
    active: bool = True

    _validate_url = field_validator("url")(_webhook_url)


class WebhookUpdate(BaseModel):
    url: str | None = Field(default=None, max_length=1024)
    description: str | None = None
    events: list[str] | None = None
    active: bool | None = None

    _validate_url = field_validator("url")(
        lambda value: _webhook_url(value) if value is not None else value
    )


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
