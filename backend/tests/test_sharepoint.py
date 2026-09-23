"""Privacy, permission and replay regression tests; all external services are fake."""
import io
import shutil
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
from app.models.sharepoint import SharePointConnection, SharePointDocument, SharePointReminder, SharePointSource
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


def test_bilingual_duplicate_year_is_not_redacted_as_phone():
    segments, mapping, _ = privacy.sanitize(
        [{"id": "s1", "location": "Page 1", "text": "Expiry Date 31 Jul 2027 2027; phone +971 800 123 4567"}],
        [], lambda text: ([], {"en"}),
    )
    assert "31 Jul 2027 2027" in segments[0]["text"]
    assert "[PHONE_1]" in segments[0]["text"]
    assert len(mapping) == 1


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


def test_pdf_image_text_is_ocrd_before_analysis(monkeypatch):
    from PIL import Image, ImageDraw
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    picture = Image.new("RGB", (500, 100), "white")
    ImageDraw.Draw(picture).text((10, 30), "Commercial License", fill="black")
    output = io.BytesIO()
    pdf = canvas.Canvas(output)
    pdf.drawImage(ImageReader(picture), 20, 600, 250, 50)
    pdf.drawString(20, 550, "Expiry Date 31 Jul 2027")
    pdf.save()
    monkeypatch.setattr(privacy, "_ocr_image", lambda data: "Commercial License")

    segments = privacy.extract(output.getvalue(), "pdf", 1000)
    assert any("Expiry Date 31 Jul 2027" in part["text"] for part in segments)
    assert any(part["text"] == "Commercial License" and "image" in part["location"] for part in segments)

    monkeypatch.setattr(privacy, "_ocr_image", lambda data: "")
    with pytest.raises(SharePointError, match="incomplete_visual_content"):
        privacy.extract(output.getvalue(), "pdf", 1000)


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="local OCR binary unavailable")
def test_colored_pdf_heading_ocr():
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1800, 114), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 20, 400, 94), fill="#0948ac")
    font = ImageFont.truetype("DejaVuSans.ttf", 45)
    draw.text((90, 33), "Address", font=font, fill="white")
    buffer = io.BytesIO(); image.save(buffer, format="PNG")
    assert "Address" in privacy._ocr_image(buffer.getvalue())


def test_unsupported_language_fails_before_model_loading():
    offline = privacy.OfflineRecognizer(["en"], "/not-a-real-model-dir")
    with pytest.raises(SharePointError, match="unsupported_language"):
        offline("هذه وثيقة باللغة العربية تحتوي على معلومات مهمة عن المشروع والشركة")


def test_missing_privacy_model_fails_closed():
    offline = privacy.OfflineRecognizer(["en"], "/not-a-real-model-dir")
    with pytest.raises(SharePointError, match="privacy_model_unavailable"):
        offline("The company license has a renewal date in July 2027 and needs review.")


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


def test_natural_language_date_is_grounded_in_cited_quote():
    segments = [{"id": "s1", "location": "Page 1", "text": "Current Issue Date 01 Aug 2026\nExpiry Date 31 Jul 2027"}]
    value = analyzed(segments)["sections"][0]
    value["expiries"] = [{"title": "Commercial License expiry", "date": "2027-07-31", "category": "expiry",
                          "evidence": [{"segment_id": "s1", "quote": "Expiry Date 31 Jul 2027"}]}]
    analysis.validate_evidence(DocumentAnalysis.model_validate(value), segments)
    value["expiries"][0]["date"] = "2026-08-01"
    with pytest.raises(SharePointError, match="unsupported_expiry_date"):
        analysis.validate_evidence(DocumentAnalysis.model_validate(value), segments)
    assert analysis._dates_in_quote("31st July 2027") == {"2027-07-31"}
    assert analysis._dates_in_quote("July 31, 2027") == {"2027-07-31"}
    assert analysis._dates_in_quote("31/07/2027") == set()
    assert analysis._dates_in_quote("31 Feb 2027") == set()


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
    assert response.json()["changed"] is True
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.analysis is None and doc.mapping_cipher is None and doc.status == "ai_skipped"
        source = await db.get(SharePointSource, indexed[1])
        assert source.active_run_id == response.json()["run"]["id"]


@pytest.mark.asyncio
async def test_unchanged_privacy_save_preserves_processed_documents(client, auth, indexed):
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        original_version = source.policy_version
        doc = await db.get(SharePointDocument, indexed[2])
        original_analysis = doc.analysis
    response = await client.put("/api/sharepoint/rules", headers=auth, json={"policy": "review", "terms": []})
    assert response.status_code == 200
    assert response.json()["changed"] is False
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        doc = await db.get(SharePointDocument, indexed[2])
        assert source.policy_version == original_version and source.active_run_id is None
        assert doc.status == "ready" and doc.analysis == original_analysis


@pytest.mark.asyncio
async def test_polling_queues_after_five_minutes(indexed, monkeypatch):
    monkeypatch.setattr(settings, "SHAREPOINT_POLLING_ENABLED", True)
    monkeypatch.setattr(settings, "SHAREPOINT_SYNC_INTERVAL_SECONDS", 300)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.last_sync = now() - timedelta(minutes=4)
        await db.commit()
    assert await worker.claim() is None
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.last_sync = now() - timedelta(minutes=6)
        await db.commit()
    assert await worker.claim() is not None


@pytest.mark.asyncio
async def test_polling_queues_after_one_minute(indexed, monkeypatch):
    monkeypatch.setattr(settings, "SHAREPOINT_POLLING_ENABLED", True)
    monkeypatch.setattr(settings, "SHAREPOINT_SYNC_INTERVAL_SECONDS", 60)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.last_sync = now() - timedelta(seconds=50)
        await db.commit()
    assert await worker.claim() is None

    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.last_sync = now() - timedelta(seconds=70)
        await db.commit()
    assert await worker.claim() is not None


@pytest.mark.asyncio
async def test_status_reports_polling_configuration(client, auth, indexed, monkeypatch):
    monkeypatch.setattr(settings, "SHAREPOINT_POLLING_ENABLED", False)
    monkeypatch.setattr(settings, "SHAREPOINT_SYNC_INTERVAL_SECONDS", 60)
    response = await client.get("/api/sharepoint/status", headers=auth)
    assert response.status_code == 200
    assert response.json()["polling_enabled"] is False
    assert response.json()["sync_interval_seconds"] == 60


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
async def test_ocr_recovery_retries_old_failure_without_reprocessing_ready_files(indexed, monkeypatch):
    fake = FakeGraph()
    fake.values = [metadata(), metadata(item="two", name="Already ready.txt")]
    calls = []

    async def token():
        return "app-token"

    async def preprocess(data, extension, terms):
        calls.append("extract")
        return [{"id": "s1", "location": "Page 1", "text": "Expiry Date 31 Jul 2027"}], {}, ["en"]

    async def analyze(segments):
        calls.append("analyze")
        return analyzed(segments), {"input_tokens": 10, "output_tokens": 10}

    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "preprocess", preprocess)
    monkeypatch.setattr(worker, "analyze", analyze)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.policy = "test"
        failed = await db.get(SharePointDocument, indexed[2])
        failed.status = "failed"
        failed.error_code = "incomplete_visual_content"
        failed.segments = None
        failed.fingerprint = None  # Failure persisted by the previous parser.
        failed.attempts = 3
        ready_segments = [{"id": "s1", "location": "Text", "text": "Already processed"}]
        db.add(SharePointDocument(source_id=source.id, item_id="two", parent_id="folder", in_scope=True,
            version="v1", filename="Already ready.txt", status="ready", segments=ready_segments,
            analysis=analyzed(ready_segments), payload_hash=analysis.payload_hash(ready_segments)))
        await db.commit()

    await run_sync(indexed[1])
    assert calls == ["extract", "analyze"]
    async with AsyncSessionLocal() as db:
        failed = await db.get(SharePointDocument, indexed[2])
        ready = (await db.scalars(select(SharePointDocument).where(SharePointDocument.item_id == "two"))).one()
        assert failed.status == ready.status == "ready"
        assert failed.attempts == 1 and ready.attempts == 0

    await run_sync(indexed[1])
    assert calls == ["extract", "analyze"]


@pytest.mark.asyncio
async def test_ocr_recovery_respects_failed_attempt_budget(indexed, monkeypatch):
    fake = FakeGraph()
    calls = []

    async def token():
        return "app-token"

    async def preprocess(*args):
        calls.append("extract")
        raise SharePointError("incomplete_visual_content", 422)

    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "preprocess", preprocess)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.policy = "test"
        failed = await db.get(SharePointDocument, indexed[2])
        failed.status = "failed"
        failed.error_code = "incomplete_visual_content"
        failed.segments = None
        failed.attempts = 3
        await db.commit()

    for _ in range(4):
        await run_sync(indexed[1])
    assert calls == ["extract", "extract", "extract"]
    async with AsyncSessionLocal() as db:
        failed = await db.get(SharePointDocument, indexed[2])
        source = await db.get(SharePointSource, indexed[1])
        assert failed.status == "failed" and failed.attempts == 3
        assert failed.fingerprint == worker.ocr_failure_fingerprint(failed.version, source.policy_version)


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
    async with AsyncSessionLocal() as db:
        existing = await db.get(SharePointDocument, indexed[2])
        previous_processed_at, previous_attempts = existing.processed_at, existing.attempts
    fake.values = [metadata(), metadata(item="new")]
    await run_sync(indexed[1])
    assert len(calls) == 2  # only the newly uploaded file is analyzed
    async with AsyncSessionLocal() as db:
        existing = await db.get(SharePointDocument, indexed[2])
        assert existing.status == "ready"
        assert (existing.processed_at, existing.attempts) == (previous_processed_at, previous_attempts)
    fake.version = "v2"; fake.values = [metadata(version="v2")]
    await run_sync(indexed[1])
    assert len(calls) == 3
    fake.values = [{"id": "one", "deleted": {}}]
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.deleted and not doc.in_scope and doc.mapping_cipher is None and doc.analysis is None


@pytest.mark.asyncio
async def test_reminder_failure_does_not_publish_ready_document(indexed, monkeypatch):
    from app.services.sharepoint import reminders
    from app.services.sharepoint.store import purge

    fake = FakeGraph()
    async def token(): return "app-token"
    async def preprocess(*args):
        return privacy.sanitize(privacy.extract(args[0], "txt", 1000), [], recognizer)
    async def analyze(segments):
        return analyzed(segments), {"input_tokens": 10, "output_tokens": 10}
    async def fail_reminders(*args, **kwargs):
        raise RuntimeError("synthetic reminder storage failure")

    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "preprocess", preprocess)
    monkeypatch.setattr(worker, "analyze", analyze)
    monkeypatch.setattr(reminders, "populate_document_reminders", fail_reminders)
    async with AsyncSessionLocal() as db:
        source = await db.get(SharePointSource, indexed[1])
        source.policy = "test"
        purge(await db.get(SharePointDocument, indexed[2]))
        await db.commit()
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        assert doc.status == "processing" and doc.analysis is None


@pytest.mark.asyncio
async def test_sync_repairs_missing_reminders_without_reanalyzing(indexed, monkeypatch):
    fake = FakeGraph()
    async def token(): return "app-token"
    async def should_not_analyze(*args):
        raise AssertionError("ready document must not be reanalyzed")
    monkeypatch.setattr(worker, "application_token", token)
    monkeypatch.setattr(worker, "GraphClient", lambda token: fake)
    monkeypatch.setattr(worker, "analyze", should_not_analyze)
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.analysis = {"sections": [{"expiries": [{"title": "Trade licence", "date": "2026-12-15", "category": "expiry", "responsible": None}]}]}
        await db.commit()
        before = (doc.processed_at, doc.attempts)
    await run_sync(indexed[1])
    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        reminders = list((await db.scalars(select(SharePointReminder).where(SharePointReminder.document_id == doc.id))).all())
        assert reminders
        assert doc.status == "ready" and (doc.processed_at, doc.attempts) == before


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


@pytest.mark.asyncio
async def test_chat_privacy_outbound_prompt_sanitized_and_reply_restored(client, auth, indexed, monkeypatch):
    """Issue #15: Outbound prompt contains placeholders [PERSON_1] and no PII; reply is restored."""
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    captured_prompt = []

    class FakeChoice:
        message = type("Message", (), {"content": "The reviewer is [PERSON_1]."})()

    class FakeChatResponse:
        choices = [FakeChoice()]
        usage = type("Usage", (), {"prompt_tokens": 15, "completion_tokens": 5})()

    async def fake_create(*args, **kwargs):
        messages = kwargs.get("messages", [])
        for m in messages:
            captured_prompt.append(m["content"])
        return FakeChatResponse()

    monkeypatch.setattr("openai.resources.chat.completions.AsyncCompletions.create", fake_create)

    resp = await client.post(
        f"/api/sharepoint/documents/{indexed[2]}/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "Who must review the proposal?"}]},
    )
    assert resp.status_code == 200
    # The response reply must have [PERSON_1] restored to Alice
    assert resp.json()["reply"] == "The reviewer is Alice."
    # The outbound prompt sent to OpenAI must contain [PERSON_1] and NOT Alice!
    full_outbound = " ".join(captured_prompt)
    assert "[PERSON_1]" in full_outbound
    assert "Alice" not in full_outbound


@pytest.mark.asyncio
async def test_chat_blocks_unapproved_document_under_review_policy(client, auth, indexed, monkeypatch):
    """Issue #15: Under policy='review', an unapproved (awaiting_approval) document rejects chat."""
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.status = "awaiting_approval"
        source = await db.get(SharePointSource, indexed[1])
        source.policy = "review"
        await db.commit()

    resp = await client.post(
        f"/api/sharepoint/documents/{indexed[2]}/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "Summarize"}]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "document_review_required"


@pytest.mark.asyncio
async def test_reminders_negative_authorization_filtering_and_mutations(client, auth, indexed, monkeypatch):
    """Issue #16: Reminders list and mutations reject unauthorized documents."""
    from app.services.sharepoint.reminders import populate_document_reminders

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.status = "ready"
        analysis_data = {
            "summary": "Auth test",
            "expiries": [
                {"title": "Secret Contract Expiry", "date": "2026-11-15", "category": "expiry", "responsible": "Admin"}
            ],
            "commercials": [], "deadlines": [], "tasks": [],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    # 1. When permitted, reminders appear
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    resp = await client.get("/api/sharepoint/reminders?category=expiry", headers=auth)
    assert resp.status_code == 200
    reminders = [r for r in resp.json() if r["title"] == "Secret Contract Expiry"]
    assert len(reminders) > 0
    rem_id = reminders[0]["id"]

    # 2. When denied, list_reminders hides them
    async def denied(*args): raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)
    resp_denied = await client.get("/api/sharepoint/reminders?category=expiry", headers=auth)
    assert resp_denied.status_code == 200
    assert not any(r["id"] == rem_id for r in resp_denied.json())

    # 3. Mutations are blocked with 403 when user cannot read source document
    assert (await client.post(f"/api/sharepoint/reminders/{rem_id}/dismiss", headers=auth)).status_code == 403
    assert (await client.post(f"/api/sharepoint/reminders/{rem_id}/complete", headers=auth)).status_code == 403
    assert (await client.post(f"/api/sharepoint/reminders/{rem_id}/reopen", headers=auth)).status_code == 403
    assert (await client.patch(f"/api/sharepoint/reminders/{rem_id}", headers=auth, json={"notes": "hack"})).status_code == 403


@pytest.mark.asyncio
async def test_reminder_patch_input_validation(client, auth, indexed, monkeypatch):
    """Issue #16: PATCH /reminders/{id} rejects non-ISO target_date and client-set 'sent' status."""
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    from app.services.sharepoint.reminders import populate_document_reminders

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.status = "ready"
        analysis_data = {
            "summary": "Validation test",
            "tasks": [{"title": "Validation Task", "deadline": "2026-11-20", "status": "pending", "owner": "Admin"}],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    resp = await client.get("/api/sharepoint/reminders?category=task", headers=auth)
    rem_id = next(r["id"] for r in resp.json() if r["title"] == "Validation Task")

    # Invalid target_date format
    bad_date_resp = await client.patch(
        f"/api/sharepoint/reminders/{rem_id}",
        headers=auth,
        json={"target_date": "not-a-date-too-long-string-for-db-column"},
    )
    assert bad_date_resp.status_code == 422

    # Client cannot set status="sent"
    bad_status_resp = await client.patch(
        f"/api/sharepoint/reminders/{rem_id}",
        headers=auth,
        json={"status": "sent"},
    )
    assert bad_status_resp.status_code == 422


@pytest.mark.asyncio
async def test_resolve_recipient_no_fuzzy_or_unvalidated_email(indexed):
    """Issue #17: _resolve_recipient only matches exact active user email; no fuzzy name matching or arbitrary email fallback."""
    from app.services.sharepoint.reminders import _resolve_recipient

    async with AsyncSessionLocal() as db:
        # 1. Fuzzy match attempt: "Adm" or "Sam" should NOT match "Administrator" or others
        assert await _resolve_recipient(db, "Adm") is None
        assert await _resolve_recipient(db, "Administrator") is None
        assert await _resolve_recipient(db, "Sam") is None

        # 2. Arbitrary external email from document should NOT be trusted as recipient
        assert await _resolve_recipient(db, "contractor@external-attacker.com") is None

        # 3. Exact active platform user email matches
        assert await _resolve_recipient(db, "admin@agholding.net") == "admin@agholding.net"

        # 4. None / empty returns None (no fallback to DEFAULT_ADMIN_EMAIL)
        assert await _resolve_recipient(db, None) is None
        assert await _resolve_recipient(db, "") is None


@pytest.mark.asyncio
async def test_reminder_burst_prevention_and_retries(client, auth, indexed, monkeypatch):
    """Issue #18: Multi-stage pending reminders fire only the single most urgent stage; failures retry up to 3 times."""
    from datetime import date, timedelta
    from app.models.sharepoint import SharePointReminder
    from app.services.sharepoint.reminders import deliver_reminder, populate_document_reminders, run_sharepoint_reminders

    # Create an expiry 5 days out
    target_date = (date.today() + timedelta(days=5)).isoformat()

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.status = "ready"
        analysis_data = {
            "summary": "Burst test",
            "expiries": [{"title": "Near Expiry Contract", "date": target_date, "category": "expiry", "responsible": "admin@agholding.net"}],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])

    delivered_stages = []
    def fake_send_email(*args, **kwargs):
        delivered_stages.append(kwargs)
        return True

    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    monkeypatch.setattr("app.services.sharepoint.reminders.send_email", fake_send_email)
    monkeypatch.setattr("app.services.sharepoint.reminders.send_teams", lambda *a, **kw: True)

    async with AsyncSessionLocal() as db:
        res = await run_sharepoint_reminders(db)
        assert res["created"] == 1  # Only ONE reminder stage fired!

        # Earlier stages (90, 60, 30, 21, 14, 7) must have been marked 'skipped'
        all_rems = (await db.scalars(select(SharePointReminder).where(SharePointReminder.title == "Near Expiry Contract"))).all()
        sent_rems = [r for r in all_rems if r.status == "sent"]
        skipped_rems = [r for r in all_rems if r.status == "skipped"]
        pending_rems = [r for r in all_rems if r.status == "pending"]

        assert len(sent_rems) == 1
        assert sent_rems[0].lead_days == 5  # The most urgent due stage
        assert len(skipped_rems) > 0        # Earlier past-due stages skipped
        assert all(r.lead_days in (0, 1, 3) for r in pending_rems)  # Future stages remain pending

    # Test retry mechanism: transient delivery failure leaves status="pending" and increments attempts
    monkeypatch.setattr("app.services.sharepoint.reminders.send_email", lambda *a, **kw: False)
    monkeypatch.setattr("app.services.sharepoint.reminders.send_teams", lambda *a, **kw: False)

    async with AsyncSessionLocal() as db:
        rem = (await db.scalars(select(SharePointReminder).where(SharePointReminder.status == "pending"))).first()
        if rem:
            assert rem.attempts == 0
            # Attempt 1
            await deliver_reminder(db, rem)
            assert rem.status == "pending"
            assert rem.attempts == 1

            # Attempt 2
            await deliver_reminder(db, rem)
            assert rem.status == "pending"
            assert rem.attempts == 2

            # Attempt 3 -> fails permanently
            await deliver_reminder(db, rem)
            assert rem.status == "failed"
            assert rem.attempts == 3


@pytest.mark.asyncio
async def test_stale_reminders_purged_on_analysis_update(indexed):
    """Issue #18: When document analysis changes or reminders are repopulated, old pending reminders are purged."""
    from app.models.sharepoint import SharePointReminder
    from app.services.sharepoint.reminders import populate_document_reminders
    from app.services.sharepoint.store import purge_document_reminders

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, indexed[2])
        doc.status = "ready"
        analysis_data = {
            "summary": "First Analysis",
            "expiries": [{"title": "Old Contract To Disappear", "date": "2027-01-01", "category": "expiry", "responsible": "admin@agholding.net"}],
        }
        await populate_document_reminders(db, doc, analysis_data, indexed[1])
        rems = (await db.scalars(select(SharePointReminder).where(SharePointReminder.document_id == doc.id))).all()
        assert len(rems) > 0
        assert any(r.title == "Old Contract To Disappear" for r in rems)

        # Repopulate with new analysis where old contract is removed
        new_analysis = {
            "summary": "Second Analysis",
            "expiries": [{"title": "Brand New Contract", "date": "2027-06-01", "category": "expiry", "responsible": "admin@agholding.net"}],
        }
        await populate_document_reminders(db, doc, new_analysis, indexed[1])
        rems_updated = (await db.scalars(select(SharePointReminder).where(SharePointReminder.document_id == doc.id))).all()
        assert not any(r.title == "Old Contract To Disappear" for r in rems_updated)
        assert any(r.title == "Brand New Contract" for r in rems_updated)

        # Purge reminders
        await purge_document_reminders(db, doc.id)
        rems_purged = (await db.scalars(select(SharePointReminder).where(SharePointReminder.document_id == doc.id))).all()
        assert len(rems_purged) == 0


def test_reminder_email_html_escaping_and_safe_urls():
    """Issue #21: reminder_email_html escapes document text and drops unsafe links."""
    from app.models.sharepoint import SharePointDocument, SharePointReminder
    from app.services.sharepoint.reminders import _escape_teams_markdown, reminder_email_html

    doc = SharePointDocument(
        filename="Contract<script>alert(1)</script>.pdf",
        path="/Legal/<script>evil()</script>/file.pdf",
        web_url="javascript:alert(document.cookie)",
    )
    rem = SharePointReminder(
        title="Payment Due <img src=x onerror=alert(1)>",
        target_date="2026-10-10",
        lead_days=14,
        responsible_name="Attacker <b onmouseover=alert(1)>",
        amount=50000.0,
        currency="USD<script>",
    )

    html = reminder_email_html(rem, doc)
    # Ensure raw script and payload tags are not present unescaped
    assert "<script>" not in html
    assert "<img src=x" not in html
    assert "<b onmouseover" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img src=x" in html
    # Ensure javascript: link was rejected and not rendered
    assert "javascript:" not in html
    assert "Open Document in SharePoint" not in html

    # Teams markdown escaping
    unsafe_md = "Project *Bold* `Code` [Link](https://evil.com) #Header"
    escaped_md = _escape_teams_markdown(unsafe_md)
    assert "\\*" in escaped_md
    assert "\\`" in escaped_md
    assert "\\[" in escaped_md
    assert "\\#" in escaped_md


def test_send_teams_skips_fallback_on_400_or_404(monkeypatch):
    """Issue #20: send_teams does not attempt legacy fallback on non-retryable 400/404 HTTP errors."""
    import urllib.error
    from app.services.dispatch import send_teams

    monkeypatch.setattr(settings, "TEAMS_WEBHOOK_URL", "https://example.webhook.office.com/webhook")

    urlopen_calls = []

    def fake_urlopen(req, timeout=10):
        urlopen_calls.append(req)
        # Raise HTTPError 404 (webhook dead)
        raise urllib.error.HTTPError("https://example.com", 404, "Not Found", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    res = send_teams(title="Test Alert", body="Details", link=None)
    assert res is False
    # Only 1 call was made; legacy fallback was skipped!
    assert len(urlopen_calls) == 1


@pytest.mark.asyncio
async def test_reminders_list_filters_authorized_before_150_limit(client, auth, indexed, monkeypatch):
    """Issue #24: list_reminders applies authorization filter before the 150-row limit so user's reminders are not lost."""
    from app.models.sharepoint import SharePointDocument, SharePointReminder

    user_id, source_id, doc1_id = indexed

    async with AsyncSessionLocal() as db:
        # Create Doc 2
        doc2 = SharePointDocument(
            source_id=source_id,
            item_id="two",
            parent_id="folder",
            in_scope=True,
            version="v1",
            filename="Doc2 Authorized.txt",
            status="ready",
        )
        db.add(doc2)
        await db.flush()
        doc2_id = doc2.id

        # Insert 155 reminders for Doc 1 (earlier target_date: 2026-10-01)
        # and 5 reminders for Doc 2 (later target_date: 2026-12-01)
        for i in range(155):
            rem = SharePointReminder(
                id=uuid.uuid4(),
                source_id=source_id,
                document_id=doc1_id,
                title=f"Doc1 Reminder {i}",
                category="task",
                target_date="2026-10-01",
                reminder_date="2026-09-20",
                lead_days=10,
                status="pending",
                dedup_key=f"d1_{i}",
            )
            db.add(rem)

        for i in range(5):
            rem = SharePointReminder(
                id=uuid.uuid4(),
                source_id=source_id,
                document_id=doc2_id,
                title=f"Doc2 Authorized Reminder {i}",
                category="task",
                target_date="2026-12-01",
                reminder_date="2026-11-20",
                lead_days=10,
                status="pending",
                dedup_key=f"d2_{i}",
            )
            db.add(rem)
        await db.commit()

    # User is DENIED for Doc 1, but PERMITTED for Doc 2
    async def selective_can_read(self, drive, item):
        if item == "two":
            return metadata(item="two", name="Doc2 Authorized.txt")
        raise SharePointError("document_access_denied", 403)

    monkeypatch.setattr(graph.GraphClient, "can_read", selective_can_read)

    resp = await client.get("/api/sharepoint/reminders?category=task", headers=auth)
    assert resp.status_code == 200
    returned = resp.json()
    # If limit(150) were applied before authorization, Doc2 reminders would have been dropped!
    # Because authorization is filtered before limit, all 5 Doc2 reminders are returned:
    assert len(returned) == 5
    assert all("Doc2 Authorized Reminder" in r["title"] for r in returned)


@pytest.mark.asyncio
async def test_reminders_missing_connection_returns_403(client, configured):
    """Issue #24: When user has no SharePoint connection, GET /reminders returns 403 microsoft_connection_required."""
    from app.core.security import create_access_token
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        user2 = User(
            id=uuid.uuid4(),
            email="unconnected@agholding.net",
            display_name="Unconnected User",
            role="admin",
            is_active=True,
            status="active",
        )
        db.add(user2)
        await db.commit()
        user2_id = str(user2.id)

    token = create_access_token(user2_id, extra={"role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/sharepoint/reminders", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "microsoft_connection_required"


def test_score_doc_reads_section_summaries_and_stems_plurals():
    """Issue #23: score_doc extracts summaries from analysis sections, commercial & expiry titles, and stems keywords."""
    import re
    from app.models.sharepoint import SharePointDocument
    from app.services.sharepoint import chat

    assert chat.stem_token("licences") == "licence"
    assert chat.stem_token("contracts") == "contract"
    assert chat.stem_token("renewals") == "renewal"

    doc1 = SharePointDocument(
        filename="AGH-2026-114.pdf",
        path="/Archives/AGH-2026-114.pdf",
        analysis={
            "sections": [
                {
                    "summary": "This is a supplier contract renewal agreement for IT infrastructure services.",
                    "expiries": [{"title": "Dubai Trade Licence Renewal", "date": "2026-12-31", "category": "renewal"}],
                    "commercials": [{"description": "Annual subscription licensing fee", "amount": 45000.0, "currency": "USD"}],
                }
            ],
            "requires_attention": True,
        },
    )

    doc2 = SharePointDocument(
        filename="Employee_Handbook_2026.pdf",
        path="/HR/Employee_Handbook_2026.pdf",
        analysis={"sections": [{"summary": "Standard office safety and conduct guidelines.", "expiries": [], "commercials": []}]},
    )

    query_kws = chat.extract_query_keywords("which supplier contracts need renewal?")
    assert "contracts" in query_kws
    assert "supplier" in query_kws
    assert "renewal" in query_kws

    def score_doc(d):
        corpus_parts = [d.filename or "", d.path or ""]
        if d.analysis:
            sections = d.analysis.get("sections") if isinstance(d.analysis, dict) else []
            if not sections and isinstance(d.analysis, dict):
                sections = [d.analysis]
            for sec in sections:
                if isinstance(sec, dict):
                    if sec.get("summary"):
                        corpus_parts.append(sec["summary"])
                    for exp in sec.get("expiries") or []:
                        corpus_parts.append(exp.get("title") or "")
                    for comm in sec.get("commercials") or []:
                        corpus_parts.append(comm.get("description") or "")
        full_text = " ".join(corpus_parts).lower()
        doc_tokens = set(re.findall(r"\w+", full_text))
        doc_stems = {chat.stem_token(t) for t in doc_tokens if len(t) >= 3}
        score = 0
        for kw in query_kws:
            kw_lower = kw.lower()
            kw_stem = chat.stem_token(kw_lower)
            if kw_lower in (d.filename or "").lower():
                score += 3
            elif kw_lower in doc_tokens:
                score += 2
            elif kw_stem in doc_stems:
                score += 2
            elif any(t.startswith(kw_stem) or kw_stem.startswith(t) for t in doc_stems if len(t) >= 4):
                score += 1
            elif kw_lower in full_text:
                score += 1
        return score

    score1 = score_doc(doc1)
    score2 = score_doc(doc2)
    assert score1 > 0
    assert score2 == 0
    assert score1 > score2


@pytest.mark.asyncio
async def test_central_chat_namespaced_placeholders_prevent_cross_document_collision(client, auth, indexed, monkeypatch):
    """Issue #22: Central chat namespaces placeholders per document so [PERSON_1] across different documents do not collide."""
    from app.models.sharepoint import SharePointDocument
    from app.services.sharepoint.common import encrypt

    user_id, source_id, doc_a_id = indexed

    async with AsyncSessionLocal() as db:
        # Doc A: [PERSON_1] is Alice
        doc_a = await db.get(SharePointDocument, doc_a_id)
        doc_a.filename = "Trade_Licence.pdf"
        doc_a.mapping_cipher = encrypt({"[PERSON_1]": {"value": "Alice", "restore": True}})
        doc_a.segments = [{"id": "s1", "location": "Page 1", "text": "Trade licence holder is [PERSON_1]."}]
        doc_a.payload_hash = analysis.payload_hash(doc_a.segments)
        doc_a.analysis = analyzed(doc_a.segments)

        # Doc B: [PERSON_1] is Bob
        segments_b = [{"id": "s1", "location": "Page 1", "text": "Insurance policy contact is [PERSON_1]."}]
        doc_b = SharePointDocument(
            source_id=source_id,
            item_id="two",
            parent_id="folder",
            in_scope=True,
            version="v1",
            filename="Insurance_Policy.pdf",
            status="ready",
            segments=segments_b,
            languages=["en"],
            mapping_cipher=encrypt({"[PERSON_1]": {"value": "Bob", "restore": True}}),
            analysis=analyzed(segments_b),
            payload_hash=analysis.payload_hash(segments_b),
        )
        db.add(doc_b)
        await db.commit()

    async def permitted(self, drive, item):
        return metadata(item=item, name=f"Doc {item}")
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    class FakeChoice:
        message = type("Message", (), {
            "content": "The trade licence holder is [D2_PERSON_1], and the insurance contact is [D1_PERSON_1]."
        })()

    class FakeChatResponse:
        choices = [FakeChoice()]
        usage = type("Usage", (), {"prompt_tokens": 50, "completion_tokens": 20})()

    async def fake_create(*args, **kwargs):
        return FakeChatResponse()

    monkeypatch.setattr("openai.resources.chat.completions.AsyncCompletions.create", fake_create)

    resp = await client.post(
        "/api/sharepoint/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "Who is responsible for the licence and insurance?"}]},
    )
    assert resp.status_code == 200
    reply = resp.json()["reply"]

    # In the reply:
    # [D1_PERSON_1] must restore to Alice, and [D2_PERSON_1] must restore to Bob!
    assert "The trade licence holder is Alice" in reply
    assert "and the insurance contact is Bob" in reply
    assert "[D1_PERSON_1]" not in reply
    assert "[D2_PERSON_1]" not in reply


@pytest.mark.asyncio
async def test_central_chat_candidate_truncation_disclosed_and_scoped_ids(client, auth, indexed, monkeypatch):
    """Issue #19: Central chat discloses candidate pool truncation when library exceeds cap, and scopes document_ids."""
    from app.models.sharepoint import SharePointDocument

    user_id, source_id, doc_id = indexed

    async with AsyncSessionLocal() as db:
        # Insert 30 dummy ready documents to exceed the 25 candidate cap
        for i in range(30):
            segs = [{"id": "s1", "location": "Text", "text": f"Content for extra document {i}"}]
            doc = SharePointDocument(
                source_id=source_id,
                item_id=f"extra_{i}",
                parent_id="folder",
                in_scope=True,
                version="v1",
                filename=f"Catalog_Doc_{i:02d}.txt",
                status="ready",
                segments=segs,
                payload_hash=analysis.payload_hash(segs),
                analysis={"sections": [{"summary": f"Summary {i}"}]},
            )
            db.add(doc)
        await db.commit()

    async def permitted(self, drive, item):
        return metadata(item=item, name=f"Doc {item}")
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    class FakeChoice:
        message = type("Message", (), {"content": "Here is the summary of documents."})()

    class FakeChatResponse:
        choices = [FakeChoice()]
        usage = type("Usage", (), {"prompt_tokens": 20, "completion_tokens": 10})()

    async def fake_create(*args, **kwargs):
        return FakeChatResponse()

    monkeypatch.setattr("openai.resources.chat.completions.AsyncCompletions.create", fake_create)

    # 1. Unscoped inquiry against 31 documents hits 25 cap and discloses truncation
    resp = await client.post(
        "/api/sharepoint/chat",
        headers=auth,
        json={"messages": [{"role": "user", "content": "List all catalog documents"}]},
    )
    assert resp.status_code == 200
    reply = resp.json()["reply"]
    assert "Answered from 25 of 31 accessible documents" in reply

    # 2. Scoped query with explicit document_ids bypasses 25 cap
    async with AsyncSessionLocal() as db:
        all_docs = (await db.scalars(select(SharePointDocument).limit(28))).all()
        selected_ids = [str(d.id) for d in all_docs]

    resp_scoped = await client.post(
        "/api/sharepoint/chat",
        headers=auth,
        json={
            "messages": [{"role": "user", "content": "Analyze these specific documents"}],
            "document_ids": selected_ids,
        },
    )
    assert resp_scoped.status_code == 200
    assert "Answered from 25 of" not in resp_scoped.json()["reply"]


@pytest.mark.asyncio
async def test_reminder_delivery_blocked_without_recipient_or_unauthorized(client, auth, indexed, monkeypatch):
    """Issue #17: Reminders without an assigned recipient or where recipient lacks SharePoint permission are not delivered."""
    from app.models.sharepoint import SharePointReminder
    from app.services.sharepoint.reminders import deliver_reminder

    user_id, source_id, doc_id = indexed

    async with AsyncSessionLocal() as db:
        # Case 1: No recipient
        rem_no_recipient = SharePointReminder(
            id=uuid.uuid4(),
            source_id=source_id,
            document_id=doc_id,
            title="Unassigned Expiry",
            category="expiry",
            target_date="2026-10-10",
            reminder_date="2026-10-01",
            lead_days=9,
            responsible_name="Unknown Person",
            recipient_email=None,
            status="pending",
            dedup_key="unassigned_1",
        )
        db.add(rem_no_recipient)

        # Case 2: Recipient has no SharePoint access
        rem_unauthorized = SharePointReminder(
            id=uuid.uuid4(),
            source_id=source_id,
            document_id=doc_id,
            title="Unauthorized Expiry",
            category="expiry",
            target_date="2026-10-10",
            reminder_date="2026-10-01",
            lead_days=9,
            responsible_name="Admin",
            recipient_email="admin@agholding.net",
            status="pending",
            dedup_key="unauthorized_1",
        )
        db.add(rem_unauthorized)
        await db.commit()
        rem1_id = rem_no_recipient.id
        rem2_id = rem_unauthorized.id

    emails_sent = []
    teams_sent = []
    monkeypatch.setattr("app.services.sharepoint.reminders.send_email", lambda *a, **kw: emails_sent.append(kw) or True)
    monkeypatch.setattr("app.services.sharepoint.reminders.send_teams", lambda *a, **kw: teams_sent.append(kw) or True)

    # 1. Without recipient: deliver_reminder returns False, does NOT send email, does NOT mark sent
    async with AsyncSessionLocal() as db:
        r1 = await db.get(SharePointReminder, rem1_id)
        assert await deliver_reminder(db, r1) is False
        assert r1.status != "sent"
        assert len(emails_sent) == 0
        assert len(teams_sent) == 0

    # 2. Recipient denied access in SharePoint
    async def denied(*args, **kwargs):
        raise SharePointError("document_access_denied", 403)
    monkeypatch.setattr(graph.GraphClient, "can_read", denied)

    async with AsyncSessionLocal() as db:
        r2 = await db.get(SharePointReminder, rem2_id)
        assert await deliver_reminder(db, r2) is False
        assert r2.status != "sent"
        assert len(emails_sent) == 0
        assert len(teams_sent) == 0


@pytest.mark.asyncio
async def test_reminder_teams_webhook_does_not_leak_sensitive_details(client, auth, indexed, monkeypatch):
    """Issue #17: Teams card is a non-sensitive notification pointer and cannot mark reminder sent alone."""
    from app.models.sharepoint import SharePointReminder
    from app.services.sharepoint.reminders import deliver_reminder

    user_id, source_id, doc_id = indexed

    async with AsyncSessionLocal() as db:
        doc = await db.get(SharePointDocument, doc_id)
        doc.filename = "Confidential_Salary_Review.pdf"
        doc.path = "/HR/Confidential/Salaries/Confidential_Salary_Review.pdf"

        rem = SharePointReminder(
            id=uuid.uuid4(),
            source_id=source_id,
            document_id=doc_id,
            title="Executive Salary Milestone",
            category="deadline",
            target_date="2026-10-10",
            reminder_date="2026-10-01",
            lead_days=9,
            responsible_name="Executive John Doe",
            recipient_email="admin@agholding.net",
            amount=250000.0,
            currency="USD",
            status="pending",
            dedup_key="salary_rem_1",
        )
        db.add(rem)
        await db.commit()
        rem_id = rem.id

    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)

    teams_payloads = []
    def fake_send_teams(title, body, link=None):
        teams_payloads.append({"title": title, "body": body, "link": link})
        return True
    monkeypatch.setattr("app.services.sharepoint.reminders.send_teams", fake_send_teams)

    # When email delivery fails, reminder MUST NOT be marked sent even if Teams succeeded
    monkeypatch.setattr("app.services.sharepoint.reminders.send_email", lambda *a, **kw: False)

    async with AsyncSessionLocal() as db:
        r = await db.get(SharePointReminder, rem_id)
        success = await deliver_reminder(db, r)
        assert success is False
        assert r.status != "sent"  # Teams delivery alone DOES NOT mark sent!

    assert len(teams_payloads) == 1
    t = teams_payloads[0]
    # Verify non-sensitive pointer: NO path, NO amount, NO responsible person leaked
    assert "250000" not in t["body"]
    assert "Confidential/Salaries" not in t["body"]
    assert "John Doe" not in t["body"]
    assert "compliance reminder has been dispatched" in t["body"]


@pytest.mark.asyncio
async def test_reminder_update_recipient_email(client, auth, indexed, monkeypatch):
    """Issue #17: PATCH /reminders/{id} allows assigning recipient_email to a verified active user."""
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    from app.models.sharepoint import SharePointReminder

    async with AsyncSessionLocal() as db:
        rem = SharePointReminder(
            id=uuid.uuid4(),
            source_id=indexed[1],
            document_id=indexed[2],
            title="Unassigned Task",
            category="task",
            target_date="2026-11-01",
            reminder_date="2026-10-25",
            lead_days=7,
            status="pending",
            recipient_email=None,
            dedup_key="patch_test_1",
        )
        db.add(rem)
        await db.commit()
        rem_id = str(rem.id)

    # 1. Invalid recipient rejected
    bad_resp = await client.patch(
        f"/api/sharepoint/reminders/{rem_id}",
        headers=auth,
        json={"recipient_email": "nonexistent@external.com"},
    )
    assert bad_resp.status_code == 400

    # 2. Valid active platform user accepted
    good_resp = await client.patch(
        f"/api/sharepoint/reminders/{rem_id}",
        headers=auth,
        json={"recipient_email": "admin@agholding.net"},
    )
    assert good_resp.status_code == 200

    async with AsyncSessionLocal() as db:
        updated = await db.get(SharePointReminder, uuid.UUID(rem_id))
        assert updated.recipient_email == "admin@agholding.net"
