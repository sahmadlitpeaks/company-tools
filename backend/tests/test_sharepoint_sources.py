"""Multiple sources, authorization and upload delivery; no live Graph/Teams/AI calls."""
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.sharepoint import SharePointDocument, SharePointRun, SharePointSource, SharePointUploadDelivery
from app.services.sharepoint import graph, uploads, worker
from app.services.sharepoint.common import SharePointError, decrypt, digest, encrypt, now
from app.services.sharepoint.store import enqueue, sources_for
from helpers import make_member
from test_sharepoint import configured, indexed, metadata, FakeGraph, run_sync, TENANT

WEBHOOK = "https://example.logic.azure.com/workflows/test/triggers/manual/paths/invoke?sig=not-a-real-secret"
PAYLOAD = {"name": "Finance", "site_id": "site-two", "drive_id": "drive-two", "folder_id": "folder-two"}


@pytest.fixture
def fake_sources(monkeypatch):
    async def token():
        return "fake-token"
    async def verify(self, source):
        if source.site_id == "denied":
            raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr("app.api.sharepoint_sources.application_token", token)
    monkeypatch.setattr(graph.GraphClient, "verify_source", verify)


@pytest.mark.asyncio
async def test_source_management_preserves_original_and_encrypts_destination(client, auth, indexed, fake_sources):
    original = (await client.get("/api/sharepoint/sources", headers=auth)).json()
    assert len(original) == 1 and original[0]["id"] == str(indexed[1])
    payload = {**PAYLOAD, "teams_notify_uploads": True, "teams_channel_name": "Finance uploads", "teams_webhook_url": WEBHOOK}
    added = await client.post("/api/sharepoint/sources", headers=auth, json=payload)
    assert added.status_code == 201, added.text
    result = added.json()
    assert result["teams_webhook_configured"] and not result["baseline_completed"]
    assert "teams_webhook_url" not in result and "sig=" not in added.text
    async with AsyncSessionLocal() as db:
        saved = await db.get(SharePointSource, uuid.UUID(result["id"]))
        assert WEBHOOK not in saved.teams_webhook_cipher
        assert decrypt(saved.teams_webhook_cipher) == WEBHOOK
        assert saved.notify_after
        assert await db.get(SharePointDocument, indexed[2])
    duplicate = await client.post("/api/sharepoint/sources", headers=auth, json=payload)
    assert duplicate.status_code == 409 and duplicate.json()["detail"] == "source_already_exists"
    edited = await client.put(f"/api/sharepoint/sources/{result['id']}", headers=auth,
                             json={**PAYLOAD, "name": "Finance renamed", "teams_notify_uploads": True, "teams_channel_name": "Finance uploads"})
    assert edited.status_code == 200 and edited.json()["teams_webhook_configured"]
    paused = await client.put(f"/api/sharepoint/sources/{result['id']}", headers=auth, json={**PAYLOAD, "enabled": False})
    assert paused.status_code == 200 and not paused.json()["enabled"]
    assert (await client.post(f"/api/sharepoint/sources/{result['id']}/sync", headers=auth)).status_code == 409
    assert len((await client.get("/api/sharepoint/sources", headers=auth)).json()) == 2


@pytest.mark.asyncio
async def test_source_validation_and_admin_gate(client, auth, indexed, fake_sources):
    for payload, code in [
        ({**PAYLOAD, "site_id": "denied"}, "document_access_denied"),
        ({**PAYLOAD, "teams_notify_uploads": True}, "teams_destination_required"),
        ({**PAYLOAD, "teams_webhook_url": "https://127.0.0.1/internal"}, "invalid_teams_webhook"),
        ({**PAYLOAD, "teams_webhook_url": "https://example.logic.azure.com:8080/test"}, "invalid_teams_webhook"),
    ]:
        response = await client.post("/api/sharepoint/sources", headers=auth, json=payload)
        assert response.status_code in (403, 422) and response.json()["detail"] == code
    assert (await client.post("/api/sharepoint/sources", headers=auth, json={**PAYLOAD, "site_id": "../secret"})).status_code == 422
    member, _ = await make_member(client, auth)
    for method, path, body in [("GET", "/api/sharepoint/sources", None), ("POST", "/api/sharepoint/sources", PAYLOAD),
                              ("PUT", f"/api/sharepoint/sources/{indexed[1]}", PAYLOAD),
                              ("POST", f"/api/sharepoint/sources/{indexed[1]}/sync", None)]:
        response = await client.request(method, path, headers=member, **({"json": body} if body else {}))
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_database_sources_work_without_environment_location(client, auth, configured, fake_sources, monkeypatch):
    for field in ("SHAREPOINT_SITE_ID", "SHAREPOINT_DRIVE_ID", "SHAREPOINT_FOLDER_ID"):
        monkeypatch.setattr(settings, field, "")
    status = (await client.get("/api/sharepoint/status", headers=auth)).json()
    assert status["configured"] and status["last_sync"] is None
    assert (await client.get("/api/sharepoint/sources", headers=auth)).json() == []
    assert (await client.post("/api/sharepoint/sources", headers=auth, json=PAYLOAD)).status_code == 201
    assert len((await client.get("/api/sharepoint/sources", headers=auth)).json()) == 1


async def second_source():
    async with AsyncSessionLocal() as db:
        source = SharePointSource(name="Operations", scope_key=digest([TENANT, "site-two", "drive-two", "folder-two"]),
            tenant_id=TENANT, site_id="site-two", drive_id="drive-two", folder_id="folder-two")
        db.add(source)
        await db.flush()
        doc = SharePointDocument(source_id=source.id, item_id="two", filename="Operations contract.txt",
            parent_id="folder-two", in_scope=True, version="v1", status="ready")
        db.add(doc)
        await db.commit()
        return source.id, doc.id


@pytest.mark.asyncio
async def test_documents_compliance_assistant_and_details_use_each_source(client, auth, indexed, monkeypatch):
    from app.services.sharepoint.chat import ask_central
    from app.models.user import User
    source_id, doc_id = await second_source()
    async def permitted(self, drive, item):
        return metadata(item=item, name="Operations contract.txt" if drive == "drive-two" else "Original contract.txt",
                        parentReference={"driveId": drive, "id": "folder-two" if drive == "drive-two" else "folder"})
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    monkeypatch.setattr(settings, "SHAREPOINT_OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    listed = await client.post("/api/sharepoint/search", headers=auth, json={})
    assert {item["source_id"] for item in listed.json()["items"]} == {str(indexed[1]), str(source_id)}
    filtered = await client.post("/api/sharepoint/search", headers=auth, json={"source_id": str(source_id)})
    assert [item["id"] for item in filtered.json()["items"]] == [str(doc_id)]
    detail = await client.get(f"/api/sharepoint/documents/{doc_id}", headers=auth)
    assert detail.status_code == 200 and detail.json()["source_id"] == str(source_id)
    dashboard = (await client.get("/api/sharepoint/compliance/dashboard", headers=auth)).json()
    assert {doc["source_id"] for doc in dashboard["documents"]} == {str(indexed[1]), str(source_id)}
    filtered_dashboard = (await client.get("/api/sharepoint/compliance/dashboard", headers=auth,
                                         params={"source_id": str(source_id)})).json()
    assert [doc["id"] for doc in filtered_dashboard["documents"]] == [str(doc_id)]
    async with AsyncSessionLocal() as db:
        answer = await ask_central(db, await db.get(User, indexed[0]), [{"role": "user", "content": "Summarize the contracts"}])
        assert {citation["document_id"] for citation in answer["citations"]} == {str(indexed[2]), str(doc_id)}
    async def denied(self, drive, item):
        if drive == "drive-two":
            raise SharePointError("document_access_denied", 403)
        return await permitted(self, drive, item)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)
    listed = (await client.post("/api/sharepoint/search", headers=auth, json={})).json()
    assert [item["id"] for item in listed["items"]] == [str(indexed[2])]
    assert (await client.get(f"/api/sharepoint/documents/{doc_id}", headers=auth)).status_code == 403


@pytest.mark.asyncio
async def test_source_scope_cannot_repoint_indexed_documents(client, auth, indexed, fake_sources):
    response = await client.put(f"/api/sharepoint/sources/{indexed[1]}", headers=auth,
        json={"name": "Original", "site_id": "site", "drive_id": "drive", "folder_id": "another-folder"})
    assert response.status_code == 409 and response.json()["detail"] == "source_scope_locked"
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.tenant_id = str(uuid.uuid4())
        await db.commit()
    # A caller-supplied source ID never changes the configured tenant boundary.
    response = await client.post("/api/sharepoint/search", headers=auth, json={"source_id": str(indexed[1])})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_source_failure_does_not_block_second_sync(client, auth, indexed, monkeypatch):
    second_id, _ = await second_source()
    async def token():
        return "fake-token"
    class FailingGraph(FakeGraph):
        async def verify_source(self, source):
            if source.id == indexed[1]:
                raise SharePointError("document_access_denied", 403)
        async def get(self, path, **kwargs):
            return {"value": [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive-two/root/delta"}
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: FailingGraph())
    assert (await client.post("/api/sharepoint/sync", headers=auth)).status_code == 202
    first = await worker.claim()
    await worker.execute(*first)
    second = await worker.claim()
    assert second and second[0] != first[0]
    await worker.execute(*second)
    async with AsyncSessionLocal() as db:
        runs = (await db.scalars(select(SharePointRun))).all()
        assert len(runs) == 2
        assert {run.status for run in runs} == {"failed", "completed"}
        assert (await db.get(SharePointSource, second_id)).baseline_completed_at


@pytest.mark.asyncio
async def test_upload_baseline_new_files_updates_moves_and_failed_ai(indexed, monkeypatch):
    fake = FakeGraph()
    async def token():
        return "fake-token"
    async def failed_ai(*args):
        raise SharePointError("analysis_provider_error", 502)
    async def preprocess(*args):
        return [{"id": "s1", "location": "Text", "text": "Document"}], {}, []
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "preprocess", preprocess)
    monkeypatch.setattr(worker, "analyze", failed_ai)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.teams_notify_uploads, source.teams_webhook_cipher = True, encrypt(WEBHOOK)
        source.teams_channel_name = "Uploads"
        await db.commit()
    fake.values = [metadata(item="historical", createdDateTime=(now() - timedelta(days=2)).isoformat())]
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        assert (await db.get(SharePointSource, indexed[1])).baseline_completed_at
        assert not (await db.scalars(select(SharePointUploadDelivery))).all()
    fake.values = [
        metadata(item="new", createdDateTime=(now() + timedelta(seconds=1)).isoformat()),
        metadata(item="moved-old", createdDateTime=(now() - timedelta(days=1)).isoformat()),
        metadata(item="outside", parent="other-folder", createdDateTime=(now() + timedelta(seconds=1)).isoformat()),
    ]
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        rows = (await db.scalars(select(SharePointUploadDelivery))).all()
        assert len(rows) == 1
        doc = await db.get(SharePointDocument, rows[0].document_id)
        assert doc.item_id == "new" and doc.status == "failed"
    # Neither the next sync nor an eTag change should announce the same upload again.
    fake.values = [metadata(item="new", version="v2", createdDateTime=(now() + timedelta(seconds=1)).isoformat())]
    fake.version = "v2"
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        assert len((await db.scalars(select(SharePointUploadDelivery))).all()) == 1


@pytest.mark.asyncio
async def test_delivery_retry_success_and_confirmed_duplicate_prevention(indexed, monkeypatch):
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.teams_notify_uploads = True
        source.teams_webhook_cipher = encrypt(WEBHOOK)
        delivery = SharePointUploadDelivery(source_id=source.id, document_id=indexed[2],
                                            notification_version=source.notification_version)
        db.add(delivery)
        await db.commit()
        delivery_id = delivery.id
    async def token():
        return "fake-token"
    fake = FakeGraph()
    sent = []
    monkeypatch.setattr(uploads, "application_token", token)
    monkeypatch.setattr(uploads, "GraphClient", lambda token: fake)
    monkeypatch.setattr(uploads, "send_teams", lambda *args, **kwargs: sent.append((args, kwargs)) or False)
    await uploads.deliver_uploads()
    await uploads.deliver_uploads()
    assert len(sent) == 1
    async with AsyncSessionLocal() as db:
        delivery = await db.get(SharePointUploadDelivery, delivery_id)
        assert delivery.status == "failed" and delivery.attempts == 1 and delivery.next_attempt_at
        delivery.next_attempt_at = now() - timedelta(seconds=1)
        await db.commit()
    monkeypatch.setattr(uploads, "send_teams", lambda *args, **kwargs: sent.append((args, kwargs)) or True)
    await uploads.deliver_uploads()
    await uploads.deliver_uploads()
    assert len(sent) == 2
    args, kwargs = sent[-1]
    assert args[0].startswith("New file uploaded:") and args[1] == "Source: SharePoint source"
    assert args[2] == "https://example.sharepoint.com/test"
    assert kwargs["webhook_url"] == WEBHOOK
    assert "PERSON_1" not in str(args) and "Alice" not in str(args)
    async with AsyncSessionLocal() as db:
        delivery = await db.get(SharePointUploadDelivery, delivery_id)
        assert delivery.status == "sent" and delivery.sent_at and delivery.last_error is None


@pytest.mark.asyncio
async def test_notifications_pause_disable_destination_change_and_deletion(indexed, monkeypatch):
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.enabled, source.teams_notify_uploads = False, True
        source.teams_webhook_cipher = encrypt(WEBHOOK)
        delivery = SharePointUploadDelivery(source_id=source.id, document_id=indexed[2],
                                            notification_version=source.notification_version)
        db.add(delivery)
        await db.commit()
        delivery_id = delivery.id
    async def token():
        return "fake-token"
    monkeypatch.setattr(uploads, "application_token", token)
    monkeypatch.setattr(uploads, "GraphClient", lambda token: FakeGraph())
    sent = []
    monkeypatch.setattr(uploads, "send_teams", lambda *args, **kwargs: sent.append(args) or True)
    await uploads.deliver_uploads()
    assert sent == []
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.enabled = True
        source.notification_version += 1
        await db.commit()
    await uploads.deliver_uploads()
    assert sent == []
    async with AsyncSessionLocal() as db:
        delivery = await db.get(SharePointUploadDelivery, delivery_id)
        assert delivery.status == "skipped"
        delivery.status, delivery.notification_version = "pending", (await db.get(SharePointSource, indexed[1])).notification_version
        (await db.get(SharePointDocument, indexed[2])).deleted = True
        await db.commit()
    await uploads.deliver_uploads()
    assert sent == []
    async with AsyncSessionLocal() as db:
        assert (await db.get(SharePointUploadDelivery, delivery_id)).status == "skipped"


def test_workflow_sender_makes_one_attempt_without_fallback_or_redirect(monkeypatch):
    from app.services.dispatch import send_teams
    calls = []
    class Transport:
        def open(self, request, **kwargs):
            calls.append(request)
            raise TimeoutError()
    monkeypatch.setattr("urllib.request.build_opener", lambda *args: Transport())
    assert not send_teams("Upload", "Source", "https://example.sharepoint.com/file", webhook_url=WEBHOOK)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_historical_sources_remain_dormant_and_environment_source_is_imported(indexed):
    second_id, second_doc_id = await second_source()
    async with AsyncSessionLocal() as db:
        (await db.get(SharePointSource, indexed[1])).registered = False
        (await db.get(SharePointSource, second_id)).registered = False
        await db.commit()
    async with AsyncSessionLocal() as db:
        assert [source.id for source in await sources_for(db)] == [indexed[1]]
        with pytest.raises(SharePointError, match="source_not_found"):
            await sources_for(db, second_id)
        assert await db.get(SharePointDocument, second_doc_id)
        await db.commit()


@pytest.mark.asyncio
async def test_second_source_tasks_reminders_and_employee_workspace_scope(client, auth, indexed, monkeypatch):
    from app.models.user import User
    from app.models.sharepoint import SharePointComplianceTask, SharePointConnection, SharePointReminder
    from test_sharepoint import CLIENT
    source_id, doc_id = await second_source()
    member, member_id = await make_member(client, auth, email="second-source@example.com")
    async with AsyncSessionLocal() as db:
        user = await db.get(User, uuid.UUID(member_id))
        user.permissions = ["sharepoint_intelligence", "tasks"]
        db.add(SharePointConnection(user_id=user.id, tenant_id=TENANT, client_id=CLIENT,
            object_id=str(uuid.uuid4()), token_cipher=encrypt({"access_token": "fake", "refresh_token": "fake", "expires_at": 9999999999})))
        task = SharePointComplianceTask(source_id=source_id, document_id=doc_id, action_key="two-task",
            title="Second source renewal", due_date=date(2027, 1, 1), basis="expiry", assignment_source="manual", owner_user_id=user.id)
        reminder = SharePointReminder(source_id=source_id, document_id=doc_id,
            title="Second source reminder", target_date="2027-01-01", reminder_date="2026-12-01",
            dedup_key="two-reminder", recipient_email=user.email)
        db.add_all([task, reminder])
        await db.commit()
        task_id, reminder_id = task.id, reminder.id
    async def permitted(self, drive, item):
        return metadata(item=item, parentReference={"driveId": drive, "id": "folder-two" if drive=="drive-two" else "folder"})
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    visible = (await client.post("/api/sharepoint/search", headers=member, json={})).json()
    assert [doc["id"] for doc in visible["items"]] == [str(doc_id)]
    assert (await client.get(f"/api/sharepoint/documents/{indexed[2]}", headers=member)).status_code == 404
    options = (await client.get("/api/sharepoint/source-options", headers=member)).json()
    assert options == [{"id": str(source_id), "name": "Operations"}]
    board = (await client.get("/api/tasks/compliance", headers=member)).json()
    assert board["tasks"][0]["document_id"] == str(doc_id)
    assert board["tasks"][0]["access_state"] == "ready"
    progress = await client.patch(f"/api/sharepoint/compliance/tasks/{task_id}/progress", headers=member, json={"status": "in_progress"})
    assert progress.status_code == 200, progress.text
    reminders = (await client.get("/api/sharepoint/reminders", headers=member)).json()
    assert [row["id"] for row in reminders] == [str(reminder_id)]
    completed = await client.post(f"/api/sharepoint/reminders/{reminder_id}/complete", headers=member)
    assert completed.status_code == 200, completed.text
    # Live Graph access is still required even for a workspace assignment.
    async def denied(*args):
        raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)
    assert (await client.get("/api/sharepoint/source-options", headers=member)).json() == []
    assert (await client.post("/api/sharepoint/search", headers=member, json={})).json()["items"] == []
    board = (await client.get("/api/tasks/compliance", headers=member)).json()
    assert board["tasks"][0]["title"] == "Document task assigned"
    assert "document_id" not in board["tasks"][0]


@pytest.mark.asyncio
async def test_cursor_is_bound_to_source_selection(client, auth, indexed, monkeypatch):
    source_id, _ = await second_source()
    async with AsyncSessionLocal() as db:
        for number in range(21):
            db.add(SharePointDocument(source_id=source_id, item_id=f"page-{number}",
                parent_id="folder-two", in_scope=True, version="v1", status="ready"))
        await db.commit()
    async def permitted(self, drive, item):
        return metadata(item=item, parentReference={"driveId": drive, "id": "folder-two" if drive=="drive-two" else "folder"})
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    first = (await client.post("/api/sharepoint/search", headers=auth, json={})).json()
    assert len(first["items"]) == 20 and first["next_cursor"]
    invalid = await client.post("/api/sharepoint/search", headers=auth,
        json={"source_id": str(source_id), "cursor": first["next_cursor"]})
    assert invalid.status_code == 400 and invalid.json()["detail"] == "invalid_search_cursor"
    second = (await client.post("/api/sharepoint/search", headers=auth, json={"cursor": first["next_cursor"]})).json()
    assert len(second["items"]) == 3
    assert not {doc["id"] for doc in first["items"]}.intersection(doc["id"] for doc in second["items"])


@pytest.mark.asyncio
async def test_delivery_claim_rechecks_backoff_after_candidate_selection(indexed, monkeypatch):
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.teams_notify_uploads, source.teams_webhook_cipher = True, encrypt(WEBHOOK)
        row = SharePointUploadDelivery(source_id=source.id, document_id=indexed[2], notification_version=1)
        db.add(row)
        await db.commit()
        row_id = row.id
    # Another worker failed and scheduled a retry after this worker selected its candidates.
    async def token():
        async with AsyncSessionLocal() as db:
            row = await db.get(SharePointUploadDelivery, row_id)
            row.status, row.next_attempt_at = "failed", now()+timedelta(minutes=1)
            await db.commit()
        return "fake"
    sent = []
    monkeypatch.setattr(uploads, "application_token", token)
    monkeypatch.setattr(uploads, "GraphClient", lambda token: FakeGraph())
    monkeypatch.setattr(uploads, "send_teams", lambda *args, **kwargs: sent.append(args) or True)
    await uploads.deliver_uploads()
    assert sent == []


def test_upload_requires_enabled_notifications_and_new_creation_time():
    from types import SimpleNamespace
    source = SimpleNamespace(baseline_completed_at=now()-timedelta(days=1), notify_after=now(), teams_notify_uploads=True)
    assert not uploads.new_upload(source, {})
    assert not uploads.new_upload(source, {"createdDateTime": "invalid"})
    assert not uploads.new_upload(source, {"createdDateTime": (now()-timedelta(hours=1)).isoformat()})
    assert uploads.new_upload(source, {"createdDateTime": (now()+timedelta(seconds=1)).isoformat()})
    source.teams_notify_uploads = False
    assert not uploads.new_upload(source, {"createdDateTime": (now()+timedelta(seconds=1)).isoformat()})


@pytest.mark.asyncio
async def test_enqueue_handles_source_paused_after_it_was_read(indexed):
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        await db.execute(update(SharePointSource).where(SharePointSource.id==source.id)
            .execution_options(synchronize_session=False).values(enabled=False))
        with pytest.raises(SharePointError, match="source_paused"):
            await enqueue(db, source)


@pytest.mark.asyncio
async def test_paginated_discovery_retains_upload_candidate_across_retry(indexed, monkeypatch):
    second_link = "https://graph.microsoft.com/v1.0/drives/drive/root/delta?next=two"
    class Pages(FakeGraph):
        failed = False
        async def get(self, path, **kwargs):
            if path.startswith("/sites/"):
                return await super().get(path, **kwargs)
            if path==second_link:
                if not self.failed:
                    self.failed=True
                    raise SharePointError("graph_unavailable", 503)
                return {"value": [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive/root/delta?done=two"}
            return {"value": [metadata(item="paged-new", createdDateTime=(now()+timedelta(seconds=1)).isoformat())], "@odata.nextLink": second_link}
    fake = Pages()
    async def token(): return "fake"
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    async def no_ai(*args): raise SharePointError("unsupported_type", 422)
    monkeypatch.setattr(worker, "preprocess", no_ai)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.baseline_completed_at = now()-timedelta(minutes=1)
        source.teams_notify_uploads, source.teams_webhook_cipher = True, encrypt(WEBHOOK)
        await db.commit()
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        assert (await db.get(SharePointSource, indexed[1])).next_link == second_link
        assert not (await db.scalars(select(SharePointUploadDelivery))).all()
        doc = (await db.scalars(select(SharePointDocument).where(SharePointDocument.item_id=="paged-new"))).one()
        assert doc.upload_notification_pending
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        rows = (await db.scalars(select(SharePointUploadDelivery))).all()
        assert len(rows)==1
        assert (await db.get(SharePointDocument, rows[0].document_id)).item_id=="paged-new"


def test_teams_upload_payload_is_one_minimal_adaptive_card(monkeypatch):
    import json
    from app.services.dispatch import send_teams
    requests = []
    handlers = []
    class Response:
        status = 202
        def __enter__(self): return self
        def __exit__(self, *args): pass
    class Transport:
        def open(self, request, **kwargs):
            requests.append(request)
            return Response()
    def transport(*args):
        handlers.extend(args)
        return Transport()
    monkeypatch.setattr("urllib.request.build_opener", transport)
    assert send_teams("New file uploaded: Contract.txt", "Source: Finance", "https://example.sharepoint.com/file", webhook_url=WEBHOOK)
    assert len(requests)==1 and requests[0].full_url==WEBHOOK
    payload=json.loads(requests[0].data)
    assert payload["type"]=="message" and len(payload["attachments"])==1
    card=payload["attachments"][0]["content"]
    assert card["type"]=="AdaptiveCard"
    assert [item["text"] for item in card["body"]]==["New file uploaded: Contract.txt", "Source: Finance"]
    assert card["actions"][0]["url"]=="https://example.sharepoint.com/file"
    assert WEBHOOK not in str(payload) and "replyToId" not in payload
    assert handlers[0].redirect_request(None,None,302,"",{},"https://attacker.example")==None


@pytest.mark.asyncio
async def test_admin_can_reconnect_dormant_source_with_verified_scope(client, auth, indexed, fake_sources):
    source_id, doc_id = await second_source()
    async with AsyncSessionLocal() as db:
        (await db.get(SharePointSource, source_id)).registered = False
        await db.commit()
    added = await client.post("/api/sharepoint/sources", headers=auth, json=PAYLOAD)
    assert added.status_code == 201, added.text
    assert added.json()["id"] == str(source_id)
    async with AsyncSessionLocal() as db:
        assert (await db.get(SharePointSource, source_id)).registered
        assert await db.get(SharePointDocument, doc_id)


@pytest.mark.asyncio
async def test_reconnect_closes_abandoned_run_but_preserves_live_lease(client, auth, indexed, fake_sources):
    source_id, _ = await second_source()
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, source_id)
        run = SharePointRun(source_id=source_id, status="running")
        db.add(run)
        await db.flush()
        source.registered, source.active_run_id = False, str(run.id)
        source.lease_owner, source.lease_until = "old-owner", now()+timedelta(minutes=1)
        await db.commit()
        run_id = run.id
    assert (await client.post("/api/sharepoint/sources", headers=auth, json=PAYLOAD)).status_code == 409
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, source_id)
        source.lease_until = now()-timedelta(minutes=1)
        await db.commit()
    added = await client.post("/api/sharepoint/sources", headers=auth, json=PAYLOAD)
    assert added.status_code == 201, added.text
    async with AsyncSessionLocal() as db:
        assert (await db.get(SharePointRun, run_id)).error_code == "source_reconnected"
        assert (await db.get(SharePointSource, source_id)).active_run_id is None
