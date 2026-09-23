"""Automated reminder engine for SharePoint document expiries, deadlines, and pricing."""
import asyncio
import html
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.sharepoint import SharePointConnection, SharePointDocument, SharePointReminder, SharePointSource
from app.models.user import User
from app.services.dispatch import send_teams
from app.services.email import send_email
from app.services.sharepoint.common import SharePointError, decrypt, digest, now
from app.services.sharepoint.privacy import restore
from app.services.sharepoint.store import authorize_document

log = logging.getLogger("sharepoint_reminders")


def _calculate_reminder_date(target_iso: str, lead_days: int) -> str:
    try:
        t_date = date.fromisoformat(target_iso)
        r_date = t_date - timedelta(days=lead_days)
        return r_date.isoformat()
    except (ValueError, TypeError):
        return target_iso


async def _resolve_recipient(db: AsyncSession, name: str | None) -> str | None:
    """Resolve reminder recipient only from exact, validated platform user email.

    Never fuzzy-matches names and never uses unvalidated document strings as literal emails.
    Unresolvable owners return None to prevent exfiltrating document details to admin or wrong users.
    """
    if not name:
        return None
    name_clean = name.strip().lower()
    # Match exact active user email only
    user = (
        await db.execute(
            select(User).where(
                User.email == name_clean,
                User.is_active == True,
            )
        )
    ).scalars().first()
    if user and user.email:
        return user.email.lower()
    return None


def _escape_teams_markdown(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"([\\`*_{}\[\]()#+\-.!<>])", r"\\\1", str(text))


# Pillar 4 Escalating Notification Schedule:
# Monthly (90, 60 days) -> Weekly in final month (30, 21, 14, 7 days) -> 3x in final week (5, 3, 1 days) -> Day of expiry (0 days)
EXPIRY_ESCALATION_LEADS = (90, 60, 30, 21, 14, 7, 5, 3, 1, 0)
TASK_DEADLINE_ESCALATION_LEADS = (30, 14, 7, 5, 3, 1, 0)


def reminder_stage_label(lead_days: int) -> tuple[str, str, str]:
    """Returns (label_text, badge_color_hex, bg_color_hex) for escalating notifications."""
    if lead_days == 0:
        return "🚨 Due Today — Expiration Notice", "#b91c1c", "#fef2f2"
    elif lead_days in (1, 3, 5):
        return f"⚠️ Urgent Final Week Notice ({lead_days}d remaining)", "#c2410c", "#fff7ed"
    elif lead_days in (7, 14, 21):
        return f"⏳ Weekly Compliance Notice ({lead_days}d remaining)", "#0369a1", "#f0f9ff"
    elif lead_days >= 30:
        return f"📅 Advance Notice ({lead_days}d remaining)", "#0f766e", "#f0fdfa"
    return f"Notice ({lead_days}d remaining)", "#334155", "#f8fafc"


async def populate_document_reminders(db: AsyncSession, document: SharePointDocument, analysis: dict | None, source_id: uuid.UUID, *, commit: bool = True):
    if not analysis:
        return

    # Delete stale uncompleted reminders for this document first (Issue #18)
    await db.execute(
        delete(SharePointReminder).where(
            SharePointReminder.document_id == document.id,
            SharePointReminder.status.in_(["pending", "failed", "skipped"]),
        )
    )

    sections = analysis.get("sections") or [analysis]
    mapping = decrypt(document.mapping_cipher) if document.mapping_cipher else {}
    primary_commercial = None

    # Collect commercial values
    for section in sections:
        for comm in section.get("commercials") or []:
            if comm.get("amount") is not None:
                primary_commercial = comm
                break
        if primary_commercial:
            break

    reminders_to_insert = []
    seen_dedup = set()

    for section in sections:
        # 1. Document Expiries & Renewals: Monthly -> Weekly -> 3x Final Week -> Due Date
        for exp in section.get("expiries") or []:
            t_date = exp.get("date")
            if not t_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", t_date):
                continue
            title = exp.get("title") or "Document Expiration"
            responsible = exp.get("responsible")
            category = exp.get("category") or "expiry"
            clean_responsible = restore(responsible, mapping) if (responsible and mapping) else responsible
            recipient = await _resolve_recipient(db, clean_responsible)
            unassigned_note = f" [Unassigned recipient for '{responsible}']" if responsible and not recipient else ""

            for lead in EXPIRY_ESCALATION_LEADS:
                r_date = _calculate_reminder_date(t_date, lead)
                dedup = digest([str(document.id), title, t_date, str(lead)])[:64]
                if dedup in seen_dedup:
                    continue
                seen_dedup.add(dedup)
                stage_label, _, _ = reminder_stage_label(lead)
                reminders_to_insert.append({
                    "id": uuid.uuid4(),
                    "source_id": source_id,
                    "document_id": document.id,
                    "title": title,
                    "category": category,
                    "target_date": t_date,
                    "reminder_date": r_date,
                    "lead_days": lead,
                    "responsible_name": responsible,
                    "recipient_email": recipient,
                    "amount": primary_commercial.get("amount") if primary_commercial else None,
                    "currency": primary_commercial.get("currency") if primary_commercial else None,
                    "status": "pending",
                    "attempts": 0,
                    "dedup_key": dedup,
                    "notes": f"Escalation: {stage_label}.{unassigned_note}",
                })

        # 2. Critical Deadlines
        for finding in section.get("deadlines") or []:
            t_date = finding.get("deadline")
            if not t_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", t_date):
                continue
            title = finding.get("title") or "Document Deadline"
            owner = finding.get("owner")
            clean_owner = restore(owner, mapping) if (owner and mapping) else owner
            recipient = await _resolve_recipient(db, clean_owner)
            unassigned_note = f" [Unassigned recipient for '{owner}']" if owner and not recipient else ""

            for lead in TASK_DEADLINE_ESCALATION_LEADS:
                r_date = _calculate_reminder_date(t_date, lead)
                dedup = digest([str(document.id), title, t_date, str(lead)])[:64]
                if dedup in seen_dedup:
                    continue
                seen_dedup.add(dedup)
                stage_label, _, _ = reminder_stage_label(lead)
                reminders_to_insert.append({
                    "id": uuid.uuid4(),
                    "source_id": source_id,
                    "document_id": document.id,
                    "title": title,
                    "category": "deadline",
                    "target_date": t_date,
                    "reminder_date": r_date,
                    "lead_days": lead,
                    "responsible_name": owner,
                    "recipient_email": recipient,
                    "amount": None,
                    "currency": None,
                    "status": "pending",
                    "attempts": 0,
                    "dedup_key": dedup,
                    "notes": f"Milestone deadline ({stage_label}).{unassigned_note}",
                })

        # 3. Actionable Tasks & Deliverables
        for task in section.get("tasks") or []:
            title = task.get("title") or "Document Task"
            t_date = task.get("deadline")
            if not t_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", t_date):
                t_date = _calculate_reminder_date(date.today().isoformat(), -30)
            owner = task.get("owner")
            clean_owner = restore(owner, mapping) if (owner and mapping) else owner
            recipient = await _resolve_recipient(db, clean_owner)
            priority = task.get("priority") or "medium"
            task_status = task.get("status") or "pending"
            initial_status = "completed" if task_status == "completed" else "pending"
            unassigned_note = f" [Unassigned recipient for '{owner}']" if owner and not recipient else ""

            for lead in TASK_DEADLINE_ESCALATION_LEADS:
                r_date = _calculate_reminder_date(t_date, lead)
                dedup = digest([str(document.id), title, t_date, str(lead)])[:64]
                if dedup in seen_dedup:
                    continue
                seen_dedup.add(dedup)
                stage_label, _, _ = reminder_stage_label(lead)
                reminders_to_insert.append({
                    "id": uuid.uuid4(),
                    "source_id": source_id,
                    "document_id": document.id,
                    "title": title,
                    "category": "task",
                    "target_date": t_date,
                    "reminder_date": r_date,
                    "lead_days": lead,
                    "responsible_name": owner,
                    "recipient_email": recipient,
                    "amount": None,
                    "currency": None,
                    "status": initial_status,
                    "attempts": 0,
                    "dedup_key": dedup,
                    "notes": f"Priority: {priority} ({stage_label}).{unassigned_note}",
                })

    for r in reminders_to_insert:
        stmt = (
            pg_insert(SharePointReminder)
            .values(**r)
            .on_conflict_do_nothing(index_elements=["document_id", "dedup_key"])
        )
        await db.execute(stmt)
    if commit:
        await db.commit()


def reminder_email_html(reminder: SharePointReminder, document: SharePointDocument) -> str:
    target_date_str = html.escape(reminder.target_date or "")
    days_left_text = ""
    try:
        days_left = (date.fromisoformat(reminder.target_date) - date.today()).days
        if days_left > 0:
            days_left_text = f"({days_left} day{'s' if days_left != 1 else ''} remaining)"
        elif days_left == 0:
            days_left_text = "(Due TODAY)"
        else:
            days_left_text = f"({abs(days_left)} days OVERDUE)"
    except Exception:
        pass

    stage_label, badge_color, bg_color = reminder_stage_label(reminder.lead_days)
    doc_display_path = html.escape(document.path or document.filename or "")
    path_row = f"<p style='color:#64748b;font-size:13px;margin:4px 0;'><strong>SharePoint Path:</strong> {doc_display_path}</p>"
    pricing_row = ""
    if reminder.amount is not None:
        curr = html.escape(reminder.currency or "USD")
        pricing_row = f"<p style='color:#0f172a;font-size:14px;margin:6px 0;'><strong>Tracked Commercial Value:</strong> {reminder.amount:,.2f} {curr}</p>"

    owner_row = ""
    if reminder.responsible_name:
        owner_name = html.escape(reminder.responsible_name)
        owner_row = f"<p style='color:#64748b;font-size:13px;margin:4px 0;'><strong>Assigned Contact:</strong> {owner_name}</p>"

    open_button = ""
    if document.web_url:
        parsed = urlparse(document.web_url)
        if parsed.scheme == "https" and parsed.netloc and (
            parsed.netloc.endswith(".sharepoint.com")
            or parsed.netloc.endswith(".microsoft.com")
            or parsed.netloc == "sharepoint.com"
        ):
            safe_url = html.escape(document.web_url, quote=True)
            open_button = (
                f"<p style='margin:24px 0 12px 0;'>"
                f"<a href='{safe_url}' style='background:#0b5cab;color:#ffffff;padding:12px 24px;"
                f"border-radius:4px;text-decoration:none;font-weight:600;display:inline-block;'>Open Document in SharePoint</a>"
                f"</p>"
            )

    safe_title = html.escape(reminder.title or "Document Notification")
    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;padding:24px;background:#ffffff;">
      <div style="border-bottom:2px solid #0b5cab;padding-bottom:12px;margin-bottom:18px;">
        <span style="font-size:11px;font-weight:700;color:#0b5cab;letter-spacing:1px;text-transform:uppercase;">AG Holding · Document Intelligence</span>
        <h2 style="color:#0f172a;margin:6px 0 0 0;font-size:20px;">{safe_title}</h2>
      </div>
      <div style="background:{bg_color};border-left:4px solid {badge_color};padding:12px 16px;margin-bottom:18px;">
        <div style="font-size:12px;font-weight:700;color:{badge_color};margin-bottom:4px;">{stage_label}</div>
        <p style="margin:0;font-size:15px;color:#0f172a;">
          <strong>Target Date:</strong> <span style="color:#b91c1c;font-weight:700;">{target_date_str}</span> {days_left_text}
        </p>
      </div>
      {path_row}
      {owner_row}
      {pricing_row}
      {open_button}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;border-top:1px solid #f1f5f9;padding-top:12px;">
        This automated reminder was generated by the SharePoint Intelligence compliance engine.
      </p>
    </div>
    """


async def deliver_reminder(db: AsyncSession, reminder: SharePointReminder) -> bool:
    document = await db.get(SharePointDocument, reminder.document_id)
    if not document or document.deleted or not document.in_scope:
        reminder.status = "dismissed"
        await db.commit()
        return False

    recipient = reminder.recipient_email
    if not recipient:
        log.info("Skipping reminder %s: no verified platform user recipient", reminder.id)
        reminder.last_error = "Unassigned recipient"
        await db.commit()
        return False

    # Verify recipient is an active platform user
    recipient_user = (
        await db.execute(
            select(User).where(
                func.lower(User.email) == recipient.strip().lower(),
                User.is_active.is_(True),
            )
        )
    ).scalars().first()

    if not recipient_user:
        log.warning("Recipient %s is not an active platform user; skipping delivery", recipient)
        reminder.last_error = "Recipient is not an active platform user"
        reminder.attempts = (reminder.attempts or 0) + 1
        if reminder.attempts >= 3:
            reminder.status = "failed"
        await db.commit()
        return False

    # Cross-check recipient's SharePoint authorization to this document
    source = await db.get(SharePointSource, reminder.source_id)
    if source:
        conn = await db.get(SharePointConnection, recipient_user.id)
        if not conn:
            log.warning("Recipient %s has no active Microsoft SharePoint connection; skipping delivery", recipient)
            reminder.last_error = "Recipient Microsoft connection required"
            reminder.attempts = (reminder.attempts or 0) + 1
            if reminder.attempts >= 3:
                reminder.status = "failed"
            await db.commit()
            return False
        try:
            await authorize_document(db, recipient_user, source, document, use_cache=True)
        except SharePointError as e:
            if e.code in ("document_access_denied", "document_not_found"):
                log.warning("Recipient %s denied access to document %s in SharePoint; skipping delivery", recipient, document.id)
                reminder.last_error = f"Recipient not authorized: {e.code}"
                reminder.attempts = (reminder.attempts or 0) + 1
                if reminder.attempts >= 3:
                    reminder.status = "failed"
                await db.commit()
                return False
            elif e.code == "microsoft_connection_required":
                log.warning("Recipient %s Microsoft connection required", recipient)
                reminder.last_error = "Recipient Microsoft connection required"
                reminder.attempts = (reminder.attempts or 0) + 1
                if reminder.attempts >= 3:
                    reminder.status = "failed"
                await db.commit()
                return False

    stage_label, _, _ = reminder_stage_label(reminder.lead_days)
    subject = f"{stage_label.split()[0]} {reminder.title} — {document.filename} ({reminder.target_date})"
    html_body = reminder_email_html(reminder, document)

    # 1. Email delivery via threadpool (non-blocking, Issue #20)
    email_sent = False
    try:
        email_sent = await asyncio.to_thread(
            send_email,
            to=recipient,
            subject=subject,
            html=html_body,
        )
    except Exception as e:
        log.warning("Failed to send reminder email to %s: %s", recipient, e)
        reminder.last_error = str(e)[:255]

    # 2. Microsoft Teams card delivery via threadpool (non-sensitive notification pointer only, Issue #17)
    try:
        teams_body = (
            "A document compliance reminder has been dispatched to the assigned owner. "
            "Authorized team members can view details and take action in Company Tools."
        )
        safe_link = f"{settings.PUBLIC_BASE_URL.rstrip('/')}/sharepoint" if settings.PUBLIC_BASE_URL else None
        await asyncio.to_thread(
            send_teams,
            title=f"Document Alert: {_escape_teams_markdown(reminder.title)}",
            body=teams_body,
            link=safe_link,
        )
    except Exception as e:
        log.warning("Failed to dispatch Teams reminder: %s", e)

    reminder.attempts = (reminder.attempts or 0) + 1

    if email_sent:
        reminder.status = "sent"
        reminder.sent_at = now()
        reminder.last_error = None
    else:
        # Retryable state with attempts counter (Issue #18)
        if reminder.attempts >= 3:
            reminder.status = "failed"
        else:
            reminder.status = "pending"

    await db.commit()
    return email_sent


async def run_sharepoint_reminders(db: AsyncSession) -> dict:
    today_iso = date.today().isoformat()

    async def _run_batch() -> dict:
        # Find pending reminders where reminder_date is due, ordered by target_date and lead_days
        stmt = (
            select(SharePointReminder)
            .where(
                SharePointReminder.status == "pending",
                SharePointReminder.reminder_date <= today_iso,
                SharePointReminder.attempts < 3,
            )
            .order_by(
                SharePointReminder.target_date.asc(),
                SharePointReminder.lead_days.asc(),
            )
            .limit(100)
        )
        reminders = list((await db.scalars(stmt)).all())
        if not reminders:
            return {"checked": 0, "created": 0}

        # Burst-prevention: group by (document_id, title, target_date) (Issue #18)
        # Deliver only the single most urgent due stage (lowest lead_days)
        # Mark superseded earlier stages skipped
        groups: dict[tuple, list[SharePointReminder]] = {}
        for r in reminders:
            group_key = (r.document_id, r.title, r.target_date)
            groups.setdefault(group_key, []).append(r)

        to_deliver: list[SharePointReminder] = []
        for group_key, items in groups.items():
            # Sort by lead_days ascending (0 is day of expiry, 1 is 1 day before, etc. - lowest lead_days = most urgent)
            items.sort(key=lambda x: x.lead_days)
            most_urgent = items[0]
            to_deliver.append(most_urgent)
            for superseded in items[1:]:
                superseded.status = "skipped"
                superseded.notes = (superseded.notes or "") + " [Skipped: superseded by urgent stage]"

        await db.commit()

        sent_count = 0
        for rem in to_deliver:
            if await deliver_reminder(db, rem):
                sent_count += 1

        return {"checked": len(reminders), "created": sent_count}

    try:
        return await asyncio.wait_for(_run_batch(), timeout=120.0)
    except asyncio.TimeoutError:
        log.error("SharePoint reminder run timed out after 120s")
        return {"checked": 0, "created": 0, "error": "timeout"}
