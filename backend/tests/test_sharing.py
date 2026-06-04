import pytest

pytestmark = pytest.mark.asyncio

PDF = b"%PDF-1.4\n%fake brochure\n"


async def _upload_brochure(client, auth):
    pid = (
        await client.post("/api/products", headers=auth, json={"name": "Widget"})
    ).json()["id"]
    r = await client.post(
        f"/api/products/{pid}/brochures",
        headers=auth,
        files={"file": ("report.pdf", PDF, "application/pdf")},
        data={"title": "Sample Report"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["is_public"] is False and body["share_code"] is None
    return body["id"]


async def test_brochure_share_flow(client, auth):
    bid = await _upload_brochure(client, auth)

    # Not public yet → public endpoints 404.
    assert (await client.get(f"/api/public/brochures/{bid}/meta")).status_code == 404
    assert (await client.get(f"/api/public/brochures/{bid}/download")).status_code == 404

    # Share → get a short code.
    share = await client.post(f"/api/products/brochures/{bid}/share", headers=auth)
    assert share.status_code == 200
    code = share.json()["share_code"]
    assert share.json()["is_public"] is True and code

    # Public viewer metadata + download now work.
    meta = await client.get(f"/api/public/brochures/{bid}/meta")
    assert meta.status_code == 200 and meta.json()["title"] == "Sample Report"
    dl = await client.get(f"/api/public/brochures/{bid}/download")
    assert dl.status_code == 200 and dl.content == PDF

    # The short link redirects to the flipbook viewer page.
    red = await client.get(f"/s/{code}", follow_redirects=False)
    assert red.status_code == 302 and red.headers["location"] == f"/b/{bid}"

    # Listing reflects the share.
    pid = (await client.get("/api/products", headers=auth)).json()[0]["id"]
    lst = (await client.get(f"/api/products/{pid}/brochures", headers=auth)).json()
    assert lst[0]["is_public"] is True and lst[0]["share_code"] == code

    # Re-sharing keeps the same code (stable URLs).
    again = await client.post(f"/api/products/brochures/{bid}/share", headers=auth)
    assert again.json()["share_code"] == code

    # Unshare → public access revoked and the short link goes dead.
    un = await client.post(f"/api/products/brochures/{bid}/unshare", headers=auth)
    assert un.status_code == 200 and un.json()["is_public"] is False
    assert (await client.get(f"/api/public/brochures/{bid}/meta")).status_code == 404
    assert (await client.get(f"/s/{code}", follow_redirects=False)).status_code == 404


async def test_asset_share_flow(client, auth):
    aid = (
        await client.post(
            "/api/assets",
            headers=auth,
            files={"file": ("deck.pdf", PDF, "application/pdf")},
        )
    ).json()["id"]

    assert (await client.get(f"/api/public/assets/{aid}/download")).status_code == 404

    share = await client.post(f"/api/assets/{aid}/share", headers=auth)
    assert share.status_code == 200
    code = share.json()["share_code"]

    dl = await client.get(f"/api/public/assets/{aid}/download")
    assert dl.status_code == 200 and dl.content == PDF
    red = await client.get(f"/s/{code}", follow_redirects=False)
    assert red.headers["location"] == f"/a/{aid}"

    lst = (await client.get("/api/assets", headers=auth)).json()
    assert lst[0]["is_public"] is True and lst[0]["share_code"] == code


# ---- Phase 2: access controls, versioning, bulk, dashboard, search ----


async def test_passcode_gate(client, auth):
    bid = await _upload_brochure(client, auth)
    share = await client.post(
        f"/api/products/brochures/{bid}/share",
        headers=auth,
        json={"passcode": "secret"},
    )
    assert share.status_code == 200 and share.json()["has_passcode"] is True

    meta = (await client.get(f"/api/public/brochures/{bid}/meta")).json()
    assert meta["requires_passcode"] is True

    # No / wrong passcode is rejected; correct one downloads.
    assert (await client.get(f"/api/public/brochures/{bid}/download")).status_code == 401
    bad = await client.get(f"/api/public/brochures/{bid}/download?passcode=nope")
    assert bad.status_code == 401
    ok = await client.get(f"/api/public/brochures/{bid}/download?passcode=secret")
    assert ok.status_code == 200 and ok.content == PDF


async def test_lead_capture_gate(client, auth):
    bid = await _upload_brochure(client, auth)
    await client.post(
        f"/api/products/brochures/{bid}/share",
        headers=auth,
        json={"require_lead": True},
    )
    meta = (await client.get(f"/api/public/brochures/{bid}/meta")).json()
    assert meta["requires_lead"] is True

    # Locked until a lead is captured.
    assert (await client.get(f"/api/public/brochures/{bid}/download")).status_code == 403
    lead = await client.post(
        f"/api/public/brochures/{bid}/lead",
        json={"name": "Jane", "email": "jane@acme.com"},
    )
    assert lead.status_code == 200
    lid = lead.json()["id"]
    ok = await client.get(f"/api/public/brochures/{bid}/download?lead={lid}")
    assert ok.status_code == 200

    # The download shows up as a CRM lead from the brochure.
    leads = (await client.get("/api/crm/leads?source=brochure", headers=auth)).json()
    assert any(l["email"] == "jane@acme.com" for l in leads)


async def test_expiry_recorded(client, auth):
    bid = await _upload_brochure(client, auth)
    share = await client.post(
        f"/api/products/brochures/{bid}/share",
        headers=auth,
        json={"expires_in_days": 7},
    )
    assert share.json()["expires_at"] is not None


async def test_versioning_keeps_link_live(client, auth):
    bid = await _upload_brochure(client, auth)
    code = (
        await client.post(f"/api/products/brochures/{bid}/share", headers=auth)
    ).json()["share_code"]

    v2 = await client.post(
        f"/api/products/brochures/{bid}/version",
        headers=auth,
        files={"file": ("report-v2.pdf", b"%PDF-1.4 v2", "application/pdf")},
        data={"note": "Q2 refresh"},
    )
    assert v2.status_code == 200
    body = v2.json()
    assert body["version"] == 2 and body["share_code"] == code  # link preserved

    versions = (
        await client.get(f"/api/products/brochures/{bid}/versions", headers=auth)
    ).json()
    assert len(versions) == 1 and versions[0]["version"] == 1

    # Old version is still downloadable; public download serves the new file.
    old = await client.get(
        f"/api/products/brochures/{bid}/versions/1/download", headers=auth
    )
    assert old.status_code == 200 and old.content == PDF
    new = await client.get(f"/api/public/brochures/{bid}/download")
    assert new.content == b"%PDF-1.4 v2"


async def test_dashboard_and_analytics(client, auth):
    bid = await _upload_brochure(client, auth)
    await client.post(f"/api/products/brochures/{bid}/share", headers=auth)
    await client.get(f"/api/public/brochures/{bid}/download")  # one open

    shares = (await client.get("/api/shares", headers=auth)).json()
    row = next(r for r in shares if r["id"] == bid)
    assert row["kind"] == "brochure"
    assert row["downloads"] == 1 and row["opens"] == 1
    assert row["last_opened"] is not None
    assert row["public_url"] == f"/b/{bid}"


async def test_bulk_asset_share(client, auth):
    ids = []
    for i in range(2):
        r = await client.post(
            "/api/assets",
            headers=auth,
            files={"file": (f"deck{i}.pdf", PDF, "application/pdf")},
        )
        ids.append(r.json()["id"])

    res = await client.post(
        "/api/assets/bulk", headers=auth, json={"ids": ids, "action": "share"}
    )
    assert res.status_code == 200 and res.json()["affected"] == 2
    listing = (await client.get("/api/assets", headers=auth)).json()
    assert all(a["is_public"] for a in listing if a["id"] in ids)

    await client.post(
        "/api/assets/bulk", headers=auth, json={"ids": ids, "action": "unshare"}
    )
    listing = (await client.get("/api/assets", headers=auth)).json()
    assert all(not a["is_public"] for a in listing if a["id"] in ids)


async def test_search_and_public_qr(client, auth):
    await _upload_brochure(client, auth)
    hits = (await client.get("/api/search?q=Sample", headers=auth)).json()["hits"]
    assert any(h["kind"] == "brochure" and "Sample" in h["title"] for h in hits)
    products = (await client.get("/api/search?q=Widget", headers=auth)).json()["hits"]
    assert any(h["kind"] == "product" for h in products)

    qr = await client.get("/api/public/qr.png?data=https://example.com/s/abc")
    assert qr.status_code == 200 and qr.headers["content-type"] == "image/png"


async def test_check_endpoint_gates(client, auth):
    bid = await _upload_brochure(client, auth)
    await client.post(
        f"/api/products/brochures/{bid}/share",
        headers=auth,
        json={"passcode": "open-sesame"},
    )
    # check is side-effect free: wrong passcode 401, right one 200, no download counted.
    assert (await client.get(f"/api/public/brochures/{bid}/check")).status_code == 401
    assert (
        await client.get(f"/api/public/brochures/{bid}/check?passcode=open-sesame")
    ).status_code == 200
    shares = (await client.get("/api/shares", headers=auth)).json()
    assert next(r for r in shares if r["id"] == bid)["downloads"] == 0
