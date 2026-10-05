"""Persist, authorize, and retry assignment mail without failing task creation."""
import asyncio
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import urlparse
from sqlalchemy import select, update
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.company import Company
from app.models.department import Department
from app.models.notification import Notification
from app.models.task_assignment_email import TaskAssignmentEmail
from app.models.sharepoint import SharePointComplianceTask, SharePointDocument, SharePointSource
from app.models.user import User
from app.models.workplace import Task
from app.services.email import send_email, smtp_configured

def task_link(task_id):
    base = settings.PUBLIC_BASE_URL or settings.FRONTEND_BASE_URL
    if not base and settings.SHAREPOINT_REDIRECT_URI:
        parsed = urlparse(settings.SHAREPOINT_REDIRECT_URI)
        base = f"{parsed.scheme}://{parsed.netloc}"
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username:
        return None
    return f"{base.rstrip('/')}/tasks?task={task_id}"

async def queue_assignment_email(db, task, recipient, *, notification, actor_id=None, compliance=False):
    await db.flush()
    task_column = TaskAssignmentEmail.compliance_task_id if compliance else TaskAssignmentEmail.task_id
    await db.execute(update(TaskAssignmentEmail).where(
        task_column == task.id, TaskAssignmentEmail.recipient_id == recipient.id,
        TaskAssignmentEmail.status == "pending").values(status="cancelled"))
    db.add(TaskAssignmentEmail(
        task_id=None if compliance else task.id,
        compliance_task_id=task.id if compliance else None,
        recipient_id=recipient.id, notification_id=notification.id, actor_id=actor_id,
        created_at=datetime.now(timezone.utc)))

async def notify_assignment(db, task, *, actor_id=None):
    if not task.assignee_id:
        return
    recipient = await db.get(User, task.assignee_id)
    if not recipient:
        return
    await db.flush()
    note = Notification(user_id=recipient.id, title="A task was assigned to you",
        body=f"{task.title} · Due {task.due_date.isoformat() if task.due_date else 'date not set'}",
        category="task", link=f"/tasks?task={task.id}")
    db.add(note)
    await queue_assignment_email(db, task, recipient, notification=note, actor_id=actor_id)

def assignment_email_html(*, title, description, due_date, owner, department, assigned_by, link,
                          document_name=None, company=None, details_available=True, task_type="Assigned task",
                          document_type=None, priority=None, status=None, deadline_basis=None, reference=None, expiry_date=None):
    rows = [("Task type", task_type), ("Status", status or "To do"), ("Priority", priority or "Normal"), ("Due date", "Available after SharePoint access is verified" if not details_available else due_date.strftime("%d %B %Y") if due_date else "Not set"),
            ("Assigned to", owner), ("Department", department or "Not set"),
            ("Assigned by", assigned_by or "Document automation")]
    for label, value in [("Document type", document_type), ("Reference", reference),
                         ("Deadline basis", deadline_basis), ("Document expiry", expiry_date)]:
        if value:
            rows.append((label, value))
    if document_name:
        rows.append(("Document", document_name))
    if company:
        rows.append(("Company / entity", company))
    details = "".join(f"<tr><th style='text-align:left;padding:8px;color:#52525b'>{escape(label)}</th>"
        f"<td style='padding:8px'>{escape(str(value))}</td></tr>" for label, value in rows)
    description_html = f"<p style='white-space:pre-wrap'>{escape(description)}</p>" if description else ""
    button = f"<p><a href='{escape(link, quote=True)}' style='display:inline-block;background:#facc15;color:#18181b;padding:12px 20px;text-decoration:none;font-weight:700'>Open task</a></p>" if link else "<p>Open Tasks in the AG Holding workspace to view this assignment.</p>"
    return f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e4e4e7;color:#18181b">
    <p style="font-size:12px;color:#52525b">AG Holding · Task assignment</p>
    <h1 style="font-size:24px">{escape(title)}</h1><p>You have a new task to review and complete.</p>
    {description_html}<table style="border-collapse:collapse;width:100%">{details}</table>{button}
    <p style="font-size:12px;color:#52525b">The latest task status and deadline are available in the workspace.</p></div>"""

async def assignment_states(db, *, compliance=False, task_ids=None):
    column = TaskAssignmentEmail.compliance_task_id if compliance else TaskAssignmentEmail.task_id
    query = select(TaskAssignmentEmail).where(column.is_not(None))
    if task_ids is not None:
        if not task_ids:
            return {}
        query = query.where(column.in_(task_ids))
    rows = (await db.scalars(query.order_by(
        TaskAssignmentEmail.created_at.desc(), TaskAssignmentEmail.id.desc()))).all()
    result = {}
    for row in rows:
        result.setdefault(row.compliance_task_id if compliance else row.task_id, row.status)
    return result

async def _deliver(db, row):
    recipient = await db.get(User, row.recipient_id)
    task = await db.get(SharePointComplianceTask if row.compliance_task_id else Task,
        row.compliance_task_id or row.task_id)
    category = "compliance" if row.compliance_task_id else "task"
    if not recipient or not recipient.is_active or recipient.status != "active" or not recipient.email or category in (recipient.notify_muted or []):
        row.status = "cancelled"
        return False
    document_name = company_name = document_type = reference = expiry_date = deadline_basis = None
    details_available = True
    description = getattr(task, "description", None)
    if row.compliance_task_id:
        if not task or task.status != "active":
            row.status = "cancelled"
            return False
        from app.services.sharepoint.reminders import compliance_task_recipients
        if recipient.id not in {person.id for person in await compliance_task_recipients(db, task)}:
            row.status = "cancelled"
            return False
        document = await db.get(SharePointDocument, task.document_id)
        source = await db.get(SharePointSource, task.source_id)
        if not document or not source or document.deleted or not document.in_scope:
            row.status = "cancelled"
            return False
        from app.services.sharepoint.store import authorize_document
        from app.services.sharepoint.common import SharePointError
        reason = "module_required"
        details_available = "sharepoint_intelligence" in recipient.effective_permissions
        if details_available:
            try:
                await authorize_document(db, recipient, source, document)
            except SharePointError as error:
                details_available = False
                reason = error.code
        if details_available:
            document_name = document.filename
            facts = document.compliance or {}
            company = await db.get(Company, document.company_id) if document.company_id else None
            def fact_text(key):
                value = facts.get(key)
                value = value.get("value") if isinstance(value, dict) else value
                return value if isinstance(value, str) else None
            company_name = company.name if company else fact_text("company")
            kind = fact_text("document_type")
            document_type = {"iso_cap_certificate": "ISO / CAP certificate", "dpa": "Data processing agreement",
                "it_software_agreement": "IT / software agreement"}.get(kind, kind.replace("_", " ").capitalize() if kind else None)
            reference, expiry_date = fact_text("reference_number"), fact_text("expiry_date")
            deadline_basis = {"notice_period": "Termination notice deadline", "notice": "Termination notice deadline", "expiry": "Document expiry",
                "renewal": "Renewal date"}.get(task.basis, task.basis.replace("_", " ").capitalize())
            description = f"Complete the action required by {document.filename}. The action must be completed by the task due date; this may be earlier than the document expiry."
        else:
            from app.services.compliance_task_view import ACCESS_MESSAGES
            description = ACCESS_MESSAGES.get(reason, "Open the workspace to check access to your assigned document task.")
    elif not task or task.assignee_id != recipient.id or task.status == "done":
        row.status = "cancelled"
        return False
    department = await db.get(Department, recipient.department_id) if recipient.department_id else None
    actor = await db.get(User, row.actor_id) if row.actor_id else None
    title = task.title if details_available else "Document task assigned"
    content = assignment_email_html(title=title, description=description, due_date=task.due_date if details_available else None,
        owner=recipient.display_name or recipient.email, department=department.name if department else None,
        assigned_by=actor.display_name or actor.email if actor else None,
        link=task_link(task.id), document_name=document_name, company=company_name, details_available=details_available,
        task_type="Document compliance" if row.compliance_task_id else "Assigned task",
        document_type=document_type, reference=reference, expiry_date=expiry_date, deadline_basis=deadline_basis,
        priority="High" if row.compliance_task_id and details_available else getattr(task, "priority", "normal").capitalize(),
        status="To do" if row.compliance_task_id and task.work_status == "todo" else
            (task.work_status if row.compliance_task_id else task.status).replace("_", " ").capitalize())
    subject = f"Task assigned: {title}".replace("\r", " ").replace("\n", " ")[:200]
    if not await asyncio.to_thread(send_email, to=recipient.email, subject=subject, html=content):
        row.last_error = "Email delivery unavailable"
        return False
    row.status, row.sent_at, row.last_error = "sent", datetime.now(timezone.utc), None
    if row.compliance_task_id:
        from app.services.sharepoint.compliance import event
        event(db, task.document_id, "assignment_email_sent", task_id=task.id,
            details={"recipient_id": str(recipient.id), "document_details_available": details_available})
    return True

async def run_assignment_emails(db):
    if not smtp_configured():
        return {"sent": 0, "checked": 0}
    now = datetime.now(timezone.utc)
    rows = (await db.scalars(select(TaskAssignmentEmail).where(
        TaskAssignmentEmail.status == "pending",
        TaskAssignmentEmail.attempts < 5,
        (TaskAssignmentEmail.next_attempt_at.is_(None) | (TaskAssignmentEmail.next_attempt_at <= now))
    ).order_by(TaskAssignmentEmail.created_at).limit(25).with_for_update(skip_locked=True))).all()
    sent = 0
    for row in rows:
        try:
            delivered = await _deliver(db, row)
        except Exception:
            delivered = False
            row.last_error = "Email delivery failed"
        if delivered:
            sent += 1
        elif row.status == "pending":
            row.attempts += 1
            row.next_attempt_at = now + timedelta(minutes=min(2 ** row.attempts, 60))
            if row.attempts >= 5:
                row.status = "failed"
    await db.commit()
    return {"sent": sent, "checked": len(rows)}

async def deliver_assignment_emails():
    async with AsyncSessionLocal() as db:
        await run_assignment_emails(db)
