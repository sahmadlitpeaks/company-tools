"""Bot defence: content rules, correlation across sites, blocklist, learning.

The failure this covers is a bot that fills in a plausible name, a valid
address and a bland sentence. Content matching alone scores that at zero, which
is why the layers below exist.
"""
import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _source(client, auth, name, **kw):
    payload = {"name": name, "dedup_window_min": 0}
    payload.update(kw)
    return (await client.post("/api/intake/sources", headers=auth, json=payload)).json()


def _send(client, src, **fields):
    body = {"name": "Someone", "email": "someone@acme.com", "message": "Hello there"}
    body.update(fields)
    return client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=body)


# ---- correlation across sites -------------------------------------------
async def test_the_same_message_hitting_several_sites_is_caught(client, auth):
    """The exact case content matching misses: polite, well-formed, and sent
    to every website we run."""
    text = "Hello, I am interested in your services. Please contact me back soon."
    site_a = await _source(client, auth, "Site A")
    site_b = await _source(client, auth, "Site B")
    site_c = await _source(client, auth, "Site C")

    first = await _send(client, site_a, name="Jane Roe", email="jane@acme.com", message=text)
    assert first.json()["status"] == "new"  # nothing to compare it against yet

    await _send(client, site_b, name="Jane Roe", email="jane@acme.com", message=text)
    third = await _send(client, site_c, name="Jane Roe", email="jane@acme.com", message=text)

    assert third.json()["status"] != "new"
    sub = (await client.get(f"/api/intake/submissions?source_id={site_c['id']}", headers=auth)).json()[0]
    assert any("websites" in r for r in sub["spam_reasons"])


async def test_a_sender_previously_marked_spam_is_held(client, auth):
    src = await _source(client, auth, "Repeat Site")
    for i in range(3):
        r = await _send(client, src, email="pest@spam.example", message=f"Buy now {i}")
        sub_id = r.json()["id"]
        await client.post(f"/api/intake/submissions/{sub_id}/mark-spam", headers=auth)

    again = await _send(
        client, src, email="pest@spam.example",
        message="Good afternoon, I would like to enquire about your services.",
    )
    assert again.json()["status"] != "new"


# ---- blocklist -----------------------------------------------------------
async def test_blocked_email_is_refused_without_storing_anything(client, auth):
    src = await _source(client, auth, "Blocked Site")
    await client.post("/api/intake/blocklist", headers=auth, json={
        "kind": "email", "value": "nuisance@spam.example", "reason": "Persistent",
    })
    r = await _send(client, src, email="nuisance@spam.example")
    assert r.status_code == 403
    subs = (await client.get(f"/api/intake/submissions?source_id={src['id']}", headers=auth)).json()
    assert subs == []


async def test_blocked_domain_and_keyword(client, auth):
    src = await _source(client, auth, "Filtered Site")
    await client.post("/api/intake/blocklist", headers=auth,
                      json={"kind": "domain", "value": "spam.example"})
    await client.post("/api/intake/blocklist", headers=auth,
                      json={"kind": "keyword", "value": "guest post"})
    assert (await _send(client, src, email="anyone@spam.example")).status_code == 403
    assert (await _send(client, src, message="I offer a guest post on your blog")).status_code == 403
    assert (await _send(client, src, email="fine@acme.com")).status_code == 200


async def test_allow_entry_overrides_a_block(client, auth):
    src = await _source(client, auth, "Override Site")
    await client.post("/api/intake/blocklist", headers=auth,
                      json={"kind": "domain", "value": "acme.com"})
    await client.post("/api/intake/blocklist", headers=auth, json={
        "kind": "email", "value": "vip@acme.com", "action": "allow", "reason": "Key client",
    })
    assert (await _send(client, src, email="random@acme.com")).status_code == 403
    vip = await _send(client, src, email="vip@acme.com")
    assert vip.status_code == 200 and vip.json()["status"] == "new"


async def test_blocklist_is_admin_only(client, auth):
    member, user_id = await make_member(client, auth, "spam-crm@agholding.net")
    await client.patch(f"/api/users/{user_id}", headers=auth,
                       json={"extra_permissions": ["crm"]})
    assert (await client.get("/api/intake/blocklist", headers=member)).status_code == 403
    assert (await client.post("/api/intake/blocklist", headers=member,
                              json={"kind": "ip", "value": "1.2.3.4"})).status_code == 403


async def test_blocklist_rejects_unknown_kinds(client, auth):
    r = await client.post("/api/intake/blocklist", headers=auth,
                          json={"kind": "astrology", "value": "leo"})
    assert r.status_code == 422


# ---- learning loop -------------------------------------------------------
async def test_releasing_and_rejecting_teaches_the_filter(client, auth):
    """A verdict a human already gave should change what happens next time."""
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models.intake import SpamToken

    src = await _source(client, auth, "Learning Site")
    for i in range(6):
        r = await _send(
            client, src, email=f"junk{i}@acme.com",
            message="Increase your revenue with our proven outreach programme today",
        )
        await client.post(f"/api/intake/submissions/{r.json()['id']}/mark-spam", headers=auth)

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(SpamToken).where(SpamToken.token == "outreach")
        )).scalar_one_or_none()
    assert row is not None and row.spam_count >= 6

    # A fresh message reusing that vocabulary now carries the learned penalty.
    fresh = await _send(
        client, src, email="new@acme.com",
        message="Increase your revenue with our proven outreach programme today",
    )
    sub = (await client.get(f"/api/intake/submissions/{fresh.json()['id']}", headers=auth)).json()
    assert any("previously-rejected" in r for r in sub["spam_reasons"] or [])


async def test_release_records_the_opposite_verdict(client, auth):
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models.intake import SpamToken

    src = await _source(client, auth, "Release Site")
    r = await _send(client, src, message="Please quote for scaffolding hire")
    await client.post(f"/api/intake/submissions/{r.json()['id']}/release", headers=auth)

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(SpamToken).where(SpamToken.token == "scaffolding")
        )).scalar_one_or_none()
    assert row is not None and row.ham_count == 1 and row.spam_count == 0


# ---- captcha -------------------------------------------------------------
async def test_required_captcha_rejects_a_missing_token(client, auth, monkeypatch):
    src = await _source(client, auth, "Guarded Site", captcha_mode="required")
    await client.put("/api/settings/captcha", headers=auth, json={
        "provider": "turnstile", "secret": "test-secret",
    })
    r = await _send(client, src)
    assert r.status_code == 403
    assert (await client.get(f"/api/intake/submissions?source_id={src['id']}", headers=auth)).json() == []


async def test_captcha_outage_quarantines_rather_than_dropping(client, auth, monkeypatch):
    """A third party being down must never silently bin a day of real leads."""
    from app.services.spam import captcha

    async def _unreachable(db, token, *, ip=None):
        return "unavailable", "Captcha provider unreachable (ConnectError)"

    monkeypatch.setattr(captcha, "verify", _unreachable)
    src = await _source(client, auth, "Outage Site", captcha_mode="required")
    r = await client.post(
        "/api/intake/ingest", headers={"X-API-Key": src["key"]},
        json={"name": "Jane", "email": "jane@acme.com", "message": "Quote please",
              "v": 2, "form": {"key": "cf7:1", "name": "Contact"},
              "fields": {"your-email": "jane@acme.com"},
              "meta": {"captcha_token": "tok"}},
    )
    assert r.status_code == 200
    assert r.json()["status"] != "new"


async def test_captcha_mode_off_ignores_the_whole_layer(client, auth):
    src = await _source(client, auth, "Open Site")
    await client.put("/api/settings/captcha", headers=auth, json={
        "provider": "turnstile", "secret": "test-secret",
    })
    assert (await _send(client, src)).json()["status"] == "new"


async def test_captcha_settings_never_return_the_secret(client, auth):
    await client.put("/api/settings/captcha", headers=auth, json={
        "provider": "turnstile", "site_key": "0x4AAA", "secret": "super-secret",
    })
    body = (await client.get("/api/settings/captcha", headers=auth)).json()
    assert body["secret_set"] is True and body["configured"] is True
    assert "super-secret" not in str(body)


async def test_captcha_settings_are_admin_only(client, auth):
    member, _ = await make_member(client, auth, "captcha-member@agholding.net")
    assert (await client.get("/api/settings/captcha", headers=member)).status_code == 403


# ---- timing --------------------------------------------------------------
async def test_a_form_completed_instantly_is_treated_as_automated(client, auth):
    src = await _source(client, auth, "Timed Site")
    r = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json={
        "v": 2, "form": {"key": "cf7:5", "name": "Contact"},
        "fields": {"your-name": "Jane", "your-email": "jane@acme.com",
                   "your-message": "I would like a quotation for your services."},
        "meta": {"elapsed_ms": 120},
    })
    sub = (await client.get(f"/api/intake/submissions/{r.json()['id']}", headers=auth)).json()
    assert any("120 ms" in reason for reason in sub["spam_reasons"])


async def test_the_websites_own_spam_verdict_is_weighed_not_obeyed(client, auth):
    """CF7 saying "spam" is evidence, not a reason to throw the lead away."""
    src = await _source(client, auth, "Flagged Site")
    r = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json={
        "v": 2, "form": {"key": "cf7:6", "name": "Contact"},
        "fields": {"your-name": "Jane", "your-email": "jane@acme.com",
                   "your-message": "I would like a quotation for your services."},
        "meta": {"spam": True},
    })
    assert r.status_code == 200
    sub = (await client.get(f"/api/intake/submissions/{r.json()['id']}", headers=auth)).json()
    assert sub["status"] != "new"
    assert any("website's own" in reason for reason in sub["spam_reasons"])
