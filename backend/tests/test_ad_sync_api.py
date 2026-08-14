import pytest


@pytest.mark.asyncio
async def test_sync_requires_admin(client):
    r = await client.post("/api/campaigns/sync")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_sync_returns_a_result_per_provider(client, auth):
    r = await client.post("/api/campaigns/sync", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert {item["provider"] for item in body} == {"meta", "google_ads", "tiktok"}
    # Nothing is configured in a fresh test DB, so every provider is skipped.
    assert all(item["skipped"] for item in body)


@pytest.mark.asyncio
async def test_sync_can_target_one_provider(client, auth):
    r = await client.post(
        "/api/campaigns/sync", headers=auth, json={"providers": ["tiktok"]}
    )
    assert r.status_code == 200
    assert [item["provider"] for item in r.json()] == ["tiktok"]


@pytest.mark.asyncio
async def test_unknown_provider_is_rejected(client, auth):
    r = await client.post(
        "/api/campaigns/sync", headers=auth, json={"providers": ["myspace"]}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_skipped_providers_do_not_record_a_run(client, auth):
    """An unconfigured provider must not log a run row, or the table would grow
    by three rows a night for platforms nobody uses and the status strip would
    show failures for integrations that were never set up."""
    await client.post("/api/campaigns/sync", headers=auth)
    r = await client.get("/api/campaigns/sync/runs", headers=auth)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_runs_endpoint_reports_a_provider_that_actually_ran(
    client, auth, monkeypatch
):
    from app.core.database import AsyncSessionLocal
    from app.services.ad_sync import service
    from app.services.app_settings import set_integration

    class Failing:
        key = "tiktok"

        async def fetch(self, cfg, since, until):
            raise RuntimeError("Invalid token")

        async def verify(self, cfg):
            return {"ok": False, "error": "Invalid token"}

    # Patched so the suite never reaches the real TikTok API.
    monkeypatch.setitem(service.PROVIDERS, "tiktok", Failing())

    async with AsyncSessionLocal() as db:
        await set_integration(
            db, "tiktok", {"advertiser_id": "999", "access_token": "bad"}
        )

    # The run fails, but it is still recorded — which is exactly what the
    # status strip needs in order to explain why a provider went quiet.
    await client.post(
        "/api/campaigns/sync", headers=auth, json={"providers": ["tiktok"]}
    )
    r = await client.get("/api/campaigns/sync/runs", headers=auth)
    assert r.status_code == 200
    runs = r.json()
    assert [item["provider"] for item in runs] == ["tiktok"]
    assert runs[0]["ok"] is False
    assert "Invalid token" in runs[0]["error"]


@pytest.mark.asyncio
async def test_fx_rates_round_trip(client, auth):
    put = await client.put(
        "/api/settings/fx-rates", headers=auth, json={"rates": {"USD": "3.6725"}}
    )
    assert put.status_code == 200
    get = await client.get("/api/settings/fx-rates", headers=auth)
    assert get.json()["rates"]["USD"] == "3.6725"


@pytest.mark.asyncio
async def test_fx_rates_reject_non_positive_values(client, auth):
    r = await client.put(
        "/api/settings/fx-rates", headers=auth, json={"rates": {"USD": "0"}}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_integration_test_endpoint_reports_unconfigured(client, auth):
    r = await client.post("/api/settings/integrations/tiktok/test", headers=auth)
    assert r.status_code == 200
    assert r.json()["ok"] is False


@pytest.mark.asyncio
async def test_integration_test_rejects_unknown_provider(client, auth):
    r = await client.post("/api/settings/integrations/myspace/test", headers=auth)
    assert r.status_code == 404
