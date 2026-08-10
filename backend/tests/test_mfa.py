import time

import pytest

from app.core import totp
from helpers import MEMBER_PW, make_member

pytestmark = pytest.mark.asyncio


def _code(secret: str) -> str:
    return totp._hotp(secret, int(time.time() // 30))


async def test_mfa_setup_enable_and_login(client, auth):
    hdr, _ = await make_member(client, auth, "mfa-user@agholding.net")

    status = (await client.get("/api/auth/mfa/status", headers=hdr)).json()
    assert status["enabled"] is False
    assert status["pending"] is False

    setup = (await client.post("/api/auth/mfa/setup", headers=hdr)).json()
    secret = setup["secret"]
    assert secret and setup["otpauth_uri"].startswith("otpauth://totp/")
    assert (await client.get("/api/auth/mfa/status", headers=hdr)).json()["pending"] is True
    qr = await client.get("/api/auth/mfa/qr.png", headers=hdr)
    assert qr.status_code == 200
    assert qr.headers["content-type"] == "image/png"
    assert qr.headers["cache-control"] == "no-store"
    assert qr.content.startswith(b"\x89PNG")

    # Wrong code can't enable.
    assert (await client.post("/api/auth/mfa/enable", headers=hdr, json={"code": "000000"})).status_code == 400
    assert (await client.post("/api/auth/mfa/enable", headers=hdr, json={"code": _code(secret)})).status_code == 200
    assert (await client.get("/api/auth/mfa/qr.png", headers=hdr)).status_code == 404
    assert (await client.get("/api/auth/mfa/status", headers=hdr)).json() == {
        "enabled": True,
        "pending": False,
    }

    # Login now requires a valid TOTP code.
    no_code = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW})
    assert no_code.status_code == 401
    bad = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW, "code": "111111"})
    assert bad.status_code == 401
    ok = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW, "code": _code(secret)})
    assert ok.status_code == 200 and ok.json()["access_token"]

    # Cannot start a new setup while enabled.
    assert (await client.post("/api/auth/mfa/setup", headers=hdr)).status_code == 400

    # Disable with a valid code restores password-only login.
    assert (await client.post("/api/auth/mfa/disable", headers=hdr, json={"code": _code(secret)})).status_code == 200
    again = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW})
    assert again.status_code == 200
    assert (await client.get("/api/auth/mfa/status", headers=hdr)).json() == {
        "enabled": False,
        "pending": False,
    }


async def test_mfa_disable_with_password_and_clear_pending(client, auth):
    hdr, _ = await make_member(client, auth, "mfa-reset@agholding.net")

    # Pending setup can be cleared without a code (for cancel / retry).
    setup = (await client.post("/api/auth/mfa/setup", headers=hdr)).json()
    secret = setup["secret"]
    cleared = await client.post("/api/auth/mfa/disable", headers=hdr, json={})
    assert cleared.status_code == 200
    assert cleared.json() == {"enabled": False, "pending": False}
    assert (await client.get("/api/auth/mfa/qr.png", headers=hdr)).status_code == 404

    # Re-setup, enable, then remove using account password (no authenticator code).
    setup2 = (await client.post("/api/auth/mfa/setup", headers=hdr)).json()
    secret2 = setup2["secret"]
    assert secret2 != secret
    assert (
        await client.post("/api/auth/mfa/enable", headers=hdr, json={"code": _code(secret2)})
    ).status_code == 200

    bad_pw = await client.post(
        "/api/auth/mfa/disable", headers=hdr, json={"password": "wrong-password"}
    )
    assert bad_pw.status_code == 400

    ok = await client.post(
        "/api/auth/mfa/disable", headers=hdr, json={"password": MEMBER_PW}
    )
    assert ok.status_code == 200
    assert ok.json() == {"enabled": False, "pending": False}

    # Password-only login works again; setup can be retried.
    login = await client.post(
        "/api/auth/login", json={"email": "mfa-reset@agholding.net", "password": MEMBER_PW}
    )
    assert login.status_code == 200
    assert (await client.post("/api/auth/mfa/setup", headers=hdr)).status_code == 200


async def test_password_policy_enforced(client, auth):
    hdr, uid = await make_member(client, auth, "pw-user@agholding.net")
    # Too short / no digit rejected on change-password.
    short = await client.post("/api/auth/change-password", headers=hdr, json={"current_password": MEMBER_PW, "new_password": "abc"})
    assert short.status_code == 422
    nodigit = await client.post("/api/auth/change-password", headers=hdr, json={"current_password": MEMBER_PW, "new_password": "abcdefghij"})
    assert nodigit.status_code == 422
    good = await client.post("/api/auth/change-password", headers=hdr, json={"current_password": MEMBER_PW, "new_password": "Stronger123"})
    assert good.status_code == 200

    # Admin set-password also enforces policy.
    weak = await client.post(f"/api/users/{uid}/set-password", headers=auth, json={"password": "weak"})
    assert weak.status_code == 422
