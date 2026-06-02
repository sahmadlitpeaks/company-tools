from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import fetch_graph_me, oauth
from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.user import User
from app.schemas.user import UserOut
from app.services.users import upsert_user_from_graph

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config")
async def auth_config() -> dict:
    """Public: tells the SPA which sign-in options are available at runtime.

    The production frontend is a static build, so it can't rely on Vite's DEV
    flag — it asks the backend instead.
    """
    return {
        "azure": bool(settings.AZURE_CLIENT_ID and settings.AZURE_TENANT_ID),
        "dev_login": settings.ENVIRONMENT == "development",
    }


@router.get("/login")
async def login(request: Request):
    """Kick off the Azure Entra ID OIDC authorization-code flow."""
    return await oauth.azure.authorize_redirect(request, settings.AZURE_REDIRECT_URI)


@router.get("/callback")
async def callback(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle the Azure redirect: sync the user and mint an app session JWT."""
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

    user = await upsert_user_from_graph(db, profile)
    await db.commit()

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
    user = await upsert_user_from_graph(
        db, {"id": None, "mail": email, "displayName": email.split("@")[0]}
    )
    # First dev user becomes admin for convenience.
    user.is_admin = True
    await db.commit()
    token = create_access_token(subject=str(user.id), extra={"email": user.email})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
