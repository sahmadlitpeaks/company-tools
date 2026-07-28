"""Device sessions: issuing, rotating and revoking refresh tokens.

The web SPA keeps its original behaviour — a short-lived JWT and nothing else.
A refresh token is minted only when a client identifies a device, which is what
the mobile app and the installed PWA do. That keeps a long-lived credential out
of ordinary browser sessions while letting a phone stay signed in.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_refresh_token, hash_refresh_token
from app.models.device import DEVICE_PLATFORMS, RefreshToken


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalise_platform(platform: str | None) -> str:
    p = (platform or "web").strip().lower()
    return p if p in DEVICE_PLATFORMS else "web"


async def issue_refresh_token(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    device_label: str | None = None,
    platform: str | None = None,
    replaces: RefreshToken | None = None,
) -> str:
    """Create a refresh token for one device and return the raw value.

    The caller commits. When ``replaces`` is given the old row is revoked and
    chained to the new one, so a later attempt to reuse it is detectable.
    """
    raw, token_hash = create_refresh_token()
    row = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        device_label=(device_label or None),
        platform=normalise_platform(platform),
        expires_at=_now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(row)
    if replaces is not None:
        await db.flush()  # need row.id to chain
        replaces.revoked_at = _now()
        replaces.replaced_by_id = row.id
    return raw


async def resolve_refresh_token(
    db: AsyncSession, raw: str
) -> tuple[RefreshToken | None, str | None]:
    """Look a raw refresh token up. Returns ``(row, error)``.

    A token that was already rotated out is treated as a **reuse attempt**: the
    presented copy is stale, which usually means it leaked. The whole device
    chain is revoked rather than just refusing this one call.
    """
    row = (
        await db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == hash_refresh_token(raw or "")
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None, "Invalid refresh token"
    if row.revoked_at is not None:
        if row.replaced_by_id is not None:
            await revoke_user_tokens(db, row.user_id)
            return None, "Refresh token reused — all sessions for this user were revoked"
        return None, "Refresh token revoked"
    expires_at = row.expires_at
    if expires_at.tzinfo is None:  # SQLite round-trips naive datetimes
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= _now():
        return None, "Refresh token expired"
    return row, None


async def revoke_token(db: AsyncSession, row: RefreshToken) -> None:
    row.revoked_at = _now()


async def revoke_user_tokens(
    db: AsyncSession, user_id: uuid.UUID, *, keep_id: uuid.UUID | None = None
) -> None:
    """Revoke every live refresh token for a user (optionally sparing one)."""
    stmt = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    if keep_id is not None:
        stmt = stmt.where(RefreshToken.id != keep_id)
    await db.execute(stmt)


async def list_sessions(db: AsyncSession, user_id: uuid.UUID) -> list[RefreshToken]:
    """A user's live device sessions, newest first."""
    return list(
        (
            await db.execute(
                select(RefreshToken)
                .where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
                .order_by(RefreshToken.created_at.desc())
            )
        ).scalars()
    )
