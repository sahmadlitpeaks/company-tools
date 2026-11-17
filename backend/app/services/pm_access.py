"""Per-project access for the project tracker (BRD section 7).

Holding the ``projects`` module only opens the area. Inside a project, what a
member can do comes from their project role (``pm_project_members.role`` holds
the role key) plus per-member allow/deny overrides; a deny always wins. Routes
check a named permission such as ``issue.delete`` or ``sprint.manage``.

Platform administrators hold every project permission on every project, and
holders of the ``projects.view_all`` platform permission can read every
project.
"""
import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access_catalog import BY_KEY, PROJECT_KEYS, STARTER_ROLES
from app.models.pm import PmProject, PmProjectMember
from app.models.role import Role
from app.models.user import User
from app.services.access import is_owner, platform_actions

_STARTER = {r["key"]: frozenset(r["permissions"]) for r in STARTER_ROLES if r["scope"] == "project"}
VIEW_ALL_PERMISSIONS = frozenset({"project.view", "reports.view"})


@dataclass(frozen=True)
class ProjectAccess:
    """What one person may do in one project."""

    role: str | None
    permissions: frozenset[str]

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    @property
    def assignable(self) -> bool:
        """Whether issues may be assigned to this member."""
        return self.can("issue.edit") or self.can("issue.edit_own")

    @property
    def legacy_role(self) -> str:
        """admin | member | viewer, for clients that still read ``my_role``."""
        if self.can("members.manage"):
            return "admin"
        if self.can("issue.edit") or self.can("issue.create"):
            return "member"
        return "viewer"


ADMIN_ACCESS = ProjectAccess("admin", PROJECT_KEYS)


def compose(role_permissions, allow, deny) -> frozenset[str]:
    return frozenset((set(role_permissions) | set(allow or [])) - set(deny or [])) & PROJECT_KEYS


async def role_permissions(db: AsyncSession, keys: set[str]) -> dict[str, frozenset[str]]:
    """Permissions of the named project roles; starter defaults if a row is missing."""
    found: dict[str, frozenset[str]] = {}
    if keys:
        rows = await db.execute(
            select(Role.key, Role.permissions).where(Role.key.in_(keys), Role.scope == "project")
        )
        found = {key: frozenset(perms or []) & PROJECT_KEYS for key, perms in rows.all()}
    for key in keys - found.keys():
        found[key] = _STARTER.get(key, frozenset())
    return found


async def _membership_access(db: AsyncSession, members: list[PmProjectMember]) -> list[ProjectAccess]:
    perms = await role_permissions(db, {m.role for m in members})
    return [
        ProjectAccess(m.role, compose(perms[m.role], m.allow_permissions, m.deny_permissions))
        for m in members
    ]


async def project_access(db: AsyncSession, user: User, project_id: uuid.UUID) -> ProjectAccess | None:
    """The caller's access to one project, or None when they cannot see it."""
    if is_owner(user):
        return ADMIN_ACCESS
    membership = await db.scalar(
        select(PmProjectMember).where(
            PmProjectMember.project_id == project_id, PmProjectMember.user_id == user.id
        )
    )
    if membership is not None:
        access = (await _membership_access(db, [membership]))[0]
        if access.can("project.view"):
            return access
    if "projects.view_all" in platform_actions(user):
        return ProjectAccess(None, VIEW_ALL_PERMISSIONS)
    return None


async def project_access_map(db: AsyncSession, user: User, project_ids) -> dict[uuid.UUID, ProjectAccess]:
    """Access per project for list screens (projects the caller cannot see are left out)."""
    ids = list(project_ids)
    if not ids:
        return {}
    if is_owner(user):
        return {pid: ADMIN_ACCESS for pid in ids}
    members = list((await db.scalars(select(PmProjectMember).where(
        PmProjectMember.project_id.in_(ids), PmProjectMember.user_id == user.id
    ))).all())
    out = {
        m.project_id: access
        for m, access in zip(members, await _membership_access(db, members))
        if access.can("project.view")
    }
    if "projects.view_all" in platform_actions(user):
        for pid in ids:
            out.setdefault(pid, ProjectAccess(None, VIEW_ALL_PERMISSIONS))
    return out


async def visible_project_ids(db: AsyncSession, user: User) -> set[uuid.UUID] | None:
    """Project ids the user may see; None means every project."""
    if is_owner(user) or "projects.view_all" in platform_actions(user):
        return None
    members = list((await db.scalars(
        select(PmProjectMember).where(PmProjectMember.user_id == user.id)
    )).all())
    return {
        m.project_id for m, access in zip(members, await _membership_access(db, members))
        if access.can("project.view")
    }


async def project_role(db: AsyncSession, user: User, project_id: uuid.UUID) -> ProjectAccess | None:
    """Alias of ``project_access`` kept for callers that check other people."""
    return await project_access(db, user, project_id)


def missing_detail(permission: str) -> str:
    label = BY_KEY[permission].label if permission in BY_KEY else permission
    return f"You need the “{label}” permission ({permission}) on this project."


async def require_project(
    db: AsyncSession, user: User, project_id: uuid.UUID, permission: str = "project.view",
    *, for_update: bool = False,
) -> tuple[PmProject, ProjectAccess]:
    """Load a project and check the caller holds ``permission`` on it.

    A project the caller cannot see is reported as missing, so ids of other
    teams' projects are not confirmed to exist.
    """
    if permission not in PROJECT_KEYS:
        raise ValueError(f"Unknown project permission: {permission}")
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
    access = await project_access(db, user, project_id)
    if access is None:
        raise HTTPException(404, "Project not found")
    if not access.can(permission):
        raise HTTPException(403, missing_detail(permission))
    return project, access


def require(access: ProjectAccess, permission: str) -> None:
    if not access.can(permission):
        raise HTTPException(403, missing_detail(permission))


def ensure_writable(project: PmProject) -> None:
    if project.status == "archived":
        raise HTTPException(409, "This project is archived. Restore it to make changes.")


async def member_access(db: AsyncSession, project_id: uuid.UUID) -> dict[uuid.UUID, ProjectAccess]:
    """Every member of a project and what they may do there."""
    members = list((await db.scalars(
        select(PmProjectMember).where(PmProjectMember.project_id == project_id)
    )).all())
    return {m.user_id: a for m, a in zip(members, await _membership_access(db, members))}


async def member_ids(db: AsyncSession, project_id: uuid.UUID) -> dict[uuid.UUID, str]:
    """Members of a project and their role key."""
    rows = await db.execute(
        select(PmProjectMember.user_id, PmProjectMember.role).where(
            PmProjectMember.project_id == project_id
        )
    )
    return {user_id: role for user_id, role in rows.all()}


async def manager_count(db: AsyncSession, project_id: uuid.UUID) -> int:
    """Members who can manage members — a project must always keep one (PRM-10)."""
    return sum(1 for access in (await member_access(db, project_id)).values() if access.can("members.manage"))
