import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CompanyBase(BaseModel):
    name: str
    slug: str | None = None
    logo_url: str | None = None
    icon_url: str | None = None
    primary_color: str = "#0b5cab"
    secondary_color: str | None = None
    accent_color: str = "#0b5cab"
    font_family: str | None = None
    palette: str | None = None
    website: str | None = None
    email_domain: str | None = None
    contact_email: str | None = None
    phone: str | None = None
    address: str | None = None
    tagline: str | None = None
    social: str | None = None
    is_active: bool = True


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: str | None = None
    logo_url: str | None = None
    icon_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    font_family: str | None = None
    palette: str | None = None
    website: str | None = None
    email_domain: str | None = None
    contact_email: str | None = None
    phone: str | None = None
    address: str | None = None
    tagline: str | None = None
    social: str | None = None
    is_active: bool | None = None


class CompanyOut(CompanyBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_default: bool
    created_at: datetime
