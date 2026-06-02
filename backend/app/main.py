import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.api import (
    assets,
    analytics,
    branding,
    cards,
    landing,
    notifications,
    products,
    qrcodes,
    shortener,
    signatures,
    tracker,
    transfers,
    users,
)
from app.api.qrcodes import scan_redirect
from app.api.shortener import redirect_short_link
from app.auth.router import router as auth_router
from app.core.config import settings
from app.core.database import get_db
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


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok", "app": settings.APP_NAME}


# ---- API routers (all behind Azure SSO except the explicit /public ones) ----
api_prefix = "/api"
app.include_router(auth_router, prefix=api_prefix)
app.include_router(users.router, prefix=api_prefix)
app.include_router(cards.router, prefix=api_prefix)
app.include_router(cards.public_router, prefix=api_prefix)
app.include_router(assets.router, prefix=api_prefix)
app.include_router(branding.router, prefix=api_prefix)
app.include_router(products.router, prefix=api_prefix)
app.include_router(products.public_router, prefix=api_prefix)
app.include_router(qrcodes.router, prefix=api_prefix)
app.include_router(landing.router, prefix=api_prefix)
app.include_router(landing.public_router, prefix=api_prefix)
app.include_router(signatures.router, prefix=api_prefix)
app.include_router(shortener.router, prefix=api_prefix)
app.include_router(transfers.router, prefix=api_prefix)
app.include_router(transfers.public_router, prefix=api_prefix)
app.include_router(tracker.router, prefix=api_prefix)
app.include_router(analytics.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)


# ---- Public short-link redirect (feature #8): https://host/s/{code} ----
@app.get("/s/{code}", tags=["url-shortener"])
async def short_link_redirect(
    code: str, request: Request, db: AsyncSession = Depends(get_db)
):
    return await redirect_short_link(code, request, db)


# ---- Dynamic QR scan redirect: https://host/q/{qr_id} ----
@app.get("/q/{qr_id}", tags=["qr-codes"])
async def qr_scan_redirect(
    qr_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)
):
    return await scan_redirect(qr_id, request, db)
