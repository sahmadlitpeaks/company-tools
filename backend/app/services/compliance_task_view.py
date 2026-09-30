"""Fast assignment previews and scoped, live-authorized document task details."""
import asyncio
from sqlalchemy import or_, select
from app.models.company import Company
from app.models.department import Department
from app.models.sharepoint import SharePointComplianceTask, SharePointDocument
from app.models.user import User
from app.services.sharepoint.common import SharePointError, is_reviewer
from app.services.sharepoint.graph import GraphClient, delegated_token
from app.services.sharepoint.store import authorize_document, public_document, source_for
from app.services.task_assignment_email import assignment_states

ACCESS_MESSAGES = {
    "checking": "Checking your access to the original SharePoint file.",
    "module_required": "Ask an administrator to enable SharePoint Intelligence for your account.",
    "microsoft_connection_required": "Connect your Microsoft account in Compliance to view this task.",
    "document_access_denied": "Your Microsoft account cannot read the original file. Ask the file owner to grant access in SharePoint.",
    "document_not_found": "The original file is unavailable or outside the configured SharePoint folder.",
    "document_changed_sync_required": "The original file changed. Its details will be available after processing finishes.",
    "graph_unavailable": "SharePoint access could not be checked. Refresh to try again.",
}
ACCESS_DEADLINE_SECONDS = 12


async def task_board(db, user, *, preview=False):
    try:
        source = await source_for(db)
    except SharePointError as error:
        if error.code in {"sharepoint_disabled", "sharepoint_not_configured"}:
            return {"tasks": [], "available": False, "message": "Document tasks are waiting for SharePoint setup."}
        raise
    pairs = (await db.execute(select(SharePointComplianceTask, SharePointDocument).join(
        SharePointDocument, SharePointDocument.id == SharePointComplianceTask.document_id).where(
        SharePointComplianceTask.source_id == source.id,
        SharePointComplianceTask.status.in_(["active", "completed"]),
        SharePointDocument.deleted.is_(False), SharePointDocument.in_scope.is_(True),
        SharePointDocument.is_folder.is_(False)).order_by(SharePointComplianceTask.due_date))).all()
    owner_ids = {task.owner_user_id for task, _ in pairs if task.owner_user_id}
    owners = {person.id: person for person in (await db.scalars(select(User).where(
        User.id.in_(owner_ids)))).all()} if owner_ids else {}
    if not (user.is_admin or is_reviewer(user)):
        leads = set((await db.scalars(select(User.department_id).where(
            User.department_id.is_not(None), User.is_active.is_(True), User.status == "active",
            or_(User.role == "manager", User.is_admin.is_(True))))).all())
        def visible(task):
            if task.owner_user_id == user.id:
                return True
            if user.department_id and task.owner_department_id == user.department_id:
                return user.role == "manager" or user.department_id not in leads
            owner = owners.get(task.owner_user_id)
            return bool(user.role == "manager" and owner and (
                owner.manager_id == user.id or user.department_id and
                owner.department_id == user.department_id))
        pairs = [(task, doc) for task, doc in pairs if visible(task)]
    departments = {dept.id: dept.name for dept in (await db.scalars(select(Department))).all()}
    states = await assignment_states(db, compliance=True, task_ids=[task.id for task, _ in pairs])
    access = {}
    module = "sharepoint_intelligence" in user.effective_permissions
    connection_error = None
    if pairs and not preview and module:
        try:
            graph = GraphClient(await delegated_token(db, user))
            semaphore = asyncio.Semaphore(4)

            async def check(document):
                async with semaphore:
                    try:
                        return await authorize_document(db, user, source, document, graph=graph)
                    except SharePointError as error:
                        return error.code

            documents = {doc.id: doc for _, doc in pairs}
            checks = {doc_id: asyncio.create_task(check(doc)) for doc_id, doc in documents.items()}
            try:
                _, pending = await asyncio.wait(checks.values(), timeout=ACCESS_DEADLINE_SECONDS)
                for job in pending:
                    job.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for doc_id, job in checks.items():
                    access[doc_id] = "graph_unavailable" if job.cancelled() else job.result()
            finally:
                for job in checks.values():
                    if not job.done():
                        job.cancel()
                await asyncio.gather(*checks.values(), return_exceptions=True)
        except SharePointError as error:
            connection_error = error.code
    company_ids = {doc.company_id for _, doc in pairs if doc.company_id}
    companies = {company.id: company.name for company in (await db.scalars(select(Company).where(
        Company.id.in_(company_ids)))).all()} if company_ids else {}
    from app.api.sharepoint_compliance import _can_assign, _can_manage
    results = []
    for task, document in pairs:
        owner = owners.get(task.owner_user_id)
        dept_id = task.owner_department_id or (owner.department_id if owner else None)
        item = {
            "id": str(task.id), "source": "compliance", "title": "Document task assigned",
            "status": "done" if task.status == "completed" else task.work_status,
            "lifecycle_status": task.status, "priority": "normal", "due_date": None,
            "assignee_id": str(task.owner_user_id) if task.owner_user_id else None,
            "owner_department_id": str(task.owner_department_id) if task.owner_department_id else None,
            "assignee_name": owner.display_name or owner.email if owner else departments.get(dept_id),
            "assignee_department_id": str(dept_id) if dept_id else None,
            "assignee_department_name": departments.get(dept_id),
            "can_assign": False, "can_change_status": False, "can_delete": False,
            "assignment_email_status": states.get(task.id), "created_at": task.created_at.isoformat(),
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "subtasks_total": 0, "subtasks_done": 0, "comment_count": 0,
        }
        result = access.get(document.id)
        reason = ("module_required" if not module else "checking" if preview else
                  connection_error or result or "graph_unavailable")
        if isinstance(result, dict):
            facts = document.compliance or {}
            company = companies.get(document.company_id) or (facts.get("company") or {}).get("value")
            item.update({
                "access_state": "ready", "access_message": None, "title": task.title,
                "priority": "high", "due_date": task.due_date.isoformat(), "basis": task.basis,
                "document_id": str(document.id), "document_name": document.filename,
                "document_type": facts.get("document_type"), "company": company,
                "description": f"{document.filename} · {company or 'External entity'}",
                "document_url": public_document(document, result)["url"],
                "document_expiry_date": (facts.get("expiry_date") or {}).get("value"),
                "reference_number": (facts.get("reference_number") or {}).get("value"),
                "can_assign": await _can_assign(db, user, task),
                "can_change_status": await _can_manage(db, user, task),
            })
        else:
            item.update(access_state=reason, access_message=ACCESS_MESSAGES.get(
                reason, "SharePoint access could not be verified. Refresh or reconnect Microsoft."))
        results.append(item)
    return {"tasks": results, "available": bool(module), "message": None}
