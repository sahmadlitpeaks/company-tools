"""Scoped API tokens: admin management + a token-authenticated public read API
for external integrations."""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin
from app.core.database import get_db
from app.models.api_token import API_SCOPES, ApiToken
from app.models.crm import CrmLead
from app.models.user import User

router = APIRouter(prefix="/api-tokens", tags=["api-tokens"])


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class TokenCreate(BaseModel):
    name: str
    scopes: list[str] = []


class TokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[str] = []
    active: bool
    last_used_at: datetime | None = None
    created_at: datetime


def _out(t: ApiToken) -> TokenOut:
    return TokenOut(
        id=t.id, name=t.name, prefix=t.prefix, scopes=t.scopes or [],
        active=t.active, last_used_at=t.last_used_at, created_at=t.created_at,
    )


@router.get("/scopes")
async def list_scopes(_: User = Depends(get_current_admin)):
    return {"scopes": API_SCOPES}


@router.get("", response_model=list[TokenOut])
async def list_tokens(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    rows = (await db.execute(select(ApiToken).order_by(ApiToken.created_at.desc()))).scalars().all()
    return [_out(t) for t in rows]


@router.post("", response_model=dict, status_code=201)
async def create_token(
    body: TokenCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    bad = [s for s in body.scopes if s not in API_SCOPES]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown scopes: {', '.join(bad)}")
    raw = "ct_" + secrets.token_urlsafe(32)
    t = ApiToken(
        name=body.name, token_hash=_hash(raw), prefix=raw[:10],
        scopes=body.scopes, created_by_id=admin.id,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    # Raw token returned exactly once.
    return {**_out(t).model_dump(mode="json"), "token": raw}


@router.delete("/{token_id}", status_code=204)
async def revoke_token(
    token_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    t = await db.get(ApiToken, token_id)
    if t:
        await db.delete(t)
        await db.commit()


# --------------------------------------------------------------------------
# Public read API — authenticated by an API token (not a user session).
# --------------------------------------------------------------------------
public_router = APIRouter(prefix="/public-api", tags=["public-api"])


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.headers.get("x-api-key") or None


def require_scope(scope: str):
    async def _guard(request: Request, db: AsyncSession = Depends(get_db)) -> ApiToken:
        raw = _bearer(request)
        if not raw:
            raise HTTPException(status_code=401, detail="Missing API token")
        tok = (
            await db.execute(select(ApiToken).where(ApiToken.token_hash == _hash(raw)))
        ).scalar_one_or_none()
        if not tok or not tok.active:
            raise HTTPException(status_code=401, detail="Invalid API token")
        if tok.expires_at and tok.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Token expired")
        if scope not in (tok.scopes or []):
            raise HTTPException(status_code=403, detail=f"Token lacks scope: {scope}")
        tok.last_used_at = datetime.now(timezone.utc)
        await db.commit()
        return tok

    return _guard


@public_router.get("/employees")
async def api_employees(
    db: AsyncSession = Depends(get_db),
    _: ApiToken = Depends(require_scope("read:directory")),
):
    rows = (
        await db.execute(
            select(User).where(User.status == "active").order_by(User.display_name)
        )
    ).scalars().all()
    return [
        {
            "id": str(u.id), "name": u.display_name, "email": u.email,
            "job_title": u.job_title, "department": u.department,
        }
        for u in rows
    ]


@public_router.get("/leads")
async def api_leads(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: ApiToken = Depends(require_scope("read:crm")),
):
    rows = (
        await db.execute(select(CrmLead).order_by(CrmLead.created_at.desc()).limit(min(limit, 500)))
    ).scalars().all()
    return [
        {
            "id": str(le.id), "name": le.name, "email": le.email,
            "status": le.status, "created_at": le.created_at.isoformat(),
        }
        for le in rows
    ]
