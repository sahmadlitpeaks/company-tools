from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import get_app_token
from app.auth.deps import get_current_admin
from app.core.database import get_db
from app.models.user import User
from app.services.app_settings import (
    encrypt,
    get_allowed_domains,
    get_azure_config,
    set_many,
)

router = APIRouter(prefix="/settings", tags=["settings"])


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
