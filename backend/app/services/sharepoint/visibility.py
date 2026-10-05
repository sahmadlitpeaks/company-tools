"""Current workspace assignments restrict documents before delegated Graph checks."""
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department
from app.models.sharepoint import (
    SharePointComplianceTask, SharePointDocument, SharePointReminder, SharePointSource,
)
from app.models.user import User
from app.services.sharepoint.compliance import department_for_path


@dataclass(frozen=True)
class DocumentScope:
    # None represents an administrator's global workspace scope.
    documents: frozenset[UUID] | None
    tasks: frozenset[UUID] | None

    def document_filter(self):
        return true() if self.documents is None else SharePointDocument.id.in_(self.documents)

    def contains(self, document_id: UUID) -> bool:
        return self.documents is None or document_id in self.documents


async def document_scope(db: AsyncSession, user: User, source: SharePointSource) -> DocumentScope:
    if user.is_admin:
        return DocumentScope(None, None)

    manager = user.role == "manager"
    team_filter = User.id == user.id
    if manager:
        team_filter = or_(
            User.department_id == user.department_id if user.department_id else User.id == user.id,
            User.manager_id == user.id,
        )
    team = set((await db.scalars(select(User.id).where(team_filter))).all())

    # Department inboxes belong to managers; without a lead, existing fallback
    # recipients remain able to work their department's group assignments.
    lead = None
    if user.department_id:
        lead = (await db.scalars(select(User.id).where(
            User.department_id == user.department_id,
            User.is_active.is_(True), User.status == "active",
            or_(User.role == "manager", User.is_admin.is_(True)),
        ).limit(1))).first()

    rows = (await db.execute(select(
        SharePointComplianceTask.id, SharePointComplianceTask.document_id,
        SharePointComplianceTask.owner_user_id, SharePointComplianceTask.owner_department_id,
    ).where(
        SharePointComplianceTask.source_id == source.id,
        SharePointComplianceTask.status.in_(["active", "completed"]),
    ))).all()
    owned_documents = {row.document_id for row in rows}
    visible_tasks = [
        row for row in rows if row.owner_user_id in team or (
            user.department_id and row.owner_department_id == user.department_id and (manager or not lead)
        )
    ]
    documents = {row.document_id for row in visible_tasks}

    # A standalone reminder is an explicit document assignment. Task reminder
    # history never grants access to a former owner after reassignment.
    manual = select(SharePointReminder.document_id).where(
        SharePointReminder.source_id == source.id,
        SharePointReminder.task_id.is_(None),
        func.lower(func.trim(SharePointReminder.recipient_email)).in_(
            select(func.lower(User.email)).where(User.id.in_(team))
        ),
        SharePointReminder.status.in_(["pending", "failed", "sent", "completed", "dismissed"]),
    )
    documents.update((await db.scalars(manual)).all())

    if manager and user.department_id:
        departments = (await db.scalars(select(Department))).all()
        candidates = (await db.execute(select(SharePointDocument.id, SharePointDocument.path).where(
            SharePointDocument.source_id == source.id, SharePointDocument.deleted.is_(False),
            SharePointDocument.in_scope.is_(True), SharePointDocument.is_folder.is_(False),
        ))).all()
        for doc_id, path in candidates:
            # Current assignments override the original folder after a transfer.
            if doc_id in owned_documents:
                continue
            department = department_for_path(path, departments)
            if department and department.id == user.department_id:
                documents.add(doc_id)

    return DocumentScope(frozenset(documents), frozenset(row.id for row in visible_tasks))
