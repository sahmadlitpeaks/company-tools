"""Encryption helpers for the secure file-transfer module.

The encryption key is derived (HKDF-SHA256) from a high-entropy URL token plus
an optional password and a per-transfer random salt. Only the token *hash* and
the salt are persisted, so the ciphertext on disk cannot be decrypted from the
database alone — the token must come from the share link.
"""
import base64
import hashlib
import secrets

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def new_token() -> str:
    """High-entropy, URL-safe secret carried only in the share link."""
    return secrets.token_urlsafe(32)


def new_salt() -> str:
    return secrets.token_hex(16)


def token_hash(token: str) -> str:
    """Stable lookup key stored in the DB (never reversible to the token)."""
    return hashlib.sha256(token.encode()).hexdigest()


def _derive_key(token: str, salt: str, password: str | None) -> bytes:
    material = token.encode() + b":" + (password or "").encode()
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=bytes.fromhex(salt),
        info=b"ag-secure-transfer-v1",
    )
    return base64.urlsafe_b64encode(hkdf.derive(material))


def hash_password(password: str, *, iterations: int = 240_000) -> str:
    """PBKDF2-HMAC-SHA256 password hash, stored as `iterations$salt$hash`."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"{iterations}${salt.hex()}${dk.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        iters, salt_hex, hash_hex = encoded.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iters)
        )
        return secrets.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


def encrypt_bytes(data: bytes, token: str, salt: str, password: str | None) -> bytes:
    return Fernet(_derive_key(token, salt, password)).encrypt(data)


def decrypt_bytes(
    blob: bytes, token: str, salt: str, password: str | None
) -> bytes | None:
    """Return plaintext, or None if the token/password is wrong."""
    try:
        return Fernet(_derive_key(token, salt, password)).decrypt(blob)
    except InvalidToken:
        return None
