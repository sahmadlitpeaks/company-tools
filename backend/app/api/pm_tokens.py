"""Personal access tokens for AI assistants using the tracker's MCP server.

Everyone with the Projects module manages their own tokens. Tokens are
read-only unless the owner holds the ``projects_ai_write`` permission and asks
for write access. Platform administrators can review and revoke any token.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.core.permissions import active_permissions
from app.models.pm import PmAccessToken
from app.models.user import User
from app.services import crypto
from app.services.activity import record
from app.services.people import user_names

router = APIRouter(prefix="/pm/ai", tags=["project-tracker-ai"])

TOKEN_PREFIX = "pmt_"
MCP_PATH = "/api/mcp/"
WRITE_PERMISSION = "projects_ai_write"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def token_state(token: PmAccessToken) -> str:
    if token.revoked_at:
        return "revoked"
    if token.expires_at and _aware(token.expires_at) <= _now():
        return "expired"
    return "active"


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    can_write: bool = False
    expires_in_days: int = Field(default=90, ge=1, le=365)


def _out(token: PmAccessToken, owner: str | None = None) -> dict:
    return {
        "id": str(token.id), "name": token.name, "can_write": token.can_write, "state": token_state(token),
        "expires_at": token.expires_at, "revoked_at": token.revoked_at, "last_used_at": token.last_used_at,
        "created_at": token.created_at, "owner_name": owner,
    }


async def may_write(db: AsyncSession, user: User) -> bool:
    return WRITE_PERMISSION in await active_permissions(user, db)


@router.get("/status")
async def ai_status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"mcp_path": MCP_PATH, "can_write_allowed": await may_write(db, user)}


@router.get("/tokens")
async def my_tokens(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        await db.scalars(
            select(PmAccessToken).where(PmAccessToken.user_id == user.id).order_by(PmAccessToken.created_at.desc())
        )
    ).all()
    return [_out(row) for row in rows]


@router.post("/tokens", status_code=201)
async def create_token(
    payload: TokenCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if payload.can_write and not await may_write(db, user):
        raise HTTPException(403, "Ask an administrator for Projects AI write access to create a write token.")
    secret = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token = PmAccessToken(
        user_id=user.id, name=payload.name.strip(), token_hash=crypto.token_hash(secret),
        can_write=payload.can_write, expires_at=_now() + timedelta(days=payload.expires_in_days),
    )
    db.add(token)
    record(
        db, user=user, action="created", entity_type="pm_access_token", entity_id=token.id,
        summary=f"{user.display_name or user.email} created a {'read and write' if payload.can_write else 'read-only'} AI access token '{token.name}'",
    )
    await db.commit()
    await db.refresh(token)
    out = _out(token)
    # Shown once; only the hash is stored.
    out["token"] = secret
    return out


@router.delete("/tokens/{token_id}", status_code=204)
async def revoke_token(
    token_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    token = await db.get(PmAccessToken, token_id)
    if not token or (token.user_id != user.id and not user.is_admin):
        raise HTTPException(404, "Token not found")
    if not token.revoked_at:
        token.revoked_at = _now()
        record(
            db, user=user, action="revoked", entity_type="pm_access_token", entity_id=token.id,
            summary=f"{user.display_name or user.email} revoked AI access token '{token.name}'",
        )
        await db.commit()


@router.get("/tokens/all")
async def all_tokens(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    """Every token in the organisation, for administrators' oversight."""
    rows = (await db.scalars(select(PmAccessToken).order_by(PmAccessToken.created_at.desc()))).all()
    names = await user_names(db, {row.user_id for row in rows})
    return [_out(row, names.get(row.user_id)) for row in rows]
