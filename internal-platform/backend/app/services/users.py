"""User sync helpers — map Microsoft Graph payloads onto local User rows."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


def _graph_email(g: dict) -> str | None:
    return g.get("mail") or g.get("userPrincipalName")


def _first(value):
    if isinstance(value, list):
        return value[0] if value else None
    return value


async def upsert_user_from_graph(db: AsyncSession, g: dict) -> User:
    """Create or update a local User from a Graph user object."""
    oid = g.get("id")
    email = _graph_email(g)

    user: User | None = None
    if oid:
        user = (
            await db.execute(select(User).where(User.azure_oid == oid))
        ).scalar_one_or_none()
    if user is None and email:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()

    if user is None:
        user = User(email=email or f"{oid}@unknown.local")
        db.add(user)

    user.azure_oid = oid or user.azure_oid
    if email:
        user.email = email
    user.display_name = g.get("displayName") or user.display_name
    user.given_name = g.get("givenName") or user.given_name
    user.surname = g.get("surname") or user.surname
    user.job_title = g.get("jobTitle") or user.job_title
    user.department = g.get("department") or user.department
    user.office_location = g.get("officeLocation") or user.office_location
    user.mobile_phone = g.get("mobilePhone") or user.mobile_phone
    user.business_phone = _first(g.get("businessPhones")) or user.business_phone

    await db.flush()
    return user


async def sync_all_users_from_graph(db: AsyncSession, graph_users: list[dict]) -> int:
    """Upsert a batch of directory users. Returns the count processed."""
    count = 0
    for g in graph_users:
        await upsert_user_from_graph(db, g)
        count += 1
    await db.flush()
    return count
