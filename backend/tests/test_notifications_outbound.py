import pytest

from app.services import dispatch

pytestmark = pytest.mark.asyncio


def test_deliver_gating_no_config(monkeypatch):
    # Nothing configured → no channels attempted.
    monkeypatch.setattr(dispatch.settings, "SMTP_HOST", "", raising=False)
    monkeypatch.setattr(dispatch.settings, "SLACK_WEBHOOK_URL", "", raising=False)
    assert dispatch.deliver_notification(to_email="a@b.com", title="Hi") == []


def test_deliver_uses_email_and_slack(monkeypatch):
    monkeypatch.setattr(dispatch.settings, "SMTP_HOST", "smtp.test", raising=False)
    monkeypatch.setattr(dispatch.settings, "SLACK_WEBHOOK_URL", "https://hooks.slack/x", raising=False)
    sent_email = {}

    def fake_send_email(to, subject, html):
        sent_email["to"] = to
        return True

    def fake_send_slack(text):
        sent_email["slack"] = text
        return True

    monkeypatch.setattr(dispatch, "send_email", fake_send_email)
    monkeypatch.setattr(dispatch, "send_slack", fake_send_slack)
    channels = dispatch.deliver_notification(to_email="a@b.com", title="Hello", body="World", link="/x")
    assert set(channels) == {"email", "slack"}
    assert sent_email["to"] == "a@b.com"
    assert "Hello" in sent_email["slack"]


def test_deliver_swallows_transport_errors(monkeypatch):
    monkeypatch.setattr(dispatch.settings, "SMTP_HOST", "smtp.test", raising=False)
    monkeypatch.setattr(dispatch.settings, "SLACK_WEBHOOK_URL", "", raising=False)

    def boom(*a, **k):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(dispatch, "send_email", boom)
    # Should not raise; email failed so no channels reported.
    assert dispatch.deliver_notification(to_email="a@b.com", title="Hi") == []


async def test_channels_and_test_endpoints(client, auth):
    status = (await client.get("/api/notifications/channels", headers=auth)).json()
    assert "outbound_enabled" in status and "email_configured" in status

    res = (await client.post("/api/notifications/test", headers=auth)).json()
    assert res["in_app"] is True
    # No transports configured in tests → no external channels.
    assert res["external_channels"] == []

    # The in-app test notification is visible.
    notes = (await client.get("/api/notifications", headers=auth)).json()
    assert any(n["title"] == "Test notification" for n in notes)
