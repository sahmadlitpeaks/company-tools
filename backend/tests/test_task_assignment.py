import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models.department import Department
from app.models.notification import Notification
from app.models.task_assignment_email import TaskAssignmentEmail
from app.models.user import User
from app.services import task_assignment_email as delivery
from helpers import make_member

@pytest.mark.asyncio
async def test_assignment_email_has_details_and_deep_link(client, auth, monkeypatch):
    sent = []
    monkeypatch.setattr(delivery, "smtp_configured", lambda: True)
    monkeypatch.setattr(delivery, "send_email", lambda **kwargs: sent.append(kwargs) or True)
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://workspace.example.com")
    _, uid = await make_member(client, auth, "task.owner@example.com")
    created = await client.post("/api/tasks", headers=auth, json={
        "title": "Renew <licence>", "description": "Collect renewal documents & submit",
        "due_date": "2027-01-20", "assignee_id": uid})
    assert created.status_code == 201, created.text
    task = created.json()
    assert len(sent) == 1 and sent[0]["to"] == "task.owner@example.com"
    content = sent[0]["html"]
    assert "Renew &lt;licence&gt;" in content and "Collect renewal documents &amp; submit" in content
    assert "20 January 2027" in content
    assert f"https://workspace.example.com/tasks?task={task['id']}" in content
    result = await client.get("/api/tasks", headers=auth)
    assert result.json()[0]["assignment_email_status"] == "sent"
    async with AsyncSessionLocal() as db:
        note = (await db.scalars(select(Notification).where(Notification.user_id == uuid.UUID(uid),
            Notification.category == "task"))).one()
        assert note.link == f"/tasks?task={task['id']}"
        assert (await delivery.run_assignment_emails(db))["sent"] == 0
    assert len(sent) == 1

@pytest.mark.asyncio
async def test_smtp_failure_does_not_lose_task_and_retries(client, auth, monkeypatch):
    monkeypatch.setattr(delivery, "smtp_configured", lambda: True)
    def fail(**kwargs): raise RuntimeError("private SMTP details")
    monkeypatch.setattr(delivery, "send_email", fail)
    _, uid = await make_member(client, auth, "retry.owner@example.com")
    response = await client.post("/api/tasks", headers=auth, json={"title": "Review contract", "assignee_id": uid})
    assert response.status_code == 201, response.text
    async with AsyncSessionLocal() as db:
        row = (await db.scalars(select(TaskAssignmentEmail))).one()
        assert row.status == "pending" and row.attempts == 1
        assert row.last_error == "Email delivery failed"
        row.next_attempt_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        await db.commit()
        monkeypatch.setattr(delivery, "send_email", lambda **kwargs: True)
        assert (await delivery.run_assignment_emails(db))["sent"] == 1
        assert row.status == "sent" and row.last_error is None

@pytest.mark.asyncio
async def test_reassignment_cancels_stale_mail_and_does_not_resend_on_other_edits(client, auth, monkeypatch):
    _, first = await make_member(client, auth, "first.owner@example.com")
    _, second = await make_member(client, auth, "second.owner@example.com")
    response = await client.post("/api/tasks", headers=auth, json={"title": "Send renewal", "assignee_id": first})
    tid = response.json()["id"]
    updated = await client.patch(f"/api/tasks/{tid}", headers=auth, json={"assignee_id": second})
    assert updated.status_code == 200
    await client.patch(f"/api/tasks/{tid}", headers=auth, json={"priority": "high"})
    sent = []
    monkeypatch.setattr(delivery, "smtp_configured", lambda: True)
    monkeypatch.setattr(delivery, "send_email", lambda **kwargs: sent.append(kwargs) or True)
    async with AsyncSessionLocal() as db:
        assert (await delivery.run_assignment_emails(db))["sent"] == 1
        states = (await db.scalars(select(TaskAssignmentEmail))).all()
        assert sorted(row.status for row in states) == ["cancelled", "sent"]
    assert [item["to"] for item in sent] == ["second.owner@example.com"]

@pytest.mark.asyncio
async def test_manager_sees_members_work_and_cannot_change_other_departments(client, auth):
    hm, mid = await make_member(client, auth, "marketing.manager@example.com", role="manager")
    _, own = await make_member(client, auth, "marketing.member@example.com")
    _, other = await make_member(client, auth, "finance.member@example.com")
    async with AsyncSessionLocal() as db:
        departments = {row.name: row.id for row in (await db.scalars(select(Department))).all()}
        for uid, department in [(mid, "Marketing"), (own, "Marketing"), (other, "Finance")]:
            person = await db.get(User, uuid.UUID(uid))
            person.department_id = departments[department]
            person.permissions = ["tasks", "directory"]
        await db.commit()
    mine = (await client.post("/api/tasks", headers=auth, json={"title": "Campaign plan", "assignee_id": own})).json()
    unrelated = (await client.post("/api/tasks", headers=auth, json={"title": "Payroll approval", "assignee_id": other})).json()
    view = await client.get("/api/tasks", headers=hm)
    assert {row["id"] for row in view.json()} == {mine["id"]}
    assert view.json()[0]["assignee_department_name"] == "Marketing"
    assert (await client.get(f"/api/tasks/{unrelated['id']}", headers=hm)).status_code == 403
    assert (await client.patch(f"/api/tasks/{unrelated['id']}", headers=hm, json={"status": "done"})).status_code == 403
    assert (await client.post(f"/api/tasks/{unrelated['id']}/comments", headers=hm, json={"body": "Secret"})).status_code == 403
    assert (await client.get(f"/api/attachments/by/task/{unrelated['id']}", headers=hm)).status_code == 403
    assert (await client.patch(f"/api/tasks/{mine['id']}", headers=hm, json={"status": "in_progress"})).status_code == 200
    assert len((await client.get("/api/tasks", headers=auth)).json()) == 2

@pytest.mark.asyncio
async def test_task_validation_checks_assignee_and_department(client, auth):
    _, uid = await make_member(client, auth, "department.owner@example.com")
    async with AsyncSessionLocal() as db:
        finance = (await db.scalars(select(Department).where(Department.name == "Finance"))).one()
        marketing = (await db.scalars(select(Department).where(Department.name == "Marketing"))).one()
        (await db.get(User, uuid.UUID(uid))).department_id = finance.id
        await db.commit()
        wrong_department = str(marketing.id)
    for body in [{"title": "   "}, {"title": "Task", "assignee_id": str(uuid.uuid4())},
        {"title": "Task", "assignee_id": uid, "department_id": wrong_department}]:
        response = await client.post("/api/tasks", headers=auth, json=body)
        assert response.status_code == 422, response.text
    assert (await client.get("/api/tasks", headers=auth)).json() == []

@pytest.mark.asyncio
async def test_returning_to_previous_owner_only_sends_current_assignment(client, auth, monkeypatch):
    _, first = await make_member(client, auth, "return.first@example.com")
    _, second = await make_member(client, auth, "return.second@example.com")
    response = await client.post("/api/tasks", headers=auth, json={"title": "Current assignment", "assignee_id": first})
    tid = response.json()["id"]
    assert (await client.patch(f"/api/tasks/{tid}", headers=auth, json={"assignee_id": second})).status_code == 200
    assert (await client.patch(f"/api/tasks/{tid}", headers=auth, json={"assignee_id": first})).status_code == 200
    sent = []
    monkeypatch.setattr(delivery, "smtp_configured", lambda: True)
    monkeypatch.setattr(delivery, "send_email", lambda **kwargs: sent.append(kwargs) or True)
    async with AsyncSessionLocal() as db:
        assert (await delivery.run_assignment_emails(db))["sent"] == 1
        states = (await db.scalars(select(TaskAssignmentEmail))).all()
        assert sorted(row.status for row in states) == ["cancelled", "cancelled", "sent"]
    assert [item["to"] for item in sent] == ["return.first@example.com"]
