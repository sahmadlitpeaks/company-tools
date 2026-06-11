import time

import pytest

from app.core import totp
from helpers import MEMBER_PW, make_member

pytestmark = pytest.mark.asyncio


def _code(secret: str) -> str:
    return totp._hotp(secret, int(time.time() // 30))


async def test_mfa_setup_enable_and_login(client, auth):
    hdr, _ = await make_member(client, auth, "mfa-user@agholding.net")

    assert (await client.get("/api/auth/mfa/status", headers=hdr)).json()["enabled"] is False

    setup = (await client.post("/api/auth/mfa/setup", headers=hdr)).json()
    secret = setup["secret"]
    assert secret and setup["otpauth_uri"].startswith("otpauth://totp/")

    # Wrong code can't enable.
    assert (await client.post("/api/auth/mfa/enable", headers=hdr, json={"code": "000000"})).status_code == 400
    assert (await client.post("/api/auth/mfa/enable", headers=hdr, json={"code": _code(secret)})).status_code == 200

    # Login now requires a valid TOTP code.
    no_code = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW})
    assert no_code.status_code == 401
    bad = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW, "code": "111111"})
    assert bad.status_code == 401
    ok = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW, "code": _code(secret)})
    assert ok.status_code == 200 and ok.json()["access_token"]

    # Disable with a valid code restores password-only login.
    assert (await client.post("/api/auth/mfa/disable", headers=hdr, json={"code": _code(secret)})).status_code == 200
    again = await client.post("/api/auth/login", json={"email": "mfa-user@agholding.net", "password": MEMBER_PW})
    assert again.status_code == 200


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
