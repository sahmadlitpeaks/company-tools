"""Resolve the app's public base URLs.

In the single-origin deployment the app can run on any host/IP with no config:
when ``PUBLIC_BASE_URL`` / ``FRONTEND_BASE_URL`` aren't set explicitly, we derive
them from the incoming request (honouring nginx's ``X-Forwarded-Proto`` / ``Host``
headers). An explicit env value always wins — set one for a fixed domain or to
force https behind TLS termination.
"""
from contextvars import ContextVar

from app.core.config import settings

# Set per-request by middleware; e.g. "http://203.0.113.5:8080".
_request_base: ContextVar[str | None] = ContextVar("request_base", default=None)


def set_request_base(base: str | None) -> None:
    _request_base.set(base)


def _resolve(explicit: str) -> str:
    if explicit:
        return explicit.rstrip("/")
    derived = _request_base.get()
    if derived:
        return derived.rstrip("/")
    # Last-resort fallback for non-request contexts (e.g. background jobs).
    return "http://localhost:8080"


def public_base_url() -> str:
    """Base URL for public, backend-served links (QR, short links, card pages)."""
    return _resolve(settings.PUBLIC_BASE_URL)


def frontend_base_url() -> str:
    """Base URL for the SPA — shares the origin with the API by default."""
    return _resolve(settings.FRONTEND_BASE_URL or settings.PUBLIC_BASE_URL)
