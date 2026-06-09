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
