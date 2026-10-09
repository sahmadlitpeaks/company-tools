"""Delete unused local employees without cascading away business history."""
from sqlalchemy import and_, delete, func, literal, or_, select, union_all, update
from app.core.database import Base
from app.models.sharepoint import SharePointComplianceTask, SharePointDocument, SharePointComplianceEvent, SharePointReminder, SharePointOwnerRule
from app.models.task_assignment_email import TaskAssignmentEmail
from app.models.user import User
from app.services.activity import record


class ActiveComplianceWorkError(ValueError):
    """Responsibility changed while deletion was being checked."""


PERSONAL_TABLES = {
    "notifications", "dashboard_preferences", "workspace_items", "saved_views",
    "email_signatures", "user_companies", "sharepoint_connections", "task_assignment_emails",
    "pm_issue_watchers", "pm_share_links", "pm_access_tokens",
}


def user_links(table):
    return [column for column in table.c if any(
        fk.target_fullname == "users.id" for fk in column.foreign_keys)]


def compliance_links(table, user_id):
    """Only current responsibility blocks account removal; audit references do not."""
    if table.name == "sharepoint_owner_rules":
        return and_(table.c.owner_user_id == user_id, table.c.is_active.is_(True))
    if table.name == "sharepoint_compliance_tasks":
        live_documents = select(SharePointDocument.id).where(
            SharePointDocument.deleted.is_(False), SharePointDocument.in_scope.is_(True))
        return and_(table.c.owner_user_id == user_id, table.c.status == "active",
                    table.c.document_id.in_(live_documents))
    return None


def record_label(name):
    if name == "users":
        return "Direct reports"
    if name == "sharepoint_owner_rules":
        return "Active Compliance owner rules"
    if name == "sharepoint_compliance_tasks":
        return "Active Compliance tasks"
    if name.startswith("pm_"):
        return "Project tracker records"
    if name.startswith(("tasks", "task_", "project", "checklist")):
        return "Tasks and projects"
    if name.startswith(("time_", "work_log", "timesheet", "payroll", "leave", "hr_", "compensation", "employment")):
        return "Employment and attendance records"
    return "Linked business records"


async def deletion_blockers(db, user_id):
    queries = []
    for table in Base.metadata.tables.values():
        columns = user_links(table)
        if columns and table.name not in PERSONAL_TABLES and table.name != "activity_logs":
            if table.name.startswith("sharepoint"):
                condition = compliance_links(table, user_id)
                if condition is None:
                    continue
            else:
                condition = or_(*(column == user_id for column in columns))
            queries.append(select(literal(record_label(table.name)).label("label"),
                func.count().label("count")).select_from(table).where(condition))
    rows = (await db.execute(union_all(*queries))).all()
    grouped = {}
    for label, count in rows:
        if count:
            grouped[label] = grouped.get(label, 0) + count
    return [{"label": label, "count": count} for label, count in sorted(grouped.items())]


async def remove_compliance_references(db, user_id, actor=None):
    person = await db.get(User, user_id)
    identity = {"id": str(user_id), "name": person.display_name or person.email}
    rules = (await db.scalars(select(SharePointOwnerRule).where(
        SharePointOwnerRule.owner_user_id == user_id).with_for_update())).all()
    for rule in rules:
        if rule.is_active:
            raise ActiveComplianceWorkError("Active Compliance owner rules must be reassigned before deletion.")
        record(db, user=actor, action="updated", entity_type="sharepoint_owner_rule", entity_id=rule.id,
            summary=f"Retired inactive rule owner {identity['name']} ({user_id}) after account deletion.")
    events = (await db.scalars(select(SharePointComplianceEvent).where(
        SharePointComplianceEvent.actor_id == user_id))).all()
    for item in events:
        item.details = {**(item.details or {}), "deleted_actor": identity}
    tasks = (await db.scalars(select(SharePointComplianceTask).where(
        or_(SharePointComplianceTask.owner_user_id == user_id,
            SharePointComplianceTask.completed_by == user_id)).with_for_update())).all()
    for task in tasks:
        # A legacy task may still be active after its file left the monitored library.
        # Change lifecycle before nulling its owner to satisfy the production constraint.
        if task.owner_user_id == user_id and task.status == "active":
            document = await db.get(SharePointDocument, task.document_id)
            if document and not document.deleted and document.in_scope:
                raise ActiveComplianceWorkError("Active Compliance work must be reassigned before deletion.")
            task.status = "dismissed"
            await db.execute(update(SharePointReminder).where(
                SharePointReminder.task_id == task.id,
                SharePointReminder.status.in_(["pending", "failed"])).values(status="dismissed"))
            await db.execute(update(TaskAssignmentEmail).where(
                TaskAssignmentEmail.compliance_task_id == task.id,
                TaskAssignmentEmail.status.in_(["pending", "failed"])).values(status="cancelled"))
        db.add(SharePointComplianceEvent(document_id=task.document_id, task_id=task.id,
            action="employee_account_deleted", actor_id=actor.id if actor else None, details={"employee": identity}))
    await db.flush()
    for table in Base.metadata.tables.values():
        if not table.name.startswith("sharepoint") or table.name == "sharepoint_connections":
            continue
        for column in user_links(table):
            await db.execute(update(table).where(column == user_id).values({column.name: None}))


async def remove_personal_data(db, user_id, actor=None):
    await remove_compliance_references(db, user_id, actor)
    for table in Base.metadata.tables.values():
        if table.name not in PERSONAL_TABLES and table.name != "activity_logs":
            continue
        for column in user_links(table):
            fk = next(fk for fk in column.foreign_keys if fk.target_fullname == "users.id")
            if fk.ondelete == "CASCADE":
                await db.execute(delete(table).where(column == user_id))
            elif fk.ondelete == "SET NULL":
                await db.execute(update(table).where(column == user_id).values({column.name: None}))
