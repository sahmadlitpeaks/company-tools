"""Best-effort outbound notification fan-out (email + Slack).

Used to mirror in-app notifications to external channels when configured.
Every send is wrapped so a transport failure never breaks the request flow.
"""
import json
import urllib.error
import urllib.request

from app.core.config import settings
from app.services.email import notification_email_html, send_email, smtp_configured


def slack_enabled() -> bool:
    return bool(settings.SLACK_WEBHOOK_URL)


def teams_enabled() -> bool:
    return bool(settings.TEAMS_WEBHOOK_URL)


def email_enabled() -> bool:
    return smtp_configured()


def send_slack(text: str) -> bool:
    """Post a simple message to the configured Slack incoming webhook."""
    if not slack_enabled():
        return False
    data = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        settings.SLACK_WEBHOOK_URL, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (configured URL)
        return 200 <= resp.status < 300


def send_teams(title: str, body: str | None, link: str | None) -> bool:
    """Post an Adaptive Card or MessageCard to the configured Teams incoming webhook."""
    if not teams_enabled():
        return False
    abs_link = _absolute(link)

    # 1. Modern Adaptive Card (supported by Power Automate "Send webhook alerts to a channel")
    adaptive_card = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": None,
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [
                        {
                            "type": "TextBlock",
                            "size": "Medium",
                            "weight": "Bolder",
                            "text": title,
                        },
                        *(
                            [{"type": "TextBlock", "text": body, "wrap": True}]
                            if body
                            else []
                        ),
                    ],
                    "actions": (
                        [
                            {
                                "type": "Action.OpenUrl",
                                "title": "Open",
                                "url": abs_link,
                            }
                        ]
                        if abs_link
                        else []
                    ),
                },
            }
        ],
    }

    try:
        data = json.dumps(adaptive_card).encode()
        req = urllib.request.Request(
            settings.TEAMS_WEBHOOK_URL, data=data, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (configured URL)
            if 200 <= resp.status < 300:
                return True
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403, 404, 410):
            return False
    except Exception:
        pass

    # 2. Legacy MessageCard fallback (for classic Office 365 connectors)
    card: dict = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": title,
        "themeColor": "0b5cab",
        "title": title,
        "text": body or "",
    }
    if abs_link:
        card["potentialAction"] = [{
            "@type": "OpenUri",
            "name": "Open",
            "targets": [{"os": "default", "uri": abs_link}],
        }]
    try:
        data = json.dumps(card).encode()
        req = urllib.request.Request(
            settings.TEAMS_WEBHOOK_URL, data=data, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (configured URL)
            return 200 <= resp.status < 300
    except Exception:
        return False


def deliver_notification(
    *,
    to_email: str | None,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> list[str]:
    """Fan a notification out to external channels; returns channels attempted.

    Failures are swallowed per-channel so callers can fire-and-forget.
    """
    sent: list[str] = []
    if to_email and email_enabled():
        try:
            full_link = _absolute(link)
            if send_email(to_email, title, notification_email_html(title, body, full_link)):
                sent.append("email")
        except Exception:
            pass
    if slack_enabled():
        try:
            text = f"*{title}*"
            if body:
                text += f"\n{body}"
            if link:
                text += f"\n{_absolute(link)}"
            if send_slack(text):
                sent.append("slack")
        except Exception:
            pass
    if teams_enabled():
        try:
            if send_teams(title, body, link):
                sent.append("teams")
        except Exception:
            pass
    return sent


def _absolute(link: str | None) -> str | None:
    if not link:
        return None
    if link.startswith("http://") or link.startswith("https://"):
        return link
    base = (settings.FRONTEND_BASE_URL or settings.PUBLIC_BASE_URL or "").rstrip("/")
    return f"{base}{link}" if base else link
