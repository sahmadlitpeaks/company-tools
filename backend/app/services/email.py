"""Best-effort email delivery.

If SMTP settings are configured, sends a real email; otherwise it's a no-op so
the rest of the flow (which always returns the share link) keeps working in dev.
"""
import smtplib
from email.message import EmailMessage
from html import escape

from app.core.config import settings


def smtp_configured() -> bool:
    host = settings.SMTP_HOST.strip().casefold()
    if not host:
        return False
    # Brevo requires an SMTP key and an explicit sender address. A relay host
    # alone must not make the UI claim that email delivery is configured.
    if host == "smtp-relay.brevo.com":
        user = settings.SMTP_USER.strip()
        sender = settings.SMTP_FROM.strip()
        return bool(user and settings.SMTP_PASSWORD.strip() and sender and sender.casefold() != user.casefold())
    # Microsoft 365 client submission needs a mailbox login and STARTTLS.
    # A host alone must not make Governance claim Outlook email is ready.
    if host == "smtp.office365.com":
        return bool(settings.SMTP_PORT in (25, 587) and settings.SMTP_STARTTLS
                    and settings.SMTP_USER.strip() and settings.SMTP_PASSWORD.strip()
                    and settings.SMTP_FROM.strip())
    return True


def smtp_diagnostics():
    """Safe configuration summary: never return credentials or server responses."""
    host = settings.SMTP_HOST.strip().casefold()
    missing = []
    if not host:
        missing.append("SMTP_HOST")
    if host in {"smtp-relay.brevo.com", "smtp.office365.com"}:
        for key in ("SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"):
            if not getattr(settings, key).strip():
                missing.append(key)
    issues = []
    if host == "smtp.office365.com" and (settings.SMTP_PORT not in (25, 587) or not settings.SMTP_STARTTLS):
        issues.append("Microsoft 365 requires STARTTLS on port 587 or 25.")
    if host == "smtp-relay.brevo.com" and settings.SMTP_FROM and settings.SMTP_FROM.casefold() == settings.SMTP_USER.casefold():
        issues.append("Brevo needs a verified sender address, separate from the SMTP login.")
    if bool(settings.SMTP_USER) != bool(settings.SMTP_PASSWORD):
        issues.append("Set both SMTP_USER and SMTP_PASSWORD for authenticated delivery.")
    return {"configured": smtp_configured(), "missing": missing, "issues": issues}


def check_smtp_connection():
    diagnostics = smtp_diagnostics()
    if not diagnostics["configured"] or diagnostics["issues"]:
        return {"ok": False, "message": "Email settings are incomplete. Resolve the configuration issues first.", **diagnostics}
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            smtp.ehlo()
            if settings.SMTP_STARTTLS:
                smtp.starttls()
                smtp.ehlo()
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
    except smtplib.SMTPAuthenticationError:
        return {"ok": False, "message": "The mail server rejected the login. Check the SMTP credentials and mailbox authentication settings."}
    except smtplib.SMTPException:
        return {"ok": False, "message": "The mail server rejected the connection or encryption settings."}
    except (OSError, TimeoutError):
        return {"ok": False, "message": "The mail server could not be reached. Check the host, port, and deployment network access."}
    return {"ok": True, "message": "Mail server connection and configured login succeeded. No email was sent. Sender permission and inbox delivery still need to be verified."}


def send_email(to: str, subject: str, html: str) -> bool:
    if not smtp_configured():
        return False
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER or "no-reply@agholding.net"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content("This message requires an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
        if settings.SMTP_STARTTLS:
            s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        s.send_message(msg)
    return True


def notification_email_html(title: str, body: str | None, link: str | None) -> str:
    note = f"<p style='color:#334155'>{body}</p>" if body else ""
    button = (
        f"<p style='margin:24px 0'>"
        f"<a href='{link}' style='background:#0b5cab;color:#fff;padding:12px 24px;"
        f"border-radius:8px;text-decoration:none;font-weight:700'>Open</a></p>"
        if link
        else ""
    )
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0b5cab">{title}</h2>
      {note}
      {button}
      <p style="color:#64748b;font-size:13px">AG Holding — Internal Platform</p>
    </div>
    """


def welcome_email_html(
    *,
    name: str,
    login_email: str,
    temp_password: str,
    link: str,
    reset: bool = False,
) -> str:
    """Credentials for a new account, or a re-issued password after a reset.

    Values are escaped: they come from admin-entered profile fields, and a name
    containing "<" would otherwise break the markup.
    """
    who = escape(name or login_email)
    lead = (
        "Your password for the AG Holding internal platform has been reset."
        if reset
        else "An account has been created for you on the AG Holding internal platform."
    )
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0b5cab">{'Your password was reset' if reset else 'Welcome to AG Holding'}</h2>
      <p style="color:#334155">Hello {who},</p>
      <p style="color:#334155">{lead} Sign in with the temporary password below —
         you'll be asked to choose your own password straight away.</p>
      <table style="border-collapse:collapse;margin:20px 0">
        <tr>
          <td style="padding:6px 12px;color:#64748b;font-size:13px">Email</td>
          <td style="padding:6px 12px;font-weight:700">{escape(login_email)}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;color:#64748b;font-size:13px">Temporary password</td>
          <td style="padding:6px 12px;font-weight:700;font-family:monospace;font-size:16px">
            {escape(temp_password)}</td>
        </tr>
      </table>
      <p style="margin:24px 0">
        <a href="{escape(link, quote=True)}" style="background:#0b5cab;color:#fff;padding:12px 24px;
           border-radius:8px;text-decoration:none;font-weight:700">Sign in</a>
      </p>
      <p style="color:#64748b;font-size:13px">This password is temporary and must be
         changed the first time you sign in. If you weren't expecting this email,
         please tell your IT administrator.</p>
      <p style="color:#64748b;font-size:13px">AG Holding — Internal Platform</p>
    </div>
    """


def transfer_email_html(sender: str, message: str | None, link: str) -> str:
    note = f"<p>{message}</p>" if message else ""
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0b5cab">A secure file has been shared with you</h2>
      <p><strong>{sender}</strong> sent you a file via the AG Holding secure
         transfer service.</p>
      {note}
      <p style="margin:24px 0">
        <a href="{link}" style="background:#0b5cab;color:#fff;padding:12px 24px;
           border-radius:8px;text-decoration:none;font-weight:700">
           Download file</a>
      </p>
      <p style="color:#64748b;font-size:13px">This link is single-use and will
         expire. If you did not expect this file, you can ignore this email.</p>
    </div>
    """
