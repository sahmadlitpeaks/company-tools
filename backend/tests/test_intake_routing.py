"""Routing website submissions: which are job applications, and where they go.

A careers form and a sales enquiry arrive through the same webhook in the same
shape. These tests cover telling them apart on this side, and keeping applicants
(and their CVs) out of the sales pipeline.
"""
import base64

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _source(client, auth, name="Careers Site", **kw):
    payload = {"name": name, "site_url": "https://acme.com",
               "auto_convert": True, "dedup_window_min": 0}
    payload.update(kw)
    return (await client.post("/api/intake/sources", headers=auth, json=payload)).json()


def _apply(client, src, *, fields, form_key="cf7:99", form_name="Careers form",
           page_url="https://acme.com/careers/apply/", files=None):
    body = {
        "v": 2,
        "site": {"url": "https://acme.com", "name": "Acme"},
        "form": {"key": form_key, "name": form_name},
        "fields": fields,
        "meta": {"page_url": page_url},
    }
    if files:
        body["files"] = files
    return client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json=body)


async def _rule(client, auth, **kw):
    payload = {
        "name": "Careers pages are applications",
        "conditions": [{"kind": "page_url", "op": "contains", "value": "/careers"}],
        "outcome": {"type": "job_application", "destination": "candidate"},
    }
    payload.update(kw)
    return await client.post("/api/intake/routing-rules", headers=auth, json=payload)


async def _candidates(client, auth):
    jobs = (await client.get("/api/recruiting/jobs", headers=auth)).json()
    out = []
    for job in jobs:
        pipeline = (await client.get(
            f"/api/recruiting/jobs/{job['id']}/pipeline", headers=auth
        )).json()
        for stage in pipeline.values():
            out.extend(stage)
    return out


# ---- classification ------------------------------------------------------
async def test_a_careers_page_submission_becomes_a_candidate_not_a_lead(client, auth):
    src = await _source(client, auth)
    assert (await _rule(client, auth)).status_code == 201

    r = await _apply(client, src, fields={
        "your-name": "Jane Roe", "your-email": "jane@acme.com",
        "your-message": "I would like to apply for the marketing role.",
    })
    assert r.status_code == 200

    subs = (await client.get(f"/api/intake/submissions?source_id={src['id']}", headers=auth)).json()
    assert subs[0]["type"] == "job_application"
    assert subs[0]["converted_candidate_id"]
    assert subs[0]["converted_lead_id"] is None

    candidates = await _candidates(client, auth)
    jane = next(c for c in candidates if c["email"] == "jane@acme.com")
    assert jane["source"] == "website" and jane["stage"] == "applied"

    # The sales pipeline is left completely alone.
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    assert not any(le["email"] == "jane@acme.com" for le in leads)


async def test_a_contact_page_submission_on_the_same_site_still_becomes_a_lead(client, auth):
    src = await _source(client, auth)
    await _rule(client, auth)
    await _apply(
        client, src, form_key="cf7:1", form_name="Contact form",
        page_url="https://acme.com/contact/",
        fields={"your-name": "Bob Buyer", "your-email": "bob@acme.com",
                "your-message": "Please send me a quotation for consulting."},
    )
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    assert any(le["email"] == "bob@acme.com" for le in leads)
    assert not any(c["email"] == "bob@acme.com" for c in await _candidates(client, auth))


async def test_a_field_value_can_classify_without_a_dedicated_form(client, auth):
    """One form with an "I am enquiring about" dropdown, two destinations."""
    src = await _source(client, auth)
    await _rule(
        client, auth,
        name="Enquiry type says careers",
        conditions=[{"kind": "field", "field": "enquiry-type", "op": "equals", "value": "Careers"}],
        outcome={"type": "job_application", "destination": "candidate"},
    )
    await _apply(
        client, src, page_url="https://acme.com/contact/",
        fields={"your-name": "Ann Applicant", "your-email": "ann@acme.com",
                "enquiry-type": "Careers", "your-message": "CV attached."},
    )
    assert any(c["email"] == "ann@acme.com" for c in await _candidates(client, auth))


async def test_lower_priority_number_wins(client, auth):
    src = await _source(client, auth)
    await _rule(
        client, auth, name="Catch-all careers", priority=50,
        conditions=[{"kind": "page_url", "op": "contains", "value": "/careers"}],
        outcome={"type": "job_application", "destination": "candidate"},
    )
    await _rule(
        client, auth, name="Everything is a lead", priority=10,
        conditions=[{"kind": "page_url", "op": "contains", "value": "acme.com"}],
        outcome={"type": "lead", "destination": "crm_lead"},
    )
    await _apply(client, src, fields={
        "your-name": "Priority Test", "your-email": "prio@acme.com",
        "your-message": "Applying for a role at your company.",
    })
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    assert any(le["email"] == "prio@acme.com" for le in leads)


async def test_a_rule_with_no_conditions_is_refused(client, auth):
    """An empty rule would silently capture every submission on the site."""
    r = await _rule(client, auth, conditions=[])
    assert r.status_code == 422


async def test_a_malformed_regex_does_not_break_ingestion(client, auth):
    src = await _source(client, auth)
    await _rule(
        client, auth, name="Broken pattern",
        conditions=[{"kind": "page_url", "op": "regex", "value": "([unclosed"}],
        outcome={"destination": "candidate"},
    )
    r = await _apply(client, src, fields={
        "your-name": "Still Works", "your-email": "ok@acme.com",
        "your-message": "A perfectly ordinary enquiry about your services.",
    })
    assert r.status_code == 200


# ---- job resolution ------------------------------------------------------
async def test_an_application_is_never_blocked_by_an_unknown_role(client, auth):
    """`Candidate.job_id` is mandatory, so a catch-all opening is created."""
    src = await _source(client, auth)
    await _rule(client, auth)
    await _apply(client, src, fields={
        "your-name": "No Role", "your-email": "norole@acme.com",
        "your-message": "I would like to join your team.",
    })
    jobs = (await client.get("/api/recruiting/jobs", headers=auth)).json()
    assert any(j["title"] == "General Applications" for j in jobs)
    assert any(c["email"] == "norole@acme.com" for c in await _candidates(client, auth))


async def test_the_position_field_picks_the_matching_opening(client, auth):
    job = (await client.post("/api/recruiting/jobs", headers=auth, json={
        "title": "Marketing Manager", "status": "open",
    })).json()
    src = await _source(client, auth)
    await _rule(
        client, auth,
        outcome={"type": "job_application", "destination": "candidate",
                 "job_from_field": "position"},
    )
    await _apply(client, src, fields={
        "your-name": "Match Me", "your-email": "match@acme.com",
        "position": "marketing manager",
        "your-message": "Please consider my application.",
    })
    pipeline = (await client.get(
        f"/api/recruiting/jobs/{job['id']}/pipeline", headers=auth
    )).json()
    assert any(c["email"] == "match@acme.com" for stage in pipeline.values() for c in stage)


async def test_a_form_can_pin_its_own_opening(client, auth):
    job = (await client.post("/api/recruiting/jobs", headers=auth, json={
        "title": "Site Engineer", "status": "open",
    })).json()
    src = await _source(client, auth)
    await _rule(client, auth)
    await _apply(client, src, fields={"your-name": "First", "your-email": "first@acme.com",
                                      "your-message": "Applying now for the role."})
    form = (await client.get("/api/intake/forms", headers=auth)).json()[0]
    await client.patch(f"/api/intake/forms/{form['id']}", headers=auth, json={"job_id": job["id"]})

    await _apply(client, src, fields={"your-name": "Second", "your-email": "second@acme.com",
                                      "your-message": "Applying for the engineering role."})
    pipeline = (await client.get(
        f"/api/recruiting/jobs/{job['id']}/pipeline", headers=auth
    )).json()
    assert any(c["email"] == "second@acme.com" for stage in pipeline.values() for c in stage)


# ---- CVs -----------------------------------------------------------------
def _pdf(size=2048):
    return base64.b64encode(b"%PDF-1.4\n" + b"x" * size).decode()


async def test_an_attached_cv_is_stored_on_the_candidate(client, auth):
    src = await _source(client, auth)
    await _rule(client, auth)
    await _apply(
        client, src,
        fields={"your-name": "With CV", "your-email": "cv@acme.com",
                "your-message": "My CV is attached for your consideration."},
        files=[{"field": "cv", "name": "jane-roe.pdf",
                "mime": "application/pdf", "data": _pdf()}],
    )
    candidate = next(c for c in await _candidates(client, auth) if c["email"] == "cv@acme.com")
    detail = (await client.get(
        f"/api/recruiting/candidates/{candidate['id']}", headers=auth
    )).json()
    assert detail["resume_path"]
    assert (await client.get(
        f"/api/recruiting/candidates/{candidate['id']}/resume", headers=auth
    )).status_code == 200


async def test_an_unusable_cv_never_costs_us_the_application(client, auth):
    src = await _source(client, auth)
    await _rule(client, auth)
    await _apply(
        client, src,
        fields={"your-name": "Bad CV", "your-email": "badcv@acme.com",
                "your-message": "Applying with my attached document."},
        files=[{"field": "cv", "name": "resume.exe", "data": _pdf()}],
    )
    candidate = next(c for c in await _candidates(client, auth) if c["email"] == "badcv@acme.com")
    detail = (await client.get(
        f"/api/recruiting/candidates/{candidate['id']}", headers=auth
    )).json()
    assert detail["resume_path"] is None
    # …but the reason is recorded rather than swallowed.
    assert "resume.exe" in (detail["notes"] or "")


# ---- manual conversion ---------------------------------------------------
async def test_manual_conversion_is_idempotent_and_refuses_the_wrong_target(client, auth):
    src = await _source(client, auth, auto_convert=False)
    await _rule(client, auth)
    r = await _apply(client, src, fields={
        "your-name": "Manual", "your-email": "manual@acme.com",
        "your-message": "I am applying for a position with your company.",
    })
    sub_id = r.json()["id"]

    first = await client.post(f"/api/intake/submissions/{sub_id}/convert-candidate", headers=auth)
    assert first.status_code == 200
    second = await client.post(f"/api/intake/submissions/{sub_id}/convert-candidate", headers=auth)
    assert second.status_code == 409

    # An application must not be forced into the sales pipeline by hand either.
    as_lead = await client.post(f"/api/intake/submissions/{sub_id}/convert-lead", headers=auth)
    assert as_lead.status_code == 422


async def test_converting_to_a_candidate_needs_the_recruiting_module(client, auth):
    """CRM access is not access to applicants."""
    src = await _source(client, auth, auto_convert=False)
    await _rule(client, auth)
    r = await _apply(client, src, fields={
        "your-name": "Private", "your-email": "private@acme.com",
        "your-message": "Applying for the advertised vacancy.",
    })
    member, user_id = await make_member(client, auth, "routing-crm@agholding.net")
    await client.patch(f"/api/users/{user_id}", headers=auth,
                       json={"extra_permissions": ["crm"]})
    denied = await client.post(
        f"/api/intake/submissions/{r.json()['id']}/convert-candidate", headers=member
    )
    assert denied.status_code == 403


# ---- rule management -----------------------------------------------------
async def test_rule_tester_reports_the_matching_rule_without_side_effects(client, auth):
    src = await _source(client, auth, auto_convert=False)
    created = (await _rule(client, auth)).json()
    r = await _apply(client, src, fields={
        "your-name": "Tester", "your-email": "tester@acme.com",
        "your-message": "Applying for a role at your organisation.",
    })
    result = (await client.post("/api/intake/routing-rules/test", headers=auth,
                                json={"submission_id": r.json()["id"]})).json()
    assert result["rule_name"] == created["name"]
    assert result["destination"] == "candidate"
    assert result["type"] == "job_application"

    # Testing must not inflate the rule's usage counter.
    rules = (await client.get("/api/intake/routing-rules", headers=auth)).json()
    before = next(x for x in rules if x["id"] == created["id"])["match_count"]
    await client.post("/api/intake/routing-rules/test", headers=auth,
                      json={"submission_id": r.json()["id"]})
    rules = (await client.get("/api/intake/routing-rules", headers=auth)).json()
    assert next(x for x in rules if x["id"] == created["id"])["match_count"] == before


async def test_rules_are_readable_by_crm_but_editable_only_by_admins(client, auth):
    created = (await _rule(client, auth)).json()
    member, user_id = await make_member(client, auth, "rules-crm@agholding.net")
    await client.patch(f"/api/users/{user_id}", headers=auth,
                       json={"extra_permissions": ["crm"]})

    assert (await client.get("/api/intake/routing-rules", headers=member)).status_code == 200
    for call in (
        client.post("/api/intake/routing-rules", headers=member,
                    json={"name": "x", "conditions": [{"kind": "page_url", "value": "/x"}]}),
        client.patch(f"/api/intake/routing-rules/{created['id']}", headers=member,
                     json={"active": False}),
        client.delete(f"/api/intake/routing-rules/{created['id']}", headers=member),
    ):
        assert (await call).status_code == 403


async def test_unknown_destination_or_type_is_rejected(client, auth):
    bad_dest = await _rule(client, auth, outcome={"destination": "the_bin"})
    assert bad_dest.status_code == 422
    bad_type = await _rule(client, auth, outcome={"type": "telepathy"})
    assert bad_type.status_code == 422
