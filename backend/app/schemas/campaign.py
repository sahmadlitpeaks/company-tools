import uuid
from datetime import date as DateType, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CampaignCreate(BaseModel):
    name: str
    objective: str | None = None
    status: str = "active"
    start_date: DateType | None = None
    end_date: DateType | None = None
    notes: str | None = None
    company_id: uuid.UUID | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    objective: str | None = None
    status: str | None = None
    start_date: DateType | None = None
    end_date: DateType | None = None
    notes: str | None = None
    company_id: uuid.UUID | None = None


class Kpis(BaseModel):
    spend: Decimal = Decimal("0")
    impressions: int = 0
    clicks: int = 0
    conversions: int = 0
    revenue: Decimal = Decimal("0")
    ctr: float = 0.0
    cpc: Decimal = Decimal("0")
    cpm: Decimal = Decimal("0")
    cpa: Decimal = Decimal("0")
    conversion_rate: float = 0.0
    roas: float = 0.0


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None = None
    name: str
    objective: str | None = None
    status: str
    start_date: DateType | None = None
    end_date: DateType | None = None
    notes: str | None = None
    created_at: datetime
    kpis: Kpis | None = None


class MetricCreate(BaseModel):
    channel: str
    date: DateType | None = None
    spend: Decimal = Decimal("0")
    impressions: int = 0
    clicks: int = 0
    conversions: int = 0
    revenue: Decimal = Decimal("0")


class MetricOut(MetricCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campaign_id: uuid.UUID
    created_at: datetime


class ChannelBreakdown(Kpis):
    channel: str


class CampaignBreakdown(BaseModel):
    totals: Kpis
    by_channel: list[ChannelBreakdown]
    series: list[dict]


class OverviewItem(Kpis):
    id: str
    name: str


class CampaignOverview(BaseModel):
    totals: Kpis
    by_channel: list[ChannelBreakdown]
    campaigns: list[OverviewItem]
