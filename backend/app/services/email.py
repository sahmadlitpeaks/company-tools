"""Best-effort email delivery.

If SMTP settings are configured, sends a real email; otherwise it's a no-op so
the rest of the flow (which always returns the share link) keeps working in dev.
"""
import smtplib
from email.message import EmailMessage
from html import escape

from app.core.config import settings


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST)


def send_email(to: str, subject: str, html: str) -> bool:
    if not _smtp_configured():
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
