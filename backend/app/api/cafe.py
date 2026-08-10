import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.operations import CafeMenuItem, CafeOrder
from app.models.user import User
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/cafe", tags=["cafe"])
STATUSES = ("placed", "preparing", "ready", "collected", "cancelled")


class MenuIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0)
    available: bool = True
    company_id: uuid.UUID | None = None


class OrderIn(BaseModel):
    menu_item_id: uuid.UUID
    quantity: int = Field(default=1, ge=1, le=20)
    notes: str | None = Field(default=None, max_length=1000)


class StatusIn(BaseModel):
    status: str


def manager(user: User):
    if not (user.is_admin or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Manager privileges required")


def menu_dict(item: CafeMenuItem):
    return {
        "id": item.id, "name": item.name, "description": item.description,
        "price": item.price, "available": item.available, "company_id": item.company_id,
    }


async def order_dict(db: AsyncSession, order: CafeOrder):
    item = await db.get(CafeMenuItem, order.menu_item_id)
    names = await user_names(db, {order.employee_id})
    return {
        "id": order.id, "employee_id": order.employee_id,
        "employee_name": names.get(order.employee_id), "menu_item_id": order.menu_item_id,
        "item_name": item.name if item else "Unavailable item", "quantity": order.quantity,
        "notes": order.notes, "status": order.status, "status_history": order.status_history or [],
        "created_at": order.created_at,
    }


@router.get("/menu")
async def list_menu(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    items = (await db.execute(select(CafeMenuItem).order_by(CafeMenuItem.name))).scalars().all()
    return [menu_dict(item) for item in items]


@router.post("/menu", status_code=201)
async def create_menu(payload: MenuIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    manager(user)
    item = CafeMenuItem(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return menu_dict(item)


@router.patch("/menu/{item_id}")
async def update_menu(item_id: uuid.UUID, payload: MenuIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    manager(user)
    item = await db.get(CafeMenuItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return menu_dict(item)


@router.get("/orders")
async def list_orders(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = select(CafeOrder).order_by(CafeOrder.created_at.desc())
    if not (user.is_admin or user.role == "manager"):
        stmt = stmt.where(CafeOrder.employee_id == user.id)
    orders = (await db.execute(stmt)).scalars().all()
    return [await order_dict(db, order) for order in orders]


@router.post("/orders", status_code=201)
async def place_order(payload: OrderIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await db.get(CafeMenuItem, payload.menu_item_id)
    if not item or not item.available:
        raise HTTPException(status_code=409, detail="This menu item is unavailable")
    now = datetime.now(timezone.utc).isoformat()
    order = CafeOrder(
        employee_id=user.id, menu_item_id=item.id, quantity=payload.quantity,
        notes=payload.notes, company_id=item.company_id,
        status_history=[{"status": "placed", "at": now, "by": str(user.id)}],
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return await order_dict(db, order)


@router.post("/orders/{order_id}/status")
async def set_status(order_id: uuid.UUID, payload: StatusIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    order = await db.get(CafeOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid order status")
    if payload.status == "cancelled":
        if order.employee_id != user.id and not (user.is_admin or user.role == "manager"):
            raise HTTPException(status_code=403, detail="Not allowed")
        if order.status not in {"placed", "preparing"}:
            raise HTTPException(status_code=409, detail="This order can no longer be cancelled")
    else:
        manager(user)
    if order.status in {"collected", "cancelled"}:
        raise HTTPException(status_code=409, detail="Order is already final")
    order.status = payload.status
    order.status_history = [
        *(order.status_history or []),
        {"status": payload.status, "at": datetime.now(timezone.utc).isoformat(), "by": str(user.id)},
    ]
    if payload.status == "ready":
        await notify_user(db, user_id=order.employee_id, title="Your café order is ready", body="Please collect it from the café.", link="/cafe", category="cafe")
    record(db, user=user, action="status", entity_type="cafe_order", entity_id=order.id, summary=f"Café order moved to {payload.status}")
    await db.commit()
    await db.refresh(order)
    return await order_dict(db, order)
