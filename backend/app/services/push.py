"""Mobile/web push notifications via Firebase Cloud Messaging (HTTP v1).

One transport covers all three clients: Android natively, iOS through APNs, and
the installed PWA through FCM's Web Push. That is why FCM is used rather than
maintaining separate VAPID and APNs paths.

Push is gated by its own ``PUSH_ENABLED`` switch, deliberately independent of
``NOTIFY_OUTBOUND``: wanting alerts on your phone is not the same as wanting
them emailed to you, and a team may well want one without the other.

Every send is best-effort — a transport failure never breaks the request that
triggered the notification.
"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone

import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.urls import frontend_base_url
from app.models.device import PushDevice

log = logging.getLogger("push")

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
# FCM reports a token that no longer exists with these; anything else may be
# transient (rate limits, outages) and must not deactivate a good device.
_DEAD_TOKEN_STATUSES = {404, 400}

# Cached service-account access token: (token, expires_at_epoch).
_token_cache: tuple[str, float] | None = None


def push_enabled() -> bool:
    return bool(settings.PUSH_ENABLED and settings.FCM_PROJECT_ID and settings.FCM_SERVICE_ACCOUNT_JSON)


def _service_account() -> dict:
    """Load the service account from a path or an inline JSON blob."""
    raw = settings.FCM_SERVICE_ACCOUNT_JSON.strip()
    if raw.startswith("{"):
        return json.loads(raw)
    with open(raw, "r", encoding="utf-8") as fh:
        return json.load(fh)


async def _access_token() -> str | None:
    """Exchange the service-account key for a short-lived OAuth2 access token."""
    global _token_cache
    now = time.time()
    if _token_cache and _token_cache[1] - 60 > now:
        return _token_cache[0]
    try:
        sa = _service_account()
        assertion = jwt.encode(
            {
                "iss": sa["client_email"],
                "scope": _FCM_SCOPE,
                "aud": _GOOGLE_TOKEN_URL,
                "iat": int(now),
                "exp": int(now) + 3600,
            },
            sa["private_key"],
            algorithm="RS256",
            headers={"kid": sa.get("private_key_id")},
        )
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.post(
                _GOOGLE_TOKEN_URL,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
        resp.raise_for_status()
        body = resp.json()
        token = body["access_token"]
        _token_cache = (token, now + int(body.get("expires_in", 3600)))
        return token
    except Exception as e:  # noqa: BLE001 — never break the caller
        log.warning("could not obtain an FCM access token: %s", e)
        return None


def _absolute(link: str | None) -> str | None:
    """Turn an in-app route into a full URL the OS can open."""
    if not link:
        return None
    if link.startswith("http://") or link.startswith("https://"):
        return link
    return f"{frontend_base_url()}{link}"


async def send_to_tokens(
    tokens: list[str], *, title: str, body: str | None, link: str | None
) -> list[str]:
    """Send one notification to each token. Returns the tokens FCM says are dead."""
    if not tokens or not push_enabled():
        return []
    access = await _access_token()
    if not access:
        return []

    url = f"https://fcm.googleapis.com/v1/projects/{settings.FCM_PROJECT_ID}/messages:send"
    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    target = _absolute(link)
    dead: list[str] = []

    async with httpx.AsyncClient(timeout=10) as http:
        for token in tokens:
            message: dict = {
                "message": {
                    "token": token,
                    "notification": {"title": title, "body": body or ""},
                    # The click target travels as data so each platform's
                    # handler can route in-app instead of opening a browser.
                    "data": {"link": link or "/", "url": target or ""},
                    "webpush": {"fcm_options": {"link": target}} if target else {},
                }
            }
            try:
                resp = await http.post(url, headers=headers, json=message)
                if resp.status_code in _DEAD_TOKEN_STATUSES:
                    dead.append(token)
                elif resp.status_code >= 400:
                    log.warning("push failed (%s): %s", resp.status_code, resp.text[:200])
            except Exception as e:  # noqa: BLE001
                log.warning("push transport error: %s", e)
    return dead


async def push_to_user(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> int:
    """Push to every active device a user has registered.

    Deactivates tokens the provider rejects as unknown, so a reinstalled app
    doesn't leave a dead row pushing forever. The caller commits.
    """
    if not push_enabled():
        return 0
    devices = list(
        (
            await db.execute(
                select(PushDevice).where(
                    PushDevice.user_id == user_id, PushDevice.active.is_(True)
                )
            )
        ).scalars()
    )
    if not devices:
        return 0

    dead = await send_to_tokens(
        [d.token for d in devices], title=title, body=body, link=link
    )
    now = datetime.now(timezone.utc)
    for d in devices:
        if d.token in dead:
            d.active = False
        else:
            d.last_seen_at = now
    return len(devices) - len(dead)
