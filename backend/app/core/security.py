from datetime import datetime, timedelta, timezone
from typing import Any

import base64
import hashlib
import hmac
import os

from jose import JWTError, jwt

from app.core.config import settings

# ---- Password hashing (PBKDF2-HMAC-SHA256, no external dependency) ----
_PBKDF2_ALGO = "pbkdf2_sha256"
_PBKDF2_ROUNDS = 240_000

# ---- Password policy ----
PASSWORD_MIN_LENGTH = 8


def password_policy_error(password: str) -> str | None:
    """Return a human-readable reason if ``password`` is too weak, else None.

    Requires the configured minimum length and a mix of letters and digits.
    """
    pw = password or ""
    if len(pw) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters"
    if not any(c.isalpha() for c in pw):
        return "Password must contain a letter"
    if not any(c.isdigit() for c in pw):
        return "Password must contain a number"
    return None


def hash_password(password: str) -> str:
    """Return an encoded hash: ``pbkdf2_sha256$rounds$salt_b64$hash_b64``."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    salt_b64 = base64.b64encode(salt).decode()
    hash_b64 = base64.b64encode(dk).decode()
    return f"{_PBKDF2_ALGO}${_PBKDF2_ROUNDS}${salt_b64}${hash_b64}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algo, rounds, b64salt, b64hash = encoded.split("$")
        if algo != _PBKDF2_ALGO:
            return False
        salt = base64.b64decode(b64salt)
        expected = base64.b64decode(b64hash)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(rounds))
        return hmac.compare_digest(dk, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
    except JWTError:
        return None
