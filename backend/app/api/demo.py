"""Admin-only demo/sample data controls, blocked on production by default."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin
from app.core.database import get_db
from app.models.user import User
from app.services.demo_seed import clear_demo, demo_allowed, demo_status, seed_demo

router = APIRouter(prefix="/demo", tags=["demo-data"])


def _guard():
    if not demo_allowed():
        raise HTTPException(
            status_code=403,
            detail="Demo data is disabled on production.",
        )


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    return await demo_status(db)


@router.post("/seed")
async def seed(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    _guard()
    if (await demo_status(db))["seeded"]:
        raise HTTPException(status_code=409, detail="Demo data already loaded — remove it first.")
    return await seed_demo(db)


@router.post("/clear")
async def clear(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    _guard()
    return await clear_demo(db)
