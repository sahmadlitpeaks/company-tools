"""Import all models so Alembic's autogenerate can see them."""
from app.models.user import User  # noqa: F401
from app.models.brand import Brand  # noqa: F401
from app.models.brand_document import BrandDocument, BrandDocumentVersion  # noqa: F401
from app.models.app_setting import AppSetting  # noqa: F401
from app.models.crm import CrmLead  # noqa: F401
from app.models.campaign import Campaign, CampaignMetric  # noqa: F401
from app.models.card import DigitalCard, CardScan, Lead  # noqa: F401
from app.models.asset import Folder, Asset  # noqa: F401
from app.models.branding import BrandKit, BrandAsset  # noqa: F401
from app.models.product import Product, Brochure  # noqa: F401
from app.models.qrcode import QRCode  # noqa: F401
from app.models.landing import LandingPage, LandingLead  # noqa: F401
from app.models.signature import EmailSignature, SignatureTemplate  # noqa: F401
from app.models.shortlink import ShortLink, LinkClick  # noqa: F401
from app.models.transfer import SecureTransfer  # noqa: F401
from app.models.tracked_asset import (  # noqa: F401
    AssetAttachment,
    AssetCategory,
    AssetEvent,
    AssetLocation,
    TrackedAsset,
)
from app.models.activity import ActivityLog  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.docversion import DocVersion  # noqa: F401
from app.models.workplace import (  # noqa: F401
    ApprovalRequest,
    Attachment,
    KnowledgeArticle,
    Task,
    Ticket,
    TicketComment,
)
