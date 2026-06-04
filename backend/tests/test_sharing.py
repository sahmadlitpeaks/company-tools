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
