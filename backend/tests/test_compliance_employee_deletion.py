"""Account removal retains Compliance history while protecting active responsibility."""
import uuid
from datetime import date
import pytest
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.sharepoint import (SharePointSource, SharePointDocument, SharePointRun,
    SharePointComplianceEvent, SharePointComplianceTask, SharePointOwnerRule, SharePointReminder)
from helpers import make_member

async def records(uid, *, active=False, deleted=False):
    async with AsyncSessionLocal() as db:
        source = SharePointSource(scope_key="delete-test", tenant_id="tenant", site_id="site", drive_id="drive", folder_id="root")
        db.add(source); await db.flush()
        doc = SharePointDocument(source_id=source.id, item_id="file", in_scope=not deleted, deleted=deleted,
            approved_by=uuid.UUID(uid), reviewed_by=uuid.UUID(uid))
        db.add(doc); await db.flush()
        task = SharePointComplianceTask(source_id=source.id, document_id=doc.id, action_key="renew",
            title="Renew licence", due_date=date(2027,1,20), basis="expiry", assignment_source="manual",
            status="active" if active else "completed", owner_user_id=uuid.UUID(uid), completed_by=uuid.UUID(uid) if not active else None)
        db.add(task); await db.flush()
        db.add(SharePointRun(source_id=source.id, requested_by=uuid.UUID(uid), status="finished"))
        db.add(SharePointComplianceEvent(document_id=doc.id, task_id=task.id, actor_id=uuid.UUID(uid), action="reviewed", details={"note":"Verified licence"}))
        db.add(SharePointOwnerRule(owner_user_id=uuid.UUID(uid), document_type="trade_license", is_active=False))
        db.add(SharePointReminder(source_id=source.id, document_id=doc.id, task_id=task.id, title="Renew",
            target_date="2027-01-20", reminder_date="2026-12-21", dedup_key="delete-test"))
        await db.commit()
        return doc.id, task.id

@pytest.mark.asyncio
async def test_historical_compliance_links_allow_deletion_and_preserve_audit(client,auth):
    _, uid = await make_member(client,auth,"history@example.com")
    did, tid = await records(uid)
    assert (await client.get(f"/api/users/{uid}/deletion",headers=auth)).json()["can_delete"]
    assert (await client.delete(f"/api/users/{uid}",headers=auth)).status_code == 204
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument,did)
        task = await db.get(SharePointComplianceTask,tid)
        assert doc.approved_by is None and doc.reviewed_by is None
        assert task.status == "completed" and task.owner_user_id is None and task.completed_by is None
        old = await db.scalar(select(SharePointComplianceEvent).where(SharePointComplianceEvent.action=="reviewed"))
        assert old.actor_id is None and old.details["note"]=="Verified licence"
        assert old.details["deleted_actor"]["id"]==uid
        assert (await db.scalar(select(SharePointRun))).requested_by is None
        rule = await db.scalar(select(SharePointOwnerRule))
        assert not rule.is_active and rule.owner_user_id is None

@pytest.mark.asyncio
async def test_active_compliance_task_and_rule_block_but_reviews_do_not(client,auth):
    _, uid = await make_member(client,auth,"active-work@example.com")
    await records(uid,active=True)
    async with AsyncSessionLocal() as db:
        db.add(SharePointOwnerRule(owner_user_id=uuid.UUID(uid),document_type="contract",is_active=True))
        await db.commit()
    status = (await client.get(f"/api/users/{uid}/deletion",headers=auth)).json()
    assert status["blockers"] == [{"label":"Active Compliance owner rules","count":1},{"label":"Active Compliance tasks","count":1}]
    assert (await client.delete(f"/api/users/{uid}",headers=auth)).status_code == 409
    async with AsyncSessionLocal() as db:
        assert await db.get(User,uuid.UUID(uid))

@pytest.mark.asyncio
async def test_legacy_active_task_for_deleted_document_is_retired_before_deletion(client,auth):
    _, uid = await make_member(client,auth,"deleted-file@example.com")
    _, tid = await records(uid,active=True,deleted=True)
    assert (await client.get(f"/api/users/{uid}/deletion",headers=auth)).json()["can_delete"]
    assert (await client.delete(f"/api/users/{uid}",headers=auth)).status_code == 204
    async with AsyncSessionLocal() as db:
        task = await db.get(SharePointComplianceTask,tid)
        assert task.status == "dismissed" and task.owner_user_id is None
        assert (await db.scalar(select(SharePointReminder))).status=="dismissed"
