"""Admin-managed settings store, with a small encrypted-secret helper.

Azure Entra ID can be configured here (from the admin UI) instead of via
environment variables. Values stored in the DB take precedence over env; the
client secret is encrypted at rest with a key derived from SECRET_KEY.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.app_setting import AppSetting

# Keys used by the Azure integration.
AZURE_KEYS = {
    "azure_tenant_id",
    "azure_client_id",
    "azure_client_secret",  # stored encrypted
    "azure_redirect_uri",
}


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str | None:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        return None


async def get_all(db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(select(AppSetting))).scalars().all()
    return {r.key: r.value for r in rows if r.value is not None}


async def set_many(db: AsyncSession, values: dict[str, str | None]) -> None:
    for key, value in values.items():
        row = await db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
    await db.commit()


async def get_allowed_domains(db: AsyncSession) -> list[str]:
    """Effective email-domain allowlist: DB value falls back to env config."""
    stored = await get_all(db)
    raw = stored.get("allowed_email_domains")
    if raw is None:
        return settings.allowed_domains
    return [d.strip().lstrip("@").lower() for d in raw.split(",") if d.strip()]


def email_domain_allowed(email: str | None, allowed: list[str]) -> bool:
    if not allowed:
        return True  # no allowlist configured -> open
    if not email or "@" not in email:
        return False
    return email.rsplit("@", 1)[1].lower() in allowed


# Organization-wide appearance default (users may override locally).
APPEARANCE_DEFAULT = {
    "mode": "light",          # light | dark | system
    "accent": "#0b5cab",
    "density": "comfortable",  # comfortable | compact
    "font": "system",          # system | inter | serif
}


async def get_bamboo_config(db: AsyncSession) -> dict:
    """BambooHR connection (subdomain + API key, key encrypted at rest)."""
    stored = await get_all(db)
    subdomain = stored.get("bamboo_subdomain") or None
    key_enc = stored.get("bamboo_api_key")
    api_key = decrypt(key_enc) if key_enc else None
    return {
        "subdomain": subdomain,
        "api_key": api_key,
        "configured": bool(subdomain and api_key),
    }


async def get_appearance(db: AsyncSession) -> dict:
    stored = await get_all(db)
    result = dict(APPEARANCE_DEFAULT)
    for key in APPEARANCE_DEFAULT:
        v = stored.get(f"appearance_{key}")
        if v:
            result[key] = v
    return result


async def get_azure_config(db: AsyncSession) -> dict:
    """Effective Azure config: DB values fall back to environment."""
    stored = await get_all(db)
    secret_enc = stored.get("azure_client_secret")
    secret = decrypt(secret_enc) if secret_enc else (settings.AZURE_CLIENT_SECRET or None)

    tenant = stored.get("azure_tenant_id") or settings.AZURE_TENANT_ID or None
    client_id = stored.get("azure_client_id") or settings.AZURE_CLIENT_ID or None
    redirect = (
        stored.get("azure_redirect_uri")
        or settings.AZURE_REDIRECT_URI
        or None
    )
    from_db = any(k in stored for k in AZURE_KEYS)
    return {
        "tenant_id": tenant,
        "client_id": client_id,
        "client_secret": secret,
        "redirect_uri": redirect,
        "configured": bool(tenant and client_id and secret),
        "source": "database" if from_db else "environment",
    }
