from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import get_app_token
from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.app_settings import (
    encrypt,
    get_allowed_domains,
    get_appearance,
    get_azure_config,
    get_bamboo_config,
    integrations_status,
    set_integration,
    set_many,
)

router = APIRouter(prefix="/settings", tags=["settings"])

VALID_MODES = {"light", "dark", "system"}
VALID_DENSITY = {"comfortable", "compact"}
VALID_FONTS = {"system", "inter", "serif"}


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
