"""Google Ads API client.

Two things differ from every other platform here: costs come back as micros
(1/1,000,000 of a currency unit), and the request needs a freshly minted access
token from the stored refresh token on every run.
"""
import json
from datetime import date
from decimal import Decimal

import httpx

from app.services.ad_sync.base import NormalizedMetric, to_decimal, to_int

API_VERSION = "v18"
API_BASE = f"https://googleads.googleapis.com/{API_VERSION}"
TOKEN_URL = "https://oauth2.googleapis.com/token"
TIMEOUT = 60
MICROS = Decimal("1000000")

GAQL = """
SELECT campaign.id, campaign.name, campaign.status, segments.date,
       metrics.cost_micros, metrics.impressions, metrics.clicks,
       metrics.conversions, metrics.conversions_value,
       customer.currency_code
FROM campaign
WHERE segments.date BETWEEN '{since}' AND '{until}'
"""

_STATUS = {"ENABLED": "active", "PAUSED": "paused", "REMOVED": "completed"}


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError):
        return response.text[:200]
    if isinstance(payload, list) and payload:
        payload = payload[0]
    if "error_description" in payload:
        return payload["error_description"]
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message") or response.text[:200]
    return response.text[:200]


def parse_results(payload: dict) -> list[NormalizedMetric]:
    out: list[NormalizedMetric] = []
    for row in payload.get("results") or []:
        campaign = row.get("campaign") or {}
        segments = row.get("segments") or {}
        metrics = row.get("metrics") or {}
        raw_date = segments.get("date")
        if not raw_date:
            continue
        cost = to_decimal(metrics.get("costMicros")) / MICROS
        out.append(
            NormalizedMetric(
                external_campaign_id=str(campaign.get("id") or ""),
                campaign_name=campaign.get("name") or "Untitled campaign",
                campaign_status=_STATUS.get(campaign.get("status", ""), "active"),
                channel="google",
                date=date.fromisoformat(raw_date),
                spend=cost.quantize(Decimal("0.01")),
                impressions=to_int(metrics.get("impressions")),
                clicks=to_int(metrics.get("clicks")),
                conversions=to_int(metrics.get("conversions")),
                revenue=to_decimal(metrics.get("conversionsValue")).quantize(
                    Decimal("0.01")
                ),
                currency=((row.get("customer") or {}).get("currencyCode") or "AED").upper(),
            )
        )
    return out


class GoogleAdsProvider:
    key = "google_ads"

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, transport=self._transport)

    async def _access_token(self, client: httpx.AsyncClient, cfg: dict) -> str:
        response = await client.post(
            TOKEN_URL,
            data={
                "client_id": cfg.get("client_id") or "",
                "client_secret": cfg.get("client_secret") or "",
                "refresh_token": cfg.get("refresh_token") or "",
                "grant_type": "refresh_token",
            },
        )
        if response.status_code != 200:
            raise RuntimeError(f"Google Ads auth: {_error_message(response)}")
        token = response.json().get("access_token")
        if not token:
            raise RuntimeError("Google Ads auth: no access token returned")
        return token

    @staticmethod
    def _customer_id(cfg: dict) -> str:
        return (cfg.get("customer_id") or "").replace("-", "").strip()

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        customer = self._customer_id(cfg)
        developer_token = (cfg.get("developer_token") or "").strip()
        if not customer or not developer_token:
            raise RuntimeError("Google Ads needs a customer ID and developer token")

        rows: list[NormalizedMetric] = []
        async with self._client() as client:
            token = await self._access_token(client, cfg)
            headers = {
                "Authorization": f"Bearer {token}",
                "developer-token": developer_token,
            }
            body = {
                "query": GAQL.format(since=since.isoformat(), until=until.isoformat())
            }
            url = f"{API_BASE}/customers/{customer}/googleAds:search"
            while True:
                response = await client.post(url, headers=headers, json=body)
                if response.status_code != 200:
                    raise RuntimeError(f"Google Ads: {_error_message(response)}")
                payload = response.json()
                rows.extend(parse_results(payload))
                next_token = payload.get("nextPageToken")
                if not next_token:
                    break
                body = {**body, "pageToken": next_token}
        return rows

    async def verify(self, cfg: dict) -> dict:
        customer = self._customer_id(cfg)
        developer_token = (cfg.get("developer_token") or "").strip()
        if not customer or not developer_token:
            return {"ok": False, "error": "Customer ID and developer token required"}
        try:
            async with self._client() as client:
                token = await self._access_token(client, cfg)
                response = await client.post(
                    f"{API_BASE}/customers/{customer}/googleAds:search",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "developer-token": developer_token,
                    },
                    json={
                        "query": (
                            "SELECT customer.descriptive_name, customer.currency_code "
                            "FROM customer LIMIT 1"
                        )
                    },
                )
        except (httpx.HTTPError, RuntimeError) as e:
            return {"ok": False, "error": str(e)[:200]}
        if response.status_code != 200:
            return {"ok": False, "error": _error_message(response)}
        results = response.json().get("results") or []
        info = (results[0].get("customer") if results else {}) or {}
        return {
            "ok": True,
            "account_name": info.get("descriptiveName"),
            "currency": (info.get("currencyCode") or "").upper() or None,
        }
