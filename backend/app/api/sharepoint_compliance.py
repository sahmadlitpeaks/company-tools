"""Permission-checked compliance workflow over indexed SharePoint documents."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.sharepoint import same_origin
from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.company import Company
from app.models.department import Department
from app.models.sharepoint import (SharePointComplianceEvent, SharePointComplianceTask,
    SharePointDocument, SharePointDocumentVersion, SharePointOwnerRule, SharePointReminder)
from app.models.user import User
from app.schemas.sharepoint import (ComplianceReviewIn, ComplianceTaskAssignIn,
    ComplianceTaskUpdateIn, OwnerRuleIn)
from app.services.sharepoint.common import SharePointError, digest, now
from app.services.sharepoint.compliance import (DEFAULT_LEADS, _active_department_owner,
    apply_analysis, event)
from app.services.sharepoint.graph import GraphClient, delegated_token
from app.services.sharepoint.reminders import populate_task_reminders
from app.services.sharepoint.store import authorize_document, source_for

router = APIRouter(prefix="/sharepoint/compliance", tags=["sharepoint-compliance"],
                   dependencies=[Depends(same_origin)])


async def _authorized(db, user, document_id):
    source = await source_for(db)
    document = await db.get(SharePointDocument, document_id)
    metadata = await authorize_document(db, user, source, document)
    return document, metadata


async def _can_manage(db, user, task):
    if user.is_admin or task.owner_user_id == user.id or (
        task.owner_department_id and task.owner_department_id == user.department_id
    ):
        return True
    owner = await db.get(User, task.owner_user_id) if task.owner_user_id else None
    return bool(owner and owner.manager_id == user.id)


@router.get("/dashboard")
async def dashboard(company_id: uuid.UUID | None = None, document_type: str | None = None,
                    owner_id: uuid.UUID | None = None, department_id: uuid.UUID | None = None,
                    status: str | None = None, due_from: date | None = None, due_to: date | None = None,
                    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    graph = GraphClient(await delegated_token(db, user))
    candidates = (await db.scalars(select(SharePointDocument).where(
        SharePointDocument.source_id == source.id,
        SharePointDocument.in_scope.is_(True), SharePointDocument.deleted.is_(False),
        SharePointDocument.is_folder.is_(False)).order_by(SharePointDocument.created_at.desc()))).all()
    accessible = []
    for document in candidates:
        try:
            metadata = await authorize_document(db, user, source, document, graph)
        except SharePointError as error:
            if error.code in {"document_access_denied", "document_not_found", "document_changed_sync_required"}:
                continue
            raise
        facts = document.compliance or {}
        if company_id and document.company_id != company_id:
            continue
        if document_type and facts.get("document_type") != document_type:
            continue
        if status and document.compliance_status != status:
            continue
        accessible.append((document, metadata))
    ids = [document.id for document, _ in accessible]
    tasks = (await db.scalars(select(SharePointComplianceTask).where(
        SharePointComplianceTask.document_id.in_(ids)).order_by(SharePointComplianceTask.due_date.asc()))).all() if ids else []
    if owner_id:
        tasks = [task for task in tasks if task.owner_user_id == owner_id]
    if department_id:
        tasks = [task for task in tasks if task.owner_department_id == department_id]
    if due_from:
        tasks = [task for task in tasks if task.due_date >= due_from]
    if due_to:
        tasks = [task for task in tasks if task.due_date <= due_to]
    if owner_id or department_id or due_from or due_to:
        visible_ids = {task.document_id for task in tasks}
        accessible = [(document, metadata) for document, metadata in accessible if document.id in visible_ids]
    company_ids = {document.company_id for document, _ in accessible if document.company_id}
    companies = {company.id: company.name for company in (await db.scalars(
        select(Company).where(Company.id.in_(company_ids)))).all()} if company_ids else {}
    owner_ids = {task.owner_user_id for task in tasks if task.owner_user_id}
    department_ids = {task.owner_department_id for task in tasks if task.owner_department_id}
    owners = {owner.id: owner.display_name or owner.email for owner in (await db.scalars(
        select(User).where(User.id.in_(owner_ids)))).all()} if owner_ids else {}
    departments = {department.id: department.name for department in (await db.scalars(
        select(Department).where(Department.id.in_(department_ids)))).all()} if department_ids else {}
    today = date.today()
    active = [task for task in tasks if task.status == "active"]
    summary = {"expiring_60": 0, "expiring_30": 0, "due_this_week": 0,
               "overdue": 0, "needs_review": 0, "unassigned": 0,
               "tasks_by_owner": {}, "documents_by_company": {}}
    result_documents = []
    for document, metadata in accessible:
        facts = document.compliance or {}
        company_name = companies.get(document.company_id) or "Unclassified"
        summary["documents_by_company"][company_name] = summary["documents_by_company"].get(company_name, 0) + 1
        if document.compliance_status == "needs_review":
            summary["needs_review"] += 1
            if "owner" in facts.get("review_reasons", []):
                summary["unassigned"] += 1
        expiry = (facts.get("expiry_date") or {}).get("value")
        if expiry and document.compliance_status == "active":
            remaining = (date.fromisoformat(expiry) - today).days
            if 0 <= remaining <= 60:
                summary["expiring_60"] += 1
            if 0 <= remaining <= 30:
                summary["expiring_30"] += 1
        result_documents.append({"id": str(document.id), "name": metadata.get("name") or document.filename,
            "url": metadata.get("webUrl") or "", "company_id": str(document.company_id) if document.company_id else None,
            "company": company_name, "document_type": facts.get("document_type", "unknown"),
            "reference_number": (facts.get("reference_number") or {}).get("value"),
            "expiry_date": expiry,
            "renewal_date": (facts.get("renewal_date") or {}).get("value"),
            "notice_days": (facts.get("termination_notice") or {}).get("days"),
            "status": document.compliance_status, "processing_status": document.status,
            "review_reasons": facts.get("review_reasons", []), "modified_at": document.modified_at,
            "uploaded_at": document.uploaded_at, "uploaded_by_email": document.uploaded_by_email})
    result_tasks = []
    for task in tasks:
        document = next((doc for doc, _ in accessible if doc.id == task.document_id), None)
        if not document:
            continue
        name = owners.get(task.owner_user_id) or departments.get(task.owner_department_id) or "Unassigned"
        if task.status == "active":
            days = (task.due_date - today).days
            if days < 0:
                summary["overdue"] += 1
            elif days <= 7:
                summary["due_this_week"] += 1
            summary["tasks_by_owner"][name] = summary["tasks_by_owner"].get(name, 0) + 1
            if name == "Unassigned":
                summary["unassigned"] += 1
        result_tasks.append({"id": str(task.id), "document_id": str(task.document_id),
            "document_name": document.filename, "title": task.title,
            "company": companies.get(document.company_id),
            "document_type": (document.compliance or {}).get("document_type"),
            "due_date": task.due_date.isoformat(), "basis": task.basis,
            "status": task.status, "owner": name,
            "owner_user_id": str(task.owner_user_id) if task.owner_user_id else None,
            "owner_department_id": str(task.owner_department_id) if task.owner_department_id else None})
    return {"summary": summary, "documents": result_documents, "tasks": result_tasks}


@router.get("/rules")
async def rules(user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(SharePointOwnerRule).order_by(
        SharePointOwnerRule.priority.asc(), SharePointOwnerRule.created_at.asc()))).all()
    return [{"id": str(rule.id), "company_id": str(rule.company_id) if rule.company_id else None,
        "document_type": rule.document_type,
        "folder_name": rule.folder_name,
        "owner_user_id": str(rule.owner_user_id) if rule.owner_user_id else None,
        "owner_department_id": str(rule.owner_department_id) if rule.owner_department_id else None,
        "reminder_leads": rule.reminder_leads, "priority": rule.priority,
        "is_active": rule.is_active} for rule in rows]


@router.get("/options")
async def options(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.sharepoint.common import is_reviewer
    if not user.is_admin and not is_reviewer(user):
        raise SharePointError("reviewer_required", 403)
    companies = (await db.scalars(select(Company).where(Company.is_active.is_(True)).order_by(Company.name))).all()
    departments = (await db.scalars(select(Department).order_by(Department.name))).all()
    users = (await db.scalars(select(User).where(User.is_active.is_(True),
        User.status == "active", User.email.is_not(None),
        func.length(func.trim(User.email)) > 0).order_by(User.display_name))).all()
    return {"companies": [{"id": str(row.id), "name": row.name} for row in companies],
        "departments": [{"id": str(row.id), "name": row.name} for row in departments],
        "users": [{"id": str(row.id), "name": row.display_name or row.email} for row in users]}


async def _validate_rule(db, body: OwnerRuleIn, *, excluding=None):
    if bool(body.owner_user_id) == bool(body.owner_department_id):
        raise SharePointError("exactly_one_owner_required", 422)
    if body.company_id and not await db.get(Company, body.company_id):
        raise SharePointError("company_not_found", 404)
    if body.owner_user_id:
        owner = await db.get(User, body.owner_user_id)
        if not owner or not owner.is_active or owner.status != "active" or not owner.email:
            raise SharePointError("owner_not_active", 422)
    if body.owner_department_id:
        if not await db.get(Department, body.owner_department_id):
            raise SharePointError("department_not_found", 404)
        if not await _active_department_owner(db, body.owner_department_id):
            raise SharePointError("department_has_no_active_member", 422)
    rows = (await db.scalars(select(SharePointOwnerRule))).all()
    for row in rows:
        if row.id == excluding:
            continue
        if (row.company_id == body.company_id and row.document_type == body.document_type and
            (row.folder_name or "").casefold() == (body.folder_name or "").casefold()):
            raise SharePointError("assignment_rule_already_exists", 409)


@router.post("/rules", status_code=201)
async def create_rule(body: OwnerRuleIn, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    await _validate_rule(db, body)
    rule = SharePointOwnerRule(**body.model_dump())
    db.add(rule)
    await db.flush()
    await db.commit()
    return {"id": str(rule.id)}


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: uuid.UUID, body: OwnerRuleIn,
                      user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    rule = await db.get(SharePointOwnerRule, rule_id)
    if not rule:
        raise SharePointError("rule_not_found", 404)
    await _validate_rule(db, body, excluding=rule_id)
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    await db.commit()
    return {"id": str(rule.id)}


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: uuid.UUID, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    rule = await db.get(SharePointOwnerRule, rule_id)
    if not rule:
        raise SharePointError("rule_not_found", 404)
    await db.delete(rule)
    await db.commit()


@router.post("/documents/{document_id}/review")
async def review(document_id: uuid.UUID, body: ComplianceReviewIn,
                 user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.sharepoint.common import is_reviewer
    if not user.is_admin and not is_reviewer(user):
        raise SharePointError("reviewer_required", 403)
    document, _ = await _authorized(db, user, document_id)
    if document.status != "ready" or not document.segments:
        raise SharePointError("document_not_ready", 409)
    if not await db.get(Company, body.company_id):
        raise SharePointError("company_not_found", 404)
    if bool(body.owner_user_id) and bool(body.owner_department_id):
        raise SharePointError("one_owner_only", 422)
    if body.owner_user_id:
        owner = await db.get(User, body.owner_user_id)
        if not owner or not owner.is_active or owner.status != "active" or not owner.email:
            raise SharePointError("owner_not_active", 422)
    if body.owner_department_id and not await db.get(Department, body.owner_department_id):
        raise SharePointError("department_not_found", 404)
    original = document.compliance or {}
    facts = {**original, "document_type": body.document_type,
        "company": {"value": (await db.get(Company, body.company_id)).name, "evidence": []}}
    for key, value in (("reference_number", body.reference_number),
                       ("expiry_date", body.expiry_date), ("renewal_date", body.renewal_date)):
        facts[key] = {"value": value, "evidence": []} if value is not None else None
    facts["termination_notice"] = {"days": body.termination_notice_days, "evidence": []} if body.termination_notice_days is not None else None
    tasks = await apply_analysis(db, document, {"sections": [{"compliance": facts}]},
        uploaded_by_email=document.uploaded_by_email, uploaded_by_oid=document.uploaded_by_oid,
        override_company_id=body.company_id, override_owner_user_id=body.owner_user_id,
        override_owner_department_id=body.owner_department_id, human_review=True)
    if document.compliance_status != "active":
        raise SharePointError("review_still_incomplete", 422)
    document.reviewed_by, document.reviewed_at = user.id, now()
    event(db, document.id, "reviewed", actor_id=user.id, details={"note": body.review_note})
    for task, leads in tasks:
        await populate_task_reminders(db, task, leads)
    await db.commit()
    return {"status": document.compliance_status, "tasks_created": len(tasks)}


@router.patch("/tasks/{task_id}")
async def update_task(task_id: uuid.UUID, body: ComplianceTaskUpdateIn,
                      user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    task = await db.get(SharePointComplianceTask, task_id)
    if not task:
        raise SharePointError("task_not_found", 404)
    document, _ = await _authorized(db, user, task.document_id)
    if not await _can_manage(db, user, task):
        raise SharePointError("task_owner_required", 403)
    if task.status not in {"active", "completed"}:
        raise SharePointError("task_not_active", 409)
    task.status = body.status
    task.completed_by = user.id if body.status == "completed" else None
    task.completed_at = now() if body.status == "completed" else None
    if body.status == "completed":
        reminders = (await db.scalars(select(SharePointReminder).where(
            SharePointReminder.task_id == task.id,
            SharePointReminder.status.in_(["pending", "failed"])))).all()
        for reminder in reminders:
            reminder.status = "dismissed"
    else:
        await populate_task_reminders(db, task, [60, 30, 28, 21, 14, 7, 6, 5, 4, 3, 2, 1, 0, -1])
        for reminder in (await db.scalars(select(SharePointReminder).where(
            SharePointReminder.task_id == task.id,
            SharePointReminder.status == "dismissed"))).all():
            current_key = digest([str(task.id), document.version or "",
                (reminder.recipient_email or "").lower(), str(reminder.lead_days)])[:64]
            if reminder.dedup_key == current_key and (
                reminder.reminder_date >= date.today().isoformat() or reminder.lead_days == -1
            ):
                reminder.status = "pending"
    all_tasks = (await db.scalars(select(SharePointComplianceTask).where(
        SharePointComplianceTask.document_id == document.id))).all()
    if all(item.status == "completed" for item in all_tasks):
        document.compliance_status = "completed"
    elif document.compliance_status == "completed":
        document.compliance_status = "active"
    event(db, document.id, "task_" + body.status, task_id=task.id, actor_id=user.id,
          details={"note": body.note} if body.note else None)
    await db.commit()
    return {"id": str(task.id), "status": task.status}


@router.post("/tasks/{task_id}/assign")
async def assign_task(task_id: uuid.UUID, body: ComplianceTaskAssignIn,
                      user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.sharepoint.common import is_reviewer

    if not user.is_admin and not is_reviewer(user):
        raise SharePointError("reviewer_required", 403)
    if bool(body.owner_user_id) == bool(body.owner_department_id):
        raise SharePointError("exactly_one_owner_required", 422)
    task = await db.get(SharePointComplianceTask, task_id)
    if not task:
        raise SharePointError("task_not_found", 404)
    document, _ = await _authorized(db, user, task.document_id)
    if task.status != "active":
        raise SharePointError("task_not_active", 409)
    if task.owner_user_id == body.owner_user_id and task.owner_department_id == body.owner_department_id:
        raise SharePointError("owner_unchanged", 409)
    if body.owner_user_id:
        owner = await db.get(User, body.owner_user_id)
        if not owner or not owner.is_active or owner.status != "active" or not owner.email:
            raise SharePointError("owner_not_active", 422)
    else:
        if not await db.get(Department, body.owner_department_id):
            raise SharePointError("department_not_found", 404)
        if not await _active_department_owner(db, body.owner_department_id):
            raise SharePointError("department_has_no_active_member", 422)

    old_owner_user_id, old_owner_department_id = task.owner_user_id, task.owner_department_id
    old_owner = await db.get(User, old_owner_user_id) if old_owner_user_id else await db.get(Department, old_owner_department_id)
    new_owner = await db.get(User, body.owner_user_id) if body.owner_user_id else await db.get(Department, body.owner_department_id)
    old_owner_name = (old_owner.display_name or old_owner.email) if old_owner_user_id and old_owner else old_owner.name if old_owner else "Unknown"
    new_owner_name = (new_owner.display_name or new_owner.email) if body.owner_user_id and new_owner else new_owner.name if new_owner else "Unknown"
    reminders = (await db.scalars(select(SharePointReminder).where(
        SharePointReminder.task_id == task.id))).all()
    leads = sorted({item.lead_days for item in reminders}) or list(DEFAULT_LEADS)
    for reminder in reminders:
        if reminder.status in {"pending", "failed"}:
            reminder.status = "dismissed"
    task.owner_user_id = body.owner_user_id
    task.owner_department_id = body.owner_department_id
    task.assignment_source = "manual"
    await db.flush()
    await populate_task_reminders(db, task, leads)

    # A task can return to an earlier owner. Re-arm only that owner's current
    # document-version reminders; older delivery history remains untouched.
    recipient_ids = [body.owner_user_id] if body.owner_user_id else [row.id for row in
        (await db.scalars(select(User).where(User.department_id == body.owner_department_id,
            User.is_active.is_(True), User.status == "active", User.email.is_not(None),
            func.length(func.trim(User.email)) > 0))).all()]
    recipients = [await db.get(User, owner_id) for owner_id in recipient_ids]
    allowed_emails = {owner.email.lower() for owner in recipients if owner and owner.email}
    for owner in recipients:
        if owner and owner.manager_id:
            manager = await db.get(User, owner.manager_id)
            if manager and manager.is_active and manager.status == "active" and manager.email:
                allowed_emails.add(manager.email.lower())
    for reminder in (await db.scalars(select(SharePointReminder).where(
        SharePointReminder.task_id == task.id, SharePointReminder.status == "dismissed"))).all():
        email = (reminder.recipient_email or "").lower()
        current_key = digest([str(task.id), document.version or "", email, str(reminder.lead_days)])[:64]
        if (email in allowed_emails and reminder.dedup_key == current_key and
            (reminder.reminder_date >= date.today().isoformat() or reminder.lead_days == -1)):
            reminder.status = "pending"
            reminder.attempts = 0
            reminder.last_error = None
    event(db, document.id, "task_reassigned", task_id=task.id, actor_id=user.id,
        details={"from_user_id": str(old_owner_user_id) if old_owner_user_id else None,
                 "from_department_id": str(old_owner_department_id) if old_owner_department_id else None,
                 "to_user_id": str(body.owner_user_id) if body.owner_user_id else None,
                 "to_department_id": str(body.owner_department_id) if body.owner_department_id else None,
                 "from_owner_name": old_owner_name, "to_owner_name": new_owner_name,
                 "changed_by": user.display_name or user.email,
                 "note": body.note})
    await db.commit()
    return {"id": str(task.id), "owner_user_id": str(task.owner_user_id) if task.owner_user_id else None,
            "owner_department_id": str(task.owner_department_id) if task.owner_department_id else None}


@router.get("/documents/{document_id}/history")
async def history(document_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    document, _ = await _authorized(db, user, document_id)
    versions = (await db.scalars(select(SharePointDocumentVersion).where(
        SharePointDocumentVersion.document_id == document.id).order_by(
        SharePointDocumentVersion.created_at.desc()))).all()
    events = (await db.scalars(select(SharePointComplianceEvent).where(
        SharePointComplianceEvent.document_id == document.id).order_by(
        SharePointComplianceEvent.created_at.desc()).limit(200))).all()
    return {"versions": [{"source_version": row.source_version, "modified_at": row.modified_at,
        "extracted": row.extracted, "status": row.status} for row in versions],
        "events": [{"id": str(row.id), "action": row.action,
        "actor_id": str(row.actor_id) if row.actor_id else None,
        "task_id": str(row.task_id) if row.task_id else None,
        "details": row.details, "at": row.created_at.isoformat()} for row in events]}
