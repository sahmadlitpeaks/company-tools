import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.api import (
    approvals,
    assets,
    analytics,
    brands,
    branding,
    campaigns,
    cards,
    crm,
    knowledge,
    landing,
    me as me_api,
    notifications,
    products,
    qrcodes,
    service_desk,
    settings as settings_api,
    shares,
    shortener,
    signatures,
    tasks,
    tracker,
    transfers,
    users,
)
from app.api.qrcodes import scan_redirect
from app.api.shortener import redirect_short_link
from app.auth.router import router as auth_router
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_module
from app.services.storage import ensure_media_root

app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="Internal company platform with Azure SSO.",
)

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Serve uploaded media (dev only — front a CDN/object store in prod).
ensure_media_root()
app.mount(
    settings.MEDIA_URL, StaticFiles(directory=settings.MEDIA_ROOT), name="media"
)


if settings.RUN_SCHEDULER:
    from app.services.scheduler import start_scheduler

    start_scheduler(app)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok", "app": settings.APP_NAME}


# ---- API routers (all behind Azure SSO except the explicit /public ones) ----
api_prefix = "/api"


def _mod(key: str):
    """Router-level dependency that gates a feature module by permission."""
    return [Depends(require_module(key))]


# Open to any active, authenticated user (foundational/shared surfaces).
app.include_router(auth_router, prefix=api_prefix)
app.include_router(users.router, prefix=api_prefix)
app.include_router(analytics.router, prefix=api_prefix)
app.include_router(brands.router, prefix=api_prefix)
app.include_router(settings_api.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)
app.include_router(me_api.router, prefix=api_prefix)

# Public (no auth) surfaces.
app.include_router(cards.public_router, prefix=api_prefix)
app.include_router(assets.public_router, prefix=api_prefix)
app.include_router(products.public_router, prefix=api_prefix)
app.include_router(landing.public_router, prefix=api_prefix)
app.include_router(transfers.public_router, prefix=api_prefix)
app.include_router(shares.public_router, prefix=api_prefix)

# Module-gated feature routers (403 unless the user has the permission).
app.include_router(cards.router, prefix=api_prefix, dependencies=_mod("cards"))
app.include_router(assets.router, prefix=api_prefix, dependencies=_mod("marketing_assets"))
app.include_router(branding.router, prefix=api_prefix, dependencies=_mod("branding"))
app.include_router(products.router, prefix=api_prefix, dependencies=_mod("products"))
app.include_router(qrcodes.router, prefix=api_prefix, dependencies=_mod("qrcodes"))
app.include_router(landing.router, prefix=api_prefix, dependencies=_mod("landing_pages"))
app.include_router(signatures.router, prefix=api_prefix, dependencies=_mod("signatures"))
app.include_router(shortener.router, prefix=api_prefix, dependencies=_mod("shortener"))
app.include_router(transfers.router, prefix=api_prefix, dependencies=_mod("transfers"))
app.include_router(tracker.router, prefix=api_prefix, dependencies=_mod("asset_tracker"))
app.include_router(crm.router, prefix=api_prefix, dependencies=_mod("crm"))
app.include_router(campaigns.router, prefix=api_prefix, dependencies=_mod("campaigns"))
app.include_router(shares.router, prefix=api_prefix, dependencies=_mod("shared"))
app.include_router(tasks.router, prefix=api_prefix, dependencies=_mod("tasks"))
app.include_router(approvals.router, prefix=api_prefix, dependencies=_mod("approvals"))
app.include_router(service_desk.router, prefix=api_prefix, dependencies=_mod("service_desk"))
app.include_router(knowledge.router, prefix=api_prefix, dependencies=_mod("knowledge"))


# ---- Public short-link redirect (feature #8): https://host/s/{code} ----
# GET + HEAD so link previews, uptime checks and crawlers work.
@app.api_route("/s/{code}", methods=["GET", "HEAD"], tags=["url-shortener"])
async def short_link_redirect(
    code: str, request: Request, db: AsyncSession = Depends(get_db)
):
    return await redirect_short_link(code, request, db)


# ---- Dynamic QR scan redirect: https://host/q/{qr_id} ----
@app.api_route("/q/{qr_id}", methods=["GET", "HEAD"], tags=["qr-codes"])
async def qr_scan_redirect(
    qr_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)
):
    return await scan_redirect(qr_id, request, db)
