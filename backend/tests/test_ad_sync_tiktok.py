from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.ad_sync.tiktok import TikTokProvider

CFG = {"advertiser_id": "999", "access_token": "tok"}

ADVERTISER = {
    "code": 0,
    "data": {"list": [{"name": "AG Holding", "currency": "AED"}]},
}


def _report(page, total_page, day):
    return {
        "code": 0,
        "message": "OK",
        "data": {
            "list": [
                {
                    "dimensions": {"campaign_id": "77", "stat_time_day": day},
                    "metrics": {
                        "campaign_name": "TikTok Awareness",
                        "spend": "250.75",
                        "impressions": "90000",
                        "clicks": "1200",
                        "conversion": "35",
                        "total_purchase_value": "5000.00",
                    },
                }
            ],
            "page_info": {"page": page, "total_page": total_page},
        },
    }


def _transport(pages):
    calls = {"report": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if "advertiser/info" in str(request.url):
            return httpx.Response(200, json=ADVERTISER)
        page = pages[min(calls["report"], len(pages) - 1)]
        calls["report"] += 1
        return httpx.Response(200, json=page)

    return httpx.MockTransport(handler), calls


@pytest.mark.asyncio
async def test_parses_report_rows():
    transport, _ = _transport([_report(1, 1, "2026-08-01 00:00:00")])
    rows = await TikTokProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 1)
    )
    assert rows[0].spend == Decimal("250.75")
    assert rows[0].conversions == 35
    assert rows[0].revenue == Decimal("5000.00")
    assert rows[0].channel == "tiktok"
    assert rows[0].date == date(2026, 8, 1)
    assert rows[0].currency == "AED"
    assert rows[0].campaign_name == "TikTok Awareness"


@pytest.mark.asyncio
async def test_walks_every_page():
    pages = [_report(1, 2, "2026-08-01 00:00:00"), _report(2, 2, "2026-08-02 00:00:00")]
    transport, calls = _transport(pages)
    rows = await TikTokProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert calls["report"] == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_non_zero_code_is_an_error_despite_http_200():
    """TikTok signals failure in the body, not the status line."""

    def handler(request):
        if "advertiser/info" in str(request.url):
            return httpx.Response(200, json=ADVERTISER)
        return httpx.Response(200, json={"code": 40001, "message": "Invalid token"})

    provider = TikTokProvider(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="Invalid token"):
        await provider.fetch(CFG, date(2026, 8, 1), date(2026, 8, 1))
