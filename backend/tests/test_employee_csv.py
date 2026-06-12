import pytest

pytestmark = pytest.mark.asyncio


async def test_employee_csv_roundtrip_and_manager_link(client, auth):
    tmpl = await client.get("/api/users/template.csv", headers=auth)
    assert tmpl.status_code == 200 and "manager_email" in tmpl.text

    csv_body = (
        "email,display_name,department,job_title,role,status,hire_date,manager_email,employment_type\r\n"
        "boss.csv@agholding.net,The Boss,Management,CEO,manager,active,2020-01-01,,full_time\r\n"
        "rep.csv@agholding.net,A Report,Finance,Analyst,member,active,2024-06-01,boss.csv@agholding.net,full_time\r\n"
    )
    res = (await client.post(
        "/api/users/import", headers=auth,
        files={"file": ("emps.csv", csv_body, "text/csv")},
    )).json()
    assert res["created"] == 2 and res["errors"] == []

    users = (await client.get("/api/users?q=csv@agholding.net", headers=auth)).json()
    rep = next(u for u in users if u["email"] == "rep.csv@agholding.net")
    boss = next(u for u in users if u["email"] == "boss.csv@agholding.net")
    assert rep["manager_id"] == boss["id"] and rep["employment_type"] == "full_time"
    assert rep["hire_date"] == "2024-06-01"

    # Re-import updates rather than duplicating.
    res2 = (await client.post(
        "/api/users/import", headers=auth,
        files={"file": ("emps.csv", csv_body, "text/csv")},
    )).json()
    assert res2["updated"] == 2 and res2["created"] == 0

    export = await client.get("/api/users/export.csv", headers=auth)
    assert "rep.csv@agholding.net" in export.text and "boss.csv@agholding.net" in export.text


async def test_employee_import_requires_admin(client, auth):
    from helpers import make_member

    hdr, _ = await make_member(client, auth, "csv-nonadmin@agholding.net")
    body = "email,display_name\r\nx@agholding.net,X\r\n"
    r = await client.post("/api/users/import", headers=hdr, files={"file": ("e.csv", body, "text/csv")})
    assert r.status_code == 403
    assert (await client.get("/api/users/export.csv", headers=hdr)).status_code == 403
