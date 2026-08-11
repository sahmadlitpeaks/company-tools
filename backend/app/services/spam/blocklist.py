"""Admin-managed allow/deny entries, checked before anything is stored.

This is the only place in the pipeline that refuses a submission outright, so
`allow` always beats `block` — an operator who has explicitly vouched for an
address or range can never be overruled by a broader deny entry.
"""
import ipaddress
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake import IntakeBlocklist


def _matches(entry: IntakeBlocklist, *, ip, email, country, digest, text) -> bool:
    value = (entry.value or "").strip().lower()
    if not value:
        return False
    kind = entry.kind

    if kind == "ip":
        return bool(ip) and ip.lower() == value
    if kind == "cidr":
        if not ip:
            return False
        try:
            return ipaddress.ip_address(ip) in ipaddress.ip_network(value, strict=False)
        except ValueError:
            return False
    if kind == "email":
        return bool(email) and email.lower() == value
    if kind == "domain":
        return bool(email) and "@" in email and email.rsplit("@", 1)[1].lower() == value
    if kind == "country":
        return bool(country) and country.lower() == value
    if kind == "fingerprint":
        return bool(digest) and digest.lower() == value
    if kind == "keyword":
        return value in (text or "").lower()
    return False


async def check(
    db: AsyncSession,
    *,
    source_id=None,
    ip: str | None = None,
    email: str | None = None,
    country: str | None = None,
    digest: str | None = None,
    text: str | None = None,
) -> tuple[str | None, str | None]:
    """Return ``(action, reason)`` — action is block, quarantine, allow or None."""
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(IntakeBlocklist).where(
                or_(
                    IntakeBlocklist.source_id.is_(None),
                    IntakeBlocklist.source_id == source_id,
                )
            )
        )
    ).scalars().all()

    hit: IntakeBlocklist | None = None
    for entry in rows:
        if entry.expires_at and entry.expires_at < now:
            continue
        if not _matches(entry, ip=ip, email=email, country=country, digest=digest, text=text):
            continue
        if entry.action == "allow":
            entry.hit_count = (entry.hit_count or 0) + 1
            return "allow", entry.reason or "Allowlisted"
        # Keep looking — an allow entry further down still wins.
        if hit is None or entry.action == "block":
            hit = entry

    if hit is None:
        return None, None
    hit.hit_count = (hit.hit_count or 0) + 1
    label = {"ip": "IP", "cidr": "IP range", "email": "Email address",
             "domain": "Email domain", "country": "Country",
             "fingerprint": "Message fingerprint", "keyword": "Keyword"}.get(hit.kind, hit.kind)
    return hit.action, hit.reason or f"{label} is blocked"
