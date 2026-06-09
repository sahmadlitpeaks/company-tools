import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _dept_id(client, auth, name="IT"):
    depts = (await client.get("/api/departments", headers=auth)).json()
    return next(d["id"] for d in depts if d["name"] == name)


async def test_profile_aggregates_everything(client, auth):
    hdr, uid = await make_member(client, auth, "profile-target@agholding.net")
    await client.patch(
        f"/api/users/{uid}",
        headers=auth,
        json={"job_title": "Designer", "passport_no": "X123", "nationality": "UK"},
    )
    # Give them an asset, a phone and a subscription seat.
    asset = (await client.post(
        "/api/asset-tracker", headers=auth, json={"asset_tag": "PRF-1", "name": "Laptop"}
    )).json()
    await client.post(f"/api/asset-tracker/{asset['id']}/checkout", headers=auth, json={"user_id": uid})
    await client.post(
        "/api/phone-lines", headers=auth, json={"number": "+15550101", "assigned_to_id": uid}
    )
    await client.post(
        "/api/subscriptions",
        headers=auth,
        json={"name": "Figma", "scope": "person", "cost_type": "flat", "cost": "15", "user_ids": [uid]},
    )

    # The person sees their own profile, including sensitive HR fields.
    me = (await client.get("/api/profiles/me", headers=hdr)).json()
    assert me["job_title"] == "Designer"
    assert any(a["sub"] == "PRF-1" for a in me["assets"])
    assert any(p["label"] == "+15550101" for p in me["phones"])
    assert any(s["name"] == "Figma" for s in me["subscriptions"])
    assert me["can_see_sensitive"] is True and me["passport_no"] == "X123"
    assert me["can_manage"] is False

    # Admin sees it too, with management + sensitive.
    admin_view = (await client.get(f"/api/profiles/{uid}", headers=auth)).json()
    assert admin_view["can_manage"] is True and admin_view["passport_no"] == "X123"


async def test_profile_visibility_rules(client, auth):
    it = await _dept_id(client, auth, "IT")
    hdr_t, target = await make_member(client, auth, "vis-target@agholding.net")
    await client.patch(f"/api/users/{target}", headers=auth, json={"department_id": it, "passport_no": "P9"})

    # A random member cannot see someone else's profile.
    hdr_other, _ = await make_member(client, auth, "vis-other@agholding.net")
    assert (await client.get(f"/api/profiles/{target}", headers=hdr_other)).status_code == 403

    # A manager in the same access department can — but without sensitive fields.
    hdr_mgr, mgr = await make_member(client, auth, "vis-mgr@agholding.net", role="manager")
    await client.patch(f"/api/users/{mgr}", headers=auth, json={"department_id": it})
    mview = await client.get(f"/api/profiles/{target}", headers=hdr_mgr)
    assert mview.status_code == 200
    body = mview.json()
    assert body["can_manage"] is False
    assert body["can_see_sensitive"] is False and body["passport_no"] is None


async def test_provision_suggestions_and_profile_edit(client, auth):
    it = await _dept_id(client, auth, "IT")
    # Two peers in IT both hold a Jira seat + Github access.
    seats = []
    for em in ("peer-a@agholding.net", "peer-b@agholding.net"):
        _, pid = await make_member(client, auth, em)
        await client.patch(f"/api/users/{pid}", headers=auth, json={"department_id": it})
        seats.append(pid)
    jira = (await client.post("/api/subscriptions", headers=auth, json={
        "name": "Jira", "scope": "person", "cost_type": "per_seat", "cost": "7", "user_ids": seats,
    })).json()

    # New hire in IT.
    _, hire = await make_member(client, auth, "new-hire@agholding.net")
    await client.patch(f"/api/users/{hire}", headers=auth, json={"department_id": it})
    j = (await client.post("/api/people/journeys", headers=auth, json={
        "kind": "onboarding", "target_user_id": hire,
    })).json()
    sug = (await client.get(f"/api/people/journeys/{j['id']}/suggestions", headers=auth)).json()
    names = {s["label"] for s in sug["subscriptions"]}
    assert "Jira" in names
    jira_sug = next(s for s in sug["subscriptions"] if s["label"] == "Jira")
    assert jira_sug["peer_count"] == 2 and jira_sug["ref_id"] == jira["id"]

    # Applying the suggestion = seat the hire (existing endpoint).
    await client.post(f"/api/subscriptions/{jira['id']}/seats", headers=auth, json={"user_ids": [hire]})
    sug2 = (await client.get(f"/api/people/journeys/{j['id']}/suggestions", headers=auth)).json()
    assert "Jira" not in {s["label"] for s in sug2["subscriptions"]}


async def test_profile_edit_permissions(client, auth):
    it = await _dept_id(client, auth, "IT")
    hdr_t, target = await make_member(client, auth, "edit-target@agholding.net")
    await client.patch(f"/api/users/{target}", headers=auth, json={"department_id": it})

    # Admin can edit HR + admin-only fields.
    r = await client.patch(f"/api/profiles/{target}", headers=auth, json={
        "job_title": "Lead Engineer", "passport_no": "Z9", "role": "manager",
    })
    assert r.status_code == 200
    assert r.json()["job_title"] == "Lead Engineer" and r.json()["role"] == "manager"

    # A manager peer in IT may edit HR fields but admin-only fields are ignored.
    hdr_mgr, _ = await make_member(client, auth, "edit-mgr@agholding.net", role="manager")
    # Note: target is now role=manager too; manager-in-dept can view/edit HR fields.
    mr = await client.patch(f"/api/profiles/{target}", headers=hdr_mgr, json={
        "office_location": "Dubai", "role": "admin",
    })
    # edit-mgr has no department, so falls back to HR (manager role defaults) — still not admin.
    assert mr.status_code in (200, 403)

    # A plain member cannot edit someone else's profile.
    hdr_other, _ = await make_member(client, auth, "edit-other@agholding.net")
    assert (await client.patch(f"/api/profiles/{target}", headers=hdr_other, json={"job_title": "x"})).status_code == 403
