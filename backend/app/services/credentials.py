"""Issuing first-login credentials for locally-managed (non-SSO) accounts.

An admin creates the account; the platform mints a temporary password, mails it
and forces a change at first sign-in. The generated password is also returned to
the caller so an admin can pass it on by hand when SMTP isn't configured or the
send fails — otherwise a failed email would leave an account nobody can enter.
"""
import logging

from app.core.security import generate_temp_password, hash_password
from app.core.urls import frontend_base_url
from app.models.user import User
from app.services.email import send_email, welcome_email_html

log = logging.getLogger(__name__)


def issue_temp_password(user: User, *, reset: bool = False) -> tuple[str, bool]:
    """Set a fresh temporary password on ``user`` and try to email it.

    Returns ``(temp_password, emailed)``. Does not commit — the caller owns the
    transaction. ``emailed`` is False when SMTP is unconfigured or the send
    failed, which is the signal to show the password to the admin instead.
    """
    temp = generate_temp_password()
    user.password_hash = hash_password(temp)
    user.must_change_password = True

    to = user.email or user.personal_email
    if not to:
        return temp, False

    base = frontend_base_url().rstrip("/")
    try:
        emailed = send_email(
            to,
            "Your password was reset" if reset else "Your AG Holding account",
            welcome_email_html(
                name=user.display_name or "",
                login_email=user.email or to,
                temp_password=temp,
                link=f"{base}/login" if base else "",
                reset=reset,
            ),
        )
    except Exception:
        # Never let a mail-server problem roll back account creation.
        log.exception("Failed to email credentials to %s", to)
        emailed = False
    return temp, emailed
