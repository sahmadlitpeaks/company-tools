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
