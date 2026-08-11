"""Per-form field mapping over the wire: discovery, mapping, replay, limits."""
import hashlib
import hmac
import json
import time

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


CF7_SCHEMA = [
    {"name": "your-name", "basetype": "text", "label": "Your name", "required": True},
    {"name": "your-email", "basetype": "email", "label": "Your email"},
    {"name": "tel-123", "basetype": "tel", "label": "Phone"},
    # A label the guesser understands…
    {"name": "menu-456", "basetype": "select", "label": "Service", "options": ["Sales", "Support"]},
    # …and one it has no business guessing about.
    {"name": "menu-789", "basetype": "select", "label": "Budget range", "options": ["<10k", "10k+"]},
]


def envelope(fields, *, form_key="cf7:17", form_name="Contact form 1", schema=None, meta=None, **extra):
    body = {
        "v": 2,
        "site": {"url": "https://acme.com", "name": "Acme"},
        "form": {"key": form_key, "name": form_name},
        "fields": fields,
        "meta": meta if meta is not None else {"page_url": "https://acme.com/contact/"},
    }
    if schema:
        body["form"]["fields"] = schema
    body.update(extra)
    return body


async def _source(client, auth, **kw):
    payload = {"name": "Acme Website", "site_url": "https://acme.com"}
    payload.update(kw)
    return (await client.post("/api/intake/sources", headers=auth, json=payload)).json()


async def _only_submission(client, auth, source_id):
    subs = (await client.get(f"/api/intake/submissions?source_id={source_id}", headers=auth)).json()
    assert len(subs) == 1, subs
    return (await client.get(f"/api/intake/submissions/{subs[0]['id']}", headers=auth)).json()


# ---- backwards compatibility --------------------------------------------
async def test_ingest_v1_flat_body_unchanged(client, auth):
    """The original flat shape must behave exactly as it always has."""
    src = await _source(client, auth, name="Legacy Site")
    r = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json={
        "name": "Jane", "email": "jane@acme.com", "message": "Hello there", "budget": "10k",
    })
    assert r.status_code == 200
    sub = await _only_submission(client, auth, src["id"])
    assert sub["name"] == "Jane" and sub["email"] == "jane@acme.com"
    assert sub["payload"]["budget"] == "10k"
    # No form was involved, so no mapping was applied…
    assert sub["form_id"] is None and sub["mapping_status"] == "none"
    # …but the original body is kept regardless, so it stays re-mappable.
    assert sub["raw_payload"]["budget"] == "10k"


# ---- discovery and auto-mapping ------------------------------------------
async def test_cf7_envelope_creates_form_and_auto_maps(client, auth):
    src = await _source(client, auth)
    r = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"your-name": "Jane Roe", "your-email": "jane@acme.com",
         "tel-123": "+971 50 123 4567", "menu-456": "Sales", "menu-789": "10k+"},
        schema=CF7_SCHEMA,
    ))
    assert r.status_code == 200
    assert r.json()["form_id"]

    sub = await _only_submission(client, auth, src["id"])
    assert sub["name"] == "Jane Roe"
    assert sub["email"] == "jane@acme.com"
    assert sub["phone"] == "+971 50 123 4567"
    assert sub["form_name"] == "Contact form 1"
    assert sub["site_url"] == "https://acme.com"
    assert sub["page_url"] == "https://acme.com/contact/"

    forms = (await client.get("/api/intake/forms", headers=auth)).json()
    assert len(forms) == 1 and forms[0]["form_key"] == "cf7:17"
    assert forms[0]["mapping_status"] == "auto"

    detail = (await client.get(f"/api/intake/forms/{forms[0]['id']}", headers=auth)).json()
    names = {f["name"]: f for f in detail["fields"]}
    assert names["tel-123"]["label"] == "Phone"
    assert names["menu-456"]["options"] == ["Sales", "Support"]
    # A meaningful label rescues an otherwise opaque CF7 name.
    assert sub["subject"] == "Sales"
    # A label the guesser cannot place is left alone, not forced into a column —
    # but it is still kept, under its human label.
    assert sub["payload"]["menu-789"] == "10k+"
    assert sub["field_labels"]["menu-789"] == "Budget range"


async def test_catalogue_samples_never_store_raw_contact_details(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"your-email": "jane@acme.com", "tel-123": "+971501234567"},
    ))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    detail = (await client.get(f"/api/intake/forms/{form['id']}", headers=auth)).json()
    samples = {f["name"]: f["sample"] for f in detail["fields"]}
    assert samples["your-email"] == "j***@acme.com"
    assert "501234" not in samples["tel-123"]


async def test_ingest_schema_registers_fields_without_a_submission(client, auth):
    """An admin can configure the mapping before the first real enquiry."""
    src = await _source(client, auth)
    r = await client.post(
        "/api/intake/ingest/schema",
        headers={"X-API-Key": src["key"]},
        json={"form": {"key": "cf7:88", "name": "Careers", "fields": CF7_SCHEMA},
              "site": {"url": "https://acme.com"}},
    )
    assert r.status_code == 200 and r.json()["fields"] == len(CF7_SCHEMA)
    forms = (await client.get("/api/intake/forms", headers=auth)).json()
    assert any(f["form_key"] == "cf7:88" for f in forms)
    assert (await client.get(f"/api/intake/submissions?source_id={src['id']}", headers=auth)).json() == []


async def test_ping_reports_only_the_callers_own_site(client, auth):
    src = await _source(client, auth, name="Ping Site")
    await _source(client, auth, name="Someone Else")
    body = (await client.get("/api/intake/ingest/ping", headers={"X-API-Key": src["key"]})).json()
    assert body == {
        "ok": True, "site_name": "Ping Site", "signing_required": False,
        "timestamp_required": False, "captcha_mode": "off",
    }
    assert (await client.get("/api/intake/ingest/ping")).status_code == 401


# ---- the "never lose data" guarantee -------------------------------------
async def test_unmapped_custom_field_names_never_lose_data(client, auth):
    """A form using names nobody has mapped still yields a usable record."""
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"xyz-999": "Jane Roe", "abc-111": "jane@acme.com", "qqq-222": "+971 50 123 4567",
         "zzz-333": "Please send me a quotation for your consulting services."},
        form_key="cf7:42", form_name="Weird form",
    ))
    sub = await _only_submission(client, auth, src["id"])
    # Recovered by shape, and flagged so a human knows to check.
    assert sub["email"] == "jane@acme.com"
    assert sub["phone"] == "+971 50 123 4567"
    assert sub["mapping_status"] == "partial"
    assert any("recovered" in r.lower() for r in sub["spam_reasons"] or [])
    # Every original key survives verbatim.
    for key in ("xyz-999", "abc-111", "qqq-222", "zzz-333"):
        assert key in sub["raw_payload"]["fields"]


async def test_admin_edits_mapping_then_remaps_past_submissions(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"xyz-999": "Jane Roe", "abc-111": "jane@acme.com"},
        form_key="cf7:42", form_name="Weird form",
    ))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    before = await _only_submission(client, auth, src["id"])
    assert before["name"] != "Jane Roe"  # nothing could safely guess this

    mapping = {"version": 1, "rules": [
        {"sources": ["xyz-999"], "target": "name", "transform": ["trim"]},
        {"sources": ["abc-111"], "target": "email", "transform": ["trim"]},
    ]}
    saved = await client.put(
        f"/api/intake/forms/{form['id']}/mapping", headers=auth, json=mapping
    )
    assert saved.status_code == 200 and saved.json()["mapping_status"] == "mapped"

    first = (await client.post(
        f"/api/intake/forms/{form['id']}/remap", headers=auth, json={}
    )).json()
    assert first["updated"] == 1

    after = await _only_submission(client, auth, src["id"])
    assert after["name"] == "Jane Roe" and after["email"] == "jane@acme.com"

    # Re-applying the same mapping is a no-op, not a rewrite.
    second = (await client.post(
        f"/api/intake/forms/{form['id']}/remap", headers=auth, json={}
    )).json()
    assert second["updated"] == 0


async def test_remap_dry_run_changes_nothing(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"xyz-999": "Jane Roe"}, form_key="cf7:42",
    ))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    await client.put(f"/api/intake/forms/{form['id']}/mapping", headers=auth, json={
        "version": 1, "rules": [{"sources": ["xyz-999"], "target": "name"}],
    })
    dry = (await client.post(
        f"/api/intake/forms/{form['id']}/remap", headers=auth, json={"dry_run": True}
    )).json()
    assert dry["updated"] == 1 and dry["dry_run"] is True
    assert (await _only_submission(client, auth, src["id"]))["name"] != "Jane Roe"


async def test_preview_mapping_writes_nothing(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"xyz-999": "Jane Roe"}, form_key="cf7:42",
    ))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    preview = (await client.post(
        f"/api/intake/forms/{form['id']}/preview-mapping",
        headers=auth,
        json={"mapping": {"version": 1, "rules": [{"sources": ["xyz-999"], "target": "name"}]}},
    )).json()
    assert preview["items"][0]["core"]["name"] == "Jane Roe"
    # The preview showed the outcome; it must not have applied it.
    assert (await _only_submission(client, auth, src["id"]))["name"] != "Jane Roe"
    # Nothing was guessable here, so the form is still unmapped afterwards.
    assert (await client.get(f"/api/intake/forms/{form['id']}", headers=auth)).json()["mapping_status"] == "none"


async def test_preview_reports_targets_no_rule_feeds(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]},
                      json=envelope({"a-1": "x"}, form_key="cf7:1"))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    preview = (await client.post(
        f"/api/intake/forms/{form['id']}/preview-mapping", headers=auth,
        json={"mapping": {"version": 1, "rules": [{"sources": ["a-1"], "target": "name"}]},
              "sample": {"a-1": "x"}},
    )).json()
    assert "email" in preview["unmapped_targets"]


# ---- idempotency and limits ----------------------------------------------
async def test_external_id_makes_a_retry_harmless(client, auth):
    src = await _source(client, auth, dedup_window_min=0)
    body = envelope({"your-name": "Jane", "your-email": "jane@acme.com"}, external_id="abc-123")
    first = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=body)
    second = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=body)
    assert first.status_code == 200 and not first.json().get("deduped")
    assert second.json()["deduped"] is True and second.json()["id"] == first.json()["id"]
    subs = (await client.get(f"/api/intake/submissions?source_id={src['id']}", headers=auth)).json()
    assert len(subs) == 1


async def test_oversized_body_is_refused(client, auth):
    src = await _source(client, auth)
    huge = await client.post(
        "/api/intake/ingest", headers={"X-API-Key": src["key"]},
        json=envelope({"your-message": "x" * (300 * 1024)}),
    )
    assert huge.status_code == 413


async def test_field_values_are_truncated_not_rejected(client, auth):
    src = await _source(client, auth)
    r = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"your-name": "J" * 900, "your-email": "jane@acme.com"},
    ))
    assert r.status_code == 200
    sub = await _only_submission(client, auth, src["id"])
    assert len(sub["name"]) == 255


# ---- signatures ----------------------------------------------------------
async def test_timestamped_signature_and_replay_window(client, auth):
    src = await _source(client, auth, name="Signed", dedup_window_min=0)
    secret = (await client.post(
        f"/api/intake/sources/{src['id']}/signing-secret", headers=auth
    )).json()["signing_secret"]

    def send(body, *, stamp=None, secret_used=None):
        raw = json.dumps(body).encode()
        used = (secret_used or secret).encode()
        signed = (f"{stamp}.".encode() + raw) if stamp else raw
        headers = {
            "X-API-Key": src["key"],
            "X-Signature": "sha256=" + hmac.new(used, signed, hashlib.sha256).hexdigest(),
        }
        if stamp:
            headers["X-Timestamp"] = str(stamp)
        return client.post("/api/intake/ingest", headers=headers, content=raw)

    now = int(time.time())
    body = {"name": "Bob", "email": "bob@acme.com", "message": "hello there"}

    assert (await send(body, stamp=now)).status_code == 200
    # A captured request stops working once the window closes.
    assert (await send({**body, "message": "stale"}, stamp=now - 4000)).status_code == 401
    # Wrong secret is rejected whether or not it is timestamped.
    assert (await send({**body, "message": "forged"}, stamp=now, secret_used="nope")).status_code == 401
    # The older body-only scheme still works for existing integrations.
    assert (await send({**body, "message": "legacy"})).status_code == 200

    # …until the source demands timestamps.
    await client.patch(f"/api/intake/sources/{src['id']}", headers=auth,
                       json={"require_timestamp": True})
    assert (await send({**body, "message": "legacy again"})).status_code == 401
    assert (await send({**body, "message": "modern"}, stamp=int(time.time()))).status_code == 200


async def test_signing_secret_is_not_stored_in_the_clear(client, auth):
    """It is write-once and never displayed, so it has no reason to be readable."""
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models.intake import IntakeSource

    src = await _source(client, auth, name="Secret Site")
    secret = (await client.post(
        f"/api/intake/sources/{src['id']}/signing-secret", headers=auth
    )).json()["signing_secret"]

    async with AsyncSessionLocal() as db:
        stored = (await db.execute(
            select(IntakeSource.signing_secret).where(IntakeSource.name == "Secret Site")
        )).scalar_one()
    assert stored and stored != secret


# ---- permissions ---------------------------------------------------------
async def test_form_read_is_crm_but_mapping_edit_is_admin(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]},
                      json=envelope({"your-name": "Jane"}))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]

    member, user_id = await make_member(client, auth, "forms-crm@agholding.net")
    await client.patch(f"/api/users/{user_id}", headers=auth,
                       json={"extra_permissions": ["crm"]})

    # Triage staff need to see which form an enquiry came from.
    assert (await client.get("/api/intake/forms", headers=member)).status_code == 200
    assert (await client.get(f"/api/intake/forms/{form['id']}", headers=member)).status_code == 200

    # Changing how data is interpreted is an administrator's decision.
    for call in (
        client.patch(f"/api/intake/forms/{form['id']}", headers=member, json={"name": "x"}),
        client.put(f"/api/intake/forms/{form['id']}/mapping", headers=member,
                   json={"version": 1, "rules": []}),
        client.post(f"/api/intake/forms/{form['id']}/remap", headers=member, json={}),
        client.delete(f"/api/intake/forms/{form['id']}", headers=member),
    ):
        assert (await call).status_code == 403


async def test_forms_require_the_crm_module(client, auth):
    member, _ = await make_member(client, auth, "forms-nocrm@agholding.net")
    assert (await client.get("/api/intake/forms", headers=member)).status_code == 403
    assert (await client.get("/api/intake/routing-rules", headers=member)).status_code == 403


async def test_invalid_mapping_is_rejected(client, auth):
    src = await _source(client, auth)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]},
                      json=envelope({"your-name": "Jane"}))
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    for bad in (
        {"version": 1, "rules": [{"sources": ["a"], "target": "not_a_column"}]},
        {"version": 1, "rules": [{"sources": [], "target": "name"}]},
        {"version": 1, "rules": [{"sources": ["a"], "target": "name", "transform": ["explode"]}]},
    ):
        r = await client.put(f"/api/intake/forms/{form['id']}/mapping", headers=auth, json=bad)
        assert r.status_code == 422, bad


# ---- conversion carries provenance ---------------------------------------
async def test_converted_lead_carries_form_site_and_extras(client, auth):
    src = await _source(client, auth, auto_convert=True)
    await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=envelope(
        {"your-name": "Jane Roe", "your-email": "jane@acme.com",
         "your-message": "I would like a quotation for consulting.",
         "menu-789": "10k+"},
        schema=CF7_SCHEMA,
        meta={"page_url": "https://acme.com/contact/",
              "utm": {"utm_source": "google", "utm_campaign": "spring"}},
    ))
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    lead = next(le for le in leads if le["email"] == "jane@acme.com")
    assert lead["source"] == "web"
    assert lead["source_detail"] == "Acme Website · Contact form 1"
    assert lead["page_url"] == "https://acme.com/contact/"
    assert lead["intake_form_id"]
    # The unmapped dropdown is still visible on the lead, under its real label.
    assert any(f["label"] == "Budget range" and f["value"] == "10k+" for f in lead["fields"])

    sub = await _only_submission(client, auth, src["id"])
    assert sub["utm"]["utm_source"] == "google"
