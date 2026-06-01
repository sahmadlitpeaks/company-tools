"""Dev helper: create all tables directly (skips Alembic) and seed a default
email-signature template. Use Alembic migrations for production.

    python -m scripts.init_db
"""
import asyncio

from sqlalchemy import select

from app.core.database import AsyncSessionLocal, Base, engine
import app.models  # noqa: F401  (register models)
from app.models.signature import SignatureTemplate
from app.services.signatures import DEFAULT_TEMPLATE


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        existing = (
            await db.execute(
                select(SignatureTemplate).where(SignatureTemplate.is_default.is_(True))
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                SignatureTemplate(
                    name="AG Holding — Classic",
                    description="Default branded signature.",
                    html=DEFAULT_TEMPLATE,
                    is_default=True,
                )
            )
            await db.commit()
    print("Database initialised.")


if __name__ == "__main__":
    asyncio.run(main())
