import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_field_defs_and_values(client, auth):
    # Members can't define schema; admins can.
    hdr_m, uid = await make_member(client, auth, "cf-emp@agholding.net")
    assert (await client.post("/api/custom-fields/defs", headers=hdr_m, json={"key": "x", "label": "X"})).status_code == 403

    tshirt = await client.post("/api/custom-fields/defs", headers=auth, json={
        "section": "personal", "key": "T Shirt Size", "label": "T-shirt size",
        "field_type": "select", "options": ["S", "M", "L"],
    })
    assert tshirt.status_code == 201
    assert tshirt.json()["key"] == "t_shirt_size"  # slugified
    tid = tshirt.json()["id"]

    salary_band = await client.post("/api/custom-fields/defs", headers=auth, json={
        "section": "job", "key": "secret_note", "label": "Secret note", "sensitive": True,
    })
    sid = salary_band.json()["id"]

    # Duplicate key rejected.
    dup = await client.post("/api/custom-fields/defs", headers=auth, json={"key": "t_shirt_size", "label": "Dup"})
    assert dup.status_code == 409

    # Employee sets their own values and reads them back.
    await client.put(f"/api/custom-fields/values/{uid}", headers=hdr_m, json={
        "values": {tid: "L", sid: "hush"},
    })
    mine = (await client.get(f"/api/custom-fields/values/{uid}", headers=hdr_m)).json()
    by_key = {f["key"]: f for f in mine["fields"]}
    assert by_key["t_shirt_size"]["value"] == "L"
    assert by_key["secret_note"]["value"] == "hush" and mine["can_edit"] is True


async def test_value_visibility(client, auth):
    depts = (await client.get("/api/departments", headers=auth)).json()
    it = next(d["id"] for d in depts if d["name"] == "IT")  # IT has no `hr` perm
    hdr_mgr, mgr = await make_member(client, auth, "cf-mgr@agholding.net", role="manager")
    await client.patch(f"/api/users/{mgr}", headers=auth, json={"department_id": it})
    hdr_emp, emp = await make_member(client, auth, "cf-sub@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    pub = (await client.post("/api/custom-fields/defs", headers=auth, json={"key": "hobby", "label": "Hobby"})).json()
    sec = (await client.post("/api/custom-fields/defs", headers=auth, json={"key": "ssn", "label": "SSN", "sensitive": True})).json()
    await client.put(f"/api/custom-fields/values/{emp}", headers=auth, json={"values": {pub["id"]: "Chess", sec["id"]: "123"}})

    # Manager sees non-sensitive only.
    mview = (await client.get(f"/api/custom-fields/values/{emp}", headers=hdr_mgr)).json()
    keys = {f["key"] for f in mview["fields"]}
    assert "hobby" in keys and "ssn" not in keys
    assert mview["can_edit"] is False

    # Unrelated colleague gets nothing.
    hdr_other, _ = await make_member(client, auth, "cf-other@agholding.net")
    assert (await client.get(f"/api/custom-fields/values/{emp}", headers=hdr_other)).status_code == 403


async def test_custom_tables(client, auth):
    hdr, uid = await make_member(client, auth, "cf-tab@agholding.net")
    tbl = await client.post("/api/custom-fields/tables", headers=auth, json={
        "key": "dependents", "label": "Dependents",
        "columns": [{"key": "name", "label": "Name"}, {"key": "relation", "label": "Relation"}],
    })
    assert tbl.status_code == 201
    table_id = tbl.json()["id"]

    row = await client.post(f"/api/custom-fields/tables/{table_id}/rows/{uid}", headers=hdr, json={
        "data": {"name": "Sam", "relation": "Child"},
    })
    assert row.status_code == 201
    rid = row.json()["id"]

    vals = (await client.get(f"/api/custom-fields/values/{uid}", headers=hdr)).json()
    deps = next(t for t in vals["tables"] if t["key"] == "dependents")
    assert len(deps["rows"]) == 1 and deps["rows"][0]["data"]["name"] == "Sam"

    await client.patch(f"/api/custom-fields/rows/{rid}", headers=hdr, json={"data": {"name": "Sam", "relation": "Son"}})
    assert (await client.delete(f"/api/custom-fields/rows/{rid}", headers=hdr)).status_code == 204
    vals2 = (await client.get(f"/api/custom-fields/values/{uid}", headers=hdr)).json()
    assert next(t for t in vals2["tables"] if t["key"] == "dependents")["rows"] == []
