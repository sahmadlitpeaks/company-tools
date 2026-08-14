from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.ad_sync.meta import MetaProvider

CFG = {"ad_account_id": "act_123", "access_token": "tok"}

PAGE_ONE = {
    "data": [
        {
            "date_start": "2026-08-01",
            "campaign_id": "111",
            "campaign_name": "Summer Sale",
            "publisher_platform": "facebook",
            "spend": "100.50",
            "impressions": "5000",
            "clicks": "250",
            "account_currency": "USD",
            "actions": [
                {"action_type": "purchase", "value": "10"},
                {"action_type": "link_click", "value": "250"},
            ],
            "action_values": [{"action_type": "purchase", "value": "900.00"}],
        },
        {
            "date_start": "2026-08-01",
            "campaign_id": "111",
            "campaign_name": "Summer Sale",
            "publisher_platform": "instagram",
            "spend": "40.00",
            "impressions": "2000",
            "clicks": "80",
            "account_currency": "USD",
            "actions": [{"action_type": "purchase", "value": "4"}],
            "action_values": [{"action_type": "purchase", "value": "300.00"}],
        },
    ],
    "paging": {"next": "https://graph.facebook.com/next-page"},
}

PAGE_TWO = {
    "data": [
        {
            "date_start": "2026-08-02",
            "campaign_id": "111",
            "campaign_name": "Summer Sale",
            "publisher_platform": "audience_network",
            "spend": "5.00",
            "impressions": "100",
            "clicks": "2",
            "account_currency": "USD",
        }
    ],
    "paging": {},
}


def _transport(pages):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        page = pages[min(calls["n"], len(pages) - 1)]
        calls["n"] += 1
        return httpx.Response(200, json=page)

    return httpx.MockTransport(handler), calls


@pytest.mark.asyncio
async def test_parses_nested_actions_into_conversions_and_revenue():
    transport, _ = _transport([PAGE_ONE, PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    fb = next(r for r in rows if r.channel == "facebook")
    assert fb.spend == Decimal("100.50")
    assert fb.conversions == 10        # from actions[purchase], not clicks
    assert fb.revenue == Decimal("900.00")  # from action_values[purchase]
    assert fb.currency == "USD"
    assert fb.date == date(2026, 8, 1)


@pytest.mark.asyncio
async def test_publisher_platform_splits_facebook_and_instagram():
    transport, _ = _transport([PAGE_ONE, PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert {r.channel for r in rows} == {"facebook", "instagram", "other"}


@pytest.mark.asyncio
async def test_follows_pagination_to_the_end():
    """Ignoring paging.next silently truncates data and looks like success."""
    transport, calls = _transport([PAGE_ONE, PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert calls["n"] == 2
    assert len(rows) == 3


@pytest.mark.asyncio
async def test_rows_without_actions_report_zero_conversions():
    transport, _ = _transport([PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 2), date(2026, 8, 2)
    )
    assert rows[0].conversions == 0
    assert rows[0].revenue == Decimal("0")


@pytest.mark.asyncio
async def test_api_error_raises_with_the_platform_message():
    def handler(request):
        return httpx.Response(
            400, json={"error": {"message": "Invalid OAuth access token."}}
        )

    provider = MetaProvider(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="Invalid OAuth access token"):
        await provider.fetch(CFG, date(2026, 8, 1), date(2026, 8, 1))
