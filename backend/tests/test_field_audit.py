import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_profile_field_changes_audited(client, auth):
    _, uid = await make_member(client, auth, "audit-emp@agholding.net")

    # Admin edits a couple of HR fields.
    await client.patch(f"/api/profiles/{uid}", headers=auth, json={"job_title": "Engineer", "nationality": "PK"})
    # Change one again to produce a second entry for that field.
    await client.patch(f"/api/profiles/{uid}", headers=auth, json={"job_title": "Senior Engineer"})

    hist = (await client.get(f"/api/profiles/{uid}/field-history", headers=auth)).json()
    fields = [h["field"] for h in hist]
    assert "job_title" in fields and "nationality" in fields
    # Both job_title transitions are captured with their before/after values.
    jt = [h for h in hist if h["field"] == "job_title"]
    transitions = {(h["old_value"], h["new_value"]) for h in jt}
    assert (None, "Engineer") in transitions
    assert ("Engineer", "Senior Engineer") in transitions
    assert all(h["actor_name"] for h in jt)


async def test_field_history_restricted(client, auth):
    _, uid = await make_member(client, auth, "audit-subject@agholding.net")
    await client.patch(f"/api/profiles/{uid}", headers=auth, json={"job_title": "Analyst"})

    # A different non-HR member cannot read someone else's field history.
    other_hdr, _ = await make_member(client, auth, "audit-other@agholding.net")
    assert (await client.get(f"/api/profiles/{uid}/field-history", headers=other_hdr)).status_code == 403

    # The subject can read their own.
    subj_hdr, _ = await make_member(client, auth, "audit-subject@agholding.net")
    assert (await client.get(f"/api/profiles/{uid}/field-history", headers=subj_hdr)).status_code == 200


async def test_no_change_no_audit(client, auth):
    _, uid = await make_member(client, auth, "audit-nochange@agholding.net")
    await client.patch(f"/api/profiles/{uid}", headers=auth, json={"job_title": "Clerk"})
    before = len((await client.get(f"/api/profiles/{uid}/field-history", headers=auth)).json())
    # Setting the same value again records nothing.
    await client.patch(f"/api/profiles/{uid}", headers=auth, json={"job_title": "Clerk"})
    after = len((await client.get(f"/api/profiles/{uid}/field-history", headers=auth)).json())
    assert after == before
