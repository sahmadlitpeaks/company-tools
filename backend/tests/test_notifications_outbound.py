import pytest

from app.services import dispatch, email


def test_deliver_gating_no_config(monkeypatch):
    # Nothing configured → no channels attempted.
    monkeypatch.setattr(dispatch.settings, "SMTP_HOST", "", raising=False)
    monkeypatch.setattr(dispatch.settings, "SLACK_WEBHOOK_URL", "", raising=False)
    monkeypatch.setattr(dispatch.settings, "TEAMS_WEBHOOK_URL", "", raising=False)
    assert dispatch.deliver_notification(to_email="a@b.com", title="Hi") == []


def test_deliver_uses_teams(monkeypatch):
    monkeypatch.setattr(dispatch.settings, "SMTP_HOST", "", raising=False)
    monkeypatch.setattr(dispatch.settings, "SLACK_WEBHOOK_URL", "", raising=False)
    monkeypatch.setattr(dispatch.settings, "TEAMS_WEBHOOK_URL", "https://outlook.office.com/webhook/x", raising=False)
    captured = {}

    def fake_send_teams(title, body, link):
        captured["title"] = title
        return True

    monkeypatch.setattr(dispatch, "send_teams", fake_send_teams)
    channels = dispatch.deliver_notification(to_email=None, title="Ping", body="b", link="/x")
    assert channels == ["teams"] and captured["title"] == "Ping"


def test_deliver_uses_email_and_slack(monkeypatch):
    monkeypatch.setattr(dispatch.settings, "SMTP_HOST", "smtp.test", raising=False)
    monkeypatch.setattr(dispatch.settings, "SLACK_WEBHOOK_URL", "https://hooks.slack/x", raising=False)
    monkeypatch.setattr(dispatch.settings, "TEAMS_WEBHOOK_URL", "", raising=False)
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


def test_brevo_smtp_requires_key_and_explicit_sender(monkeypatch):
    monkeypatch.setattr(email.settings, "SMTP_HOST", "smtp-relay.brevo.com")
    monkeypatch.setattr(email.settings, "SMTP_USER", "relay@smtp-brevo.com")
    monkeypatch.setattr(email.settings, "SMTP_PASSWORD", "")
    monkeypatch.setattr(email.settings, "SMTP_FROM", "")
    assert not dispatch.email_enabled()
    assert email.send_email("recipient@example.com", "Test", "<p>Test</p>") is False

    monkeypatch.setattr(email.settings, "SMTP_PASSWORD", "test-smtp-key")
    monkeypatch.setattr(email.settings, "SMTP_FROM", "relay@smtp-brevo.com")
    assert not dispatch.email_enabled()
    monkeypatch.setattr(email.settings, "SMTP_FROM", "verified@example.com")
    monkeypatch.setattr(email.settings, "SMTP_PORT", 587)
    monkeypatch.setattr(email.settings, "SMTP_STARTTLS", True)
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            sent["connection"] = (host, port, timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def starttls(self):
            sent["tls"] = True

        def login(self, user, password):
            sent["login"] = (user, password)

        def send_message(self, message):
            sent["message"] = message

    monkeypatch.setattr(email.smtplib, "SMTP", FakeSMTP)
    assert dispatch.email_enabled()
    assert email.send_email("recipient@example.com", "Test", "<p>Test</p>") is True
    assert sent["connection"] == ("smtp-relay.brevo.com", 587, 15)
    assert sent["tls"] is True
    assert sent["login"] == ("relay@smtp-brevo.com", "test-smtp-key")
    assert sent["message"]["From"] == "verified@example.com"
    assert sent["message"]["To"] == "recipient@example.com"


@pytest.mark.asyncio
async def test_sharepoint_status_waits_for_complete_brevo_settings(client, auth, monkeypatch):
    monkeypatch.setattr(email.settings, "SMTP_HOST", "smtp-relay.brevo.com")
    monkeypatch.setattr(email.settings, "SMTP_USER", "relay@smtp-brevo.com")
    monkeypatch.setattr(email.settings, "SMTP_FROM", "verified@example.com")
    monkeypatch.setattr(email.settings, "SMTP_PASSWORD", "")
    response = await client.get("/api/sharepoint/status", headers=auth)
    assert response.status_code == 200
    assert response.json()["email_configured"] is False

    monkeypatch.setattr(email.settings, "SMTP_PASSWORD", "test-smtp-key")
    response = await client.get("/api/sharepoint/status", headers=auth)
    assert response.json()["email_configured"] is True


@pytest.mark.asyncio
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
