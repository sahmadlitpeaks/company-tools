"""TikTok Ads reporting client.

TikTok answers HTTP 200 even when the request failed; the real outcome is the
body's ``code`` field. Treating the status line as success is the easy mistake
here, and it turns an auth failure into a silent zero-row sync.
"""
import json
from datetime import date
from decimal import Decimal

import httpx

from app.services.ad_sync.base import NormalizedMetric, to_decimal, to_int

API_BASE = "https://business-api.tiktok.com/open_api/v1.3"
TIMEOUT = 60
PAGE_SIZE = 1000

METRICS = [
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "conversion",
    "total_purchase_value",
]


def _check(payload: dict) -> dict:
    if payload.get("code") not in (0, None):
        raise RuntimeError(f"TikTok: {payload.get('message') or payload.get('code')}")
    return payload.get("data") or {}


def parse_list(payload: dict, currency: str) -> list[NormalizedMetric]:
    out: list[NormalizedMetric] = []
    for row in (payload.get("list") or []):
        dimensions = row.get("dimensions") or {}
        metrics = row.get("metrics") or {}
        raw_day = (dimensions.get("stat_time_day") or "").split(" ")[0]
        if not raw_day:
            continue
        out.append(
            NormalizedMetric(
                external_campaign_id=str(dimensions.get("campaign_id") or ""),
                campaign_name=metrics.get("campaign_name") or "Untitled campaign",
                campaign_status="active",
                channel="tiktok",
                date=date.fromisoformat(raw_day),
                spend=to_decimal(metrics.get("spend")).quantize(Decimal("0.01")),
                impressions=to_int(metrics.get("impressions")),
                clicks=to_int(metrics.get("clicks")),
                conversions=to_int(metrics.get("conversion")),
                revenue=to_decimal(metrics.get("total_purchase_value")).quantize(
                    Decimal("0.01")
                ),
                currency=currency,
            )
        )
    return out


class TikTokProvider:
    key = "tiktok"

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def _client(self, token: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=TIMEOUT,
            transport=self._transport,
            headers={"Access-Token": token},
        )

    async def _advertiser(self, client: httpx.AsyncClient, advertiser_id: str) -> dict:
        response = await client.get(
            f"{API_BASE}/advertiser/info/",
            params={"advertiser_ids": json.dumps([advertiser_id])},
        )
        data = _check(response.json())
        items = data.get("list") or []
        return items[0] if items else {}

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        advertiser_id = (cfg.get("advertiser_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not advertiser_id or not token:
            raise RuntimeError("TikTok needs an advertiser ID and an access token")

        rows: list[NormalizedMetric] = []
        async with self._client(token) as client:
            info = await self._advertiser(client, advertiser_id)
            currency = (info.get("currency") or "AED").upper()

            page = 1
            while True:
                response = await client.get(
                    f"{API_BASE}/report/integrated/get/",
                    params={
                        "advertiser_id": advertiser_id,
                        "report_type": "BASIC",
                        "data_level": "AUCTION_CAMPAIGN",
                        "dimensions": json.dumps(["campaign_id", "stat_time_day"]),
                        "metrics": json.dumps(METRICS),
                        "start_date": since.isoformat(),
                        "end_date": until.isoformat(),
                        "page": page,
                        "page_size": PAGE_SIZE,
                    },
                )
                data = _check(response.json())
                rows.extend(parse_list(data, currency))
                page_info = data.get("page_info") or {}
                if page >= int(page_info.get("total_page") or 1):
                    break
                page += 1
        return rows

    async def verify(self, cfg: dict) -> dict:
        advertiser_id = (cfg.get("advertiser_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not advertiser_id or not token:
            return {"ok": False, "error": "Advertiser ID and access token required"}
        try:
            async with self._client(token) as client:
                info = await self._advertiser(client, advertiser_id)
        except (httpx.HTTPError, RuntimeError, ValueError) as e:
            return {"ok": False, "error": str(e)[:200]}
        return {
            "ok": True,
            "account_name": info.get("name"),
            "currency": (info.get("currency") or "").upper() or None,
        }
