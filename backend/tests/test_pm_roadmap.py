"""Product roadmap (BRD 9A: RMP-01..07)."""
from helpers import make_member


async def _project(client, headers, key):
    r = await client.post("/api/pm/projects", headers=headers, json={"key": key, "name": f"{key} product"})
    assert r.status_code == 201, r.text
    return r.json()


async def _feature(client, headers, pid, title="Group bookings", **extra):
    r = await client.post(f"/api/pm/projects/{pid}/requirements", headers=headers,
                          json={"title": title, "scope": "Book for a group", "acceptance_criteria": "Ten seats at once", **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def _module(client, headers, pid, name):
    r = await client.post(f"/api/pm/projects/{pid}/modules", headers=headers, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


async def test_modules_are_editable_and_protected_while_in_use(client, auth):
    wims = await _project(client, auth, "WIMS")
    booking = await _module(client, auth, wims["id"], "Booking")
    crm = await _module(client, auth, wims["id"], "CRM")
    assert (await client.post(f"/api/pm/projects/{wims['id']}/modules", headers=auth, json={"name": "booking"})).status_code == 409
    r = await client.patch(f"/api/pm/modules/{crm['id']}", headers=auth, json={"name": "Membership", "position": 0})
    assert r.json()["name"] == "Membership"
    names = [m["name"] for m in (await client.get(f"/api/pm/projects/{wims['id']}/modules", headers=auth)).json()]
    assert names == ["Membership", "Booking"]

    feature = await _feature(client, auth, wims["id"])
    await client.patch(f"/api/pm/requirements/{feature['id']}/roadmap", headers=auth, json={"module_id": booking["id"]})
    r = await client.delete(f"/api/pm/modules/{booking['id']}", headers=auth)
    assert r.status_code == 409 and "archive" in r.json()["detail"]
    assert (await client.patch(f"/api/pm/modules/{booking['id']}", headers=auth, json={"archived": True})).status_code == 200
    assert (await client.delete(f"/api/pm/modules/{crm['id']}", headers=auth)).status_code == 204


async def test_roadmap_lists_features_across_projects_with_filters(client, auth):
    wims, lims = await _project(client, auth, "WIMS"), await _project(client, auth, "LIMS")
    booking = await _module(client, auth, wims["id"], "Booking")
    first = await _feature(client, auth, wims["id"])
    await _feature(client, auth, lims["id"], title="Sample tracking")
    await client.patch(f"/api/pm/requirements/{first['id']}/roadmap", headers=auth,
                       json={"module_id": booking["id"], "priority": "high", "horizon": "now", "target_quarter": "2027-Q1"})
    data = (await client.get("/api/pm/roadmap", headers=auth)).json()
    assert [p["key"] for p in data["projects"]] == ["LIMS", "WIMS"]
    by_title = {f["title"]: f for f in data["features"]}
    assert by_title["Group bookings"]["module_name"] == "Booking" and by_title["Group bookings"]["horizon"] == "now"
    assert by_title["Sample tracking"]["status"] == "proposed" and by_title["Sample tracking"]["horizon"] is None
    now = (await client.get("/api/pm/roadmap?horizon=now", headers=auth)).json()["features"]
    assert [f["title"] for f in now] == ["Group bookings"]
    unplanned = (await client.get("/api/pm/roadmap?horizon=none", headers=auth)).json()["features"]
    assert [f["title"] for f in unplanned] == ["Sample tracking"]
    r = await client.patch(f"/api/pm/requirements/{first['id']}/roadmap", headers=auth, json={"target_quarter": "Q1"})
    assert r.status_code == 422


async def test_roadmap_permissions_split_view_edit_and_decide(client, auth):
    wims = await _project(client, auth, "WIMS")
    feature = await _feature(client, auth, wims["id"])
    dev, dev_id = await make_member(client, auth, "dev@agholding.net")
    boss, boss_id = await make_member(client, auth, "boss@agholding.net")
    outsider, _ = await make_member(client, auth, "out@agholding.net")
    await client.post(f"/api/pm/projects/{wims['id']}/members", headers=auth, json={"user_id": dev_id, "role": "member"})
    url = f"/api/pm/requirements/{feature['id']}/roadmap"
    # Contributors read the roadmap but can't edit or decide.
    assert len((await client.get("/api/pm/roadmap", headers=dev)).json()["features"]) == 1
    r = await client.patch(url, headers=dev, json={"priority": "high"})
    assert r.status_code == 403 and "roadmap.edit" in r.json()["detail"]
    await client.patch(f"/api/pm/projects/{wims['id']}/members/{dev_id}", headers=auth, json={"allow": ["roadmap.edit"]})
    assert (await client.patch(url, headers=dev, json={"priority": "high"})).status_code == 200
    r = await client.patch(url, headers=dev, json={"horizon": "now"})
    assert r.status_code == 403 and "roadmap.decide" in r.json()["detail"]
    # Management review: roadmap.view_all reads every roadmap, nothing else.
    assert (await client.get("/api/pm/roadmap", headers=outsider)).json()["features"] == []
    await client.put(f"/api/access/users/{boss_id}", headers=auth, json={"allow": ["roadmap.view_all"]})
    seen = (await client.get("/api/pm/roadmap", headers=boss)).json()
    assert len(seen["features"]) == 1 and not seen["features"][0]["can_edit"]
    assert (await client.get(f"/api/pm/projects/{wims['id']}/issues", headers=boss)).status_code == 404
    # Every decision is audited.
    audit = (await client.get("/api/audit", headers=auth)).json()
    rows = audit if isinstance(audit, list) else audit.get("items", [])
    assert any("priority" in (row.get("summary") or "") and "REQ-1" in (row.get("summary") or "") for row in rows)


async def test_starting_an_approved_feature_creates_a_linked_epic_and_rolls_up(client, auth):
    wims, team = await _project(client, auth, "WIMS"), await _project(client, auth, "TEAM")
    feature = await _feature(client, auth, wims["id"])
    start = f"/api/pm/requirements/{feature['id']}/start"
    assert (await client.post(start, headers=auth, json={})).status_code == 409  # still proposed
    r = await client.patch(f"/api/pm/requirements/{feature['id']}/roadmap", headers=auth, json={"status": "in_progress"})
    assert r.status_code == 422
    await client.patch(f"/api/pm/requirements/{feature['id']}/roadmap", headers=auth, json={"status": "approved"})
    r = await client.post(start, headers=auth, json={"project_id": team["id"]})
    assert r.status_code == 201, r.text
    epic = r.json()["epic"]
    assert epic["key"] == "TEAM-1" and r.json()["feature"]["status"] == "in_progress"
    detail = (await client.get(f"/api/pm/issues/{epic['id']}", headers=auth)).json()
    assert detail["issue_type"] == "epic" and "WIMS-REQ-1" in detail["description"] and "Ten seats" in detail["description"]
    linked = (await client.get(f"/api/pm/issues/{epic['id']}/requirements", headers=auth)).json()
    assert [item["key"] for item in (linked if isinstance(linked, list) else linked["items"])] == ["WIMS-REQ-1"]

    stories = [(await client.post(f"/api/pm/projects/{team['id']}/issues", headers=auth,
                                  json={"summary": s, "issue_type": "story", "parent_id": epic["id"]})).json() for s in "AB"]
    await client.patch(f"/api/pm/issues/{stories[0]['id']}", headers=auth, json={"status": "done"})
    item = (await client.get("/api/pm/roadmap", headers=auth)).json()["features"][0]
    assert item["progress"] == {"done": 1, "total": 2, "percent": 50} and item["epics"][0]["key"] == "TEAM-1"
    await client.patch(f"/api/pm/issues/{stories[1]['id']}", headers=auth, json={"status": "done"})
    await client.patch(f"/api/pm/issues/{epic['id']}", headers=auth, json={"status": "done"})
    item = (await client.get("/api/pm/roadmap", headers=auth)).json()["features"][0]
    assert item["status"] == "done" and item["progress"]["percent"] == 100
    history = (await client.get(f"/api/pm/requirements/{feature['id']}", headers=auth)).json()
    assert any(e["action"] == "roadmap_started" for e in history.get("events", history.get("history", [])))
