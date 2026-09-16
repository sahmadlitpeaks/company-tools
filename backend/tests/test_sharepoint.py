"""Privacy, permission and replay regression tests; all external services are fake."""
import io
import time
import uuid
import zipfile
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.sharepoint import SharePointConnection, SharePointDocument, SharePointSource
from app.models.user import User
from app.schemas.sharepoint import DocumentAnalysis
from app.services.sharepoint import analysis, graph, privacy, worker
from app.services.sharepoint.common import SharePointError, decrypt, encrypt, now
from app.services.sharepoint.store import enqueue, source_for

TENANT = "11111111-1111-4111-8111-111111111111"
CLIENT = "22222222-2222-4222-8222-222222222222"
OID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def configured(monkeypatch):
    for key, value in {"SHAREPOINT_ENABLED": True, "SHAREPOINT_TENANT_ID": TENANT,
        "SHAREPOINT_CLIENT_ID": CLIENT, "SHAREPOINT_CLIENT_SECRET": "fake-client-secret",
        "SHAREPOINT_SITE_ID": "site", "SHAREPOINT_DRIVE_ID": "drive", "SHAREPOINT_FOLDER_ID": "folder",
        "SHAREPOINT_ENCRYPTION_KEY": Fernet.generate_key().decode(), "SHAREPOINT_OPENAI_API_KEY": "fake-openai",
        "SHAREPOINT_OPENAI_MODEL": "test-model", "SHAREPOINT_REVIEWER_IDS": "", "SHAREPOINT_POLLING_ENABLED": False}.items():
        monkeypatch.setattr(settings, key, value)


def metadata(item="one", version="v1", parent="folder", **extra):
    return {"id": item, "eTag": version, "name": "Private client.txt", "file": {"mimeType": "text/plain"},
        "size": 30, "webUrl": "https://example.sharepoint.com/test", "parentReference": {"id": parent, "driveId": "drive"}, **extra}


def analyzed(segments):
    return {"sections": [{"summary": "Review is needed.", "summary_evidence": [{"segment_id": segments[0]["id"], "quote": segments[0]["text"]}],
        "tasks": [], "deadlines": [], "risks": [], "blockers": [], "contacts": [], "project_status": None, "requires_attention": False}], "requires_attention": False}


@pytest_asyncio.fixture
async def indexed(auth, configured):
    async with AsyncSessionLocal() as db:
        user = (await db.scalars(select(User).where(User.email == "admin@agholding.net"))).one()
        user.azure_oid = OID
        db.add(SharePointConnection(user_id=user.id, tenant_id=TENANT, client_id=CLIENT, object_id=OID,
            token_cipher=encrypt({"access_token": "delegated-token", "refresh_token": "refresh", "expires_at": time.time() + 3600})))
        source = await source_for(db)
        segments = [{"id": "s1", "location": "Text", "text": "[PERSON_1] must review the proposal by 2026-10-02."}]
        doc = SharePointDocument(source_id=source.id, item_id="one", parent_id="folder", in_scope=True,
            version="v1", filename="Private client.txt", status="ready", segments=segments, languages=["en"],
            mapping_cipher=encrypt({"[PERSON_1]": {"value": "Alice", "restore": True}}), analysis=analyzed(segments), payload_hash=analysis.payload_hash(segments))
        db.add(doc)
        await db.commit()
        return user.id, source.id, doc.id


def recognizer(text):
    import re
    return [(m.start(), m.end(), "PERSON", True) for m in re.finditer("Alice|أحمد", text)], {"ar", "en"}


def test_redaction_restores_names_but_never_secrets():
    text = "Alice and أحمد will reply to alice@example.com by 2026-10-02. api_key=sk-very-secret-value https://example.com?token=secret"
    segments, mapping, languages = privacy.sanitize([{"id": "s1", "location": "Text", "text": text}], [], recognizer)
    safe = segments[0]["text"]
    assert "Alice" not in safe and "أحمد" not in safe and "alice@example.com" not in safe
    assert "secret" not in safe and "2026-10-02" in safe
    restored = privacy.restore(safe, mapping)
    assert "Alice" in restored and "أحمد" in restored and "alice@example.com" in restored
    assert "sk-" not in restored and "token=secret" not in restored
    assert languages == ["ar", "en"]


def test_redaction_identity_stable_per_document_and_chunk_boundaries():
    text = "x " * 1499 + "api_key=sk-super-long-secret Alice Alice"
    segments, mapping, _ = privacy.sanitize([{"id": "s1", "location": "Text", "text": text}], [], recognizer)
    safe = " ".join(s["text"] for s in segments)
    assert "super-long-secret" not in safe
    assert safe.count("[PERSON_1]") == 2
    assert len([key for key in mapping if key.startswith("[PERSON")]) == 1


def test_source_placeholder_cannot_spoof_identity():
    segments, mapping, _ = privacy.sanitize([{"id": "s1", "location": "Text", "text": "[PERSON_1] Alice"}], [], recognizer)
    assert privacy.restore(segments, mapping)[0]["text"] == "[redacted] Alice"


@pytest.mark.parametrize("extension,data,code", [("exe", b"abc", "unsupported_type"), ("txt", b"", "empty_document")])
def test_unsupported_and_empty(extension, data, code):
    with pytest.raises(SharePointError, match=code):
        privacy.extract(data, extension, 1000)


def test_text_bom_limit_and_docx():
    assert "أحمد" in privacy.extract("أحمد".encode("utf-16"), "txt", 100)[0]["text"]
    with pytest.raises(SharePointError, match="text_limit"):
        privacy.extract(b"abcdef", "txt", 5)
    from docx import Document
    doc = Document()
    doc.add_paragraph("Example contract")
    doc.add_table(rows=1, cols=1).cell(0, 0).text = "Review by 2026-10-02"
    output = io.BytesIO(); doc.save(output)
    result = privacy.extract(output.getvalue(), "docx", 1000)
    assert any("2026-10-02" in s["text"] for s in result)


def test_xlsx_and_formula_coverage():
    from openpyxl import Workbook
    book = Workbook(); book.active["A1"] = "Task owner"
    buffer = io.BytesIO(); book.save(buffer)
    assert any(s["text"] == "Task owner" for s in privacy.extract(buffer.getvalue(), "xlsx", 1000))
    book.active["B1"] = "=SUM(1,2)"
    buffer = io.BytesIO(); book.save(buffer)
    with pytest.raises(SharePointError, match="formula_requires_review"):
        privacy.extract(buffer.getvalue(), "xlsx", 1000)


def test_zip_bomb_and_visual_content():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "x" * 100000)
    with pytest.raises(SharePointError, match="archive_limit"):
        privacy.extract(output.getvalue(), "docx", 1000)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("word/media/image.png", b"anything")
    with pytest.raises(SharePointError, match="incomplete_visual_content"):
        privacy.extract(output.getvalue(), "docx", 1000)


def test_pdf_without_text_requires_ocr():
    from pypdf import PdfWriter
    writer = PdfWriter(); writer.add_blank_page(width=200, height=200)
    output = io.BytesIO(); writer.write(output)
    with pytest.raises(SharePointError, match="needs_ocr"):
        privacy.extract(output.getvalue(), "pdf", 1000)


def test_unsupported_language_fails_before_model_loading():
    offline = privacy.OfflineRecognizer(["en"], "/not-a-real-model-dir")
    with pytest.raises(SharePointError, match="unsupported_language"):
        offline("هذه وثيقة باللغة العربية تحتوي على معلومات مهمة عن المشروع والشركة")


def test_evidence_and_placeholder_validation():
    segments = [{"id": "s1", "text": "[PERSON_1] must review.", "location": "Text"}]
    value = analyzed(segments)["sections"][0]
    analysis.validate_evidence(DocumentAnalysis.model_validate(value), segments)
    value["summary"] = "[PERSON_2] reviewed."
    with pytest.raises(SharePointError, match="unknown_placeholder"):
        analysis.validate_evidence(DocumentAnalysis.model_validate(value), segments)
    value["summary"] = "Review needed."
    value["summary_evidence"][0]["quote"] = "Invented quotation"
    with pytest.raises(SharePointError, match="invalid_evidence"):
        analysis.validate_evidence(DocumentAnalysis.model_validate(value), segments)


def test_encryption_rotation_and_missing_key(configured, monkeypatch):
    ciphertext = encrypt({"name": "Alice"})
    old = settings.SHAREPOINT_ENCRYPTION_KEY
    monkeypatch.setattr(settings, "SHAREPOINT_ENCRYPTION_KEY", Fernet.generate_key().decode())
    with pytest.raises(SharePointError, match="encryption_key_unavailable"):
        decrypt(ciphertext)
    monkeypatch.setattr(settings, "SHAREPOINT_PREVIOUS_ENCRYPTION_KEYS", old)
    assert decrypt(ciphertext) == {"name": "Alice"}


@pytest.mark.parametrize("url", ["http://graph.microsoft.com/v1.0/me", "https://evil.example/v1.0/me", "https://graph.microsoft.com@evil.example/v1.0/me"])
def test_graph_rejects_foreign_urls(url):
    with pytest.raises(SharePointError): graph.graph_url(url)


@pytest.mark.asyncio
async def test_graph_download_no_authorization_forwarded(monkeypatch):
    requests = []
    async def handler(request):
        requests.append(request)
        if request.url.host == "graph.microsoft.com":
            return httpx.Response(302, headers={"location": "https://example.sharepoint.com/file?token=fake"})
        return httpx.Response(200, content=b"content")
    original = httpx.AsyncClient
    monkeypatch.setattr(graph.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    assert await graph.GraphClient("app-token").get("/drives/d/items/i/content", content=True, download=True) == b"content"
    assert requests[0].headers["authorization"] == "Bearer app-token"
    assert "authorization" not in requests[1].headers
    assert all(request.method == "GET" for request in requests)


@pytest.mark.asyncio
async def test_graph_stream_size_limit(monkeypatch):
    monkeypatch.setattr(settings, "SHAREPOINT_MAX_FILE_BYTES", 3)
    original = httpx.AsyncClient
    monkeypatch.setattr(graph.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"large")), **kwargs))
    with pytest.raises(SharePointError, match="file_too_large"):
        await graph.GraphClient("app").get("/drives/d/items/i/content", content=True, download=True)


@pytest.mark.asyncio
async def test_admin_cannot_bypass_live_content_permission(client, auth, indexed, monkeypatch):
    async def denied(*args): raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)
    response = await client.get(f"/api/sharepoint/documents/{indexed[2]}", headers=auth)
    assert response.status_code == 403
    assert "Alice" not in response.text and "Private client" not in response.text
    response = await client.post("/api/sharepoint/search", headers=auth, json={"q": "Alice"})
    assert response.json() == {"items": [], "next_cursor": None}
    assert "no-store" in response.headers["cache-control"]


@pytest.mark.asyncio
async def test_live_access_restores_names_and_revocation_hides_them(client, auth, indexed, monkeypatch):
    checks = []
    async def permitted(self, drive, item): checks.append(item); return metadata(item)
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    response = await client.get(f"/api/sharepoint/documents/{indexed[2]}", headers=auth)
    assert response.status_code == 200 and "Alice" in response.text
    assert len((await client.post("/api/sharepoint/search", headers=auth, json={"q": "Alice"})).json()["items"]) == 1
    assert len(checks) == 2
    async def denied(*args): raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)
    assert (await client.get(f"/api/sharepoint/documents/{indexed[2]}", headers=auth)).status_code == 403


@pytest.mark.asyncio
async def test_changed_file_never_returns_old_analysis(client, auth, indexed, monkeypatch):
    async def changed(*args): return metadata(version="v2")
    monkeypatch.setattr(graph.GraphClient, "can_read", changed)
    response = await client.get(f"/api/sharepoint/documents/{indexed[2]}", headers=auth)
    assert response.status_code == 409 and "Alice" not in response.text


@pytest.mark.asyncio
async def test_disconnection_and_wrong_tenant_fail_closed(client, auth, indexed):
    async with AsyncSessionLocal() as db:
        connection = await db.get(SharePointConnection, indexed[0]); connection.tenant_id = "wrong"
        await db.commit()
    assert (await client.get("/api/sharepoint/documents", headers=auth)).status_code == 403
    assert (await client.delete("/api/sharepoint/connection", headers=auth)).status_code == 204
    assert (await client.get("/api/sharepoint/documents", headers=auth)).status_code == 403


@pytest.mark.asyncio
async def test_approval_requires_reviewer_and_exact_current_payload(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    endpoint = f"/api/sharepoint/documents/{indexed[2]}"
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2]); doc.status = "awaiting_approval"; await db.commit()
        hashed = doc.payload_hash
    assert (await client.get(endpoint + "/preview", headers=auth)).status_code == 403
    monkeypatch.setattr(settings, "SHAREPOINT_REVIEWER_IDS", str(indexed[0]))
    preview = (await client.get(endpoint + "/preview", headers=auth)).json()
    assert "Alice" not in str(preview) and "Private client" not in str(preview)
    assert (await client.post(endpoint + "/approve", headers=auth, json={"payload_hash": "0" * 64})).status_code == 409
    assert (await client.post(endpoint + "/approve", headers=auth, json={"payload_hash": hashed})).status_code == 202
    assert (await client.post(endpoint + "/approve", headers=auth, json={"payload_hash": hashed})).status_code == 409


@pytest.mark.asyncio
async def test_policy_change_invalidates_analysis(client, auth, indexed):
    response = await client.put("/api/sharepoint/rules", headers=auth, json={"policy": "skip", "terms": []})
    assert response.status_code == 200
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.analysis is None and doc.mapping_cipher is None and doc.status == "ai_skipped"


@pytest.mark.asyncio
async def test_cross_origin_mutations_rejected(client, auth, indexed):
    response = await client.post("/api/sharepoint/sync", headers={**auth, "Origin": "https://evil.example"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_sync_queue_and_lease_idempotent(client, auth, indexed):
    first = await client.post("/api/sharepoint/sync", headers=auth)
    second = await client.post("/api/sharepoint/sync", headers=auth)
    assert first.status_code == second.status_code == 202
    assert first.json()["id"] == second.json()["id"]
    claimed = await worker.claim()
    assert claimed and await worker.claim() is None
    async with AsyncSessionLocal() as db:
        await db.execute(update(SharePointSource).where(SharePointSource.id == indexed[1]).values(lease_until=now() - timedelta(seconds=1)))
        await db.commit()
    reclaimed = await worker.claim()
    assert reclaimed and reclaimed[1] != claimed[1]
    async with AsyncSessionLocal() as db:
        with pytest.raises(SharePointError, match="sync_lease_lost"):
            await worker.owned(db, *claimed)


class FakeGraph:
    verify_source = graph.GraphClient.verify_source
    def __init__(self):
        self.values = [metadata()]
        self.pages = {}
        self.calls = []
        self.version = "v1"

    async def get(self, path, **kwargs):
        self.calls.append(path)
        if path.startswith("/sites/"):
            return {"value": [{"id": "drive"}]}
        if path.endswith("/content"):
            return b"Alice must review the project by 2026-10-02."
        if path in self.pages:
            value = self.pages[path]
            if isinstance(value, Exception):
                raise value
            return value
        return {"value": self.values, "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=next"}

    async def item(self, drive, item):
        if item == "folder": return {"id": "folder", "folder": {}, "parentReference": {"driveId": "drive", "id": "root"}}
        if item == "root": return {"id": "root", "folder": {}}
        return metadata(item, version=self.version)


async def run_sync(source_id):
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, source_id)
        await enqueue(db, source)
        await db.commit()
    work = await worker.claim()
    assert work
    await worker.execute(*work)


@pytest.mark.asyncio
async def test_worker_review_gate_then_idempotent_test_policy(indexed, monkeypatch):
    from app.services.sharepoint.store import purge
    fake = FakeGraph()
    calls = []
    async def token(): return "app-token"
    async def preprocess(*args):
        return privacy.sanitize(privacy.extract(args[0], "txt", 1000), [], recognizer)
    async def analyze(segments):
        calls.append(segments)
        return analyzed(segments), {"input_tokens": 10, "output_tokens": 10}
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "preprocess", preprocess)
    monkeypatch.setattr(worker, "analyze", analyze)
    async with AsyncSessionLocal() as db:
        purge(await db.get(SharePointDocument, indexed[2])); await db.commit()
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.status == "awaiting_approval", doc.error_code
        assert "Alice" not in str(doc.segments)
        assert calls == []
        source = await db.get(SharePointSource, indexed[1]); source.policy = "test"
        purge(doc); await db.commit()
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.status == "ready", doc.error_code
    assert len(calls) == 1
    await run_sync(indexed[1])
    assert len(calls) == 1  # unchanged replay doesn't call OpenAI
    fake.version = "v2"; fake.values = [metadata(version="v2")]
    await run_sync(indexed[1])
    assert len(calls) == 2
    fake.values = [{"id": "one", "deleted": {}}]
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.deleted and not doc.in_scope and doc.mapping_cipher is None and doc.analysis is None


@pytest.mark.asyncio
async def test_delta_pagination_reset_and_move_purge(indexed):
    fake = FakeGraph()
    first = "https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=expired"
    second = "https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=page2"
    fake.pages[first] = SharePointError("delta_expired", 410)
    fake.pages[second] = {"value": [metadata("two")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=last"}
    root = "/drives/drive/root/delta?$select=id,name,eTag,parentReference,webUrl,file,folder,size,lastModifiedDateTime,deleted"
    fake.pages[root] = {"value": [metadata(parent="outside")], "@odata.nextLink": second}
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1]); source.delta_link = first
        await enqueue(db, source); await db.commit()
    work = await worker.claim()
    await worker.discover(*work, fake)
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        source = await db.get(SharePointSource, indexed[1])
        assert not doc.in_scope and doc.mapping_cipher is None and doc.analysis is None
        assert source.next_link is None and source.delta_link.endswith("token=last")
        assert len((await db.scalars(select(SharePointDocument).where(SharePointDocument.source_id == indexed[1]))).all()) == 2


@pytest.mark.asyncio
async def test_refresh_token_rotation_persists_encrypted(indexed, monkeypatch):
    async with AsyncSessionLocal() as db:
        connection = await db.get(SharePointConnection, indexed[0])
        connection.token_cipher = encrypt({"access_token": "expired", "refresh_token": "old-refresh", "expires_at": 0})
        await db.commit()
    async def exchange(data):
        assert data["grant_type"] == "refresh_token" and data["refresh_token"] == "old-refresh"
        return {"access_token": "fresh", "refresh_token": "rotated", "expires_at": time.time() + 3600}
    monkeypatch.setattr(graph, "exchange", exchange)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, indexed[0])
        assert await graph.delegated_token(db, user) == "fresh"
        await db.commit()
    async with AsyncSessionLocal() as db:
        connection = await db.get(SharePointConnection, indexed[0])
        assert "rotated" not in connection.token_cipher
        assert decrypt(connection.token_cipher)["refresh_token"] == "rotated"


@pytest.mark.asyncio
async def test_module_is_explicitly_granted_and_callback_requires_session(client, auth, indexed):
    from app.core.permissions import resolve_permissions
    assert "sharepoint_intelligence" not in resolve_permissions(role="manager", is_admin=False)
    assert (await client.get("/api/sharepoint/callback?code=fake&state=fake", headers=auth)).status_code == 403
    async with AsyncSessionLocal() as db:
        user = await db.get(User, indexed[0]); user.is_admin = False; user.role = "member"; await db.commit()
    assert (await client.get("/api/sharepoint/status", headers=auth)).status_code == 403


@pytest.mark.asyncio
async def test_openai_uses_only_official_endpoint_sanitized_payload_and_no_store(configured, monkeypatch):
    from types import SimpleNamespace
    calls = []
    segments = [{"id": "s1", "location": "Text", "text": "[PERSON_1] must review the proposal."}]
    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert kwargs["base_url"] == "https://api.openai.com/v1" and kwargs["max_retries"] == 0
            self.responses = self
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def parse(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status="completed", output_parsed=DocumentAnalysis.model_validate(analyzed(segments)["sections"][0]), usage=SimpleNamespace(input_tokens=5, output_tokens=10))
    monkeypatch.setattr(analysis, "AsyncOpenAI", FakeOpenAI)
    result, usage = await analysis.analyze(segments)
    assert result["sections"] and usage == {"input_tokens": 5, "output_tokens": 10}
    assert calls[0]["store"] is False and calls[0]["text_format"] is DocumentAnalysis
    assert "[PERSON_1]" in calls[0]["input"][1]["content"]
    assert "filename" not in calls[0]["input"][1]["content"]


@pytest.mark.asyncio
async def test_content_proof_rechecks_version_and_respects_download_denial(monkeypatch):
    original = httpx.AsyncClient
    reads = 0
    deny_content = False
    async def handler(request):
        nonlocal reads
        if request.url.path.endswith("/content"):
            return httpx.Response(403 if deny_content else 200, content=b"ignored")
        reads += 1
        return httpx.Response(200, json=metadata(version=f"v{reads}"))
    monkeypatch.setattr(graph.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(SharePointError, match="document_changed_sync_required"):
        await graph.GraphClient("delegated").can_read("drive", "one")
    deny_content = True
    with pytest.raises(SharePointError, match="document_access_denied"):
        await graph.GraphClient("delegated").can_read("drive", "one")


@pytest.mark.parametrize("reviewer_still_authorized", [True, False])
@pytest.mark.asyncio
async def test_approved_worker_rechecks_reviewer_before_openai(indexed, monkeypatch, reviewer_still_authorized):
    fake = FakeGraph()
    calls = []
    async def token(): return "app-token"
    async def permitted(*args): return metadata()
    async def analyze(segments):
        calls.append(segments)
        return analyzed(segments), {"input_tokens": 10, "output_tokens": 10}
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    monkeypatch.setattr(worker, "analyze", analyze)
    monkeypatch.setattr(settings, "SHAREPOINT_REVIEWER_IDS", str(indexed[0]) if reviewer_still_authorized else "")
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.status, doc.analysis = "approved", None
        doc.approval_hash, doc.approved_by, doc.approved_at = doc.payload_hash, indexed[0], now()
        await db.commit()
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.status == ("ready" if reviewer_still_authorized else "awaiting_approval"), doc.error_code
    assert len(calls) == int(reviewer_still_authorized)


@pytest.mark.asyncio
async def test_path_persistence_and_public_document(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.path = "/Projects/2026/Executive_Plan.pdf"
        await db.commit()
    resp = await client.get(f"/api/sharepoint/documents/{indexed[2]}", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "/Projects/2026/Executive_Plan.pdf"


@pytest.mark.asyncio
async def test_populate_reminders_and_list_api(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    from app.services.sharepoint.reminders import populate_document_reminders
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        analysis_data = {
            "summary": "Project plan summary",
            "expiries": [
                {
                    "title": "Master Agreement Expiration",
                    "date": "2026-10-15",
                    "category": "expiry",
                    "responsible": "Admin",
                    "evidence": [{"segment_id": "s1", "quote": "expires on 2026-10-15"}],
                }
            ],
            "commercials": [
                {
                    "description": "Total Contract Value",
                    "amount": 250000.0,
                    "currency": "USD",
                    "payment_terms": "Net 30",
                    "billing_frequency": "annual",
                    "evidence": [{"segment_id": "s1", "quote": "$250,000"}],
                }
            ],
            "deadlines": [],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    resp = await client.get("/api/sharepoint/reminders", headers=auth)
    assert resp.status_code == 200
    reminders = resp.json()
    assert len(reminders) >= 1
    found = next((r for r in reminders if r["title"] == "Master Agreement Expiration"), None)
    assert found is not None
    assert found["target_date"] == "2026-10-15"
    assert found["amount"] == 250000.0
    assert found["currency"] == "USD"
    assert found["status"] == "pending"

    # Test doc specific reminders endpoint
    doc_reminders_resp = await client.get(f"/api/sharepoint/documents/{indexed[2]}/reminders", headers=auth)
    assert doc_reminders_resp.status_code == 200
    assert len(doc_reminders_resp.json()) >= 1


@pytest.mark.asyncio
async def test_document_chat_endpoint(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    class FakeChoice:
        message = type("Message", (), {"content": "The agreement expires on 2026-10-15."})()

    class FakeChatResponse:
        choices = [FakeChoice()]
        usage = type("Usage", (), {"prompt_tokens": 15, "completion_tokens": 8})()

    async def fake_create(*args, **kwargs):
        return FakeChatResponse()

    monkeypatch.setattr("openai.resources.chat.completions.AsyncCompletions.create", fake_create)
    resp = await client.post(
        f"/api/sharepoint/documents/{indexed[2]}/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "When does this expire?"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "2026-10-15" in data["reply"]
    assert data["usage"]["input_tokens"] == 15


@pytest.mark.asyncio
async def test_auto_policy_bypasses_review_gate(indexed, monkeypatch):
    from app.services.sharepoint.store import purge
    fake = FakeGraph()
    async def token(): return "app-token"
    async def preprocess(*args):
        return privacy.sanitize(privacy.extract(args[0], "txt", 1000), [], recognizer)
    async def analyze(segments):
        return analyzed(segments), {"input_tokens": 10, "output_tokens": 10}
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "preprocess", preprocess)
    monkeypatch.setattr(worker, "analyze", analyze)

    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.policy = "auto"
        purge(await db.get(SharePointDocument, indexed[2]))
        await db.commit()

    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.status == "ready", doc.error_code


@pytest.mark.asyncio
async def test_central_chat_cross_document(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    class FakeChoice:
        message = type("Message", (), {
            "content": "Based on [Private client.txt](https://example.sharepoint.com/test), the agreement expires on 2026-10-15 and Alice is the reviewer."
        })()

    class FakeChatResponse:
        choices = [FakeChoice()]
        usage = type("Usage", (), {"prompt_tokens": 45, "completion_tokens": 22})()

    async def fake_create(*args, **kwargs):
        # Verify system prompt contains the catalog and date anchor
        messages = kwargs.get("messages", [])
        system_msg = next((m["content"] for m in messages if m["role"] == "system"), "")
        assert "AUTHORIZED DOCUMENT CATALOG" in system_msg
        assert "Private client.txt" in system_msg
        assert "CURRENT DATE" in system_msg
        return FakeChatResponse()

    monkeypatch.setattr("openai.resources.chat.completions.AsyncCompletions.create", fake_create)
    resp = await client.post(
        "/api/sharepoint/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "Which licences are expiring soon?"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Private client.txt" in data["reply"]
    assert "2026-10-15" in data["reply"]
    assert len(data["citations"]) >= 1
    citation = data["citations"][0]
    assert citation["document_name"] == "Private client.txt"
    assert citation["document_url"] == "https://example.sharepoint.com/test"
    assert data["usage"]["input_tokens"] == 45


@pytest.mark.asyncio
async def test_central_chat_document_scoping(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    class FakeChoice:
        message = type("Message", (), {"content": "Found 1 scoped document."})()

    class FakeChatResponse:
        choices = [FakeChoice()]
        usage = type("Usage", (), {"prompt_tokens": 20, "completion_tokens": 5})()

    async def fake_create(*args, **kwargs):
        return FakeChatResponse()

    monkeypatch.setattr("openai.resources.chat.completions.AsyncCompletions.create", fake_create)
    resp = await client.post(
        "/api/sharepoint/chat",
        headers=auth,
        json={
            "messages": [{"role": "user", "content": "Tell me about this document"}],
            "document_ids": [str(indexed[2])],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["reply"] == "Found 1 scoped document."


@pytest.mark.asyncio
async def test_central_chat_unauthorized_exclusion(client, auth, indexed, monkeypatch):
    async def denied(*args):
        raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)

    resp = await client.post(
        "/api/sharepoint/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "Show me all files"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "No accessible SharePoint documents were found" in data["reply"]
    assert data["citations"] == []


@pytest.mark.asyncio
async def test_populate_document_actionable_tasks(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    from app.services.sharepoint.reminders import populate_document_reminders

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        analysis_data = {
            "summary": "Compliance summary",
            "expiries": [],
            "commercials": [],
            "deadlines": [],
            "tasks": [
                {
                    "title": "Submit Annual Compliance Review",
                    "owner": "Alice",
                    "deadline": "2026-11-20",
                    "status": "pending",
                    "priority": "high",
                    "evidence": [{"segment_id": "s1", "quote": "Submit review by 2026-11-20"}],
                }
            ],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    resp = await client.get("/api/sharepoint/reminders?category=task", headers=auth)
    assert resp.status_code == 200
    tasks = resp.json()
    assert len(tasks) >= 1
    task = next((t for t in tasks if t["title"] == "Submit Annual Compliance Review"), None)
    assert task is not None
    assert task["category"] == "task"
    assert task["target_date"] == "2026-11-20"
    assert task["status"] == "pending"


@pytest.mark.asyncio
async def test_task_lifecycle_endpoints(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    from app.services.sharepoint.reminders import populate_document_reminders

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        analysis_data = {
            "summary": "Task test",
            "expiries": [],
            "commercials": [],
            "deadlines": [],
            "tasks": [
                {
                    "title": "Renew Security Certificate",
                    "owner": "Admin",
                    "deadline": "2026-12-01",
                    "status": "pending",
                    "priority": "urgent",
                    "evidence": [{"segment_id": "s1", "quote": "Renew certificate"}],
                }
            ],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    # Find the reminder
    list_resp = await client.get("/api/sharepoint/reminders?category=task", headers=auth)
    assert list_resp.status_code == 200
    task = next((t for t in list_resp.json() if t["title"] == "Renew Security Certificate"), None)
    assert task is not None
    task_id = task["id"]

    # 1. Complete task
    comp_resp = await client.post(f"/api/sharepoint/reminders/{task_id}/complete", headers=auth)
    assert comp_resp.status_code == 200
    assert comp_resp.json()["status"] == "completed"

    # Verify status in list with status filter
    comp_list = await client.get("/api/sharepoint/reminders?status=completed", headers=auth)
    assert comp_list.status_code == 200
    assert any(t["id"] == task_id for t in comp_list.json())

    # 2. Reopen task
    reopen_resp = await client.post(f"/api/sharepoint/reminders/{task_id}/reopen", headers=auth)
    assert reopen_resp.status_code == 200
    assert reopen_resp.json()["status"] == "pending"

    # 3. Patch task
    patch_resp = await client.patch(
        f"/api/sharepoint/reminders/{task_id}",
        headers=auth,
        json={"notes": "Updated by compliance officer", "target_date": "2026-12-15"},
    )
    assert patch_resp.status_code == 200

    # Verify update
    verify_resp = await client.get("/api/sharepoint/reminders", headers=auth)
    updated = next((t for t in verify_resp.json() if t["id"] == task_id), None)
    assert updated is not None
    assert updated["target_date"] == "2026-12-15"
    assert updated["notes"] == "Updated by compliance officer"


@pytest.mark.asyncio
async def test_escalating_notification_schedule(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    from app.services.sharepoint.reminders import EXPIRY_ESCALATION_LEADS, populate_document_reminders

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        analysis_data = {
            "summary": "Escalation test",
            "expiries": [
                {
                    "title": "Vendor Master Services Agreement",
                    "date": "2027-01-01",
                    "category": "expiry",
                    "responsible": "Admin",
                    "evidence": [{"segment_id": "s1", "quote": "Expires 2027-01-01"}],
                }
            ],
            "commercials": [{"description": "MSA value", "amount": 75000, "currency": "USD"}],
            "deadlines": [],
            "tasks": [],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    resp = await client.get("/api/sharepoint/reminders?category=expiry", headers=auth)
    assert resp.status_code == 200
    msa_reminders = [r for r in resp.json() if r["title"] == "Vendor Master Services Agreement"]
    # All escalating lead intervals should be generated
    generated_leads = {r["lead_days"] for r in msa_reminders}
    for expected_lead in (90, 60, 30, 21, 14, 7, 5, 3, 1, 0):
        assert expected_lead in generated_leads
    assert len(msa_reminders) == len(EXPIRY_ESCALATION_LEADS)


@pytest.mark.asyncio
async def test_trigger_reminders_endpoint(client, auth, indexed, monkeypatch):
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    monkeypatch.setattr("app.services.sharepoint.reminders.send_email", lambda *a, **kw: True)
    monkeypatch.setattr("app.services.sharepoint.reminders.send_teams", lambda *a, **kw: True)

    resp = await client.post("/api/sharepoint/reminders/run", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "checked" in data
    assert "created" in data



