import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_hr_overview_gated_and_populated(client, auth):
    # A plain member can't reach the HR dashboard.
    hdr_m, _ = await make_member(client, auth, "hrov-mem@agholding.net")
    assert (await client.get("/api/hr/overview", headers=hdr_m)).status_code == 403

    # Granting the `hr` module opens it up (without making them an admin).
    users = (await client.get("/api/users", headers=auth)).json()
    uid = next(u["id"] for u in users if u["email"] == "hrov-mem@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"extra_permissions": ["hr"]})
    assert (await client.get("/api/hr/overview", headers=hdr_m)).status_code == 200

    ov = (await client.get("/api/hr/overview", headers=auth)).json()
    assert ov["headcount"] >= 1
    assert isinstance(ov["by_department"], list)
    assert "open_review_cycles" in ov and "docs_expiring" in ov


async def test_hr_permission_grants_sensitive_access(client, auth):
    # Someone with the `hr` module (not admin) can view compensation/documents.
    hdr_hr, hr_uid = await make_member(client, auth, "hr-staff@agholding.net")
    await client.patch(f"/api/users/{hr_uid}", headers=auth, json={"extra_permissions": ["hr"]})

    _, emp = await make_member(client, auth, "hr-subject@agholding.net")
    await client.post(
        f"/api/compensation/by-user/{emp}", headers=auth,
        json={"record_type": "salary", "amount": "1000", "pay_period": "monthly"},
    )
    # HR staff can read it; a plain member still cannot.
    assert (await client.get(f"/api/compensation/by-user/{emp}", headers=hdr_hr)).status_code == 200
    hdr_other, _ = await make_member(client, auth, "hr-nope@agholding.net")
    assert (await client.get(f"/api/compensation/by-user/{emp}", headers=hdr_other)).status_code == 403
