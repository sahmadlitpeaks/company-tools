"""Org-wide module and feature switches.

Covers the layer that answers "is this switched on at all?", which sits above
role/department permissions: a switched-off module is closed to everybody,
administrators included, while the settings screen that flips it stays open.
"""
import pytest

from helpers import make_member


async def _set_disabled(client, auth, keys):
    return await client.put(
        "/api/settings/modules", headers=auth, json={"disabled": keys}
    )


@pytest.mark.asyncio
async def test_catalogue_lists_every_module_and_starts_all_on(client, auth):
    r = await client.get("/api/settings/modules", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["disabled"] == []

    by_key = {m["key"]: m for m in body["modules"]}
    assert "tasks" in by_key and "hr" in by_key
    assert all(m["enabled"] for m in body["modules"])

    # The dashboard is the home route, so it is present but not switchable.
    assert by_key["dashboard"]["locked"] is True
    assert by_key["tasks"]["locked"] is False

    # Modules that have named sub-features expose them; most have none.
    hr_features = {f["key"] for f in by_key["hr"]["features"]}
    assert hr_features == {
        "hr.payroll",
        "hr.benefits",
        "hr.reports",
        "hr.automations",
    }
    assert by_key["tasks"]["features"] == []


@pytest.mark.asyncio
async def test_disabled_module_is_closed_to_members_and_admins(client, auth):
    member, _ = await make_member(client, auth)
    assert (await client.get("/api/tasks", headers=member)).status_code == 200
    assert (await client.get("/api/tasks", headers=auth)).status_code == 200

    assert (await _set_disabled(client, auth, ["tasks"])).status_code == 200

    # Off for a member who holds the module by role...
    r = await client.get("/api/tasks", headers=member)
    assert r.status_code == 403
    assert "turned off" in r.json()["detail"]
    # ...and off for an administrator too, who holds every module.
    r = await client.get("/api/tasks", headers=auth)
    assert r.status_code == 403
    assert "turned off" in r.json()["detail"]

    # Nothing is deleted: switching it back on restores access.
    assert (await _set_disabled(client, auth, [])).status_code == 200
    assert (await client.get("/api/tasks", headers=auth)).status_code == 200


@pytest.mark.asyncio
async def test_settings_stay_reachable_so_a_module_can_be_switched_back_on(
    client, auth
):
    """Every module off must not lock the administrator out of the switch."""
    catalogue = (await client.get("/api/settings/modules", headers=auth)).json()
    everything = [m["key"] for m in catalogue["modules"] if not m["locked"]]
    assert (await _set_disabled(client, auth, everything)).status_code == 200

    r = await client.get("/api/settings/modules", headers=auth)
    assert r.status_code == 200
    assert set(r.json()["disabled"]) == set(everything)


@pytest.mark.asyncio
async def test_feature_switch_leaves_the_rest_of_its_module_working(client, auth):
    # Leave requests are a named part of Approvals.
    assert (await client.get("/api/leave/types", headers=auth)).status_code == 200
    assert (await client.get("/api/approvals", headers=auth)).status_code == 200

    assert (await _set_disabled(client, auth, ["approvals.leave"])).status_code == 200

    r = await client.get("/api/leave/types", headers=auth)
    assert r.status_code == 403
    assert "turned off" in r.json()["detail"]
    # The parent module carries on.
    assert (await client.get("/api/approvals", headers=auth)).status_code == 200


@pytest.mark.asyncio
async def test_switching_off_a_module_takes_its_features_with_it(client, auth):
    assert (await _set_disabled(client, auth, ["approvals"])).status_code == 200

    assert (await client.get("/api/leave/types", headers=auth)).status_code == 403

    body = (await client.get("/api/settings/modules", headers=auth)).json()
    approvals = next(m for m in body["modules"] if m["key"] == "approvals")
    leave = next(f for f in approvals["features"] if f["key"] == "approvals.leave")
    # Reads as off because its module is, without being listed as off itself —
    # so switching the module back on restores the feature as it was.
    assert leave["enabled"] is False
    assert leave["self_disabled"] is False


@pytest.mark.asyncio
async def test_feature_switch_does_not_change_who_may_reach_a_shared_surface(
    client, auth
):
    """Payslips and benefits are reachable by every employee for their own
    record, so the switch must gate existence, not widen the permission."""
    member, _ = await make_member(client, auth)
    assert (
        await client.get("/api/benefits/my/enrollments", headers=member)
    ).status_code == 200

    assert (await _set_disabled(client, auth, ["hr.benefits"])).status_code == 200
    r = await client.get("/api/benefits/my/enrollments", headers=member)
    assert r.status_code == 403
    assert "turned off" in r.json()["detail"]

    assert (await _set_disabled(client, auth, [])).status_code == 200
    assert (
        await client.get("/api/benefits/my/enrollments", headers=member)
    ).status_code == 200


@pytest.mark.asyncio
async def test_me_reports_what_is_switched_off(client, auth):
    await _set_disabled(client, auth, ["tasks", "approvals.leave"])

    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert me["disabled_modules"] == ["tasks"]
    assert me["disabled_features"] == ["approvals.leave"]
    # The grant itself is untouched — the SPA subtracts the disabled lists.
    assert "tasks" in me["effective_permissions"]


@pytest.mark.asyncio
async def test_disabled_module_stops_leaking_through_global_search(client, auth):
    await client.post(
        "/api/knowledge",
        headers=auth,
        json={"title": "Zanzibar handbook", "body": "policy", "category": "HR"},
    )
    found = (await client.get("/api/search?q=Zanzibar", headers=auth)).json()
    assert any("Zanzibar" in h["title"] for h in found["hits"])

    await _set_disabled(client, auth, ["knowledge"])
    found = (await client.get("/api/search?q=Zanzibar", headers=auth)).json()
    assert not any("Zanzibar" in h["title"] for h in found["hits"])


@pytest.mark.asyncio
async def test_dashboard_cannot_be_switched_off(client, auth):
    r = await _set_disabled(client, auth, ["dashboard"])
    assert r.status_code == 422
    assert "dashboard" in r.json()["detail"]


@pytest.mark.asyncio
async def test_unknown_keys_are_rejected(client, auth):
    r = await _set_disabled(client, auth, ["tasks", "not_a_module"])
    assert r.status_code == 422
    assert "not_a_module" in r.json()["detail"]
    # Rejected as a whole — the valid key in the same payload is not applied.
    assert (await client.get("/api/tasks", headers=auth)).status_code == 200


@pytest.mark.asyncio
async def test_only_admins_may_read_or_change_the_switches(client, auth):
    member, _ = await make_member(client, auth)
    assert (await client.get("/api/settings/modules", headers=member)).status_code == 403
    assert (await _set_disabled(client, member, ["tasks"])).status_code == 403


@pytest.mark.asyncio
async def test_toggle_changes_are_recorded_in_the_activity_log(client, auth):
    await _set_disabled(client, auth, ["tasks"])
    await _set_disabled(client, auth, [])

    log = (
        await client.get("/api/audit?action=settings.modules", headers=auth)
    ).json()
    summaries = [e["summary"] for e in log["items"]]
    assert "switched off tasks" in summaries
    assert "switched on tasks" in summaries
