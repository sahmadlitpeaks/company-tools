"""Automated reminder engine for SharePoint document expiries, deadlines, and pricing."""
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.sharepoint import SharePointDocument, SharePointReminder
from app.models.user import User
from app.services.dispatch import send_teams
from app.services.email import send_email
from app.services.sharepoint.common import digest, now

log = logging.getLogger("sharepoint_reminders")


def _calculate_reminder_date(target_iso: str, lead_days: int) -> str:
    try:
        t_date = date.fromisoformat(target_iso)
        r_date = t_date - timedelta(days=lead_days)
        return r_date.isoformat()
    except (ValueError, TypeError):
        return target_iso


async def _resolve_recipient(db: AsyncSession, name: str | None) -> str:
    default_email = (settings.DEFAULT_ADMIN_EMAIL or "admin@agholding.net").strip().lower()
    if not name:
        return default_email
    name_clean = name.strip()
    if "@" in name_clean and "." in name_clean:
        return name_clean.lower()
    # Attempt lookup by display name
    user = (await db.execute(select(User).where(User.display_name.ilike(f"%{name_clean}%"), User.is_active == True))).scalars().first()
    if user and user.email:
        return user.email.lower()
    return default_email


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


async def populate_document_reminders(db: AsyncSession, document: SharePointDocument, analysis: dict | None, source_id: uuid.UUID):
    if not analysis:
        return
    sections = analysis.get("sections") or [analysis]
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
            recipient = await _resolve_recipient(db, responsible)

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
                    "dedup_key": dedup,
                    "notes": f"Escalation: {stage_label}.",
                })

        # 2. Critical Deadlines
        for finding in section.get("deadlines") or []:
            t_date = finding.get("deadline")
            if not t_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", t_date):
                continue
            title = finding.get("title") or "Document Deadline"
            owner = finding.get("owner")
            recipient = await _resolve_recipient(db, owner)

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
                    "dedup_key": dedup,
                    "notes": f"Milestone deadline ({stage_label}).",
                })

        # 3. Actionable Tasks & Deliverables
        for task in section.get("tasks") or []:
            title = task.get("title") or "Document Task"
            t_date = task.get("deadline")
            if not t_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", t_date):
                t_date = _calculate_reminder_date(date.today().isoformat(), -30)
            owner = task.get("owner")
            recipient = await _resolve_recipient(db, owner)
            priority = task.get("priority") or "medium"
            task_status = task.get("status") or "pending"
            initial_status = "completed" if task_status == "completed" else "pending"

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
                    "dedup_key": dedup,
                    "notes": f"Priority: {priority} ({stage_label}).",
                })

    for r in reminders_to_insert:
        stmt = (
            pg_insert(SharePointReminder)
            .values(**r)
            .on_conflict_do_nothing(index_elements=["document_id", "dedup_key"])
        )
        await db.execute(stmt)
    await db.commit()


def reminder_email_html(reminder: SharePointReminder, document: SharePointDocument) -> str:
    target_date_str = reminder.target_date
    days_left_text = ""
    try:
        days_left = (date.fromisoformat(target_date_str) - date.today()).days
        if days_left > 0:
            days_left_text = f"({days_left} day{'s' if days_left != 1 else ''} remaining)"
        elif days_left == 0:
            days_left_text = "(Due TODAY)"
        else:
            days_left_text = f"({abs(days_left)} days OVERDUE)"
    except Exception:
        pass

    stage_label, badge_color, bg_color = reminder_stage_label(reminder.lead_days)
    path_row = f"<p style='color:#64748b;font-size:13px;margin:4px 0;'><strong>SharePoint Path:</strong> {document.path or document.filename}</p>"
    pricing_row = ""
    if reminder.amount is not None:
        curr = reminder.currency or "USD"
        pricing_row = f"<p style='color:#0f172a;font-size:14px;margin:6px 0;'><strong>Tracked Commercial Value:</strong> {reminder.amount:,.2f} {curr}</p>"

    owner_row = ""
    if reminder.responsible_name:
        owner_row = f"<p style='color:#64748b;font-size:13px;margin:4px 0;'><strong>Assigned Contact:</strong> {reminder.responsible_name}</p>"

    open_button = ""
    if document.web_url:
        open_button = (
            f"<p style='margin:24px 0 12px 0;'>"
            f"<a href='{document.web_url}' style='background:#0b5cab;color:#ffffff;padding:12px 24px;"
            f"border-radius:4px;text-decoration:none;font-weight:600;display:inline-block;'>Open Document in SharePoint</a>"
            f"</p>"
        )

    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;padding:24px;background:#ffffff;">
      <div style="border-bottom:2px solid #0b5cab;padding-bottom:12px;margin-bottom:18px;">
        <span style="font-size:11px;font-weight:700;color:#0b5cab;letter-spacing:1px;text-transform:uppercase;">AG Holding · Document Intelligence</span>
        <h2 style="color:#0f172a;margin:6px 0 0 0;font-size:20px;">{reminder.title}</h2>
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
    if not document or document.deleted:
        reminder.status = "dismissed"
        await db.commit()
        return False

    success = False
    recipient = reminder.recipient_email or (settings.DEFAULT_ADMIN_EMAIL or "admin@agholding.net")
    stage_label, _, _ = reminder_stage_label(reminder.lead_days)
    subject = f"{stage_label.split()[0]} {reminder.title} — {document.filename} ({reminder.target_date})"
    html_body = reminder_email_html(reminder, document)

    # 1. Email delivery
    try:
        email_sent = send_email(to=recipient, subject=subject, html=html_body)
        if email_sent:
            success = True
    except Exception as e:
        log.warning("Failed to send reminder email to %s: %s", recipient, e)
        reminder.last_error = str(e)[:255]

    # 2. Microsoft Teams card delivery
    try:
        teams_body = (
            f"**Notification Stage:** {stage_label}  \n"
            f"**Target Date:** {reminder.target_date}  \n"
            f"**Document:** {document.filename}  \n"
            f"**Path:** {document.path or 'SharePoint'}  \n"
            f"**Responsible:** {reminder.responsible_name or 'Unassigned'}"
        )
        if reminder.amount:
            teams_body += f"  \n**Tracked Value:** {reminder.amount:,.2f} {reminder.currency or 'USD'}"
        teams_sent = send_teams(title=f"Document Alert: {reminder.title}", body=teams_body, link=document.web_url)
        if teams_sent:
            success = True
    except Exception as e:
        log.warning("Failed to dispatch Teams reminder: %s", e)

    if success:
        reminder.status = "sent"
        reminder.sent_at = now()
        reminder.last_error = None
    else:
        reminder.status = "failed"

    await db.commit()
    return success


async def run_sharepoint_reminders(db: AsyncSession) -> dict:
    today_iso = date.today().isoformat()
    # Find pending reminders where reminder_date is due
    stmt = (
        select(SharePointReminder)
        .where(
            SharePointReminder.status == "pending",
            SharePointReminder.reminder_date <= today_iso,
        )
        .limit(100)
    )
    reminders = list((await db.scalars(stmt)).all())
    sent_count = 0
    for rem in reminders:
        if await deliver_reminder(db, rem):
            sent_count += 1

    return {"checked": len(reminders), "created": sent_count}
