from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.ad_sync.google_ads import GoogleAdsProvider

CFG = {
    "customer_id": "123-456-7890",
    "developer_token": "dev",
    "client_id": "cid",
    "client_secret": "secret",
    "refresh_token": "refresh",
}


def _result(campaign_id, day, cost_micros, page_token=None):
    body = {
        "results": [
            {
                "campaign": {
                    "id": campaign_id,
                    "name": "Search Brand",
                    "status": "ENABLED",
                },
                "segments": {"date": day},
                "metrics": {
                    "costMicros": cost_micros,
                    "impressions": "1000",
                    "clicks": "50",
                    "conversions": "5.0",
                    "conversionsValue": "750.25",
                },
                "customer": {"currencyCode": "AED"},
            }
        ]
    }
    if page_token:
        body["nextPageToken"] = page_token
    return body


def _transport(pages):
    calls = {"token": 0, "search": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth2" in str(request.url):
            calls["token"] += 1
            return httpx.Response(200, json={"access_token": "at", "expires_in": 3600})
        page = pages[min(calls["search"], len(pages) - 1)]
        calls["search"] += 1
        return httpx.Response(200, json=page)

    return httpx.MockTransport(handler), calls


@pytest.mark.asyncio
async def test_cost_micros_are_converted_to_currency_units():
    transport, _ = _transport([_result("55", "2026-08-01", "12500000")])
    rows = await GoogleAdsProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 1)
    )
    assert rows[0].spend == Decimal("12.50")  # 12_500_000 micros
    assert rows[0].revenue == Decimal("750.25")
    assert rows[0].conversions == 5
    assert rows[0].channel == "google"
    assert rows[0].currency == "AED"


@pytest.mark.asyncio
async def test_follows_next_page_token():
    pages = [
        _result("55", "2026-08-01", "1000000", page_token="tok"),
        _result("55", "2026-08-02", "2000000"),
    ]
    transport, calls = _transport(pages)
    rows = await GoogleAdsProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert calls["search"] == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_customer_id_dashes_are_stripped_from_the_url():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth2" in str(request.url):
            return httpx.Response(200, json={"access_token": "at"})
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"results": []})

    await GoogleAdsProvider(transport=httpx.MockTransport(handler)).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 1)
    )
    assert "customers/1234567890/" in seen["url"]


@pytest.mark.asyncio
async def test_token_refresh_failure_is_reported_clearly():
    def handler(request):
        return httpx.Response(400, json={"error_description": "Bad refresh token"})

    provider = GoogleAdsProvider(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="Bad refresh token"):
        await provider.fetch(CFG, date(2026, 8, 1), date(2026, 8, 1))
