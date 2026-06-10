import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_report_catalog_and_run(client, auth):
    cat = (await client.get("/api/reports/catalog", headers=auth)).json()
    keys = {c["key"] for c in cat}
    assert {"headcount_by_department", "joiners_by_month", "tenure_distribution"} <= keys
    assert any(c["sensitive"] for c in cat if c["key"] == "compensation_current")

    it = await _dept_id(client, auth, "IT")
    _, uid = await make_member(client, auth, "rep-emp@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={
        "department_id": it, "employment_type": "full_time", "hire_date": "2025-01-01",
    })

    rep = (await client.get("/api/reports/run/headcount_by_department", headers=auth)).json()
    assert rep["title"] and rep["columns"][0]["key"] == "department"
    assert any(r["department"] == "IT" for r in rep["rows"])

    csv = await client.get("/api/reports/run/headcount_by_department/export.csv", headers=auth)
    assert csv.status_code == 200 and "Department" in csv.text

    assert (await client.get("/api/reports/run/nope", headers=auth)).status_code == 404


async def test_employee_report_builder(client, auth):
    it = await _dept_id(client, auth, "IT")
    _, uid = await make_member(client, auth, "rep-build@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"department_id": it, "job_title": "Tech"})

    fields = (await client.get("/api/reports/employees/fields", headers=auth)).json()
    assert any(f["key"] == "display_name" for f in fields)

    rep = await client.post("/api/reports/employees", headers=auth, json={
        "columns": ["display_name", "department", "job_title"],
        "department_id": it,
    })
    assert rep.status_code == 200
    body = rep.json()
    assert [c["key"] for c in body["columns"]] == ["display_name", "department", "job_title"]
    row = next(r for r in body["rows"] if r["display_name"] == "rep-build")
    assert row["department"] == "IT" and row["job_title"] == "Tech"


async def test_reports_require_hr(client, auth):
    hdr, _ = await make_member(client, auth, "rep-nohr@agholding.net")
    assert (await client.get("/api/reports/catalog", headers=hdr)).status_code == 403


async def _dept_id(client, auth, name):
    depts = (await client.get("/api/departments", headers=auth)).json()
    return next(d["id"] for d in depts if d["name"] == name)
