import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CardBase(BaseModel):
    full_name: str
    title: str | None = None
    company: str | None = "AG Holding"
    email: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    website: str | None = None
    linkedin: str | None = None
    address: str | None = None
    bio: str | None = None
    photo_url: str | None = None
    accent_color: str = "#0b5cab"
    lead_capture_enabled: bool = True
    is_active: bool = True


class CardCreate(CardBase):
    slug: str | None = None


class CardUpdate(BaseModel):
    full_name: str | None = None
    title: str | None = None
    company: str | None = None
    email: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    website: str | None = None
    linkedin: str | None = None
    address: str | None = None
    bio: str | None = None
    photo_url: str | None = None
    accent_color: str | None = None
    lead_capture_enabled: bool | None = None
    is_active: bool | None = None


class CardOut(CardBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    owner_id: uuid.UUID
    created_at: datetime


class CardPublic(BaseModel):
    """What anonymous visitors see when scanning a card."""

    model_config = ConfigDict(from_attributes=True)

    slug: str
    full_name: str
    title: str | None = None
    company: str | None = None
    email: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    website: str | None = None
    linkedin: str | None = None
    address: str | None = None
    bio: str | None = None
    photo_url: str | None = None
    accent_color: str
    lead_capture_enabled: bool


class LeadCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    message: str | None = None


class LeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    card_id: uuid.UUID
    name: str
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    message: str | None = None
    status: str
    created_at: datetime
