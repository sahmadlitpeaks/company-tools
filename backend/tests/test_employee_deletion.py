
import uuid
import pytest
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.notification import Notification
from app.models.activity import ActivityLog
from app.models.workplace import Task
from helpers import make_member

@pytest.mark.asyncio
async def test_admin_can_delete_unused_employee_and_invalidate_session(client, auth):
    member, _ = await make_member(client, auth, email="delete@example.com")
    token = member["Authorization"]
    async with AsyncSessionLocal() as db:
        target = await db.scalar(select(User).where(User.email == "delete@example.com"))
        uid = str(target.id)
        target.display_name = "Delete Me"
        db.add(Notification(user_id=target.id, title="Assigned", category="task"))
        await db.commit()
    assert (await client.get(f"/api/users/{uid}/deletion", headers=member)).status_code == 403
    assert (await client.delete(f"/api/users/{uid}", headers=member)).status_code == 403
    status = (await client.get(f"/api/users/{uid}/deletion", headers=auth)).json()
    assert status == {"can_delete": True, "reason": None, "blockers": []}
    assert (await client.delete(f"/api/users/{uid}", headers=auth)).status_code == 204
    assert (await client.get("/api/auth/me", headers={"Authorization": token})).status_code == 401
    async with AsyncSessionLocal() as db:
        assert await db.get(User, uuid.UUID(uid)) is None
        assert not (await db.scalars(select(Notification).where(Notification.user_id == uuid.UUID(uid)))).all()
        audit = (await db.scalars(select(ActivityLog).where(ActivityLog.action == "deleted"))).one()
        assert "Delete Me" in audit.summary and "delete@example.com" in audit.summary

@pytest.mark.asyncio
async def test_delete_blocks_own_synced_and_linked_employees(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert (await client.delete(f"/api/users/{me['id']}", headers=auth)).status_code == 409
    await make_member(client, auth, email="linked@example.com")
    async with AsyncSessionLocal() as db:
        target = await db.scalar(select(User).where(User.email == "linked@example.com"))
        uid = str(target.id)
        target.azure_oid = "external-identity"
        await db.commit()
    assert (await client.delete(f"/api/users/{uid}", headers=auth)).status_code == 409
    async with AsyncSessionLocal() as db:
        target = await db.get(User, uuid.UUID(uid)); target.azure_oid = None
        db.add(Task(title="Keep business history", assignee_id=target.id))
        await db.commit()
    status = (await client.get(f"/api/users/{uid}/deletion", headers=auth)).json()
    assert not status["can_delete"] and status["blockers"] == [{"label": "Tasks and projects", "count": 1}]
    assert (await client.delete(f"/api/users/{uid}", headers=auth)).status_code == 409
    async with AsyncSessionLocal() as db:
        assert await db.get(User, uuid.UUID(uid))
        assert (await db.scalars(select(Task))).one().title == "Keep business history"

@pytest.mark.asyncio
async def test_correct_account_email_keeps_id_and_rejects_duplicates(client, auth):
    await make_member(client, auth, email="mistyped@example.com")
    people = (await client.get("/api/users", headers=auth)).json()
    uid = next(p["id"] for p in people if p["email"] == "mistyped@example.com")
    result = await client.patch(f"/api/users/{uid}", headers=auth, json={"email": "  Correct@Example.com "})
    assert result.status_code == 200 and result.json()["id"] == uid and result.json()["email"] == "correct@example.com"
    assert (await client.patch(f"/api/users/{uid}", headers=auth, json={"email": "ADMIN@agholding.net"})).status_code == 409
    assert (await client.patch(f"/api/users/{uid}", headers=auth, json={"email": "bad"})).status_code == 422


@pytest.mark.asyncio
async def test_access_changes_do_not_require_email_for_legacy_profiles(client, auth):
    async with AsyncSessionLocal() as db:
        target = User(display_name="Imported employee", status="active", role="member")
        db.add(target); await db.commit(); uid=str(target.id)
    result = await client.patch(f"/api/users/{uid}", headers=auth, json={"permissions": ["tasks"]})
    assert result.status_code == 200
    assert "tasks" in result.json()["effective_permissions"]
    assert result.json()["email"] is None
