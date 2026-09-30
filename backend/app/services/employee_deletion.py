"""Delete unused local employees without cascading away business history."""
from sqlalchemy import delete, func, literal, or_, select, union_all, update
from app.core.database import Base

PERSONAL_TABLES = {
    "notifications", "dashboard_preferences", "workspace_items", "saved_views",
    "email_signatures", "user_companies", "sharepoint_connections", "task_assignment_emails",
}


def user_links(table):
    return [column for column in table.c if any(
        fk.target_fullname == "users.id" for fk in column.foreign_keys)]


def record_label(name):
    if name == "users":
        return "Direct reports"
    if name.startswith("sharepoint"):
        return "Compliance records and owner rules"
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
            condition = or_(*(column == user_id for column in columns))
            queries.append(select(literal(record_label(table.name)).label("label"),
                func.count().label("count")).select_from(table).where(condition))
    rows = (await db.execute(union_all(*queries))).all()
    grouped = {}
    for label, count in rows:
        if count:
            grouped[label] = grouped.get(label, 0) + count
    return [{"label": label, "count": count} for label, count in sorted(grouped.items())]


async def remove_personal_data(db, user_id):
    for table in Base.metadata.tables.values():
        if table.name not in PERSONAL_TABLES and table.name != "activity_logs":
            continue
        for column in user_links(table):
            fk = next(fk for fk in column.foreign_keys if fk.target_fullname == "users.id")
            if fk.ondelete == "CASCADE":
                await db.execute(delete(table).where(column == user_id))
            elif fk.ondelete == "SET NULL":
                await db.execute(update(table).where(column == user_id).values({column.name: None}))
