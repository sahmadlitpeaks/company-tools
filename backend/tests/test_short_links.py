import pytest

pytestmark = pytest.mark.asyncio


async def test_short_link_get_and_head(client, auth):
    link = (
        await client.post(
            "/api/short-links", headers=auth, json={"target_url": "https://agholding.net"}
        )
    ).json()
    code = link["code"]

    got = await client.get(f"/s/{code}", follow_redirects=False)
    assert got.status_code == 302
    assert "agholding.net" in got.headers["location"]

    # HEAD must be supported (link previews / uptime checks / crawlers).
    head = await client.request("HEAD", f"/s/{code}", follow_redirects=False)
    assert head.status_code == 302
