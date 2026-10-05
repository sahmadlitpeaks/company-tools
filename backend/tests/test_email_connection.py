
import smtplib
import pytest
from app.core.config import settings
from app.services import email

@pytest.mark.asyncio
async def test_email_check_admin_only_and_no_secrets(client, auth, monkeypatch):
    from helpers import make_member
    member, _ = await make_member(client, auth, email="member@example.com")
    assert (await client.post("/api/notifications/email/check", headers=member)).status_code == 403
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.office365.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "private-password")
    response = await client.get("/api/notifications/channels", headers=auth)
    assert "private-password" not in response.text
    assert "SMTP_USER" in response.json()["email_diagnostics"]["missing"]
    response = await client.post("/api/notifications/email/check", headers=auth)
    assert response.status_code == 200 and not response.json()["ok"]
    assert "private-password" not in response.text

@pytest.mark.parametrize("failure", [None, "auth", "network"])
def test_smtp_check_connects_without_sending(monkeypatch, failure):
    for key,value in {"SMTP_HOST":"smtp.example.test", "SMTP_PORT":587, "SMTP_STARTTLS":True,
                      "SMTP_USER":"login", "SMTP_PASSWORD":"secret"}.items():
        monkeypatch.setattr(settings,key,value)
    calls=[]
    class FakeSMTP:
        def __init__(self,*args,**kwargs):
            if failure == "network": raise OSError("private-provider-response")
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def ehlo(self): calls.append("ehlo")
        def starttls(self): calls.append("tls")
        def login(self,*args):
            calls.append("login")
            if failure == "auth": raise smtplib.SMTPAuthenticationError(535,b"private-provider-response")
        def send_message(self,*args): pytest.fail("Connection check must not send email")
    monkeypatch.setattr(email.smtplib,"SMTP",FakeSMTP)
    result=email.check_smtp_connection()
    assert result["ok"] is (failure is None)
    assert "secret" not in str(result) and "private-provider-response" not in str(result)
    if failure is None: assert calls == ["ehlo","tls","ehlo","login"]
