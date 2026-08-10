import pytest


pytestmark = pytest.mark.asyncio


async def test_brand_identity_font_logo_and_latest_document_download(client, auth):
    created = await client.post(
        "/api/companies",
        headers=auth,
        json={"name": "Brand Tools", "base_font_size": 18},
    )
    assert created.status_code == 201
    brand = created.json()
    assert brand["base_font_size"] == 18

    invalid = await client.patch(
        f"/api/companies/{brand['id']}", headers=auth, json={"base_font_size": 30}
    )
    assert invalid.status_code == 422

    logo_bytes = b"\x89PNG\r\nbrand-logo"
    uploaded_logo = await client.post(
        f"/api/companies/{brand['id']}/logo",
        headers=auth,
        files={"file": ("logo.png", logo_bytes, "image/png")},
    )
    assert uploaded_logo.status_code == 200
    logo_download = await client.get(
        f"/api/companies/{brand['id']}/logo/download", headers=auth
    )
    assert logo_download.status_code == 200
    assert logo_download.content == logo_bytes

    document_bytes = b"brand-guideline-v1"
    document = await client.post(
        f"/api/companies/{brand['id']}/documents",
        headers=auth,
        data={"name": "Brand guideline", "category": "guideline"},
        files={"file": ("guideline.pdf", document_bytes, "application/pdf")},
    )
    assert document.status_code == 201
    latest = await client.get(
        f"/api/companies/documents/{document.json()['id']}/download", headers=auth
    )
    assert latest.status_code == 200
    assert latest.content == document_bytes


async def test_asset_preview_is_inline_and_sandboxed(client, auth):
    uploaded = await client.post(
        "/api/assets",
        headers=auth,
        files={"file": ("campaign.txt", b"campaign preview", "text/plain")},
    )
    assert uploaded.status_code == 201

    preview = await client.get(
        f"/api/assets/{uploaded.json()['id']}/preview", headers=auth
    )
    assert preview.status_code == 200
    assert preview.content == b"campaign preview"
    assert preview.headers["content-disposition"].startswith("inline")
    assert preview.headers["content-security-policy"].startswith("sandbox")
    assert preview.headers["x-content-type-options"] == "nosniff"


async def test_dynamic_qr_keeps_redirect_id_when_destination_changes(client, auth):
    brand = (
        await client.post("/api/companies", headers=auth, json={"name": "QR Brand"})
    ).json()
    created = await client.post(
        "/api/qrcodes",
        headers=auth,
        json={
            "label": "Campaign",
            "target_url": "https://example.com/first",
            "company_id": brand["id"],
            "fill_color": brand["primary_color"],
            "dynamic": True,
        },
    )
    assert created.status_code == 201
    qr = created.json()
    assert qr["dynamic"] is True
    assert qr["company_id"] == brand["id"]

    updated = await client.patch(
        f"/api/qrcodes/{qr['id']}",
        headers=auth,
        json={"target_url": "https://example.com/changed"},
    )
    assert updated.status_code == 200
    scanned = await client.get(f"/q/{qr['id']}", follow_redirects=False)
    assert scanned.status_code == 302
    assert scanned.headers["location"] == "https://example.com/changed"


async def test_new_employee_inherits_selected_department_access(client, auth):
    department = await client.post(
        "/api/departments",
        headers=auth,
        json={"name": "Campaign Operations", "permissions": ["dashboard", "campaigns"]},
    )
    assert department.status_code == 201
    created = await client.post(
        "/api/users",
        headers=auth,
        json={
            "display_name": "New Campaign User",
            "email": "new-campaign-user@example.com",
            "department_id": department.json()["id"],
            "send_invite": False,
        },
    )
    assert created.status_code == 201
    user = created.json()
    assert user["department_id"] == department.json()["id"]
    assert user["department_name"] == "Campaign Operations"
    assert "campaigns" in user["effective_permissions"]


async def test_digital_card_keeps_company_brand_reference(client, auth):
    brand = (
        await client.post("/api/companies", headers=auth, json={"name": "Card Brand"})
    ).json()
    card = await client.post(
        "/api/cards",
        headers=auth,
        json={
            "company_id": brand["id"],
            "company": brand["name"],
            "full_name": "Brand Employee",
            "accent_color": brand["primary_color"],
        },
    )
    assert card.status_code == 201
    assert card.json()["company_id"] == brand["id"]
