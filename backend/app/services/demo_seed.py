"""Demo / sample data loader.

Populates representative records across the main modules so the app can be
explored with realistic content, and removes exactly what it created (tracked
via a manifest in app_settings). Guarded so it never runs on production unless
explicitly allowed.
"""
import hashlib
import json
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.app_setting import AppSetting
from app.models.brand import Brand
from app.models.brand_document import BrandDocument, BrandDocumentVersion
from app.models.branding import BrandAsset, BrandKit
from app.models.card import CardScan, DigitalCard, Lead
from app.models.crm import CrmLead
from app.models.campaign import Campaign, CampaignMetric
from app.models.asset import Asset, Folder
from app.models.landing import LandingLead, LandingPage
from app.models.notification import Notification
from app.models.people import AccessGrant, OnboardingJourney, OnboardingTask
from app.models.product import Brochure, Product
from app.models.qrcode import QRCode
from app.models.shortlink import ShortLink
from app.models.signature import EmailSignature, SignatureTemplate
from app.models.tracked_asset import (
    AssetCategory,
    AssetEvent,
    AssetLocation,
    TrackedAsset,
)
from app.models.phone_line import PhoneBill, PhoneLine, PhoneLineEvent
from app.models.transfer import SecureTransfer
from app.models.user import User
from app.models.workplace import (
    Announcement,
    ApprovalRequest,
    KnowledgeArticle,
    LeaveBalance,
    Task,
    TaskComment,
    TaskItem,
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
    "card_lead": Lead,
    "card_scan": CardScan,
    "card": DigitalCard,
    "email_signature": EmailSignature,
    "signature_template": SignatureTemplate,
    "landing_lead": LandingLead,
    "landing_page": LandingPage,
    "secure_transfer": SecureTransfer,
    "brand_asset": BrandAsset,
    "brand_kit": BrandKit,
    "brand_doc_version": BrandDocumentVersion,
    "brand_document": BrandDocument,
    "access_grant": AccessGrant,
    "onboarding_task": OnboardingTask,
    "onboarding_journey": OnboardingJourney,
    "leave_balance": LeaveBalance,
    "notification": Notification,
    "shortlink": ShortLink,
    "brochure": Brochure,
    "asset": Asset,
    "folder": Folder,
    "product": Product,
    "crm_lead": CrmLead,
    "campaign": Campaign,
    "tracked_asset": TrackedAsset,
    "phone_line": PhoneLine,
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
              content_type="application/pdf", size_bytes=3_300_000, uploaded_by_id=mkt_mgr.id,
              is_public=True),
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
                 content_type="application/pdf", size_bytes=152_000, download_count=12, created_by_id=mkt_mgr.id,
                 is_public=True),
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

    # ---- Phone lines (numbers, packages, assignment history + billing) ----
    line1 = PhoneLine(number="+971501234567", carrier="Etisalat", plan_name="Business 20GB",
                      sim_number="8997100000000001", monthly_cost="120", data_allowance="20 GB",
                      status="assigned", assigned_to_id=sales1.id,
                      contract_start=today - timedelta(days=200),
                      contract_end=today + timedelta(days=165))
    line2 = PhoneLine(number="+971559876543", carrier="du", plan_name="Smart 12GB",
                      sim_number="8997100000000002", monthly_cost="85", data_allowance="12 GB",
                      status="available")
    db.add(line1)
    db.add(line2)
    await db.flush()
    m.add("phone_line", line1)
    m.add("phone_line", line2)
    # History + a couple of bills on the assigned line (cascade-deleted with it).
    db.add(PhoneLineEvent(line_id=line1.id, event_type="assigned", user_id=sales1.id,
                          note="Assigned on joining", performed_by_id=it.id))
    db.add(PhoneBill(line_id=line1.id, period="2026-04", amount="124.50", data_used="18 GB", status="paid"))
    db.add(PhoneBill(line_id=line1.id, period="2026-05", amount="131.00", data_used="21 GB", status="unpaid"))
    await db.flush()

    # ---- Tasks (with a checklist, a comment and a recurring one) ----
    task_spec = [
        ("Design Ramadan creatives", "in_progress", "high", mkt.id, None, today + timedelta(days=5)),
        ("Refresh website hero", "todo", "normal", mkt.id, None, today + timedelta(days=8)),
        ("Q1 sales report", "todo", "high", sales1.id, None, today - timedelta(days=1)),  # overdue
        ("Patch office laptops", "done", "normal", it.id, None, today - timedelta(days=3)),
        ("Weekly backup check", "todo", "normal", it.id, "weekly", today + timedelta(days=2)),
    ]
    tasks = []
    for title, st, prio, who, rec, due in task_spec:
        tk = Task(title=title, status=st, priority=prio, assignee_id=who, created_by_id=mkt_mgr.id,
                  recurrence=rec, due_date=due)
        db.add(tk)
        tasks.append(tk)
    await db.flush()
    for tk in tasks:
        m.add("task", tk)
    # Checklist + a comment on the first task (cascade-deleted with the task).
    for i, title in enumerate(["Brief from marketing", "Draft 3 concepts", "Review with manager", "Export final"]):
        db.add(TaskItem(task_id=tasks[0].id, title=title, done=i == 0, sort=i))
    db.add(TaskComment(task_id=tasks[0].id, author_id=mkt_mgr.id, body="Let's prioritise the hero banner first."))
    await db.flush()

    # ---- Approvals ----
    appr_spec = [
        ("leave", "Annual leave (3 days)", "pending", sales1.id, today + timedelta(days=10), today + timedelta(days=12), None),
        ("expense", "Client dinner - AED 450", "pending", mkt.id, None, None, 450),
        ("purchase", "New monitor", "approved", it.id, None, None, 1200),
        ("leave", "Sick leave", "approved", fin.id, today - timedelta(days=2), today - timedelta(days=1), None),
    ]
    for typ, title, st, who, start, end, amount in appr_spec:
        ap = ApprovalRequest(type=typ, title=title, status=st, requester_id=who,
                             start_date=start, end_date=end, amount=amount,
                             decided_by_id=hr.id if st == "approved" else None,
                             decided_at=now if st == "approved" else None)
        db.add(ap)
    await db.flush()
    for ap in (await db.execute(select(ApprovalRequest))).scalars().all():
        if ap.requester_id in {u.id for u in users}:
            m.add("approval", ap)

    # ---- Tickets + comments (with numbers, SLA targets, an internal note) ----
    tk1 = Ticket(number=9001, subject="VPN not connecting", category="it", priority="high",
                 status="in_progress", requester_id=sales1.id, assignee_id=it.id,
                 sla_response_due=now - timedelta(hours=1), sla_resolution_due=now + timedelta(hours=6),
                 first_responded_at=now - timedelta(hours=2))
    tk2 = Ticket(number=9002, subject="AC too cold in meeting room", category="facilities", priority="low",
                 status="open", requester_id=mkt.id,
                 sla_response_due=now + timedelta(hours=20), sla_resolution_due=now - timedelta(hours=2))  # overdue
    db.add(tk1)
    db.add(tk2)
    await db.flush()
    m.add("ticket", tk1)
    m.add("ticket", tk2)
    cmt = TicketComment(ticket_id=tk1.id, author_id=it.id, body="Looking into it, please retry in 10 min.")
    note = TicketComment(ticket_id=tk1.id, author_id=it.id, is_internal=True,
                         body="Checked the firewall — likely an expired cert on the gateway.")
    db.add(cmt)
    db.add(note)
    await db.flush()
    m.add("ticket_comment", cmt)
    m.add("ticket_comment", note)

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

    # ---- Leave balances (entitlements for the Leave screen) ----
    year = today.year
    for u in (mkt_mgr, mkt, it, hr, sales1, fin, sales2):
        db.add(LeaveBalance(user_id=u.id, year=year, entitlement_days=25))
    await db.flush()
    for lb in (await db.execute(select(LeaveBalance).where(LeaveBalance.year == year))).scalars().all():
        if lb.user_id in {u.id for u in users}:
            m.add("leave_balance", lb)

    # ---- Digital business cards (+ a scan and a captured lead) ----
    card_spec = [
        (mkt_mgr, "demo-ahmed-khan", "Marketing Manager", brands[0].id, "#0d9488"),
        (sales1, "demo-omar-farooq", "Account Executive", brands[1].id, "#7c3aed"),
        (it, "demo-bilal-hussain", "IT Support", None, "#0b5cab"),
    ]
    cards = []
    for owner, slug, title, brand_id, colour in card_spec:
        c = DigitalCard(
            owner_id=owner.id, brand_id=brand_id, slug=slug, full_name=owner.display_name,
            title=title, company="AG Holding", email=owner.email, phone=owner.mobile_phone,
            whatsapp=owner.mobile_phone, website="https://agholding.net",
            linkedin=f"https://linkedin.com/in/{slug}", accent_color=colour,
            bio=f"{title} at AG Holding.", is_active=True, lead_capture_enabled=True,
        )
        db.add(c)
        cards.append(c)
    await db.flush()
    for c in cards:
        m.add("card", c)
    scan = CardScan(card_id=cards[0].id, ip_address="203.0.113.7",
                    user_agent="Mozilla/5.0", referer="https://linkedin.com")
    clead = Lead(card_id=cards[0].id, name="Jane Prospect", email="jane@prospect.com",
                 phone="+971500001234", company="Prospect LLC",
                 message="Interested in your services.", status="new")
    db.add(scan)
    db.add(clead)
    await db.flush()
    m.add("card_scan", scan)
    m.add("card_lead", clead)

    # ---- Email signature template + a rendered signature ----
    tmpl = SignatureTemplate(
        name="AG Holding — Standard", description="Company default signature",
        html=(
            '<table><tr><td style="font-family:Arial"><b>{{ full_name }}</b><br>'
            '{{ title }} — AG Holding<br>{{ email }} · {{ phone }}</td></tr></table>'
        ),
        is_default=True,
    )
    db.add(tmpl)
    await db.flush()
    m.add("signature_template", tmpl)
    sig = EmailSignature(
        user_id=mkt_mgr.id, template_id=tmpl.id,
        data=json.dumps({"full_name": mkt_mgr.display_name, "title": "Marketing Manager",
                         "email": mkt_mgr.email, "phone": mkt_mgr.mobile_phone}),
        rendered_html=f"<b>{mkt_mgr.display_name}</b><br>Marketing Manager — AG Holding",
    )
    db.add(sig)
    await db.flush()
    m.add("email_signature", sig)

    # ---- Landing pages (+ a captured lead) ----
    lp_spec = [
        ("demo-ramadan-2026", "Ramadan 2026 Offer", brands[0].id, "published", 340),
        ("demo-grilltime-launch", "Grill Time Launch", brands[2].id, "draft", 0),
    ]
    pages = []
    for slug, title, brand_id, status, views in lp_spec:
        p = LandingPage(
            slug=slug, brand_id=brand_id, title=title,
            description=f"{title} landing page.",
            blocks=json.dumps([
                {"type": "hero", "heading": title, "subheading": "Limited time only."},
                {"type": "form", "fields": ["name", "email", "phone"]},
            ]),
            theme="light", status=status, view_count=views, created_by_id=mkt.id,
        )
        db.add(p)
        pages.append(p)
    await db.flush()
    for p in pages:
        m.add("landing_page", p)
    llead = LandingLead(page_id=pages[0].id, name="Sam Visitor", email="sam@visitor.com",
                        phone="+971500005678", message="Send me the offer details.")
    db.add(llead)
    await db.flush()
    m.add("landing_lead", llead)

    # ---- Secure transfers (encrypted one-time hand-offs) ----
    for fname, rcpt, sender, consumed in [
        ("Q1-Report.pdf", "partner@external.com", mkt_mgr.id, False),
        ("Signed-NDA.pdf", "legal@external.com", hr.id, True),
    ]:
        token = secrets.token_urlsafe(24)
        st = SecureTransfer(
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            salt=secrets.token_hex(16), filename=fname, content_type="application/pdf",
            size_bytes=240_000, file_path=None if consumed else "demo/transfer.bin",
            sender_id=sender, recipient_email=rcpt, message="Please find attached.",
            one_time=True, max_downloads=1, download_count=1 if consumed else 0,
            expires_at=now + timedelta(days=7), is_consumed=consumed,
            consumed_at=now if consumed else None, email_sent=True,
        )
        db.add(st)
    await db.flush()
    for st in (await db.execute(select(SecureTransfer).where(SecureTransfer.sender_id.in_([mkt_mgr.id, hr.id])))).scalars().all():
        m.add("secure_transfer", st)

    # ---- Brand kits (+ downloadable assets) ----
    kit = BrandKit(
        name="Agiomix Brand Kit", description="Primary brand guidelines & assets.",
        guidelines_url="https://agholding.net/brand", logo_url="demo/agiomix-logo.svg",
        primary_colors=json.dumps([{"name": "Primary", "hex": "#0d9488"},
                                   {"name": "Ink", "hex": "#0f172a"}]),
        fonts=json.dumps(["Inter", "Poppins"]),
    )
    db.add(kit)
    await db.flush()
    m.add("brand_kit", kit)
    for name, cat in [("Logo (SVG)", "logo"), ("Letterhead", "template"), ("Brand Font", "font")]:
        db.add(BrandAsset(brand_kit_id=kit.id, name=name, category=cat,
                          file_path=f"demo/{name.lower().replace(' ', '-')}",
                          content_type="application/octet-stream", size_bytes=64_000))
    await db.flush()
    for ba in (await db.execute(select(BrandAsset).where(BrandAsset.brand_kit_id == kit.id))).scalars().all():
        m.add("brand_asset", ba)

    # ---- Brand documents (versioned) ----
    doc = BrandDocument(brand_id=brands[0].id, name="Brand Guidelines", category="guideline",
                        current_version=2)
    db.add(doc)
    await db.flush()
    m.add("brand_document", doc)
    for v in (1, 2):
        db.add(BrandDocumentVersion(document_id=doc.id, version=v,
                                    file_path=f"demo/brand-guidelines-v{v}.pdf",
                                    content_type="application/pdf", size_bytes=1_200_000 + v,
                                    uploaded_by_id=mkt_mgr.id))
    await db.flush()
    for dv in (await db.execute(select(BrandDocumentVersion).where(BrandDocumentVersion.document_id == doc.id))).scalars().all():
        m.add("brand_doc_version", dv)

    # ---- People ops: onboarding & offboarding journeys ----
    onj = OnboardingJourney(kind="onboarding", target_user_id=pending.id, status="in_progress",
                            brand_id=brands[0].id, created_by_id=hr.id,
                            note="New Operations coordinator starting next week.")
    offj = OnboardingJourney(kind="offboarding", target_user_id=sales2.id, status="in_progress",
                             brand_id=brands[1].id, created_by_id=hr.id,
                             note="Moving on at end of month.")
    db.add(onj)
    db.add(offj)
    await db.flush()
    m.add("onboarding_journey", onj)
    m.add("onboarding_journey", offj)
    on_tasks = [
        ("access", "Grant system access & set permissions", "done", it.id),
        ("accounts", "Create digital business card", "pending", mkt.id),
        ("equipment", "Assign laptop & equipment", "done", it.id),
        ("hr", "Collect signed contract & ID documents", "pending", hr.id),
        ("other", "Office tour & team introductions", "pending", hr.id),
    ]
    for i, (cat, title, st, owner) in enumerate(on_tasks):
        db.add(OnboardingTask(journey_id=onj.id, title=title, category=cat, status=st,
                              owner_id=owner, sort=i,
                              done_by_id=owner if st == "done" else None,
                              done_at=now if st == "done" else None))
    off_tasks = [
        ("access", "Revoke system access & disable account", "pending", it.id),
        ("equipment", "Collect laptop & equipment", "pending", it.id),
        ("hr", "Final settlement & exit interview", "pending", hr.id),
    ]
    for i, (cat, title, st, owner) in enumerate(off_tasks):
        db.add(OnboardingTask(journey_id=offj.id, title=title, category=cat, status=st,
                              owner_id=owner, sort=i))
    await db.flush()
    for t in (await db.execute(select(OnboardingTask).where(OnboardingTask.journey_id.in_([onj.id, offj.id])))).scalars().all():
        m.add("onboarding_task", t)
    for name, system, user_id, status in [
        ("Google Workspace", "google", pending.id, "active"),
        ("Facebook Business", "facebook", pending.id, "active"),
        ("ERP Portal", "portal", sales2.id, "active"),
    ]:
        db.add(AccessGrant(user_id=user_id, journey_id=onj.id if user_id == pending.id else offj.id,
                           name=name, system=system, username=f"demo.{system}",
                           status=status, granted_by_id=it.id))
    await db.flush()
    for ag in (await db.execute(select(AccessGrant).where(AccessGrant.user_id.in_([pending.id, sales2.id])))).scalars().all():
        m.add("access_grant", ag)

    # ---- In-app notifications (a few for demo users) ----
    notif_spec = [
        (it.id, "Asset warranty expiring", "MacBook Pro 14 (LAP-001) warranty expires soon.", "/asset-tracker", "warning"),
        (sales1.id, "Approval pending", "Your annual leave request is awaiting approval.", "/approvals", "info"),
        (mkt.id, "New task assigned", "You were assigned: Design Ramadan creatives.", "/tasks", "info"),
    ]
    for uid, title, body, link, cat in notif_spec:
        db.add(Notification(user_id=uid, title=title, body=body, link=link, category=cat))
    await db.flush()
    for nt in (await db.execute(select(Notification).where(Notification.user_id.in_([it.id, sales1.id, mkt.id])))).scalars().all():
        m.add("notification", nt)

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
