import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.operations import BookingSpace, SpaceBooking
from app.models.user import User
from app.services.people import user_names

router = APIRouter(prefix="/bookings", tags=["bookings"])


class SpaceIn(BaseModel):
    name: str = Field(min_length=1)
    location: str = Field(min_length=1)
    capacity: int = Field(default=1, ge=1)
    equipment: list[str] = []
    type: str = "room"
    active: bool = True
    company_id: uuid.UUID | None = None


class BookingIn(BaseModel):
    space_id: uuid.UUID
    purpose: str = Field(min_length=1, max_length=500)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    timezone: str = "Asia/Dubai"


def manage(user: User):
    if not (user.is_admin or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Manager privileges required")


def space_out(space: BookingSpace):
    return {key: getattr(space, key) for key in ("id", "name", "location", "capacity", "equipment", "type", "active", "company_id")}


async def booking_out(db: AsyncSession, booking: SpaceBooking):
    space = await db.get(BookingSpace, booking.space_id)
    names = await user_names(db, {booking.user_id})
    return {
        "id": booking.id, "space_id": booking.space_id, "space_name": space.name if space else "Space",
        "user_id": booking.user_id, "user_name": names.get(booking.user_id),
        "purpose": booking.purpose, "starts_at": booking.starts_at, "ends_at": booking.ends_at,
        "timezone": booking.timezone, "status": booking.status,
    }


@router.get("/spaces")
async def spaces(
    type: str | None = None, active: bool | None = True,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
):
    stmt = select(BookingSpace).order_by(BookingSpace.location, BookingSpace.name)
    if type:
        stmt = stmt.where(BookingSpace.type == type)
    if active is not None:
        stmt = stmt.where(BookingSpace.active == active)
    return [space_out(space) for space in (await db.execute(stmt)).scalars().all()]


@router.post("/spaces", status_code=201)
async def create_space(payload: SpaceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    manage(user)
    if payload.type not in {"room", "desk"}:
        raise HTTPException(status_code=422, detail="Type must be room or desk")
    space = BookingSpace(**payload.model_dump())
    db.add(space); await db.commit(); await db.refresh(space)
    return space_out(space)


@router.post("", status_code=201)
async def create_booking(payload: BookingIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="End time must be after start time")
    space = (
        await db.execute(
            select(BookingSpace).where(BookingSpace.id == payload.space_id).with_for_update()
        )
    ).scalar_one_or_none()
    if not space or not space.active:
        raise HTTPException(status_code=404, detail="Space not available")
    conflict = (
        await db.execute(
            select(SpaceBooking.id).where(
                SpaceBooking.space_id == space.id,
                SpaceBooking.status == "confirmed",
                SpaceBooking.starts_at < payload.ends_at,
                SpaceBooking.ends_at > payload.starts_at,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if conflict:
        raise HTTPException(status_code=409, detail="This space is already booked for that time")
    booking = SpaceBooking(
        **payload.model_dump(), user_id=user.id, company_id=space.company_id, status="confirmed"
    )
    db.add(booking); await db.commit(); await db.refresh(booking)
    return await booking_out(db, booking)


@router.get("")
async def list_bookings(
    mine: bool = Query(True), start: datetime | None = None, end: datetime | None = None,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    stmt = select(SpaceBooking).order_by(SpaceBooking.starts_at)
    if mine or not (user.is_admin or user.role == "manager"):
        stmt = stmt.where(SpaceBooking.user_id == user.id)
    if start: stmt = stmt.where(SpaceBooking.ends_at > start)
    if end: stmt = stmt.where(SpaceBooking.starts_at < end)
    rows = (await db.execute(stmt)).scalars().all()
    return [await booking_out(db, row) for row in rows]


@router.post("/{booking_id}/cancel")
async def cancel(booking_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    booking = await db.get(SpaceBooking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.user_id != user.id and not (user.is_admin or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if booking.status != "confirmed":
        raise HTTPException(status_code=409, detail="Booking is already cancelled")
    booking.status = "cancelled"; await db.commit(); await db.refresh(booking)
    return await booking_out(db, booking)
