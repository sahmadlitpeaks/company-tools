import json

import pytest

pytestmark = pytest.mark.asyncio

PLACEHOLDER = [
    {"type": "hero", "heading": "Your headline goes here", "buttonText": "Get started", "buttonUrl": "#"}
]
GOOD = [
    {"type": "hero", "heading": "Real Headline", "buttonText": "Buy", "buttonUrl": "https://x.com"},
    {"type": "text", "text": "Genuine supporting copy."},
]


async def test_publish_rejects_placeholder(client, auth):
    r = await client.post(
        "/api/landing-pages",
        headers=auth,
        json={"title": "Bad", "status": "published", "blocks": json.dumps(PLACEHOLDER)},
    )
    assert r.status_code == 422


async def test_publish_rejects_empty(client, auth):
    r = await client.post(
        "/api/landing-pages",
        headers=auth,
        json={"title": "Empty", "status": "published", "blocks": "[]"},
    )
    assert r.status_code == 422


async def test_draft_allows_placeholder(client, auth):
    r = await client.post(
        "/api/landing-pages",
        headers=auth,
        json={"title": "Draft", "status": "draft", "blocks": json.dumps(PLACEHOLDER)},
    )
    assert r.status_code == 201


async def test_publish_accepts_real_content(client, auth):
    r = await client.post(
        "/api/landing-pages",
        headers=auth,
        json={"title": "Good", "status": "published", "blocks": json.dumps(GOOD)},
    )
    assert r.status_code == 201
    assert r.json()["status"] == "published"
