"""Outbound webhook delivery.

``emit`` fans a platform event out to every active webhook subscribed to it,
signing the JSON body with the webhook's secret (HMAC-SHA256) and recording
each attempt in ``webhook_deliveries``. Delivery is best-effort and never
raises into the caller's request flow.
"""
import hashlib
import hmac
import json
import urllib.error
import urllib.request

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook import Webhook, WebhookDelivery


def _post(url: str, body: bytes, signature: str | None) -> tuple[int | None, str | None]:
    headers = {"Content-Type": "application/json", "User-Agent": "company-tools-webhook"}
    if signature:
        headers["X-Webhook-Signature"] = f"sha256={signature}"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310 (admin-configured URL)
            return resp.status, None
    except urllib.error.HTTPError as e:
        return e.code, f"HTTP {e.code}"
    except Exception as e:  # connection refused, timeout, DNS, …
        return None, str(e)[:500]


async def emit(db: AsyncSession, event: str, payload: dict) -> int:
    """Deliver ``event`` to all subscribed active webhooks. Returns the count
    of webhooks attempted. Adds delivery rows to the session (caller commits)."""
    hooks = (
        await db.execute(select(Webhook).where(Webhook.active.is_(True)))
    ).scalars().all()
    body_dict = {"event": event, "data": payload}
    body = json.dumps(body_dict, default=str).encode()
    attempted = 0
    for h in hooks:
        subscribed = not h.events or event in h.events
        if not subscribed:
            continue
        attempted += 1
        signature = (
            hmac.new(h.secret.encode(), body, hashlib.sha256).hexdigest() if h.secret else None
        )
        status, error = await anyio.to_thread.run_sync(_post, h.url, body, signature)
        db.add(WebhookDelivery(
            webhook_id=h.id, event=event, payload=body_dict,
            status_code=status, success=bool(status and 200 <= status < 300), error=error,
        ))
    return attempted


def sign(secret: str, body: bytes) -> str:
    """Helper mirroring the signature scheme (used in tests/integrations)."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
