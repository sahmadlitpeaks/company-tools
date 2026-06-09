import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ---- Assets / folders (feature #3) ----
class FolderCreate(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None = None
    created_at: datetime


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    folder_id: uuid.UUID | None = None
    name: str
    file_path: str
    content_type: str | None = None
    size_bytes: int
    version: int = 1
    is_public: bool = False
    share_code: str | None = None
    share_expires_at: datetime | None = None
    share_require_lead: bool = False
    share_has_passcode: bool = False
    created_at: datetime


# ---- Branding (feature #4) ----
class BrandKitCreate(BaseModel):
    name: str
    description: str | None = None
    guidelines_url: str | None = None
    primary_colors: str | None = None
    fonts: str | None = None
    logo_url: str | None = None


class BrandKitOut(BrandKitCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


class BrandAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    brand_kit_id: uuid.UUID
    name: str
    category: str
    file_path: str
    content_type: str | None = None
    size_bytes: int
    created_at: datetime


# ---- Products / brochures (feature #5) ----
class ProductCreate(BaseModel):
    name: str
    sku: str | None = None
    description: str | None = None
    landing_url: str | None = None
    image_url: str | None = None


class ProductOut(ProductCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


class BrochureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID | None = None
    title: str
    file_path: str
    content_type: str | None = None
    size_bytes: int
    download_count: int
    version: int = 1
    is_public: bool = False
    share_code: str | None = None
    share_expires_at: datetime | None = None
    share_require_lead: bool = False
    share_has_passcode: bool = False
    created_at: datetime


class ShareSettings(BaseModel):
    """Optional access controls supplied when sharing a document."""

    expires_in_days: int | None = None
    passcode: str | None = None  # None = leave as-is, "" = clear
    require_lead: bool = False


class ShareInfo(BaseModel):
    """Result of sharing / unsharing a document."""

    is_public: bool
    share_code: str | None = None
    share_url: str | None = None
    expires_at: datetime | None = None
    require_lead: bool = False
    has_passcode: bool = False


class BrandBrief(BaseModel):
    """Just enough brand identity to skin the public viewer."""

    name: str
    logo_url: str | None = None
    primary_color: str = "#0b5cab"
    website: str | None = None
    tagline: str | None = None


class PublicDocMeta(BaseModel):
    """Metadata + access flags for the public flipbook viewer."""

    id: uuid.UUID
    kind: str  # "brochure" | "asset"
    title: str
    content_type: str | None = None
    size_bytes: int
    requires_passcode: bool = False
    requires_lead: bool = False
    brand: BrandBrief | None = None


class LeadCapture(BaseModel):
    """A visitor's details, captured before a gated download."""

    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None


class DocVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    content_type: str | None = None
    size_bytes: int
    note: str | None = None
    created_at: datetime


class SharedDocOut(BaseModel):
    """A row in the "Shared with clients" dashboard."""

    kind: str  # "brochure" | "asset"
    id: uuid.UUID
    title: str
    share_code: str
    share_url: str
    public_url: str
    opens: int
    downloads: int
    last_opened: datetime | None = None
    expires_at: datetime | None = None
    require_lead: bool = False
    has_passcode: bool = False
    created_at: datetime


class SearchHit(BaseModel):
    kind: str  # "brochure" | "asset" | "product"
    id: uuid.UUID
    title: str
    subtitle: str | None = None
    href: str  # in-app route


class SearchResults(BaseModel):
    query: str
    hits: list[SearchHit]


class BulkAssetAction(BaseModel):
    ids: list[uuid.UUID]
    action: str  # "delete" | "move" | "share" | "unshare"
    folder_id: uuid.UUID | None = None


# ---- QR codes (feature #5) ----
class QRCodeCreate(BaseModel):
    label: str
    target_url: str
    fill_color: str = "#000000"
    back_color: str = "#ffffff"
    dynamic: bool = True
    product_id: uuid.UUID | None = None


class QRCodeUpdate(BaseModel):
    label: str | None = None
    target_url: str | None = None
    fill_color: str | None = None
    back_color: str | None = None


class QRCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    target_url: str
    fill_color: str
    back_color: str
    scan_count: int
    dynamic: bool
    product_id: uuid.UUID | None = None
    created_at: datetime


# ---- Landing pages (feature #6) ----
class LandingCreate(BaseModel):
    title: str
    slug: str | None = None
    description: str | None = None
    blocks: str | None = None
    html: str | None = None
    theme: str = "light"
    status: str = "draft"


class LandingUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    blocks: str | None = None
    html: str | None = None
    theme: str | None = None
    status: str | None = None


class LandingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    title: str
    description: str | None = None
    blocks: str | None = None
    html: str | None = None
    theme: str
    status: str
    view_count: int
    created_at: datetime


class LandingLeadCreate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    message: str | None = None


class LandingLeadOut(LandingLeadCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    page_id: uuid.UUID
    created_at: datetime


# ---- Email signatures (feature #7) ----
class SignatureTemplateCreate(BaseModel):
    name: str
    description: str | None = None
    html: str
    is_default: bool = False


class SignatureTemplateOut(SignatureTemplateCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


class SignatureRenderRequest(BaseModel):
    template_id: uuid.UUID
    data: dict[str, str] = {}


class EmailSignatureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    template_id: uuid.UUID | None = None
    rendered_html: str | None = None
    created_at: datetime


# ---- Short links (feature #8) ----
class ShortLinkCreate(BaseModel):
    target_url: str
    code: str | None = None
    title: str | None = None
    campaign: str | None = None


class ShortLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    target_url: str
    title: str | None = None
    campaign: str | None = None
    is_active: bool
    click_count: int
    created_at: datetime
