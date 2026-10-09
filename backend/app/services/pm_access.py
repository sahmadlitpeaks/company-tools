"""Per-project access for the project tracker.

Holding the ``projects`` module only opens the area; each project is visible
to its members and to platform admins. Roles:

* admin  - edit the project, its members and every issue
* member - create, edit and move issues; comment
* viewer - read and comment (stakeholders such as requesters)
"""
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pm import PmProject, PmProjectMember
from app.models.user import User

_RANK = {"viewer": 0, "member": 1, "admin": 2}


async def project_role(db: AsyncSession, user: User, project_id: uuid.UUID) -> str | None:
    """The caller's effective role, or None when they cannot see the project."""
    if user.is_admin:
        return "admin"
    return await db.scalar(
        select(PmProjectMember.role).where(
            PmProjectMember.project_id == project_id,
            PmProjectMember.user_id == user.id,
        )
    )


async def visible_project_ids(db: AsyncSession, user: User) -> set[uuid.UUID] | None:
    """Project ids the user may see; None means every project (admins)."""
    if user.is_admin:
        return None
    rows = await db.scalars(
        select(PmProjectMember.project_id).where(PmProjectMember.user_id == user.id)
    )
    return set(rows.all())


async def require_project(
    db: AsyncSession, user: User, project_id: uuid.UUID, minimum: str = "viewer",
    *, for_update: bool = False,
) -> tuple[PmProject, str]:
    """Load a project and check the caller holds at least ``minimum``.

    A project the caller cannot see is reported as missing, so ids of other
    teams' projects are not confirmed to exist.
    """
    # Serialize membership mutations before locking/counting individual members.
    # Check access after waiting, since the caller may have lost its role.
    if for_update:
        project = await db.scalar(
            select(PmProject).where(PmProject.id == project_id)
            .with_for_update().execution_options(populate_existing=True)
        )
    else:
        project = await db.get(PmProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    role = await project_role(db, user, project_id)
    if role is None:
        raise HTTPException(404, "Project not found")
    if _RANK[role] < _RANK[minimum]:
        raise HTTPException(403, "Your project role does not allow this")
    return project, role


def ensure_writable(project: PmProject) -> None:
    if project.status == "archived":
        raise HTTPException(409, "This project is archived. Restore it to make changes.")


def role_at_least(role: str | None, minimum: str) -> bool:
    return role is not None and _RANK[role] >= _RANK[minimum]


async def member_ids(db: AsyncSession, project_id: uuid.UUID) -> dict[uuid.UUID, str]:
    rows = await db.execute(
        select(PmProjectMember.user_id, PmProjectMember.role).where(
            PmProjectMember.project_id == project_id
        )
    )
    return {user_id: role for user_id, role in rows.all()}
