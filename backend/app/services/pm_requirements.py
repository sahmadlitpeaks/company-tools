"""Shared, transaction-local requirement validation and traceability mutations.

Callers must hold the project row lock before adding/removing a link.
"""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select

from app.models.pm_requirement import PmRequirement, PmRequirementDecisionLink, PmRequirementEvent, PmRequirementIssueLink

CONTENT_FIELDS = ("title", "original_request", "context", "functional_requirements", "technical_requirements",
                  "scope", "expected_outcome", "acceptance_criteria", "supporting_information", "owner_id", "status")


def requirement_event(db, row, user, action, details=None):
    db.add(PmRequirementEvent(requirement_id=row.id, actor_id=user.id,
                             actor_name=user.display_name or user.email, action=action, details=details or {}, created_at=datetime.now(timezone.utc)))


async def writable_requirement(db, requirement_id, project_id):
    row = await db.scalar(select(PmRequirement).where(PmRequirement.id == requirement_id,
                                                     PmRequirement.project_id == project_id).with_for_update().execution_options(populate_existing=True))
    if not row:
        raise HTTPException(422, "Requirement must belong to this project")
    if row.status == "archived":
        raise HTTPException(409, "This requirement is archived. Restore it before making changes.")
    return row


async def link_requirement(db, row, target, kind, user):
    model = PmRequirementIssueLink if kind == "issue" else PmRequirementDecisionLink
    column = model.issue_id if kind == "issue" else model.decision_id
    exists = await db.scalar(select(model.id).where(model.requirement_id == row.id, column == target.id))
    if exists:
        return
    db.add(model(requirement_id=row.id, **{f"{kind}_id": target.id}, added_by_id=user.id))
    row.version += 1
    requirement_event(db, row, user, f"{kind}_linked", {"id": str(target.id), "number": target.number,
                                                      "title": target.summary if kind == "issue" else target.title})
