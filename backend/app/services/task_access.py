"""Task oversight follows the manager's department and direct reports."""
from sqlalchemy import or_, select
from app.models.user import User

async def team_ids(db, user):
    ids = {user.id}
    if user.role == "manager":
        clauses = [User.manager_id == user.id]
        if user.department_id:
            clauses.append(User.department_id == user.department_id)
        ids.update((await db.scalars(select(User.id).where(or_(*clauses)))).all())
    return ids

async def can_access_task(db, user, task):
    if user.is_admin or user.id in {task.assignee_id, task.created_by_id}:
        return True
    if user.role != "manager":
        return False
    ids = await team_ids(db, user)
    return task.assignee_id in ids or task.created_by_id in ids
