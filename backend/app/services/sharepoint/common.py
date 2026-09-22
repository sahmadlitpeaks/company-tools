import hashlib
import json
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings


class SharePointError(Exception):
    """Only safe, fixed codes cross the API/log boundary."""
    def __init__(self, code: str, status: int = 503):
        self.code, self.status = code, status
        super().__init__(code)


def now():
    return datetime.now(timezone.utc)


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def encryption():
    try:
        keys = [settings.SHAREPOINT_ENCRYPTION_KEY, *settings.SHAREPOINT_PREVIOUS_ENCRYPTION_KEYS.split(",")]
        return MultiFernet([Fernet(k.strip().encode()) for k in keys if k.strip()])
    except (ValueError, TypeError):
        raise SharePointError("encryption_not_configured") from None


def encrypt(value) -> str:
    return encryption().encrypt(json.dumps(value, ensure_ascii=False).encode()).decode()


def decrypt(value: str):
    try:
        return json.loads(encryption().decrypt(value.encode()))
    except (InvalidToken, ValueError, TypeError):
        raise SharePointError("encryption_key_unavailable") from None


def configuration_errors():
    names = ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "FOLDER_ID", "REDIRECT_URI", "ENCRYPTION_KEY"]
    missing = [f"SHAREPOINT_{name}" for name in names if not getattr(settings, f"SHAREPOINT_{name}")]
    if not missing:
        try:
            uuid.UUID(settings.SHAREPOINT_TENANT_ID)
            uuid.UUID(settings.SHAREPOINT_CLIENT_ID)
            encryption()
            if not (1024 <= settings.SHAREPOINT_MAX_FILE_BYTES <= 100 * 1024 * 1024 and
                    100 <= settings.SHAREPOINT_MAX_TEXT_CHARS <= 500000 and
                    1 <= settings.SHAREPOINT_MAX_ITEMS <= 10000 and
                    5 <= settings.SHAREPOINT_PARSER_TIMEOUT_SECONDS <= 600):
                raise ValueError()
            parsed = urlparse(settings.SHAREPOINT_REDIRECT_URI)
            if not parsed.hostname or parsed.username or parsed.fragment or parsed.query:
                raise ValueError()
            if parsed.scheme != "https" and not (settings.ENVIRONMENT == "development" and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
                raise ValueError()
        except (ValueError, SharePointError):
            missing.append("invalid_identity_redirect_or_encryption_configuration")
    return missing


def require_config():
    if not settings.SHAREPOINT_ENABLED:
        raise SharePointError("sharepoint_disabled")
    if configuration_errors():
        raise SharePointError("sharepoint_not_configured")


def is_reviewer(user):
    return str(user.id) in {s.strip() for s in settings.SHAREPOINT_REVIEWER_IDS.split(",") if s.strip()}
