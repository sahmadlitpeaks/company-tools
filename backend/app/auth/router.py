from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import build_oauth, fetch_graph_me
from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserOut
from app.services.activity import record
from app.services.app_settings import (
    email_domain_allowed,
    get_allowed_domains,
    get_azure_config,
)
from app.services.users import upsert_user_from_graph


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str | None = None
    new_password: str


async def _is_first_user(db: AsyncSession) -> bool:
    return (await db.scalar(select(func.count(User.id)))) == 0

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config")
async def auth_config(db: AsyncSession = Depends(get_db)) -> dict:
    """Public: tells the SPA which sign-in options are available at runtime."""
    azure = await get_azure_config(db)
    return {
        "azure": azure["configured"],
        "password": True,
    }


@router.get("/login")
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    """Kick off the Azure Entra ID OIDC authorization-code flow."""
    cfg = await get_azure_config(db)
    if not cfg["configured"]:
        raise HTTPException(status_code=503, detail="Azure sign-in is not configured")
    oauth = build_oauth(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
    return await oauth.azure.authorize_redirect(request, cfg["redirect_uri"])


@router.post("/login", response_model=dict)
async def password_login(payload: LoginIn, db: AsyncSession = Depends(get_db)):
    """Sign in with an email + password (for users not using Azure SSO)."""
    email = (payload.email or "").strip().lower()
    user = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        raise HTTPException(
            status_code=403,
            detail="Your account isn't active yet. Please contact an administrator.",
        )
    token = create_access_token(
        subject=str(user.id),
        extra={"email": user.email, "name": user.display_name},
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": user.must_change_password,
    }


@router.post("/change-password", response_model=dict)
async def change_password(
    payload: ChangePasswordIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change the signed-in user's password (also clears the force-change flag)."""
    # If the user already has a password, the current one must be supplied/correct.
    if user.password_hash and not verify_password(
        payload.current_password or "", user.password_hash
    ):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password or "") < 8:
        raise HTTPException(
            status_code=422, detail="New password must be at least 8 characters"
        )
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    record(
        db, user=user, action="updated", entity_type="auth", entity_id=user.id,
        summary="Changed their password",
    )
    await db.commit()
    return {"ok": True}


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


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
