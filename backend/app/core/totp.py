"""Minimal TOTP (RFC 6238) using only the standard library — no extra deps.

Used for optional two-factor authentication. Secrets are base32 strings
compatible with authenticator apps (Google Authenticator, Microsoft
Authenticator, 1Password, …).
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def generate_secret() -> str:
    """A random base32 secret (no padding) suitable for authenticator apps."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int, digits: int = 6) -> str:
    # Re-pad base32 to a multiple of 8 for decoding.
    padded = secret + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def verify(secret: str, code: str, window: int = 1, step: int = 30) -> bool:
    """Verify a TOTP code, allowing +/- ``window`` steps for clock drift."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit():
        return False
    now = int(time.time() // step)
    for drift in range(-window, window + 1):
        if hmac.compare_digest(_hotp(secret, now + drift), code):
            return True
    return False


def provisioning_uri(secret: str, account: str, issuer: str = "Company Tools") -> str:
    """An otpauth:// URI to render as a QR code in the UI."""
    label = quote(f"{issuer}:{account}")
    return (
        f"otpauth://totp/{label}?secret={secret}"
        f"&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"
    )
