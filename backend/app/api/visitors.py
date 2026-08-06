import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.operations import Visitor
from app.models.user import User
from app.services.notify import notify_user
from app.services.people import user_names
from app.services.qrcodes import generate_qr_png

router = APIRouter(prefix="/visitors", tags=["visitors"])
public_router = APIRouter(prefix="/public/visitors", tags=["visitors-public"])


class VisitorIn(BaseModel):
    visitor_name: str = Field(min_length=1, max_length=255)
    visitor_email: str | None = Field(default=None, max_length=320)
    host_id: uuid.UUID | None = None
    office_location: str = Field(min_length=1, max_length=255)
    visit_at: AwareDatetime
    purpose: str | None = None
    maps_url: str | None = None
    company_id: uuid.UUID | None = None


class StatusIn(BaseModel):
    status: str


async def out(db, v):
    names = await user_names(db, {v.host_id})
    return {
        "id": v.id,
        "visitor_name": v.visitor_name,
        "visitor_email": v.visitor_email,
        "host_id": v.host_id,
        "host_name": names.get(v.host_id),
        "office_location": v.office_location,
        "visit_at": v.visit_at,
        "purpose": v.purpose,
        "maps_url": v.maps_url,
        "token": v.token,
        "status": v.status,
        "invitation_url": f"/visit/{v.token}",
    }


@router.post("", status_code=201)
async def create(
    payload: VisitorIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    host_id = payload.host_id or user.id
    if host_id != user.id and not (user.is_admin or user.role == "manager"):
        raise HTTPException(403, "Only managers can register for another host")
    if not await db.get(User, host_id):
        raise HTTPException(404, "Host not found")
    v = Visitor(
        **payload.model_dump(exclude={"host_id"}),
        host_id=host_id,
        token=secrets.token_urlsafe(32),
        status="expected",
    )
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return await out(db, v)


@router.get("")
async def listing(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Visitor).order_by(Visitor.visit_at)
    if not (user.is_admin or user.role == "manager"):
        stmt = stmt.where(Visitor.host_id == user.id)
    return [await out(db, v) for v in (await db.execute(stmt)).scalars().all()]


@router.post("/{visitor_id}/status")
async def status(
    visitor_id: uuid.UUID,
    payload: StatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not (user.is_admin or user.role == "manager"):
        raise HTTPException(403, "Manager privileges required")
    if payload.status not in {"expected", "arrived", "checked_out", "cancelled"}:
        raise HTTPException(422, "Invalid visitor status")
    v = await db.get(Visitor, visitor_id)
    if not v:
        raise HTTPException(404, "Visitor not found")
    v.status = payload.status
    if payload.status == "arrived":
        await notify_user(
            db,
            user_id=v.host_id,
            title=f"{v.visitor_name} has arrived",
            body=f"Please meet your visitor at {v.office_location}.",
            link="/visitors",
            category="visitor",
        )
    await db.commit()
    await db.refresh(v)
    return await out(db, v)


@public_router.get("/{token}")
async def invitation(token: str, db: AsyncSession = Depends(get_db)):
    v = (
        await db.execute(select(Visitor).where(Visitor.token == token))
    ).scalar_one_or_none()
    if not v or v.status == "cancelled":
        raise HTTPException(404, "Invitation not found")
    names = await user_names(db, {v.host_id})
    return {
        "visitor_name": v.visitor_name,
        "host_name": names.get(v.host_id),
        "office_location": v.office_location,
        "visit_at": v.visit_at,
        "purpose": v.purpose,
        "maps_url": v.maps_url,
    }


@public_router.get("/{token}/qr.png")
async def qr(token: str, db: AsyncSession = Depends(get_db)):
    v = (
        await db.execute(
            select(Visitor.id).where(
                Visitor.token == token,
                Visitor.status != "cancelled",
            )
        )
    ).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Invitation not found")
    base = (settings.PUBLIC_BASE_URL or "http://localhost:8080").rstrip("/")
    return Response(
        generate_qr_png(f"{base}/visit/{token}"),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )
