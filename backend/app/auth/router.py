from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import build_oauth, fetch_graph_me
from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.config import settings
from app.core import totp
from app.core.security import (
    create_access_token,
    hash_password,
    password_policy_error,
    verify_password,
)
from app.core.urls import frontend_base_url
from app.models.user import User
from app.schemas.user import UserOut
from app.services.activity import record
from app.services.app_settings import (
    email_domain_allowed,
    get_allowed_domains,
    get_azure_config,
)
from app.services.users import upsert_user_from_graph
from app.services.qrcodes import generate_qr_png


class LoginIn(BaseModel):
    email: str
    password: str
    code: str | None = None  # TOTP code when 2FA is enabled


class ChangePasswordIn(BaseModel):
    current_password: str | None = None
    new_password: str


class MfaCodeIn(BaseModel):
    code: str


class MfaDisableIn(BaseModel):
    """Disable/remove 2FA. When enabled, prove identity with a TOTP code *or*
    the account password (so testers / recovery can clear state without the app).
    Pending setup (secret stored but not yet enabled) can be cleared with no proof."""
    code: str | None = None
    password: str | None = None


async def _is_first_user(db: AsyncSession) -> bool:
    return (await db.scalar(select(func.count(User.id)))) == 0

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "ag_platform_session",
        token,
        max_age=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.ENVIRONMENT.lower() == "production",
        samesite="lax",
        path="/",
    )


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
async def password_login(
    payload: LoginIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
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
    _set_auth_cookie(response, token)
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
    return {
        "enabled": bool(user.mfa_enabled),
        "pending": bool(user.mfa_secret and not user.mfa_enabled),
    }


@router.post("/mfa/setup")
async def mfa_setup(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Generate a pending TOTP secret + provisioning URI to show as a QR code.
    Not active until confirmed via /mfa/enable."""
    if user.mfa_enabled:
        raise HTTPException(
            status_code=400,
            detail="2FA is already enabled — disable it first to set up again",
        )
    secret = totp.generate_secret()
    user.mfa_secret = secret
    user.mfa_enabled = False
    await db.commit()
    return {
        "secret": secret,
        "otpauth_uri": totp.provisioning_uri(secret, account=user.email or str(user.id)),
    }


@router.get("/mfa/qr.png")
async def mfa_qr(user: User = Depends(get_current_user)):
    """Render the caller's pending provisioning secret without exposing it in a URL."""
    if not user.mfa_secret or user.mfa_enabled:
        raise HTTPException(status_code=404, detail="No pending 2FA setup")
    uri = totp.provisioning_uri(user.mfa_secret, account=user.email or str(user.id))
    return Response(
        content=generate_qr_png(uri, fill_color="#0b5cab", back_color="#ffffff"),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


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
    payload: MfaDisableIn = MfaDisableIn(),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fully remove 2FA state (secret + enabled flag) so setup can be retried.

    - Pending setup: no proof required.
    - Enabled: require a valid authenticator code *or* the account password.
    """
    if user.mfa_enabled:
        code_ok = bool(payload.code) and totp.verify(user.mfa_secret or "", payload.code)
        password_ok = bool(payload.password) and verify_password(
            payload.password or "", user.password_hash
        )
        if not code_ok and not password_ok:
            raise HTTPException(
                status_code=400,
                detail="Enter a valid authenticator code or your account password",
            )
    user.mfa_enabled = False
    user.mfa_secret = None
    record(db, user=user, action="updated", entity_type="auth", entity_id=user.id,
           summary="Disabled two-factor authentication")
    await db.commit()
    return {"enabled": False, "pending": False}


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
    response = RedirectResponse(f"{frontend_base_url()}/auth/callback")
    _set_auth_cookie(response, app_token)
    return response


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(
        "ag_platform_session",
        path="/",
        secure=settings.ENVIRONMENT.lower() == "production",
        samesite="lax",
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
