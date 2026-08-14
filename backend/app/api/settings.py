from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import get_app_token
from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.ad_sync.fx import BASE_CURRENCY, FX_PREFIX
from app.services.ad_sync.service import CREDENTIAL_KEY, PROVIDERS
from app.services.app_settings import (
    CAPTCHA_PROVIDERS,
    encrypt,
    get_all,
    get_allowed_domains,
    get_appearance,
    get_azure_config,
    get_bamboo_config,
    get_captcha_config,
    get_integration,
    integrations_status,
    set_integration,
    set_many,
)

router = APIRouter(prefix="/settings", tags=["settings"])

VALID_MODES = {"light", "dark", "system"}
VALID_DENSITY = {"comfortable", "compact"}
VALID_FONTS = {"system", "dm-sans", "serif"}


class AppearanceIn(BaseModel):
    mode: str | None = None
    accent: str | None = None
    density: str | None = None
    font: str | None = None


@router.get("/appearance")
async def get_appearance_settings(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Org-wide appearance default (readable by any signed-in user)."""
    return await get_appearance(db)


@router.put("/appearance")
async def put_appearance_settings(
    payload: AppearanceIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if payload.mode and payload.mode not in VALID_MODES:
        raise HTTPException(status_code=422, detail="Invalid mode")
    if payload.density and payload.density not in VALID_DENSITY:
        raise HTTPException(status_code=422, detail="Invalid density")
    if payload.font and payload.font not in VALID_FONTS:
        raise HTTPException(status_code=422, detail="Invalid font")
    values: dict[str, str | None] = {}
    for key in ("mode", "accent", "density", "font"):
        v = getattr(payload, key)
        if v is not None:
            values[f"appearance_{key}"] = v.strip() or None
    await set_many(db, values)
    return await get_appearance(db)


class SecurityConfigIn(BaseModel):
    # Comma-separated email domains; blank clears the allowlist (open sign-up).
    allowed_email_domains: str | None = None


class BambooConfigIn(BaseModel):
    subdomain: str | None = None
    api_key: str | None = None  # blank keeps the existing key


@router.get("/bamboo")
async def get_bamboo(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    cfg = await get_bamboo_config(db)
    return {"subdomain": cfg["subdomain"], "key_set": bool(cfg["api_key"]), "configured": cfg["configured"]}


@router.put("/bamboo")
async def put_bamboo(
    payload: BambooConfigIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    values: dict[str, str | None] = {
        "bamboo_subdomain": (payload.subdomain or "").strip() or None,
    }
    if payload.api_key and payload.api_key.strip():
        values["bamboo_api_key"] = encrypt(payload.api_key.strip())
    await set_many(db, values)
    cfg = await get_bamboo_config(db)
    return {"configured": cfg["configured"]}


class CaptchaConfigIn(BaseModel):
    provider: str | None = None  # turnstile | recaptcha | hcaptcha | "" to disable
    site_key: str | None = None
    secret: str | None = None  # blank keeps the existing secret


@router.get("/captcha")
async def get_captcha(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    cfg = await get_captcha_config(db)
    # The secret itself is never returned — only whether one is stored.
    return {
        "provider": cfg["provider"],
        "site_key": cfg["site_key"],
        "secret_set": bool(cfg["secret"]),
        "configured": cfg["configured"],
        "providers": sorted(CAPTCHA_PROVIDERS),
    }


@router.put("/captcha")
async def put_captcha(
    payload: CaptchaConfigIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    provider = (payload.provider or "").strip().lower()
    if provider and provider not in CAPTCHA_PROVIDERS:
        raise HTTPException(status_code=422, detail="Unknown captcha provider")
    values: dict[str, str | None] = {
        "captcha_provider": provider or None,
        "captcha_site_key": (payload.site_key or "").strip() or None,
    }
    if payload.secret and payload.secret.strip():
        values["captcha_secret"] = encrypt(payload.secret.strip())
    await set_many(db, values)
    cfg = await get_captcha_config(db)
    return {"configured": cfg["configured"], "provider": cfg["provider"]}


class IntegrationIn(BaseModel):
    values: dict[str, str | None] = {}


@router.get("/integrations")
async def get_integrations(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    """Catalogue + status of third-party integrations (secrets never returned)."""
    return await integrations_status(db)


@router.put("/integrations/{provider}")
async def put_integration(
    provider: str,
    payload: IntegrationIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    try:
        await set_integration(db, provider, payload.values)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown integration")
    return await integrations_status(db)


class FxRatesIn(BaseModel):
    rates: dict[str, str] = {}


def _stored_rates(stored: dict) -> dict[str, str]:
    return {
        key[len(FX_PREFIX):].upper(): value
        for key, value in stored.items()
        if key.startswith(FX_PREFIX) and value
    }


@router.get("/fx-rates")
async def get_fx_rates(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    """Currency to AED rates. AED itself is implicitly 1 and not stored."""
    return {"base": BASE_CURRENCY, "rates": _stored_rates(await get_all(db))}


@router.put("/fx-rates")
async def put_fx_rates(
    payload: FxRatesIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    values: dict[str, str | None] = {}
    for currency, raw in payload.rates.items():
        code = (currency or "").strip().upper()
        if len(code) != 3 or not code.isalpha():
            raise HTTPException(status_code=422, detail=f"Invalid currency: {currency}")
        text = (raw or "").strip()
        if not text:
            values[f"{FX_PREFIX}{code}"] = None
            continue
        try:
            rate = Decimal(text)
        except InvalidOperation:
            raise HTTPException(status_code=422, detail=f"Invalid rate for {code}")
        if rate <= 0:
            raise HTTPException(status_code=422, detail=f"Rate for {code} must be > 0")
        values[f"{FX_PREFIX}{code}"] = text
    if values:
        await set_many(db, values)
    return {"base": BASE_CURRENCY, "rates": _stored_rates(await get_all(db))}


@router.post("/integrations/{provider}/test")
async def test_integration(
    provider: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Make a cheap read call so "Connected" means the account was reached,
    rather than merely that a field was filled in."""
    key = next((k for k, v in CREDENTIAL_KEY.items() if v == provider), provider)
    client = PROVIDERS.get(key)
    if client is None:
        raise HTTPException(status_code=404, detail="Unknown integration")
    integration = await get_integration(db, provider)
    if not integration or not integration["configured"]:
        return {"ok": False, "error": "Not configured"}
    return await client.verify(integration["values"])


@router.get("/security")
async def get_security(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    return {"allowed_email_domains": await get_allowed_domains(db)}


@router.put("/security")
async def put_security(
    payload: SecurityConfigIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    raw = (payload.allowed_email_domains or "").strip()
    await set_many(db, {"allowed_email_domains": raw or None})
    return {"allowed_email_domains": await get_allowed_domains(db)}


class SLAConfigIn(BaseModel):
    work_start: int | None = None       # hour, 0–23
    work_end: int | None = None         # hour, 1–24
    tz_offset: int | None = None        # hours east of UTC
    workdays: str | None = None         # e.g. "sun,mon,tue,wed,thu"
    holidays: str | None = None         # comma-separated ISO dates


def _sla_payload(cfg) -> dict:
    rev = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}
    order = [6, 0, 1, 2, 3, 4, 5]
    return {
        "work_start": cfg.start_h,
        "work_end": cfg.end_h,
        "tz_offset": cfg.tz_offset,
        "workdays": ",".join(rev[d] for d in order if d in cfg.workdays),
        "holidays": ",".join(sorted(d.isoformat() for d in cfg.holidays)),
    }


@router.get("/sla")
async def get_sla(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    from app.services.sla import get_sla_config

    return _sla_payload(await get_sla_config(db))


@router.put("/sla")
async def put_sla(
    payload: SLAConfigIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    from app.services.sla import get_sla_config

    if payload.work_start is not None and not 0 <= payload.work_start <= 23:
        raise HTTPException(status_code=422, detail="work_start must be 0–23")
    if payload.work_end is not None and not 1 <= payload.work_end <= 24:
        raise HTTPException(status_code=422, detail="work_end must be 1–24")
    values: dict[str, str | None] = {}
    if payload.work_start is not None:
        values["sla_work_start"] = str(payload.work_start)
    if payload.work_end is not None:
        values["sla_work_end"] = str(payload.work_end)
    if payload.tz_offset is not None:
        values["sla_tz_offset"] = str(payload.tz_offset)
    if payload.workdays is not None:
        values["sla_workdays"] = payload.workdays.strip() or None
    if payload.holidays is not None:
        values["sla_holidays"] = payload.holidays.strip() or None
    await set_many(db, values)
    return _sla_payload(await get_sla_config(db))


class AzureConfigIn(BaseModel):
    tenant_id: str | None = None
    client_id: str | None = None
    # Leave blank to keep the existing secret.
    client_secret: str | None = None
    redirect_uri: str | None = None


@router.get("/azure")
async def get_azure(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    cfg = await get_azure_config(db)
    return {
        "tenant_id": cfg["tenant_id"],
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "secret_set": bool(cfg["client_secret"]),
        "configured": cfg["configured"],
        "source": cfg["source"],
    }


@router.put("/azure")
async def put_azure(
    payload: AzureConfigIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    values: dict[str, str | None] = {
        "azure_tenant_id": (payload.tenant_id or "").strip() or None,
        "azure_client_id": (payload.client_id or "").strip() or None,
        "azure_redirect_uri": (payload.redirect_uri or "").strip() or None,
    }
    # Only overwrite the secret when a new one is supplied.
    if payload.client_secret and payload.client_secret.strip():
        values["azure_client_secret"] = encrypt(payload.client_secret.strip())
    await set_many(db, values)
    cfg = await get_azure_config(db)
    return {"configured": cfg["configured"], "source": cfg["source"]}


@router.post("/azure/test")
async def test_azure(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    """Validate the saved config by requesting an app-only token."""
    cfg = await get_azure_config(db)
    if not cfg["configured"]:
        return {"ok": False, "error": "Azure is not fully configured."}
    try:
        await get_app_token(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
        return {"ok": True, "message": "Connected to Azure successfully."}
    except Exception as e:  # noqa: BLE001 — surface the provider error to the admin
        return {"ok": False, "error": str(e)[:300]}
