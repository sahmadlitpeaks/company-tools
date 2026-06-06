"""Demo / sample data loader.

Populates representative records across the main modules so the app can be
explored with realistic content, and removes exactly what it created (tracked
via a manifest in app_settings). Guarded so it never runs on production unless
explicitly allowed.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.app_setting import AppSetting
from app.models.brand import Brand
from app.models.crm import CrmLead
from app.models.campaign import Campaign, CampaignMetric
from app.models.asset import Asset, Folder
from app.models.product import Brochure, Product
from app.models.qrcode import QRCode
from app.models.shortlink import ShortLink
from app.models.tracked_asset import (
    AssetCategory,
    AssetEvent,
    AssetLocation,
    TrackedAsset,
)
from app.models.user import User
from app.models.workplace import (
    Announcement,
    ApprovalRequest,
    KnowledgeArticle,
    Task,
    Ticket,
    TicketComment,
)
from app.models.worklog import WorkLog
from app.models.workspace import WorkspaceItem
from app.services.app_settings import set_many

MANIFEST_KEY = "demo_manifest"

# Map manifest table keys -> model class, and a safe deletion order (children
# before parents) so cleanup never hits FK constraints.
_MODELS = {
    "ticket_comment": TicketComment,
    "campaign_metric": CampaignMetric,
    "asset_event": AssetEvent,
    "worklog": WorkLog,
    "workspace": WorkspaceItem,
    "task": Task,
    "approval": ApprovalRequest,
    "ticket": Ticket,
    "knowledge": KnowledgeArticle,
    "announcement": Announcement,
    "qrcode": QRCode,
    "shortlink": ShortLink,
    "brochure": Brochure,
    "asset": Asset,
    "folder": Folder,
    "product": Product,
    "crm_lead": CrmLead,
    "campaign": Campaign,
    "tracked_asset": TrackedAsset,
    "asset_category": AssetCategory,
    "asset_location": AssetLocation,
    "user": User,
    "brand": Brand,
}
_DELETE_ORDER = list(_MODELS.keys())  # already child→parent


def demo_allowed() -> bool:
    return settings.ENVIRONMENT != "production" or settings.ALLOW_DEMO_SEED


class _Manifest:
    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    def add(self, key: str, obj) -> None:
        self.entries.append((key, str(obj.id)))

    def to_json(self) -> str:
        return json.dumps(self.entries)


async def demo_status(db: AsyncSession) -> dict:
    row = await db.get(AppSetting, MANIFEST_KEY)
    seeded = bool(row and row.value)
    count = len(json.loads(row.value)) if seeded else 0
    return {
        "seeded": seeded,
        "records": count,
        "allowed": demo_allowed(),
        "environment": settings.ENVIRONMENT,
    }


async def seed_demo(db: AsyncSession) -> dict:
    m = _Manifest()
    now = datetime.now(timezone.utc)
    today = date.today()

    # ---- Brands (sub-companies) ----
    brands = []
    for slug, name, colour in [
        ("demo-agiomix", "Agiomix", "#0d9488"),
        ("demo-timepiece", "Timepiece", "#7c3aed"),
        ("demo-grilltime", "Grill Time", "#ea580c"),
    ]:
        b = Brand(slug=slug, name=name, primary_color=colour, accent_color=colour)
        db.add(b)
        brands.append(b)
    await db.flush()
    for b in brands:
        m.add("brand", b)

    # ---- Users (departments, roles, statuses, permissions) ----
    people_spec = [
        ("Ahmed Khan", "Marketing", "manager", "active", None),
        ("Sara Ali", "Marketing", "member", "active", None),
        ("Bilal Hussain", "IT", "member", "active", ["dashboard", "service_desk", "asset_tracker", "tasks", "worklog"]),
        ("Fatima Noor", "HR", "manager", "active", None),
        ("Omar Farooq", "Sales", "member", "active", ["dashboard", "crm", "tasks", "worklog"]),
        ("Layla Hassan", "Finance", "member", "active", None),
        ("Yusuf Raza", "Operations", "member", "pending", None),
        ("Mariam Saeed", "Sales", "member", "active", None),
    ]
    users = []
    for full, dept, role, status, perms in people_spec:
        first, last = full.split(" ", 1)
        u = User(
            email=f"{first.lower()}.{last.lower().replace(' ', '')}.demo@agholding.net",
            personal_email=f"{first.lower()}@example.com",
            display_name=full,
            given_name=first,
            surname=last,
            department=dept,
            job_title={"Marketing": "Marketing Specialist", "IT": "IT Support",
                       "HR": "HR Manager", "Sales": "Account Executive",
                       "Finance": "Accountant", "Operations": "Ops Coordinator"}.get(dept, "Staff"),
            mobile_phone="+9715000000" + str(len(users)),
            role=role,
            is_admin=False,
            status=status,
            permissions=perms,
        )
        db.add(u)
        users.append(u)
    await db.flush()
    for u in users:
        m.add("user", u)
    mkt_mgr, mkt, it, hr, sales1, fin, pending, sales2 = users

    # ---- Marketing assets ----
    folders = [Folder(name=n, created_by_id=mkt.id) for n in ("Brand Guidelines", "Campaign 2026")]
    for f in folders:
        db.add(f)
    await db.flush()
    for f in folders:
        m.add("folder", f)
    assets = [
        Asset(folder_id=folders[0].id, name="Logo Pack.zip", file_path="demo/logo-pack.zip",
              content_type="application/zip", size_bytes=2_400_000, uploaded_by_id=mkt.id),
        Asset(folder_id=folders[0].id, name="Brand Manual.pdf", file_path="demo/brand-manual.pdf",
              content_type="application/pdf", size_bytes=5_100_000, uploaded_by_id=mkt.id),
        Asset(folder_id=folders[1].id, name="Hero Banner.png", file_path="demo/hero.png",
              content_type="image/png", size_bytes=820_000, uploaded_by_id=mkt.id),
        Asset(name="Company Profile.pdf", file_path="demo/company-profile.pdf",
              content_type="application/pdf", size_bytes=3_300_000, uploaded_by_id=mkt_mgr.id),
    ]
    for a in assets:
        db.add(a)
    await db.flush()
    for a in assets:
        m.add("asset", a)

    # ---- Products & brochures ----
    products = [
        Product(name="WIMS LIMS Platform", sku="WIMS-01", description="Lab information management."),
        Product(name="Airthings Monitor", sku="AIR-02", description="Indoor air-quality monitoring."),
    ]
    for p in products:
        db.add(p)
    await db.flush()
    for p in products:
        m.add("product", p)
    brochures = [
        Brochure(product_id=products[0].id, title="WIMS Roadmap 2026", file_path="demo/wims.pdf",
                 content_type="application/pdf", size_bytes=152_000, download_count=12, created_by_id=mkt_mgr.id),
        Brochure(product_id=products[1].id, title="Airthings Overview", file_path="demo/airthings.pdf",
                 content_type="application/pdf", size_bytes=106_000, download_count=4, created_by_id=mkt.id),
    ]
    for br in brochures:
        db.add(br)
    await db.flush()
    for br in brochures:
        m.add("brochure", br)

    # ---- CRM leads ----
    lead_spec = [
        ("Acme Corp", "buyer@acme.com", "won", "brochure", "85000"),
        ("Globex", "info@globex.com", "qualified", "landing", "40000"),
        ("Initech", "cto@initech.com", "contacted", "card", "22000"),
        ("Umbrella", "ops@umbrella.com", "new", "manual", None),
        ("Stark Ind", "tony@stark.com", "won", "facebook", "120000"),
        ("Wayne Ent", "lucius@wayne.com", "lost", "google", "0"),
    ]
    for name, email, status, source, value in lead_spec:
        db.add(CrmLead(name=name, email=email, company=name, status=status,
                       source=source, value=value, owner_id=sales1.id))
    await db.flush()
    for lead in (await db.execute(select(CrmLead).where(CrmLead.owner_id == sales1.id))).scalars().all():
        m.add("crm_lead", lead)

    # ---- Campaigns + metrics ----
    camp = Campaign(name="Ramadan 2026", objective="awareness", status="active", brand_id=brands[0].id)
    camp2 = Campaign(name="Summer Launch", objective="conversions", status="completed", brand_id=brands[1].id)
    db.add(camp)
    db.add(camp2)
    await db.flush()
    m.add("campaign", camp)
    m.add("campaign", camp2)
    for ch, spend, impr, clk, conv in [
        ("facebook", "5000", 120000, 3400, 90),
        ("instagram", "3000", 80000, 2100, 55),
        ("google", "7000", 150000, 5200, 130),
    ]:
        mm = CampaignMetric(campaign_id=camp.id, channel=ch, date=today - timedelta(days=3),
                            spend=spend, impressions=impr, clicks=clk, conversions=conv, revenue=str(int(spend) * 4))
        db.add(mm)
    await db.flush()
    for cm in (await db.execute(select(CampaignMetric).where(CampaignMetric.campaign_id == camp.id))).scalars().all():
        m.add("campaign_metric", cm)

    # ---- Asset tracker ----
    cats = [AssetCategory(name="Laptop"), AssetCategory(name="Monitor"), AssetCategory(name="Phone")]
    locs = [AssetLocation(name="HQ - Dubai"), AssetLocation(name="Branch - Abu Dhabi")]
    for c in cats + locs:
        db.add(c)
    await db.flush()
    for c in cats:
        m.add("asset_category", c)
    for loc in locs:
        m.add("asset_location", loc)
    tracked = [
        TrackedAsset(asset_tag="LAP-001", name="MacBook Pro 14", category="Laptop", status="assigned",
                     location="HQ - Dubai", condition="good", assigned_to_id=it.id,
                     purchase_cost="9000", purchase_date=today - timedelta(days=300),
                     useful_life_years=3, warranty_expiry=today + timedelta(days=20)),
        TrackedAsset(asset_tag="LAP-002", name="ThinkPad X1", category="Laptop", status="available",
                     location="HQ - Dubai", condition="new", purchase_cost="6500",
                     purchase_date=today - timedelta(days=60), useful_life_years=3),
        TrackedAsset(asset_tag="MON-001", name="Dell 27\" Monitor", category="Monitor", status="assigned",
                     location="Branch - Abu Dhabi", condition="good", assigned_to_id=sales1.id,
                     purchase_cost="1200", purchase_date=today - timedelta(days=150), useful_life_years=4),
        TrackedAsset(asset_tag="PHN-001", name="iPhone 15", category="Phone", status="maintenance",
                     location="HQ - Dubai", condition="fair", purchase_cost="3500",
                     purchase_date=today - timedelta(days=420), useful_life_years=2),
    ]
    for t in tracked:
        db.add(t)
    await db.flush()
    for t in tracked:
        m.add("tracked_asset", t)
    ev = AssetEvent(asset_id=tracked[0].id, event_type="checkout", user_id=it.id,
                    note="Issued on joining", performed_by_id=hr.id)
    db.add(ev)
    await db.flush()
    m.add("asset_event", ev)

    # ---- Tasks ----
    task_spec = [
        ("Design Ramadan creatives", "in_progress", "high", mkt.id),
        ("Refresh website hero", "todo", "normal", mkt.id),
        ("Q1 sales report", "todo", "high", sales1.id),
        ("Patch office laptops", "done", "normal", it.id),
        ("Plan team offsite", "blocked", "low", hr.id),
    ]
    for title, st, prio, who in task_spec:
        tk = Task(title=title, status=st, priority=prio, assignee_id=who, created_by_id=mkt_mgr.id,
                  due_date=today + timedelta(days=5))
        db.add(tk)
    await db.flush()
    for tk in (await db.execute(select(Task).where(Task.created_by_id == mkt_mgr.id))).scalars().all():
        m.add("task", tk)

    # ---- Approvals ----
    appr_spec = [
        ("leave", "Annual leave (3 days)", "pending", sales1.id),
        ("expense", "Client dinner - AED 450", "pending", mkt.id),
        ("purchase", "New monitor", "approved", it.id),
        ("leave", "Sick leave", "approved", fin.id),
    ]
    for typ, title, st, who in appr_spec:
        ap = ApprovalRequest(type=typ, title=title, status=st, requester_id=who,
                             decided_by_id=hr.id if st == "approved" else None,
                             decided_at=now if st == "approved" else None)
        db.add(ap)
    await db.flush()
    for ap in (await db.execute(select(ApprovalRequest))).scalars().all():
        if ap.requester_id in {u.id for u in users}:
            m.add("approval", ap)

    # ---- Tickets + comments ----
    tk1 = Ticket(subject="VPN not connecting", category="it", priority="high", status="in_progress",
                 requester_id=sales1.id, assignee_id=it.id)
    tk2 = Ticket(subject="AC too cold in meeting room", category="facilities", priority="low",
                 status="open", requester_id=mkt.id)
    db.add(tk1)
    db.add(tk2)
    await db.flush()
    m.add("ticket", tk1)
    m.add("ticket", tk2)
    cmt = TicketComment(ticket_id=tk1.id, author_id=it.id, body="Looking into it, please retry in 10 min.")
    db.add(cmt)
    await db.flush()
    m.add("ticket_comment", cmt)

    # ---- Knowledge + announcements ----
    for title, cat, body, pinned in [
        ("Leave Policy", "HR", "Staff get 25 days annual leave. Apply via Approvals.", True),
        ("VPN Setup Guide", "IT", "1. Install client\n2. Sign in with SSO\n3. Connect to HQ.", False),
        ("Expense Claims", "Finance", "Submit receipts within 30 days via Approvals → Expense.", False),
    ]:
        db.add(KnowledgeArticle(title=title, category=cat, body=body, pinned=pinned, author_id=hr.id))
    await db.flush()
    for ar in (await db.execute(select(KnowledgeArticle).where(KnowledgeArticle.author_id == hr.id))).scalars().all():
        m.add("knowledge", ar)
    for title, body in [
        ("Office closed for Eid", "The office will be closed Mon–Tue for Eid. Enjoy!"),
        ("New joiner: welcome Sara!", "Please welcome Sara Ali to the Marketing team."),
    ]:
        db.add(Announcement(title=title, body=body, author_id=mkt_mgr.id, is_published=True))
    await db.flush()
    for an in (await db.execute(select(Announcement).where(Announcement.author_id == mkt_mgr.id))).scalars().all():
        m.add("announcement", an)

    # ---- Work logs ----
    for who, mins, desc, kind, d in [
        (it.id, 90, "Fixed VPN config", "ticket", today),
        (mkt.id, 120, "R&D on new ad format", "rnd", today),
        (sales1.id, 60, "Client calls", "support", today - timedelta(days=1)),
        (mkt.id, 45, "Weekly sync", "meeting", today - timedelta(days=1)),
    ]:
        db.add(WorkLog(user_id=who, minutes=mins, description=desc, kind=kind, work_date=d))
    await db.flush()
    for wl in (await db.execute(select(WorkLog).where(WorkLog.user_id.in_([it.id, mkt.id, sales1.id])))).scalars().all():
        m.add("worklog", wl)

    # ---- My docs ----
    for who, kind, title, url, body in [
        (mkt.id, "link", "Brand drive (OneDrive)", "https://onedrive.example.com/brand", None),
        (mkt.id, "note", "Campaign checklist", None, "1. Brief\n2. Creatives\n3. Launch\n4. Report"),
        (it.id, "link", "Server runbook", "https://wiki.example.com/runbook", None),
    ]:
        db.add(WorkspaceItem(owner_id=who, kind=kind, title=title, url=url, body=body,
                             shared=(kind == "link")))
    await db.flush()
    for wi in (await db.execute(select(WorkspaceItem).where(WorkspaceItem.owner_id.in_([mkt.id, it.id])))).scalars().all():
        m.add("workspace", wi)

    # ---- QR codes + short links ----
    for label, url in [("Company profile QR", "https://agholding.net"), ("Careers page", "https://agholding.net/careers")]:
        db.add(QRCode(label=label, target_url=url, created_by_id=mkt_mgr.id))
    await db.flush()
    for qr in (await db.execute(select(QRCode).where(QRCode.created_by_id == mkt_mgr.id))).scalars().all():
        m.add("qrcode", qr)
    for code, url in [("demo-promo", "https://agholding.net/promo"), ("demo-event", "https://agholding.net/event")]:
        db.add(ShortLink(code=code, target_url=url, title=code, created_by_id=mkt_mgr.id, click_count=23))
    await db.flush()
    for sl in (await db.execute(select(ShortLink).where(ShortLink.created_by_id == mkt_mgr.id))).scalars().all():
        m.add("shortlink", sl)

    await set_many(db, {MANIFEST_KEY: m.to_json()})
    await db.commit()
    return {"seeded": True, "records": len(m.entries)}


async def clear_demo(db: AsyncSession) -> dict:
    row = await db.get(AppSetting, MANIFEST_KEY)
    if not row or not row.value:
        return {"removed": 0}
    entries = json.loads(row.value)
    by_table: dict[str, list[str]] = {}
    for table, _id in entries:
        by_table.setdefault(table, []).append(_id)
    removed = 0
    for table in _DELETE_ORDER:
        model = _MODELS[table]
        for _id in by_table.get(table, []):
            obj = await db.get(model, uuid.UUID(_id))
            if obj is not None:
                await db.delete(obj)
                removed += 1
        await db.flush()
    await set_many(db, {MANIFEST_KEY: None})
    await db.commit()
    return {"removed": removed}
