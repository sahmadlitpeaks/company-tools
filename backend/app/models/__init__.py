"""Import all models so Alembic's autogenerate can see them."""
from app.models.user import User  # noqa: F401
from app.models.card import DigitalCard, CardScan, Lead  # noqa: F401
from app.models.asset import Folder, Asset  # noqa: F401
from app.models.branding import BrandKit, BrandAsset  # noqa: F401
from app.models.product import Product, Brochure  # noqa: F401
from app.models.qrcode import QRCode  # noqa: F401
from app.models.landing import LandingPage, LandingLead  # noqa: F401
from app.models.signature import EmailSignature, SignatureTemplate  # noqa: F401
from app.models.shortlink import ShortLink, LinkClick  # noqa: F401
from app.models.transfer import SecureTransfer  # noqa: F401
from app.models.tracked_asset import TrackedAsset, AssetEvent  # noqa: F401
from app.models.activity import ActivityLog  # noqa: F401
from app.models.notification import Notification  # noqa: F401
