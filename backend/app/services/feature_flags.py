"""Org-wide module and feature switches — "is this switched on at all?".

Deliberately distinct from ``app.core.permissions``, which answers a different
question: "may *this person* use it?". A key listed here is off for everybody,
administrators included; only Settings -> Modules can turn it back on. Nothing
is deleted, so re-enabling restores the feature exactly as it was.

The set lives as a single JSON list in the ``app_settings`` key/value table, so
turning features on and off needs no schema migration. Reads are cached for a
few seconds because the module gate runs on nearly every authenticated request;
writes invalidate the cache immediately, so an admin's own change is visible at
once and any additional replica picks it up within the TTL.
"""
import json
import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

SETTING_KEY = "disabled_features"
CACHE_TTL_SECONDS = 30.0

_cache: frozenset[str] | None = None
_cached_at = 0.0


def invalidate() -> None:
    """Drop the cached set — called after every write, and between tests."""
    global _cache
    _cache = None


def _parse(raw: str | None) -> frozenset[str]:
    """Tolerate a hand-edited or corrupted row by failing open (all enabled).

    Failing closed would hide the whole platform, including the settings page
    needed to repair it.
    """
    if not raw:
        return frozenset()
    try:
        value = json.loads(raw)
    except ValueError:
        return frozenset()
    if not isinstance(value, list):
        return frozenset()
    return frozenset(str(item) for item in value)


async def get_disabled(db: AsyncSession) -> frozenset[str]:
    """Every module and feature key currently switched off, org-wide."""
    global _cache, _cached_at
    now = time.monotonic()
    if _cache is not None and now - _cached_at < CACHE_TTL_SECONDS:
        return _cache
    row = await db.get(AppSetting, SETTING_KEY)
    _cache = _parse(row.value if row else None)
    _cached_at = now
    return _cache


async def set_disabled(db: AsyncSession, keys: list[str]) -> frozenset[str]:
    """Replace the disabled set. Callers validate keys against the catalogue."""
    ordered = sorted(set(keys))
    row = await db.get(AppSetting, SETTING_KEY)
    if row is None:
        db.add(AppSetting(key=SETTING_KEY, value=json.dumps(ordered)))
    else:
        row.value = json.dumps(ordered)
    await db.commit()
    invalidate()
    return frozenset(ordered)
