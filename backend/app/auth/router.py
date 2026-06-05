from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import build_oauth, fetch_graph_me
from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.user import User
from app.schemas.user import UserOut
from app.services.activity import record
from app.services.app_settings import (
    email_domain_allowed,
    get_allowed_domains,
    get_azure_config,
)
from app.services.users import upsert_user_from_graph


async def _is_first_user(db: AsyncSession) -> bool:
    return (await db.scalar(select(func.count(User.id)))) == 0

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config")
async def auth_config(db: AsyncSession = Depends(get_db)) -> dict:
    """Public: tells the SPA which sign-in options are available at runtime."""
    azure = await get_azure_config(db)
    return {
        "azure": azure["configured"],
        "dev_login": settings.ENVIRONMENT == "development",
    }


@router.get("/login")
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    """Kick off the Azure Entra ID OIDC authorization-code flow."""
    cfg = await get_azure_config(db)
    if not cfg["configured"]:
        raise HTTPException(status_code=503, detail="Azure sign-in is not configured")
    oauth = build_oauth(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
    return await oauth.azure.authorize_redirect(request, cfg["redirect_uri"])


@router.get("/callback")
async def callback(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle the Azure redirect: sync the user and mint an app session JWT."""
    cfg = await get_azure_config(db)
    if not cfg["configured"]:
        raise HTTPException(status_code=503, detail="Azure sign-in is not configured")
    oauth = build_oauth(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
    token = await oauth.azure.authorize_access_token(request)

    # Prefer Graph /me for the richest profile; fall back to the id_token claims.
    profile: dict = {}
    access_token = token.get("access_token")
    if access_token:
        try:
            profile = await fetch_graph_me(access_token)
        except Exception:
            profile = {}
    if not profile:
        claims = token.get("userinfo") or {}
        profile = {
            "id": claims.get("oid") or claims.get("sub"),
            "displayName": claims.get("name"),
            "mail": claims.get("email") or claims.get("preferred_username"),
            "userPrincipalName": claims.get("preferred_username"),
        }

    # Enforce the email-domain allowlist before provisioning anything.
    email = profile.get("mail") or profile.get("userPrincipalName")
    allowed = await get_allowed_domains(db)
    if not email_domain_allowed(email, allowed):
        return RedirectResponse(
            f"{settings.FRONTEND_BASE_URL}/login?error=domain_not_allowed"
        )

    first = await _is_first_user(db)
    user = await upsert_user_from_graph(db, profile)
    if first:
        # Bootstrap: the very first person to sign in owns the system.
        user.is_admin = True
        user.role = "admin"
        user.status = "active"
    await db.commit()

    if user.status == "pending":
        return RedirectResponse(
            f"{settings.FRONTEND_BASE_URL}/login?error=pending_approval"
        )

    app_token = create_access_token(
        subject=str(user.id),
        extra={"email": user.email, "name": user.display_name},
    )
    # Hand the token back to the SPA.
    redirect = f"{settings.FRONTEND_BASE_URL}/auth/callback#token={app_token}"
    return RedirectResponse(redirect)


@router.post("/dev-login", response_model=dict)
async def dev_login(email: str, db: AsyncSession = Depends(get_db)):
    """Local-only shortcut to obtain a session without Azure configured.

    Disabled outside the development environment.
    """
    if settings.ENVIRONMENT != "development":
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Not found")
    first = await _is_first_user(db)
    user = await upsert_user_from_graph(
        db, {"id": None, "mail": email, "displayName": email.split("@")[0]}
    )
    # The first dev user bootstraps as admin; later ones are normal members
    # (pending approval) — mirroring the real Azure flow.
    if first:
        user.is_admin = True
        user.role = "admin"
        user.status = "active"
    record(
        db,
        user=user,
        action="updated",
        entity_type="auth",
        summary=f"Dev-login used as {email} (development only)",
    )
    await db.commit()
    token = create_access_token(subject=str(user.id), extra={"email": user.email})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
