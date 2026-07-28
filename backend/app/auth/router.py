import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import build_oauth, fetch_graph_me
from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core import totp
from app.core.security import (
    create_access_token,
    hash_password,
    password_policy_error,
    verify_password,
)
from app.core.urls import frontend_base_url
from app.models.device import RefreshToken
from app.models.user import User
from app.schemas.device import SessionOut
from app.schemas.user import UserOut
from app.services.sessions import (
    issue_refresh_token,
    list_sessions,
    resolve_refresh_token,
    revoke_token,
    revoke_user_tokens,
)
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
    code: str | None = None  # TOTP code when 2FA is enabled
    # Naming a device opts this client into a refresh token (mobile app /
    # installed PWA). Omitted by the browser SPA, which keeps a JWT only.
    device: str | None = None
    platform: str | None = None


class RefreshIn(BaseModel):
    refresh_token: str


class DeviceSessionIn(BaseModel):
    device: str | None = None
    platform: str | None = None


class ChangePasswordIn(BaseModel):
    current_password: str | None = None
    new_password: str


class MfaCodeIn(BaseModel):
    code: str


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
    # Two-factor: when enabled, a valid TOTP code is required to complete login.
    if user.mfa_enabled and user.mfa_secret:
        if not payload.code:
            raise HTTPException(status_code=401, detail="2FA code required", headers={"X-MFA-Required": "1"})
        if not totp.verify(user.mfa_secret, payload.code):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    token = create_access_token(
        subject=str(user.id),
        extra={"email": user.email, "name": user.display_name},
    )
    out = {
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": user.must_change_password,
    }
    if payload.device:
        out["refresh_token"] = await issue_refresh_token(
            db,
            user_id=user.id,
            device_label=payload.device,
            platform=payload.platform,
        )
        await db.commit()
    return out


@router.post("/refresh", response_model=dict)
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Exchange a refresh token for a new access token (rotating the refresh).

    Deliberately does not re-prompt for 2FA: the code was checked when the
    device was first signed in, and revoking the device is what ends the
    session.
    """
    row, error = await resolve_refresh_token(db, body.refresh_token)
    if row is None:
        await db.commit()  # persist any revocations triggered by reuse detection
        raise HTTPException(status_code=401, detail=error or "Invalid refresh token")

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active or user.status != "active":
        await revoke_user_tokens(db, row.user_id)
        await db.commit()
        raise HTTPException(status_code=403, detail="Account is not active")

    new_refresh = await issue_refresh_token(
        db,
        user_id=user.id,
        device_label=row.device_label,
        platform=row.platform,
        replaces=row,
    )
    row.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return {
        "access_token": create_access_token(
            subject=str(user.id),
            extra={"email": user.email, "name": user.display_name},
        ),
        "token_type": "bearer",
        "refresh_token": new_refresh,
        "must_change_password": user.must_change_password,
    }


@router.post("/device-session", response_model=dict)
async def device_session(
    body: DeviceSessionIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Attach a refresh token to an already-authenticated session.

    Password login can hand one over directly, but the Azure SSO flow ends in a
    browser redirect that only carries the access token. An installed app calls
    this straight afterwards so SSO users get the same stay-signed-in behaviour.
    """
    token = await issue_refresh_token(
        db, user_id=user.id, device_label=body.device, platform=body.platform
    )
    await db.commit()
    return {"refresh_token": token}


@router.post("/logout", response_model=dict)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Revoke one device's refresh token. Unauthenticated on purpose — holding
    the token is the proof, and a client signing out may already have a dead
    access token."""
    row, _ = await resolve_refresh_token(db, body.refresh_token)
    if row is not None:
        await revoke_token(db, row)
    await db.commit()
    return {"ok": True}


@router.get("/sessions", response_model=list[SessionOut])
async def my_sessions(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """The signed-in user's live device sessions."""
    return await list_sessions(db, user.id)


@router.delete("/sessions/{session_id}", response_model=dict)
async def revoke_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = await db.get(RefreshToken, session_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    await revoke_token(db, row)
    await db.commit()
    return {"ok": True}


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
    err = password_policy_error(payload.new_password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    record(
        db, user=user, action="updated", entity_type="auth", entity_id=user.id,
        summary="Changed their password",
    )
    await db.commit()
    return {"ok": True}


@router.get("/mfa/status")
async def mfa_status(user: User = Depends(get_current_user)):
    return {"enabled": user.mfa_enabled}


@router.post("/mfa/setup")
async def mfa_setup(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Generate a pending TOTP secret + provisioning URI to show as a QR code.
    Not active until confirmed via /mfa/enable."""
    secret = totp.generate_secret()
    user.mfa_secret = secret
    user.mfa_enabled = False
    await db.commit()
    return {
        "secret": secret,
        "otpauth_uri": totp.provisioning_uri(secret, account=user.email or str(user.id)),
    }


@router.post("/mfa/enable")
async def mfa_enable(
    payload: MfaCodeIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.mfa_secret:
        raise HTTPException(status_code=400, detail="Start setup first")
    if not totp.verify(user.mfa_secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    user.mfa_enabled = True
    record(db, user=user, action="updated", entity_type="auth", entity_id=user.id,
           summary="Enabled two-factor authentication")
    await db.commit()
    return {"enabled": True}


@router.post("/mfa/disable")
async def mfa_disable(
    payload: MfaCodeIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.mfa_enabled and not totp.verify(user.mfa_secret or "", payload.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    user.mfa_enabled = False
    user.mfa_secret = None
    record(db, user=user, action="updated", entity_type="auth", entity_id=user.id,
           summary="Disabled two-factor authentication")
    await db.commit()
    return {"enabled": False}


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
            f"{frontend_base_url()}/login?error=domain_not_allowed"
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
            f"{frontend_base_url()}/login?error=pending_approval"
        )

    app_token = create_access_token(
        subject=str(user.id),
        extra={"email": user.email, "name": user.display_name},
    )
    # Hand the token back to the SPA.
    redirect = f"{frontend_base_url()}/auth/callback#token={app_token}"
    return RedirectResponse(redirect)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
